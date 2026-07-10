<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { Tabs } from "bits-ui";
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useStableQuery } from "$lib/stableQuery.svelte";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { api } from "../../../../convex/_generated/api";
  import BuildStamp from "$lib/components/BuildStamp.svelte";
  import SourceRow from "$lib/components/admin/SourceRow.svelte";
  import FeedbackRow from "$lib/components/admin/FeedbackRow.svelte";

  type Tab = "pending" | "approved" | "revoked" | "feedback" | "audit";

  const ACTION_LABEL: Record<string, string> = {
    ingest: "Imported",
    approve: "Approved",
    reject: "Rejected",
    revoke: "Revoked (unlearned)",
    reweight: "Reweighted",
    revert: "Reverted",
  };

  const auth = useAuth();

  let tab = $state<Tab>("pending");
  // Bumped after any mutation so `hasEntry` re-reads promptly (queries are
  // reactive anyway — kept for parity with the React page).
  let rev = $state(0);
  const onChanged = () => rev++;

  const statsQ = useQuery(api.brain.brainStats, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  // Stable across tab switches so pending→approved doesn't flash a spinner.
  const sourcesQ = useStableQuery(api.brain.listBrainSources, () =>
    auth.isAuthenticated &&
    (tab === "pending" || tab === "approved" || tab === "revoked")
      ? { status: tab }
      : "skip"
  );
  const feedbackQ = useQuery(api.brain.listFeedbackQueue, () =>
    auth.isAuthenticated && tab === "feedback" ? {} : "skip"
  );
  const auditQ = useQuery(api.brain.listBrainAudit, () =>
    auth.isAuthenticated && tab === "audit" ? {} : "skip"
  );

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const stats = $derived(statsQ.data);
  const sources = $derived(sourcesQ.data);
  const feedback = $derived(feedbackQ.data);
  const audit = $derived(auditQ.data);

  const tabs: { key: Tab; label: string; count?: number }[] = $derived([
    { key: "pending", label: "Queue", count: stats?.pending },
    { key: "approved", label: "In the Brain", count: stats?.approved },
    { key: "revoked", label: "Revoked" },
    { key: "feedback", label: "Writer feedback" },
    { key: "audit", label: "Audit log" },
  ]);
</script>

{#snippet spinner()}
  <div class="flex min-h-[55vh] items-center justify-center">
    <Spinner />
  </div>
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav breadcrumbs={[{ label: "The Brain" }]} />
    <PageBar backHref="/dashboard" backLabel="Back" />

    <main class="mx-auto w-full max-w-[var(--container-shell)] px-6 pt-12 pb-10">
      <h1 class="text-display">The Brain</h1>
      <p class="mt-1 text-sm text-gray-500">
        Curated knowledge behind generation. Only approved sources are ever
        retrievable — approving ingests, revoking unlearns, and every change is
        audited.
      </p>

      {#if stats === null}
        <p class="mt-8 text-sm text-gray-400">Admin access only.</p>
      {:else}
        <!-- Stats -->
        <div class="mt-6 grid grid-cols-3 gap-3">
          <div class="card p-4">
            <p class="text-label">In the Brain</p>
            <p class="mt-1 text-2xl font-bold text-navy">{stats?.approved ?? "—"}</p>
          </div>
          <div class="card p-4">
            <p class="text-label">Pending review</p>
            <p class="mt-1 text-2xl font-bold text-navy">{stats?.pending ?? "—"}</p>
          </div>
          <div class="card p-4">
            <p class="text-label">Industries</p>
            <p class="mt-1 truncate text-sm font-medium text-gray-700">
              {stats && Object.keys(stats.byIndustry).length > 0
                ? Object.entries(stats.byIndustry)
                    .map(([k, n]) => `${k} (${n})`)
                    .join(", ")
                : "—"}
            </p>
          </div>
        </div>

        <!-- Tabs -->
        <Tabs.Root value={tab} onValueChange={(v) => (tab = v as Tab)} class="mt-6">
          <Tabs.List class="card flex gap-1 p-1">
            {#each tabs as t (t.key)}
              <Tabs.Trigger
                value={t.key}
                class={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "bg-navy text-white"
                    : "text-gray-500 hover:bg-primary-wash hover:text-gray-700"
                }`}
              >
                {t.label}{t.count != null && t.count > 0 ? ` · ${t.count}` : ""}
              </Tabs.Trigger>
            {/each}
          </Tabs.List>
        </Tabs.Root>

        <!-- Panel -->
        <div class="card mt-4 overflow-hidden">
          {#if tab === "pending" || tab === "approved" || tab === "revoked"}
            {#if sources === undefined}
              {@render spinner()}
            {:else if !sources || sources.length === 0}
              <p class="px-4 py-8 text-center text-sm text-gray-400">
                {tab === "pending"
                  ? "Queue is empty — imports land here for review."
                  : tab === "approved"
                    ? "Nothing in the Brain yet. Seed the curated PDs to get started."
                    : "Nothing revoked."}
              </p>
            {:else}
              {#each sources as r (r._id)}
                <SourceRow row={r} {onChanged} />
              {/each}
            {/if}
          {:else if tab === "feedback"}
            {#if feedback === undefined}
              {@render spinner()}
            {:else if !feedback || feedback.length === 0}
              <p class="px-4 py-8 text-center text-sm text-gray-400">
                No pending writer feedback.
              </p>
            {:else}
              {#each feedback as fb (fb._id)}
                <FeedbackRow {fb} />
              {/each}
            {/if}
          {:else if audit === undefined}
            {@render spinner()}
          {:else if !audit || audit.length === 0}
            <p class="px-4 py-8 text-center text-sm text-gray-400">
              No activity yet.
            </p>
          {:else}
            <table class="w-full text-sm">
              <thead>
                <tr class="text-label border-b border-gray-100 text-left">
                  <th class="px-4 py-2.5 font-medium">Action</th>
                  <th class="px-4 py-2.5 font-medium">Reason</th>
                  <th class="px-4 py-2.5 font-medium">Actor</th>
                  <th class="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {#each audit as a (a._id)}
                  <tr class="border-b border-gray-50 last:border-0">
                    <td class="px-4 py-2.5 font-medium text-gray-800">
                      {ACTION_LABEL[a.action] ?? a.action}
                    </td>
                    <td class="px-4 py-2.5 text-gray-600">{a.reason ?? "—"}</td>
                    <td class="px-4 py-2.5 text-gray-500">
                      {a.actorId.startsWith("cli:") ? a.actorId : "admin"}
                    </td>
                    <td class="whitespace-nowrap px-4 py-2.5 text-gray-500">
                      {new Date(a.at).toLocaleString()}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    </main>
  </div>
{/if}
