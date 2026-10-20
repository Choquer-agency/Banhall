<script lang="ts">
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import {
    isRecordOnlyProposal,
    proposalPairs,
    proposalReferences,
  } from "../../../../shared/chatProposals";
  import NothingToApplyCard from "./NothingToApplyCard.svelte";
  import ProposalChecklist from "./ProposalChecklist.svelte";
  import { useProposalSection } from "$lib/chat/proposalSection";
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
  // DW-135: an all-blocked/conflicting revision has no edits and no action;
  // it renders as a record of its findings, never as a suggestion card.
  const recordOnly = $derived(isRecordOnlyProposal(proposal));
  // Phase A (task 4): Apply, Dismiss and Edit wording are offered to exactly
  // the people `applyProposal`, `rejectProposal` and `updateProposalWording`
  // accept (report edit access), the answer the Files panel and the page
  // already read. Hidden while it loads, so no one sees a button flash.
  const auth = useAuth();
  const editAccessQ = useQuery(api.projects.getProjectEditAccess, () =>
    auth.isAuthenticated ? { projectId: proposal.projectId } : "skip"
  );
  // A failed read is unknown, not a refusal: the actions stay hidden without
  // telling an editor they cannot edit (review P3). The subscription retries.
  const applyAccess = $derived<"allowed" | "loading" | "denied">(
    editAccessQ.data === undefined || editAccessQ.error
      ? "loading"
      : editAccessQ.data.canEditDetails ? "allowed" : "denied"
  );
  // A coordinated revision carries its Completion Report on the card (CAP-13).
  const bulk = $derived(proposal.kind === "replacements" && proposal.requireUniqueTargets === true);
  const sectionOf = useProposalSection();
  const section = $derived(sectionOf(proposal.targetText ?? proposal.replacements?.[0]?.find));
</script>

{#if recordOnly}
<NothingToApplyCard proposalId={proposal._id} />
{:else}
<ProposedEditCard
  {section}
  newText={proposal.newText}
  targetText={proposal.targetText}
  replacements={proposal.replacements}
  state={proposal.state}
  {applyAccess}
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
  onReviewOneByOne={!proposal.requireUniqueTargets && proposal.replacements && proposal.replacements.length > 0 && onReviewReplacements
    ? () => onReviewReplacements(pairs, proposal._id)
    : undefined}
  onPreviewInDoc={onPreviewProposal
    ? (on) => onPreviewProposal(pairs, on)
    : undefined}
  {reviewing}
/>
{#if bulk}
  <ProposalChecklist proposalId={proposal._id} variant="disclosure" />
{/if}
{/if}
