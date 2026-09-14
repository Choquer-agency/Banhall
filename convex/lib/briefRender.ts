/**
 * Renders the stored Generation Brief into an AD-11 delimited data block for
 * inclusion in a section prompt. Pure and offline-testable — reads no
 * database, calls no model.
 *
 * "inline Brief text into a prompt as anything but a rendered read of the
 * stored rows" (story 1 Never-rule): this is that one render path.
 */

export type BriefRenderEntry = {
  group:
    | "storyline"
    | "storylineQuestion"
    | "claimExclusion"
    | "confidenceMap"
    | "glossaryTerm";
  text: string;
  reason?: string;
  confidence?: string;
};

const REASON_LABELS: Record<string, string> = {
  business_risk: "business risk",
  routine_engineering: "routine engineering",
  outside_claim_period: "outside the claim period",
  not_technological: "not technological",
};

export function renderBriefBlock(
  storylineText: string,
  entries: BriefRenderEntry[]
): string {
  const claimExclusions = entries.filter((e) => e.group === "claimExclusion");
  const confidenceMap = entries.filter((e) => e.group === "confidenceMap");
  const glossaryTerms = entries.filter((e) => e.group === "glossaryTerm");

  if (
    !storylineText.trim() &&
    claimExclusions.length === 0 &&
    confidenceMap.length === 0 &&
    glossaryTerms.length === 0
  ) {
    return "";
  }

  const sections: string[] = [];
  if (storylineText.trim()) {
    sections.push(`Storyline:\n${storylineText.trim()}`);
  }
  if (claimExclusions.length > 0) {
    sections.push(
      `Claim Exclusions (never claim these, however prominent):\n${claimExclusions
        .map((e) => `- ${e.text} (${REASON_LABELS[e.reason ?? ""] ?? e.reason ?? "excluded"})`)
        .join("\n")}`
    );
  }
  if (confidenceMap.length > 0) {
    sections.push(
      `Confidence Map:\n${confidenceMap
        .map((e) => `- [${e.confidence ?? "unresolved"}] ${e.text}`)
        .join("\n")}`
    );
  }
  if (glossaryTerms.length > 0) {
    sections.push(
      `Glossary Terms (use this exact wording, one name per concept):\n${glossaryTerms
        .map((e) => `- ${e.text}`)
        .join("\n")}`
    );
  }

  return `\n\n--- BEGIN [GENERATION BRIEF] ---\n${sections.join("\n\n")}\n--- END [GENERATION BRIEF] ---`;
}
