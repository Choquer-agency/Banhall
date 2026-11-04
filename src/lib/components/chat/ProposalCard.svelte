<script lang="ts">
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { isRecordOnlyProposal, proposalPairs } from "../../../../shared/chatProposals";
  import NothingToApplyCard from "./NothingToApplyCard.svelte";
  import ProposalChecklist from "./ProposalChecklist.svelte";
  import { useProposalSection } from "$lib/chat/proposalSection";
  import { AcceptCancelled, useAssistantCards, type ReviewPair } from "$lib/chat/assistantCards.svelte";
  import {
    RULE_OVERRIDE_MANAGER_ONLY,
    appliedAgainstRules,
    brokenRuleNames,
    rulesNeedManager,
  } from "../../../../shared/ruleOverride";
  import RuleOverrideDialog from "./RuleOverrideDialog.svelte";
  import { proposedTextChanges } from "$lib/diff";
  import { PROPOSAL_UNDO_CONFLICT_TEXT, proposalUndoErrorMessage } from "$lib/chat/chatRefusals";
  import { userErrorMessage } from "$lib/errors";
  import ProposedEditCard from "./ProposedEditCard.svelte";

  // Phase B: `chatV2.listProposals` adds `undoable` (and never sends the
  // recorded change itself); other feeds do not, and offer no Undo.
  type Proposal = Doc<"chatProposals"> & { undoable?: boolean };

  interface Props {
    proposal: Proposal;
    optimisticApplied?: boolean;
    onBeforeApply?: () => Promise<unknown>;
    onRefine?: (proposal: Proposal) => void;
  }

  let { proposal, optimisticApplied = false, onBeforeApply, onRefine }: Props = $props();

  const applyProposal = useMutation(api.chatV2.applyProposal);
  const rejectProposal = useMutation(api.chatV2.rejectProposal);
  const undoProposal = useMutation(api.chatV2.undoProposal);
  const updateProposalWording = useMutation(api.chatV2.updateProposalWording);
  const cards = useAssistantCards();
  const review = $derived(cards?.review ?? null);

  // DW-135: an all-blocked/conflicting revision has no edits and no action;
  // it renders as a record of its findings, never as a suggestion card.
  const recordOnly = $derived(isRecordOnlyProposal(proposal));
  // Phase A (task 4): accept, dismiss and edit wording are offered to exactly
  // the people `applyProposal`, `rejectProposal` and `updateProposalWording`
  // accept (report edit access). Hidden while it loads.
  const auth = useAuth();
  const editAccessQ = useQuery(api.projects.getProjectEditAccess, () =>
    auth.isAuthenticated ? { projectId: proposal.projectId } : "skip"
  );
  const applyAccess = $derived<"allowed" | "loading" | "denied">(
    editAccessQ.data === undefined || editAccessQ.error
      ? "loading"
      : editAccessQ.data.canEditDetails ? "allowed" : "denied"
  );
  // 2026-11-02 (rule overrides): a card that goes against a rule is applied
  // only by someone with `report.overrideRules` (Managers and Admins), after
  // confirming the rules by name. The server checks both again.
  const rulesBroken = $derived(proposal.rulesBroken ?? []);
  const ruleConflict = $derived(
    rulesBroken.length
      ? {
          rules: rulesBroken,
          // A template rule or an approved banned word is the writer's call
          // (owner, 2026-11-02 second); a house rule or a CRA limit needs a manager.
          canOverride: editAccessQ.data?.canOverrideRules === true || !rulesNeedManager(rulesBroken),
        }
      : null
  );
  const overriddenNote = $derived(
    proposal.state === "applied" && proposal.ruleOverrides?.length && rulesBroken.length
      ? appliedAgainstRules(rulesBroken)
      : null
  );
  let overrideOpen = $state(false);
  let settleOverride: ((confirmed: boolean) => void) | null = null;
  function confirmOverride(): Promise<boolean> {
    settleOverride?.(false);
    overrideOpen = true;
    return new Promise((resolve) => {
      settleOverride = resolve;
    });
  }
  function closeOverride(confirmed: boolean) {
    const settle = settleOverride;
    settleOverride = null;
    settle?.(confirmed);
  }
  // A card that leaves mid-question cancels it, so a review never waits on it.
  $effect(() => () => closeOverride(false));
  const bulk = $derived(proposal.kind === "replacements" && proposal.requireUniqueTargets === true);
  const everyMatch = $derived(proposal.kind === "replacements" && proposal.requireUniqueTargets !== true);
  const sectionOf = useProposalSection();
  const line = $derived(proposal.section ?? sectionOf(proposal.targetText ?? proposal.replacements?.[0]?.find));

  // Option 1 is the card's own passages; Options 2 and 3 are its alternatives.
  const pairsFor = (option: number): ReviewPair[] =>
    option === 0
      ? proposalPairs(proposal)
      : (proposal.alternatives?.[option - 1]?.replacements ?? []).filter((pair) => pair.find);
  const optionCount = $derived(1 + (proposal.alternatives?.length ?? 0));
  const changesFor = (option: number) =>
    option === 0
      ? proposedTextChanges(proposal.targetText, proposal.newText, proposal.replacements)
      : proposedTextChanges(undefined, undefined, pairsFor(option));
  const options = $derived(
    Array.from({ length: optionCount }, (_, option) => changesFor(option).map((change) => change.after))
  );

  // Without a review session (a chat outside the report page) the card shows
  // the change itself.
  let localReviewing = $state(false);
  let localOption = $state(0);
  let accepting = $state(false);
  let pendingAppliedOption = $state<number | null>(null);
  let cardError = $state<string | null>(null);
  const shownState = $derived(
    (pendingAppliedOption !== null || (optimisticApplied && applyAccess === "allowed" && !rulesBroken.length)) && proposal.state === "pending"
      ? "applied"
      : proposal.state
  );
  $effect(() => {
    if (proposal.state !== "pending") pendingAppliedOption = null;
  });
  const reviewing = $derived(review ? review.isReviewing(proposal._id) : localReviewing);
  const option = $derived(review && reviewing ? review.option : localOption);

  function fail(error: unknown, fallback: string) {
    const message = userErrorMessage(error, fallback);
    if (cards) cards.showNotice({ message });
    else cardError = message;
  }

  async function accept(chosen: number) {
    let overrideRules: string[] | undefined;
    if (rulesBroken.length) {
      if (!ruleConflict?.canOverride) throw new Error(RULE_OVERRIDE_MANAGER_ONLY);
      if (!(await confirmOverride())) throw new AcceptCancelled();
      overrideRules = brokenRuleNames(rulesBroken);
    }
    await onBeforeApply?.();
    if (applyAccess !== "allowed") throw new Error("Only people who can edit this report can accept suggestions.");
    pendingAppliedOption = chosen;
    try {
      const result = await applyProposal({
        proposalId: proposal._id,
        ...(optionCount > 1 ? { option: chosen } : {}),
        ...(overrideRules ? { overrideRules } : {}),
      });
      if (!result.applied) throw new Error(result.reason);
    } catch (error) {
      pendingAppliedOption = null;
      throw error;
    }
    cards?.accepted([
      { proposalId: proposal._id, line, ...(optionCount > 1 ? { option: chosen } : {}) },
    ]);
  }

  function startReview() {
    cardError = null;
    cards?.clearNotice();
    if (review) {
      // The review bar's Accept runs this too; a refusal is told in the chat.
      const acceptFromReview = async (chosen: number) => {
        try {
          await accept(chosen);
        } catch (error) {
          if (!(error instanceof AcceptCancelled)) fail(error, "This suggestion could not be accepted. Try again.");
          throw error;
        }
      };
      review.start({ proposalId: proposal._id, line, optionCount, pairsFor, accept: acceptFromReview }, localOption);
    } else {
      localReviewing = true;
    }
  }

  function stopReview() {
    if (review) {
      if (review.isReviewing(proposal._id)) {
        localOption = review.option;
        review.stop();
      }
    } else {
      localReviewing = false;
    }
  }

  async function acceptShown() {
    if (review && review.isReviewing(proposal._id)) {
      await review.accept();
      return;
    }
    accepting = true;
    cardError = null;
    try {
      await accept(option);
      localReviewing = false;
    } catch (error) {
      if (!(error instanceof AcceptCancelled)) fail(error, "This suggestion could not be accepted. Try again.");
    } finally {
      accepting = false;
    }
  }

  async function undo() {
    try {
      // Like Accept: the editor's unsaved text is saved first.
      await onBeforeApply?.();
      await undoProposal({ proposalId: proposal._id });
      cards?.forget([proposal._id]);
    } catch (error) {
      cards?.forget([proposal._id]);
      const message = proposalUndoErrorMessage(error);
      if (cards) {
        // Q5: the newest chat item, with Version history beside it.
        const conflict = message === PROPOSAL_UNDO_CONFLICT_TEXT;
        cards.showNotice(
          conflict
            ? { message: `Couldn't undo. ${line ? `Line ${line}` : "This passage"} was edited after you accepted it.`, action: "version_history" }
            : { message }
        );
      } else {
        cardError = message;
      }
    }
  }
</script>

{#if recordOnly}
<NothingToApplyCard proposalId={proposal._id} />
{:else}
<div class="mt-2" data-proposal-card={proposal._id}>
<ProposedEditCard
  {line}
  {options}
  {changesFor}
  {everyMatch}
  state={shownState}
  appliedOption={pendingAppliedOption ?? proposal.appliedOption}
  {applyAccess}
  {ruleConflict}
  {overriddenNote}
  {reviewing}
  reviewInReport={review !== null}
  {option}
  onOptionChange={(next) => {
    localOption = next;
    if (review?.isReviewing(proposal._id)) review.setOption(next);
  }}
  onReview={startReview}
  onStopReview={stopReview}
  onAccept={acceptShown}
  accepting={accepting || (reviewing && (review?.accepting ?? false))}
  onUndo={proposal.state === "applied" && proposal.undoable === true ? undo : undefined}
  onReject={async () => {
    await rejectProposal({ proposalId: proposal._id });
  }}
  onEditWording={async (wording) => {
    if (proposal.kind === "edit") {
      await updateProposalWording({ proposalId: proposal._id, newText: wording[0] ?? "" });
    } else {
      const pairs = proposalPairs(proposal);
      await updateProposalWording({
        proposalId: proposal._id,
        replacements: pairs.map((pair, index) => ({ find: pair.find, replaceWith: wording[index] ?? pair.replaceWith })),
      });
    }
    try {
      await accept(0);
    } catch (error) {
      // The new wording is saved; cancelling the override only skips the apply.
      if (!(error instanceof AcceptCancelled)) throw error;
    }
  }}
  onRefine={onRefine ? () => onRefine(proposal) : undefined}
  error={cardError}
/>
{#if bulk}
  <ProposalChecklist proposalId={proposal._id} variant="disclosure" />
{/if}
{#if rulesBroken.length}
  <RuleOverrideDialog
    bind:open={overrideOpen}
    rules={rulesBroken}
    onConfirm={() => closeOverride(true)}
    onCancel={() => closeOverride(false)}
  />
{/if}
</div>
{/if}
