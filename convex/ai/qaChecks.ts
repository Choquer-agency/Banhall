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

export function checkBecauseClauses(section242Text: string): BecauseClauseResult {
  const paragraphs = section242Text.split(/\n\n+/).filter((p) => p.trim());


  // Split on uncertainty markers
  const uncertaintyMarkers = [
    /it\s+was\s+uncertain\s+whether/gi,
    /it\s+remained\s+uncertain/gi,
    /uncertainty\s+existed\s+(regarding|as\s+to|about)/gi,
  ];

  // Find all uncertainty statements by splitting on sentences
  const sentences = paragraphs.flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+/));
  const uncertaintySentences: Array<{ excerpt: string; hasBecause: boolean }> = [];

  for (const sentence of sentences) {
    const isUncertainty = uncertaintyMarkers.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(sentence);
    });
    if (isUncertainty) {
      uncertaintySentences.push({
        excerpt: sentence.slice(0, 100) + (sentence.length > 100 ? "..." : ""),
        // 2026-10-29 (third): a cause given first with "given that" counts too.
        hasBecause: /\bbecause\b|\bgiven\s+that\b/i.test(sentence),
      });
    }
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
// belong inside a [GAP: ...] or [INFERRED: ...] marker. Narrow on purpose:
// a source noun right after "the" (or "these", "those") as the subject of a
// reporting verb, "the client" with a reporting verb, or a reporting verb
// in the passive at the end of a clause ("... are not described."). Text
// inside a marker is a note already and is never read. "A client's
// production databases", a vendor datasheet, published literature, "the
// materials showed cracking", "the step responses" and "the source code"
// are not notes.

/** The reporting verbs, in the forms a note uses. */
const REPORT_VERBS =
  "say|says|said|state|states|stated|describe|describes|described|mention|mentions|mentioned|report|reports|reported|specify|specifies|specified|indicate|indicates|indicated|note|notes|noted|detail|details|detailed|explain|explains|explained|confirm|confirms|confirmed|record|records|recorded";
/** Base forms after "do not": the reporting verbs, plus giving and showing for every noun but "materials". */
const REPORT_BASES = "say|state|describe|mention|report|specify|indicate|note|detail|explain|confirm|record";
const GIVE_BASES = "give|show|provide|include|cover";
/** The words that may stand between "the" and the noun ("the written answers"). */
const SOURCE_MODIFIER = "(?:(?:client's|client|written|interview|project|supplied|available)\\s+)?";
/** Source nouns other than "materials", whose giving and showing are reporting too. */
const SOURCE_NOUNS =
  "(?:sources?|source\\s+(?:files?|documents?|texts?|materials?)|interviews?|interviewees?|transcripts?|answers?|responses?)";
/** A participle after the noun that still names the same documents ("the materials provided"). */
const SOURCE_PARTICIPLE = "(?:\\s+(?:provided|supplied|available|given|received))?";
const NEGATION = "(?:(?:do|does|did)\\s+not|don't|doesn't|didn't)\\s+(?:(?:clearly|explicitly|directly|otherwise)\\s+)?";

const NOTE_PATTERNS: readonly RegExp[] = [
  // "The materials do not report ...", "the answers do not give ...".
  new RegExp(`\\b(?:the|these|those)\\s+${SOURCE_MODIFIER}${SOURCE_NOUNS}${SOURCE_PARTICIPLE}\\s+${NEGATION}(?:${REPORT_BASES}|${GIVE_BASES})\\b`, "giu"),
  new RegExp(`\\b(?:the|these|those)\\s+${SOURCE_MODIFIER}materials${SOURCE_PARTICIPLE}\\s+${NEGATION}(?:${REPORT_BASES})\\b`, "giu"),
  // "The answers give no date.", "the materials give no status ...": for
  // "materials" only before a word for a fact, so "the materials give no
  // sign of fatigue" stays.
  new RegExp(`\\b(?:the|these|those)\\s+${SOURCE_MODIFIER}${SOURCE_NOUNS}${SOURCE_PARTICIPLE}\\s+(?:give|gives|gave|provide|provides|provided|offer|offers|offered)\\s+no\\b`, "giu"),
  new RegExp(`\\b(?:the|these|those)\\s+${SOURCE_MODIFIER}materials${SOURCE_PARTICIPLE}\\s+(?:give|gives|gave|provide|provides|provided)\\s+no\\s+(?:status|results?|dates?|figures?|details?|reasons?|outcomes?|information|account|description)\\b`, "giu"),
  // "The transcript states ...", "the materials report ...".
  new RegExp(`\\b(?:the|these|those)\\s+${SOURCE_MODIFIER}(?:${SOURCE_NOUNS}|materials)${SOURCE_PARTICIPLE}\\s+(?:${REPORT_VERBS})\\b`, "giu"),
  // "The client reports that ...", "the client did not say ...".
  new RegExp(`\\bthe\\s+client\\s+(?:(?:${REPORT_VERBS}|recalls|recalled|estimates|estimated)\\b|${NEGATION}(?:${REPORT_BASES})\\b)`, "giu"),
  // "Individual runs are not described.", "Findings about it are not stated."
  /\b(?:is|are|was|were)\s+not\s+(?:stated|described|reported|specified|documented|given)(?=\s*(?:[.;:!?)]|$))/giu,
];

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
export function findNotesToWriter(rawText: string): NoteToWriterHit[] {
  const text = rawText.replace(NOTE_MARKER_RE, (marker) => " ".repeat(marker.length));
  const hits: NoteToWriterHit[] = [];
  for (const pattern of NOTE_PATTERNS) {
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

export interface SectionFinding {
  check: "banned_word" | "because_clause" | "cra_opener" | "repetition" | "dash_connector" | "note_to_writer";
  message: string;
}

export function sectionDeterministicFindings(
  section: "s242" | "s244" | "s246",
  text: string,
  overrides: StyleOverrides = NO_STYLE_OVERRIDES
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
  for (const hit of findNotesToWriter(text)) {
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
