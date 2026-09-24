/**
 * Story 4: pure helpers for the Brief rail (labels, grouping, counts and
 * copy). No Svelte, no Convex runtime. Copy follows EXPERIENCE.md's Voice and
 * Tone verbatim.
 */

import { parseSourceLabel, settingsSupplyLabel } from "../../convex/lib/settingsDocument";

export type Inclusion = "included" | "condensed" | "not_included";
export type InclusionReason = "archived" | "unreadable" | "not_captured";
export type EligibilityReason =
  | "business_risk"
  | "routine_engineering"
  | "outside_claim_period"
  | "not_technological";
export type Confidence = "established" | "partial" | "unresolved" | "unreliable";
export type EntryGroup =
  | "storyline"
  | "storylineQuestion"
  | "claimExclusion"
  | "confidenceMap"
  | "glossaryTerm";
export type SourceKind = "transcript" | "project_document" | "transcript_digest" | "writer_storyline";

export const INCLUSION_WORDS: Record<Inclusion, string> = {
  included: "included",
  condensed: "condensed",
  not_included: "not included",
};

export const INCLUSION_REASON_WORDS: Record<InclusionReason, string> = {
  archived: "archived",
  unreadable: "could not read",
  not_captured: "not captured",
};

export const ELIGIBILITY_REASON_WORDS: Record<EligibilityReason, string> = {
  business_risk: "business risk",
  routine_engineering: "routine engineering",
  outside_claim_period: "outside the claim period",
  not_technological: "not technological",
};

export const CONFIDENCE_WORDS: Record<Confidence, string> = {
  established: "established",
  partial: "partial",
  unresolved: "unresolved",
  unreliable: "unreliable",
};

export type InclusionRow = {
  key: string;
  kind: "transcript" | "document";
  label: string;
  inclusion: Inclusion | null;
  reason?: InclusionReason;
};

/**
 * "12 of 40 documents in context · cap 12". A truncated listing (DW-133) reads
 * "12 of 40+ documents…": the `+` is the app's bounded-count qualifier, so the
 * total is never presented as the whole attachment list when it is not. When
 * the frozen sources themselves were cut short an unread row may be an
 * included document, so the numerator is qualified too: "12+ of 40+".
 */
export function inclusionHeader(input: {
  documentsInContext: number;
  documentsTotal: number;
  cap: number;
  documentsTruncated?: boolean;
  sourcesTruncated?: boolean;
}): string {
  const inContext = input.sourcesTruncated
    ? `${input.documentsInContext}+`
    : `${input.documentsInContext}`;
  const total =
    input.documentsTruncated || input.sourcesTruncated
      ? `${input.documentsTotal}+`
      : `${input.documentsTotal}`;
  return `${inContext} of ${total} documents in context, cap ${input.cap}`;
}

/** Which part of the Inputs listing was cut short, if any. */
export function inclusionTruncation(input: {
  documentsTruncated?: boolean;
  sourcesTruncated?: boolean;
}): "sources" | "documents" | null {
  if (input.sourcesTruncated) return "sources";
  if (input.documentsTruncated) return "documents";
  return null;
}

/** Shown under an Inputs listing whose document walk was cut short; the frozen set is complete. */
export const INCLUSION_TRUNCATED_NOTE =
  "Not every document could be listed. The total is a lower bound.";
/** Shown when the frozen sources themselves were cut short: transcripts and documents may be missing. */
export const INCLUSION_SOURCES_TRUNCATED_NOTE =
  "Not every transcript or document could be listed. Both counts are lower bounds.";

/** The row's status text: "included", "not included (archived)", or "" when unrecorded. */
export function inclusionStatusText(row: Pick<InclusionRow, "inclusion" | "reason">): string {
  if (row.inclusion === null) return "";
  const word = INCLUSION_WORDS[row.inclusion];
  return row.reason ? `${word} (${INCLUSION_REASON_WORDS[row.reason]})` : word;
}

export type BriefEntryLike = {
  _id: string;
  group: EntryGroup;
  text: string;
  reason?: EligibilityReason;
  confidence?: Confidence;
  change?: "added" | "removed" | "unchanged";
  edited?: boolean;
  exactExcerpt: string;
  source: { label: string; kind: SourceKind } | null;
  question?: {
    questionText: string;
    resolvedBy?: "use_evidence" | "keep_storyline";
    alternativeText?: string;
  };
};

export type GroupedBrief<E extends BriefEntryLike> = {
  storyline: E[];
  claimExclusion: E[];
  confidenceMap: E[];
  glossaryTerm: E[];
  openQuestions: E[];
};

/** Entries by rail group; only unresolved Storyline questions surface. */
export function groupBrief<E extends BriefEntryLike>(entries: readonly E[]): GroupedBrief<E> {
  return {
    storyline: entries.filter((entry) => entry.group === "storyline"),
    claimExclusion: entries.filter((entry) => entry.group === "claimExclusion"),
    confidenceMap: entries.filter((entry) => entry.group === "confidenceMap"),
    glossaryTerm: entries.filter((entry) => entry.group === "glossaryTerm"),
    openQuestions: entries.filter(
      (entry) =>
        entry.group === "storylineQuestion" &&
        entry.question !== undefined &&
        entry.question.resolvedBy === undefined
    ),
  };
}

/** "2 added, 1 removed" when the group changed since the last Brief; otherwise null. */
export function changeSummary(entries: readonly Pick<BriefEntryLike, "change">[]): string | null {
  const added = entries.filter((entry) => entry.change === "added").length;
  const removed = entries.filter((entry) => entry.change === "removed").length;
  if (added === 0 && removed === 0) return null;
  return `${added} added, ${removed} removed`;
}

/** Entries that still count toward a group (a removed marker row is not one). */
export function liveCount(entries: readonly Pick<BriefEntryLike, "change">[]): number {
  return entries.filter((entry) => entry.change !== "removed").length;
}

export type EntryOrigin = "derived" | "edited";

export function entryOrigin(entry: Pick<BriefEntryLike, "edited">): EntryOrigin {
  return entry.edited ? "edited" : "derived";
}

/** The source chip's text; entries read from a condensed digest say "digest". */
export function sourceChipLabel(entry: Pick<BriefEntryLike, "source">): string {
  const source = entry.source;
  if (!source) return "source";
  if (source.kind === "project_document") return parseSourceLabel(source.label).fileName;
  if (source.kind === "transcript_digest") return `${source.label} (digest)`;
  return source.label;
}

/** "Your customized settings were found in Writer's Notes. Save to your Writer Profile?" */
export function offerSentence(offer: { supplyPath: "writer_notes" | "attachment" }): string {
  return `Your customized settings were found ${settingsSupplyLabel(offer.supplyPath)}. Save to your Writer Profile?`;
}

/** The settings page prefill link for a generation's save offer. */
export function offerHref(settingsPath: string, generationId: string): string {
  return `${settingsPath}?fromGeneration=${encodeURIComponent(generationId)}`;
}
