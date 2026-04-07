"use node";

import Anthropic from "@anthropic-ai/sdk";
import { ANALYZER_SYSTEM_PROMPT } from "./prompts";

export interface TranscriptAnalysis {
  company_context: string;
  project_goal: string;
  business_problem: string;
  scientific_technical_problem: string;
  passive_uncertainties: string[];
  active_uncertainties: string[];
  technological_objective: string;
  work_performed: {
    prior_year_status: string | null;
    workplan_steps: string[];
    hypothesis: string;
    experiments_iterations: Array<{
      problem_addressed: string;
      approach: string;
      results: string;
      conclusions: string;
    }>;
  };
  advancements_achieved: string[];
  remaining_uncertainties: string[];
  project_status: string;
  unreliable_narrator_flags: string[];
  gaps: string[];
  useful_quotes: string[];
}

export async function runAnalyzerAgent(
  client: Anthropic,
  transcript: string
): Promise<TranscriptAnalysis> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: ANALYZER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here is the interview transcript to analyze:\n\n${transcript}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from the response (handle possible markdown code fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Analyzer agent did not return valid JSON");
  }

  return JSON.parse(jsonMatch[0]) as TranscriptAnalysis;
}
