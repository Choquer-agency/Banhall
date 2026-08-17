<!--
  Project workflow summary (2026-08-16 redesign, second pass). This is an
  integrated masthead line, not another card inside the report header. Stage,
  Owner, current handoff, and claim period reflow from the pane's own width.
  Every value stays honest: absent facts render as explicit empty states,
  never invented values.

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
  <section
    data-project-highlights
    aria-label="Project workflow summary"
    class="project-highlights border-t border-line-soft pt-3"
  >
    <dl class="highlights-layout">
      <div data-project-highlight="stage" class="highlight-stage min-w-0">
        <dt class="sr-only">Stage</dt>
        <dd class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <StageBadge stage={header.workflowStage} shape="square" />
          {#if timeInStage(header.workflowUpdatedAt)}
            <span class="truncate text-xs text-ink-muted">
              {timeInStage(header.workflowUpdatedAt)}
            </span>
          {/if}
        </dd>
      </div>

      <div data-project-highlight="owner" class="highlight-owner min-w-0">
        <dt class="text-[0.6875rem] font-medium leading-none text-ink-muted">Owner</dt>
        {#if header.owner}
          <dd class="mt-1 flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              class="flex size-5 shrink-0 items-center justify-center rounded-full bg-fir text-[8px] font-semibold text-white"
            >{header.owner.initials}</span>
            <div class="min-w-0">
              <p class="truncate text-[0.8125rem] font-medium leading-5 text-ink">{header.owner.label}</p>
              {#if header.ownerNeedsReview}
                <p class="truncate text-[0.6875rem] text-ink-muted">Ownership under review</p>
              {/if}
            </div>
          </dd>
        {:else}
          <dd class="mt-1 text-[0.8125rem] leading-5 text-ink-faint">No owner recorded</dd>
        {/if}
      </div>

      <div data-project-highlight="handoff" class="highlight-handoff min-w-0">
        <dt class="text-[0.6875rem] font-medium leading-none text-ink-muted">With</dt>
        {#if currentHandoff}
          <dd class="mt-1 min-w-0">
            <p class="truncate text-[0.8125rem] font-medium leading-5 text-ink">{currentHandoff.assignee.label}</p>
            <p class="truncate text-[0.6875rem] text-ink-muted" title={handoffDue?.absolute}>
              {WORK_ITEM_KIND_LABELS[currentHandoff.kind] ?? currentHandoff.kind}{#if handoffDue}{" · "}<span class={handoffDue.overdue ? "font-medium text-red-700" : ""}>{handoffDue.relative}</span>{/if}
            </p>
          </dd>
        {:else}
          <dd class="mt-1 text-[0.8125rem] leading-5 text-ink-faint">Nothing in flight</dd>
        {/if}
      </div>

      <div data-project-highlight="claim-period" class="highlight-claim min-w-0">
        <dt class="text-[0.6875rem] font-medium leading-none text-ink-muted">Claim period</dt>
        {#if claimPeriod(fiscalYearEnd)}
          <dd class="mt-1 text-[0.8125rem] font-medium leading-5 text-ink">FYE {claimPeriod(fiscalYearEnd)}</dd>
        {:else}
          <dd class="mt-1 text-[0.8125rem] leading-5 text-ink-faint">No fiscal year-end</dd>
        {/if}
      </div>
    </dl>
  </section>
{/if}

<style>
  .project-highlights {
    container-type: inline-size;
  }

  .highlights-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.625rem 1.5rem;
  }

  @container (min-width: 28rem) {
    .highlights-layout {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .highlight-stage {
      grid-column: 1 / -1;
    }

    .highlight-claim {
      grid-column: 1 / -1;
    }
  }

  @container (min-width: 44rem) {
    .highlights-layout {
      grid-template-columns: auto minmax(9rem, 1fr) minmax(9rem, 1fr) auto;
      align-items: center;
      column-gap: 1.75rem;
    }

    .highlight-stage {
      grid-column: 1;
      padding-right: 1.75rem;
      border-right: 1px solid var(--color-line-soft);
    }

    .highlight-claim {
      grid-column: 4;
    }
  }
</style>
