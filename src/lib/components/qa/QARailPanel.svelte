<script lang="ts">
  import QAScorePanel from "$lib/components/editor/QAScorePanel.svelte";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import type { Snippet } from "svelte";

  /**
   * The QA review rail card (BNH-47) — ONE component for every screen that
   * shows QA: the report workspace rail and the option-selection rail.
   * Mirrors the assistant's rise/sink motion (.chat-rise in layout.css) and
   * stays mounted so state survives close/reopen.
   */
  let {
    open,
    onClose,
    hidden = false,
    title = "QA review",
    agentOutputs = null,
    reportContent = null,
    reportId = undefined,
    rawQa = null,
    candidateId = undefined,
    modelName = null,
    onLocateGap = undefined,
    footer = undefined,
  }: {
    open: boolean;
    onClose: () => void;
    /** display:none while another panel owns the rail (instant swap). */
    hidden?: boolean;
    title?: string;
    agentOutputs?: string | null;
    reportContent?: string | null;
    reportId?: Id<"reports">;
    rawQa?: unknown;
    candidateId?: Id<"reportCandidates">;
    modelName?: string | null;
    onLocateGap?: (gap: { section: string; paragraph: number | null }) => void;
    /** Pinned below the scorecard scroll area (e.g. the option comment box). */
    footer?: Snippet;
  } = $props();
</script>

<div
  class={`chat-rise relative flex h-full origin-bottom flex-col overflow-hidden rounded-2xl border border-chrome bg-white ${open ? "" : "is-closed"} ${hidden ? "hidden" : ""}`}
  role="dialog"
  aria-label={title}
  inert={!open}
>
  <div class="flex shrink-0 items-center gap-2 border-b border-chrome px-5 py-3.5">
    <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
      <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    </span>
    <span class="text-sm font-semibold text-navy">{title}</span>
    {#if modelName}
      <span class="rounded-md bg-chrome px-2 py-1 text-xs font-medium text-gray-600">{modelName}</span>
    {/if}
    <button
      onclick={onClose}
      title="Close QA review"
      aria-label="Close QA review"
      class="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:text-navy"
    >
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="px-5 py-5">
      <QAScorePanel {agentOutputs} {reportContent} {reportId} {candidateId} {rawQa} {onLocateGap} />
    </div>
    {#if footer}
      <div class="border-t border-primary/15 bg-primary/5 px-5 py-4">
        {@render footer()}
      </div>
    {/if}
  </div>
</div>
