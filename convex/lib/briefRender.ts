/**
 * Renders the stored Generation Brief into an AD-11 delimited data block for
 * inclusion in a section prompt. Pure and offline-testable — reads no
 * database, calls no model.
 *
 * "inline Brief text into a prompt as anything but a rendered read of the
 * stored rows" (story 1 Never-rule): this is that one render path.
 *
 * Also the one definition of a Brief stage attempt's outcome (DW-109/DW-120):
 * the validator shared by `generations.briefOutcome` and its only writer
 * (`generations.recordBriefOutcome`), and the writer-facing progress copy.
 */

import { v, type Infer } from "convex/values";

/** Most characters of the raw error message a failed outcome keeps. */
export const BRIEF_OUTCOME_DETAIL_CHARS = 300;

/**
 * What one Brief stage attempt did. `failed.code` is
 * `normalizeProviderError(error).code`; `failed.detail` is the raw error
 * message, bounded by `BRIEF_OUTCOME_DETAIL_CHARS`, kept for ops only — it
 * never reaches `progressLog` or a public query.
 */
export const briefOutcomeValidator = v.union(
  v.object({ kind: v.literal("derived") }),
  v.object({ kind: v.literal("reused") }),
  v.object({ kind: v.literal("no_evidence") }),
  v.object({
    kind: v.literal("failed"),
    code: v.union(
      v.literal("billing"),
      v.literal("rate_limited"),
      v.literal("authentication"),
      v.literal("model_access"),
      v.literal("output_limit"),
      v.literal("network"),
      v.literal("unknown")
    ),
    detail: v.string(),
  })
);

export type BriefOutcome = Infer<typeof briefOutcomeValidator>;

/** The progress line for an outcome. Authored copy only — never error text,
 * so `userSafeNarration` passes it through unchanged. */
export function describeBriefOutcome(outcome: BriefOutcome): string {
  switch (outcome.kind) {
    case "derived":
      return "Generation Brief stage completed.";
    case "reused":
      return "Reusing the stored Generation Brief — its inputs are unchanged.";
    case "no_evidence":
      return "No frozen evidence to derive a Generation Brief from — drafting without a Brief.";
    case "failed":
      return "Generation Brief derivation failed — drafting without a Brief.";
  }
}

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
