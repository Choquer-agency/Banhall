"use node";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { GenerationClient } from "./openrouterCore";
import { generateStructured } from "./structured";
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
const summaryPlanSelfCheckOutputSchema: z.ZodType<RawSelfCheck> = z.unknown()
  .superRefine((value, ctx) => {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = undefined;
    }
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength >
        MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Summary Self-check response exceeds its UTF-8 byte budget",
      });
    }
  })
  .transform(normalizeInvalidPlanParagraphs)
  .pipe(decodedSummaryPlanSelfCheckOutputSchema);

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
  if (
    raw.verdicts.length > MAX_SUMMARY_ORDINARY_VERDICTS ||
    (raw.planVerdicts?.length ?? 0) > MAX_SUMMARY_PLAN_VERDICTS
  ) {
    throw new Error("Summary Self-check returned too many verdicts");
  }
  const ordinaryByLabel = new Map(ordinaryChecks.map((check) => [check.label, check]));
  if (raw.verdicts.length !== ordinaryByLabel.size) {
    throw new Error("Summary Self-check omitted an ordinary verdict");
  }
  const seenLabels = new Set<string>();
  for (const verdict of raw.verdicts) {
    const expected = ordinaryByLabel.get(verdict.instruction);
    if (
      !expected ||
      expected.check !== verdict.check ||
      seenLabels.has(verdict.instruction) ||
      !Number.isInteger(verdict.paragraph) ||
      verdict.paragraph < 0 ||
      verdict.paragraph > args.actualParagraphCount ||
      !withinSummaryNumberReservation(verdict.paragraph) ||
      !boundedEscaped(
        verdict.instruction,
        MAX_SUMMARY_SELF_CHECK_LABEL_ESCAPED_UTF8_BYTES
      ) ||
      !boundedEscaped(verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES) ||
      (verdict.repairGuidance !== undefined &&
        !boundedEscaped(
          verdict.repairGuidance,
          MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES
        ))
    ) {
      throw new Error("Summary Self-check returned an invalid ordinary verdict");
    }
    seenLabels.add(verdict.instruction);
  }
  const rawPlans = raw.planVerdicts ?? [];
  if (rawPlans.length !== planChecks.length) {
    throw new Error("Summary Self-check omitted a plan verdict");
  }
  const seenPlanRefs = new Set<string>();
  for (const verdict of rawPlans) {
    const ref = verdict.itemId
      ? `item:${verdict.itemId}`
      : verdict.skippedRoleId
        ? `skip:${verdict.skippedRoleId}`
        : "";
    const expected = planChecks.find((check) =>
      verdict.itemId
        ? check.itemId === verdict.itemId
        : check.skippedRoleId === verdict.skippedRoleId
    );
    if (
      !ref ||
      !expected ||
      seenPlanRefs.has(ref) ||
      (verdict.paragraph !== undefined &&
        !withinSummaryNumberReservation(verdict.paragraph)) ||
      (verdict.itemId !== undefined) === (verdict.skippedRoleId !== undefined) ||
      JSON.stringify(verdict.mergedItemIds) !== JSON.stringify(expected.mergedItemIds) ||
      !boundedEscaped(
        verdict.itemId ?? verdict.skippedRoleId ?? "",
        MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES
      ) ||
      verdict.mergedItemIds.some((id) =>
        !boundedEscaped(id, MAX_SUMMARY_SELF_CHECK_ID_ESCAPED_UTF8_BYTES)) ||
      !boundedEscaped(verdict.reason, MAX_SUMMARY_SELF_CHECK_REASON_ESCAPED_UTF8_BYTES) ||
      (verdict.repairGuidance !== undefined &&
        !boundedEscaped(
          verdict.repairGuidance,
          MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES
        ))
    ) {
      throw new Error("Summary Self-check returned an invalid plan verdict");
    }
    seenPlanRefs.add(ref);
  }
  if (raw.storylineQuestion) {
    if (
      !args.allowStorylineQuestion ||
      !boundedEscaped(
        raw.storylineQuestion.question,
        MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
      ) ||
      !boundedEscaped(
        raw.storylineQuestion.sectionClaim,
        MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
      ) ||
      !boundedEscaped(
        raw.storylineQuestion.storylineAlternative,
        MAX_SUMMARY_SELF_CHECK_QUESTION_ESCAPED_UTF8_BYTES
      ) ||
      !Number.isInteger(raw.storylineQuestion.confidenceEntry) ||
      raw.storylineQuestion.confidenceEntry < 0 ||
      !withinSummaryNumberReservation(raw.storylineQuestion.confidenceEntry)
    ) {
      throw new Error("Summary Self-check returned an invalid Storyline question");
    }
  }
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
    maxTokens: SELF_CHECK_REQUEST.maxTokens,
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
