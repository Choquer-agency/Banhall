<!--
  Admin model catalog (owner decision 21, amended 2026-10-22: models follow
  the newest version of their tier). The kill switch, the seven tiers with
  their current and previous model and a "Move back" action, each role's
  tier and cost cap, the update log, the catalog itself and the last
  evaluations that ran before they ended. Presentational: the route owns
  every query and mutation and passes data and callbacks in.

  Benchmark scores are Artificial Analysis data. They appear only here, on an
  admin-only page, with the attribution line; never on a client surface.
-->
<script lang="ts">
  import { Switch } from "bits-ui";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import {
    formatDate,
    formatTokens,
    formatUsd,
    formatUsdPerMTok,
    statusLabel,
    type CostCapInput,
    type ModelAdminRole,
    type ModelAdminState,
    type ModelAdminTrack,
  } from "$lib/modelCatalogAdmin";

  let {
    admin,
    busy = null,
    onToggleAutoSwitch,
    onMoveBack,
    onSaveCap,
    onRefresh,
  }: {
    admin: ModelAdminState;
    /** Which action is in flight, to disable its control. */
    busy?: string | null;
    onToggleAutoSwitch: (enabled: boolean) => void;
    onMoveBack: (track: ModelAdminTrack["track"]) => void;
    onSaveCap: (role: ModelAdminRole["role"], cap: CostCapInput) => void;
    onRefresh: () => void;
  } = $props();

  // Editable drafts, seeded from the server state and reset when it changes.
  let capDrafts = $state<Record<string, { input: string; output: string }>>({});
  let evaluationsOpen = $state(false);

  $effect(() => {
    const next: Record<string, { input: string; output: string }> = {};
    for (const role of admin.roles) {
      next[role.role] = {
        input: String(role.cap.maxInputUsdPerMTok),
        output: String(role.cap.maxOutputUsdPerMTok),
      };
    }
    capDrafts = next;
  });

  function parsedCap(role: ModelAdminRole): CostCapInput | null {
    const draft = capDrafts[role.role];
    if (!draft) return null;
    const cap = {
      maxInputUsdPerMTok: Number(draft.input),
      maxOutputUsdPerMTok: Number(draft.output),
      // Only evaluations read the ratio, and they have ended: keep it.
      maxCostRatio: role.cap.maxCostRatio,
    };
    return Object.values(cap).every((value) => Number.isFinite(value) && value > 0) ? cap : null;
  }

  const hasScores = $derived(admin.catalog.some((row) => row.score !== null));
  const errorPercent = $derived(Math.round(admin.thresholds.maxErrorRate * 100));
</script>

<section class="mt-6 flex flex-col gap-6" aria-label="Model catalog">
  <!-- Automatic updates -->
  <div class="card p-5">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="max-w-xl">
        <h2 class="text-sm font-medium text-gray-900">Automatic updates</h2>
        <p class="mt-1 text-sm text-gray-600">
          Each morning the app looks for a newer version of each tier below. A newer version gets two
          small test requests first, and every role on that tier moves to it once they pass. A
          generation already running keeps the models it started with. A tier moves back on its own
          when its new model fails more than {errorPercent} percent of at least
          {admin.thresholds.errorMinCalls} calls in a day. Turning this off stops every update and move back.
        </p>
      </div>
      <label class="flex items-center gap-3 text-sm text-gray-800">
        <span>{admin.autoSwitch ? "On" : "Off"}</span>
        <Switch.Root
          checked={admin.autoSwitch}
          disabled={busy === "autoSwitch"}
          onCheckedChange={(checked) => onToggleAutoSwitch(checked)}
          aria-label="Update models automatically"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-gray-300 transition-colors data-[state=checked]:bg-primary disabled:opacity-60"
        >
          <Switch.Thumb
            class="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[1.375rem]"
          />
        </Switch.Root>
      </label>
    </div>
    <div class="mt-5 border-t border-gray-100 pt-4">
      <p class="text-label">Catalog</p>
      <p class="mt-1 text-sm text-gray-700">
        {admin.catalogSize} models, last refreshed {formatDate(admin.lastRefreshAt)}.
      </p>
      <Button class="mt-2" size="xs" variant="ghost" disabled={busy === "refresh"} onclick={onRefresh}>
        Refresh now
      </Button>
    </div>
  </div>

  <!-- Tiers -->
  <div>
    <h2 class="text-sm font-medium text-gray-900">Tiers</h2>
    <p class="mt-1 text-sm text-gray-500">
      Writers pick from these seven models. Each tier always runs its newest version.
    </p>
    <ul class="mt-3 flex flex-col gap-3">
      {#each admin.tracks as track (track.track)}
        <li class="card p-4" data-track={track.track}>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-900">{track.name}</p>
              <p class="mt-1 text-sm text-gray-800">
                <span class="text-gray-500">Now:</span> {track.modelLabel}
                <span class="text-data text-gray-400">{track.modelId}</span>
              </p>
              {#if track.previousLabel}
                <p class="text-sm text-gray-700">
                  <span class="text-gray-500">Before:</span> {track.previousLabel}
                </p>
              {/if}
              <p class="mt-1 text-xs text-gray-500">
                {track.switchedAt === null ? "Not moved yet." : `Moved on ${formatDate(track.switchedAt)}.`}
                Last checked {formatDate(track.lastCheckedAt)}.{#if track.lastCheckNote}
                  {" "}{track.lastCheckNote}{/if}
              </p>
              {#if track.rolledBackFrom.length > 0}
                <p class="text-xs text-gray-500" data-testid="rolled-back-from">
                  Never used again on this tier: {track.rolledBackFrom.join(", ")}.
                </p>
              {/if}
            </div>
            <Button
              size="xs"
              variant="ghost"
              disabled={!track.previousModelId || busy === `moveBack:${track.track}`}
              onclick={() => onMoveBack(track.track)}
            >
              {track.previousLabel ? `Move back to ${track.previousLabel}` : "Nothing to move back to"}
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  </div>

  <!-- Roles -->
  <div>
    <h2 class="text-sm font-medium text-gray-900">Roles</h2>
    <p class="mt-1 text-sm text-gray-500">
      Each role follows a tier and runs its newest version. The cost caps limit what an OpenRouter
      model may charge per million tokens.
    </p>
    <ul class="mt-3 flex flex-col gap-3">
      {#each admin.roles as role (role.role)}
        {@const cap = parsedCap(role)}
        <li class="card p-4" data-role={role.role}>
          <p class="text-sm font-medium text-gray-900">{role.label}</p>
          <p class="text-xs text-gray-500">{role.description}</p>
          <p class="mt-2 text-sm text-gray-800" data-testid="role-track">
            Follows {role.trackName}, now {role.modelLabel}{role.chosenByAdmin ? " (chosen by an admin)" : ""}.
          </p>
          <form
            class="mt-3 flex flex-wrap items-end gap-3"
            onsubmit={(event) => {
              event.preventDefault();
              if (cap) onSaveCap(role.role, cap);
            }}
          >
            {#if capDrafts[role.role]}
              <Input
                id={`cap-input-${role.role}`}
                label="Input cap ($/M)"
                type="text"
                inputmode="decimal"
                bind:value={capDrafts[role.role].input}
                class="w-28"
              />
              <Input
                id={`cap-output-${role.role}`}
                label="Output cap ($/M)"
                type="text"
                inputmode="decimal"
                bind:value={capDrafts[role.role].output}
                class="w-28"
              />
              <Button type="submit" size="xs" variant="ghost" disabled={!cap || busy === `cap:${role.role}`}>
                Save cap
              </Button>
            {/if}
          </form>
        </li>
      {/each}
    </ul>
  </div>

  <!-- Update log -->
  <div>
    <h2 class="text-sm font-medium text-gray-900">Update log</h2>
    <p class="mt-1 text-sm text-gray-500">
      Every tier move, move back and catalog notice. Only admins see this log.
    </p>
    {#if admin.log.length === 0}
      <p class="card mt-3 px-4 py-6 text-center text-sm text-gray-500">Nothing logged yet.</p>
    {:else}
      <ol class="card mt-3 flex flex-col divide-y divide-gray-100" data-testid="model-log">
        {#each admin.log as line (line.id)}
          <li class="px-4 py-2.5 text-sm text-gray-700">
            <span class="text-data mr-2 text-gray-400">{formatDate(line.at)}</span>
            {line.text}{line.kind !== "notice" && line.automatic ? " (automatic)" : ""}
          </li>
        {/each}
      </ol>
    {/if}
  </div>

  <!-- Catalog -->
  <div>
    <h2 class="text-sm font-medium text-gray-900">Catalog</h2>
    <p class="mt-1 text-sm text-gray-500">
      Models in use first, then the strongest candidates. Prices are USD per million tokens.
    </p>
    <div class="card mt-3 overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-label border-b border-gray-100 text-left">
            <th class="px-4 py-2.5 font-medium">Model</th>
            <th class="px-4 py-2.5 font-medium">Status</th>
            <th class="px-4 py-2.5 text-right font-medium">Input</th>
            <th class="px-4 py-2.5 text-right font-medium">Output</th>
            <th class="px-4 py-2.5 text-right font-medium">Context</th>
            <th class="px-4 py-2.5 text-right font-medium">Max output</th>
            <th class="px-4 py-2.5 font-medium">Tools</th>
            <th class="px-4 py-2.5 text-right font-medium">Score</th>
            <th class="px-4 py-2.5 font-medium">Retires</th>
          </tr>
        </thead>
        <tbody>
          {#each admin.catalog as row (row.modelId)}
            <tr class="border-b border-gray-50 last:border-0" data-model={row.modelId}>
              <td class="px-4 py-2.5">
                <span class="block text-gray-900">{row.displayName}</span>
                <span class="text-data block text-gray-400">{row.modelId}</span>
              </td>
              <td class="px-4 py-2.5 text-gray-700">
                {statusLabel(row.status)}{row.inUse ? ", in use" : ""}{row.missing ? ", not listed" : ""}
              </td>
              <td class="text-data px-4 py-2.5 text-right text-gray-700">{formatUsdPerMTok(row.inputUsdPerMTok)}</td>
              <td class="text-data px-4 py-2.5 text-right text-gray-700">{formatUsdPerMTok(row.outputUsdPerMTok)}</td>
              <td class="text-data px-4 py-2.5 text-right text-gray-700">{formatTokens(row.contextLength)}</td>
              <td class="text-data px-4 py-2.5 text-right text-gray-700">{formatTokens(row.maxOutputTokens)}</td>
              <td class="px-4 py-2.5 text-xs text-gray-600">
                {row.supportsTools && row.supportsStructuredOutputs ? "Tools, structured" : row.supportsTools ? "Tools" : "None"}
              </td>
              <td class="text-data px-4 py-2.5 text-right text-gray-700">{row.score === null ? "n/a" : row.score.toFixed(1)}</td>
              <td class="text-data px-4 py-2.5 text-gray-500">{row.expirationDate ?? ""}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if hasScores}
      <p class="mt-2 text-xs text-gray-500" data-testid="aa-attribution">
        Score: intelligence index. Source: Artificial Analysis (artificialanalysis.ai). For internal use only;
        never share these scores with clients.
      </p>
    {/if}
  </div>

  <!-- Earlier evaluations (ended 2026-10-22) -->
  {#if admin.evaluations.length > 0}
    <div>
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left text-sm font-medium text-gray-900 hover:text-gray-700"
        aria-expanded={evaluationsOpen}
        aria-controls="model-evaluations"
        onclick={() => (evaluationsOpen = !evaluationsOpen)}
      >
        Earlier evaluations ({admin.evaluations.length})
        <DisclosureChevron open={evaluationsOpen} />
      </button>
      <Disclosure id="model-evaluations" open={evaluationsOpen}>
        <p class="mt-1 text-sm text-gray-500">
          Evaluations ended on 2026-10-22, when tiers began following their newest version. These are the last
          ones that ran. None of them changes a model now.
        </p>
        <div class="card mt-3 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-label border-b border-gray-100 text-left">
                <th class="px-4 py-2.5 font-medium">Date</th>
                <th class="px-4 py-2.5 font-medium">Role</th>
                <th class="px-4 py-2.5 font-medium">Candidate</th>
                <th class="px-4 py-2.5 font-medium">Against</th>
                <th class="px-4 py-2.5 font-medium">Status</th>
                <th class="px-4 py-2.5 font-medium">Result</th>
                <th class="px-4 py-2.5 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {#each admin.evaluations as evaluation (evaluation.id)}
                <tr class="border-b border-gray-50 last:border-0">
                  <td class="text-data px-4 py-2.5 text-gray-500">{formatDate(evaluation.createdAt)}</td>
                  <td class="px-4 py-2.5 text-gray-700">{evaluation.roleLabel}</td>
                  <td class="px-4 py-2.5 text-gray-900">{evaluation.modelLabel}</td>
                  <td class="px-4 py-2.5 text-gray-700">{evaluation.incumbentLabel}</td>
                  <td class="px-4 py-2.5 text-gray-700">{statusLabel(evaluation.status)}</td>
                  <td class="px-4 py-2.5 text-xs text-gray-600">{evaluation.error ?? evaluation.outcome ?? ""}</td>
                  <td class="text-data px-4 py-2.5 text-right text-gray-700">
                    {formatUsd(evaluation.evalCostUsd ?? evaluation.estimatedCostUsd)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </div>
  {/if}
</section>
