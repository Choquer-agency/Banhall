"use node";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { GenerationClient } from "./openrouterCore";
import { generateStructured } from "./structured";
import { CONSISTENCY_SYSTEM_PROMPT, SELF_CHECK_SYSTEM_PROMPT } from "./prompts";
import {
  CONSISTENCY_REQUEST,
  CONSISTENCY_SCHEMA,
  ORDERED_SECTION_TITLES,
  SELF_CHECK_REQUEST,
  SELF_CHECK_SCHEMA,
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
  storylineQuestion?: RawStorylineQuestion | null;
};

const selfCheckOutputSchema: z.ZodType<RawSelfCheck> = z.object({
  verdicts: z
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
    .default([]),
  storylineQuestion: z
    .object({
      question: z.string(),
      sectionClaim: z.string(),
      confidenceEntry: z.number(),
      storylineAlternative: z.string(),
    })
    .nullable()
    .optional(),
});

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

export type SelfCheckModelInput = {
  section: SectionNumber;
  text: string;
  storylineText: string;
  confidenceMap: Array<{ text: string; confidence?: string }>;
  glossaryCandidates: string[];
  writerInstructions?: string;
  rules: Array<{ instruction: string; paragraphIndex?: number }>;
  model: string;
};

export function buildSelfCheckUserMessage(input: SelfCheckModelInput): string {
  const blocks = [
    block(
      `SECTION DRAFT: ${ORDERED_SECTION_TITLES[input.section]}`,
      numberedSectionParagraphs(input.text)
    ),
  ];
  if (input.storylineText.trim()) {
    blocks.push(block("STORYLINE", input.storylineText.trim()));
  }
  if (input.confidenceMap.length > 0) {
    blocks.push(
      block(
        "CONFIDENCE MAP",
        input.confidenceMap
          .map((entry, index) => `[C${index + 1}] (${entry.confidence ?? "unresolved"}) ${entry.text}`)
          .join("\n")
      )
    );
  }
  if (input.glossaryCandidates.length > 0) {
    blocks.push(
      block(
        "GLOSSARY CANDIDATES (Glossary Terms not found verbatim in the section)",
        input.glossaryCandidates.map((term) => `- ${term}`).join("\n")
      )
    );
  }
  const instructionLines: string[] = [];
  if (input.writerInstructions?.trim()) {
    instructionLines.push(input.writerInstructions.trim());
  }
  input.rules.forEach((rule, index) => {
    const scope =
      rule.paragraphIndex !== undefined ? ` (paragraph ${rule.paragraphIndex + 1})` : "";
    instructionLines.push(`[R${index + 1}]${scope} ${rule.instruction}`);
  });
  if (instructionLines.length > 0) {
    blocks.push(block("WRITER INSTRUCTIONS", instructionLines.join("\n\n")));
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
};

/** One structured Self-check call for one drafted section. */
export async function runModelSelfCheck(
  client: GenerationClient,
  input: SelfCheckModelInput
): Promise<ModelSelfCheckResult> {
  const raw = await generateStructured<RawSelfCheck>(client, {
    system: SELF_CHECK_SYSTEM_PROMPT,
    user: buildSelfCheckUserMessage(input),
    toolName: SELF_CHECK_REQUEST.toolName,
    description: SELF_CHECK_REQUEST.toolDescription,
    schema: SELF_CHECK_SCHEMA as unknown as Anthropic.Tool.InputSchema,
    maxTokens: SELF_CHECK_REQUEST.maxTokens,
    model: input.model,
    validate: selfCheckOutputSchema,
  });
  const count = sectionParagraphs(input.text).length;
  const verdicts: ModelVerdict[] = raw.verdicts
    .slice(0, SELF_CHECK_REQUEST.maxVerdicts)
    .map((verdict) => ({
      paragraphIndex: clampParagraph(verdict.paragraph, count, true),
      check: verdict.check,
      instruction: verdict.instruction.trim() || `${verdict.check} check`,
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
