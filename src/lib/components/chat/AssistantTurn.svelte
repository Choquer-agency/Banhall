<script lang="ts">
  import type { UIMessage } from "@convex-dev/agent";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { normalizeTurnParts, type TurnTiming } from "$lib/chat/turnParts";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { Message, MessageContent, MessageActions, FeedbackBar, ActionButton } from "./primitives";
  import TurnTrace from "./TurnTrace.svelte";
  import ChatProposalArtifact from "./ChatProposalArtifact.svelte";
  import WebSourcesRow from "./WebSourcesRow.svelte";
  import { turnWebSources, withWebSearchLabels, type TurnWebSearch } from "$lib/chat/webSources";

  type Proposal = Doc<"chatProposals">;

  /**
   * One assistant turn: the collapsible tool/reasoning trace, the action
   * artifacts it produced, then the answer.
   *
   * Proposals render below the trace rather than at their literal part
   * position. Collapsing the trace must never hide an unapplied suggestion,
   * and ProposedEditCard holds local preview/wording state that would be lost
   * if the card unmounted with the disclosure.
   */
  interface Props {
    message?: UIMessage;
    proposals?: Proposal[];
    timing?: TurnTiming;
    copied?: boolean;
    regeneration?: { disabled: boolean; description?: string; onRegenerate: () => Promise<void> };
    feedback?: {
      value: 1 | -1 | null;
      disabled: boolean;
      error?: string;
      onVote: (vote: 1 | -1) => Promise<void>;
    };
    /** The copy of this answer failed; the button says so instead of a toast. */
    copyFailed?: boolean;
    /** Phase A: the turn's structured Continue offer, on the newest turn only. */
    continuation?: {
      label: string;
      disabled: boolean;
      onContinue: () => Promise<void> | void;
      /** Phase B: why the job did not carry on by itself (budget, no progress). */
      skipNote?: string;
    };
    /** Freeze the live timer while the connection is down. */
    paused?: boolean;
    /** Phase B: the web searches this turn sent, for citations and the trace. */
    webSearches?: TurnWebSearch[];
    /** Phase B: show the Sources row (the turn's last assistant row only). */
    showSources?: boolean;
    onCopy?: (messageId: string, text: string) => void;
    onRefine: (proposal: Proposal) => void;
    onBeforeApply?: () => Promise<unknown>;
    onReferenceText?: (texts: string[], scrollTo?: string) => void;
    onReviewReplacements?: (
      pairs: { find: string; replaceWith: string }[],
      proposalId: string
    ) => void;
    onPreviewProposal?: (
      pairs: { find: string; replaceWith: string }[],
      on: boolean
    ) => void;
    reviewingId?: string | null;
  }

  let {
    message,
    proposals = [],
    timing,
    copied = false,
    copyFailed = false,
    continuation,
    paused = false,
    webSearches = [],
    showSources = false,
    regeneration,
    feedback,
    onCopy,
    onRefine,
    onBeforeApply,
    onReferenceText,
    onReviewReplacements,
    onPreviewProposal,
    reviewingId,
  }: Props = $props();

  const componentId = $props.id();
  const answerElementId = `${componentId}-answer`;
  const regenerationDescriptionId = `${componentId}-regeneration-description`;
  const turn = $derived(normalizeTurnParts(message, proposals));
  // Phase B: each search is named in the trace, and its numbered sources
  // back the reply's citations and the Sources row.
  const traceNodes = $derived(withWebSearchLabels(turn.traceNodes, webSearches));
  const webSources = $derived(turnWebSources(webSearches));

  const failed = $derived(message?.status === "failed" || timing?.status === "failed");
  const streaming = $derived(message?.status === "streaming" || message?.status === "pending");

  // One click sends one Continue: the guard holds until the send settles,
  // and the panel removes the offer once the new turn exists.
  let continuing = $state(false);
  async function runContinue() {
    if (!continuation || continuing || continuation.disabled) return;
    continuing = true;
    try {
      await continuation.onContinue();
    } finally {
      continuing = false;
    }
  }

  // Copy offers the answer only — never reasoning, tool payloads, or card text.
  const canCopy = $derived(
    !!message &&
      !!turn.text &&
      message.status !== "streaming" &&
      message.status !== "pending"
  );
</script>

<Message role="assistant" class="group">
  <TurnTrace
    nodes={traceNodes}
    proposalNodes={turn.proposalNodes}
    {timing}
    {paused}
    messageStatus={message?.status}
  />

  <!-- Board 2.1: the answer introduces its suggested edits, which follow it. -->
  {#if turn.text}
    <!-- Announced once on failure; a live region here would re-announce the
         answer on every streaming token. Busy while it streams (Phase A). -->
    <div id={answerElementId} role={failed ? "alert" : undefined} aria-busy={streaming}>
      <MessageContent markdown text={turn.text} citations={webSources} class={failed ? "text-red-500" : undefined} />
    </div>
  {/if}
  {#if showSources}
    <WebSourcesRow sources={webSources} />
  {/if}

  {#each turn.proposalNodes as node (node.key)}
    <ChatProposalArtifact
      proposal={node.proposal}
      {onRefine}
      {onBeforeApply}
      {onReferenceText}
      {onReviewReplacements}
      {onPreviewProposal}
      reviewing={reviewingId === node.proposal._id}
    />
  {/each}

  {#if continuation}
    <!-- Phase A: the server's structured offer to carry on (the next Line, or
         where a long job stopped). It sends an ordinary writer message. -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
      <ActionButton variant="secondary" data-continue-offer
        disabled={continuation.disabled || continuing}
        loading={continuing} loadingLabel="Sending…"
        onclick={runContinue}
        class="pointer-coarse:min-h-11">{continuation.label}</ActionButton>
      {#if continuation.skipNote}
        <p class="min-w-0 flex-1 text-xs text-ink-muted" data-auto-continue-skip>{continuation.skipNote}</p>
      {/if}
    </div>
  {/if}

  {#if canCopy || regeneration}
    <MessageActions>
      {#if canCopy && message}
      {@const id = message.id}
      <Tooltip text={copied ? "Copied!" : copyFailed ? "Couldn't copy. Try again." : "Copy message"} side="bottom" delayDuration={300}>
        {#snippet children({ props })}
          <button
            {...props}
            type="button"
            onclick={() => onCopy?.(id, turn.text)}
            aria-label={copied ? "Copied" : copyFailed ? "Couldn't copy. Try again." : "Copy message"}
            class="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-primary-wash hover:text-navy"
          >
            {#if copied}
              <svg class="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            {:else}
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path stroke-linecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            {/if}
          </button>
        {/snippet}
      </Tooltip>
      {/if}
      {#if regeneration}
        {#if regeneration.description}
          <span id={regenerationDescriptionId} class="sr-only">{regeneration.description}</span>
        {/if}
        <ActionButton disabled={regeneration.disabled} onclick={regeneration.onRegenerate}
          aria-describedby={regeneration.description ? regenerationDescriptionId : undefined}
          class="min-h-9 px-2 pointer-coarse:min-h-11">Regenerate</ActionButton>
      {/if}
    </MessageActions>
  {/if}
  {#if feedback && turn.text && message?.status === "success" && timing?.status === "completed"}
    <div role="group" aria-labelledby={answerElementId}>
    <FeedbackBar title="Was this answer helpful?" value={feedback.value}
      disabled={feedback.disabled} onHelpful={() => feedback?.onVote(1)}
      onNotHelpful={() => feedback?.onVote(-1)} />
    {#if feedback.error}<p role="alert" class="text-xs text-red-600">{feedback.error}</p>{/if}
    </div>
  {/if}
</Message>
