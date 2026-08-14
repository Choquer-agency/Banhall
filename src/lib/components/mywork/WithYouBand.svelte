<!--
  "With you" Home band (2026-08-13, Attio-research P1; dated design-system
  + product-domain presentation amendment of the same date). ONE bounded
  due-ordered subscription — the existing `myWork.listAssignedToMe`
  projection (open work items where assignee = viewer) — rendered as quiet
  hairline rows under the Home composer. Deliberately NOT an activity feed
  and NOT report snippets (both remain recorded rejections); when nothing is
  with the viewer the band renders nothing at all, keeping Home quiet.
  "Show more" pages the same subscription in place — no invented "view all"
  destination exists for this queue on the preview cohort.
-->
<script lang="ts">
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { usePaginatedQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { formatDue } from "$lib/workflow/due";
  import { WORK_ITEM_KIND_LABELS } from "../../../../shared/workItems";
  import { setProjectPagingContext } from "$lib/workspace/projectPagingContext";

  const PAGE = 5;

  const auth = useAuth();
  let now = $state(Date.now());
  const assignedQ = usePaginatedQuery(
    api.myWork.listAssignedToMe,
    () => (auth.isAuthenticated ? {} : "skip"),
    { initialNumItems: PAGE }
  );
  const rows = $derived(assignedQ.results);
  const hasMore = $derived(
    assignedQ.status === "CanLoadMore" || assignedQ.status === "LoadingMore"
  );

  function stashContext() {
    setProjectPagingContext({
      ids: rows.map((row) => row.projectId),
      label: "With you",
      bounded: hasMore,
    });
  }
</script>

<svelte:window onfocus={() => (now = Date.now())} />

{#if rows.length > 0}
  <section
    data-home-with-you
    aria-label="Work with you"
    class="mt-10 px-4 sm:mt-12 sm:px-6"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2.5">
      <div class="flex items-baseline gap-2">
        <h2 class="text-base font-medium text-ink">With you</h2>
        <span class="text-data text-ink-muted">{rows.length}{hasMore ? "+" : ""}</span>
      </div>
    </div>
    <ul role="list" aria-label="Open work items assigned to you, due first" class="divide-y divide-line-soft">
      {#each rows as row (row.workItemId)}
        {@const due = formatDue(row.dueAt, now)}
        <li>
          <a
            href={resolve("/project/[id]", { id: row.projectId })}
            data-recent-title={row.projectTitle}
            data-recent-stage={row.workflowStage}
            data-recent-client={row.clientName || undefined}
            onclick={stashContext}
            class="group grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-2 transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
          >
            <span class="truncate text-sm font-medium text-ink transition-colors group-hover:text-primary-selected motion-reduce:transition-none">
              {row.projectTitle}
            </span>
            {#if due}
              <span title={due.absolute} class={`justify-self-end text-xs ${due.overdue ? "font-medium text-red-700" : "text-ink-muted"}`}>{due.relative}</span>
            {:else}
              <span class="justify-self-end text-xs text-ink-faint">No due date</span>
            {/if}
            <span class="col-start-1 flex min-w-0 items-center gap-2 text-xs text-ink-muted">
              <StageBadge stage={row.workflowStage} dot />
              <span class="truncate">
                {WORK_ITEM_KIND_LABELS[row.kind] ?? row.kind}{row.clientName ? ` · ${row.clientName}` : ""}
              </span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
    {#if hasMore}
      <button
        type="button"
        disabled={assignedQ.status === "LoadingMore"}
        onclick={() => assignedQ.loadMore(PAGE)}
        class="mt-1 inline-flex min-h-11 items-center px-2 text-xs font-medium text-ink-muted opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none"
      >
        {assignedQ.status === "LoadingMore" ? "Loading…" : "Show more"}
      </button>
    {/if}
  </section>
{/if}
