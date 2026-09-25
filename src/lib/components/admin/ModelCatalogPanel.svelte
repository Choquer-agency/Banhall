<!--
  Admin model catalog (owner decision 21): the kill switch, the evaluation
  budget, each role's model with its history, rollback and cost cap, recent
  evaluations, and the catalog itself. Presentational: the route owns every
  query and mutation and passes data and callbacks in.

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
    switchReason,
    type CostCapInput,
    type ModelAdminRole,
    type ModelAdminState,
  } from "$lib/modelCatalogAdmin";

  let {
    admin,
    busy = null,
    onToggleAutoSwitch,
    onRollback,
    onSaveCap,
    onSaveBudget,
    onRefresh,
  }: {
    admin: ModelAdminState;
    /** Which action is in flight, to disable its control. */
    busy?: string | null;
    onToggleAutoSwitch: (enabled: boolean) => void;
    onRollback: (role: ModelAdminRole["role"]) => void;
    onSaveCap: (role: ModelAdminRole["role"], cap: CostCapInput) => void;
    onSaveBudget: (monthlyUsd: number) => void;
    onRefresh: () => void;
  } = $props();

  // Editable drafts, seeded from the server state and reset when it changes.
  let capDrafts = $state<Record<string, { input: string; output: string; ratio: string }>>({});
  let budgetDraft = $state("");
  let openHistory = $state<Record<string, boolean>>({});

  $effect(() => {
    const next: Record<string, { input: string; output: string; ratio: string }> = {};
    for (const role of admin.roles) {
      next[role.role] = {
        input: String(role.cap.maxInputUsdPerMTok),
        output: String(role.cap.maxOutputUsdPerMTok),
        ratio: String(role.cap.maxCostRatio),
      };
    }
    capDrafts = next;
    budgetDraft = String(admin.evalBudget.monthlyUsd);
  });

  function parsedCap(role: string): CostCapInput | null {
    const draft = capDrafts[role];
    if (!draft) return null;
    const cap = {
      maxInputUsdPerMTok: Number(draft.input),
      maxOutputUsdPerMTok: Number(draft.output),
      maxCostRatio: Number(draft.ratio),
    };
    return Object.values(cap).every((value) => Number.isFinite(value) && value > 0) ? cap : null;
  }

  const budgetValue = $derived(Number(budgetDraft));
  const budgetValid = $derived(budgetDraft.trim() !== "" && Number.isFinite(budgetValue) && budgetValue >= 0);
  const hasScores = $derived(admin.catalog.some((row) => row.score !== null));
</script>

<section class="mt-6 flex flex-col gap-6" aria-label="Model catalog">
  <!-- Automatic switching -->
  <div class="card p-5">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="max-w-xl">
        <h2 class="text-sm font-medium text-gray-900">Automatic switching</h2>
        <p class="mt-1 text-sm text-gray-600">
          Each day the app checks for better models, tests at most {admin.thresholds.maxEvaluationsPerRun}
          on real interview material, and switches a role only when a model passes every test and stays
          within the role's cost cap. Turning this off stops every automatic switch and rollback.
        </p>
      </div>
      <label class="flex items-center gap-3 text-sm text-gray-800">
        <span>{admin.autoSwitch ? "On" : "Off"}</span>
        <Switch.Root
          checked={admin.autoSwitch}
          disabled={busy === "autoSwitch"}
          onCheckedChange={(checked) => onToggleAutoSwitch(checked)}
          aria-label="Switch models automatically"
          class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-gray-300 transition-colors data-[state=checked]:bg-primary disabled:opacity-60"
        >
          <Switch.Thumb
            class="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[22px]"
          />
        </Switch.Root>
      </label>
    </div>
    <div class="mt-5 grid gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
      <div>
        <p class="text-label">Evaluation budget this month</p>
        <p class="text-data mt-1 text-gray-800">
          {formatUsd(admin.evalBudget.spentUsd)} of {formatUsd(admin.evalBudget.monthlyUsd)} used
        </p>
        <form
          class="mt-2 flex items-end gap-2"
          onsubmit={(event) => {
            event.preventDefault();
            if (budgetValid) onSaveBudget(budgetValue);
          }}
        >
          <Input
            id="eval-budget"
            label="Monthly budget, USD"
            type="text"
            inputmode="decimal"
            bind:value={budgetDraft}
            class="w-28"
          />
          <Button type="submit" size="xs" variant="ghost" disabled={!budgetValid || busy === "budget"}>
            Save budget
          </Button>
        </form>
      </div>
      <div>
        <p class="text-label">Catalog</p>
        <p class="mt-1 text-sm text-gray-700">
          {admin.catalogSize} models, last refreshed {formatDate(admin.lastRefreshAt)}.
        </p>
        <Button class="mt-2" size="xs" variant="ghost" disabled={busy === "refresh"} onclick={onRefresh}>
          Refresh now
        </Button>
      </div>
    </div>
  </div>

  <!-- Roles -->
  <div>
    <h2 class="text-sm font-medium text-gray-900">Roles</h2>
    <p class="mt-1 text-sm text-gray-500">
      Every generation keeps the models it started with. A switch reaches the next generation only.
    </p>
    <ul class="mt-3 flex flex-col gap-3">
      {#each admin.roles as role (role.role)}
        {@const cap = parsedCap(role.role)}
        {@const historyId = `role-history-${role.role}`}
        <li class="card p-4" data-role={role.role}>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-900">{role.label}</p>
              <p class="text-xs text-gray-500">{role.description}</p>
              <p class="mt-2 text-sm text-gray-800">
                <span class="text-gray-500">Model:</span> {role.modelLabel}
                {#if role.previousLabel}
                  <span class="text-gray-500">(before: {role.previousLabel})</span>
                {/if}
              </p>
              <p class="text-xs text-gray-500">
                {#if role.assignedAt === null}
                  Default model, never switched.
                {:else}
                  {role.assignedBy === "system" ? "Switched automatically" : "Set by an admin"} on {formatDate(role.assignedAt)}.
                {/if}
                {#if !role.autoSwitch}
                  <span class="mt-1 block" data-testid="manual-only-reason">
                    Never switches on its own: {role.manualOnlyReason}
                  </span>
                {/if}
              </p>
            </div>
            <Button
              size="xs"
              variant="ghost"
              disabled={!role.previousModelId || busy === `rollback:${role.role}`}
              onclick={() => onRollback(role.role)}
            >
              {role.previousLabel ? `Roll back to ${role.previousLabel}` : "Nothing to roll back"}
            </Button>
          </div>

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
              <Input
                id={`cap-ratio-${role.role}`}
                label="Max cost vs current"
                type="text"
                inputmode="decimal"
                bind:value={capDrafts[role.role].ratio}
                class="w-24"
              />
              <Button type="submit" size="xs" variant="ghost" disabled={!cap || busy === `cap:${role.role}`}>
                Save cap
              </Button>
            {/if}
          </form>

          {#if role.history.length > 0}
            <button
              type="button"
              class="mt-3 flex w-full items-center justify-between gap-2 rounded-md py-1 text-left text-xs font-medium text-gray-600 hover:text-gray-900"
              aria-expanded={openHistory[role.role] === true}
              aria-controls={historyId}
              onclick={() => (openHistory[role.role] = !openHistory[role.role])}
            >
              History ({role.history.length})
              <DisclosureChevron open={openHistory[role.role] === true} />
            </button>
            <Disclosure id={historyId} open={openHistory[role.role] === true}>
              <ol class="mt-2 flex flex-col gap-1.5">
                {#each role.history as event (event.id)}
                  <li class="text-xs text-gray-600">
                    <span class="text-data text-gray-400">{formatDate(event.at)}</span>
                    {event.fromLabel ? `From ${event.fromLabel} to ${event.toLabel}` : `To ${event.toLabel}`},
                    {switchReason(event.reason)}{event.actor === "system" ? " (automatic)" : ""}.
                    {#if event.rubric}
                      Rubric {event.rubric.candidate.toFixed(1)} vs {event.rubric.incumbent.toFixed(1)}.
                    {/if}
                    {#if event.errorRate !== null}
                      {Math.round(event.errorRate * 100)} percent of calls failed.
                    {/if}
                  </li>
                {/each}
              </ol>
            </Disclosure>
          {/if}
        </li>
      {/each}
    </ul>
  </div>

  <!-- Evaluations -->
  <div>
    <h2 class="text-sm font-medium text-gray-900">Evaluations</h2>
    <p class="mt-1 text-sm text-gray-500">
      A candidate must return valid structured output every time, match the current model's contract pass
      rate, beat its judged score by {admin.thresholds.rubricMargin} and stay within the cost cap.
    </p>
    {#if admin.evaluations.length === 0}
      <p class="card mt-3 px-4 py-6 text-center text-sm text-gray-500">No evaluations yet.</p>
    {:else}
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
                <td class="px-4 py-2.5 text-xs text-gray-600">
                  {#if evaluation.error}
                    {evaluation.error}
                  {:else if evaluation.outcome}
                    {evaluation.outcome}
                  {:else}
                    Waiting
                  {/if}
                  {#if evaluation.candidate && evaluation.incumbent}
                    <span class="block text-gray-400">
                      Rubric {evaluation.candidate.rubricScore.toFixed(1)} vs {evaluation.incumbent.rubricScore.toFixed(1)},
                      valid {Math.round(evaluation.candidate.schemaValidity * 100)} percent
                    </span>
                  {/if}
                </td>
                <td class="text-data px-4 py-2.5 text-right text-gray-700">
                  {formatUsd(evaluation.evalCostUsd ?? evaluation.estimatedCostUsd)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
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
</section>
