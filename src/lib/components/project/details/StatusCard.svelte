<!--
  Details status card (ui-design-final.md section 8, board 5.1y row D, V1):
  one line "[stage] with [avatar] Name" when a current handoff exists, the
  stage alone otherwise (never the Owner, never a placeholder). Change stage
  opens the grouped stage menu; a plain move applies at once, a move that
  needs a reason or a review decision turns the card into an inline step.
  Hand off opens the panel's Hand off view.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import { ArrowRightIcon } from "phosphor-svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { MAX_WORKFLOW_NOTE_CHARS } from "../../../../../shared/workflowLabels";
  import type { WorkflowStage } from "../../../../../shared/workflowStages";
  import PersonAvatar from "./PersonAvatar.svelte";
  import StageMenu from "./StageMenu.svelte";
  import { confirmLabel, reasonPrompt, stageMenuGroups, type StageMenuOption } from "./stageMenu";
  import type { DetailsPanelData } from "./types";

  let {
    data,
    changeStageReason = null,
    handOffReason = null,
    onChangeStage,
    onOpenHandOff,
  }: {
    data: DetailsPanelData;
    /** Why Change stage is unavailable; shown when the viewer lacks authority. */
    changeStageReason?: string | null;
    /** Why Hand off is unavailable. */
    handOffReason?: string | null;
    /** Applies a stage move; rejects with a user-facing Error. */
    onChangeStage: (stage: WorkflowStage, note?: string) => Promise<void>;
    onOpenHandOff: () => void;
  } = $props();

  let menuOpen = $state(false);
  let step = $state<StageMenuOption | null>(null);
  let note = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  const groups = $derived(stageMenuGroups(data.stage, data.viewerAuthorities));
  const canChange = $derived(data.permissions.canChangeStage);
  const canHandOff = $derived(data.permissions.canHandOff);
  const handoff = $derived(data.currentHandoff);
  const noteTooLong = $derived(note.length > MAX_WORKFLOW_NOTE_CHARS);
  const confirmDisabled = $derived(
    busy || noteTooLong || (step?.move === "reason" && note.trim().length === 0)
  );
  const disabledNote = $derived(
    !canChange && !canHandOff
      ? (changeStageReason ?? handOffReason)
      : !canChange
        ? changeStageReason
        : !canHandOff
          ? handOffReason
          : null
  );

  async function apply(stage: WorkflowStage, withNote?: string) {
    busy = true;
    error = null;
    try {
      await onChangeStage(stage, withNote);
      step = null;
      note = "";
    } catch (cause) {
      error = cause instanceof Error && cause.message ? cause.message : "The stage could not be changed.";
    } finally {
      busy = false;
    }
  }

  function pick(option: StageMenuOption) {
    menuOpen = false;
    if (option.current || option.disabledReason) return;
    error = null;
    if (option.move === "plain") {
      void apply(option.stage);
    } else {
      note = "";
      step = option;
    }
  }
</script>

<section
  data-details-status
  aria-label="Status"
  class="rounded-xl border border-line-soft bg-canvas p-[14px]"
>
  {#if step}
    <div data-stage-step={step.move} class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-1.5">
        <StageBadge stage={data.stage} dot />
        <ArrowRightIcon size={12} aria-hidden="true" class="text-ink-muted" />
        <StageBadge stage={step.stage} dot />
      </div>
      {#if step.move === "reason"}
        <label class="mt-1 text-[13px] text-ink" for="details-stage-reason">{reasonPrompt(data.stage, step.stage)}</label>
        <textarea
          id="details-stage-reason"
          bind:value={note}
          rows="3"
          class="field-control w-full resize-none rounded-lg px-3 py-2 text-[13px] text-ink"
        ></textarea>
        <p class="text-xs text-ink-muted">Saved with the stage change so the team can see it later.</p>
        {#if noteTooLong}
          <p class="text-xs text-red-700" role="alert">Keep the reason under {MAX_WORKFLOW_NOTE_CHARS} characters.</p>
        {/if}
      {:else}
        <p class="mt-1 text-[13px] leading-5 text-ink">
          This records your review decision with the move.
        </p>
      {/if}
      {#if error}
        <p class="text-xs text-red-700" role="alert">{error}</p>
      {/if}
      <div class="mt-1 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="xs" class="h-9" disabled={busy} onclick={() => { step = null; error = null; }}>Cancel</Button>
        <Button size="xs" class="h-9" disabled={confirmDisabled} onclick={() => step && apply(step.stage, step.move === "reason" ? note.trim() : undefined)}>
          {confirmLabel(step.stage, step.move)}
        </Button>
      </div>
    </div>
  {:else}
    <p data-details-status-line class="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <StageBadge stage={data.stage} dot />
      {#if handoff}
        <span class="text-ink-muted">with</span>
        <span class="flex min-w-0 items-center gap-1.5 text-ink">
          <PersonAvatar initials={handoff.initials} seed={String(handoff.assigneeId)} isYou={handoff.isYou} />
          <span class="truncate">{handoff.assigneeLabel}{handoff.isYou ? " (you)" : ""}</span>
        </span>
      {/if}
    </p>
    {#if handoff?.note}
      <p data-details-handoff-note class="mt-2 border-l-2 border-line pl-2.5 text-[13px] leading-5 text-ink-secondary">{handoff.note}</p>
    {/if}
    {#if error}
      <p class="mt-2 text-xs text-red-700" role="alert">{error}</p>
    {/if}
    <div class="mt-3 grid grid-cols-2 gap-2">
      <Popover.Root bind:open={menuOpen}>
        <Popover.Trigger disabled={!canChange || busy}>
          {#snippet child({ props })}
            <Button {...props} variant="secondary" size="xs" class="h-9 w-full" data-details-change-stage>
              Change stage
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            class="z-[120] max-h-[min(30rem,calc(100dvh-6rem))] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-line bg-surface px-1 shadow-lg outline-none"
          >
            <StageMenu {groups} onPick={pick} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Button variant="secondary" size="xs" class="h-9 w-full gap-1.5" disabled={!canHandOff || busy} onclick={onOpenHandOff} data-details-hand-off>
        <ArrowRightIcon size={14} aria-hidden="true" />
        Hand off
      </Button>
    </div>
    {#if disabledNote}
      <p class="mt-2 text-xs text-ink-muted">{disabledNote}</p>
    {/if}
  {/if}
</section>
