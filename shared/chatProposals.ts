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

export function proposalReferences(proposal: ProposalShape) {
  if (proposal.kind === "references") {
    return (proposal.references ?? []).filter(Boolean);
  }
  return proposalPairs(proposal).map((pair) => pair.find);
}
