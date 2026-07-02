<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../convex/_generated/api";
  import BuildStamp from "$lib/components/BuildStamp.svelte";

  type Stat = { model: string; label: string; count: number; pct: number };

  const auth = useAuth();

  const statsQ = useQuery(api.generations.modelStats, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const stats = $derived(statsQ.data);
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

    <main class="mx-auto w-full max-w-3xl px-6 pt-12 pb-10">
      <h1 class="text-display">Model A/B preferences</h1>
      <p class="mt-1 text-sm text-gray-500">
        Which model writers keep when shown side-by-side candidate drafts.
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
          <span class="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary-dark">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
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
      {/if}
    </main>
  </div>
{/if}
