"use node";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MalformedOutputError, OutputLimitError, type GenerationClient } from "./openrouterCore";
import { generateStructured, StructuredValidationError } from "./structured";
import {
  CONSISTENCY_SYSTEM_PROMPT,
  SELF_CHECK_SYSTEM_PROMPT,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
} from "./prompts";
import {
  CONSISTENCY_REQUEST,
  CONSISTENCY_SCHEMA,
  ORDERED_SECTION_TITLES,
  SELF_CHECK_REQUEST,
  SELF_CHECK_SCHEMA,
  SUMMARY_PLAN_SELF_CHECK_EXTRA_REF_SCHEMAS,
  SUMMARY_PLAN_SELF_CHECK_FACTS_FINDINGS_SCHEMA,
  SUMMARY_PLAN_SELF_CHECK_TARGET_FINDINGS_SCHEMA,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
  SUMMARY_PLAN_SELF_CHECK_SCHEMA,
} from "./promptDefinitions";
import { sectionParagraphs } from "../lib/tiptapReport";
import { containsTerm } from "../lib/editedTerms";
import { neutralizeMarkers } from "./trustedContext";
import {
  governingFeedbackPhrase,
  quoteForPrompt,
  stepTitle,
  type FeedbackGovernedTerm,
  type WriterFeedback,
} from "../lib/writerPrecedence";
import {
  isSectionNumber,
  type SectionNumber,
} from "../lib/orderedChain";
import type {
  ConsistencyFinding,
  ModelCheckKind,
  ModelVerdict,
} from "../lib/selfCheckRules";
import {
  ADVANCEMENTS_ANSWER_242_RULE_ID,
  clipJsonEscapedUtf8,
  FACTS_MATCH_SOURCES_RULE_ID,
  jsonEscapedUtf8Bytes,
  MAX_FACTS_FINDINGS,
  MAX_TARGET_FINDINGS,
  MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_LABEL_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_PARAGRAPH,
  MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES,
  projectSummaryOrdinaryChecks,
  RESULTS_AGAINST_TARGETS_RULE_ID,
  SeedContextLimitError,
  sameSummaryPlanRef,
  serializeFrozenSummaryPlanChecks,
  summaryPlanRefsOf,
  summarySelfCheckWorstCaseResponse,
  type FactsSourceDocument,
  type FactsSourceDocuments,
  type FrozenSummaryPlanCheck,
  type SummaryOrdinaryCheck,
  type SummaryPlanRefFields,
  WORK_ANSWERS_242_RULE_ID,
} from "../lib/seedRevisions";

/**
 * Story 2 (CAP-9/10, AD-25): the model half of the Self-check and the
 * assembled-draft consistency pass. Plain helpers (no registered functions),
 * called by convex/ai/orderedGeneration.ts through the action's counting
 * client factory, labelled `generation:selfCheck:<n>` and
 * `generation:consistency`. Both use the `two-attempt-repair` structured
 * policy, except the Summary Self-check: one attempt, plus at most one
 * follow-up for labels its answer missed (2026-09-28), and, when a used
 * repair changed the checked text, the same for the full check of the final
 * text (2026-09-28, third; 2026-10-05, Round 2 follow-up). Repair of the prose is never done here: it is the section agent
 * itself, re-run with the repair guidance (orderedGeneration.ts).
 */

const MODEL_CHECKS = ["storyline", "confidence", "glossary", "instruction"] as const;

/**
 * Summary only, in memory only: a verdict's free text as the model sent it,
 * kept when clipping shortened it so the one repair call can use the whole
 * instruction. Bounded by the raw response limit; never stored.
 */
type UnclippedFreeText = { reason: string; repairGuidance?: string };
type RawVerdict = {
  paragraph: number;
  check: ModelCheckKind;
  instruction: string;
  outcome: "applied" | "not_applied";
  reason: string;
  repairGuidance?: string;
  unclipped?: UnclippedFreeText;
  /** Summary only: the verdict's 1-based position in the answer, for logs. */
  position?: number;
};
type RawStorylineQuestion = {
  question: string;
  sectionClaim: string;
  confidenceEntry: number;
  storylineAlternative: string;
};
type RawSelfCheck = {
  verdicts: RawVerdict[];
  planVerdicts?: RawPlanVerdict[];
  storylineQuestion?: RawStorylineQuestion | null;
  /**
   * Summary only, set by clipping: which Storyline question fields were over
   * their reservation, with byte counts. Never model text.
   */
  storylineQuestionClipped?: string;
  /**
   * Summary only (2026-09-28, run 4): verdicts that failed their item
   * schema, by position and failed path, never model text. Each is dropped
   * and counts as invalid.
   */
  malformed?: string[];
  /** Summary only: why a Storyline question failed its schema. */
  malformedQuestion?: string;
  /**
   * Summary only (2026-09-28, fifth): a verdict list that was missing or not
   * a list, read as empty, by name and JSON type, never model text.
   */
  unreadableLists?: string[];
};
/**
 * 2026-10-04 (second, round 2): one finding of a not applied facts verdict,
 * as the model sent it. Its quotes are verified before it is shown.
 */
type RawFactsFinding = {
  paragraph?: number;
  draftQuote: string;
  sourceQuote: string;
  correction: string;
};
/**
 * 2026-10-04 (second, round 4): one entry of the targets verdict, as the
 * model sent it: an error of a not applied verdict, or the evidence of a
 * target an applied verdict says the section states as met.
 */
type RawTargetFinding = RawFactsFinding & { targetQuote?: string };
type RawPlanVerdict = {
  /** 2026-10-04 (second, round 2): the facts verdict's evidence. */
  findings?: RawFactsFinding[];
  /** 2026-10-04 (second, round 4): the targets verdict's evidence. */
  targetFindings?: RawTargetFinding[];
  itemId?: string;
  skippedRoleId?: string;
  /** 2026-09-30 (first): a LEAVE OUT check's dropped uncertainty. */
  droppedSeedId?: string;
  /** 2026-09-30 (first): Line 246's advancement check. */
  ruleId?: string;
  mergedItemIds: string[];
  paragraph?: number;
  outcome: "applied" | "not_applied";
  reason: string;
  repairGuidance?: string;
  unclipped?: UnclippedFreeText;
  position?: number;
};

const verdictsOutputSchema = z
  .array(
    z.object({
      paragraph: z.number().default(0),
      check: z.enum(MODEL_CHECKS),
      instruction: z.string().default(""),
      outcome: z.enum(["applied", "not_applied"]),
      reason: z.string().default(""),
      repairGuidance: z.string().optional(),
    })
  )
  .default([]);
const storylineQuestionOutputSchema = z
  .object({
    question: z.string(),
    sectionClaim: z.string(),
    confidenceEntry: z.number(),
    storylineAlternative: z.string(),
  })
  .nullable()
  .optional();
const selfCheckOutputSchema: z.ZodType<RawSelfCheck> = z.object({
  verdicts: verdictsOutputSchema,
  storylineQuestion: storylineQuestionOutputSchema,
});
const summaryVerdictOutputSchema = z.object({
  paragraph: z.number().int().min(0),
  check: z.enum(MODEL_CHECKS),
  instruction: z.string(),
  outcome: z.enum(["applied", "not_applied"]),
  reason: z.string(),
  repairGuidance: z.string().optional(),
}).strict();
const summaryPlanVerdictOutputSchema = z.object({
  // 2026-10-04 (second, round 2): read finding by finding (factsFindingsOf).
  findings: z.unknown().optional(),
  // Round 4: read entry by entry (targetFindingsOf).
  targetFindings: z.unknown().optional(),
  itemId: z.string().optional(),
  skippedRoleId: z.string().optional(),
  droppedSeedId: z.string().optional(),
  ruleId: z.string().optional(),
  mergedItemIds: z.array(z.string()),
  // AC11 deliberately treats absent or non-evidentiary numeric paragraph
  // values as not_applied. All other Summary fields remain required.
  paragraph: z.number().optional(),
  outcome: z.enum(["applied", "not_applied"]),
  reason: z.string(),
  repairGuidance: z.string().optional(),
}).strict();

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 2026-10-04 (second, round 2): a facts verdict's findings, each read on its
 * own: one without both quotes is left out (it could never be verified), at
 * most MAX_FACTS_FINDINGS.
 */
function factsFindingsOf(value: unknown): RawFactsFinding[] {
  return findingsOf(value).slice(0, MAX_FACTS_FINDINGS);
}

/** Round 4: the targets verdict's entries, read the same way, at most MAX_TARGET_FINDINGS. */
function targetFindingsOf(value: unknown): RawTargetFinding[] {
  return findingsOf(value).slice(0, MAX_TARGET_FINDINGS);
}

function findingsOf(value: unknown): RawTargetFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): RawFactsFinding[] => {
    if (!isUnknownRecord(candidate)) return [];
    const { draftQuote, sourceQuote, correction, paragraph, targetQuote } = candidate;
    if (typeof draftQuote !== "string" || typeof sourceQuote !== "string") return [];
    return [{
      ...(typeof paragraph === "number" && Number.isFinite(paragraph) ? { paragraph } : {}),
      draftQuote,
      sourceQuote,
      ...(typeof targetQuote === "string" && targetQuote.trim() ? { targetQuote } : {}),
      correction: typeof correction === "string" ? correction : "",
    }];
  });
}

/**
 * AC11 treats only the plan paragraph as an item-local evidence exception.
 * Raw response bytes are measured before this normalization. A nonnumeric
 * value is treated exactly like an omitted paragraph and is never coerced.
 */
function normalizeInvalidPlanParagraphs(value: unknown): unknown {
  if (!isUnknownRecord(value) || !Array.isArray(value.planVerdicts)) return value;
  return {
    ...value,
    planVerdicts: value.planVerdicts.map((candidate) => {
      if (
        !isUnknownRecord(candidate) ||
        !("paragraph" in candidate) ||
        typeof candidate.paragraph === "number"
      ) {
        return candidate;
      }
      const normalized: Record<string, unknown> = { ...candidate };
      delete normalized.paragraph;
      return normalized;
    }),
  };
}
const summaryStorylineQuestionOutputSchema = z.object({
  question: z.string(),
  sectionClaim: z.string(),
  confidenceEntry: z.number(),
  storylineAlternative: z.string(),
}).strict().nullable().optional();
/** The failed path and code of a schema error: never the value it saw. */
function failedPathOf(error: z.ZodError): string {
  const issue = error.issues[0];
  return `${issue && issue.path.length > 0 ? issue.path.join(".") : "(item)"} ${issue?.code ?? "invalid"}`;
}

/** The JSON type of a value, for logs: never the value itself. */
function jsonTypeOf(value: unknown): string {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

/**
 * 2026-09-28 (fifth, run 6): a verdict list that is missing or not a list
 * (run 6 sent planVerdicts as a string) is read as empty, so each of its
 * labels or plan checks counts as missing and goes to the one follow-up.
 */
function summaryListOf(value: unknown, name: string, unreadable: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  unreadable.push(value === undefined ? `${name} missing` : `${name} ${jsonTypeOf(value)}, not a list`);
  return [];
}

/**
 * 2026-09-28, run 4: the answer's root must have its shape, but each
 * verdict is decoded on its own, so one malformed verdict is dropped (and
 * counted as invalid) instead of failing the whole answer. A malformed
 * Storyline question is dropped the same way. 2026-09-28 (fifth): a verdict
 * list that is missing or not a list is read as empty (summaryListOf).
 */
function decodeSummaryItems(value: {
  verdicts?: unknown;
  planVerdicts?: unknown;
  storylineQuestion?: unknown;
}): RawSelfCheck {
  const malformed: string[] = [];
  const unreadableLists: string[] = [];
  const verdicts: RawVerdict[] = [];
  summaryListOf(value.verdicts, "verdicts", unreadableLists).forEach((candidate, index) => {
    const parsed = summaryVerdictOutputSchema.safeParse(candidate);
    if (parsed.success) verdicts.push({ ...parsed.data, position: index + 1 });
    else malformed.push(`ordinary verdict ${index + 1}: ${failedPathOf(parsed.error)}`);
  });
  const planVerdicts: RawPlanVerdict[] = [];
  summaryListOf(value.planVerdicts, "planVerdicts", unreadableLists).forEach((candidate, index) => {
    const parsed = summaryPlanVerdictOutputSchema.safeParse(candidate);
    if (parsed.success) {
      const { findings, targetFindings, ...rest } = parsed.data;
      const read = factsFindingsOf(findings);
      const targets = targetFindingsOf(targetFindings);
      planVerdicts.push({
        ...rest,
        ...(read.length > 0 ? { findings: read } : {}),
        ...(targets.length > 0 ? { targetFindings: targets } : {}),
        position: index + 1,
      });
    }
    else malformed.push(`plan verdict ${index + 1}: ${failedPathOf(parsed.error)}`);
  });
  let storylineQuestion: RawStorylineQuestion | null | undefined;
  let malformedQuestion: string | undefined;
  if (value.storylineQuestion !== undefined) {
    const parsed = summaryStorylineQuestionOutputSchema.safeParse(value.storylineQuestion);
    if (parsed.success) storylineQuestion = parsed.data;
    else malformedQuestion = `Storyline question: ${failedPathOf(parsed.error)}`;
  }
  return {
    verdicts,
    planVerdicts,
    ...(storylineQuestion !== undefined ? { storylineQuestion } : {}),
    ...(malformed.length > 0 ? { malformed } : {}),
    ...(malformedQuestion ? { malformedQuestion } : {}),
    ...(unreadableLists.length > 0 ? { unreadableLists } : {}),
  };
}

/**
 * The root must be an object with no unknown property, and at least one of
 * its verdict lists must be a list: an answer with neither holds nothing to
 * read and is rejected whole (2026-09-28, fifth).
 */
const decodedSummaryPlanSelfCheckOutputSchema = z.object({
  verdicts: z.unknown().optional(),
  planVerdicts: z.unknown().optional(),
  storylineQuestion: z.unknown().optional(),
}).strict()
  .refine((value) => Array.isArray(value.verdicts) || Array.isArray(value.planVerdicts), {
    message: "neither verdicts nor planVerdicts is a list",
  })
  .transform(decodeSummaryItems);

/**
 * Real reasons run 90 to 280 bytes while the reservations allow 64 (reason)
 * and 96 (guidance, Storyline question fields). Over-long free text is
 * clipped to its reservation here, after placeholder restoration and after
 * the raw response was measured against the whole-response limit, so the
 * stored evidence keeps the per-field limits the sign-off capacity proof
 * reserved. Labels, ids, counts and paragraphs are never clipped: the
 * completeness assertion still rejects them.
 *
 * A verdict whose reason or guidance was clipped also keeps its text as sent,
 * in memory only, so the one repair call works from the whole instruction.
 *
 * A Storyline question with any clipped field is still clipped here, so the
 * completeness assertion checks it as before, but it is marked: its
 * alternative can replace the whole Storyline, so runModelSelfCheck withholds
 * it rather than offer a shortened one.
 */
export function clipSummarySelfCheckFreeText(raw: RawSelfCheck): RawSelfCheck {
  const clip = (value: string, maximum: number) => clipJsonEscapedUtf8(value, maximum);
  const freeText = <T extends { reason: string; repairGuidance?: string }>(verdict: T) => {
    const reason = clip(verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES);
    const repairGuidance = verdict.repairGuidance === undefined
      ? undefined
      : clip(verdict.repairGuidance, MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES);
    const unclipped: UnclippedFreeText | undefined =
      reason !== verdict.reason || repairGuidance !== verdict.repairGuidance
        ? {
            reason: verdict.reason,
            ...(verdict.repairGuidance === undefined
              ? {}
              : { repairGuidance: verdict.repairGuidance }),
          }
        : undefined;
    return {
      ...verdict,
      reason,
      ...(repairGuidance === undefined ? {} : { repairGuidance }),
      ...(unclipped ? { unclipped } : {}),
    };
  };
  const question = raw.storylineQuestion;
  const questionClipped = question
    ? [
        overLimit("question", question.question, MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES),
        overLimit(
          "sectionClaim",
          question.sectionClaim,
          MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
        ),
        overLimit(
          "storylineAlternative",
          question.storylineAlternative,
          MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
        ),
      ].filter((problem): problem is string => problem !== null).join("; ")
    : "";
  return {
    ...raw,
    verdicts: raw.verdicts.map(freeText),
    ...(raw.planVerdicts ? { planVerdicts: raw.planVerdicts.map(freeText) } : {}),
    ...(question
      ? {
          storylineQuestion: {
            ...question,
            question: clip(question.question, MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES),
            sectionClaim: clip(
              question.sectionClaim,
              MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
            ),
            storylineAlternative: clip(
              question.storylineAlternative,
              MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
            ),
          },
        }
      : {}),
    ...(questionClipped ? { storylineQuestionClipped: questionClipped } : {}),
  };
}

const summaryPlanSelfCheckOutputSchema: z.ZodType<RawSelfCheck> = z.unknown()
  .superRefine((value, ctx) => {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = undefined;
    }
    const bytes = serialized === undefined
      ? undefined
      : new TextEncoder().encode(serialized).byteLength;
    if (bytes === undefined || bytes > MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: bytes === undefined
          ? "Summary Self-check response exceeds its UTF-8 byte budget (not serializable)"
          : `Summary Self-check response exceeds its UTF-8 byte budget (${bytes} bytes, limit ${MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES})`,
      });
    }
  })
  .transform(normalizeInvalidPlanParagraphs)
  .pipe(decodedSummaryPlanSelfCheckOutputSchema)
  .transform(clipSummarySelfCheckFreeText);

type RawFinding = {
  section: SectionNumber;
  paragraph: number;
  sections: SectionNumber[];
  kind: ConsistencyFinding["kind"];
  issue: string;
};
const CONSISTENCY_KINDS = ["contradiction", "excluded_claim", "terminology"] as const;

/**
 * 2026-09-29 (second, release suite run 6, "Carried old selections"): the
 * consistency pass failed as a whole ("consistency pass call failed
 * (unknown)") after its answer and its structured repair both failed
 * validation (`invalid_output` twice on the checking model), so it never
 * ran. The same model sent the Self-check's planVerdicts as a string that
 * day. One badly typed field used to reject every finding; now:
 * - a findings list sent as a JSON string is read as that list;
 * - each finding is read on its own, so one unreadable finding is left out
 *   (counted and logged by position and field, never model text) instead of
 *   failing the others;
 * - a section written as a number or a label ("244", 244, "Line 244") and a
 *   paragraph written as a numeric string are read as meant.
 * An answer whose findings is neither a list nor a string holding one is
 * still unreadable and goes to the structured repair, as before.
 */
function sectionOf(value: unknown): SectionNumber | undefined {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 40) return undefined;
  const match = /(?:^|[^0-9])(242|244|246)(?:[^0-9]|$)/.exec(text);
  return match ? (match[1] as SectionNumber) : undefined;
}

function consistencyListOf(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** A paragraph as a number, "2", "P2", "[P2]" or "paragraph 2" (review P2-3). */
function paragraphOf(value: unknown): number | undefined {
  if (value === undefined || value === null) return 1;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = /^\s*\[?\s*(?:p(?:ara(?:graph)?)?\.?\s*)?(\d{1,4})\s*\]?\s*$/i.exec(value);
  return match ? Number(match[1]) : undefined;
}

type DecodedConsistency = {
  findings: RawFinding[];
  /** Findings left out as unreadable, by position and field. Never model text. */
  unreadable: string[];
};

function decodeConsistencyFindings(list: readonly unknown[]): DecodedConsistency {
  const findings: RawFinding[] = [];
  const unreadable: string[] = [];
  list.forEach((candidate, index) => {
    const position = `finding ${index + 1}`;
    if (!isUnknownRecord(candidate)) {
      unreadable.push(`${position}: ${jsonTypeOf(candidate)}, not an object`);
      return;
    }
    const section = sectionOf(candidate.section);
    const paragraph = paragraphOf(candidate.paragraph);
    const sectionsList = candidate.sections === undefined ? [] : consistencyListOf(candidate.sections);
    const kind = typeof candidate.kind === "string"
      ? candidate.kind.trim().toLowerCase().replace(/[\s-]+/g, "_")
      : "";
    const issue = typeof candidate.issue === "string" ? candidate.issue.trim() : "";
    const bad = [
      ...(section === undefined ? ["section"] : []),
      ...(paragraph === undefined ? ["paragraph"] : []),
      ...(sectionsList === undefined ? ["sections"] : []),
      ...((CONSISTENCY_KINDS as readonly string[]).includes(kind) ? [] : ["kind"]),
      ...(issue ? [] : ["issue"]),
    ];
    if (bad.length > 0 || section === undefined || paragraph === undefined || sectionsList === undefined) {
      unreadable.push(`${position}: ${bad.join(", ")}`);
      return;
    }
    findings.push({
      section,
      paragraph,
      sections: sectionsList.flatMap((entry) => {
        const named = sectionOf(entry);
        return named ? [named] : [];
      }),
      kind: kind as RawFinding["kind"],
      issue,
    });
  });
  return { findings, unreadable };
}

const consistencyOutputSchema = z
  .object({ findings: z.unknown().optional() })
  .superRefine((value, ctx) => {
    if (value.findings !== undefined && consistencyListOf(value.findings) === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["findings"],
        message: `not a list (${jsonTypeOf(value.findings)})`,
      });
    }
  })
  .transform((value, ctx) => {
    const decoded = decodeConsistencyFindings(consistencyListOf(value.findings) ?? []);
    // Review P2-3: an answer whose findings could none of them be read is
    // a failed attempt, never a clean pass: the structured repair asks
    // again, and a second such answer fails the pass with this reason.
    if (decoded.findings.length === 0 && decoded.unreadable.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["findings"],
        message: `none of ${decoded.unreadable.length} could be read (${decoded.unreadable.slice(0, 3).join("; ")})`,
      });
      return z.NEVER;
    }
    return decoded;
  });

function block(label: string, body: string): string {
  return `--- BEGIN [${label}] ---\n${body}\n--- END [${label}] ---`;
}

/** [P1]-numbered paragraphs, indices matching sectionParagraphs. */
export function numberedSectionParagraphs(text: string): string {
  return sectionParagraphs(text)
    .map((paragraph, index) => `[P${index + 1}] ${paragraph.replace(/\s+/g, " ").trim()}`)
    .join("\n\n");
}

/**
 * 1-based model paragraph → a valid 0-based index. `wholeSectionAtZero`
 * (Self-check only; the consistency pass has no whole-section concept)
 * returns undefined for an explicit 0 instead of colliding with paragraph 1.
 */
function clampParagraph(
  paragraph: number,
  count: number,
  wholeSectionAtZero = false
): number | undefined {
  if (wholeSectionAtZero && paragraph === 0) return undefined;
  if (count <= 0) return 0;
  const index = Number.isFinite(paragraph) && paragraph >= 1 ? Math.floor(paragraph) - 1 : 0;
  return Math.min(Math.max(index, 0), count - 1);
}

export type SelfCheckPlanCheck = FrozenSummaryPlanCheck;

export type SelfCheckModelInput = {
  section: SectionNumber;
  text: string;
  storylineText: string;
  confidenceMap: Array<{ text: string; confidence?: string }>;
  glossaryCandidates: string[];
  writerInstructions?: string;
  rules: Array<{ instruction: string; paragraphIndex?: number }>;
  /**
   * 2026-10-04 (first): the writer's cap rules code measures on this Line,
   * word for word. With writer instructions in the request, the model is
   * told, for those verdicts only, not to judge these caps or mention the
   * section's word or line count. Absent or empty: no such sentence, so
   * those requests keep their bytes.
   */
  measuredCaps?: readonly string[];
  model: string;
  planChecks?: SelfCheckPlanCheck[];
  planChecksBlock?: string;
  /**
   * 2026-09-28 (second, edited terms): the Line's edited terms from the
   * frozen plan, allowed word for word. Summary mode only.
   */
  editedTerms?: readonly string[];
  /**
   * 2026-09-29 (second): the active Feedback that reaches the Line, which
   * outranks the Brief. Summary mode only.
   */
  writerFeedback?: readonly WriterFeedback[];
  /**
   * PR #22 lead decision: the Glossary Terms that Feedback names, each
   * checked by its own "feedback:F<n>" label (never a Glossary candidate).
   * Summary mode only; the final coverage check carries them too, so a
   * repaired text is judged for them (Greptile round 4, P2).
   */
  feedbackTerms?: readonly FeedbackGovernedTerm[];
  /**
   * 2026-10-04 (second): what the draft was written from, for the facts
   * check (sourceFactsFor). Sent as the SOURCE FACTS block only when the
   * plan checks hold that check, so every other request is unchanged.
   */
  sourceFacts?: SourceFacts;
};

/** One frozen source document the facts check may read in full. */
export type SourceDocument = FactsSourceDocument;

/** The source documents the facts check reads, and the ones left out. */
export type SourceDocuments = FactsSourceDocuments;

/**
 * The SOURCE FACTS block's body; the entries a finding's source quote may be
 * found in (`evidence`), plain text with no JSON escaping; the product's own
 * entries, which count as well only when the documents are not complete
 * (`product`); every signed-off item's wording, which a fix may not cut while
 * they are not (`items`); and whether every source document is in it.
 */
export type SourceFacts = {
  body: string;
  evidence: string[];
  product: string[];
  items: string[];
  documentsComplete: boolean;
  /**
   * Round 3: every sentence an item's own quotes do not back. Never evidence,
   * on any path a source quote is verified against (Greptile on PR #26 at
   * 1da92721).
   */
  unbacked: string[];
};

/** Every string in a JSON value, in order: the analysis as plain text. */
function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

/**
 * 2026-10-04 (second): what the facts check reads. Round 2 (owner approved
 * 2026-10-05): the source documents first, then the product's own wording,
 * which can point to a fact but proves no detail on its own: the transcript
 * analysis (compact JSON), the Brief's Storyline (marked as the writer's when
 * the writer typed or edited it) and Confidence Map, and (review round 1,
 * P2-1) every Line's signed-off items, each marked as the writer's or the
 * product's wording and with its own quotes; and the writer's instructions.
 * Round 2 review: the whole body is marker-safe (P2-1), and the documents
 * count as complete only when at least one is in and none is left out (P2-4,
 * P3-3). The first Self-check and the check of the final text read the same
 * block.
 */
export function sourceFactsFor(args: {
  analysis: unknown;
  storylineText?: string;
  /** The writer typed or edited the Storyline (the Brief's storylineOrigin). */
  storylineByWriter?: boolean;
  confidenceMap?: ReadonlyArray<{ text: string; confidence?: string }>;
  /** Every signed-off item, every Line, skipped steps aside. */
  planItems?: ReadonlyArray<{
    wording: readonly string[];
    writer?: boolean;
    quotes?: readonly string[];
    /** Round 3: the wording its own evidence quotes do not back. */
    unbacked?: readonly string[];
  }>;
  /** The writer's instructions, as the WRITER INSTRUCTIONS block gives them. */
  writerInstructions?: readonly string[];
  documents?: SourceDocuments;
}): SourceFacts {
  const scaffold = SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources;
  const storyline = args.storylineText?.trim() ?? "";
  const confidence = args.confidenceMap ?? [];
  const items = (args.planItems ?? [])
    .map((item) => {
      // Round 3: the writer's own wording is never marked; the product's is,
      // where its evidence quotes do not back it.
      const unbacked = item.writer ? [] : (item.unbacked ?? []).map((bullet) => bullet.trim()).filter(Boolean);
      return {
        ...item,
        text: item.wording.join(" ").trim(),
        quotes: (item.quotes ?? []).map((quote) => quote.trim()).filter(Boolean),
        unbacked,
        // What can stand for the sources: the wording its quotes back.
        backed: item.wording.map((bullet) => bullet.trim()).filter((bullet) => bullet && !unbacked.includes(bullet)).join(" "),
      };
    })
    .filter((item) => item.text);
  const instructions = (args.writerInstructions ?? []).map((text) => text.trim()).filter(Boolean);
  const included = args.documents?.documents ?? [];
  const leftOut = args.documents?.leftOut ?? [];
  const documentsComplete = included.length > 0 && leftOut.length === 0;
  const documentsPart = !args.documents
    ? []
    : [
        ...(included.length > 0
          ? [`${scaffold.documentsHeading}${included
              .map((document) => `${scaffold.documentPrefix}${document.label}${scaffold.documentSuffix}${document.content.trim()}`)
              .join("\n")}`]
          : []),
        ...(leftOut.length > 0
          ? [`${scaffold.documentsLeftOutPrefix}${args.documents.budget}${scaffold.documentsLeftOutMiddle}${leftOut
              .map((document) => `${document.label} (${document.bytes} bytes)`)
              .join(scaffold.documentsLeftOutSeparator)}${scaffold.documentsLeftOutSuffix}`]
          : []),
        ...(included.length === 0 && leftOut.length === 0 ? [scaffold.documentsNone] : []),
      ];
  const body = [
    ...documentsPart,
    scaffold.productHeading,
    `${scaffold.analysisHeading}${JSON.stringify(args.analysis)}`,
    ...(storyline ? [`${args.storylineByWriter ? scaffold.writerStorylineHeading : scaffold.storylineHeading}${storyline}`] : []),
    ...(confidence.length > 0
      ? [`${scaffold.confidenceHeading}${confidence
          .map((entry) => `${scaffold.confidencePrefix}${entry.confidence ?? "unresolved"}${scaffold.confidenceMiddle}${entry.text}`)
          .join("")}`]
      : []),
    ...(items.length > 0
      ? [`${scaffold.planHeading}${items.map((item) =>
          `${scaffold.planItemPrefix}${item.writer ? scaffold.writerItemLabel : scaffold.productItemLabel}${item.text}${
            item.quotes.length > 0
              ? `${scaffold.quotesPrefix}${item.quotes.map((quote) => JSON.stringify(quote)).join(scaffold.quoteSeparator)}`
              : scaffold.noQuotes
          }${
            item.unbacked.length > 0
              ? `${scaffold.unbackedPrefix}${item.unbacked.map((bullet) => JSON.stringify(bullet)).join(scaffold.quoteSeparator)}`
              : ""
          }`).join("")}`]
      : []),
    ...(instructions.length > 0
      ? [`${scaffold.writerHeading}${instructions.map((text) => `${scaffold.writerItemPrefix}${text}`).join("")}`]
      : []),
  ].join(scaffold.partSeparator);
  const safe = (text: string) => neutralizeMarkers(text);
  return {
    // Round 2 review, P2-1: no part of the block can close it or open another.
    body: safe(body),
    evidence: [
      ...included.map((document) => document.content),
      ...items.flatMap((item) => item.quotes),
      ...items.filter((item) => item.writer).map((item) => item.text),
      ...(args.storylineByWriter && storyline ? [storyline] : []),
      ...instructions,
    ].map(safe),
    product: [
      ...stringLeaves(args.analysis),
      ...(!args.storylineByWriter && storyline ? [storyline] : []),
      ...confidence.map((entry) => entry.text),
      // Round 3: wording its own quotes do not back never stands for the sources.
      ...items.filter((item) => !item.writer && item.backed).map((item) => item.backed),
    ].map(safe),
    items: items.filter((item) => item.backed).map((item) => item.backed),
    documentsComplete,
    unbacked: items.flatMap((item) => item.unbacked),
  };
}

/**
 * The facts rule after the data blocks: one sentence on the source documents
 * for whether they are all in the SOURCE FACTS block (round 2).
 */
export function factsMatchSourcesInstruction(documentsComplete: boolean): string {
  const scaffold = SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources;
  return `${scaffold.instructionIntro}${documentsComplete ? scaffold.documentsIncluded : scaffold.documentsLeftOut}${scaffold.instructionRest}`;
}

/**
 * The entries a facts finding's source quote may come from. Round 2 review,
 * P2-3: with every source document in, only source wording: the documents,
 * the signed-off items' quotes, and what the writer typed (items marked as
 * the writer's, a writer's Storyline, the writer's instructions, exact terms
 * and Feedback). Without every document, the product's own wording too (the
 * analysis, its Storyline and Confidence Map, every item's and plan check's
 * wording), as it stands for what the check cannot read.
 */
function factsVerificationSources(input: SelfCheckModelInput): string[] {
  const facts = input.sourceFacts;
  const checks = input.planChecks ?? [];
  // Greptile on PR #26 at 1da92721: a sentence an item's own quotes do not
  // back never stands for the sources, here either: the plan checks' wording
  // read while documents are left out leaves it out (from the SOURCE FACTS
  // items and from each check's own warning).
  const unbacked = new Set([...(facts?.unbacked ?? []), ...checks.flatMap((check) => check.quotesDoNotBack ?? [])]
    .map((sentence) => sentence.trim()));
  const backedOnly = (wording: readonly string[]) => wording.filter((sentence) => !unbacked.has(sentence.trim()));
  // Round 2 re-check (P2): every entry marker-safe, as the block's own are,
  // so no quote verifies against marker text.
  return [
    ...(facts?.evidence ?? []),
    ...checks.flatMap((check) => check.sourceReferences.map((reference) => reference.exactExcerpt)),
    ...(input.editedTerms ?? []),
    ...(input.writerFeedback ?? []).map((entry) => entry.instruction),
    ...(facts?.documentsComplete
      ? []
      : [
          ...(facts?.product ?? []),
          ...checks.flatMap((check) => [
            ...backedOnly(check.wording),
            ...check.relationshipReferences.flatMap((reference) => backedOnly(reference.wording)),
          ]),
        ]),
  ].map((entry) => neutralizeMarkers(entry));
}

/** The SOURCE FACTS block's body alone. */
export function sourceFactsBody(args: Parameters<typeof sourceFactsFor>[0]): string {
  return sourceFactsFor(args).body;
}

function summaryEditedTerms(input: SelfCheckModelInput): string[] {
  return (input.editedTerms ?? []).map((term) => term.trim()).filter(Boolean);
}

/**
 * What a verdict says when it objects to a term as made up or unsourced:
 * invented, coined, fabricated, unsupported, not in the Storyline or the
 * sources, off the Storyline.
 */
const INVENTED_TERM_OBJECTION =
  /\b(?:invent\w*|coin\w*|made[- ]up|fabricat\w*|unsupported|not supported|unsourced|off[- ]storyline|off the storyline|(?:not|never) (?:in|from|found in|mentioned in|used in|part of|present in) (?:the )?(?:storyline|sources?|brief|transcript|material)|absent from (?:the )?(?:storyline|sources?))\b/i;

/** A phrase a verdict puts in quotation marks (an apostrophe inside a word is not one). */
const QUOTED_PHRASE = /(?:^|[\s(])['"\u2018\u201c]([^'"\u2019\u201d\n]{2,80})['"\u2019\u201d](?=[\s.,;:!?)]|$)/g;

/** Compliance Note reason for an objection to a writer's edited term that was set aside. */
export const EDITED_TERM_ALLOWED_REASON = "Writer's own edited term, allowed as written.";

function summaryOrdinaryChecks(input: SelfCheckModelInput): SummaryOrdinaryCheck[] {
  return projectSummaryOrdinaryChecks({
    storylineText: input.storylineText,
    confidenceMap: input.confidenceMap,
    glossaryTerms: input.glossaryCandidates,
    writerFlavor: input.writerInstructions,
    rules: input.rules,
    feedbackTerms: summaryFeedbackTerms(input).map((entry) => entry.term),
  });
}

/** The governed terms a Summary request labels, the final coverage check included. */
function summaryFeedbackTerms(input: SelfCheckModelInput): readonly FeedbackGovernedTerm[] {
  if (!input.planChecks?.length) return [];
  return (input.feedbackTerms ?? []).filter((entry) => entry.term.trim() && entry.feedback.length > 0);
}

/** The instruction line and data blocks, without the Summary checklist. */
function buildSelfCheckDataMessage(input: SelfCheckModelInput): string {
  const hasSummaryPlan = Boolean(input.planChecks?.length);
  const ordinary = hasSummaryPlan ? summaryOrdinaryChecks(input) : [];
  const blocks = [
    block(
      `SECTION DRAFT: ${ORDERED_SECTION_TITLES[input.section]}`,
      numberedSectionParagraphs(input.text)
    ),
  ];
  if (input.storylineText.trim()) {
    const label = ordinary.find((check) => check.check === "storyline")?.label;
    blocks.push(block("STORYLINE", `${label ? `[${label}] ` : ""}${input.storylineText.trim()}`));
  }
  if (input.confidenceMap.length > 0) {
    blocks.push(
      block(
        "CONFIDENCE MAP",
        input.confidenceMap
          .map((entry, index) => {
            const label = ordinary.find((check) =>
              check.label === `confidence:C${index + 1}`)?.label;
            return `${label ? `[${label}] ` : ""}[C${index + 1}] (${entry.confidence ?? "unresolved"}) ${entry.text}`;
          })
          .join("\n")
      )
    );
  }
  if (input.glossaryCandidates.length > 0) {
    blocks.push(
      block(
        "GLOSSARY CANDIDATES (Glossary Terms not found verbatim in the section)",
        input.glossaryCandidates.map((term, index) => {
          const label = ordinary.find((check) =>
            check.label === `glossary:G${index + 1}`)?.label;
          return `- ${label ? `[${label}] ` : ""}${term}`;
        }).join("\n")
      )
    );
  }
  const instructionLines: string[] = [];
  if (input.writerInstructions?.trim()) {
    const instruction = input.writerInstructions.trim();
    const label = ordinary.find((check) => check.label === "writer:profile")?.label;
    instructionLines.push(`${label ? `[${label}] ` : ""}${instruction}`);
  }
  input.rules.forEach((rule, index) => {
    const scope =
      rule.paragraphIndex !== undefined ? ` (paragraph ${rule.paragraphIndex + 1})` : "";
    const label = ordinary.find((check) => check.label === `rule:R${index + 1}`)?.label;
    instructionLines.push(`${label ? `[${label}] ` : ""}[R${index + 1}]${scope} ${rule.instruction}`);
  });
  if (instructionLines.length > 0) {
    blocks.push(block("WRITER INSTRUCTIONS", instructionLines.join("\n\n")));
  }
  if (input.planChecks?.length) {
    const serialized = serializeFrozenSummaryPlanChecks(input.planChecks);
    if (input.planChecksBlock !== serialized) {
      throw new Error("Frozen Summary plan-check serialization mismatch");
    }
    blocks.push(serialized);
  }
  // 2026-10-04 (second): the sources the draft was written from, for the
  // facts check, right after the plan checks. Absent without that check, so
  // those requests are unchanged.
  const facts = (input.planChecks ?? []).some((check) => check.ruleId === FACTS_MATCH_SOURCES_RULE_ID);
  if (facts) {
    blocks.push(block(
      SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.blockLabel,
      input.sourceFacts?.body.trim() || "(none)"
    ));
  }
  // The writer's edited terms, allowed word for word: a block of data and,
  // after the blocks, the rule for them. Absent without edited terms, so
  // those requests are unchanged.
  const terms = hasSummaryPlan ? summaryEditedTerms(input) : [];
  const exact = SUMMARY_PLAN_SELF_CHECK_REQUEST.exactTerms;
  if (terms.length > 0) {
    blocks.push(block(
      exact.blockLabel,
      terms.map((term) => `${exact.termPrefix}${term}${exact.termSuffix}`).join(exact.separator)
    ));
  }
  // 2026-09-29 (second): the writer's active Feedback, which outranks the
  // Brief: a block of data and, after the blocks, the rule for it. Absent
  // without Feedback, so those requests are unchanged.
  const feedback = hasSummaryPlan
    ? (input.writerFeedback ?? []).filter((entry) => entry.instruction.trim())
    : [];
  const writer = SUMMARY_PLAN_SELF_CHECK_REQUEST.writerFeedback;
  // 2026-09-30 (second): a governed term an unedited signed-off idea uses.
  // Only then do the Feedback and governed-term rules say that renaming it
  // is wording, not meaning; every other request keeps its bytes.
  const governed = hasSummaryPlan ? summaryFeedbackTerms(input) : [];
  const renaming = governed.some((entry) => entry.inSignedOffIdea === true);
  if (feedback.length > 0) {
    blocks.push(block(
      writer.blockLabel,
      feedback
        .map((entry) => `${writer.linePrefix}${stepTitle(entry.roleId)}${writer.lineMiddle}${quoteForPrompt(entry.instruction)}`)
        .join(writer.separator)
    ));
  }
  // PR #22 lead decision: each Glossary Term that Feedback names has its
  // own label, with the Feedback quoted as data, and after the blocks the
  // rule for judging it. Absent without such a term.
  const governedScaffold = SUMMARY_PLAN_SELF_CHECK_REQUEST.feedbackTerms;
  if (governed.length > 0) {
    blocks.push(block(
      governedScaffold.blockLabel,
      governed.map((entry) => {
        const label = ordinary.find((check) => check.feedbackTerm === entry.term)?.label;
        return `${governedScaffold.linePrefix}${label ? `[${label}] ` : ""}${governedScaffold.termPrefix}${quoteForPrompt(entry.term)}${governedScaffold.feedbackMiddle}${governingFeedbackPhrase(entry.feedback)}${
          entry.inSignedOffIdea ? governedScaffold.inIdeaSuffix : ""
        }`;
      }).join(governedScaffold.separator)
    ));
  }
  // 2026-09-30 (first): the rule for LEAVE OUT checks and for Line 246's
  // advancement check, after the data blocks; since (second) for Line 244's
  // work check too, and since (third) for the targets check, last. Each rule
  // is named by its own ruleId. Absent without such a check, so those
  // requests are unchanged.
  const leaveOut = (input.planChecks ?? []).some((check) => check.droppedSeedId !== undefined);
  const answers242 = (input.planChecks ?? []).some((check) => check.ruleId === ADVANCEMENTS_ANSWER_242_RULE_ID);
  const workAnswers242 = (input.planChecks ?? []).some((check) => check.ruleId === WORK_ANSWERS_242_RULE_ID);
  const targets = (input.planChecks ?? []).some((check) => check.ruleId === RESULTS_AGAINST_TARGETS_RULE_ID);
  // 2026-10-04 (first): the writer's caps code measures are not the
  // model's to judge in the writer-instruction verdicts.
  const measuredCapRules = instructionLines.length > 0
    ? [...new Set((input.measuredCaps ?? []).map((rule) => rule.trim()).filter(Boolean))]
    : [];
  const measured = SELF_CHECK_REQUEST.measuredCaps;
  return `${SELF_CHECK_REQUEST.userScaffold.prefix}${blocks.join(SELF_CHECK_REQUEST.userScaffold.blockSeparator)}${
    measuredCapRules.length > 0
      ? `${measured.prefix}${measuredCapRules.map(quoteForPrompt).join(measured.separator)}${measured.suffix}`
      : ""
  }${
    terms.length > 0 ? exact.instruction : ""
  }${feedback.length > 0 ? (renaming ? writer.renamingInstruction : writer.instruction) : ""}${
    governed.length > 0
      ? `${governedScaffold.instruction}${renaming ? governedScaffold.renamingInstruction : ""}`
      : ""
  }${
    leaveOut ? SUMMARY_PLAN_SELF_CHECK_REQUEST.leaveOut.instruction : ""
  }${answers242 ? SUMMARY_PLAN_SELF_CHECK_REQUEST.answers242.instruction : ""}${
    workAnswers242 ? SUMMARY_PLAN_SELF_CHECK_REQUEST.workAnswers242.instruction : ""
  }${
    targets ? SUMMARY_PLAN_SELF_CHECK_REQUEST.resultsAgainstTargets.instruction : ""
  }${
    facts ? factsMatchSourcesInstruction(input.sourceFacts?.documentsComplete === true) : ""
  }`;
}

export function buildSelfCheckUserMessage(input: SelfCheckModelInput): string {
  const message = buildSelfCheckDataMessage(input);
  if (!input.planChecks?.length) return message;
  const separator = SUMMARY_PLAN_SELF_CHECK_REQUEST.checklist.separator;
  const checklist = summaryChecklist(summaryOrdinaryChecks(input), input.planChecks);
  return [message, ...(checklist ? [checklist] : [])].join(separator);
}

function fillRuntime(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{runtime\.(\w+)\}\}/g, (match, key: string) =>
    values[key] ?? match);
}

/**
 * The closing list of every ordinary label and plan check an answer must
 * cover, with their counts (2026-09-28). Labels and ids are only ever the
 * ones this app supplied.
 */
export function summaryChecklist(
  ordinary: readonly SummaryOrdinaryCheck[],
  planChecks: readonly SelfCheckPlanCheck[]
): string {
  const list = SUMMARY_PLAN_SELF_CHECK_REQUEST.checklist;
  const parts: string[] = [];
  if (ordinary.length > 0) {
    parts.push([
      fillRuntime(list.ordinaryIntro, {
        count: String(ordinary.length),
        noun: ordinary.length === 1 ? list.ordinaryNoun.one : list.ordinaryNoun.other,
      }),
      ...ordinary.map((check) =>
        fillRuntime(list.ordinaryLine, { label: check.label, check: check.check })),
    ].join(list.lineSeparator));
  }
  if (planChecks.length > 0) {
    parts.push([
      fillRuntime(list.planIntro, {
        count: String(planChecks.length),
        noun: planChecks.length === 1 ? list.planNoun.one : list.planNoun.other,
      }),
      ...planChecks.map((check) =>
        check.itemId
          ? // A merged item names its merged ids, which its verdict must
            // repeat in that order (2026-09-28, run 4).
            check.mergedItemIds.length === 1 && check.mergedItemIds[0] === check.itemId
            ? fillRuntime(list.itemLine, { id: check.itemId })
            : fillRuntime(list.mergedItemLine, {
                id: check.itemId,
                ids: check.mergedItemIds.length ? check.mergedItemIds.join(", ") : "none",
              })
          : check.droppedSeedId !== undefined
            ? fillRuntime(list.leaveOutLine, { id: check.droppedSeedId })
            : check.ruleId !== undefined
              ? fillRuntime(list.ruleLine, { id: check.ruleId })
              : fillRuntime(list.skipLine, { id: check.skippedRoleId ?? "" })),
    ].join(list.lineSeparator));
  }
  return parts.join(list.separator);
}

/**
 * The Summary tool schema for one request: the answer must hold exactly one
 * verdict per listed label and plan check, and each label and id is one of
 * the values listed (2026-09-28). The static schema stays the base.
 */
export function summaryPlanSelfCheckSchemaFor(
  ordinary: readonly Pick<SummaryOrdinaryCheck, "label">[],
  planChecks: readonly SummaryPlanRefFields[]
) {
  const base = SUMMARY_PLAN_SELF_CHECK_SCHEMA;
  const labels = ordinary.map((check) => check.label);
  const itemIds = planChecks.flatMap((check) => (check.itemId ? [check.itemId] : []));
  const skipIds = planChecks.flatMap((check) =>
    check.skippedRoleId ? [check.skippedRoleId] : []);
  // 2026-09-30 (first): a LEAVE OUT check's and a rule check's fields, and
  // their oneOf branches, only in a request that has such a check.
  const droppedIds = planChecks.flatMap((check) =>
    check.droppedSeedId ? [check.droppedSeedId] : []);
  const ruleIds = planChecks.flatMap((check) => (check.ruleId ? [check.ruleId] : []));
  const extraProperties = {
    ...(droppedIds.length > 0
      ? { droppedSeedId: { ...SUMMARY_PLAN_SELF_CHECK_EXTRA_REF_SCHEMAS.droppedSeedId, enum: droppedIds } }
      : {}),
    ...(ruleIds.length > 0
      ? { ruleId: { ...SUMMARY_PLAN_SELF_CHECK_EXTRA_REF_SCHEMAS.ruleId, enum: ruleIds } }
      : {}),
  };
  const plan = base.properties.planVerdicts;
  // 2026-10-04 (second, round 2): the facts verdict carries its evidence, so
  // only a request with that check gains the findings field.
  const factsFindings = ruleIds.includes(FACTS_MATCH_SOURCES_RULE_ID)
    ? { findings: SUMMARY_PLAN_SELF_CHECK_FACTS_FINDINGS_SCHEMA }
    : {};
  // Round 4: and the targets verdict, only in a request with that check.
  const targetFindings = ruleIds.includes(RESULTS_AGAINST_TARGETS_RULE_ID)
    ? { targetFindings: SUMMARY_PLAN_SELF_CHECK_TARGET_FINDINGS_SCHEMA }
    : {};
  return {
    ...base,
    properties: {
      ...base.properties,
      verdicts: {
        ...base.properties.verdicts,
        minItems: labels.length,
        maxItems: labels.length,
        items: {
          ...base.properties.verdicts.items,
          properties: {
            ...base.properties.verdicts.items.properties,
            instruction: {
              ...base.properties.verdicts.items.properties.instruction,
              ...(labels.length > 0 ? { enum: labels } : {}),
            },
          },
        },
      },
      planVerdicts: {
        ...plan,
        minItems: planChecks.length,
        maxItems: planChecks.length,
        items: {
          ...plan.items,
          properties: {
            ...plan.items.properties,
            itemId: {
              ...plan.items.properties.itemId,
              ...(itemIds.length > 0 ? { enum: itemIds } : {}),
            },
            skippedRoleId: {
              ...plan.items.properties.skippedRoleId,
              ...(skipIds.length > 0 ? { enum: skipIds } : {}),
            },
            ...factsFindings,
            ...targetFindings,
            ...extraProperties,
          },
          ...(droppedIds.length > 0 || ruleIds.length > 0
            ? {
                oneOf: [
                  ...plan.items.oneOf,
                  ...(droppedIds.length > 0 ? [{ required: ["droppedSeedId"] }] : []),
                  ...(ruleIds.length > 0 ? [{ required: ["ruleId"] }] : []),
                ],
              }
            : {}),
        },
      },
    },
  };
}

export type ModelSelfCheckResult = {
  verdicts: ModelVerdict[];
  storylineQuestion: {
    question: string;
    sectionClaim: string;
    storylineAlternative: string;
    /** 0-based index into the Confidence Map entries sent, or null. */
    confidenceEntryIndex: number | null;
  } | null;
  /**
   * Summary only: why the model's Storyline question was withheld (a field
   * needed clipping), as field names and byte counts. Never model text.
   */
  storylineQuestionWithheld?: string;
  planVerdicts: Array<{
    itemId?: string;
    skippedRoleId?: string;
    /** 2026-09-30 (first): a LEAVE OUT check's dropped uncertainty. */
    droppedSeedId?: string;
    /** 2026-09-30 (first): Line 246's advancement check. */
    ruleId?: string;
    mergedItemIds: string[];
    paragraphIndex?: number;
    outcome: "applied" | "not_applied";
    reason: string;
    repairGuidance?: string;
    /** False when a local evidence downgrade is not a prose defect. */
    actionableRepair?: boolean;
    /** In memory only: see ModelVerdict.repairText. Never stored. */
    repairText?: string;
    /**
     * In memory only (round 4 review, P3-6): the repair text quotes verified
     * entries (the targets check), so the fix is handled like a facts fix.
     */
    repairFromEntries?: true;
    /**
     * 2026-09-30 (second, Greptile round): a LEAVE OUT verdict's figure note
     * (orderedGeneration.ts leaveOutFigureNote), added to its row's reason;
     * the verdict itself is unchanged.
     */
    figureNote?: string;
  }>;
};

/**
 * Summary only: the text the one repair call should use for a `not_applied`
 * verdict whose reason or guidance was clipped, when it differs from the
 * stored `stored` text. Kept in memory only; bounded by the raw response limit.
 */
function unclippedRepairText(
  verdict: { outcome: "applied" | "not_applied"; unclipped?: UnclippedFreeText } | undefined,
  stored: string
): string | undefined {
  if (verdict?.outcome !== "not_applied" || !verdict.unclipped) return undefined;
  const full =
    verdict.unclipped.repairGuidance?.trim() || verdict.unclipped.reason.trim();
  return full && full !== stored ? full : undefined;
}

function boundedEscaped(value: string, maximum: number): boolean {
  return jsonEscapedUtf8Bytes(value) <= maximum;
}

function withinSummaryNumberReservation(value: number): boolean {
  return Number.isFinite(value) &&
    Math.abs(value) <= MAX_SUMMARY_SELF_CHECK_PARAGRAPH &&
    JSON.stringify(value).length <= String(MAX_SUMMARY_SELF_CHECK_PARAGRAPH).length;
}

/**
 * A whole-check rejection of the Summary Self-check. `diagnostic` names the
 * clause, the verdict position, and the byte counts, numbers, labels or plan
 * ids involved. Labels and ids are only ever the ones this app supplied, never
 * text the model wrote, so the diagnostic is safe to store and log.
 */
export class SummarySelfCheckRejection extends Error {
  readonly diagnostic: string;
  constructor(summary: string, diagnostic: string) {
    super(`${summary}: ${diagnostic}`);
    this.name = "SummarySelfCheckRejection";
    this.diagnostic = diagnostic;
  }
}

function overLimit(field: string, value: string, maximum: number): string | null {
  const bytes = jsonEscapedUtf8Bytes(value);
  return bytes > maximum ? `${field} is ${bytes} escaped bytes, limit ${maximum}` : null;
}

/** The labels and plan checks an answer gave no verdict for. */
type SummaryCoverageGap = {
  labels: SummaryOrdinaryCheck[];
  plans: SelfCheckPlanCheck[];
};

const PLAN_REF_PREFIX = {
  itemId: "item",
  skippedRoleId: "skip",
  droppedSeedId: "drop",
  ruleId: "rule",
} as const;

/** A plan check's or verdict's one reference as text; "" without exactly one. */
function planRefOf(check: SummaryPlanRefFields): string {
  const refs = summaryPlanRefsOf(check);
  return refs.length === 1 && refs[0]!.id !== ""
    ? `${PLAN_REF_PREFIX[refs[0]!.key]}:${refs[0]!.id}`
    : "";
}

/** How a plan check is named in a diagnostic (ids this app supplied only). */
function planCheckName(check: SummaryPlanRefFields): string {
  if (check.itemId) return `item ${check.itemId}`;
  if (check.droppedSeedId) return `left-out uncertainty ${check.droppedSeedId}`;
  if (check.ruleId) return `rule ${check.ruleId}`;
  return `Skip ${check.skippedRoleId ?? ""}`;
}

/**
 * The verdicts of one Summary answer that stand, and what it left missing.
 * `dropped` counts the invalid verdicts set aside.
 */
type ValidatedSummaryOutput = {
  raw: RawSelfCheck;
  missing: SummaryCoverageGap;
  dropped: number;
};

/**
 * Validates one Summary answer verdict by verdict (2026-09-28, run 4). A
 * verdict that is invalid (a label or plan reference nobody supplied, empty
 * or garbled, a repeat, a wrong check kind, a paragraph out of range, merged
 * ids that are not the supplied ones, a field over its limit) is dropped and
 * logged by its position, never its text; its label or plan check then counts
 * as missing, like one with no verdict at all, so the caller asks once for it
 * and records what is still missing as not checked. An invalid Storyline
 * question is dropped the same way. The whole answer is rejected only when
 * more than half of its verdicts are invalid; an unreadable or cut-off answer
 * never reaches this point.
 */
function validateSummaryOutput(args: {
  raw: RawSelfCheck;
  ordinaryChecks: readonly SummaryOrdinaryCheck[];
  planChecks: readonly SelfCheckPlanCheck[];
  allowStorylineQuestion: boolean;
  actualParagraphCount: number;
}): ValidatedSummaryOutput {
  const { raw, ordinaryChecks, planChecks } = args;
  summarySelfCheckWorstCaseResponse({
    ordinaryChecks,
    planChecks,
    includeStorylineQuestion: args.allowStorylineQuestion,
  });
  // 2026-09-28 (fifth): a list read as empty is not an invalid verdict; its
  // labels and plan checks count as missing below.
  if (raw.unreadableLists?.length) {
    console.warn(
      `${SELF_CHECK_REQUEST.toolName}: read ${raw.unreadableLists.join(" and ")} as an empty list; ` +
        "its labels and plan checks count as missing"
    );
  }
  const problems: string[] = [...(raw.malformed ?? [])];
  const ordinaryByLabel = new Map(ordinaryChecks.map((check) => [check.label, check]));
  const seenLabels = new Set<string>();
  const verdicts = raw.verdicts.filter((verdict, index) => {
    const expected = ordinaryByLabel.get(verdict.instruction);
    const problem = ((): string | null => {
      if (!expected) {
        return `label of ${jsonEscapedUtf8Bytes(verdict.instruction)} escaped bytes matches no supplied label`;
      }
      if (seenLabels.has(verdict.instruction)) return "label repeats";
      if (expected.check !== verdict.check) {
        return `check ${verdict.check}, expected ${expected.check}`;
      }
      if (
        !Number.isInteger(verdict.paragraph) ||
        verdict.paragraph < 0 ||
        verdict.paragraph > args.actualParagraphCount ||
        !withinSummaryNumberReservation(verdict.paragraph)
      ) {
        return `paragraph ${String(verdict.paragraph)} is not a whole number from 0 to ${args.actualParagraphCount}`;
      }
      return (
        overLimit("label", verdict.instruction, MAX_SUMMARY_SELF_CHECK_LABEL_ESCAPED_UTF8_BYTES) ??
        overLimit("reason", verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES) ??
        (verdict.repairGuidance === undefined
          ? null
          : overLimit(
              "repairGuidance",
              verdict.repairGuidance,
              MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES
            ))
      );
    })();
    if (problem) {
      problems.push(
        `ordinary verdict ${verdict.position ?? index + 1}${expected ? ` (${expected.label})` : ""}: ${problem}`
      );
      return false;
    }
    seenLabels.add(verdict.instruction);
    return true;
  });
  const seenPlanRefs = new Set<string>();
  const rawPlans = raw.planVerdicts ?? [];
  const planVerdicts = rawPlans.filter((verdict, index) => {
    // Check the reference before looking up its plan check: with no usable
    // reference, the lookup would match an unrelated item's undefined
    // skippedRoleId and the diagnostic would name that item. Since
    // 2026-09-30 (first) a verdict may also name a dropped uncertainty or a
    // rule; it still names exactly one reference.
    const ref = planRefOf(verdict);
    const usable = ref !== "";
    const [field] = summaryPlanRefsOf(verdict);
    const expected = usable
      ? planChecks.find((check) => sameSummaryPlanRef(verdict, check))
      : undefined;
    const problem = ((): string | null => {
      if (!usable) return "needs exactly one non-empty itemId, skippedRoleId, droppedSeedId or ruleId";
      if (!expected) {
        return `${field?.key ?? "itemId"} of ${jsonEscapedUtf8Bytes(field?.id ?? "")} escaped bytes matches no plan check`;
      }
      if (seenPlanRefs.has(ref)) return "plan reference repeats";
      if (verdict.paragraph !== undefined && !withinSummaryNumberReservation(verdict.paragraph)) {
        return "paragraph is past the numeric limit";
      }
      if (JSON.stringify(verdict.mergedItemIds) !== JSON.stringify(expected.mergedItemIds)) {
        return `mergedItemIds has ${verdict.mergedItemIds.length} ids, expected ` +
          (expected.mergedItemIds.length
            ? `[${expected.mergedItemIds.join(", ")}] in that order`
            : "none");
      }
      return (
        overLimit(
          "id",
          field?.id ?? "",
          MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES
        ) ??
        verdict.mergedItemIds
          .map((id) => overLimit("merged id", id, MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES))
          .find((found) => found !== null) ??
        overLimit("reason", verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES) ??
        (verdict.repairGuidance === undefined
          ? null
          : overLimit(
              "repairGuidance",
              verdict.repairGuidance,
              MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES
            ))
      );
    })();
    if (problem) {
      problems.push(
        `plan verdict ${verdict.position ?? index + 1}${
          expected ? ` (${planCheckName(expected)})` : ""
        }: ${problem}`
      );
      return false;
    }
    seenPlanRefs.add(ref);
    return true;
  });
  const total = raw.verdicts.length + rawPlans.length + (raw.malformed?.length ?? 0);
  if (problems.length * 2 > total) {
    throw new SummarySelfCheckRejection(
      "Summary Self-check returned more invalid verdicts than valid ones",
      `${problems.length} of ${total} verdicts invalid; first ${problems[0]}`
    );
  }
  let storylineQuestion = raw.storylineQuestion;
  if (raw.malformedQuestion) problems.push(raw.malformedQuestion);
  if (storylineQuestion) {
    const question = storylineQuestion;
    const problem = !args.allowStorylineQuestion
      ? "returned without both a Storyline and a Confidence Map"
      : overLimit("question", question.question, MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES) ??
        overLimit("sectionClaim", question.sectionClaim, MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES) ??
        overLimit(
          "storylineAlternative",
          question.storylineAlternative,
          MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
        ) ??
        (!Number.isInteger(question.confidenceEntry) ||
        question.confidenceEntry < 0 ||
        !withinSummaryNumberReservation(question.confidenceEntry)
          ? `confidenceEntry ${String(question.confidenceEntry)} is not a whole number from 0 to ${MAX_SUMMARY_SELF_CHECK_PARAGRAPH}`
          : null);
    if (problem) {
      problems.push(`Storyline question: ${problem}`);
      storylineQuestion = null;
    }
  }
  if (problems.length > 0) {
    console.warn(
      `${SELF_CHECK_REQUEST.toolName}: dropped ${problems.length} invalid ${
        problems.length === 1 ? "item" : "items"
      }; their labels and plan checks count as missing: ${problems.join("; ")}`
    );
  }
  const {
    malformed: _malformed,
    malformedQuestion: _malformedQuestion,
    unreadableLists: _unreadableLists,
    ...rest
  } = raw;
  const kept: RawSelfCheck = { ...rest, verdicts, planVerdicts, storylineQuestion };
  // A dropped question carries no clipping marker either.
  if (!storylineQuestion) delete kept.storylineQuestionClipped;
  return {
    raw: kept,
    missing: {
      labels: ordinaryChecks.filter((check) => !seenLabels.has(check.label)),
      plans: planChecks.filter((check) => !seenPlanRefs.has(planRefOf(check))),
    },
    dropped: problems.length,
  };
}

const MAX_SELF_CHECK_DIAGNOSTIC_CHARS = 300;

/**
 * A short reason for a failed Self-check call that is safe to store in the
 * Compliance Note and the section summary, and to log. It keeps the Summary
 * rejection clause, validation paths and codes, or a fixed description of the
 * failure kind. It never copies model text or provider messages.
 */
export function selfCheckFailureDiagnostic(error: unknown): string {
  let diagnostic: string;
  if (error instanceof SummarySelfCheckRejection) {
    diagnostic = error.diagnostic;
  } else if (error instanceof StructuredValidationError) {
    diagnostic = `response failed validation: ${error.issues
      .slice(0, 3)
      .map((issue) => issue.message
        ? `${issue.path} ${issue.message}`
        : `${issue.path} ${issue.code}`)
      .join("; ")}`;
  } else if (error instanceof OutputLimitError) {
    // Before MalformedOutputError, which it extends: a cut-off answer is not
    // bad JSON, and with one attempt the cut-off itself is what failed.
    diagnostic = "answer was cut off at the output limit";
  } else if (error instanceof MalformedOutputError) {
    diagnostic = "tool output was not valid JSON";
  } else if (error instanceof SeedContextLimitError) {
    diagnostic = `request refused before the call: ${error.limit}`;
  } else if (
    error instanceof Error &&
    error.message.endsWith("model did not return structured output")
  ) {
    diagnostic = "no tool output";
  } else {
    diagnostic = "no response to check";
  }
  return diagnostic.length > MAX_SELF_CHECK_DIAGNOSTIC_CHARS
    ? `${diagnostic.slice(0, MAX_SELF_CHECK_DIAGNOSTIC_CHARS - 1)}…`
    : diagnostic;
}

function exactPlanParagraphIndex(
  paragraph: number | undefined,
  count: number
): number | undefined {
  return typeof paragraph === "number" &&
    Number.isFinite(paragraph) &&
    Number.isInteger(paragraph) &&
    paragraph >= 1 &&
    paragraph <= count
    ? paragraph - 1
    : undefined;
}

/** Compliance Note reasons for a label or plan check with no verdict. */
export const NOT_CHECKED_REASON =
  "Not checked: the Self-check gave no verdict for this check.";
export const PLAN_ITEM_NOT_CHECKED_REASON =
  "Not checked: the plan coverage Self-check gave no verdict for this item.";
export const PLAN_SKIP_NOT_CHECKED_REASON =
  "Not checked: the plan coverage Self-check gave no verdict for this Skip.";
/** An applied item verdict with no valid paragraph holding the evidence. */
export const ITEM_EVIDENCE_UNLOCATED_REASON =
  "Applied plan verdict did not identify valid paragraph evidence.";
/**
 * 2026-09-28 (third): a Skip reported as not honoured that names no valid
 * paragraph where the role appears.
 */
export const SKIP_BREAK_UNLOCATED_REASON =
  "Skip reported as not honoured named no valid paragraph.";
/** 2026-09-30 (first): the same reasons for a LEAVE OUT check. */
export const PLAN_LEAVE_OUT_NOT_CHECKED_REASON =
  "Not checked: the plan coverage Self-check gave no verdict for this uncertainty the writer dropped.";
export const LEAVE_OUT_BREAK_UNLOCATED_REASON =
  "Dropped uncertainty reported as present named no valid paragraph.";
/** 2026-09-30 (first): the same reasons for Line 246's advancement check. */
export const PLAN_RULE_NOT_CHECKED_REASON =
  "Not checked: the plan coverage Self-check gave no verdict for whether every advancement answers a Line 242 uncertainty.";
export const RULE_BREAK_UNLOCATED_REASON =
  "Advancement reported as answering no Line 242 uncertainty named no valid paragraph.";
/** 2026-09-30 (second, Rule C): the same reasons for Line 244's work check. */
export const PLAN_WORK_RULE_NOT_CHECKED_REASON =
  "Not checked: the plan coverage Self-check gave no verdict for whether all work answers a Line 242 uncertainty or a signed-off item.";
export const WORK_RULE_BREAK_UNLOCATED_REASON =
  "Work reported as answering no Line 242 uncertainty named no valid paragraph.";
/** 2026-09-30 (third): the same reasons for the targets check. */
export const PLAN_TARGETS_NOT_CHECKED_REASON =
  "Not checked: the plan coverage Self-check gave no verdict for whether each result is stated against its target as the numbers show.";
export const TARGETS_BREAK_UNLOCATED_REASON =
  "Result reported as misstated against its target named no valid paragraph.";
/** 2026-10-04 (second): the same reasons for the facts check. */
export const PLAN_FACTS_NOT_CHECKED_REASON =
  "Not checked: the plan coverage Self-check gave no verdict for whether each figure and detail is stated as the sources give it.";
export const FACTS_BREAK_UNLOCATED_REASON =
  "Figure or detail reported as not matching the sources named no valid paragraph.";

/**
 * 2026-10-04 (second, round 2, owner approved 2026-10-05): a facts finding
 * whose quotes do not verify is never shown as an error and never repaired.
 * Round 2 review (P3-7): the model's words are cut like other stored text.
 */
export function factsNotCheckedReason(words: string): string {
  return `Not checked: the facts check flagged something it could not show from the sources (its words: ${rowQuote(words)})`;
}

/**
 * 2026-10-04 (second, round 3, owner approved 2026-10-05): the row of a facts
 * check that found nothing it could show. Fixed text, never the model's
 * words, so it never reads as a guarantee ("Figures and details match the
 * sources." sat beside a wrong detail in release suite run 6).
 */
export const FACTS_NOTHING_SHOWN_REASON =
  "The facts check found no figure or detail it could show differs from the sources.";

/** Normalized for quote matching: case, spacing, quote marks and dashes. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** The shortest part of a quote that can count as found (the rule says so). */
export const MIN_QUOTE_PART_CHARS = 8;
/** The most characters an ellipsis may skip between two parts of a quote. */
export const MAX_QUOTE_GAP_CHARS = 200;

/** A quote's parts, split at an ellipsis, without the marks around them. */
function quoteParts(quote: string): string[] {
  const trim = (part: string) => part.replace(/^["'\s.,;:]+|["'\s.,;:]+$/g, "");
  return normalizeForQuote(quote).split(/\s*\.\.\.\s*/).map(trim).filter(Boolean);
}

/** Whether the parts are in one normalized entry, in order, each gap at most MAX_QUOTE_GAP_CHARS. */
function partsInOrder(parts: readonly string[], entry: string): boolean {
  for (let start = entry.indexOf(parts[0]!); start >= 0; start = entry.indexOf(parts[0]!, start + 1)) {
    let end = start + parts[0]!.length;
    let whole = true;
    for (const part of parts.slice(1)) {
      const at = entry.indexOf(part, end);
      if (at < 0 || at - end > MAX_QUOTE_GAP_CHARS) {
        whole = false;
        break;
      }
      end = at + part.length;
    }
    if (whole) return true;
  }
  return false;
}

/**
 * Whether a quote is in a text or in one of a list of entries: every part
 * (split at an ellipsis) at least MIN_QUOTE_PART_CHARS long, all in the same
 * entry, in order, with at most MAX_QUOTE_GAP_CHARS between two parts, after
 * normalizeForQuote (round 2 review, P2-2: an ellipsis never joins two
 * places).
 */
export function quoteFoundIn(quote: string, text: string | readonly string[]): boolean {
  const parts = quoteParts(quote);
  if (parts.length === 0 || parts.some((part) => part.length < MIN_QUOTE_PART_CHARS)) return false;
  const entries = typeof text === "string" ? [text] : text;
  return entries.some((entry) => partsInOrder(parts, normalizeForQuote(entry)));
}

/** Whether two quotes are the same text after normalizing, ellipses and edge marks aside. */
function sameQuoteText(a: string, b: string): boolean {
  return quoteParts(a).join(" ") === quoteParts(b).join(" ");
}

/** A finding whose quotes verified, with the paragraph that holds its draft quote. */
export type VerifiedFactsFinding = {
  paragraphIndex: number;
  draftQuote: string;
  sourceQuote: string;
  correction: string;
};

/** How a quote reads in a row: one line, at most 160 characters. */
function rowQuote(quote: string): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 159).trimEnd()}…` : flat;
}

/**
 * 2026-10-04 (second, round 2): verify a not applied facts verdict's findings.
 * The draft quote must be in a paragraph of the checked text (the one the
 * verdict names, else the first that holds it); the source quote must be in
 * one of the `sources` entries, and the two quotes must not be the same
 * text after normalizing (the draft quoted back as its source, so nothing
 * differs). Greptile on PR #26 at 17d3d1a8 and 7e3964cc: a source quote the
 * paragraph also states, or one quote holding the other, still verifies,
 * since a draft can add a group to the source's words or drop a qualifier
 * from them. Whether two different texts state the same fact is the
 * prompt's job. Round 2 review, P2-4: while the source documents are
 * not complete, a verified finding whose draft quote a signed-off item's
 * wording holds (`items`) is held: shown, never repaired, since the
 * documents that could support the item were not read.
 */
export function verifyFactsFindings(args: {
  findings: readonly RawFactsFinding[];
  paragraphs: readonly string[];
  sources: readonly string[];
  /** The verdict's own paragraph (1-based), preferred where it holds a draft quote. */
  paragraph?: number;
  items?: readonly string[];
  /**
   * Round 4 review (P2-3): an applied targets verdict's evidence may quote
   * words the section copied from the sources, so the same-text drop is off.
   */
  sameTextAllowed?: boolean;
}): { verified: VerifiedFactsFinding[]; held: VerifiedFactsFinding[]; unverified: number } {
  const verified: VerifiedFactsFinding[] = [];
  const held: VerifiedFactsFinding[] = [];
  const named = typeof args.paragraph === "number" && Number.isInteger(args.paragraph) ? args.paragraph - 1 : -1;
  for (const finding of args.findings) {
    const holds = (index: number) => index >= 0 && index < args.paragraphs.length &&
      quoteFoundIn(finding.draftQuote, args.paragraphs[index]!);
    const paragraphIndex = holds(named) ? named : args.paragraphs.findIndex((_, index) => holds(index));
    if (paragraphIndex < 0) continue;
    if (!quoteFoundIn(finding.sourceQuote, args.sources)) continue;
    if (!args.sameTextAllowed && sameQuoteText(finding.sourceQuote, finding.draftQuote)) continue;
    const shown = {
      paragraphIndex,
      draftQuote: finding.draftQuote.trim(),
      sourceQuote: finding.sourceQuote.trim(),
      correction: finding.correction.trim(),
    };
    if (args.items && quoteFoundIn(finding.draftQuote, args.items)) held.push(shown);
    else verified.push(shown);
  }
  return { verified, held, unverified: args.findings.length - verified.length - held.length };
}

/** Each finding's two quotes, plainly. */
function findingsText(findings: readonly VerifiedFactsFinding[]): string {
  return findings
    .map((finding) => `P${finding.paragraphIndex + 1} says "${rowQuote(finding.draftQuote)}", but the sources say "${rowQuote(finding.sourceQuote)}".`)
    .join(" ");
}

/**
 * The row of a facts verdict with shown findings: each finding's two quotes;
 * then any held finding (round 2 review, P2-4) and how many could not be
 * shown from the sources (P3-6).
 */
export function factsFindingsReason(
  verified: readonly VerifiedFactsFinding[],
  unverified: number,
  held: readonly VerifiedFactsFinding[] = []
): string {
  const parts = [
    ...(verified.length > 0 ? [findingsText(verified)] : []),
    ...(held.length > 0 ? [`${FACTS_HELD_PREFIX}${findingsText(held)}`] : []),
    ...(unverified > 0
      ? [`${unverified} more ${unverified === 1 ? "finding was" : "findings were"} not shown: ${unverified === 1 ? "its" : "their"} quotes could not be shown from the sources.`]
      : []),
  ];
  return parts.join(" ");
}

/** How a held finding begins on its row (round 2 review, P2-4). */
export const FACTS_HELD_PREFIX =
  "Not repaired, since a signed-off item gives these words and not every source document could be read: ";

/** The repair's fix for verified findings: each paragraph, both quotes and the correction. */
export function factsRepairText(verified: readonly VerifiedFactsFinding[]): string {
  return verified
    .map((finding) =>
      `Paragraph ${finding.paragraphIndex + 1}: the section says "${finding.draftQuote}", but the sources say "${finding.sourceQuote}".${
        finding.correction ? ` Write it as the sources give it: ${finding.correction}` : ""
      }`)
    .join(" ");
}

/**
 * 2026-10-04 (second, round 4): the targets verdict's evidence, verified like
 * the facts verdict's (`verifyFactsFindings`: the draft quote in a paragraph,
 * the source quote in source wording, the quote rules and the same-text
 * drop), and its target quote, when given, in source wording too.
 */
export type VerifiedTargetFinding = VerifiedFactsFinding & { targetQuote?: string };

export function verifyTargetFindings(args: {
  findings: ReadonlyArray<RawFactsFinding & { targetQuote?: string }>;
  paragraphs: readonly string[];
  sources: readonly string[];
  paragraph?: number;
  items?: readonly string[];
  sameTextAllowed?: boolean;
}): { verified: VerifiedTargetFinding[]; held: VerifiedTargetFinding[]; unverified: number } {
  const verified: VerifiedTargetFinding[] = [];
  const held: VerifiedTargetFinding[] = [];
  let unverified = 0;
  for (const finding of args.findings) {
    const target = finding.targetQuote?.trim();
    if (target && !quoteFoundIn(target, args.sources)) {
      unverified += 1;
      continue;
    }
    const one = verifyFactsFindings({ ...args, findings: [finding] });
    const withTarget = (shown: VerifiedFactsFinding): VerifiedTargetFinding => ({ ...shown, ...(target ? { targetQuote: target } : {}) });
    verified.push(...one.verified.map(withTarget));
    held.push(...one.held.map(withTarget));
    unverified += one.unverified;
  }
  return { verified, held, unverified };
}

/**
 * Words that say a target was met, and words that name a target. Round 4
 * review (P2-1): "passed" is in, and requirements, criteria, tolerances, aims
 * and objectives name a target too. Re-check P3-B2: "exceeded" says a target
 * was met only before a target, goal or requirement (for a limit or a
 * threshold it says the target was missed).
 */
const MET_WORDS = String.raw`met|meets?|meeting|reached|reach(?:es|ing)?|achieved|achiev(?:es|ing)|hits?|within|satisfied|passed|pass(?:es|ing)|exceed(?:ed|s|ing)?(?=\s+(?:[\w-]+\s+){0,4}?(?:targets?|goals?|requirements?)\b)`;
const TARGET_WORDS = String.raw`targets?|goals?|thresholds?|specifications?|specs?|limits?|requirements?|criteria|criterion|tolerances?|aims?|objectives?`;
const MET_WORD = new RegExp(String.raw`\b(?:${MET_WORDS})\b`, "gi");
const TARGET_WORD = new RegExp(String.raw`\b(?:${TARGET_WORDS})\b`, "i");
/** A negation up to four words before the met word, in the same phrase: "did not meet", "none of the four coatings met". */
const NEGATION_BEFORE = /(?:\b(?:not|never|no|none|neither|nor|unable|failed to|fail to|without)|n't)\s+(?:[\w'-]+\s+){0,4}$/i;
/** "to" just before it, or a modal up to two words before: "to meet", "would meet", "could be held within". */
const UNREAL_BEFORE = /(?:\bto\s+(?:be\s+)?|\b(?:would|could|will|may|might|can|should|must)\s+(?:[\w'-]+\s+){0,2})$/i;
/**
 * A plan, an aim or a question earlier in the sentence: "was planned to test
 * whether", "It was hypothesized that", "The aim of this work was to
 * develop". Re-check P3-B2: a plan word counts only before "to", "that" or
 * "whether", so "As expected, it met the target" and "The hypothesized cure
 * target was reached" state results.
 */
const PLAN_BEFORE = /\b(?:(?:hypothesi[sz]ed|planned|aimed|expected|intended|sought)\s+(?:to|that|whether)|whether|if|(?:was|were|is|are)\s+to)\b/i;
/** Where a new clause starts within a sentence. */
const CLAUSE_BREAK = /,\s+(?:and|but|while|whereas)\s+/i;
/**
 * After the met word, what says no target was met: "met with" a person,
 * "reached only" or "reached 58 microns" (a figure, re-check P2-B1),
 * "passed through" the oven (re-check P3-B3).
 */
const NOT_MET_AFTER = /^\s+(?:with|only|through|over|into|(?:(?:about|just|nearly|almost|roughly|around)\s+)?\d)/i;
/** Re-check P2-B1: a miss stated in the rest of its phrase: "short of", "fell short", "missed", "against", "below". */
const MISS_IN_PHRASE = /\b(?:short of|fell short|falls short|missed|against|below)\b/i;

export type TargetMetSentence = {
  paragraphIndex: number;
  sentence: string;
  /** The words in it that say a target was met, as the sentence writes them. */
  metWords: string[];
};

/**
 * 2026-10-04 (second, round 4): each sentence of the checked text that says a
 * target was met: it names a target and holds a word for met that says so.
 * Round 4 review (P2-1): a met word after a negation ("did not meet", "none
 * met", "unable to meet"), after "to", a modal or "be" ("could be reached",
 * "would meet"), after a plan, an aim or a question earlier in the sentence
 * ("was planned to test whether", "It was hypothesized", "The aim of this
 * work was to develop"), or followed by "with" or "only" ("met with the supplier",
 * "reached only 35 microns") does not say a target was met.
 */
export function targetMetSentences(paragraphs: readonly string[]): TargetMetSentence[] {
  return paragraphs.flatMap((paragraph, paragraphIndex) =>
    paragraph.split(/(?<=[.!?;])\s+/).flatMap((sentence) => {
      if (!TARGET_WORD.test(sentence)) return [];
      const metWords = [...sentence.matchAll(MET_WORD)].flatMap((match) => {
        const at = match.index ?? 0;
        const before = sentence.slice(0, at);
        const after = sentence.slice(at + match[0].length);
        // A plan word counts only in the same clause ("The objective was to
        // understand ..., and it was largely achieved" states a result).
        const clause = before.split(CLAUSE_BREAK).pop() ?? before;
        // Re-check P2-B1: the rest of the phrase, up to the next comma or
        // semicolon, that states a miss ("reached 52 microns, short of",
        // "reached the width against a 60 micron target").
        const phrase = after.split(/[,;]/)[0] ?? after;
        return NEGATION_BEFORE.test(before) || UNREAL_BEFORE.test(before) || PLAN_BEFORE.test(clause) ||
          NOT_MET_AFTER.test(after) || MISS_IN_PHRASE.test(phrase)
          ? []
          : [match[0]];
      });
      return metWords.length > 0 ? [{ paragraphIndex, sentence: sentence.trim(), metWords }] : [];
    }));
}

/** Whether an entry's draft quote is in the sentence and holds one of its met words (review P2-2). */
function coversMetSentence(draftQuote: string, met: TargetMetSentence): boolean {
  return quoteFoundIn(draftQuote, met.sentence) &&
    met.metWords.some((word) => new RegExp(String.raw`\b${word}\b`, "i").test(draftQuote));
}

/** How a quote reads in a targets row: one line, at most 80 characters (review P2-4). */
function shortQuote(quote: string): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79).trimEnd()}…` : flat;
}

/** One entry's quotes, with its target when given, plainly and short. */
function targetFindingText(finding: VerifiedTargetFinding): string {
  return `P${finding.paragraphIndex + 1} "${shortQuote(finding.draftQuote)}", the sources "${shortQuote(finding.sourceQuote)}"${
    finding.targetQuote ? `, the target "${shortQuote(finding.targetQuote)}"` : ""
  }.`;
}

/** One error's quotes, with its target when given, plainly and short. */
function targetErrorText(finding: VerifiedTargetFinding): string {
  return `P${finding.paragraphIndex + 1} says "${shortQuote(finding.draftQuote)}", but the sources say "${shortQuote(finding.sourceQuote)}"${
    finding.targetQuote ? ` against the target "${shortQuote(finding.targetQuote)}"` : ""
  }.`;
}

/** The row of a not applied targets verdict with shown entries (round 4). */
export function targetFindingsReason(
  verified: readonly VerifiedTargetFinding[],
  unverified: number,
  held: readonly VerifiedTargetFinding[] = []
): string {
  return [
    ...verified.map(targetErrorText),
    ...(held.length > 0 ? [`${FACTS_HELD_PREFIX}${held.map(targetErrorText).join(" ")}`] : []),
    ...(unverified > 0
      ? [`${unverified} more ${unverified === 1 ? "finding was" : "findings were"} not shown: ${unverified === 1 ? "its" : "their"} quotes could not be shown from the sources.`]
      : []),
  ].join(" ");
}

/**
 * The row of an applied targets verdict that quoted source words for each
 * sentence that says a target was met (round 4). Review P2-2: it says what
 * the check quoted, not that the sources show the claim, since code only
 * verifies that the quotes exist.
 */
export function targetsShownReason(evidence: readonly VerifiedTargetFinding[]): string {
  return `The targets check quoted these source words for each target stated as met: ${evidence.map(targetFindingText).join(" ")}`;
}

/** Round 4: a target claim the check could not show from the sources (review P2-1 wording). */
export function targetsNotShownReason(met: { paragraphIndex: number; sentence: string }): string {
  return `Not checked: the targets check could not show from the sources the target claim in P${met.paragraphIndex + 1} ("${shortQuote(met.sentence)}").`;
}

/** Round 4: a not applied targets verdict with no entry whose quotes verify. */
export function targetsNotCheckedReason(words: string): string {
  return `Not checked: the targets check flagged something it could not show from the sources (its words: ${rowQuote(words)})`;
}

/** Round 4: the repair's fix for verified target errors. */
export function targetsRepairText(verified: readonly VerifiedTargetFinding[]): string {
  return verified
    .map((finding) =>
      `Paragraph ${finding.paragraphIndex + 1}: the section says "${finding.draftQuote}", but the sources say "${finding.sourceQuote}"${
        finding.targetQuote ? ` against the target "${finding.targetQuote}"` : ""
      }.${finding.correction ? ` Write it as the sources give it: ${finding.correction}` : ""}`)
    .join(" ");
}

function planNotCheckedReason(check: SummaryPlanRefFields): string {
  if (check.itemId) return PLAN_ITEM_NOT_CHECKED_REASON;
  if (check.droppedSeedId) return PLAN_LEAVE_OUT_NOT_CHECKED_REASON;
  if (check.ruleId === WORK_ANSWERS_242_RULE_ID) return PLAN_WORK_RULE_NOT_CHECKED_REASON;
  if (check.ruleId === RESULTS_AGAINST_TARGETS_RULE_ID) return PLAN_TARGETS_NOT_CHECKED_REASON;
  if (check.ruleId === FACTS_MATCH_SOURCES_RULE_ID) return PLAN_FACTS_NOT_CHECKED_REASON;
  if (check.ruleId) return PLAN_RULE_NOT_CHECKED_REASON;
  return PLAN_SKIP_NOT_CHECKED_REASON;
}

/**
 * Round 5 (rule 6): the one paragraph of the Line a finding's own words
 * name ("P2", "paragraph 2"), or undefined when they name none, several, or
 * one the Line does not have.
 */
function paragraphNamedIn(text: string, count: number): number | undefined {
  const named = new Set([...text.matchAll(/\b(?:P|paragraph\s+)(\d{1,2})\b/gi)].map((match) => Number(match[1])));
  if (named.size !== 1) return undefined;
  const [number] = [...named];
  return number !== undefined && number >= 1 && number <= count ? number - 1 : undefined;
}

function planBreakUnlocatedReason(check: SummaryPlanRefFields): string {
  if (check.droppedSeedId) return LEAVE_OUT_BREAK_UNLOCATED_REASON;
  if (check.ruleId === WORK_ANSWERS_242_RULE_ID) return WORK_RULE_BREAK_UNLOCATED_REASON;
  if (check.ruleId === RESULTS_AGAINST_TARGETS_RULE_ID) return TARGETS_BREAK_UNLOCATED_REASON;
  if (check.ruleId === FACTS_MATCH_SOURCES_RULE_ID) return FACTS_BREAK_UNLOCATED_REASON;
  if (check.ruleId) return RULE_BREAK_UNLOCATED_REASON;
  return SKIP_BREAK_UNLOCATED_REASON;
}

/**
 * The follow-up request: the data blocks, the follow-up text and only what
 * is missing. A side with nothing missing is asked for as an empty list.
 */
function followUpMessage(data: string, gap: SummaryCoverageGap): string {
  const followUp = SUMMARY_PLAN_SELF_CHECK_REQUEST.missingFollowUp;
  const separator = SUMMARY_PLAN_SELF_CHECK_REQUEST.checklist.separator;
  const empty = [
    ...(gap.labels.length === 0 ? [followUp.emptyVerdicts] : []),
    ...(gap.plans.length === 0 ? [followUp.emptyPlanVerdicts] : []),
  ];
  return [
    `${data}${followUp.prefix}`,
    summaryChecklist(gap.labels, gap.plans),
    ...empty,
  ].join(separator);
}

/**
 * The Summary Self-check (2026-09-28). The first answer must cover every
 * listed label and plan check. When it misses some, one follow-up asks for
 * only those, in place of the structured repair this check otherwise skips,
 * and the answers are merged; a follow-up verdict for something the first
 * answer already covered is dropped. Whatever is still missing, or everything the
 * first answer missed when the follow-up fails, comes back as not checked,
 * one by one; the verdicts the first answer gave are kept. An invalid verdict
 * is dropped and its label or plan check counts as missing (2026-09-28,
 * run 4); only a first answer with more invalid verdicts than valid ones, or
 * one that is unreadable or cut off, rejects the whole check. A verdict list
 * that is missing or not a list is read as empty, so everything it should
 * have held is asked for in the follow-up (2026-09-28, fifth); an answer
 * with neither list is unreadable.
 */
async function completeSummarySelfCheck(
  client: GenerationClient,
  input: SelfCheckModelInput,
  args: {
    user: string;
    /** The data blocks without the first request's checklist. */
    data: string;
    ordinaryChecks: readonly SummaryOrdinaryCheck[];
    planChecks: readonly SelfCheckPlanCheck[];
    actualParagraphCount: number;
  }
): Promise<{ raw: RawSelfCheck; notChecked: SummaryCoverageGap }> {
  const ask = (
    user: string,
    ordinary: readonly SummaryOrdinaryCheck[],
    plans: readonly SelfCheckPlanCheck[]
  ) =>
    generateStructured<RawSelfCheck>(client, {
      system: SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
      user,
      toolName: SELF_CHECK_REQUEST.toolName,
      description: SELF_CHECK_REQUEST.toolDescription,
      schema: summaryPlanSelfCheckSchemaFor(ordinary, plans) as unknown as Anthropic.Tool.InputSchema,
      maxTokens: SUMMARY_PLAN_SELF_CHECK_REQUEST.maxTokens,
      model: input.model,
      validate: summaryPlanSelfCheckOutputSchema,
      attempts: 1,
      encodedJsonRecovery: false,
    });
  // Invalid verdicts are dropped here and their labels and plan checks
  // count as missing (2026-09-28, run 4).
  const firstAnswer = validateSummaryOutput({
    raw: await ask(args.user, args.ordinaryChecks, args.planChecks),
    ordinaryChecks: args.ordinaryChecks,
    planChecks: args.planChecks,
    allowStorylineQuestion:
      input.storylineText.trim().length > 0 && input.confidenceMap.length > 0,
    actualParagraphCount: args.actualParagraphCount,
  });
  const first = firstAnswer.raw;
  const gap = firstAnswer.missing;
  if (gap.labels.length === 0 && gap.plans.length === 0) {
    return { raw: first, notChecked: gap };
  }
  const tool = SELF_CHECK_REQUEST.toolName;
  console.warn(
    `${tool}: no verdict for ${gap.labels.length} of ${args.ordinaryChecks.length} labels ` +
      `and ${gap.plans.length} of ${args.planChecks.length} plan checks; asking once for them`
  );
  let followUp: RawSelfCheck;
  let stillMissing: SummaryCoverageGap;
  try {
    const answer = await ask(followUpMessage(args.data, gap), gap.labels, gap.plans);
    // A verdict for a label or plan check the first answer already covered
    // is dropped without counting as invalid; any other invalid verdict is
    // dropped as in the first answer, and only a follow-up with more invalid
    // verdicts than valid ones is set aside. The follow-up answers for
    // coverage only: a Storyline question comes from the first answer.
    const answeredLabels = new Set(
      args.ordinaryChecks
        .filter((check) => !gap.labels.includes(check))
        .map((check) => check.label)
    );
    const answeredPlans = new Set(
      args.planChecks.filter((check) => !gap.plans.includes(check)).map(planRefOf)
    );
    const verdicts = answer.verdicts.filter((verdict) => !answeredLabels.has(verdict.instruction));
    const planVerdicts = (answer.planVerdicts ?? []).filter((verdict) =>
      planRefOf(verdict) === "" || !answeredPlans.has(planRefOf(verdict)));
    const dropped =
      answer.verdicts.length - verdicts.length +
      (answer.planVerdicts ?? []).length - planVerdicts.length;
    if (dropped > 0) {
      console.warn(`${tool}: the follow-up repeated ${dropped} verdicts the first answer gave; dropped`);
    }
    const followUpAnswer = validateSummaryOutput({
      raw: {
        verdicts,
        planVerdicts,
        ...(answer.malformed ? { malformed: answer.malformed } : {}),
        ...(answer.unreadableLists ? { unreadableLists: answer.unreadableLists } : {}),
      },
      ordinaryChecks: gap.labels,
      planChecks: gap.plans,
      allowStorylineQuestion: false,
      actualParagraphCount: args.actualParagraphCount,
    });
    followUp = followUpAnswer.raw;
    stillMissing = followUpAnswer.missing;
  } catch (error) {
    console.warn(
      `${tool}: the follow-up for missing labels failed (${selfCheckFailureDiagnostic(error)}); ` +
        `${gap.labels.length} labels and ${gap.plans.length} plan checks recorded as not checked`
    );
    return { raw: first, notChecked: gap };
  }
  if (stillMissing.labels.length > 0 || stillMissing.plans.length > 0) {
    console.warn(
      `${tool}: still no verdict for ${stillMissing.labels.length} labels and ` +
        `${stillMissing.plans.length} plan checks; recorded as not checked`
    );
  }
  return {
    raw: {
      ...first,
      verdicts: [...first.verdicts, ...followUp.verdicts],
      planVerdicts: [...(first.planVerdicts ?? []), ...(followUp.planVerdicts ?? [])],
    },
    notChecked: stillMissing,
  };
}

/**
 * One structured Self-check call for one drafted section; in Summary mode,
 * at most one follow-up for labels the first answer missed.
 */
export async function runModelSelfCheck(
  client: GenerationClient,
  input: SelfCheckModelInput
): Promise<ModelSelfCheckResult> {
  const hasSummaryPlan = Boolean(input.planChecks?.length);
  const ordinaryChecks = hasSummaryPlan ? summaryOrdinaryChecks(input) : [];
  const count = sectionParagraphs(input.text).length;
  const user = buildSelfCheckUserMessage(input);
  const { raw, notChecked } = hasSummaryPlan
    ? await completeSummarySelfCheck(client, input, {
        user,
        data: buildSelfCheckDataMessage(input),
        ordinaryChecks,
        planChecks: input.planChecks ?? [],
        actualParagraphCount: count,
      })
    : {
        raw: await generateStructured<RawSelfCheck>(client, {
          system: SELF_CHECK_SYSTEM_PROMPT,
          user,
          toolName: SELF_CHECK_REQUEST.toolName,
          description: SELF_CHECK_REQUEST.toolDescription,
          schema: SELF_CHECK_SCHEMA as unknown as Anthropic.Tool.InputSchema,
          maxTokens: SELF_CHECK_REQUEST.maxTokens,
          model: input.model,
          validate: selfCheckOutputSchema,
        }),
        notChecked: { labels: [], plans: [] } satisfies SummaryCoverageGap,
      };
  const verdicts: ModelVerdict[] = raw.verdicts
    .slice(0, SELF_CHECK_REQUEST.maxVerdicts)
    .map((verdict) => {
      const repairText = hasSummaryPlan
        ? unclippedRepairText(
            verdict,
            verdict.repairGuidance?.trim() || verdict.reason.trim()
          )
        : undefined;
      const ordinary = hasSummaryPlan
        ? ordinaryChecks.find((check) => check.label === verdict.instruction)
        : undefined;
      return {
        paragraphIndex: hasSummaryPlan
          ? verdict.paragraph === 0
            ? undefined
            : verdict.paragraph - 1
          : clampParagraph(verdict.paragraph, count, true),
        check: verdict.check,
        instruction: hasSummaryPlan
          ? ordinary?.instruction ?? `${verdict.check} check`
          : verdict.instruction.trim() || `${verdict.check} check`,
        ...(ordinary?.feedbackTerm !== undefined ? { feedbackTerm: ordinary.feedbackTerm } : {}),
        outcome: verdict.outcome,
        reason: verdict.reason.trim(),
        ...(verdict.repairGuidance?.trim()
          ? { repairGuidance: verdict.repairGuidance.trim() }
          : {}),
        ...(repairText ? { repairText } : {}),
        // Round 5 follow-up: the reason as sent, when clipping shortened it,
        // for the one row that stores it whole (the writer's settings row).
        ...(verdict.unclipped && verdict.unclipped.reason.trim() !== verdict.reason.trim()
          ? { unclippedReason: verdict.unclipped.reason.trim() }
          : {}),
      };
    });
  // 2026-09-28 (second, edited terms): the request says the writer's edited
  // terms are allowed. A verdict that still objects to one as invented or
  // unsourced is set aside: recorded as applied with a fixed reason and never
  // sent to the repair. Everything else is judged as the model judged it.
  const editedTerms = hasSummaryPlan ? summaryEditedTerms(input) : [];
  if (editedTerms.length > 0) {
    const setAside: number[] = [];
    verdicts.forEach((verdict, index) => {
      if (verdict.outcome !== "not_applied" || verdict.notChecked) return;
      const said = [verdict.reason, verdict.repairGuidance ?? "", verdict.repairText ?? ""].join(" ");
      // Kept when it also quotes something that is not an edited term: the
      // objection may be about that too.
      const quoted = [...said.matchAll(QUOTED_PHRASE)].map((match) => match[1]);
      if (
        !INVENTED_TERM_OBJECTION.test(said) ||
        !editedTerms.some((term) => containsTerm(said, term)) ||
        quoted.some((phrase) => !editedTerms.some((term) => containsTerm(phrase, term)))
      ) {
        return;
      }
      verdicts[index] = {
        ...(verdict.paragraphIndex === undefined ? {} : { paragraphIndex: verdict.paragraphIndex }),
        check: verdict.check,
        instruction: verdict.instruction,
        ...(verdict.feedbackTerm !== undefined ? { feedbackTerm: verdict.feedbackTerm } : {}),
        outcome: "applied",
        reason: EDITED_TERM_ALLOWED_REASON,
      };
      setAside.push(index + 1);
    });
    if (setAside.length > 0) {
      console.warn(
        `${SELF_CHECK_REQUEST.toolName}: set aside ${setAside.length} ${
          setAside.length === 1 ? "objection" : "objections"
        } to the writer's edited terms (ordinary verdicts ${setAside.join(", ")})`
      );
    }
  }
  // A label with no verdict is recorded on its own, never as applied, and
  // never sent to the repair: nothing says the section fails it.
  for (const check of notChecked.labels) {
    verdicts.push({
      check: check.check,
      instruction: check.instruction,
      ...(check.feedbackTerm !== undefined ? { feedbackTerm: check.feedbackTerm } : {}),
      outcome: "not_applied",
      reason: NOT_CHECKED_REASON,
      notChecked: true,
    });
  }
  // A clipped Storyline question is withheld: "Use the section's evidence"
  // would make its shortened alternative the whole Storyline. The coverage
  // verdicts above are complete and stay.
  const withheld = hasSummaryPlan ? raw.storylineQuestionClipped : undefined;
  const question = withheld ? null : raw.storylineQuestion;
  const entryIndex =
    question && Number.isInteger(question.confidenceEntry) &&
    question.confidenceEntry >= 1 &&
    question.confidenceEntry <= input.confidenceMap.length
      ? question.confidenceEntry - 1
      : null;
  const paragraphs = sectionParagraphs(input.text);
  const planVerdicts: ModelSelfCheckResult["planVerdicts"] = (input.planChecks ?? []).map((expected) => {
      const verdict = raw.planVerdicts?.find((candidate) => sameSummaryPlanRef(expected, candidate));
      // 2026-10-04 (second, round 2): a not applied facts verdict is shown
      // and repaired only for findings whose quotes verify; otherwise it is
      // not checked, in the model's own words, and never repaired.
      // 2026-10-04 (second, round 4): with the SOURCE FACTS block, the targets
      // verdict carries its evidence. An error is shown and repaired only
      // when its quotes verify, and an applied verdict on a Line that says a
      // target was met vouches only where its evidence shows each such
      // sentence from the sources; otherwise the row is not checked.
      if (expected.ruleId === RESULTS_AGAINST_TARGETS_RULE_ID && verdict && input.sourceFacts) {
        const applied = verdict.outcome === "applied";
        const { verified, held, unverified } = verifyTargetFindings({
          // Review P3-7: an applied verdict's evidence has no correction; an
          // entry with one is not evidence that the target was met.
          findings: (verdict.targetFindings ?? []).filter((finding) => !applied || !finding.correction.trim()),
          paragraphs,
          sources: factsVerificationSources(input),
          ...(verdict.paragraph !== undefined ? { paragraph: verdict.paragraph } : {}),
          ...(!input.sourceFacts.documentsComplete ? { items: input.sourceFacts.items } : {}),
          // Review P2-3: a faithful draft may copy the source's words.
          ...(applied ? { sameTextAllowed: true } : {}),
        });
        const ref = { ruleId: expected.ruleId, mergedItemIds: [...expected.mergedItemIds] };
        if (applied) {
          const met = targetMetSentences(paragraphs);
          if (met.length > 0) {
            const evidence = [...verified, ...held];
            // Review P2-2 and P3-7: each sentence needs an entry whose draft
            // quote it holds and that holds its met word, wherever the entry
            // was located.
            const unshown = met.find((sentence) => !evidence.some((finding) => coversMetSentence(finding.draftQuote, sentence)));
            if (unshown) {
              return { ...ref, paragraphIndex: unshown.paragraphIndex, outcome: "not_applied" as const, reason: targetsNotShownReason(unshown), actionableRepair: false };
            }
            return { ...ref, outcome: "applied" as const, reason: targetsShownReason(evidence) };
          }
        } else if (verified.length === 0 && held.length > 0) {
          return { ...ref, paragraphIndex: held[0]!.paragraphIndex, outcome: "not_applied" as const, reason: targetFindingsReason([], unverified, held), actionableRepair: false };
        } else if (verified.length === 0) {
          // Review P3-8: never repaired from the model's guidance alone, as for
          // the facts check: an error that cannot be shown is not checked.
          console.warn(`${SELF_CHECK_REQUEST.toolName}: a targets verdict with ${verdict.targetFindings?.length ?? 0} entr(ies) had none that verified; recorded as not checked`);
          return { ...ref, outcome: "not_applied" as const, reason: targetsNotCheckedReason(verdict.unclipped?.reason ?? verdict.reason), actionableRepair: false };
        } else {
          return {
            ...ref,
            paragraphIndex: verified[0]!.paragraphIndex,
            outcome: "not_applied" as const,
            reason: targetFindingsReason(verified, unverified, held),
            actionableRepair: true,
            repairText: targetsRepairText(verified),
            repairFromEntries: true as const,
          };
        }
      }
      // Round 3: an applied facts verdict says only what the check could not show.
      if (expected.ruleId === FACTS_MATCH_SOURCES_RULE_ID && verdict?.outcome === "applied") {
        return {
          ruleId: expected.ruleId,
          mergedItemIds: [...expected.mergedItemIds],
          outcome: "applied" as const,
          reason: FACTS_NOTHING_SHOWN_REASON,
        };
      }
      if (expected.ruleId === FACTS_MATCH_SOURCES_RULE_ID && verdict?.outcome === "not_applied") {
        const { verified, held, unverified } = verifyFactsFindings({
          findings: verdict.findings ?? [],
          paragraphs,
          sources: factsVerificationSources(input),
          ...(verdict.paragraph !== undefined ? { paragraph: verdict.paragraph } : {}),
          ...(input.sourceFacts && !input.sourceFacts.documentsComplete ? { items: input.sourceFacts.items } : {}),
        });
        if (verified.length === 0 && held.length > 0) {
          return {
            ruleId: expected.ruleId,
            mergedItemIds: [...expected.mergedItemIds],
            paragraphIndex: held[0]!.paragraphIndex,
            outcome: "not_applied" as const,
            reason: factsFindingsReason([], unverified, held),
            actionableRepair: false,
          };
        }
        if (verified.length === 0) {
          console.warn(`${SELF_CHECK_REQUEST.toolName}: a facts verdict with ${verdict.findings?.length ?? 0} finding(s) had none that verified; recorded as not checked`);
          return {
            ruleId: expected.ruleId,
            mergedItemIds: [...expected.mergedItemIds],
            outcome: "not_applied" as const,
            reason: factsNotCheckedReason(verdict.unclipped?.reason ?? verdict.reason),
            actionableRepair: false,
          };
        }
        if (unverified > 0) {
          console.warn(`${SELF_CHECK_REQUEST.toolName}: ${unverified} facts finding(s) did not verify; left out`);
        }
        return {
          ruleId: expected.ruleId,
          mergedItemIds: [...expected.mergedItemIds],
          paragraphIndex: verified[0]!.paragraphIndex,
          outcome: "not_applied" as const,
          reason: factsFindingsReason(verified, unverified, held),
          actionableRepair: true,
          repairText: factsRepairText(verified),
        };
      }
      let paragraphIndex = verdict
        ? exactPlanParagraphIndex(verdict.paragraph, count)
        : undefined;
      // 2026-10-04 (first), Round 5 (rule 6): a targets finding whose
      // paragraph field is not valid but whose own words name exactly one
      // paragraph of the Line ("P2 says ...") is located there.
      const targetsFinding = verdict?.outcome === "not_applied" && expected.ruleId === RESULTS_AGAINST_TARGETS_RULE_ID;
      if (verdict && targetsFinding && paragraphIndex === undefined) {
        paragraphIndex = paragraphNamedIn(verdict.unclipped?.reason ?? verdict.reason, count);
      }
      // 2026-09-28 (third): an item is covered where its paragraph says; a
      // Skip is honoured by absence, so an applied Skip needs no paragraph
      // (0 or none), while a Skip that is not honoured must name the
      // paragraph where the role appears. A verdict that claims text is
      // there without naming a valid paragraph is not applied and asks for
      // no repair: nothing located a prose defect. Since 2026-09-30 (first)
      // a LEAVE OUT check and Line 246's advancement check are honoured by
      // absence too, like a Skip.
      const skip = expected.itemId === undefined;
      const applied = verdict?.outcome === "applied" &&
        (skip || paragraphIndex !== undefined);
      const evidenceDowngraded = verdict !== undefined &&
        paragraphIndex === undefined &&
        (skip ? verdict.outcome === "not_applied" : verdict.outcome === "applied");
      const cited = paragraphIndex !== undefined && (skip ? !applied : applied);
      // Only a model not_applied verdict repairs, and it is never downgraded.
      const repairText = evidenceDowngraded
        ? undefined
        : unclippedRepairText(
            verdict,
            verdict?.repairGuidance?.trim() ||
              verdict?.reason.trim() ||
              "Plan verdict was not applied."
          );
      return {
        ...(expected.itemId ? { itemId: expected.itemId } : {}),
        ...(expected.skippedRoleId ? { skippedRoleId: expected.skippedRoleId } : {}),
        ...(expected.droppedSeedId ? { droppedSeedId: expected.droppedSeedId } : {}),
        ...(expected.ruleId ? { ruleId: expected.ruleId } : {}),
        mergedItemIds: [...expected.mergedItemIds],
        ...(cited ? { paragraphIndex } : {}),
        outcome: applied ? "applied" as const : "not_applied" as const,
        reason: !verdict
          ? planNotCheckedReason(expected)
          : evidenceDowngraded
            ? skip
              ? targetsFinding && verdict.reason.trim()
                // Round 5 (rule 6): never only "named no valid paragraph".
                ? `${planBreakUnlocatedReason(expected)} Its finding: ${verdict.reason.trim()}`
                : planBreakUnlocatedReason(expected)
              : ITEM_EVIDENCE_UNLOCATED_REASON
            : verdict.reason.trim() || "Plan verdict was not applied.",
        ...(!evidenceDowngraded && verdict?.repairGuidance?.trim()
          ? { repairGuidance: verdict.repairGuidance.trim() }
          : {}),
        // A plan check with no verdict is not checked: not a prose defect.
        ...(evidenceDowngraded || !verdict
          ? { actionableRepair: false }
          : verdict?.outcome === "not_applied"
            ? { actionableRepair: true }
            : {}),
        ...(repairText ? { repairText } : {}),
      };
    });
  return {
    verdicts,
    planVerdicts,
    storylineQuestion: question?.question.trim()
      ? {
          question: question.question.trim(),
          sectionClaim: question.sectionClaim.trim(),
          storylineAlternative: question.storylineAlternative.trim(),
          confidenceEntryIndex: entryIndex,
        }
      : null,
    ...(withheld ? { storylineQuestionWithheld: withheld } : {}),
  };
}

export type ConsistencyInput = {
  sections: Array<{ section: SectionNumber; text: string }>;
  claimExclusions: string[];
  glossaryTerms: string[];
  model: string;
  /**
   * 2026-09-29 (second): the Lines where the writer kept an idea despite a
   * Claim Exclusion, where a signed-off edit sets a Glossary Term aside, and
   * where the writer's Feedback governs one (loadWriterPrecedenceByLine).
   */
  writerPrecedence?: {
    keptExclusions: ReadonlyArray<{ text: string; sections: readonly SectionNumber[] }>;
    glossarySetAside: ReadonlyArray<{ term: string; sections: readonly SectionNumber[] }>;
    feedbackTerms?: ReadonlyArray<{
      term: string;
      lines: ReadonlyArray<{ sections: readonly SectionNumber[]; feedback: readonly WriterFeedback[] }>;
    }>;
  } | null;
  /**
   * 2026-09-30 (second): the draft follows a signed-off content plan, so the
   * pass is told what Rules A, B and C leave out on purpose, and that a range
   * and a value inside it, or two events at different times, do not
   * contradict. Absent in Single draft and Compare, whose requests are
   * unchanged.
   */
  signedOffPlan?: boolean;
};

/** "Line 244", or "Lines 242, 244 and 246". */
function linesPhrase(sections: readonly SectionNumber[]): string {
  const scaffold = CONSISTENCY_REQUEST.writerPrecedence;
  const sorted = [...sections].sort();
  if (sorted.length <= 1) return `${scaffold.oneLine}${sorted[0] ?? ""}`;
  return `${scaffold.manyLines}${sorted.slice(0, -1).join(scaffold.lineSeparator)}${scaffold.lastLineSeparator}${sorted[sorted.length - 1]}`;
}

export function buildConsistencyUserMessage(input: ConsistencyInput): string {
  const blocks = input.sections.map(({ section, text }) =>
    block(ORDERED_SECTION_TITLES[section].toUpperCase(), numberedSectionParagraphs(text))
  );
  const scaffold = CONSISTENCY_REQUEST.writerPrecedence;
  const kept = input.writerPrecedence?.keptExclusions ?? [];
  const aside = input.writerPrecedence?.glossarySetAside ?? [];
  const governed = input.writerPrecedence?.feedbackTerms ?? [];
  if (input.claimExclusions.length > 0) {
    blocks.push(
      block("CLAIM EXCLUSIONS", input.claimExclusions.map((text) => {
        const lines = kept.find((entry) => entry.text === text)?.sections ?? [];
        return `- ${text}${lines.length > 0 ? `${scaffold.keptPrefix}${linesPhrase(lines)}${scaffold.keptSuffix}` : ""}`;
      }).join("\n"))
    );
  }
  if (input.glossaryTerms.length > 0) {
    blocks.push(
      block("GLOSSARY TERMS", input.glossaryTerms.map((term) => {
        const key = term.trim().toLowerCase();
        const lines = aside.find((entry) => entry.term.toLowerCase() === key)?.sections ?? [];
        // Round 4 review P3-1: each Line quotes only the Feedback that
        // reached it.
        const groups = (governed.find((entry) => entry.term.toLowerCase() === key)?.lines ?? [])
          .filter((group) => group.sections.length > 0 && group.feedback.length > 0);
        return `- ${term}${lines.length > 0 ? `${scaffold.setAsidePrefix}${linesPhrase(lines)}${scaffold.setAsideSuffix}` : ""}${
          groups.length > 0
            ? `${scaffold.governedPrefix}${groups
                .map((group) =>
                  `${scaffold.governedLinePrefix}${linesPhrase(group.sections)}${scaffold.governedLineMiddle}${governingFeedbackPhrase(group.feedback)}${scaffold.governedLineSuffix}`)
                .join("")}${scaffold.governedSuffix}`
            : ""
        }`;
      }).join("\n"))
    );
  }
  return `${CONSISTENCY_REQUEST.userScaffold.prefix}${blocks.join(CONSISTENCY_REQUEST.userScaffold.blockSeparator)}${
    input.signedOffPlan ? CONSISTENCY_REQUEST.signedOffPlan : ""
  }`;
}

/** What one consistency pass found, and how many findings it could not read. */
export type ConsistencyPassResult = {
  findings: ConsistencyFinding[];
  /** Findings left out because a field could not be read (2026-09-29, second). */
  unreadable: number;
};

/** The one structured consistency call over the assembled draft. */
export async function runConsistencyPass(
  client: GenerationClient,
  input: ConsistencyInput
): Promise<ConsistencyPassResult> {
  const raw = await generateStructured<DecodedConsistency>(client, {
    system: CONSISTENCY_SYSTEM_PROMPT,
    user: buildConsistencyUserMessage(input),
    toolName: CONSISTENCY_REQUEST.toolName,
    description: CONSISTENCY_REQUEST.toolDescription,
    schema: CONSISTENCY_SCHEMA as unknown as Anthropic.Tool.InputSchema,
    maxTokens: CONSISTENCY_REQUEST.maxTokens,
    model: input.model,
    validate: consistencyOutputSchema,
  });
  if (raw.unreadable.length > 0) {
    console.warn(
      `${CONSISTENCY_REQUEST.toolName}: left out ${raw.unreadable.length} unreadable finding(s): ${raw.unreadable.slice(0, 5).join("; ")}`
    );
  }
  const counts = new Map(
    input.sections.map(({ section, text }) => [section, sectionParagraphs(text).length])
  );
  const findings = raw.findings
    .filter((finding) => isSectionNumber(finding.section) && counts.has(finding.section))
    .slice(0, CONSISTENCY_REQUEST.maxFindings)
    .map((finding) => ({
      section: finding.section,
      // Consistency findings have no whole-section concept: always a number.
      paragraphIndex: clampParagraph(finding.paragraph, counts.get(finding.section) ?? 0) ?? 0,
      sections: [...new Set([finding.section, ...finding.sections])].sort(),
      kind: finding.kind,
      issue: finding.issue.trim(),
    }));
  return { findings, unreadable: raw.unreadable.length };
}

/**
 * Why a consistency pass failed as a whole, safe to store: the failure kind
 * and the same diagnostic the Self-check stores (validation paths and codes,
 * or a fixed description), never model text (2026-09-29, second).
 */
export function consistencyFailureReason(code: string, error: unknown): string {
  return `${code}: ${selfCheckFailureDiagnostic(error)}`;
}
