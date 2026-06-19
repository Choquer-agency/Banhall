"use node";

import Anthropic from "@anthropic-ai/sdk";
import { QA_SYSTEM_PROMPT } from "./prompts";
import { TranscriptAnalysis } from "./analyzerAgent";
import { runDeterministicChecks } from "./qaChecks";
import { generateStructured } from "./structured";

export interface QAScorecard {
  overall_score: number;
  section_scores: {
    "242": { score: number; issues: string[]; strengths: string[] };
    "244": { score: number; issues: string[]; strengths: string[] };
    "246": { score: number; issues: string[]; strengths: string[] };
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
  client: Anthropic,
  analysis: TranscriptAnalysis,
  section242: string,
  section244: string,
  section246: string
): Promise<QAScorecard> {
  // Run deterministic checks first
  const preComputedChecks = runDeterministicChecks(
    section242,
    section244,
    section246
  );

  return await generateStructured<QAScorecard>(client, {
    system: QA_SYSTEM_PROMPT,
    user: `Review the following SR&ED report draft.

${preComputedChecks}

## Original Transcript Analysis
${JSON.stringify(analysis, null, 2)}

## Section 242 — Scientific/Technological Uncertainty
${section242}

## Section 244 — Work Performed
${section244}

## Section 246 — Scientific/Technological Advancement
${section246}`,
    toolName: "submit_qa_scorecard",
    description: "Submit the QA scorecard for the SR&ED report draft.",
    schema: QA_SCHEMA,
    maxTokens: 4096,
  });
}

const sectionScore = {
  type: "object",
  properties: {
    score: { type: "number" },
    issues: { type: "array", items: { type: "string" } },
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
