<script lang="ts">
  import AdminWorkspacePage from "$lib/components/admin/AdminWorkspacePage.svelte";
  import { resolve } from "$app/paths";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation, useConvexClient } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import ModelCatalogPanel from "$lib/components/admin/ModelCatalogPanel.svelte";
  import { pickerModels, defaultModelIdFor } from "$lib/modelPicker";
  import type { CostCapInput, ModelAdminRole } from "$lib/modelCatalogAdmin";
  import { userErrorMessage } from "$lib/errors";
  import {
    adminStateRef,
    requestCatalogRefreshRef,
    rollbackRoleRef,
    setAutoSwitchRef,
    setEvalBudgetRef,
    setRoleCostCapRef,
  } from "../../../../convex/lib/modelCatalogRefs";

  type Stat = { model: string; label: string; count: number; pct: number };

  const auth = useAuth();
  const client = useConvexClient();

  const statsQ = useQuery(api.generations.modelStats, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const capabilitiesQ = useQuery(api.providerReadiness.getCapabilities, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto(resolve("/login"), { replaceState: true });
    }
  });

  const stats = $derived(statsQ.data);

  // The writing role's model (model catalog): used when a writer doesn't
  // pick one. Choosing here is logged as a manual switch.
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  const setDefaultModel = useMutation(api.appSettings.setDefaultModel);
  let savingDefault = $state(false);
  const defaultModel = $derived(defaultModelIdFor(capabilitiesQ.data));
  const selectableModels = $derived(pickerModels(capabilitiesQ.data));

  // Model catalog (owner decision 21): admin state and actions.
  const catalogQ = useQuery(adminStateRef, () => (auth.isAuthenticated ? {} : "skip"));
  const setAutoSwitch = useMutation(setAutoSwitchRef);
  const rollbackRole = useMutation(rollbackRoleRef);
  const setRoleCostCap = useMutation(setRoleCostCapRef);
  const setEvalBudget = useMutation(setEvalBudgetRef);
  const requestRefresh = useMutation(requestCatalogRefreshRef);
  let catalogBusy = $state<string | null>(null);
  let catalogError = $state<string | null>(null);

  async function runCatalogAction(key: string, action: () => Promise<unknown>) {
    if (catalogBusy) return;
    catalogBusy = key;
    catalogError = null;
    try {
      await action();
    } catch (error) {
      catalogError = userErrorMessage(error, "That change did not save. Try again.");
    } finally {
      catalogBusy = null;
    }
  }

  async function handleDefaultChange(modelId: string) {
    if (savingDefault || modelId === defaultModel) return;
    savingDefault = true;
    try {
      await setDefaultModel({ modelId });
    } finally {
      savingDefault = false;
    }
  }

  // Jul 17: on-demand AI digest of writer comments per model.
  let summaries = $state<Record<string, string>>({});
  let summarizing = $state<string | null>(null);

  async function summarize(model: string) {
    if (summarizing) return;
    summarizing = model;
    try {
      summaries[model] = await client.action(
        api.ai.modelFeedback.summarizeModelFeedback,
        { model }
      );
    } catch {
      summaries[model] = "Couldn't write the summary. Try again.";
    } finally {
      summarizing = null;
    }
  }
</script>

{#snippet statBars(rows: Stat[], empty: string)}
  {#if rows.length === 0}
    <p class="text-sm text-gray-400">{empty}</p>
  {:else}
    <div class="space-y-3">
      {#each rows as r, i (r.model)}
        <div>
          <div class="mb-1 flex items-center justify-between text-sm">
            <span class="font-medium text-gray-800">
              {r.label}{#if i === 0}<span class="ml-1 text-xs font-normal text-gray-500">(most picked)</span>{/if}
            </span>
            <span class="text-gray-500">
              {r.count} pick{r.count !== 1 ? "s" : ""}, {r.pct}%
            </span>
          </div>
          <div class="h-2.5 w-full overflow-hidden rounded-full bg-chrome">
            <div
              class={`h-full rounded-full ${i === 0 ? "bg-primary" : "bg-navy/40"}`}
              style="width: {r.pct}%"
            ></div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <AdminWorkspacePage
    title="Models"
    description="Which models the app runs, how they switch, and which drafts consultants prefer."
    width="compact"
  >
      {#if catalogError}
        <p class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{catalogError}</p>
      {/if}
      {#if catalogQ.data}
        <ModelCatalogPanel
          admin={catalogQ.data}
          busy={catalogBusy}
          onToggleAutoSwitch={(enabled: boolean) =>
            runCatalogAction("autoSwitch", () => setAutoSwitch({ enabled }))}
          onRollback={(role: ModelAdminRole["role"]) =>
            runCatalogAction(`rollback:${role}`, () => rollbackRole({ role }))}
          onSaveCap={(role: ModelAdminRole["role"], cap: CostCapInput) =>
            runCatalogAction(`cap:${role}`, () => setRoleCostCap({ role, ...cap }))}
          onSaveBudget={(monthlyUsd: number) =>
            runCatalogAction("budget", () => setEvalBudget({ monthlyUsd }))}
          onRefresh={() => runCatalogAction("refresh", () => requestRefresh({}))}
        />
      {/if}

      {#if stats === undefined}
        <div class="flex min-h-[55vh] items-center justify-center">
          <Spinner />
        </div>
      {:else if stats === null}
        <p class="mt-8 text-sm text-gray-400">Sign in to view model stats.</p>
      {:else}
        <!-- Default generation model (admin-set; writers get it when they don't pick) -->
        <div class="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-5 py-4">
          <div>
            <p class="text-sm font-medium text-gray-900">Default model</p>
            <p class="text-sm text-gray-600">
              The writing role's model, used whenever a writer doesn't pick one. Choosing here is logged as a manual switch.
            </p>
          </div>
          <span class="flex items-center gap-2">
            {#if savingDefault}
              <span class="text-xs text-gray-400">Saving...</span>
            {/if}
            <SelectInput
              size="sm"
              value={defaultModel}
              items={selectableModels.map((m) => ({
                value: m.id,
                label: m.available ? m.label : `${m.label} (needs OpenRouter key)`,
              }))}
              disabled={savingDefault}
              class="w-56"
              onValueChange={handleDefaultChange}
            />
          </span>
        </div>

        <!-- Recommendation banner -->
        <div class="mt-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4">
          <span class="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-dark">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          <div>
            <p class="text-sm font-medium text-gray-900">Recommendation</p>
            <p class="text-sm text-gray-600">{stats.recommendation}</p>
          </div>
        </div>

        <div class="mt-8 grid gap-6 sm:grid-cols-2">
          <div class="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 class="text-label mb-4">
              All writers ({stats.total})
            </h2>
            {@render statBars(stats.overall, "No selections logged yet.")}
          </div>
          <div class="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 class="text-label mb-4">
              Your picks
            </h2>
            {@render statBars(stats.mine, "You haven't picked a draft yet.")}
          </div>
        </div>

        <!-- Jul 17: per-model score averages + writer feedback digest -->
        <div class="mt-8">
          <h2 class="text-sm font-medium text-gray-900">Writer scores and feedback</h2>
          <p class="mt-1 text-sm text-gray-500">
            Average 1 to 10 score per model from the option-selection screen, with
            writers' one-line comments and an AI summary of the sentiment.
          </p>
          {#if stats.scoreStats.length === 0}
            <p class="mt-4 text-sm text-gray-400">No scores logged yet.</p>
          {:else}
            <div class="mt-4 flex flex-col gap-4">
              {#each stats.scoreStats as m (m.model)}
                <div class="rounded-2xl border border-gray-200 bg-white p-5">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-baseline gap-3">
                      <span class="text-sm font-medium text-gray-900">{m.label}</span>
                      <span class="text-xs text-gray-400">
                        {m.scoreCount} score{m.scoreCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {#if m.avgScore !== null}
                      <span class={`text-data text-lg font-medium ${m.avgScore >= 7 ? "text-green-600" : m.avgScore >= 5 ? "text-amber-600" : "text-red-600"}`}>
                        {m.avgScore}<span class="text-xs font-normal text-gray-400"> /10 avg</span>
                      </span>
                    {/if}
                  </div>
                  {#if m.comments.length > 0}
                    <ul class="mt-3 flex flex-col gap-1.5">
                      {#each m.comments as c, i (i)}
                        <li class="text-sm text-gray-600">
                          <span class="text-data text-xs text-gray-400">{c.score}/10</span>
                          “{c.comment}”
                        </li>
                      {/each}
                    </ul>
                    <div class="mt-3">
                      {#if summaries[m.model]}
                        <div class="rounded-lg bg-primary/5 px-3.5 py-2.5 text-sm text-gray-700">
                          <span class="mb-0.5 block text-xs font-medium text-primary-dark">AI summary</span>
                          {summaries[m.model]}
                        </div>
                      {:else}
                        <button
                          type="button"
                          onclick={() => summarize(m.model)}
                          disabled={summarizing !== null}
                          class="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-primary-dark transition-colors hover:bg-primary-wash disabled:opacity-60"
                        >
                          {#if summarizing === m.model}
                            <span class="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary"></span>
                            Summarizing...
                          {:else}
                            Summarize feedback with AI
                          {/if}
                        </button>
                      {/if}
                    </div>
                  {:else}
                    <p class="mt-2 text-xs text-gray-400">No written comments yet.</p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
  </AdminWorkspacePage>
{/if}
