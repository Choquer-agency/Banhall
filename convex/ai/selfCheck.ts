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
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
  SUMMARY_PLAN_SELF_CHECK_SCHEMA,
} from "./promptDefinitions";
import { sectionParagraphs } from "../lib/tiptapReport";
import { containsTerm } from "../lib/editedTerms";
import { stepTitle, type WriterFeedback } from "../lib/writerPrecedence";
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
  clipJsonEscapedUtf8,
  jsonEscapedUtf8Bytes,
  MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_LABEL_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_PARAGRAPH,
  MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES,
  projectSummaryOrdinaryChecks,
  SeedContextLimitError,
  serializeFrozenSummaryPlanChecks,
  summarySelfCheckWorstCaseResponse,
  type FrozenSummaryPlanCheck,
  type SummaryOrdinaryCheck,
} from "../lib/seedRevisions";

/**
 * Story 2 (CAP-9/10, AD-25): the model half of the Self-check and the
 * assembled-draft consistency pass. Plain helpers (no registered functions),
 * called by convex/ai/orderedGeneration.ts through the action's counting
 * client factory, labelled `generation:selfCheck:<n>` and
 * `generation:consistency`. Both use the `two-attempt-repair` structured
 * policy, except the Summary Self-check: one attempt, plus at most one
 * follow-up for labels its answer missed (2026-09-28), and, when a repair
 * changed the checked text, the same for a coverage-only check of the final
 * text (2026-09-28, third). Repair of the prose is never done here: it is the section agent
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
type RawPlanVerdict = {
  itemId?: string;
  skippedRoleId?: string;
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
  itemId: z.string().optional(),
  skippedRoleId: z.string().optional(),
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
    if (parsed.success) planVerdicts.push({ ...parsed.data, position: index + 1 });
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
  model: string;
  planChecks?: SelfCheckPlanCheck[];
  planChecksBlock?: string;
  /**
   * 2026-09-28 (third): plan verdicts only, on the final text. Set only by
   * runFinalCoverageSelfCheck, whose input carries no ordinary labels.
   */
  coverageOnly?: boolean;
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
};

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
  });
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
  if (feedback.length > 0) {
    blocks.push(block(
      writer.blockLabel,
      feedback
        .map((entry) => `${writer.linePrefix}${stepTitle(entry.roleId)}${writer.lineMiddle}${JSON.stringify(entry.instruction.trim())}`)
        .join(writer.separator)
    ));
  }
  return `${SELF_CHECK_REQUEST.userScaffold.prefix}${blocks.join(SELF_CHECK_REQUEST.userScaffold.blockSeparator)}${
    terms.length > 0 ? exact.instruction : ""
  }${feedback.length > 0 ? writer.instruction : ""}`;
}

export function buildSelfCheckUserMessage(input: SelfCheckModelInput): string {
  const message = buildSelfCheckDataMessage(input);
  if (!input.planChecks?.length) return message;
  const separator = SUMMARY_PLAN_SELF_CHECK_REQUEST.checklist.separator;
  const checklist = summaryChecklist(summaryOrdinaryChecks(input), input.planChecks);
  const parts = [
    message,
    ...(input.coverageOnly ? [SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction] : []),
    ...(checklist ? [checklist] : []),
  ];
  return parts.join(separator);
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
  planChecks: readonly { itemId?: string; skippedRoleId?: string }[],
  options: { coverageOnly?: boolean } = {}
) {
  const base = SUMMARY_PLAN_SELF_CHECK_SCHEMA;
  const labels = ordinary.map((check) => check.label);
  const itemIds = planChecks.flatMap((check) => (check.itemId ? [check.itemId] : []));
  const skipIds = planChecks.flatMap((check) =>
    check.skippedRoleId ? [check.skippedRoleId] : []);
  const plan = base.properties.planVerdicts;
  // The final coverage check (2026-09-28, third) never asks a Storyline
  // question, so its schema has no place for one.
  const { storylineQuestion: _question, ...withoutQuestion } = base.properties;
  return {
    ...base,
    properties: {
      ...(options.coverageOnly ? withoutQuestion : base.properties),
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
          },
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
    mergedItemIds: string[];
    paragraphIndex?: number;
    outcome: "applied" | "not_applied";
    reason: string;
    repairGuidance?: string;
    /** False when a local evidence downgrade is not a prose defect. */
    actionableRepair?: boolean;
    /** In memory only: see ModelVerdict.repairText. Never stored. */
    repairText?: string;
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

function planRefOf(check: { itemId?: string; skippedRoleId?: string }): string {
  return check.itemId ? `item:${check.itemId}` : `skip:${check.skippedRoleId ?? ""}`;
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
    const ref = verdict.itemId
      ? `item:${verdict.itemId}`
      : verdict.skippedRoleId
        ? `skip:${verdict.skippedRoleId}`
        : "";
    // Check the reference before looking up its plan check: with no usable
    // reference, the lookup would match an unrelated item's undefined
    // skippedRoleId and the diagnostic would name that item.
    const usable =
      (verdict.itemId !== undefined) !== (verdict.skippedRoleId !== undefined) && ref !== "";
    const expected = usable
      ? planChecks.find((check) =>
          verdict.itemId
            ? check.itemId === verdict.itemId
            : check.skippedRoleId === verdict.skippedRoleId
        )
      : undefined;
    const problem = ((): string | null => {
      if (!usable) return "needs exactly one non-empty itemId or skippedRoleId";
      if (!expected) {
        const field = verdict.itemId ? "itemId" : "skippedRoleId";
        return `${field} of ${jsonEscapedUtf8Bytes(verdict.itemId ?? verdict.skippedRoleId ?? "")} escaped bytes matches no plan check`;
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
          verdict.itemId ?? verdict.skippedRoleId ?? "",
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
          expected
            ? expected.itemId
              ? ` (item ${expected.itemId})`
              : ` (Skip ${expected.skippedRoleId})`
            : ""
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
      schema: summaryPlanSelfCheckSchemaFor(ordinary, plans, {
        coverageOnly: input.coverageOnly === true,
      }) as unknown as Anthropic.Tool.InputSchema,
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
      (verdict.itemId === undefined) === (verdict.skippedRoleId === undefined) ||
      !answeredPlans.has(planRefOf(verdict)));
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
      return {
        paragraphIndex: hasSummaryPlan
          ? verdict.paragraph === 0
            ? undefined
            : verdict.paragraph - 1
          : clampParagraph(verdict.paragraph, count, true),
        check: verdict.check,
        instruction: hasSummaryPlan
          ? ordinaryChecks.find((check) => check.label === verdict.instruction)?.instruction ??
            `${verdict.check} check`
          : verdict.instruction.trim() || `${verdict.check} check`,
        outcome: verdict.outcome,
        reason: verdict.reason.trim(),
        ...(verdict.repairGuidance?.trim()
          ? { repairGuidance: verdict.repairGuidance.trim() }
          : {}),
        ...(repairText ? { repairText } : {}),
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
  return {
    verdicts,
    planVerdicts: (input.planChecks ?? []).map((expected) => {
      const verdict = raw.planVerdicts?.find((candidate) =>
        expected.itemId
          ? candidate.itemId === expected.itemId
          : candidate.skippedRoleId === expected.skippedRoleId
      );
      const paragraphIndex = verdict
        ? exactPlanParagraphIndex(verdict.paragraph, count)
        : undefined;
      // 2026-09-28 (third): an item is covered where its paragraph says; a
      // Skip is honoured by absence, so an applied Skip needs no paragraph
      // (0 or none), while a Skip that is not honoured must name the
      // paragraph where the role appears. A verdict that claims text is
      // there without naming a valid paragraph is not applied and asks for
      // no repair: nothing located a prose defect.
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
        mergedItemIds: [...expected.mergedItemIds],
        ...(cited ? { paragraphIndex } : {}),
        outcome: applied ? "applied" as const : "not_applied" as const,
        reason: !verdict
          ? expected.itemId
            ? PLAN_ITEM_NOT_CHECKED_REASON
            : PLAN_SKIP_NOT_CHECKED_REASON
          : evidenceDowngraded
            ? skip ? SKIP_BREAK_UNLOCATED_REASON : ITEM_EVIDENCE_UNLOCATED_REASON
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
    }),
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

/**
 * 2026-09-28 (third): the coverage-only Self-check of a Section's final text,
 * run when an accepted repair (and its compression) changed the text the
 * first Self-check saw. Plan verdicts only: no ordinary labels, no Storyline
 * question. The same Summary rules, frozen checking model and single
 * attempt, with the same one follow-up for plan checks the answer missed;
 * whatever is still missing comes back as not checked. Throws when the check
 * fails as a whole, as runModelSelfCheck does.
 */
export async function runFinalCoverageSelfCheck(
  client: GenerationClient,
  input: {
    section: SectionNumber;
    text: string;
    model: string;
    planChecks: SelfCheckPlanCheck[];
    planChecksBlock?: string;
    editedTerms?: readonly string[];
    writerFeedback?: readonly WriterFeedback[];
  }
): Promise<ModelSelfCheckResult["planVerdicts"]> {
  if (input.planChecks.length === 0) return [];
  const result = await runModelSelfCheck(client, {
    section: input.section,
    text: input.text,
    storylineText: "",
    confidenceMap: [],
    glossaryCandidates: [],
    rules: [],
    model: input.model,
    planChecks: input.planChecks,
    planChecksBlock: input.planChecksBlock,
    coverageOnly: true,
    ...(input.editedTerms?.length ? { editedTerms: input.editedTerms } : {}),
    ...(input.writerFeedback?.length ? { writerFeedback: input.writerFeedback } : {}),
  });
  return result.planVerdicts;
}

export type ConsistencyInput = {
  sections: Array<{ section: SectionNumber; text: string }>;
  claimExclusions: string[];
  glossaryTerms: string[];
  model: string;
  /**
   * 2026-09-29 (second): the Lines where the writer kept an idea despite a
   * Claim Exclusion, and where the writer's wording sets a Glossary Term
   * aside (loadWriterPrecedenceByLine).
   */
  writerPrecedence?: {
    keptExclusions: ReadonlyArray<{ text: string; sections: readonly SectionNumber[] }>;
    glossarySetAside: ReadonlyArray<{ term: string; sections: readonly SectionNumber[] }>;
  } | null;
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
        const lines = aside.find((entry) => entry.term.toLowerCase() === term.trim().toLowerCase())?.sections ?? [];
        return `- ${term}${lines.length > 0 ? `${scaffold.setAsidePrefix}${linesPhrase(lines)}${scaffold.setAsideSuffix}` : ""}`;
      }).join("\n"))
    );
  }
  return `${CONSISTENCY_REQUEST.userScaffold.prefix}${blocks.join(CONSISTENCY_REQUEST.userScaffold.blockSeparator)}`;
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
