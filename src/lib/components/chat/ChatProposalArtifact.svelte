<script lang="ts">
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import ProposalCard from "./ProposalCard.svelte";

  type Proposal = Doc<"chatProposals">;

  interface Props {
    proposal: Proposal;
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
    reviewing?: boolean;
  }

  let {
    proposal: p,
    onRefine,
    onBeforeApply,
    onReferenceText,
    onReviewReplacements,
    onPreviewProposal,
    reviewing,
  }: Props = $props();
</script>

{#if p.kind === "references"}
  {@const refs = p.references ?? []}
  {#if refs.length && onReferenceText}
    <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span class="inline-flex items-center gap-1 text-xs text-gray-400">
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        {refs.length === 1 ? "Jump to:" : `Jump to (${refs.length}):`}
      </span>
      {#each refs as ref, i (i)}
        <button
          onclick={() => onReferenceText?.([ref], ref)}
          title={ref.length > 90 ? `${ref.slice(0, 90)}…` : ref}
          class="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-gray-200 px-2 text-xs font-semibold text-navy transition-colors hover:border-primary/50 hover:bg-primary/5"
        >
          {i + 1}
        </button>
      {/each}
    </div>
  {/if}
{:else}
  <ProposalCard
    proposal={p}
    {onBeforeApply}
    {onReferenceText}
    {onReviewReplacements}
    {onPreviewProposal}
    {onRefine}
    {reviewing}
  />
{/if}
