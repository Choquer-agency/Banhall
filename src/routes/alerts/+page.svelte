<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../convex/_generated/api";
  import type { Doc } from "../../../convex/_generated/dataModel";
  import ReportRow from "$lib/components/errors/ReportRow.svelte";

  const auth = useAuth();

  let includeResolved = $state(false);
  let tab = $state<"all" | "bug" | "feature">("all");

  const reportsQ = useQuery(api.errorReports.listErrors, () =>
    auth.isAuthenticated ? { includeResolved } : "skip"
  );
  const reports = $derived(reportsQ.data);

  // BNH-38: split bugs (incl. auto-captured errors) from feature requests.
  const isFeature = (r: Doc<"errorReports">) => r.reportType === "feature";
  const filtered = $derived(
    (reports ?? []).filter((r) =>
      tab === "all" ? true : tab === "feature" ? isFeature(r) : !isFeature(r)
    )
  );
  const bugCount = $derived((reports ?? []).filter((r) => !isFeature(r)).length);
  const featureCount = $derived((reports ?? []).filter(isFeature).length);

  const TABS = [
    ["all", "All"],
    ["bug", "Bugs"],
    ["feature", "Feature requests"],
  ] as const;

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <!-- Floating dark brand bar (matches dashboard) -->
    <AppNav width="max-w-3xl" breadcrumbs={[{ label: "Alerts" }]} />

    <main class="mx-auto w-full max-w-3xl flex-1 px-6 pt-12 pb-8">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-display">Alerts &amp; requests</h2>
          <p class="mt-0.5 text-sm text-gray-400">
            Bugs (auto-captured + flagged) and feature requests. Expand a row and
            copy it straight into Claude Code.
          </p>
        </div>
        <label class="flex flex-shrink-0 items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            bind:checked={includeResolved}
            class="h-3.5 w-3.5 accent-primary"
          />
          Show resolved
        </label>
      </div>

      <!-- BNH-38: bug vs feature tabs -->
      <div class="mt-4 flex items-center gap-1">
        {#each TABS as [val, label] (val)}
          {@const count = val === "all" ? bugCount + featureCount : val === "bug" ? bugCount : featureCount}
          <button
            onclick={() => (tab = val)}
            class={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              tab === val ? "bg-navy text-white" : "text-gray-500 hover:bg-primary-wash hover:text-navy"
            }`}
          >
            {label}
            <span class={`ml-1.5 ${tab === val ? "text-primary-light" : "text-gray-400"}`}>
              {count}
            </span>
          </button>
        {/each}
      </div>

      <div class="mt-6 space-y-2">
        {#if reports === undefined}
          <div class="flex min-h-[55vh] items-center justify-center">
            <Spinner />
          </div>
        {:else if filtered.length === 0}
          <div class="mt-16 text-center">
            <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-chrome">
              <svg
                class="h-6 w-6 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <p class="font-medium text-navy">No alerts.</p>
            <p class="mt-1 text-sm text-gray-400">
              {includeResolved
                ? "Nothing reported yet."
                : "No open reports. Everything's clear."}
            </p>
          </div>
        {:else}
          {#each filtered as r (r._id)}
            <ReportRow report={r} />
          {/each}
        {/if}
      </div>
    </main>
  </div>
{/if}
