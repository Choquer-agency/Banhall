<script lang="ts">
  import type { WorkflowStage } from "../../../../shared/workflowStages";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";

  type Owner = { label: string; initials: string };
  type PanelState = "loading" | "ready" | "error" | "denied";

  let {
    state,
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
    titleId: string;
  } = $props();

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

{#if state === "loading"}
  <div class="space-y-5 py-5" aria-busy="true">
    <span class="sr-only" role="status">Loading workflow details…</span>
    {#each ["stage", "owner"] as item (item)}
      <div>
        <div class="h-3 w-14 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
        <div class="mt-2 h-5 w-36 animate-pulse rounded bg-gray-100 motion-reduce:animate-none"></div>
      </div>
    {/each}
  </div>
{:else if state === "error"}
  <div class="py-5">
    <p class="text-sm leading-relaxed text-red-700" role="alert">
      {errorMessage ?? "Workflow details are temporarily unavailable."}
    </p>
    {#if onRetry}
      <button
        type="button"
        class="mt-4 min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-navy transition-colors hover:border-primary-selected hover:bg-primary-wash motion-reduce:transition-none"
        onclick={onRetry}
      >
        Try again
      </button>
    {/if}
  </div>
{:else if state === "denied"}
  <p class="py-5 text-sm leading-relaxed text-ink-secondary">
    Workflow details are not available for this project.
  </p>
{:else}
  <dl class="divide-y divide-line-soft">
    <div class="py-4">
      <dt class="text-label text-ink-secondary">Stage</dt>
      <dd class="mt-1.5 text-sm font-semibold text-ink">{stageLabel}</dd>
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
  </dl>

  {#if ownerNeedsReview}
    <p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900" role="status">
      Ownership was assigned by fallback during migration and still needs administrator review.
    </p>
  {/if}

  {#if canChangeStage || canTransferOwner}
    <div class="mt-4 grid gap-2 border-t border-line-soft pt-4">
      {#if canChangeStage && onChangeStage}
        <button
          type="button"
          class="min-h-11 rounded-lg border border-line px-4 text-left text-sm font-semibold text-navy transition-colors hover:border-primary-selected hover:bg-primary-wash hover:text-primary-selected motion-reduce:transition-none"
          onclick={onChangeStage}
        >
          Change stage
        </button>
      {/if}
      {#if canTransferOwner && onTransferOwner}
        <button
          type="button"
          class="min-h-11 rounded-lg border border-line px-4 text-left text-sm font-semibold text-navy transition-colors hover:border-primary-selected hover:bg-primary-wash hover:text-primary-selected motion-reduce:transition-none"
          onclick={onTransferOwner}
        >
          Transfer ownership
        </button>
      {/if}
    </div>
  {:else}
    <p class="mt-4 border-t border-line-soft pt-4 text-xs leading-relaxed text-ink-secondary">
      You do not have permission to change stage or ownership on this project.
    </p>
  {/if}
{/if}
