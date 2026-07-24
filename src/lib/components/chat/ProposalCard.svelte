<script lang="ts">
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { proposalPairs, proposalReferences } from "../../../../shared/chatProposals";
  import ProposedEditCard from "./ProposedEditCard.svelte";

  type Proposal = Doc<"chatProposals">;

  interface Props {
    proposal: Proposal;
    onBeforeApply?: () => Promise<unknown>;
    onRefine?: (proposal: Proposal) => void;
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
    proposal,
    onBeforeApply,
    onRefine,
    onReferenceText,
    onReviewReplacements,
    onPreviewProposal,
    reviewing,
  }: Props = $props();

  const applyProposal = useMutation(api.chatV2.applyProposal);
  const rejectProposal = useMutation(api.chatV2.rejectProposal);
  const updateProposalWording = useMutation(api.chatV2.updateProposalWording);
  const pairs = $derived(proposalPairs(proposal));
  const references = $derived(proposalReferences(proposal));
</script>

<ProposedEditCard
  newText={proposal.newText}
  targetText={proposal.targetText}
  replacements={proposal.replacements}
  state={proposal.state}
  onReplace={async () => {
    await onBeforeApply?.();
    const result = await applyProposal({ proposalId: proposal._id });
    if (!result.applied) throw new Error(result.reason);
  }}
  onReject={async () => {
    await rejectProposal({ proposalId: proposal._id });
  }}
  onEditWording={async (wording) => {
    if (proposal.kind === "edit") {
      await updateProposalWording({
        proposalId: proposal._id,
        newText: wording[0] ?? "",
      });
    } else {
      await updateProposalWording({
        proposalId: proposal._id,
        replacements: pairs.map((pair, index) => ({
          find: pair.find,
          replaceWith: wording[index] ?? pair.replaceWith,
        })),
      });
    }
    await onBeforeApply?.();
    const result = await applyProposal({ proposalId: proposal._id });
    if (!result.applied) throw new Error(result.reason);
  }}
  onRefine={onRefine ? () => onRefine(proposal) : undefined}
  onShowInDoc={references.length > 0
    ? () => onReferenceText?.(references)
    : undefined}
  onReviewOneByOne={proposal.replacements && proposal.replacements.length > 0 && onReviewReplacements
    ? () => onReviewReplacements(pairs, proposal._id)
    : undefined}
  onPreviewInDoc={onPreviewProposal
    ? (on) => onPreviewProposal(pairs, on)
    : undefined}
  {reviewing}
/>
