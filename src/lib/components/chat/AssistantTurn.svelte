<script lang="ts">
  import type { UIMessage } from "@convex-dev/agent";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { normalizeTurnParts, type TurnTiming } from "$lib/chat/turnParts";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { Message, MessageContent, MessageActions } from "./primitives";
  import TurnTrace from "./TurnTrace.svelte";
  import ChatProposalArtifact from "./ChatProposalArtifact.svelte";

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
    onCopy,
    onRefine,
    onBeforeApply,
    onReferenceText,
    onReviewReplacements,
    onPreviewProposal,
    reviewingId,
  }: Props = $props();

  const turn = $derived(normalizeTurnParts(message, proposals));

  const failed = $derived(message?.status === "failed" || timing?.status === "failed");

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
    nodes={turn.traceNodes}
    proposalNodes={turn.proposalNodes}
    {timing}
    messageStatus={message?.status}
  />

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

  {#if turn.text}
    <!-- Announced once on failure; a live region here would re-announce the
         answer on every streaming token. -->
    <div role={failed ? "alert" : undefined}>
      <MessageContent markdown text={turn.text} class={failed ? "text-red-500" : undefined} />
    </div>
  {/if}

  {#if canCopy && message}
    {@const id = message.id}
    <MessageActions>
      <Tooltip text={copied ? "Copied!" : "Copy message"} side="bottom" delayDuration={300}>
        {#snippet children({ props })}
          <button
            {...props}
            type="button"
            onclick={() => onCopy?.(id, turn.text)}
            aria-label={copied ? "Copied" : "Copy message"}
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
    </MessageActions>
  {/if}
</Message>
