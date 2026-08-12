<script lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import { WORK_ITEM_KIND_LABELS, type WorkItemKind } from "../../../../shared/workItems";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import ProjectActivityList from "./ProjectActivityList.svelte";
  import type { ActivityEntry } from "$lib/workflow/activityPresentation";
  import { formatDue } from "$lib/workflow/due";

  type Owner = { label: string; initials: string };
  type PanelState = "loading" | "ready" | "error" | "denied";
  export type WorkItemSummary = {
    workItemId: Id<"workItems">;
    kind: WorkItemKind;
    blocking: boolean;
    isCurrentHandoff: boolean;
    dueAt: number | null;
    instructionsPreview: string;
    version: number;
    assignee: { userId: Id<"users">; label: string; initials: string };
    viewerCanManage: boolean;
  };

  let {
    // Aliased locally: a binding literally named `state` would shadow the
    // `$state` rune this component needs for the minute-refresh clock.
    state: panelState,
    stage = null,
    stageIsFallback = false,
    owner = null,
    ownerNeedsReview = false,
    errorMessage = null,
    canChangeStage = false,
    canTransferOwner = false,
    onRetry,
    onChangeStage,
    onTransferOwner,
    workItems = [],
    workTruncated = false,
    canCreateWork = false,
    canSendForReview = false,
    assignable = true,
    assignableReason = null,
    pointerHealthy = true,
    workLoading = false,
    workError = null,
    onAssignWork,
    onSendForReview,
    onReassignWork,
    onCancelWork,
    activityOpen = false,
    onToggleActivity,
    activityState = "loading",
    activityEntries = [],
    activityTruncated = false,
    titleId,
  }: {
    state: PanelState;
    stage?: WorkflowStage | null;
    stageIsFallback?: boolean;
    owner?: Owner | null;
    ownerNeedsReview?: boolean;
    errorMessage?: string | null;
    canChangeStage?: boolean;
    canTransferOwner?: boolean;
    onRetry?: () => void;
    onChangeStage?: () => void;
    onTransferOwner?: () => void;
    workItems?: WorkItemSummary[];
    workTruncated?: boolean;
    canCreateWork?: boolean;
    canSendForReview?: boolean;
    assignable?: boolean;
    assignableReason?: string | null;
    pointerHealthy?: boolean;
    workLoading?: boolean;
    workError?: string | null;
    onAssignWork?: () => void;
    onSendForReview?: () => void;
    onReassignWork?: (item: WorkItemSummary) => void;
    onCancelWork?: (item: WorkItemSummary) => void;
    /** Activity disclosure — owned by the parent so the bounded read-only
     * activity query subscribes only while the section is actually open. */
    activityOpen?: boolean;
    onToggleActivity?: () => void;
    activityState?: "loading" | "ready" | "error" | "denied";
    activityEntries?: ActivityEntry[];
    activityTruncated?: boolean;
    titleId: string;
  } = $props();

  // Relative due copy refreshes each minute while the panel is mounted so a
  // popover left open across midnight or a long review never shows a stale
  // "Due today". The panel only exists while the Workflow popover is open,
  // so the interval is scoped to that lifetime.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 60_000);
    return () => clearInterval(timer);
  });

  const currentHandoff = $derived(workItems.find((item) => item.isCurrentHandoff) ?? null);
  const handoffDue = $derived(currentHandoff ? formatDue(currentHandoff.dueAt, now) : null);
  const stageLabel = $derived(
    stageIsFallback ? "Legacy status only" : stage ? WORKFLOW_STAGE_LABELS[stage] : "Not assigned"
  );
</script>

<header class="border-b border-line-soft pb-3">
  <h2 id={titleId} class="text-title">Workflow details</h2>
  <p class="mt-1 text-sm leading-relaxed text-ink-secondary">
    Project accountability and human production stage.
  </p>
</header>

{#if panelState === "loading"}
  <div class="space-y-5 py-5" aria-busy="true">
    <span class="sr-only" role="status">Loading workflow details…</span>
    {#each ["stage", "owner"] as item (item)}
      <div>
        <div class="h-3 w-14 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
        <div class="mt-2 h-5 w-36 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
      </div>
    {/each}
  </div>
{:else if panelState === "error"}
  <div class="py-5">
    <p class="text-sm leading-relaxed text-red-700" role="alert">
      {errorMessage ?? "Workflow details are temporarily unavailable."}
    </p>
    {#if onRetry}
      <button
        type="button"
        class="mt-4 min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-navy transition-colors hover:border-primary-selected hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
        onclick={onRetry}
      >
        Try again
      </button>
    {/if}
  </div>
{:else if panelState === "denied"}
  <p class="py-5 text-sm leading-relaxed text-ink-secondary">
    Workflow details are not available for this project.
  </p>
{:else}
  <dl class="divide-y divide-line-soft">
    <div class="py-4">
      <dt class="text-label text-ink-secondary">Stage</dt>
      <dd class="mt-1.5">
        {#if !stageIsFallback && stage}
          <StageBadge {stage} dot />
        {:else}
          <span class="text-sm font-semibold text-ink">{stageLabel}</span>
        {/if}
      </dd>
      {#if stageIsFallback}
        <p class="mt-1 text-xs leading-relaxed text-ink-secondary">
          This project has no stored workflow stage. Available transitions begin from Intake.
        </p>
      {/if}
    </div>

    <div class="py-4">
      <dt class="text-label text-ink-secondary">Owner</dt>
      <dd class="mt-2 flex min-w-0 items-center gap-2.5">
        {#if owner}
          <span aria-hidden="true" class="flex size-8 shrink-0 items-center justify-center rounded-full bg-chrome text-xs font-semibold text-navy">
            {owner.initials}
          </span>
          <span class="min-w-0 break-words text-sm font-semibold text-ink">{owner.label}</span>
        {:else}
          <span class="text-sm font-semibold text-ink">Not assigned</span>
        {/if}
      </dd>
    </div>

    <div class="py-4">
      <dt class="text-label text-ink-secondary">With</dt>
      <dd class="mt-2 flex min-w-0 items-center gap-2.5">
        {#if workLoading}<span class="text-sm text-ink-muted" role="status">Loading handoff…</span>{:else if workError}<span class="text-sm text-red-700">Unavailable</span>{:else if currentHandoff}
          <span aria-hidden="true" class="flex size-8 shrink-0 items-center justify-center rounded-full bg-chrome text-xs font-semibold text-navy">{currentHandoff.assignee.initials}</span>
          <span class="min-w-0"><span class="block break-words text-sm font-semibold text-ink">{currentHandoff.assignee.label}</span><span class="block text-xs text-ink-muted">{WORK_ITEM_KIND_LABELS[currentHandoff.kind]}</span></span>
        {:else}<span class="text-sm font-semibold text-ink">No current handoff</span>{/if}
      </dd>
    </div>

    <div class="py-4">
      <dt class="text-label text-ink-secondary">Due</dt>
      <dd class="mt-1.5 text-sm text-ink">{#if workLoading}<span class="text-ink-muted">Loading…</span>{:else if workError}<span class="text-red-700">Unavailable</span>{:else if handoffDue}<span class="text-data">{handoffDue.absolute}</span><span class="ml-2 text-ink-muted">{handoffDue.relative}</span>{:else}<span class="font-semibold">Not set</span>{/if}</dd>
    </div>
  </dl>

  {#if workError}<p class="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">{workError}</p>{:else if !pointerHealthy}<p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950" role="status">This project's handoff records disagree. Ask an administrator to repair them before assigning blocking work.</p>{/if}

  {#if workItems.length > 0}
    <section class="mt-4 border-t border-line-soft pt-4" aria-labelledby={`${titleId}-open-work`}>
      <h3 id={`${titleId}-open-work`} class="text-label">Open work ({workItems.length}{workTruncated ? "+" : ""})</h3>
      {#if workTruncated}<p class="mt-1 text-xs text-ink-muted">Showing the first 50 open items plus the current handoff.</p>{/if}
      <div class="mt-2 divide-y divide-line-soft">
        {#each workItems as item (item.workItemId)}
          <div class="py-3"><div class="flex items-start gap-3"><span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-chrome text-xs font-semibold text-navy">{item.assignee.initials}</span><div class="min-w-0 flex-1"><p class="text-sm font-semibold text-ink">{item.assignee.label} · {WORK_ITEM_KIND_LABELS[item.kind]}</p><p class="mt-0.5 line-clamp-2 text-xs leading-5 text-ink-muted">{item.instructionsPreview}</p>{#if item.dueAt}{@const due = formatDue(item.dueAt, now)}{#if due}<p class="mt-1 text-xs text-ink-muted"><span class="text-data">{due.absolute}</span> · {due.relative}</p>{/if}{/if}</div></div>{#if item.viewerCanManage}<div class="mt-2 flex gap-2 pl-11"><button type="button" class="min-h-11 rounded-lg px-3 text-sm font-semibold text-navy hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy" onclick={() => onReassignWork?.(item)}>Reassign</button><button type="button" class="min-h-11 rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy" onclick={() => onCancelWork?.(item)}>Cancel</button></div>{/if}</div>
        {/each}
      </div>
    </section>
  {/if}

  {#if onToggleActivity}
    <section class="mt-4 border-t border-line-soft pt-1" aria-labelledby={`${titleId}-activity`}>
      <h3 id={`${titleId}-activity`} class="m-0">
        <button
          type="button"
          data-activity-disclosure
          aria-expanded={activityOpen}
          aria-controls={`${titleId}-activity-region`}
          onclick={onToggleActivity}
          class="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
        >
          <span class="text-label">Activity</span>
          <svg
            aria-hidden="true"
            class={`ml-auto size-4 shrink-0 transition-transform motion-reduce:transition-none ${activityOpen ? "rotate-180 text-primary" : "text-ink-faint"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </h3>
      {#if activityOpen}
        <div id={`${titleId}-activity-region`}>
          <ProjectActivityList
            state={activityState}
            entries={activityEntries}
            truncated={activityTruncated}
            labelledBy={`${titleId}-activity`}
          />
        </div>
      {/if}
    </section>
  {/if}

  {#if ownerNeedsReview}
    <p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900" role="status">
      Ownership was assigned by fallback during migration and still needs administrator review.
    </p>
  {/if}

  <div class="mt-4 grid gap-2 border-t border-line-soft pt-4">
    {#if !workLoading && !workError && canSendForReview && onSendForReview}
      <!-- AA on the white plane: lagoon `primary` under white text measures
           < 4.5:1, so the primary action uses `primary-selected`
           (design-system "AA pairs on white"). -->
      <button type="button" disabled={!assignable || !pointerHealthy} class="min-h-11 rounded-lg bg-primary-selected px-4 text-left text-sm font-semibold text-white transition-colors hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none" onclick={onSendForReview}>Send for internal review</button>
    {/if}
    {#if !workLoading && !workError && canCreateWork && onAssignWork}
      <button type="button" disabled={!assignable || !pointerHealthy} class="min-h-11 rounded-lg border border-line px-4 text-left text-sm font-semibold text-navy hover:border-primary-selected hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50" onclick={onAssignWork}>Assign work</button>
    {/if}
    {#if !assignable && assignableReason}<p class="text-xs leading-relaxed text-ink-secondary">{assignableReason}</p>{/if}
    {#if canChangeStage || canTransferOwner}
      {#if canChangeStage && onChangeStage}
        <button
          type="button"
          class="min-h-11 rounded-lg border border-line px-4 text-left text-sm font-semibold text-navy transition-colors hover:border-primary-selected hover:bg-primary-wash hover:text-primary-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
          onclick={onChangeStage}
        >
          Change stage
        </button>
      {/if}
      {#if canTransferOwner && onTransferOwner}
        <button
          type="button"
          class="min-h-11 rounded-lg border border-line px-4 text-left text-sm font-semibold text-navy transition-colors hover:border-primary-selected hover:bg-primary-wash hover:text-primary-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
          onclick={onTransferOwner}
        >
          Transfer ownership
        </button>
      {/if}
    {:else if !canCreateWork}
      <p class="text-xs leading-relaxed text-ink-secondary">You do not have permission to assign work or change workflow on this project.</p>
    {/if}
  </div>
{/if}
