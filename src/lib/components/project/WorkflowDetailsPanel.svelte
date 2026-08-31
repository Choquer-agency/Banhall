<script lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import { WORK_ITEM_KIND_LABELS, type WorkItemKind } from "../../../../shared/workItems";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { ArrowRightIcon, CaretDownIcon } from "phosphor-svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import ProjectActivityList from "./ProjectActivityList.svelte";
  import type { ActivityEntry } from "$lib/workflow/activityPresentation";
  import { formatDue } from "$lib/workflow/due";

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
    state: panelState,
    stage = null,
    stageIsFallback = false,
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
    activityOpen?: boolean;
    onToggleActivity?: () => void;
    activityState?: "loading" | "ready" | "error" | "denied";
    activityEntries?: ActivityEntry[];
    activityTruncated?: boolean;
    titleId: string;
  } = $props();

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 60_000);
    return () => clearInterval(timer);
  });

  const stageLabel = $derived(
    stageIsFallback ? "Legacy status only" : stage ? WORKFLOW_STAGE_LABELS[stage] : "Not assigned"
  );
  const hasActions = $derived(canSendForReview || canCreateWork || canTransferOwner);
</script>

<header class="flex min-h-9 items-center border-b border-line-soft pb-3">
  <h2 id={titleId} class="text-sm font-semibold text-ink">Workflow</h2>
</header>

{#if panelState === "loading"}
  <div class="space-y-3 py-4" aria-busy="true">
    <span class="sr-only" role="status">Loading workflow…</span>
    <div class="h-14 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none"></div>
    <div class="h-11 animate-pulse rounded-lg bg-gray-100 motion-reduce:animate-none"></div>
  </div>
{:else if panelState === "error"}
  <div class="py-5">
    <p class="text-sm leading-relaxed text-red-700" role="alert">
      {errorMessage ?? "Workflow is temporarily unavailable."}
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
    Workflow controls are not available for this project.
  </p>
{:else}
  <section class="pt-3" aria-label="Project status">
    {#if canChangeStage && onChangeStage}
      <button
        type="button"
        data-workflow-stage-action
        class="group flex min-h-14 w-full items-center gap-3 rounded-lg border border-line bg-white px-3 text-left transition-colors hover:border-primary-selected hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
        onclick={onChangeStage}
      >
        <span class="min-w-0 flex-1">
          <span class="block text-label text-ink-muted">Status</span>
          <span class="mt-1 block">
            {#if !stageIsFallback && stage}
              <StageBadge {stage} dot />
            {:else}
              <span class="text-sm font-semibold text-ink">{stageLabel}</span>
            {/if}
          </span>
        </span>
        <span class="text-xs font-semibold text-primary-selected">Change</span>
        <ArrowRightIcon size={16} weight="regular" aria-hidden="true" class="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </button>
    {:else}
      <div class="flex min-h-14 items-center rounded-lg bg-gray-50 px-3">
        <span>
          <span class="block text-label text-ink-muted">Status</span>
          <span class="mt-1 block">
            {#if !stageIsFallback && stage}
              <StageBadge {stage} dot />
            {:else}
              <span class="text-sm font-semibold text-ink">{stageLabel}</span>
            {/if}
          </span>
        </span>
      </div>
    {/if}
    {#if stageIsFallback}
      <p class="mt-2 text-xs leading-5 text-ink-secondary">
        This project has no stored workflow stage. Changes begin from Intake.
      </p>
    {/if}
  </section>

  {#if workError}
    <p class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">{workError}</p>
  {:else if !pointerHealthy}
    <p class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950" role="status">This project's handoff records disagree. Ask an administrator to repair them before assigning blocking work.</p>
  {/if}

  {#if !workLoading && !workError && hasActions}
    <section class="mt-4 border-t border-line-soft pt-4" aria-labelledby={`${titleId}-actions`}>
      <h3 id={`${titleId}-actions`} class="text-label">Actions</h3>
      <div class="mt-2 grid gap-2">
        {#if canSendForReview && onSendForReview}
          <button type="button" disabled={!assignable || !pointerHealthy} class="min-h-11 rounded-lg bg-primary-selected px-3 text-left text-sm font-semibold text-white transition-colors hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none" onclick={onSendForReview}>Send for internal review</button>
        {/if}
        <div class={`grid gap-2 ${canCreateWork && canTransferOwner ? "grid-cols-2" : "grid-cols-1"}`}>
          {#if canCreateWork && onAssignWork}
            <button type="button" disabled={!assignable || !pointerHealthy} class="min-h-11 rounded-lg border border-line px-3 text-left text-sm font-semibold text-navy transition-colors hover:border-primary-selected hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none" onclick={onAssignWork}>Assign work</button>
          {/if}
          {#if canTransferOwner && onTransferOwner}
            <button type="button" class="min-h-11 rounded-lg border border-line px-3 text-left text-sm font-semibold text-navy transition-colors hover:border-primary-selected hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none" onclick={onTransferOwner}>Transfer owner</button>
          {/if}
        </div>
      </div>
      {#if !assignable && assignableReason}
        <p class="mt-2 text-xs leading-5 text-ink-secondary">{assignableReason}</p>
      {/if}
    </section>
  {/if}

  <section class="mt-4 border-t border-line-soft pt-4" aria-labelledby={`${titleId}-open-work`}>
    <div class="flex items-center justify-between gap-3">
      <h3 id={`${titleId}-open-work`} class="text-label">Open work</h3>
      {#if !workLoading && !workError}
        <span class="text-data text-ink-muted">{workItems.length}{workTruncated ? "+" : ""}</span>
      {/if}
    </div>
    {#if workLoading}
      <p class="mt-3 text-sm text-ink-muted" role="status">Loading open work…</p>
    {:else if workError}
      <p class="mt-3 text-sm text-red-700">Open work is unavailable.</p>
    {:else if workItems.length > 0}
      {#if workTruncated}
        <p class="mt-1 text-xs text-ink-muted">Showing the first 50 items plus the current handoff.</p>
      {/if}
      <div class="mt-2 divide-y divide-line-soft overflow-hidden rounded-lg border border-line-soft">
        {#each workItems as item (item.workItemId)}
          <div class="p-3">
            <div class="flex items-start gap-2.5">
              <span aria-hidden="true" class="flex size-7 shrink-0 items-center justify-center rounded-full bg-chrome text-xs font-semibold text-navy">{item.assignee.initials}</span>
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <p class="truncate text-sm font-semibold text-ink">{item.assignee.label}</p>
                  {#if item.isCurrentHandoff}
                    <span class="rounded bg-primary-wash px-1.5 py-0.5 text-xs font-semibold text-primary-selected">Current handoff</span>
                  {/if}
                </div>
                <p class="mt-0.5 text-xs text-ink-secondary">{WORK_ITEM_KIND_LABELS[item.kind]}</p>
                {#if item.instructionsPreview}
                  <p class="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{item.instructionsPreview}</p>
                {/if}
                {#if item.dueAt}
                  {@const due = formatDue(item.dueAt, now)}
                  {#if due}
                    <p class="mt-1 text-xs text-ink-muted"><span class="text-data">{due.absolute}</span> · {due.relative}</p>
                  {/if}
                {/if}
              </div>
            </div>
            {#if item.viewerCanManage}
              <div class="mt-2 flex gap-1 pl-9">
                <button type="button" class="min-h-11 rounded-lg px-2.5 text-xs font-semibold text-navy hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy" onclick={() => onReassignWork?.(item)}>Reassign</button>
                <button type="button" class="min-h-11 rounded-lg px-2.5 text-xs font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy" onclick={() => onCancelWork?.(item)}>Cancel</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <p class="mt-2 text-sm text-ink-muted">No open work.</p>
    {/if}
  </section>

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
          <CaretDownIcon size={16} weight="regular" aria-hidden="true" class={`ml-auto shrink-0 transition-transform motion-reduce:transition-none ${activityOpen ? "rotate-180 text-primary" : "text-ink-faint"}`} />
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
    <p class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900" role="status">
      Ownership was assigned by fallback during migration and still needs administrator review.
    </p>
  {/if}
{/if}
