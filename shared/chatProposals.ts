export type ProposalShape = {
  kind: "edit" | "replacements" | "references";
  targetText?: string;
  newText?: string;
  replacements?: Array<{ find: string; replaceWith: string }>;
  references?: string[];
};

export function proposalPairs(proposal: ProposalShape) {
  if (proposal.kind === "edit" && proposal.targetText) {
    return [{ find: proposal.targetText, replaceWith: proposal.newText ?? "" }];
  }
  if (proposal.kind === "replacements") {
    return (proposal.replacements ?? []).filter((pair) => pair.find);
  }
  return [];
}

/**
 * DW-135 (AD-28 amendment, 2026-09-14): a Coordinated Revision saved with
 * zero edits because every finding was blocked or conflicting. It is a record
 * of the findings, not a suggestion: nothing to apply, reject or reword. Used
 * by `applyProposal`, `saveProposal` and the proposal card alike so the three
 * agree on what a record-only proposal is.
 */
export function isRecordOnlyProposal(
  proposal: ProposalShape & { requireUniqueTargets?: boolean }
) {
  return (
    proposal.kind === "replacements" &&
    proposal.requireUniqueTargets === true &&
    proposalPairs(proposal).length === 0
  );
}

export function proposalReferences(proposal: ProposalShape) {
  if (proposal.kind === "references") {
    return (proposal.references ?? []).filter(Boolean);
  }
  return proposalPairs(proposal).map((pair) => pair.find);
}
