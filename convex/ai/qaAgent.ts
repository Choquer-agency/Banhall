"use node";

import type Anthropic from "@anthropic-ai/sdk";
import type { GenerationClient } from "./openrouterCore";
import { buildQaSystemPrompt } from "./prompts";
import type { StyleOverrides } from "../../shared/styleOverrides";
import type { TranscriptAnalysis } from "./analyzerAgent";
import { runDeterministicChecks } from "./qaChecks";
import { generateStructured } from "./structured";
import { qaScorecardSchema } from "../../shared/qaScorecard";
import type { z } from "zod";

function numberParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[^\S\n]*\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph, index) => `[P${index + 1}] ${paragraph}`)
    .join("\n\n");
}

export interface QAIssue {
  text: string;
  severity: "deduction" | "warning";
  deduction?: number;
  paragraph?: number | null;
}

export interface QAScorecard {
  overall_score: number;
  /**
   * Keyed by T661 line ("242", "244", "246"). A record, not a fixed triple:
   * the model can omit a section, and every consumer iterates these entries
   * rather than indexing a known key. Declaring all three as guaranteed was a
   * promise the model never made.
   */
  section_scores: Record<
    string,
    { score: number; issues: QAIssue[]; strengths: string[] }
  >;
  cra_compliance: Record<string, boolean>;
  hallucination_risks: string[];
  ai_language_flags: string[];
  superlative_flags: string[];
  gaps_requiring_client_followup: Array<{
    section: string;
    /**
     * Null when the gap spans the whole section rather than one paragraph.
     * The model legitimately returns null here; typing it as a required
     * number is what made the frontend discard entire valid scorecards.
     */
    paragraph?: number | null;
    question: string;
  }>;
  suggested_improvements: string[];
}

export async function runQAAgent(
  client: GenerationClient,
  analysis: TranscriptAnalysis,
  section242: string,
  section244: string,
  section246: string,
  model?: string,
  calibration?: string,
  styleOverrides?: StyleOverrides,
  firstPersonRequested: boolean | null = null
): Promise<QAScorecard> {
  // Run deterministic checks first (waived house-style categories report
  // "WAIVED" rather than findings — see convex/ai/qaChecks.ts).
  const preComputedChecks = runDeterministicChecks(
    section242,
    section244,
    section246,
    styleOverrides
  );

  // Learning loop: distilled writer feedback on past QA output (see
  // convex/ai/learning.ts). Tunes which observations to raise and their
  // severity; the rubric and scoring arithmetic above stay authoritative.
  const calibrationBlock = calibration?.trim()
    ? `\n\n## Reviewer Calibration (from writer feedback on past QA output)\nApply these adjustments when deciding what to flag and how to classify severity. They never override the structural requirements or scoring rules above.\n${calibration.trim()}`
    : "";

  return await generateStructured<QAScorecard>(client, {
    system: buildQaSystemPrompt(styleOverrides, firstPersonRequested) + calibrationBlock,
    user: `Review the following SR&ED report draft.

${preComputedChecks}

## Original Transcript Analysis
${JSON.stringify(analysis, null, 2)}

## Section 242 — Scientific/Technological Uncertainty
${numberParagraphs(section242)}

## Section 244 — Work Performed
${numberParagraphs(section244)}

## Section 246 — Scientific/Technological Advancement
${numberParagraphs(section246)}`,
    toolName: "submit_qa_scorecard",
    description: "Submit the QA scorecard for the SR&ED report draft.",
    schema: QA_SCHEMA,
    maxTokens: 4096,
    model,
    // Enforce the same contract the panel reads. Without this a scorecard the
    // renderer can't parse is still stored and marked done, and the writer
    // sees an empty panel with no way to tell it apart from "never ran".
    validate: qaScorecardSchema satisfies z.ZodType<QAScorecard>,
  });
}

const qaIssue = {
  type: "object",
  properties: {
    text: { type: "string" },
    severity: { type: "string", enum: ["deduction", "warning"] },
    deduction: { type: "number" },
    paragraph: { type: ["number", "null"] },
  },
  required: ["text", "severity", "paragraph"],
} as const;

const sectionScore = {
  type: "object",
  properties: {
    score: { type: "number" },
    issues: { type: "array", items: qaIssue },
    strengths: { type: "array", items: { type: "string" } },
  },
} as const;

const QA_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    overall_score: { type: "number" },
    section_scores: {
      type: "object",
      properties: { "242": sectionScore, "244": sectionScore, "246": sectionScore },
    },
    cra_compliance: {
      type: "object",
      properties: {
        verbiage_present: { type: "boolean" },
        why_how_why_intact: { type: "boolean" },
        uncertainties_distinguished: { type: "boolean" },
      },
    },
    hallucination_risks: { type: "array", items: { type: "string" } },
    ai_language_flags: { type: "array", items: { type: "string" } },
    superlative_flags: { type: "array", items: { type: "string" } },
    gaps_requiring_client_followup: {
      type: "array",
      items: {
        type: "object",
        properties: {
          section: { type: "string" },
          paragraph: { type: "number" },
          question: { type: "string" },
        },
      },
    },
    suggested_improvements: { type: "array", items: { type: "string" } },
  },
  required: ["overall_score", "section_scores"],
};
