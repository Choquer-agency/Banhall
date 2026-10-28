<script lang="ts">
  import type { UIMessage } from "@convex-dev/agent";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { humanizeItemIds, normalizeTurnParts, thoughtTraceNodes, type TurnTiming } from "$lib/chat/turnParts";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { Message, MessageContent, MessageActions, FeedbackBar, ActionButton } from "./primitives";
  import TurnTrace from "./TurnTrace.svelte";
  import ChatProposalArtifact from "./ChatProposalArtifact.svelte";
  import WebSourcesRow from "./WebSourcesRow.svelte";
  import { turnWebSources, withWebSearchLabels, type TurnWebSearch } from "$lib/chat/webSources";
  import { CHAT_FEEDBACK_REASONS, MAX_CHAT_FEEDBACK_REASON_CHARS, type ChatFeedbackReasonCode } from "../../../../shared/chatFeedback";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { isRecordOnlyProposal } from "../../../../shared/chatProposals";
  import { useProposalSection } from "$lib/chat/proposalSection";
  import { doneLine, undoneLine, useAssistantCards, type AcceptedCard } from "$lib/chat/assistantCards.svelte";
  import { userErrorMessage } from "$lib/errors";

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
      /** Phase C (W3): the thumbs down's saved reason, and how to change it. */
      reasonCode?: ChatFeedbackReasonCode | null;
      reasonText?: string | null;
      onReason?: (code: ChatFeedbackReasonCode, text: string) => Promise<void>;
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
    /** Phase C (W3): `answer` is the rendered answer, copied as shown. */
    onCopy?: (messageId: string, text: string, answer: HTMLElement | null) => void;
    onRefine: (proposal: Proposal) => void;
    onBeforeApply?: () => Promise<unknown>;
    onReferenceText?: (texts: string[], scrollTo?: string) => void;
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
  }: Props = $props();

  const componentId = $props.id();
  const answerElementId = `${componentId}-answer`;
  const regenerationDescriptionId = `${componentId}-regeneration-description`;
  const turn = $derived(normalizeTurnParts(message, proposals));

  // Owner 2026-10-28 (rows 32 and 36): one card per Line. Two or more cards
  // from this reply still waiting share a grey tray with Accept all, unless
  // any of them offers options (the writer picks those one by one). Accepted
  // cards are followed by a fixed "Done." line, undone ones by "Undone.".
  const cards = useAssistantCards();
  const sectionOf = useProposalSection();
  const applyProposal = useMutation(api.chatV2.applyProposal);
  const auth = useAuth();
  const editNodes = $derived(
    turn.proposalNodes.filter((node) => node.proposal.kind !== "references" && !isRecordOnlyProposal(node.proposal))
  );
  const accessProjectId = $derived(editNodes[0]?.proposal.projectId);
  const editAccessQ = useQuery(api.projects.getProjectEditAccess, () =>
    auth.isAuthenticated && accessProjectId ? { projectId: accessProjectId } : "skip"
  );
  const canEdit = $derived(editAccessQ.data?.canEditDetails === true);
  const lineOf = (proposal: Proposal) =>
    proposal.section ?? sectionOf(proposal.targetText ?? proposal.replacements?.[0]?.find);
  const waiting = $derived(editNodes.filter((node) => node.proposal.state === "pending"));
  const trayKeys = $derived(
    canEdit && waiting.length >= 2 && waiting.every((node) => !node.proposal.alternatives?.length)
      ? new Set(waiting.map((node) => node.key))
      : new Set<string>()
  );
  const firstTrayKey = $derived(waiting.find((node) => trayKeys.has(node.key))?.key);
  const acceptedCards = $derived<AcceptedCard[]>(
    editNodes
      .filter((node) => node.proposal.state === "applied")
      .map((node) => ({
        proposalId: node.proposal._id,
        line: lineOf(node.proposal),
        ...(node.proposal.alternatives?.length ? { option: node.proposal.appliedOption ?? 0 } : {}),
      }))
  );
  const undoneLines = $derived(
    editNodes
      .filter((node) => node.proposal.state === "pending" && node.proposal.undoneAt !== undefined)
      .map((node) => lineOf(node.proposal))
  );

  let acceptingAll = $state(false);
  async function acceptAll() {
    if (acceptingAll) return;
    acceptingAll = true;
    cards?.clearNotice();
    const done: AcceptedCard[] = [];
    try {
      await onBeforeApply?.();
      for (const node of waiting) {
        const result = await applyProposal({ proposalId: node.proposal._id });
        if (!result.applied) throw Object.assign(new Error(result.reason), { line: lineOf(node.proposal) });
        done.push({ proposalId: node.proposal._id, line: lineOf(node.proposal) });
      }
    } catch (error) {
      const failedLine = (error as { line?: string | null }).line;
      const reason = userErrorMessage(error, "Try again.");
      cards?.showNotice({ message: `Couldn't accept ${failedLine ? `Line ${failedLine}` : "every suggestion"}. ${reason}` });
    } finally {
      if (done.length) cards?.accepted(done);
      acceptingAll = false;
    }
  }
  // Phase B: each search is named in the trace, and its numbered sources
  // back the reply's citations and the Sources row.
  // The thought block leaves out steps whose card is already under the
  // reply (owner, 2026-10-21).
  // Review 2026-10-21: once the reply settles, a card step with no card
  // under it stays, as the failed attempt it was.
  const traceNodes = $derived(
    thoughtTraceNodes(withWebSearchLabels(turn.traceNodes, webSearches), {
      toolCallIds: new Set(turn.proposalNodes.flatMap((node) => (node.toolCallId ? [node.toolCallId] : []))),
      legacy: turn.proposalNodes.some((node) => node.association === "legacy"),
      settled: !(message?.status === "streaming" || message?.status === "pending") && timing?.status !== "running" && timing?.status !== "queued",
    })
  );
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

  // Owner, 2026-10-21: an item id in an answer (an older reply, or a slip)
  // shows as the place it names, and is copied that way.
  const answerText = $derived(humanizeItemIds(turn.text));

  // The thumbs show on a finished answer only; they share the action row.
  const showFeedback = $derived(
    !!turn.text && message?.status === "success" && timing?.status === "completed"
  );

  // Copy offers the answer only — never reasoning, tool payloads, or card text.
  const canCopy = $derived(
    !!message &&
      !!turn.text &&
      message.status !== "streaming" &&
      message.status !== "pending"
  );
</script>

{#snippet copyButton()}
  {#if message}
    {@const id = message.id}
    <!-- Phase C (W3): copies the answer as shown, and says so. -->
    <span class="sr-only" aria-live="polite" aria-atomic="true" data-copy-announcement>{copied ? "Copied" : ""}</span>
    <Tooltip text={copied ? "Copied" : copyFailed ? "Couldn't copy. Try again." : "Copy"} side="bottom" delayDuration={300}>
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          onclick={() => onCopy?.(id, answerText, document.getElementById(answerElementId))}
          aria-label={copied ? "Copied" : copyFailed ? "Couldn't copy. Try again." : "Copy"}
          class="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 pointer-coarse:size-11"
        >
          {#if copied}
            <svg class="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          {:else}
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path stroke-linecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          {/if}
        </button>
      {/snippet}
    </Tooltip>
  {/if}
{/snippet}

{#snippet regenerateButton()}
  {#if regeneration}
    {#if regeneration.description}
      <span id={regenerationDescriptionId} class="sr-only">{regeneration.description}</span>
    {/if}
    <!-- Owner, 2026-10-21: an icon in the answer's action row, as Claude
         and ChatGPT show retry. -->
    <Tooltip text="Regenerate" side="bottom" delayDuration={300}>
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          aria-label="Regenerate"
          aria-describedby={regeneration.description ? regenerationDescriptionId : undefined}
          disabled={regeneration.disabled}
          onclick={regeneration.onRegenerate}
          class="flex h-7 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-primary-wash hover:text-navy disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 pointer-coarse:size-11"
        >
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.3 5.7" />
            <path d="M20 4v7h-7" />
          </svg>
        </button>
      {/snippet}
    </Tooltip>
  {/if}
{/snippet}

<Message role="assistant" class="group">
  <TurnTrace
    nodes={traceNodes}
    {timing}
    {paused}
    messageStatus={message?.status}
  />

  <!-- Board 2.1: the answer introduces its suggested edits, which follow it. -->
  {#if turn.text}
    <!-- Announced once on failure; a live region here would re-announce the
         answer on every streaming token. Busy while it streams (Phase A). -->
    <div id={answerElementId} role={failed ? "alert" : undefined} aria-busy={streaming}>
      <MessageContent markdown text={answerText} citations={webSources} class={failed ? "text-red-500" : undefined} />
    </div>
  {/if}
  {#if showSources}
    <WebSourcesRow sources={webSources} />
  {/if}

  {#each turn.proposalNodes as node (node.key)}
    {#if node.key === firstTrayKey}
      <!-- Row 36 (A3): the waiting cards of one reply, with Accept all. -->
      <div class="mt-2 flex flex-col gap-1.5 rounded-[0.875rem] border border-line-soft bg-gray-50 p-1.5 [&_[data-proposal-card]]:mt-0" data-accept-all-tray>
        {#each waiting as trayNode (trayNode.key)}
          <ChatProposalArtifact proposal={trayNode.proposal} {onRefine} {onBeforeApply} {onReferenceText} />
        {/each}
        <div class="flex justify-end">
          <button type="button" class="inline-flex h-[1.875rem] items-center rounded-[0.4375rem] border border-line bg-white px-3 text-xs font-medium leading-[calc(4/3)] text-ink transition-colors hover:bg-gray-100 disabled:opacity-50 pointer-coarse:min-h-11"
            onclick={acceptAll} disabled={acceptingAll} data-accept-all>{acceptingAll ? "Accepting…" : "Accept all"}</button>
        </div>
      </div>
    {:else if !trayKeys.has(node.key)}
      <ChatProposalArtifact proposal={node.proposal} {onRefine} {onBeforeApply} {onReferenceText} />
    {/if}
  {/each}
  {#if acceptedCards.length}
    <p class="pt-2.5 text-[0.8125rem] leading-[calc(20/13)] text-ink" data-cards-done>{doneLine(acceptedCards)}</p>
  {/if}
  {#if undoneLines.length}
    <p class="pt-2.5 text-[0.8125rem] leading-[calc(20/13)] text-ink" data-cards-undone>{undoneLine(undoneLines)}</p>
  {/if}


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

  {#if feedback && showFeedback}
    <!-- Owner, 2026-10-21: one quiet row of icons under the answer: Copy,
         the thumbs and Regenerate, with no "Was this answer helpful?" text. -->
    <div role="group" aria-labelledby={answerElementId}>
    <FeedbackBar title="Was this answer helpful?" quiet value={feedback.value}
      disabled={feedback.disabled} onHelpful={() => feedback?.onVote(1)}
      onNotHelpful={() => feedback?.onVote(-1)}
      changeable
      reasons={feedback.onReason ? CHAT_FEEDBACK_REASONS : undefined}
      reasonCode={feedback.reasonCode ?? null}
      reasonText={feedback.reasonText ?? null}
      reasonTextMax={MAX_CHAT_FEEDBACK_REASON_CHARS}
      onReason={feedback.onReason ? (code, text) => feedback?.onReason?.(code as ChatFeedbackReasonCode, text) : undefined}
      leading={canCopy ? copyButton : undefined}
      trailing={regeneration ? regenerateButton : undefined} />
    {#if feedback.error}<p role="alert" class="text-xs text-red-600">{feedback.error}</p>{/if}
    </div>
  {:else if canCopy || regeneration}
    <MessageActions>
      {#if canCopy}{@render copyButton()}{/if}
      {@render regenerateButton()}
    </MessageActions>
  {/if}
</Message>
