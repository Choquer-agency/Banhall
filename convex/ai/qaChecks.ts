/**
 * Deterministic QA checks that run BEFORE the AI QA agent.
 * These handle structural/pattern checks that the LLM struggles with,
 * producing pre-computed facts that get injected into the QA prompt.
 *
 * PSOS-49: checks that enforce waivable house-style categories (banned words,
 * repetition caps, CRA opener phrases) accept the writer's StyleOverrides and
 * report "WAIVED" instead of findings for waived categories. The because-clause
 * check is CRA methodology and is never waivable.
 */

import {
  BANNED_SCAN_TERMS,
  bannedTermPattern,
} from "../../shared/bannedWords";
import {
  NO_STYLE_OVERRIDES,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { findDashConnectors } from "../../shared/humanProse";
import { NOTE_MARKER_RE } from "../lib/lineLimits";
import { pdSubsectionRoleLabel } from "../../shared/pdSubsections";

// ─── Check 1: CRA opener detection for 246 advancement paragraphs ───────────
// Only runs when `openingClauses` is enforced (off by default since
// 2026-09-15). With no mandated paragraph count, every paragraph after the
// opening summary is scanned (PR #16 review: a fixed P2-P4 window missed
// later advancement paragraphs); the QA prompt decides by content which of
// them are advancement paragraphs. The scan reports first sentences and
// PASS/FAIL only.

const CRA_OPENER_PATTERNS = [
  /^through\s+(systematic\s+|this\s+)?(investigation|experimental\s+work)/i,
  /^it\s+was\s+(determined|established)\s+that/i,
  /^the\s+(experimental|investigative)\s+work\s+(determined|established|revealed|demonstrated)\s+that/i,
  /^the\s+investigation\s+(established|determined|revealed|demonstrated)\s+that/i,
  // 2026-10-29 (third), review round 1 (P3-6): item 1d's per-uncertainty opener.
  /^in\s+addressing\s+the\s+uncertainty\s+(around|regarding|about|of)\b/i,
];

function getFirstSentence(paragraph: string): string {
  const match = paragraph.match(/^[^.]+\./);
  return match ? match[0].trim() : paragraph.trim();
}

export interface CRAOpenerResult {
  count: number;
  total: number;
  results: Array<{
    paragraph: number;
    passes: boolean;
    firstSentence: string;
  }>;
}

export function checkCRAOpeners(section246Text: string): CRAOpenerResult {
  const paragraphs = section246Text.split(/\n\n+/).filter((p) => p.trim());
  // Index 0 is the overall-advancement summary; everything after it is a
  // candidate advancement paragraph (status/goal paragraphs are excluded by
  // the QA prompt on content, not by position).
  const advancementParagraphs = paragraphs.slice(1);

  const results = advancementParagraphs.map((p, i) => {
    const firstSentence = getFirstSentence(p);
    const passes = CRA_OPENER_PATTERNS.some((pattern) =>
      pattern.test(firstSentence)
    );
    return {
      paragraph: i + 2, // 1-based, after the opening paragraph
      passes,
      firstSentence: firstSentence.slice(0, 120) + (firstSentence.length > 120 ? "..." : ""),
    };
  });

  return {
    count: results.filter((r) => r.passes).length,
    total: results.length,
    results,
  };
}

// ─── Check 2: BECAUSE clause detection throughout 242 ──────────────────────────

export interface BecauseClauseResult {
  uncertaintyCount: number;
  withBecause: number;
  details: Array<{
    excerpt: string;
    hasBecause: boolean;
  }>;
}

/**
 * Review round 4 (A2): sentence ends that are not abbreviations ("Acme Inc.",
 * "e.g.", "No. 4") or initials ("J. Ortiz"), with a [GAP: ...] or
 * [INFERRED: ...] marker read as one unit, so a full stop inside it never
 * ends a sentence. Review round 5 (P3-2): an abbreviation or a single capital
 * still ends the sentence when a common sentence opener follows ("under load
 * B. The rig ran...", "from Acme Inc. The team..."); "A" followed by a full
 * stop is another initial ("J. A. Ortiz"), and a word joined by a hyphen
 * ("A-frame") is not an opener either (review round 6, P3-4).
 */
const ABBREVIATION_END = /\b(?:inc|ltd|co|corp|e\.g|i\.e|etc|vs|no|nos|fig|dr|mr|mrs|ms|st|approx)\.$/i;
const INITIAL_END = /(?:^|\s)\p{Lu}\.$/u;
const SENTENCE_OPENER =
  /^\s+(?:The|This|These|Those|It|Its|A|An|Because|Given|We|Our|In|For|When|After|Before|During)\b(?![.\-])/;

function sentencesOf(paragraph: string): string[] {
  // Marker text never holds a sentence end: its punctuation is masked,
  // keeping every index.
  const masked = paragraph.replace(NOTE_MARKER_RE, (marker) => marker.replace(/[.!?]/g, "_"));
  const sentences: string[] = [];
  let start = 0;
  const boundary = /[.!?](?=\s+)/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(masked)) !== null) {
    const end = match.index + 1;
    const piece = masked.slice(start, end);
    if ((ABBREVIATION_END.test(piece) || INITIAL_END.test(piece)) && !SENTENCE_OPENER.test(masked.slice(end))) continue;
    sentences.push(paragraph.slice(start, end));
    const rest = /\s+/y;
    rest.lastIndex = end;
    rest.exec(masked);
    start = rest.lastIndex;
  }
  sentences.push(paragraph.slice(start));
  return sentences.filter((sentence) => sentence.trim());
}

/**
 * Review round 4 (wording P2-1): a [GAP: ...] stands in for the cause only
 * when it asks for a reason. Review round 5 (P3-3): whole words only, so "a
 * reasonable cycle count" asks for no reason.
 */
const REASON_GAP = /\[GAP:[^\]]*\b(?:why|reasons?|caus(?:e|es|ed))\b/i;
const NEXT_SENTENCE_CAUSE = /^(?:\[GAP:[^\]]*\b(?:why|reasons?|caus(?:e|es|ed))\b|because\b|this\s+(?:is|was)\s+because\b|given\s+that\b)/i;

export function checkBecauseClauses(section242Text: string): BecauseClauseResult {
  const paragraphs = section242Text.split(/\n\n+/).filter((p) => p.trim());


  // Split on uncertainty markers
  const uncertaintyMarkers = [
    /it\s+was\s+uncertain\s+whether/gi,
    /it\s+remained\s+uncertain/gi,
    /uncertainty\s+existed\s+(regarding|as\s+to|about)/gi,
  ];

  // Find all uncertainty statements by splitting on sentences, paragraph by
  // paragraph, so the sentence after each one is known.
  const uncertaintySentences: Array<{ excerpt: string; hasBecause: boolean }> = [];

  for (const paragraph of paragraphs) {
    const sentences = sentencesOf(paragraph);
    sentences.forEach((sentence, index) => {
      const isUncertainty = uncertaintyMarkers.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(sentence);
      });
      if (!isUncertainty) return;
      const next = sentences[index + 1] ?? "";
      uncertaintySentences.push({
        excerpt: sentence.slice(0, 100) + (sentence.length > 100 ? "..." : ""),
        // 2026-10-29 (third): a cause given first with "given that" counts too.
        // After the live rerun (R6b): so does a [GAP: ...] for the reason, in
        // the sentence or right after it, and a cause in the next sentence
        // ("Because...", "This is because...", "This was because...",
        // "Given that..."). Review round 4: only a gap that asks why (P2-1),
        // and sentence ends that skip abbreviations and markers (A2).
        hasBecause:
          /\bbecause\b|\bgiven\s+that\b/i.test(sentence) ||
          REASON_GAP.test(sentence) ||
          NEXT_SENTENCE_CAUSE.test(next.trim()),
      });
    });
  }

  return {
    uncertaintyCount: uncertaintySentences.length,
    withBecause: uncertaintySentences.filter((s) => s.hasBecause).length,
    details: uncertaintySentences,
  };
}

// ─── Check 3: Banned word scan ──────────────────────────────────────────────
// Term list derived from shared/bannedWords.ts (the scrubber's own tables plus
// scan-only terms) so the scanner can never diverge from the scrubber.

export interface BannedWordResult {
  found: Array<{
    word: string;
    section: string;
    context: string;
  }>;
}

export function checkBannedWords(
  section242: string,
  section244: string,
  section246: string
): BannedWordResult {
  const found: BannedWordResult["found"] = [];

  function scanSection(text: string, sectionName: string) {
    const lower = text.toLowerCase();
    for (const word of BANNED_SCAN_TERMS) {
      const regex = bannedTermPattern(word);
      let match;
      while ((match = regex.exec(lower)) !== null) {
        // Get surrounding context
        const start = Math.max(0, match.index - 30);
        const end = Math.min(lower.length, match.index + match[0].length + 30);
        const context = "..." + text.slice(start, end).replace(/\n/g, " ") + "...";
        found.push({ word, section: sectionName, context });
      }
    }
  }

  scanSection(section242, "242");
  scanSection(section244, "244");
  scanSection(section246, "246");

  return { found };
}

// ─── Check 4: Repetition count ──────────────────────────────────────────────

export interface RepetitionResult {
  systematicInvestigation: number;
  technologicalUncertainty: number;
}

export function checkRepetition(
  section242: string,
  section244: string,
  section246: string
): RepetitionResult {
  const fullReport = `${section242}\n\n${section244}\n\n${section246}`.toLowerCase();

  const siCount = (fullReport.match(/systematic\s+investigation/g) ?? []).length +
    (fullReport.match(/systematic\s+experimentation/g) ?? []).length;
  const tuCount = (fullReport.match(/technological\s+uncertaint/g) ?? []).length;

  return {
    systematicInvestigation: siCount,
    technologicalUncertainty: tuCount,
  };
}

// ─── Per-section deterministic findings (iterative mode) ────────────────────
// No LLM — the writer is the QA during section-by-section review. Reuses the
// per-check helpers above, scoped to the one section being reviewed.

// ─── Check 5: Dash connectors (em dash and stand-ins) ───────────────────────
// Always on: reading as machine-written is not a waivable style preference.

export interface DashConnectorResult {
  found: Array<{ token: string; section: string; context: string }>;
}

export function checkDashConnectors(
  section242: string,
  section244: string,
  section246: string
): DashConnectorResult {
  const found: DashConnectorResult["found"] = [];
  for (const [text, section] of [
    [section242, "242"],
    [section244, "244"],
    [section246, "246"],
  ] as const) {
    for (const hit of findDashConnectors(text)) {
      found.push({ token: hit.token, section, context: hit.context });
    }
  }
  return { found };
}

// ─── Check 6: Notes to the writer in report text ────────────────────────────
// 2026-10-30 (owner, "please fix all properly", item 3): Locked, never
// waived. A rerun's report sentences read "The materials do not report what
// that testing showed.", "Testing was reported; individual runs are not
// described." and "The client reports that...": notes to the writer, which
// belong inside a [GAP: ...] or [INFERRED: ...] marker. Narrow on purpose,
// since a hit starts a repair: a document noun right after "the" (or
// "these", "those") as the subject of a reporting verb, "the client" saying
// or reporting that something is so, and "is not stated", "described" or
// "reported" at the end of a clause. Text inside a marker is a note already
// and is never read.
//
// Review round 1 (wording P1): good technical prose was flagged ("The
// sources record every change...", "The client confirms each batch...",
// "The responses indicated a lag...", "... is not documented.", "The
// transcripts did not show speaker labels."). Bare "sources" and
// "responses" are no longer document nouns (only source files and
// documents, interview or written responses, and written answers are);
// "the client" counts only for saying, stating, recalling, estimating or
// mentioning, and for reporting or noting "that"; the passive ending is cut
// to stated and described, and (review round 2) "reported" only after a
// result, finding, outcome, status or run; and the verbs that also name what a
// system does (record, indicate, detail, show, provide, include, cover) are
// left out. Notes in other words ("The Q&A file does not say...", "It is not
// stated whether...") are left to the Self-check's and QA's rules.

/** The reporting verbs, in the forms a note uses. */
const REPORT_VERBS =
  "say|says|said|state|states|stated|describe|describes|described|mention|mentions|mentioned|report|reports|reported|note|notes|noted|explain|explains|explained|confirm|confirms|confirmed";
/** Base forms after "do not". */
const REPORT_BASES = "say|state|describe|mention|report|note|explain|specify|confirm";
/** The words that may stand between "the" and the noun ("the written answers"). */
const SOURCE_MODIFIER = "(?:(?:client's|written|interview|project)\\s+)?";
/** Document nouns other than "materials", which also "give" a fact or "give no" fact. */
const SOURCE_NOUNS =
  `(?:(?:interview|written|client's)\\s+responses?|${SOURCE_MODIFIER}(?:source\\s+(?:files?|documents?|texts?|materials?)|interviews?|interviewees?|transcripts?|answers?))`;
/** A participle after the noun that still names the same documents ("the materials provided"). */
const SOURCE_PARTICIPLE = "(?:\\s+(?:provided|supplied|available|given|received))?";
const NEGATION = "(?:(?:do|does|did)\\s+not|don't|doesn't|didn't)\\s+(?:(?:clearly|explicitly|directly|otherwise)\\s+)?";
const MATERIALS = `${SOURCE_MODIFIER}materials`;

const NOTE_PATTERNS: readonly RegExp[] = [
  // "The interview does not describe ...", "the answers do not give ...".
  new RegExp(`\\b(?:the|these|those)\\s+${SOURCE_NOUNS}${SOURCE_PARTICIPLE}\\s+${NEGATION}(?:${REPORT_BASES}|give)\\b`, "giu"),
  // "The materials do not report ...": for "materials" the reporting verbs only.
  new RegExp(`\\b(?:the|these|those)\\s+${MATERIALS}${SOURCE_PARTICIPLE}\\s+${NEGATION}(?:${REPORT_BASES})\\b`, "giu"),
  // "The answers give no date.", "the materials give no status ...": for
  // "materials" only before a word for a fact, so "the materials give no
  // sign of fatigue" stays.
  new RegExp(`\\b(?:the|these|those)\\s+${SOURCE_NOUNS}${SOURCE_PARTICIPLE}\\s+(?:give|gives|gave)\\s+no\\b`, "giu"),
  new RegExp(`\\b(?:the|these|those)\\s+${MATERIALS}${SOURCE_PARTICIPLE}\\s+(?:give|gives|gave|provide|provides|provided)\\s+no\\s+(?:status|results?|dates?|figures?|details?|reasons?|outcomes?|information|account|description)\\b`, "giu"),
  // "The transcript states ...", "the materials report ...".
  new RegExp(`\\b(?:the|these|those)\\s+(?:${SOURCE_NOUNS}|${MATERIALS})${SOURCE_PARTICIPLE}\\s+(?:${REPORT_VERBS})\\b`, "giu"),
  // "The client reports that ...", "the client said ...", "the client did not say ...".
  new RegExp(`\\bthe\\s+client\\s+(?:(?:reports|reported|notes|noted)\\s+that\\b|(?:says|said|states|stated|recalls|recalled|estimates|estimated|mentioned)\\b|${NEGATION}(?:say|state|mention|report)\\b)`, "giu"),
  // "Individual runs are not described.", "Findings about it are not stated."
  /\b(?:is|are|was|were)\s+not\s+(?:stated|described)(?=\s*(?:[.;:!?)]|$))/giu,
  // Review round 2 (P3-4): "reported" only after a word for what the work
  // found, so "dropped messages were not reported" stays.
  /\b(?:results?|findings?|outcomes?|status|runs?)\s+(?:is|are|was|were)\s+not\s+reported(?=\s*(?:[.;:!?)]|$))/giu,
];

/**
 * After the live rerun (R1): a repair hedged a fact by attribution ("The
 * company reports that...", "The client states that..."). The company, the
 * team, the interviewee, the claimant, a CLIENT placeholder or the
 * claimant's own name reporting, stating, saying or noting "that" is a note
 * to the writer. Only with "that": "The team reported the fault to the
 * vendor" stays.
 */
const ATTRIBUTION_VERBS = "(?:reports|reported|states|stated|says|said|notes|noted)\\s+that\\b";
const ATTRIBUTION_SUBJECTS = "(?:\\bthe\\s+(?:company|interviewee|claimant)|\\[CLIENT_\\d+(?:_[A-Z]+)?\\])";
const ATTRIBUTION = new RegExp(`${ATTRIBUTION_SUBJECTS}\\s+${ATTRIBUTION_VERBS}`, "giu");
/**
 * Review round 4 (wording P2-2): the team only reporting or stating "that".
 * "The team noted that the seal failed after 200 cycles" and "The team said
 * that..." describe the work and stay.
 */
const TEAM_ATTRIBUTION = /\bthe\s+team\s+(?:reports|reported|states|stated)\s+that\b/giu;
const LEGAL_SUFFIX = /[,\s]+(?:inc|incorporated|ltd|limited|llc|corp|corporation|co|company|plc|gmbh|ulc|lp|llp)\.?$/i;

/**
 * The claimant's name and its short form (without a legal suffix)
 * attributing a fact. Review round 4 (A3): a short form ("AB" of "AB Ltd.")
 * is kept, matched only as written (same case) between word edges, so
 * "CAB reports that" and a lowercase "ab" never match it.
 */
function claimantAttribution(claimantName: string | undefined): RegExp[] {
  const name = claimantName?.trim().replace(/\s+/g, " ");
  if (!name) return [];
  const forms = [...new Set([name, name.replace(LEGAL_SUFFIX, "").trim()])].filter((form) => form.length > 0);
  const pattern = (list: string[], flags: string) => {
    if (list.length === 0) return [];
    const escaped = list
      .sort((left, right) => right.length - left.length)
      .map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"));
    return [new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})\\s+${ATTRIBUTION_VERBS}`, flags)];
  };
  return [
    ...pattern(forms.filter((form) => form.length >= 4), "giu"),
    ...pattern(forms.filter((form) => form.length < 4), "gu"),
  ];
}

export interface NoteToWriterHit {
  /** The words of the note, as they appear in the text. */
  phrase: string;
  index: number;
  /** Short window around the hit for the writer or a judge to locate it. */
  context: string;
}

/**
 * Report sentences that are notes to the writer (2026-10-30): what the
 * sources say or leave out, written as report text. Text inside a [GAP: ...]
 * or [INFERRED: ...] marker is blanked first, so indices still point into
 * the text. Hits are in text order, one per position.
 */
export function findNotesToWriter(rawText: string, options: { claimantName?: string } = {}): NoteToWriterHit[] {
  const text = rawText.replace(NOTE_MARKER_RE, (marker) => " ".repeat(marker.length));
  const hits: NoteToWriterHit[] = [];
  for (const pattern of [...NOTE_PATTERNS, ATTRIBUTION, TEAM_ATTRIBUTION, ...claimantAttribution(options.claimantName)]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      hits.push({
        phrase: match[0],
        index: match.index,
        context: "..." + rawText.slice(start, end).replace(/\r?\n/g, " ") + "...",
      });
    }
  }
  hits.sort((left, right) => left.index - right.index || right.phrase.length - left.phrase.length);
  const kept: NoteToWriterHit[] = [];
  for (const hit of hits) {
    const last = kept[kept.length - 1];
    if (last && hit.index < last.index + last.phrase.length) continue;
    kept.push(hit);
  }
  return kept;
}

/** The words of the Self-check row and the repair fix for notes to the writer. */
export const NOTES_TO_WRITER = {
  instruction: "Locked Rule: report text speaks about the work, never about the sources",
  applied: "no notes to the writer found in the report text",
  fix: "state what the work did, and put what is missing in one [GAP: ...] or the basis of an inference in its [INFERRED: ...] marker",
  rule: "A report sentence never says what the materials, the sources, the interview, the transcript, the answers or the client report or leave out.",
} as const;

// ─── Public background: a detail found only in the web block ─────────────────

/** Capitalized words that are never a detail of their own. */
const WEB_ONLY_IGNORED = new Set(["cra", "sr&ed", "canada", "canadian", "the", "this", "these", "that", "its"]);

export interface WebOnlyHit {
  /** The detail as written in the Line. */
  phrase: string;
  /** Character offset in the paragraph. */
  index: number;
}

function normalizedFigure(figure: string): string {
  return figure.replace(/,/g, "").replace(/\s+/g, "").toLowerCase();
}

/**
 * 2026-11-02 (proposed): a sentence that states as a plain fact a detail
 * found only in the public background block. A detail is a figure (two or
 * more digits, a decimal or a percentage) or a name-like word (a word with
 * a capital inside it or a digit, like "PostgreSQL" or "S3", or a
 * capitalized word that does not open the sentence, like "Debezium"). It is
 * a hit when the background's answers hold it and the evidence the drafter
 * read (analysis, Brief, plan) does not. A sentence followed by an
 * [INFERRED: ...] marker is general practice and is not checked, nor is the
 * text inside a marker. Deterministic and cheap; it finds the clearest
 * leaks only, never a paraphrase.
 */
export function findWebOnlyDetails(paragraph: string, answers: string, evidence: string): WebOnlyHit[] {
  if (!answers.trim()) return [];
  const evidenceLower = evidence.toLowerCase();
  const evidenceFigures = new Set(
    (evidence.match(/\d[\d,]*(?:\.\d+)?\s?%?/g) ?? []).map(normalizedFigure)
  );
  const answerFigures = new Set(
    (answers.match(/\d[\d,]*(?:\.\d+)?\s?%?/g) ?? []).map(normalizedFigure)
  );
  const answerWords = new Set(answers.match(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu) ?? []);
  const hits: WebOnlyHit[] = [];
  // Sentences with their offsets. Full stops inside markers are masked
  // first, so a marker never ends a sentence; a marker written after a
  // sentence's full stop opens the next piece.
  const masked = paragraph.replace(NOTE_MARKER_RE, (marker) => marker.replace(/[.!?]/g, "_"));
  const pieces: Array<{ text: string; index: number }> = [];
  let start = 0;
  for (const end of masked.matchAll(/[.!?]+(?=\s|$)/gu)) {
    const stop = (end.index ?? 0) + end[0].length;
    pieces.push({ text: masked.slice(start, stop), index: start });
    start = stop;
  }
  if (start < masked.length) pieces.push({ text: masked.slice(start), index: start });
  pieces.forEach((piece, at) => {
    const next = pieces[at + 1]?.text.trimStart() ?? "";
    // A marker inside the sentence, or opening the next piece, marks it.
    if (/\[INFERRED:/iu.test(piece.text.replace(/^\s*\[INFERRED:[^\]]*\]/iu, "")) || /^\[INFERRED:/iu.test(next)) return;
    // Text inside a marker is a note to the writer, never checked.
    const text = piece.text.replace(NOTE_MARKER_RE, (marker) => " ".repeat(marker.length));
    const firstWord = /[\p{L}\p{N}]/u.exec(text)?.index ?? 0;
    for (const figure of text.matchAll(/(?<![\p{L}\p{N}.])\d[\d,]*(?:\.\d+)?\s?%?(?![\p{L}\p{N}])/gu)) {
      const raw = figure[0].trim();
      const digits = raw.replace(/\D/g, "");
      if (digits.length < 2 && !raw.includes(".") && !raw.includes("%")) continue;
      const key = normalizedFigure(raw);
      if (answerFigures.has(key) && !evidenceFigures.has(key)) {
        hits.push({ phrase: raw, index: piece.index + (figure.index ?? 0) });
      }
    }
    for (const word of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}.+#-]*[\p{L}\p{N}+#]/gu)) {
      const value = word[0];
      const at = word.index ?? 0;
      const nameLike =
        /\p{Ll}\p{Lu}/u.test(value) ||
        (/\p{L}/u.test(value) && /\d/u.test(value)) ||
        (/^\p{Lu}/u.test(value) && at !== firstWord);
      if (!nameLike || value.length < 3 || WEB_ONLY_IGNORED.has(value.toLowerCase())) continue;
      if (answerWords.has(value) && !evidenceLower.includes(value.toLowerCase())) {
        hits.push({ phrase: value, index: piece.index + at });
      }
    }
  });
  hits.sort((left, right) => left.index - right.index);
  return hits;
}

/** The words of the Self-check row and the repair fix for a web-only detail. */
export const WEB_ONLY_DETAIL = {
  instruction: "Locked Rule: public background is never a fact about the claimant",
  applied: "no detail found only in the public background",
  fix: "remove the detail, or write the sentence as general practice with an [INFERRED: general practice, public source W1: ...] marker naming its source, or put a [GAP: ...] where the Line needs the fact",
  rule: "The public background explains terms and standard practice only. A figure, tool, product or setting found only there is never a fact about what the company did, used or found.",
} as const;

export interface SectionFinding {
  check: "banned_word" | "because_clause" | "cra_opener" | "repetition" | "dash_connector" | "note_to_writer";
  message: string;
}

export function sectionDeterministicFindings(
  section: "s242" | "s244" | "s246",
  text: string,
  overrides: StyleOverrides = NO_STYLE_OVERRIDES,
  /** After the live rerun (R1): the claimant's name, for attribution to it. */
  options: { claimantName?: string } = {}
): SectionFinding[] {
  const findings: SectionFinding[] = [];
  const sectionNumber = section.slice(1);

  if (!overrides.bannedWords) {
    const banned =
      section === "s242"
        ? checkBannedWords(text, "", "")
        : section === "s244"
          ? checkBannedWords("", text, "")
          : checkBannedWords("", "", text);
    for (const f of banned.found) {
      findings.push({
        check: "banned_word",
        message: `Banned word "${f.word}": ${f.context}`,
      });
    }
  }

  for (const hit of findDashConnectors(text)) {
    findings.push({
      check: "dash_connector",
      message: `Dash used as punctuation ("${hit.token}"), reads as machine-written: ${hit.context}`,
    });
  }

  // 2026-10-30: Locked, under every waiver.
  for (const hit of findNotesToWriter(text, options)) {
    findings.push({
      check: "note_to_writer",
      message: `Note to the writer in report text ("${hit.phrase}"); put it in a [GAP: ...] or [INFERRED: ...] marker: ${hit.context}`,
    });
  }

  // Substantive uncertainty checks are independent of the writer's skeleton.
  if (section === "s242") {
    const because = checkBecauseClauses(text);
    for (const d of because.details) {
      if (!d.hasBecause) {
        findings.push({
          check: "because_clause",
          message: `Uncertainty statement missing a BECAUSE clause: "${d.excerpt}"`,
        });
      }
    }
  }

  if (section === "s246" && !overrides.openingClauses && !overrides.reportSkeleton) {
    const openers = checkCRAOpeners(text);
    for (const r of openers.results) {
      if (!r.passes) {
        findings.push({
          check: "cra_opener",
          message: `P${r.paragraph} does not open with a CRA advancement formulation: "${r.firstSentence}"`,
        });
      }
    }
  }

  // Repetition limits are report-wide (3× / 4×), but flag heavy use inside a
  // single section early — cheaper to fix now than post-assembly.
  if (!overrides.repetitionCaps) {
    const lower = text.toLowerCase();
    const si =
      (lower.match(/systematic\s+investigation/g) ?? []).length +
      (lower.match(/systematic\s+experimentation/g) ?? []).length;
    const tu = (lower.match(/technological\s+uncertaint/g) ?? []).length;
    if (si > 2) {
      findings.push({
        check: "repetition",
        message: `"systematic investigation/experimentation" appears ${si}× in section ${sectionNumber} (report-wide limit is 3).`,
      });
    }
    if (tu > 3) {
      findings.push({
        check: "repetition",
        message: `"technological uncertainty" appears ${tu}× in section ${sectionNumber} (report-wide limit is 4).`,
      });
    }
  }
  return findings;
}

// ─── Combine all checks into a single summary for injection ─────────────────

export function runDeterministicChecks(
  section242: string,
  section244: string,
  section246: string,
  overrides: StyleOverrides = NO_STYLE_OVERRIDES
): string {
  const because = checkBecauseClauses(section242);

  let summary = `## Pre-Computed Structural Checks (VERIFIED PROGRAMMATICALLY: use these as given, do not re-evaluate)\n\n`;

  // CRA openers
  summary += `### CRA Opener Detection (246 advancement paragraphs)\n`;
  if (overrides.reportSkeleton) {
    summary += `WAIVED by writer profile: this writer's own document defines the section architecture, so positional opener detection does not apply. Do not deduct for missing signal phrases.\n`;
  } else if (overrides.openingClauses) {
    summary += `WAIVED (house rule off by default, or waived by writer profile): literal opening clauses are not required for this writer. Do not deduct for missing signal phrases.\n`;
  } else {
    const openers = checkCRAOpeners(section246);
    summary += `Scanned every paragraph after the opening paragraph. The default skeleton mandates no paragraph count, so decide by content which of these are advancement paragraphs; a scanned ${pdSubsectionRoleLabel("project_status", "qaScan")} or ${pdSubsectionRoleLabel("goal_improvements", "qaScan")} paragraph does not count.\n`;
    summary += `Qualifying openers found: ${openers.count}/${openers.total}\n`;
    for (const r of openers.results) {
      summary += `- P${r.paragraph}: ${r.passes ? "PASS" : "FAIL"}: "${r.firstSentence}"\n`;
    }
  }
  summary += `\n`;

  // BECAUSE clauses
  summary += `### BECAUSE Clause Detection (242, all paragraphs)\n`;
  summary += `Uncertainties with BECAUSE clauses: ${because.withBecause}/${because.uncertaintyCount}\n`;
  for (const d of because.details) {
    summary += `- ${d.hasBecause ? "PASS" : "FAIL"}: "${d.excerpt}"\n`;
  }
  summary += `\n`;

  // Banned words
  summary += `### Banned Word Scan\n`;
  if (overrides.bannedWords) {
    summary += `WAIVED by writer profile: the default banned-word list does not apply to this writer. Do not flag or deduct for those terms.\n`;
  } else {
    const banned = checkBannedWords(section242, section244, section246);
    if (banned.found.length === 0) {
      summary += `No banned words found.\n`;
    } else {
      summary += `Found ${banned.found.length} violation(s):\n`;
      for (const f of banned.found) {
        summary += `- "${f.word}" in Section ${f.section}: ${f.context}\n`;
      }
    }
  }
  summary += `\n`;

  // Dash connectors (always on)
  summary += `### Dash Connector Scan (em dash and stand-ins used as punctuation)\n`;
  const dashes = checkDashConnectors(section242, section244, section246);
  if (dashes.found.length === 0) {
    summary += `No dash connectors found.\n`;
  } else {
    summary += `Found ${dashes.found.length} hit(s):\n`;
    for (const f of dashes.found) {
      summary += `- "${f.token}" in Section ${f.section}: ${f.context}\n`;
    }
  }
  summary += `\n`;

  // Repetition
  summary += `### Repetition Count\n`;
  if (overrides.repetitionCaps) {
    summary += `WAIVED by writer profile: repetition caps do not apply to this writer. Do not flag or deduct for phrase repetition.\n`;
  } else {
    const repetition = checkRepetition(section242, section244, section246);
    summary += `- "systematic investigation/experimentation": ${repetition.systematicInvestigation} occurrences ${repetition.systematicInvestigation > 3 ? "(OVER LIMIT of 3)" : "(within limit)"}\n`;
    summary += `- "technological uncertainty": ${repetition.technologicalUncertainty} occurrences ${repetition.technologicalUncertainty > 4 ? "(OVER LIMIT of 4)" : "(within limit)"}\n`;
  }

  return summary;
}
