<script lang="ts">
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import PageBar from "$lib/components/ui/PageBar.svelte";
  import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { goto } from "$app/navigation";
  import { useQuery, useMutation } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../convex/_generated/api";

  const auth = useAuth();
  const requestsQ = useQuery(api.errorReports.listFeatureRequests, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const toggleUpvote = useMutation(api.errorReports.toggleUpvote);

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  // Most-upvoted first, then newest.
  const requests = $derived(
    [...(requestsQ.data ?? [])].sort(
      (a, b) => b.upvotes - a.upvotes || b.createdAt - a.createdAt
    )
  );

  function fmtDate(ms: number): string {
    return new Date(ms).toLocaleDateString("en-CA", { dateStyle: "medium" });
  }
</script>

{#snippet requestsContent(showHeading: boolean)}
    <main class={`w-full flex-1 ${showHeading ? "mx-auto max-w-[var(--container-shell)] px-6 pt-12" : "px-4 pt-6 sm:px-6"} pb-10`}>
      <div class={`w-full ${showHeading ? "mx-auto max-w-3xl" : ""}`}>
        {#if showHeading}
          <h1 class="text-display">Feature requests</h1>
          <p class="mt-1 text-sm text-ink-muted">
            Every writer's suggestions, in one place. +1 an idea instead of
            re-submitting it — submit new ones with the flag button on any page.
          </p>
        {/if}

        {#if requestsQ.data === undefined}
          <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
        {:else if requests.length === 0}
          <p class="mt-10 text-sm text-ink-faint">
            No feature requests yet — use the flag button on any page to submit one.
          </p>
        {:else}
          <div class="mt-8 flex flex-col gap-3">
            {#each requests as r (r._id)}
              <div class="card flex items-start gap-4 p-4">
                <button
                  type="button"
                  onclick={() => toggleUpvote({ id: r._id })}
                  aria-pressed={r.upvotedByMe}
                  title={r.upvotedByMe ? "Remove your +1" : "+1 this request"}
                  class={`flex w-11 flex-none flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 transition-colors ${
                    r.upvotedByMe
                      ? "border-primary bg-primary/10 text-primary-dark"
                      : "border-line text-ink-faint hover:border-primary/40 hover:text-primary-dark"
                  }`}
                >
                  <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                  <span class="text-data text-sm font-semibold">{r.upvotes}</span>
                </button>
                <div class="min-w-0 flex-1">
                  <p class="text-sm leading-relaxed text-ink-secondary">{r.note}</p>
                  <p class="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
                    <span>{r.mine ? "You" : r.submittedBy}</span>
                    <span>·</span>
                    <time>{fmtDate(r.createdAt)}</time>
                    {#if r.status === "resolved"}
                      <span class="rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">Shipped</span>
                    {/if}
                  </p>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </main>
{/snippet}

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <WorkspaceGate currentWhileLoading={false}>
    {#snippet current()}
      <div class="flex flex-1 flex-col bg-canvas">
        <AppNav breadcrumbs={[{ label: "Feature requests" }]} />
        <PageBar backHref="/dashboard" backLabel="Back" />
        {@render requestsContent(true)}
      </div>
    {/snippet}
    {#snippet preview()}
      <WorkspaceChrome title="Feature requests" description="Shared product suggestions and priorities">
        {#snippet children()}
          {@render requestsContent(false)}
        {/snippet}
      </WorkspaceChrome>
    {/snippet}
  </WorkspaceGate>
{/if}
