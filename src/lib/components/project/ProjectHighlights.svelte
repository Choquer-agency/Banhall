<!--
  Project Highlights band (2026-08-13, Attio-research P1 record-page pass).
  A hairline stat band above the attribute rows: Stage (+ time in stage),
  Owner, With (the current handoff), Claim period. Every tile is honest —
  absent facts render as quiet "No X" empties, never invented values.

  Subscriptions: `getProjectWorkflowHeader` dedupes with the workflow menu's
  standing subscription; `getProjectWorkPanel` is one bounded (≤51 rows)
  per-project query, promoted from menu-open-only to the page so the band's
  "With" tile stays live. Domain truth: Owner ≠ current handoff ≠ Creator
  (product-domain vocabulary); the band displays, never mutates.
-->
<script lang="ts">
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { formatDue } from "$lib/workflow/due";
  import { WORK_ITEM_KIND_LABELS } from "../../../../shared/workItems";

  let {
    projectId,
    fiscalYearEnd = null,
  }: { projectId: Id<"projects">; fiscalYearEnd?: number | null } = $props();

  const auth = useAuth();
  let now = $state(Date.now());
  const headerQ = useQuery(api.projectWorkflow.getProjectWorkflowHeader, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );
  const workPanelQ = useQuery(api.workItems.getProjectWorkPanel, () =>
    auth.isAuthenticated ? { projectId } : "skip"
  );

  const header = $derived(headerQ.data);
  const currentHandoff = $derived.by(() => {
    const panel = workPanelQ.data;
    if (!panel?.currentHandoffId) return null;
    return panel.openItems.find((item) => item.workItemId === panel.currentHandoffId) ?? null;
  });
  const handoffDue = $derived(currentHandoff ? formatDue(currentHandoff.dueAt, now) : null);

  function timeInStage(at: number | null): string | null {
    if (at === null) return null;
    const days = Math.floor((now - at) / 86_400_000);
    if (days <= 0) return "entered today";
    return `${days} day${days === 1 ? "" : "s"} in stage`;
  }

  function claimPeriod(fiscalYearEnd: number | null | undefined): string | null {
    if (fiscalYearEnd == null) return null;
    return new Date(fiscalYearEnd).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

</script>

{#if header}
  <div
    data-project-highlights
    class="grid grid-cols-2 border-y border-line-soft lg:grid-cols-4 lg:divide-x lg:divide-line-soft"
  >
    <div class="min-w-0 px-1 py-3 lg:px-4 lg:first:pl-1">
      <p class="text-label">Stage</p>
      <div class="mt-1.5 flex min-w-0 items-center gap-2">
        <StageBadge stage={header.workflowStage} />
      </div>
      {#if timeInStage(header.workflowUpdatedAt)}
        <p class="mt-1 truncate text-xs text-ink-muted">{timeInStage(header.workflowUpdatedAt)}</p>
      {/if}
    </div>
    <div class="min-w-0 px-1 py-3 lg:px-4">
      <p class="text-label">Owner</p>
      {#if header.owner}
        <div class="mt-1.5 flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fir text-[9px] font-medium text-white"
          >{header.owner.initials}</span>
          <span class="truncate text-sm font-medium text-ink">{header.owner.label}</span>
        </div>
        {#if header.ownerNeedsReview}
          <p class="mt-1 truncate text-xs text-ink-muted">Ownership under review</p>
        {/if}
      {:else}
        <p class="mt-1.5 text-sm text-ink-faint">No owner recorded</p>
      {/if}
    </div>
    <div class="min-w-0 px-1 py-3 lg:px-4">
      <p class="text-label">With</p>
      {#if currentHandoff}
        <p class="mt-1.5 truncate text-sm font-medium text-ink">{currentHandoff.assignee.label}</p>
        <p class="mt-1 truncate text-xs text-ink-muted" title={handoffDue?.absolute}>
          {WORK_ITEM_KIND_LABELS[currentHandoff.kind] ?? currentHandoff.kind}{#if handoffDue}{" · "}<span class={handoffDue.overdue ? "font-medium text-red-700" : ""}>{handoffDue.relative}</span>{/if}
        </p>
      {:else}
        <p class="mt-1.5 text-sm text-ink-faint">Nothing in flight</p>
      {/if}
    </div>
    <div class="min-w-0 px-1 py-3 lg:px-4">
      <p class="text-label">Claim period</p>
      {#if claimPeriod(fiscalYearEnd)}
        <p class="mt-1.5 text-sm font-medium text-ink">FYE {claimPeriod(fiscalYearEnd)}</p>
      {:else}
        <p class="mt-1.5 text-sm text-ink-faint">No fiscal year-end</p>
      {/if}
    </div>
  </div>
{/if}
