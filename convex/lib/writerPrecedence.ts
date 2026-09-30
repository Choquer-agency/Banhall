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
 * despite a Claim Exclusion, which active Feedback reaches a Line, which
 * Glossary Terms the writer's Feedback governs there and which ones a
 * signed-off edit sets aside.
 */
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../../shared/pdSubsections";
import { matchesClaimExclusion, normalizeExclusionMatch } from "./claimExclusionMatcher";
import { sectionParagraphs } from "./tiptapReport";
import type { SectionNumber } from "./orderedChain";
import type { FrozenSummaryPlanInstruction } from "./seedRevisions";

/**
 * One active Feedback instruction and the step it was given on. `givenAt`
 * and `feedbackId` (the Feedback row's creation time and id) say when the
 * writer gave it, so the instructions that govern one term are ordered by
 * time (Greptile round 4, P1). Never sent to a model.
 */
export type WriterFeedback = {
  roleId: PdSubsectionRoleId;
  instruction: string;
  givenAt?: number;
  feedbackId?: string;
};

/** A Glossary Term a signed-off edit took out of a Line, and why. */
export type GlossarySetAside = { term: string; reason: string };

/**
 * A Glossary Term the writer's active Feedback names in a Line, with every
 * instruction that names it: that Feedback governs the term there, not the
 * Brief (2026-09-29 second, rule 5(c)). `inSignedOffIdea` (2026-09-30,
 * second): an unedited signed-off idea of the Line uses the term, and the
 * Feedback still governs it, since renaming is wording, not meaning. Absent
 * otherwise, so those requests keep their bytes.
 */
export type FeedbackGovernedTerm = {
  term: string;
  feedback: WriterFeedback[];
  inSignedOffIdea?: true;
};

/**
 * 2026-09-30 (second): what the drafting block, the Self-check label and the
 * repair issue add after a governed term an unedited signed-off idea uses.
 */
export const GOVERNED_IN_IDEA_CLAUSE =
  ", also where a signed-off idea uses the term (renaming it is wording, not meaning: keep the idea's meaning)";

/** What the writer's wording decides about the Brief's Glossary Terms in a Line. */
export type GlossaryPrecedence = {
  /** Set aside by a signed-off edit: not enforced, no Self-check label. */
  setAside: GlossarySetAside[];
  /** Governed by the writer's Feedback: checked by its own Self-check label. */
  governed: FeedbackGovernedTerm[];
};

export type ClaimExclusionLike = { text: string; exactExcerpt?: string; reason?: string };

/** A signed-off idea the writer kept although it matches a Claim Exclusion. */
export type ConfirmedConflict = {
  itemId: string;
  wording: string[];
  /** The Claim Exclusions of the frozen Brief the idea matches. */
  exclusions: ClaimExclusionLike[];
};

/**
 * Writer or plan text quoted on one line for a prompt (2026-09-29 second,
 * re-check P2). Names are masked at the provider boundary, on the request
 * as sent, and a name counts only at a word edge. JSON escaping turned a
 * line break before a name into the letters "\n" glued to it, so the name
 * went out unmasked. Here every run of white space and control characters
 * (line breaks and tabs included) reads as one space, so the quoted text
 * keeps the word edges of the raw text; a double quote
 * or a backslash is escaped with a backslash, which is no letter, so the
 * text cannot end its quotation or put a block marker on a line of its own.
 */
export function quoteForPrompt(text: string): string {
  // Privacy re-check P1-2: a control character becomes a space like a line
  // break, never nothing, so it cannot glue a word to a name.
  const flat = text
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `"${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The words an idea is named by in a Compliance Note or a prompt. A long
 * idea is shortened at a word boundary (privacy re-check P3), so no name is
 * cut into a fragment that masking cannot recognize.
 */
export function ideaWords(wording: readonly string[], maxChars = 160): string {
  const words = wording.join(" ").replace(/\s+/g, " ").trim();
  if (words.length <= maxChars) return words;
  const cut = words.slice(0, maxChars - 2);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > 0 ? cut.slice(0, boundary).trimEnd() : ""}...`;
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
 * does. In the order the writer gave it (the row's creation time, then its
 * id), whatever the step, so every request that carries the Line's Feedback
 * can say the latest one wins where instructions disagree; rows without a
 * time keep the order they came in (the loader sorts by creation time).
 */
export function feedbackForLine(
  section: SectionNumber,
  rows: ReadonlyArray<{
    roleId: PdSubsectionRoleId;
    instruction: string;
    status: string;
    _creationTime?: number;
    _id?: string;
  }>,
  skippedRoleIds: readonly PdSubsectionRoleId[] = []
): WriterFeedback[] {
  const last = lastStepOrderOf(section);
  const skipped = new Set(skippedRoleIds);
  return inOrderGiven(rows
    .filter((row) =>
      row.status === "active" &&
      !skipped.has(row.roleId) &&
      row.instruction.trim() !== "" &&
      stepOrder(row.roleId) <= last
    )
    .map((row) => ({
      roleId: row.roleId,
      instruction: row.instruction.trim(),
      ...(row._creationTime !== undefined ? { givenAt: row._creationTime } : {}),
      ...(row._id !== undefined ? { feedbackId: String(row._id) } : {}),
    })));
}

/**
 * Instructions in the order the writer gave them: by creation time, then
 * id. Without a time on every one (older callers, fixtures), the order they
 * came in is kept.
 */
function inOrderGiven(feedback: readonly WriterFeedback[]): WriterFeedback[] {
  if (!feedback.every((entry) => entry.givenAt !== undefined)) return [...feedback];
  return feedback
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      (a.entry.givenAt ?? 0) - (b.entry.givenAt ?? 0) ||
      (a.entry.feedbackId ?? "").localeCompare(b.entry.feedbackId ?? "") ||
      a.index - b.index)
    .map(({ entry }) => entry);
}

/** Lower case, curly apostrophes plain, hyphens and runs of spaces as one space. */
function normalizeWords(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/[-\u2010-\u2015_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The simple singular and plural forms of a term's last word: an added "s"
 * or "es" ("head", "heads"; "batch", "batches"), and "y" and "ies" after a
 * consonant ("assembly", "assemblies"; review P3-3).
 */
function lastWordForms(word: string): string[] {
  const forms = new Set([word]);
  if (/(?:s|x|z|ch|sh)es$/.test(word) && word.length > 4) forms.add(word.slice(0, -2));
  if (/s$/.test(word) && !/ss$/.test(word) && word.length > 3) forms.add(word.slice(0, -1));
  if (/[^aeiou]ies$/.test(word) && word.length > 4) forms.add(`${word.slice(0, -3)}y`);
  if (/[^aeiouy]y$/.test(word)) forms.add(`${word.slice(0, -1)}ies`);
  if (/(?:s|x|z|ch|sh)$/.test(word)) forms.add(`${word}es`);
  else forms.add(`${word}s`);
  return [...forms];
}

/**
 * Whether a text names a term (2026-09-29, second, review P3-2): case aside,
 * a hyphen and a space alike ("floating-head" names "floating head"), the
 * last word singular or plural, and never inside a longer word. A quote is a
 * word edge (round 4 review P2-1): a term in single or double quotes,
 * straight or curly ('floating head', or with curly marks), is named, and so
 * is a possessive ("floating head's"), but an apostrophe inside a word
 * ("o'floating head") is not an edge.
 */
export function namesTerm(text: string, term: string): boolean {
  const words = normalizeWords(term).split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const last = words.pop() as string;
  const pattern = [
    ...words.map(escapeRegExp),
    `(?:${lastWordForms(last).map(escapeRegExp).join("|")})`,
  ].join(" ");
  return new RegExp(`(?<![a-z0-9])(?<![a-z0-9]')${pattern}(?![a-z0-9])`).test(normalizeWords(text));
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
 * What the writer's wording decides about the Brief's Glossary Terms in a
 * Line (CAP-13 rule 5: Locked Rules, then the signed-off selections, then
 * the writer's active Feedback, then the Brief; Glossary Terms normalize
 * wording only). For each term, in precedence order:
 * - the writer's own edit put or kept it in an idea drafted in the Line: it
 *   stays in force as a Glossary Term (review P3-2: the writer's edits
 *   outrank the Feedback);
 * - else an unedited signed-off idea drafted in the Line uses it: an active
 *   Feedback instruction that reaches the Line and names it governs it all
 *   the same (2026-09-30 second, release suite run 11: renaming a term is
 *   wording, not meaning, and the idea's meaning stays), marked
 *   `inSignedOffIdea`; without such Feedback it stays in force as a Glossary
 *   Term (a term one edit dropped while other ideas keep it is still the
 *   Line's word);
 * - else a signed-off edit to an idea of the Line took it out of the model's
 *   wording: it is set aside, deterministically;
 * - else an active Feedback instruction that reaches the Line names it: that
 *   Feedback governs it (PR #22 lead decision, replacing the ban and endorse
 *   phrase rules): the Brief does not enforce it, the drafting request says
 *   to follow the Feedback for it, and a Self-check label checks that the
 *   text does, whichever way the Feedback points.
 */
export function glossaryTermPrecedence(args: {
  glossaryTerms: readonly string[];
  feedback: readonly WriterFeedback[];
  editedItems: ReadonlyArray<{ original: readonly string[]; edited: readonly string[] }>;
  /** The signed wording of every idea drafted in the Line, kept ideas included. */
  selectionWording: ReadonlyArray<readonly string[]>;
}): GlossaryPrecedence {
  const setAside: GlossarySetAside[] = [];
  const governed: FeedbackGovernedTerm[] = [];
  for (const term of uniqueTerms(args.glossaryTerms)) {
    // Greptile round 4, P1: in the order the writer gave them, so the one
    // listed last is the most recent, whatever step each was given on.
    const naming = inOrderGiven(
      args.feedback.filter((feedback) => namesTerm(feedback.instruction, term))
    );
    // The writer's own edit put or kept the term in an idea: the edit wins.
    if (args.editedItems.some((item) => namesTerm(item.edited.join("\n"), term))) continue;
    if (args.selectionWording.some((wording) => namesTerm(wording.join("\n"), term))) {
      // 2026-09-30 (second): an unedited idea's term is model wording, which
      // the writer's Feedback outranks: renaming it keeps the idea's meaning.
      if (naming.length > 0) {
        governed.push({ term, feedback: naming.map((entry) => ({ ...entry })), inSignedOffIdea: true });
      }
      continue;
    }
    const byEdit = args.editedItems.find((item) =>
      namesTerm(item.original.join("\n"), term) && !namesTerm(item.edited.join("\n"), term)
    );
    if (byEdit) {
      setAside.push({
        term,
        reason: `the writer's edit to the signed-off idea "${ideaWords(byEdit.edited, 120)}" took this term out`,
      });
      continue;
    }
    if (naming.length > 0) {
      governed.push({ term, feedback: naming.map((entry) => ({ ...entry })) });
    }
  }
  return { setAside, governed };
}

/** What decides between several instructions that govern one term (round 4 review P3-2). */
export const GOVERNING_FEEDBACK_TIE_BREAK = "where they disagree, the latest instruction wins";

/**
 * The writer's Feedback for a governed term, as the drafting block, the
 * Self-check label, the repair issue, the row and the consistency pass quote
 * it: 'on Company / Context: "..."'. Several are listed in the order the
 * writer gave them (glossaryTermPrecedence), joined by "; then ", and end
 * with the tie-break, so the most recent, listed last, wins where they
 * disagree. Each instruction is quoted on one line (quoteForPrompt), so it
 * can never close a block.
 */
export function governingFeedbackPhrase(feedback: readonly WriterFeedback[]): string {
  const listed = feedback
    .map((entry) => `on ${stepTitle(entry.roleId)}: ${quoteForPrompt(entry.instruction)}`)
    .join("; then ");
  return feedback.length > 1 ? `${listed} (${GOVERNING_FEEDBACK_TIE_BREAK})` : listed;
}

/**
 * How a governed term's row ends, from its label's verdicts on the checked
 * text and, when a used repair changed the text, on the final text
 * (Greptile round 4, P2): the final text decides whenever it was checked.
 */
export type GovernedTermState =
  /** The checked text follows the Feedback and is the final text. */
  | "followed"
  /** The checked text does not follow it and is the final text. */
  | "not_followed"
  /** No verdict for the label on the checked text, which is the final text. */
  | "not_checked"
  /** The Self-check call failed as a whole. */
  | "check_failed"
  /** The first check found it not followed; the final text follows it. */
  | "repaired"
  /** The final text follows it (the first check found it followed, or gave no verdict). */
  | "followed_final"
  /** The first check found it not followed, and so does the final check. */
  | "still_not_followed"
  /** The first check found it followed; the repair's final text does not. */
  | "broken_by_repair"
  /** The first check gave no verdict; the final text does not follow it. */
  | "final_not_followed"
  /** The final check gave no verdict for the label. */
  | "final_not_checked"
  /** The final check failed as a whole. */
  | "final_check_failed";

/** Whether a governed term's row is recorded applied. */
export function governedTermFollowed(state: GovernedTermState): boolean {
  return state === "followed" || state === "repaired" || state === "followed_final";
}

/** Whether a governed term's row records a text that does not follow the Feedback. */
export function governedTermNotFollowed(state: GovernedTermState): boolean {
  return state === "not_followed" || state === "still_not_followed" ||
    state === "broken_by_repair" || state === "final_not_followed";
}

/**
 * The Compliance Note reason of a Glossary Term the writer's Feedback
 * governs in a Line. Fixed wording that quotes the writer's instruction and
 * never the model's text; the label's verdicts decide the state. `detail`
 * (app text only) says why a checked text that does not follow it is still
 * the final text: the repair was not used, failed, or changed nothing.
 */
export function governedTermReason(
  feedback: readonly WriterFeedback[],
  state: GovernedTermState,
  detail?: string,
  /** 2026-09-30 (second): an unedited signed-off idea of the Line uses the term. */
  inSignedOffIdea = false
): string {
  const base = inSignedOffIdea
    ? `The writer's Feedback governs this term in this Line, not the Brief, even where a signed-off idea uses it (renaming is wording, not meaning, so the idea's meaning stays): follow the writer's Feedback ${governingFeedbackPhrase(feedback)}.`
    : `The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback ${governingFeedbackPhrase(feedback)}.`;
  switch (state) {
    case "followed":
      return `${base} The Self-check found that the text follows it.`;
    case "not_followed":
      return `${base} The Self-check found that the text does not follow it${detail ? `; ${detail}` : ""}.`;
    case "not_checked":
      return `${base} The Self-check gave no verdict for it, so it is not checked.`;
    case "check_failed":
      return `${base} The Self-check did not run, so it is not checked.`;
    case "repaired":
      return `${base} The Self-check found that the text did not follow it; the repair fixed that, and the check of the final text found that it follows it.`;
    case "followed_final":
      return `${base} The check of the final text after the repair found that it follows it.`;
    case "still_not_followed":
      return `${base} The Self-check found that the text did not follow it, and the check of the final text after the repair found that it still does not.`;
    case "broken_by_repair":
      return `${base} The Self-check found that the text followed it, but the check of the final text after the repair found that it no longer does.`;
    case "final_not_followed":
      return `${base} The check of the final text after the repair found that it does not follow it.`;
    case "final_not_checked":
      return `${base} The repair changed the text, and the check of the final text gave no verdict for it, so it is not checked.`;
    case "final_check_failed":
      return `${base} The repair changed the text, and the check of the final text did not complete, so it is not checked.`;
  }
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
    instruction: FrozenSummaryPlanInstruction;
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

/**
 * Every Claim Exclusion a kept idea matches, named by its words (review
 * P3-7): 'the Claim Exclusion "A"', 'the Claim Exclusions "A" and "B"', or
 * "a Claim Exclusion" when none is known.
 */
export function conflictExclusionsPhrase(exclusions: readonly string[]): string {
  const quoted = exclusions.map(quoteForPrompt);
  if (quoted.length === 0) return "a Claim Exclusion";
  if (quoted.length === 1) return `the Claim Exclusion ${quoted[0]}`;
  return `the Claim Exclusions ${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}
