<!--
  Details panel (ui-design-final.md section 8, boards 5.1 and 5.1y): a 400px
  right panel that shares the side slot with the Assistant and QA. No project
  title or client; the page already shows both. Status card, facts, then a
  quiet "More" disclosure the host fills (SR&ED title, tags, project type,
  other work items, transfer owner, activity). Hand off switches the panel to
  its own view with a back arrow. Successful moves and handoffs confirm with
  a bottom toast.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { ArrowLeftIcon, XIcon } from "phosphor-svelte";
  import { toast } from "svelte-sonner";
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

  async function changeStage(stage: WorkflowStage, note?: string) {
    await onChangeStage(stage, note);
    now = Date.now();
    toast.success(`Moved to ${WORKFLOW_STAGE_LABELS[stage]}`, { position: "bottom-right" });
  }

  async function handOff(input: HandOffInput) {
    await onHandOff(input);
    now = Date.now();
    view = "details";
    toast.success(`Handed off to ${input.assigneeLabel}`, { position: "bottom-right" });
  }
</script>

<section data-details-panel aria-labelledby={`${componentId}-title`} class="flex h-full min-h-0 flex-col bg-surface">
  <header class="flex h-12 shrink-0 items-center gap-2 px-5">
    {#if view === "handoff"}
      <button
        type="button"
        aria-label="Back to details"
        onclick={() => (view = "details")}
        class="-ml-1.5 flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
      >
        <ArrowLeftIcon size={15} aria-hidden="true" />
      </button>
      <h2 id={`${componentId}-title`} class="text-sm font-medium text-ink">Hand off</h2>
    {:else}
      <h2 id={`${componentId}-title`} class="text-sm font-medium text-ink">Details</h2>
    {/if}
    <button
      type="button"
      aria-label="Close details"
      onclick={onClose}
      class="ml-auto flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-gray-50 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir"
    >
      <XIcon size={15} aria-hidden="true" />
    </button>
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
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
        onOpenHandOff={() => (view = "handoff")}
      />
      <div class="mt-5">
        <DetailsFacts {data} {now} {canCreateIndustry} {...savers} />
      </div>
      {#if more}
        <div class="mt-4 border-t border-line-soft pt-1">
          <button
            type="button"
            data-details-more-toggle
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onclick={() => (moreOpen = !moreOpen)}
            class="flex min-h-9 w-full items-center gap-2 rounded-md px-1 text-left text-[13px] text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fir"
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
</section>
