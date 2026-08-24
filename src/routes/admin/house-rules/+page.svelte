<script lang="ts">
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import { resolve } from "$app/paths";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { LockSimpleIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import {
    STYLE_OVERRIDE_KEYS,
    STYLE_OVERRIDE_META,
    HOUSE_RULE_MODES,
    HOUSE_RULE_MODE_LABELS,
    DEFAULT_HOUSE_RULE_MODES,
    type HouseRuleMode,
    type HouseRuleModes,
  } from "../../../../shared/styleOverrides";
  import { HOUSE_RULE_TEXTS, LOCKED_RULES } from "../../../../shared/houseRules";
  import {
    BANNED_REPLACEMENTS,
    BANNED_DELETIONS,
    SCAN_ONLY_TERMS,
  } from "../../../../shared/bannedWords";

  const MODE_ITEMS = HOUSE_RULE_MODES.map((value) => ({
    value,
    label: HOUSE_RULE_MODE_LABELS[value],
  }));

  const auth = useAuth();
  const currentUserQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const isAdmin = $derived(currentUserQ.data?.role === "admin");
  const configQ = useQuery(api.houseStyle.getConfig, () =>
    auth.isAuthenticated && isAdmin ? {} : "skip"
  );
  const setModes = useMutation(api.houseStyle.setModes);

  // Mode form with the non-dirty re-seed idiom: server changes (another
  // admin, another tab) flow in until this admin edits; their draft then
  // wins until save.
  let modes = $state<HouseRuleModes>({ ...DEFAULT_HOUSE_RULE_MODES });
  let modesSeed = $state<HouseRuleModes | null>(null);
  function modesEqual(a: HouseRuleModes, b: HouseRuleModes): boolean {
    return STYLE_OVERRIDE_KEYS.every((key) => a[key] === b[key]);
  }
  // Dirty = the draft differs from the seeded server snapshot; the Save
  // button stays disabled until something actually changed.
  const dirty = $derived(modesSeed !== null && !modesEqual(modes, modesSeed));
  $effect(() => {
    const server = configQ.data?.modes;
    if (!server) return;
    const serverChanged = modesSeed === null || !modesEqual(server, modesSeed);
    if (serverChanged && !dirty) {
      modes = { ...server };
      modesSeed = { ...server };
    }
  });

  let saving = $state(false);
  let saved = $state(false);
  let error = $state("");

  async function handleSave() {
    if (saving || !dirty) return;
    error = "";
    saved = false;
    saving = true;
    try {
      await setModes({ modes: { ...modes } });
      modesSeed = { ...modes };
      saved = true;
      setTimeout(() => (saved = false), 2500);
    } catch (cause) {
      error = userErrorMessage(cause, "Could not save the house rule modes.");
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto(resolve("/login"), { replaceState: true });
    }
  });

  function updatedDate(ms: number | null | undefined) {
    return ms
      ? new Date(ms).toLocaleDateString("en-CA", { dateStyle: "medium" })
      : null;
  }
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <AdminWorkspacePage
    title="House rules"
    description="The organization's PD writing rulebook — what every report must follow, and which house-style rules writers may override."
  >
    {#if currentUserQ.data === undefined}
      <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
    {:else if !isAdmin}
      <p class="text-sm text-gray-500">
        House rules are available to administrators only.
      </p>
    {:else}
      <section class="card p-6">
        <h2 class="text-title">How this rulebook works</h2>
        <p class="mt-1 max-w-3xl text-sm text-gray-500">
          Every generated PD is written against two tiers of rules. The
          CRA-required tier is locked for everyone — no writer, admin, or
          preference document can change it. The house-style tier below is the
          organization's own writing standard: each category can be governed
          per rule, from writer-by-writer choice to org-wide enforcement to
          switching the rule off entirely.
        </p>
      </section>

      <!-- CRA tier: read-only, visually locked -->
      <section class="card mt-6 p-6">
        <h2 class="text-title">CRA-required — same for everyone</h2>
        <p class="mt-1 text-sm text-gray-500">
          These rules keep reports compliant with the T661 form and CRA review
          practice. They can never be waived or overridden.
        </p>
        <ul class="mt-4 flex flex-col divide-y divide-gray-100">
          {#each LOCKED_RULES as rule (rule.title)}
            <li class="flex items-start gap-3 py-3">
              <LockSimpleIcon
                size={16}
                weight="bold"
                aria-hidden="true"
                class="mt-0.5 flex-none text-gray-400"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-700">{rule.title}</p>
                <p class="mt-0.5 text-xs text-gray-500">{rule.summary}</p>
              </div>
            </li>
          {/each}
        </ul>
      </section>

      <!-- House-style tier: governable per category -->
      <section class="mt-8">
        <!-- Stacked section header: heading, description, then metadata. -->
        <div>
          <h2 class="text-title">House style rules</h2>
          <p class="mt-1 max-w-3xl text-sm text-gray-500">
            Each category has one org-wide mode. <span class="font-medium text-gray-700">Writer's choice</span>
            — enforced by default, each consultant may let their own
            instructions override it; <span class="font-medium text-gray-700">Always enforced</span>
            — consultant overrides are ignored; <span class="font-medium text-gray-700">Off for everyone</span>
            — the rule is disabled org-wide.
          </p>
          {#if updatedDate(configQ.data?.updatedAt)}
            <p class="mt-1 text-xs text-gray-400">
              Last updated {updatedDate(configQ.data?.updatedAt)}
            </p>
          {/if}
        </div>

        {#if configQ.data === undefined}
          <div class="flex min-h-[20vh] items-center justify-center"><Spinner /></div>
        {:else}
          <div class="mt-4 flex flex-col gap-4">
            {#each STYLE_OVERRIDE_KEYS as key (key)}
              <!-- Stacked card: label → description → rule text → mode.
                   Everything reads top-to-bottom on one column. -->
              <div class="card p-5">
                <h3 class="text-sm font-semibold text-gray-800">
                  {STYLE_OVERRIDE_META[key].label}
                </h3>
                <p class="mt-1 max-w-2xl text-xs text-gray-500">
                  {STYLE_OVERRIDE_META[key].description}
                </p>
                <details class="group mt-3">
                  <summary class="cursor-pointer select-none text-xs font-medium text-gray-500 transition-colors hover:text-navy">
                    <span class="group-open:hidden">Show full rule text</span>
                    <span class="hidden group-open:inline">Hide full rule text</span>
                  </summary>
                  <pre class="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-gray-50 px-4 py-3 font-mono text-xs leading-relaxed text-gray-700">{HOUSE_RULE_TEXTS[key]}</pre>
                </details>
                <div class="mt-4 flex w-full max-w-xs flex-col gap-1.5">
                  <label for={`mode-${key}`} class="text-xs font-medium text-gray-700">Mode</label>
                  <SelectInput
                    id={`mode-${key}`}
                    value={modes[key]}
                    items={MODE_ITEMS}
                    openOnFocus={false}
                    class="w-full"
                    onValueChange={(next) => (modes[key] = next as HouseRuleMode)}
                  />
                </div>
              </div>
            {/each}
          </div>

          <div class="mt-4 flex items-center justify-end gap-3">
            {#if saved}
              <span role="status" class="rounded-full bg-primary-wash px-2.5 py-1 text-xs font-medium text-primary-dark">Saved</span>
            {/if}
            <button
              type="button"
              onclick={handleSave}
              disabled={saving || !dirty}
              class="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {#if saving}
                <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
              {/if}
              {saving ? "Saving…" : "Save modes"}
            </button>
          </div>
          {#if error}
            <p role="alert" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          {/if}
        {/if}
      </section>

      <!-- Banned words: read-only data from shared/bannedWords.ts -->
      <section class="card mt-8 p-6">
        <h2 class="text-title">Banned words &amp; phrases</h2>
        <p class="mt-1 text-sm text-gray-500">
          Applied whenever the banned-words rule is enforced: replacements are
          scrubbed automatically, deletions are removed outright, and scan-only
          terms are flagged for a human rewrite.
        </p>
        <p class="mt-1 text-xs text-gray-400">
          Term-level editing is a planned follow-up; today the list changes in
          code review.
        </p>

        <div class="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div>
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Replacements
            </h3>
            <table class="mt-2 w-full text-sm">
              <thead>
                <tr class="text-label border-b border-gray-100 text-left">
                  <th class="py-2 pr-4 font-medium">Term</th>
                  <th class="py-2 font-medium">Replacement</th>
                </tr>
              </thead>
              <tbody>
                {#each BANNED_REPLACEMENTS as [term, replacement] (term)}
                  <tr class="border-b border-gray-50 last:border-0">
                    <td class="py-1.5 pr-4 font-mono text-xs text-gray-700">{term}</td>
                    <td class="py-1.5 font-mono text-xs text-gray-500">{replacement}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <div class="flex flex-col gap-6">
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Deleted outright
              </h3>
              <p class="mt-1 text-xs text-gray-400">
                No meaning-preserving substitute — the word is removed and the
                sentence re-capitalized.
              </p>
              <ul class="mt-2 flex flex-wrap gap-1.5">
                {#each BANNED_DELETIONS as term (term)}
                  <li class="rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700">{term}</li>
                {/each}
              </ul>
            </div>
            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Scan-only
              </h3>
              <p class="mt-1 text-xs text-gray-400">
                Flagged by QA but never auto-fixed; these need a real rewrite.
              </p>
              <ul class="mt-2 flex flex-wrap gap-1.5">
                {#each SCAN_ONLY_TERMS as term (term)}
                  <li class="rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700">{term}</li>
                {/each}
              </ul>
            </div>
          </div>
        </div>
      </section>
    {/if}
  </AdminWorkspacePage>
{/if}
