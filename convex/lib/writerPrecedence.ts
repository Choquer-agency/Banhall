/**
 * 2026-09-29 (second): the writer's decisions that outrank the Brief in
 * drafting (CAP-13 rules 4 and 5). Pure: no database, no model.
 *
 * Release suite run 6 (commit c8ce1fe2) showed two ways the Brief beat the
 * writer:
 * - "Exclusion-matching selection": the writer kept an idea at sign-off
 *   although it matches a Claim Exclusion, and the drafted Line left it out.
 * - "Corrected then withdrawn Feedback": the writer's active Feedback said
 *   "call the deburring tool the compliant spindle, never the floating head",
 *   and every Line said "floating head" because the Brief's Glossary Term was
 *   enforced.
 *
 * This module decides, from stored rows only, which ideas the writer kept
 * despite a Claim Exclusion, which active Feedback reaches a Line and which
 * Glossary Terms the writer's own wording sets aside there.
 */
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../../shared/pdSubsections";
import { matchesClaimExclusion, normalizeExclusionMatch } from "./claimExclusionMatcher";
import { containsTerm } from "./editedTerms";
import { sectionParagraphs } from "./tiptapReport";
import type { SectionNumber } from "./orderedChain";

/** One active Feedback instruction and the step it was given on. */
export type WriterFeedback = { roleId: PdSubsectionRoleId; instruction: string };

/** A Glossary Term the writer's wording governs in a Line, and why. */
export type GlossarySetAside = { term: string; reason: string };

export type ClaimExclusionLike = { text: string; exactExcerpt?: string; reason?: string };

/** A signed-off idea the writer kept although it matches a Claim Exclusion. */
export type ConfirmedConflict = {
  itemId: string;
  wording: string[];
  /** The Claim Exclusions of the frozen Brief the idea matches. */
  exclusions: ClaimExclusionLike[];
};

/** The words an idea is named by in a Compliance Note or a prompt. */
export function ideaWords(wording: readonly string[], maxChars = 160): string {
  const words = wording.join(" ").replace(/\s+/g, " ").trim();
  return words.length > maxChars ? `${words.slice(0, maxChars - 1).trimEnd()}...` : words;
}

export function stepTitle(roleId: PdSubsectionRoleId): string {
  return PD_SUBSECTIONS.find((role) => role.roleId === roleId)?.title ?? roleId;
}

function stepOrder(roleId: PdSubsectionRoleId): number {
  return PD_SUBSECTIONS.find((role) => role.roleId === roleId)?.order ?? Number.MAX_SAFE_INTEGER;
}

/** The last step (by order) whose content a Line holds. */
function lastStepOrderOf(section: SectionNumber): number {
  const key = `s${section}`;
  return Math.max(
    ...PD_SUBSECTIONS.filter((role) => role.section === key).map((role) => role.order)
  );
}

/**
 * The active Feedback that reaches a Line. While the ideas were written, an
 * active instruction reached its own step and every later step (CAP-4), so it
 * reaches every Line that holds its step or a later one: Feedback on Company
 * / Context reaches Lines 242, 244 and 246, Feedback on Experimentation Lines
 * 244 and 246. Withdrawn Feedback, and Feedback suspended by a Skip, never
 * does. In step order, then in the order given.
 */
export function feedbackForLine(
  section: SectionNumber,
  rows: ReadonlyArray<{ roleId: PdSubsectionRoleId; instruction: string; status: string }>,
  skippedRoleIds: readonly PdSubsectionRoleId[] = []
): WriterFeedback[] {
  const last = lastStepOrderOf(section);
  const skipped = new Set(skippedRoleIds);
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) =>
      row.status === "active" &&
      !skipped.has(row.roleId) &&
      row.instruction.trim() !== "" &&
      stepOrder(row.roleId) <= last
    )
    .sort((a, b) => stepOrder(a.row.roleId) - stepOrder(b.row.roleId) || a.index - b.index)
    .map(({ row }) => ({ roleId: row.roleId, instruction: row.instruction.trim() }));
}

/** Whether a text names a term, word for word, singular or plural. */
function namesTerm(text: string, term: string): boolean {
  return containsTerm(text, term) || containsTerm(text, `${term}s`) || containsTerm(text, `${term}es`);
}

function uniqueTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

/**
 * The Glossary Terms the writer's own wording governs in a Line (CAP-13 rule
 * 5: the signed-off selections and the writer's instructions outrank the
 * Brief; Glossary Terms normalize wording only). A term is set aside when an
 * active Feedback instruction that reaches the Line names it (to use another
 * word for the same thing, or to forbid it), or when the writer's edit to a
 * signed-off idea of the Line took it out of the model's wording. The Brief
 * then neither requires nor replaces wording with it in that Line.
 */
export function glossaryTermsSetAside(args: {
  glossaryTerms: readonly string[];
  feedback: readonly WriterFeedback[];
  editedItems: ReadonlyArray<{ original: readonly string[]; edited: readonly string[] }>;
}): GlossarySetAside[] {
  const out: GlossarySetAside[] = [];
  for (const term of uniqueTerms(args.glossaryTerms)) {
    const byFeedback = args.feedback.find((feedback) => namesTerm(feedback.instruction, term));
    if (byFeedback) {
      out.push({
        term,
        reason: `the writer's Feedback on ${stepTitle(byFeedback.roleId)} names this term: "${byFeedback.instruction}"`,
      });
      continue;
    }
    const byEdit = args.editedItems.find((item) =>
      namesTerm(item.original.join("\n"), term) && !namesTerm(item.edited.join("\n"), term)
    );
    if (byEdit) {
      out.push({
        term,
        reason: `the writer's edit to the signed-off idea "${ideaWords(byEdit.edited, 120)}" took this term out`,
      });
    }
  }
  return out;
}

/** Whether a Claim Exclusion's words stand in a text (the deterministic check's match). */
function exclusionNeedles(exclusion: ClaimExclusionLike): string[] {
  return [exclusion.text, exclusion.exactExcerpt ?? ""].filter(
    (needle) => normalizeExclusionMatch(needle).trim() !== ""
  );
}

/**
 * The signed-off ideas of a Line the writer kept despite a Claim Exclusion
 * (`confirmedExclusion`), with the exclusions each one matches.
 */
export function confirmedConflictsOf(
  planChecks: ReadonlyArray<{
    itemId?: string;
    instruction: "cover" | "skip";
    confirmedExclusion: boolean;
    wording: readonly string[];
  }>,
  claimExclusions: readonly ClaimExclusionLike[]
): ConfirmedConflict[] {
  return planChecks.flatMap((check) =>
    check.itemId && check.instruction === "cover" && check.confirmedExclusion
      ? [{
          itemId: check.itemId,
          wording: [...check.wording],
          exclusions: claimExclusions.filter((exclusion) =>
            matchesClaimExclusion(check.wording, exclusion.text, exclusion.exactExcerpt)
          ),
        }]
      : []
  );
}

/**
 * The 0-based paragraph of a text that holds the excluded words a kept idea
 * carries, or undefined when none does as written.
 */
export function confirmedConflictParagraph(
  text: string,
  conflict: Pick<ConfirmedConflict, "exclusions">
): number | undefined {
  const paragraphs = sectionParagraphs(text).map(normalizeExclusionMatch);
  for (const exclusion of conflict.exclusions) {
    for (const needle of exclusionNeedles(exclusion)) {
      const normalized = normalizeExclusionMatch(needle);
      const index = paragraphs.findIndex((paragraph) => paragraph.includes(normalized));
      if (index >= 0) return index;
    }
  }
  return undefined;
}

/** The first Claim Exclusion a kept idea matches, by its words. */
export function conflictExclusionText(conflict: Pick<ConfirmedConflict, "exclusions">): string {
  return conflict.exclusions[0]?.text ?? "a Brief Claim Exclusion";
}
