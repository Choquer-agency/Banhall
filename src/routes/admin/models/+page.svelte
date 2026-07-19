<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { goto } from "$app/navigation";
  import { useQuery, useConvexClient } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../convex/_generated/api";
  import BuildStamp from "$lib/components/BuildStamp.svelte";

  type Stat = { model: string; label: string; count: number; pct: number };

  const auth = useAuth();
  const client = useConvexClient();

  const statsQ = useQuery(api.generations.modelStats, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const stats = $derived(statsQ.data);

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
      summaries[model] = "Couldn't generate the summary — try again.";
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
              {#if i === 0}<span class="mr-1">🏆</span>{/if}{r.label}
            </span>
            <span class="text-gray-500">
              {r.count} pick{r.count !== 1 ? "s" : ""} · {r.pct}%
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
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "Model preferences" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] px-6 pt-12 pb-10">
      <!-- Two stat cards read best at a compact width inside the shared shell. -->
      <div class="mx-auto w-full max-w-3xl">
      <h1 class="text-display">Model A/B preferences</h1>
      <p class="mt-1 text-sm text-gray-500">
        Which model consultants keep when shown side-by-side candidate drafts.
      </p>

      {#if stats === undefined}
        <div class="flex min-h-[55vh] items-center justify-center">
          <Spinner />
        </div>
      {:else if stats === null}
        <p class="mt-8 text-sm text-gray-400">Sign in to view model stats.</p>
      {:else}
        <!-- Recommendation banner -->
        <div class="mt-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4">
          <span class="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-dark">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </span>
          <div>
            <p class="text-sm font-semibold text-gray-900">Recommendation</p>
            <p class="text-sm text-gray-600">{stats.recommendation}</p>
          </div>
        </div>

        <div class="mt-8 grid gap-6 sm:grid-cols-2">
          <div class="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
              All writers ({stats.total})
            </h2>
            {@render statBars(stats.overall, "No selections logged yet.")}
          </div>
          <div class="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 class="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
              Your picks
            </h2>
            {@render statBars(stats.mine, "You haven't picked a draft yet.")}
          </div>
        </div>

        <!-- Jul 17: per-model score averages + writer feedback digest -->
        <div class="mt-8">
          <h2 class="text-title">Writer scores & feedback</h2>
          <p class="mt-1 text-sm text-gray-500">
            Average 1–10 score per model from the option-selection screen, with
            writers' one-line comments and an AI digest of the sentiment.
          </p>
          {#if stats.scoreStats.length === 0}
            <p class="mt-4 text-sm text-gray-400">No scores logged yet.</p>
          {:else}
            <div class="mt-4 flex flex-col gap-4">
              {#each stats.scoreStats as m (m.model)}
                <div class="rounded-2xl border border-gray-200 bg-white p-5">
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-baseline gap-3">
                      <span class="text-sm font-semibold text-gray-900">{m.label}</span>
                      <span class="text-xs text-gray-400">
                        {m.scoreCount} score{m.scoreCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {#if m.avgScore !== null}
                      <span class={`text-data text-lg font-semibold ${m.avgScore >= 7 ? "text-green-600" : m.avgScore >= 5 ? "text-amber-600" : "text-red-600"}`}>
                        {m.avgScore}<span class="text-xs font-normal text-gray-400"> /10 avg</span>
                      </span>
                    {/if}
                  </div>
                  {#if m.comments.length > 0}
                    <ul class="mt-3 flex flex-col gap-1.5">
                      {#each m.comments as c, i (i)}
                        <li class="text-sm text-gray-600">
                          <span class="text-data text-xs text-gray-400">{c.score}/10</span>
                          — “{c.comment}”
                        </li>
                      {/each}
                    </ul>
                    <div class="mt-3">
                      {#if summaries[m.model]}
                        <div class="rounded-lg bg-primary/5 px-3.5 py-2.5 text-sm text-gray-700">
                          <span class="mb-0.5 block text-xs font-semibold text-primary-dark">AI summary</span>
                          {summaries[m.model]}
                        </div>
                      {:else}
                        <button
                          type="button"
                          onclick={() => summarize(m.model)}
                          disabled={summarizing !== null}
                          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary-dark transition-colors hover:bg-primary-wash disabled:opacity-60"
                        >
                          {#if summarizing === m.model}
                            <span class="h-3 w-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary"></span>
                            Summarizing…
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
      </div>
    </main>
  </div>
{/if}
