"use node";

import type Anthropic from "@anthropic-ai/sdk";
import type { GenerationClient } from "./openrouterCore";
import { QA_SYSTEM_PROMPT } from "./prompts";
import type { TranscriptAnalysis } from "./analyzerAgent";
import { runDeterministicChecks } from "./qaChecks";
import { generateStructured } from "./structured";

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
  section_scores: {
    "242": { score: number; issues: QAIssue[]; strengths: string[] };
    "244": { score: number; issues: QAIssue[]; strengths: string[] };
    "246": { score: number; issues: QAIssue[]; strengths: string[] };
  };
  cra_compliance: {
    verbiage_present: boolean;
    why_how_why_intact: boolean;
    uncertainties_distinguished: boolean;
  };
  hallucination_risks: string[];
  ai_language_flags: string[];
  superlative_flags: string[];
  gaps_requiring_client_followup: Array<{
    section: string;
    paragraph: number;
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
  calibration?: string
): Promise<QAScorecard> {
  // Run deterministic checks first
  const preComputedChecks = runDeterministicChecks(
    section242,
    section244,
    section246
  );

  // Learning loop: distilled writer feedback on past QA output (see
  // convex/ai/learning.ts). Tunes which observations to raise and their
  // severity; the rubric and scoring arithmetic above stay authoritative.
  const calibrationBlock = calibration?.trim()
    ? `\n\n## Reviewer Calibration (from writer feedback on past QA output)\nApply these adjustments when deciding what to flag and how to classify severity. They never override the structural requirements or scoring rules above.\n${calibration.trim()}`
    : "";

  return await generateStructured<QAScorecard>(client, {
    system: QA_SYSTEM_PROMPT + calibrationBlock,
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
