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

/** The simple singular and plural forms of a term's last word. */
function lastWordForms(word: string): string[] {
  const forms = new Set([word]);
  if (/(?:s|x|z|ch|sh)es$/.test(word) && word.length > 4) forms.add(word.slice(0, -2));
  if (/s$/.test(word) && !/ss$/.test(word) && word.length > 3) forms.add(word.slice(0, -1));
  if (/(?:s|x|z|ch|sh)$/.test(word)) forms.add(`${word}es`);
  else forms.add(`${word}s`);
  return [...forms];
}

/** A term as a pattern over normalized words (see `namesTerm`). */
function termPattern(term: string, flags = ""): RegExp | null {
  const words = normalizeWords(term).split(" ").filter(Boolean);
  if (words.length === 0) return null;
  const last = words.pop() as string;
  const pattern = [
    ...words.map(escapeRegExp),
    `(?:${lastWordForms(last).map(escapeRegExp).join("|")})`,
  ].join(" ");
  return new RegExp(`(?<![a-z0-9'])${pattern}(?![a-z0-9])`, flags);
}

/**
 * Whether a text names a term (2026-09-29, second, review P3-2): case aside,
 * a hyphen and a space alike ("floating-head" names "floating head"), the
 * last word singular or plural, and never inside a longer word.
 */
export function namesTerm(text: string, term: string): boolean {
  return termPattern(term)?.test(normalizeWords(text)) ?? false;
}

const EDGE_BEFORE = "(?<![a-z0-9'])";
const EDGE_AFTER = "(?![a-z0-9'])";

/** Whole words or phrases, over normalized words. */
function wordsPattern(alternatives: readonly string[], flags = ""): RegExp {
  return new RegExp(`${EDGE_BEFORE}(?:${alternatives.join("|")})${EDGE_AFTER}`, flags);
}

/**
 * Words that rule out what follows them in the same stretch: "never the
 * floating head", "don't call it", "avoid", "instead of", "stop calling".
 * Contractions with or without the apostrophe ("don't", "dont"). "No other"
 * and "not only" endorse, so they do not count.
 */
const RULING_OUT = wordsPattern([
  "never",
  "not(?! only)",
  "no(?! other| one else)",
  "no longer",
  "nor",
  "cannot",
  "without",
  "[a-z]+n't",
  "(?:do|does|did|wo|should|would|could|ca|is|are|was|were|must|need)nt",
  "avoid(?:s|ed|ing)?",
  "instead of",
  "rather than",
  "in place of",
  "(?:stop|stops|stopped|quit) (?:calling|using|saying|writing|referring)",
  "drop(?:s|ped|ping)?",
  "remov(?:e|es|ed|ing)",
  "delet(?:e|es|ed|ing)",
  "ban(?:s|ned)?",
  "forbid(?:s|den)?",
  "get rid of",
  "stay away from",
  "steer clear of",
]);

/**
 * Words whose object is the old word until a switch word brings in the new
 * one: "replace X with Y", "change X to Y", "rename X as Y", "switch from X
 * to Y".
 */
const REPLACING = wordsPattern([
  "replac(?:e|es|ed|ing)",
  "swap(?:s|ped|ping)?(?: out)?",
  "chang(?:e|es|ed|ing)",
  "renam(?:e|es|ed|ing)",
  "switch(?:es|ed|ing)?(?: from)?",
], "g");
const REPLACEMENT_SWITCH = wordsPattern(["with", "by", "for", "to", "into", "as"]);

/**
 * A verdict right after the term in its stretch: "the floating head is
 * wrong", "floating head should not be used", "floating head should be
 * replaced", "floating head -> compliant spindle".
 */
const RULED_OUT_AFTER = new RegExp(
  `^(?:${[
    "(?:is|are|was|were|sounds|reads|feels) (?:wrong|incorrect|inaccurate|outdated|banned|forbidden|off limits|not (?:right|correct|accurate|the right (?:word|term|name)))",
    "(?:should|must|can|may|will|shall)(?: not|n't|not) be (?:used|said|written|mentioned|called|kept)",
    "(?:cannot|can't|cant|won't|wont|shouldn't|shouldnt|mustn't|mustnt) be (?:used|said|written|mentioned|called|kept)",
    "(?:should|must|needs to|has to|is to|will) be (?:replaced|changed|renamed|dropped|removed|avoided|retired)",
    "(?:is|are) (?:no longer|not) (?:used|right|correct|accurate)",
    "(?:is|are) out",
  ].join("|")})${EDGE_AFTER}|^(?:=?>|\u2192|\u21d2)`
);

/**
 * Where a new instruction starts inside a sentence: at "but" ("not the
 * floating head but the compliant spindle"), and at a comma, "and" or "then"
 * that brings in a verb of its own ("Don't call it X, call it Y"; "Stop
 * saying X and say Y"; "Avoid X, because Y is the shop's word").
 */
const STRETCH_BREAK = new RegExp(
  `${EDGE_BEFORE}but${EDGE_AFTER}|(?:,|${EDGE_BEFORE}(?:and|then)${EDGE_AFTER}) ?(?:(?:and|then|so|please|just|instead|always) )*(?=(?:call|calling|use|say|write|keep|prefer|stick|go|refer|name|describe|always|which|because|since|it's|it is)${EDGE_AFTER})`
);

/** Whether the words before a term, in its stretch, rule it out. */
function rulesOutBefore(before: string): boolean {
  if (RULING_OUT.test(before)) return true;
  let afterReplacing = -1;
  for (const match of before.matchAll(REPLACING)) afterReplacing = match.index + match[0].length;
  return afterReplacing >= 0 && !REPLACEMENT_SWITCH.test(before.slice(afterReplacing));
}

/**
 * Whether a Feedback instruction rules a term out (2026-09-29 second, rule
 * 5(c), PR #22 review G10): it rejects the term ("never the floating head",
 * "don't say floating head", "avoid", "stop calling it", "the floating head
 * is wrong") or replaces it ("replace the floating head with ...", "the
 * compliant spindle instead of the floating head", "call it Y, not X"). A
 * mention that uses or endorses the term ("call the deburring tool the
 * floating head") does not. The cue comes before the term in the same
 * stretch of the instruction (a sentence, cut again at "but" and where a new
 * verb starts after a comma or "and"), or a verdict follows it there. Case
 * aside, hyphens and spaces alike, curly and plain apostrophes alike. One
 * mention that rules the term out is enough.
 */
export function feedbackRulesOutTerm(instruction: string, term: string): boolean {
  const pattern = termPattern(term, "g");
  if (!pattern) return false;
  for (const sentence of instruction.split(/[.;:!?\r\n]+/)) {
    for (const stretch of normalizeWords(sentence).split(STRETCH_BREAK)) {
      for (const match of stretch.matchAll(pattern)) {
        const before = stretch.slice(0, match.index);
        const after = stretch
          .slice(match.index + match[0].length)
          .replace(/^[\s"'`)\]]+/, "");
        if (rulesOutBefore(before) || RULED_OUT_AFTER.test(after)) return true;
      }
    }
  }
  return false;
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
 * 5: Locked Rules, then the signed-off selections, then the writer's active
 * Feedback, then the Brief; Glossary Terms normalize wording only). A term
 * is set aside when an active Feedback instruction that reaches the Line
 * rules it out (rejects it or replaces it with another word; a mention that
 * endorses it keeps it in force, PR #22 review G10), or when the writer's
 * edit to a signed-off idea of the Line took it out of the model's wording,
 * and no signed-off idea drafted in the Line still uses it (review P3-2: an
 * idea that uses it outranks the Feedback, and a term one edit dropped
 * while other ideas keep it is still the Line's word). The Brief then
 * neither requires nor replaces wording with it in that Line.
 */
export function glossaryTermsSetAside(args: {
  glossaryTerms: readonly string[];
  feedback: readonly WriterFeedback[];
  editedItems: ReadonlyArray<{ original: readonly string[]; edited: readonly string[] }>;
  /** The signed wording of every idea drafted in the Line, kept ideas included. */
  selectionWording: ReadonlyArray<readonly string[]>;
}): GlossarySetAside[] {
  const out: GlossarySetAside[] = [];
  for (const term of uniqueTerms(args.glossaryTerms)) {
    if (args.selectionWording.some((wording) => namesTerm(wording.join("\n"), term))) continue;
    const byFeedback = args.feedback.find((feedback) =>
      feedbackRulesOutTerm(feedback.instruction, term)
    );
    if (byFeedback) {
      out.push({
        term,
        reason: `the writer's Feedback on ${stepTitle(byFeedback.roleId)} rules out this term: "${byFeedback.instruction}"`,
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
