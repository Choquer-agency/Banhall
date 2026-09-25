<!--
  Details panel (ui-design-final.md section 8, boards 5.1 and 5.1y): a 400px
  right panel that shares the side slot with the Assistant and QA. No project
  title or client; the page already shows both. Status card, facts, then a
  quiet "More" disclosure the host fills (SR&ED title, tags, project type,
  other work items, transfer owner, activity). Hand off switches the panel to
  its own view with a back arrow. Successful moves and handoffs confirm inline
  at the bottom of the panel (board 5.1y B3 and C3) through a polite live
  region, then the confirmation fades on its own.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { CaretLeftIcon, CheckIcon, XIcon } from "phosphor-svelte";
  import { motionDuration } from "$lib/motion";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import { WORKFLOW_STAGE_LABELS } from "../../../../../shared/workflowLabels";
  import type { WorkflowStage } from "../../../../../shared/workflowStages";
  import StatusCard from "./StatusCard.svelte";
  import DetailsFacts from "./DetailsFacts.svelte";
  import HandOffView from "./HandOffView.svelte";
  import type { DetailsFieldSavers, DetailsPanelData, HandOffInput, TeamMember } from "./types";

  let {
    data,
    error = null,
    view = $bindable("details"),
    handOffStage = null,
    team = [],
    teamLoading = false,
    teamError = null,
    changeStageReason = null,
    handOffReason = null,
    canCreateIndustry = false,
    onChangeStage,
    onHandOff,
    onClose,
    more,
    ...savers
  }: {
    /** `undefined` while loading, `null` when the viewer cannot see details. */
    data: DetailsPanelData | null | undefined;
    error?: string | null;
    view?: "details" | "handoff";
    /** Stage preselected when the Hand off view opens (Send for review uses Internal review). */
    handOffStage?: WorkflowStage | null;
    team?: TeamMember[];
    teamLoading?: boolean;
    teamError?: string | null;
    changeStageReason?: string | null;
    handOffReason?: string | null;
    canCreateIndustry?: boolean;
    onChangeStage: (stage: WorkflowStage, note?: string) => Promise<void>;
    onHandOff: (input: HandOffInput) => Promise<void>;
    onClose: () => void;
    /** Body of the quiet More disclosure. */
    more?: Snippet;
  } & DetailsFieldSavers = $props();

  const componentId = $props.id();
  const moreId = `${componentId}-more`;
  let moreOpen = $state(false);
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  // Inline confirmation (board 5.1y B3 and C3): shown for a few seconds, a
  // newer one replaces it. Errors keep their inline paths in the card and view.
  const CONFIRMATION_MS = 4000;
  let confirmation = $state<{ id: number; text: string } | null>(null);
  let confirmationCount = 0;

  function confirm(text: string) {
    confirmationCount += 1;
    confirmation = { id: confirmationCount, text };
  }

  $effect(() => {
    const shown = confirmation;
    if (!shown) return;
    const timer = setTimeout(() => {
      if (confirmation?.id === shown.id) confirmation = null;
    }, CONFIRMATION_MS);
    return () => clearTimeout(timer);
  });

  async function changeStage(stage: WorkflowStage, note?: string) {
    await onChangeStage(stage, note);
    now = Date.now();
    confirm(`Moved to ${WORKFLOW_STAGE_LABELS[stage]}`);
  }

  async function handOff(input: HandOffInput) {
    await onHandOff(input);
    now = Date.now();
    view = "details";
    confirm(`Handed off to ${input.assigneeLabel}`);
  }

  // A project number edit is saved before the panel closes or switches to
  // Hand off. On failure the panel stays, with the error and the field in
  // focus, so a failed save is never lost behind a closed panel.
  let facts = $state<{ commitPendingEdits: () => Promise<boolean> } | undefined>();
  let leaving = false;

  /**
   * For the host's toolbar toggles (i, Assistant, QA), which switch the side
   * panel without this panel's own buttons: finish a pending edit first. False
   * means the save failed and the panel should stay open with its error.
   */
  export async function requestClose(): Promise<boolean> {
    return facts ? await facts.commitPendingEdits() : true;
  }

  async function leaveDetails(next: () => void) {
    if (leaving) return;
    leaving = true;
    try {
      if (facts && !(await facts.commitPendingEdits())) return;
      next();
    } finally {
      leaving = false;
    }
  }

  const iconButton =
    "flex size-[26px] shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir";
</script>

<section data-details-panel aria-labelledby={`${componentId}-title`} class="relative flex h-full min-h-0 flex-col bg-surface">
  <header class="mt-5 flex h-7 shrink-0 items-center gap-2 px-6">
    {#if view === "handoff"}
      <button
        type="button"
        aria-label="Back to details"
        onclick={() => (view = "details")}
        class={iconButton}
      >
        <CaretLeftIcon size={16} aria-hidden="true" />
      </button>
      <h2 id={`${componentId}-title`} class="text-[13px] font-medium leading-[18px] text-ink">Hand off</h2>
    {:else}
      <h2 id={`${componentId}-title`} class="text-[13px] font-medium leading-[18px] text-ink">Details</h2>
    {/if}
    <button
      type="button"
      aria-label="Close details"
      onclick={() => void leaveDetails(onClose)}
      class={`ml-auto ${iconButton}`}
    >
      <XIcon size={14} aria-hidden="true" />
    </button>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-[18px]">
    {#if error}
      <p class="rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] text-red-700" role="alert">{error}</p>
    {:else if data === undefined}
      <div class="space-y-3" aria-busy="true">
        <span class="sr-only" role="status">Loading details</span>
        <div class="skeleton-shimmer h-24 rounded-xl"></div>
        <div class="skeleton-shimmer h-40 rounded-xl"></div>
      </div>
    {:else if data === null}
      <p class="text-[13px] text-ink-secondary">Details are not available for this project.</p>
    {:else if view === "handoff"}
      <HandOffView
        currentStage={data.stage}
        {team}
        {teamLoading}
        {teamError}
        initialStage={handOffStage}
        viewerAuthorities={data.viewerAuthorities}
        onCancel={() => (view = "details")}
        onSubmit={handOff}
      />
    {:else}
      <StatusCard
        {data}
        {changeStageReason}
        {handOffReason}
        onChangeStage={changeStage}
        onOpenHandOff={() => void leaveDetails(() => (view = "handoff"))}
      />
      <div class="mt-[18px]">
        <DetailsFacts bind:this={facts} {data} {now} {canCreateIndustry} {...savers} />
      </div>
      {#if more}
        <div class="mt-2.5">
          <div aria-hidden="true" class="mx-2 mb-1 h-px bg-line-soft"></div>
          <button
            type="button"
            data-details-more-toggle
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onclick={() => (moreOpen = !moreOpen)}
            class="flex min-h-[34px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir"
          >
            More
            <DisclosureChevron open={moreOpen} tone="neutral" class="ml-auto size-3.5" />
          </button>
          <Disclosure id={moreId} open={moreOpen}>
            <div data-details-more class="pb-2 pt-1">
              {@render more()}
            </div>
          </Disclosure>
        </div>
      {/if}
    {/if}
  </div>

  <!-- The live region stays mounted so screen readers hear each new message. -->
  <div
    role="status"
    aria-live="polite"
    data-details-confirmation-region
    class="pointer-events-none absolute inset-x-6 bottom-5 z-10"
  >
    <!-- A one-item keyed list with local transitions: the fade plays when the
         message changes or times out, never when the panel itself unmounts
         (a global outro would hold the whole panel on screen while the side
         slot switches to Assistant or QA). The shadow is board 5.1y B3's own:
         shadow-popover is heavier and shows a hard edge where the panel clips
         it 20px below. -->
    {#each confirmation ? [confirmation] : [] as shown (shown.id)}
      <p
        data-details-confirmation
        in:fly={{ y: 4, duration: motionDuration(200) }}
        out:fade={{ duration: motionDuration(300) }}
        class="absolute inset-x-0 bottom-0 flex h-10 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 text-[13px] leading-[18px] text-ink shadow-[0_8px_24px_#16211F1A]"
      >
        <CheckIcon size={14} weight="bold" aria-hidden="true" class="shrink-0 text-primary-selected" />
        <span class="min-w-0 truncate">{shown.text}</span>
      </p>
    {/each}
  </div>
</section>
