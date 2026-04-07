"use node";

import Anthropic from "@anthropic-ai/sdk";
import { QA_SYSTEM_PROMPT } from "./prompts";
import { TranscriptAnalysis } from "./analyzerAgent";

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
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: QA_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Review the following SR&ED report draft.

## Original Transcript Analysis
${JSON.stringify(analysis, null, 2)}

## Section 242 — Scientific/Technological Uncertainty
${section242}

## Section 244 — Work Performed
${section244}

## Section 246 — Scientific/Technological Advancement
${section246}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("QA agent did not return valid JSON");
  }

  return JSON.parse(jsonMatch[0]) as QAScorecard;
}
