"use node";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MalformedOutputError, type GenerationClient } from "./openrouterCore";
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
  MAX_SUMMARY_ORDINARY_VERDICTS,
  MAX_SUMMARY_PLAN_VERDICTS,
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
 * policy. Repair of the prose is never done here: it is the section agent
 * itself, re-run with the repair guidance (orderedGeneration.ts).
 */

const MODEL_CHECKS = ["storyline", "confidence", "glossary", "instruction"] as const;

type RawVerdict = {
  paragraph: number;
  check: ModelCheckKind;
  instruction: string;
  outcome: "applied" | "not_applied";
  reason: string;
  repairGuidance?: string;
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
};
type RawPlanVerdict = {
  itemId?: string;
  skippedRoleId?: string;
  mergedItemIds: string[];
  paragraph?: number;
  outcome: "applied" | "not_applied";
  reason: string;
  repairGuidance?: string;
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
const decodedSummaryPlanSelfCheckOutputSchema = z.object({
  verdicts: z.array(summaryVerdictOutputSchema),
  planVerdicts: z.array(summaryPlanVerdictOutputSchema),
  storylineQuestion: summaryStorylineQuestionOutputSchema,
}).strict();

/**
 * Real reasons run 90 to 280 bytes while the reservations allow 64 (reason)
 * and 96 (guidance, Storyline question fields). Over-long free text is
 * clipped to its reservation here, after placeholder restoration and after
 * the raw response was measured against the whole-response limit, so the
 * stored evidence keeps the per-field limits the sign-off capacity proof
 * reserved. Labels, ids, counts and paragraphs are never clipped: the
 * completeness assertion still rejects them.
 */
export function clipSummarySelfCheckFreeText(raw: RawSelfCheck): RawSelfCheck {
  const clip = (value: string, maximum: number) => clipJsonEscapedUtf8(value, maximum);
  const guidance = (value: string | undefined) =>
    value === undefined
      ? {}
      : { repairGuidance: clip(value, MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES) };
  const question = raw.storylineQuestion;
  return {
    ...raw,
    verdicts: raw.verdicts.map((verdict) => ({
      ...verdict,
      reason: clip(verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES),
      ...guidance(verdict.repairGuidance),
    })),
    ...(raw.planVerdicts
      ? {
          planVerdicts: raw.planVerdicts.map((verdict) => ({
            ...verdict,
            reason: clip(verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES),
            ...guidance(verdict.repairGuidance),
          })),
        }
      : {}),
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
const SECTION_ENUM = ["242", "244", "246"] as const;
const consistencyOutputSchema: z.ZodType<{ findings: RawFinding[] }> = z.object({
  findings: z
    .array(
      z.object({
        section: z.enum(SECTION_ENUM),
        paragraph: z.number().default(1),
        sections: z.array(z.enum(SECTION_ENUM)).default([]),
        kind: z.enum(["contradiction", "excluded_claim", "terminology"]),
        issue: z.string(),
      })
    )
    .default([]),
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
};

function summaryOrdinaryChecks(input: SelfCheckModelInput): SummaryOrdinaryCheck[] {
  return projectSummaryOrdinaryChecks({
    storylineText: input.storylineText,
    confidenceMap: input.confidenceMap,
    glossaryTerms: input.glossaryCandidates,
    writerFlavor: input.writerInstructions,
    rules: input.rules,
  });
}

export function buildSelfCheckUserMessage(input: SelfCheckModelInput): string {
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
  return `${SELF_CHECK_REQUEST.userScaffold.prefix}${blocks.join(SELF_CHECK_REQUEST.userScaffold.blockSeparator)}`;
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
  }>;
};

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

function assertCompleteSummaryOutput(args: {
  raw: RawSelfCheck;
  ordinaryChecks: readonly SummaryOrdinaryCheck[];
  planChecks: readonly SelfCheckPlanCheck[];
  allowStorylineQuestion: boolean;
  actualParagraphCount: number;
}): void {
  const { raw, ordinaryChecks, planChecks } = args;
  summarySelfCheckWorstCaseResponse({
    ordinaryChecks,
    planChecks,
    includeStorylineQuestion: args.allowStorylineQuestion,
  });
  const rawPlans = raw.planVerdicts ?? [];
  if (
    raw.verdicts.length > MAX_SUMMARY_ORDINARY_VERDICTS ||
    rawPlans.length > MAX_SUMMARY_PLAN_VERDICTS
  ) {
    throw new SummarySelfCheckRejection(
      "Summary Self-check returned too many verdicts",
      `${raw.verdicts.length} ordinary (limit ${MAX_SUMMARY_ORDINARY_VERDICTS}), ` +
        `${rawPlans.length} plan (limit ${MAX_SUMMARY_PLAN_VERDICTS})`
    );
  }
  const ordinaryByLabel = new Map(ordinaryChecks.map((check) => [check.label, check]));
  if (raw.verdicts.length !== ordinaryByLabel.size) {
    throw new SummarySelfCheckRejection(
      "Summary Self-check omitted an ordinary verdict",
      `${raw.verdicts.length} ordinary verdicts for ${ordinaryByLabel.size} labels`
    );
  }
  const seenLabels = new Set<string>();
  raw.verdicts.forEach((verdict, index) => {
    const expected = ordinaryByLabel.get(verdict.instruction);
    const invalid = (detail: string) =>
      new SummarySelfCheckRejection(
        "Summary Self-check returned an invalid ordinary verdict",
        `ordinary verdict ${index + 1}${expected ? ` (${expected.label})` : ""}: ${detail}`
      );
    if (!expected) {
      throw invalid(
        `label of ${jsonEscapedUtf8Bytes(verdict.instruction)} escaped bytes matches no supplied label`
      );
    }
    if (expected.check !== verdict.check) {
      throw invalid(`check ${verdict.check}, expected ${expected.check}`);
    }
    if (seenLabels.has(verdict.instruction)) throw invalid("label repeats");
    if (
      !Number.isInteger(verdict.paragraph) ||
      verdict.paragraph < 0 ||
      verdict.paragraph > args.actualParagraphCount ||
      !withinSummaryNumberReservation(verdict.paragraph)
    ) {
      throw invalid(
        `paragraph ${String(verdict.paragraph)} is not a whole number from 0 to ${args.actualParagraphCount}`
      );
    }
    const fieldProblem =
      overLimit("label", verdict.instruction, MAX_SUMMARY_SELF_CHECK_LABEL_ESCAPED_UTF8_BYTES) ??
      overLimit("reason", verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES) ??
      (verdict.repairGuidance === undefined
        ? null
        : overLimit(
            "repairGuidance",
            verdict.repairGuidance,
            MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES
          ));
    if (fieldProblem) throw invalid(fieldProblem);
    seenLabels.add(verdict.instruction);
  });
  if (rawPlans.length !== planChecks.length) {
    throw new SummarySelfCheckRejection(
      "Summary Self-check omitted a plan verdict",
      `${rawPlans.length} plan verdicts for ${planChecks.length} plan checks`
    );
  }
  const seenPlanRefs = new Set<string>();
  rawPlans.forEach((verdict, index) => {
    const ref = verdict.itemId
      ? `item:${verdict.itemId}`
      : verdict.skippedRoleId
        ? `skip:${verdict.skippedRoleId}`
        : "";
    // Check the reference before looking up its plan check: with no usable
    // reference, the lookup would match an unrelated item's undefined
    // skippedRoleId and the diagnostic would name that item.
    if ((verdict.itemId !== undefined) === (verdict.skippedRoleId !== undefined) || !ref) {
      throw new SummarySelfCheckRejection(
        "Summary Self-check returned an invalid plan verdict",
        `plan verdict ${index + 1}: needs exactly one non-empty itemId or skippedRoleId`
      );
    }
    const expected = planChecks.find((check) =>
      verdict.itemId
        ? check.itemId === verdict.itemId
        : check.skippedRoleId === verdict.skippedRoleId
    );
    const invalid = (detail: string) =>
      new SummarySelfCheckRejection(
        "Summary Self-check returned an invalid plan verdict",
        `plan verdict ${index + 1}${
          expected
            ? expected.itemId
              ? ` (item ${expected.itemId})`
              : ` (Skip ${expected.skippedRoleId})`
            : ""
        }: ${detail}`
      );
    if (!expected) {
      const field = verdict.itemId ? "itemId" : "skippedRoleId";
      throw invalid(
        `${field} of ${jsonEscapedUtf8Bytes(verdict.itemId ?? verdict.skippedRoleId ?? "")} escaped bytes matches no plan check`
      );
    }
    if (seenPlanRefs.has(ref)) throw invalid("plan reference repeats");
    if (
      verdict.paragraph !== undefined &&
      !withinSummaryNumberReservation(verdict.paragraph)
    ) {
      throw invalid("paragraph is past the numeric limit");
    }
    if (JSON.stringify(verdict.mergedItemIds) !== JSON.stringify(expected.mergedItemIds)) {
      throw invalid(
        `mergedItemIds has ${verdict.mergedItemIds.length} ids, expected ` +
          (expected.mergedItemIds.length
            ? `[${expected.mergedItemIds.join(", ")}] in that order`
            : "none")
      );
    }
    const fieldProblem =
      overLimit(
        "id",
        verdict.itemId ?? verdict.skippedRoleId ?? "",
        MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES
      ) ??
      verdict.mergedItemIds
        .map((id) => overLimit("merged id", id, MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES))
        .find((problem) => problem !== null) ??
      overLimit("reason", verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES) ??
      (verdict.repairGuidance === undefined
        ? null
        : overLimit(
            "repairGuidance",
            verdict.repairGuidance,
            MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES
          ));
    if (fieldProblem) throw invalid(fieldProblem);
    seenPlanRefs.add(ref);
  });
  if (raw.storylineQuestion) {
    const question = raw.storylineQuestion;
    const invalid = (detail: string) =>
      new SummarySelfCheckRejection(
        "Summary Self-check returned an invalid Storyline question",
        `Storyline question: ${detail}`
      );
    if (!args.allowStorylineQuestion) {
      throw invalid("returned without both a Storyline and a Confidence Map");
    }
    const fieldProblem =
      overLimit("question", question.question, MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES) ??
      overLimit(
        "sectionClaim",
        question.sectionClaim,
        MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
      ) ??
      overLimit(
        "storylineAlternative",
        question.storylineAlternative,
        MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
      );
    if (fieldProblem) throw invalid(fieldProblem);
    if (
      !Number.isInteger(question.confidenceEntry) ||
      question.confidenceEntry < 0 ||
      !withinSummaryNumberReservation(question.confidenceEntry)
    ) {
      throw invalid(
        `confidenceEntry ${String(question.confidenceEntry)} is not a whole number from 0 to ${MAX_SUMMARY_SELF_CHECK_PARAGRAPH}`
      );
    }
  }
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

/** One structured Self-check call for one drafted section. */
export async function runModelSelfCheck(
  client: GenerationClient,
  input: SelfCheckModelInput
): Promise<ModelSelfCheckResult> {
  const hasSummaryPlan = Boolean(input.planChecks?.length);
  const ordinaryChecks = hasSummaryPlan ? summaryOrdinaryChecks(input) : [];
  const count = sectionParagraphs(input.text).length;
  const raw = await generateStructured<RawSelfCheck>(client, {
    system: hasSummaryPlan
      ? SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT
      : SELF_CHECK_SYSTEM_PROMPT,
    user: buildSelfCheckUserMessage(input),
    toolName: SELF_CHECK_REQUEST.toolName,
    description: SELF_CHECK_REQUEST.toolDescription,
    schema: (hasSummaryPlan
      ? SUMMARY_PLAN_SELF_CHECK_SCHEMA
      : SELF_CHECK_SCHEMA) as unknown as Anthropic.Tool.InputSchema,
    maxTokens: hasSummaryPlan
      ? SUMMARY_PLAN_SELF_CHECK_REQUEST.maxTokens
      : SELF_CHECK_REQUEST.maxTokens,
    model: input.model,
    validate: hasSummaryPlan
      ? summaryPlanSelfCheckOutputSchema
      : selfCheckOutputSchema,
    ...(hasSummaryPlan ? { attempts: 1 } : {}),
    ...(hasSummaryPlan ? { encodedJsonRecovery: false } : {}),
  });
  if (hasSummaryPlan) {
    assertCompleteSummaryOutput({
      raw,
      ordinaryChecks,
      planChecks: input.planChecks ?? [],
      allowStorylineQuestion:
        input.storylineText.trim().length > 0 && input.confidenceMap.length > 0,
      actualParagraphCount: count,
    });
  }
  const verdicts: ModelVerdict[] = raw.verdicts
    .slice(0, SELF_CHECK_REQUEST.maxVerdicts)
    .map((verdict) => ({
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
    }));
  const question = raw.storylineQuestion;
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
      const applied = verdict?.outcome === "applied" && paragraphIndex !== undefined;
      const evidenceDowngraded = verdict?.outcome === "applied" && !applied;
      return {
        ...(expected.itemId ? { itemId: expected.itemId } : {}),
        ...(expected.skippedRoleId ? { skippedRoleId: expected.skippedRoleId } : {}),
        mergedItemIds: [...expected.mergedItemIds],
        ...(applied ? { paragraphIndex } : {}),
        outcome: applied ? "applied" as const : "not_applied" as const,
        reason: evidenceDowngraded
          ? "Applied plan verdict did not identify valid paragraph evidence."
          : verdict?.reason.trim() ||
            (verdict
              ? "Plan verdict was not applied."
              : "Self-check omitted the plan verdict."),
        ...(!evidenceDowngraded && verdict?.repairGuidance?.trim()
          ? { repairGuidance: verdict.repairGuidance.trim() }
          : {}),
        ...(evidenceDowngraded
          ? { actionableRepair: false }
          : verdict?.outcome === "not_applied"
            ? { actionableRepair: true }
            : {}),
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
  };
}

export type ConsistencyInput = {
  sections: Array<{ section: SectionNumber; text: string }>;
  claimExclusions: string[];
  glossaryTerms: string[];
  model: string;
};

export function buildConsistencyUserMessage(input: ConsistencyInput): string {
  const blocks = input.sections.map(({ section, text }) =>
    block(ORDERED_SECTION_TITLES[section].toUpperCase(), numberedSectionParagraphs(text))
  );
  if (input.claimExclusions.length > 0) {
    blocks.push(
      block("CLAIM EXCLUSIONS", input.claimExclusions.map((text) => `- ${text}`).join("\n"))
    );
  }
  if (input.glossaryTerms.length > 0) {
    blocks.push(
      block("GLOSSARY TERMS", input.glossaryTerms.map((term) => `- ${term}`).join("\n"))
    );
  }
  return `${CONSISTENCY_REQUEST.userScaffold.prefix}${blocks.join(CONSISTENCY_REQUEST.userScaffold.blockSeparator)}`;
}

/** The one structured consistency call over the assembled draft. */
export async function runConsistencyPass(
  client: GenerationClient,
  input: ConsistencyInput
): Promise<ConsistencyFinding[]> {
  const raw = await generateStructured<{ findings: RawFinding[] }>(client, {
    system: CONSISTENCY_SYSTEM_PROMPT,
    user: buildConsistencyUserMessage(input),
    toolName: CONSISTENCY_REQUEST.toolName,
    description: CONSISTENCY_REQUEST.toolDescription,
    schema: CONSISTENCY_SCHEMA as unknown as Anthropic.Tool.InputSchema,
    maxTokens: CONSISTENCY_REQUEST.maxTokens,
    model: input.model,
    validate: consistencyOutputSchema,
  });
  const counts = new Map(
    input.sections.map(({ section, text }) => [section, sectionParagraphs(text).length])
  );
  return raw.findings
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
}
