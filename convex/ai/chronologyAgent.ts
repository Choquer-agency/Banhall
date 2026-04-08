"use node";

import Anthropic from "@anthropic-ai/sdk";
import { TranscriptAnalysis } from "./analyzerAgent";

export interface ChronologyEntry {
  phase: string;
  description: string;
  uncertaintyAddressed: string;
  activityType: "experimental" | "supporting";
  estimatedHours?: string;
}

export interface ChronologyTable {
  entries: ChronologyEntry[];
}

const CHRONOLOGY_SYSTEM_PROMPT = `You are an expert SR&ED consultant generating a chronology table for a CRA audit file.

A chronology table is a medium-level technical overview that breaks the SR&ED project into distinct phases/activities, each tied to specific technological uncertainties. It sits between the high-level Project Description (242/244/246) and the low-level individual timesheets.

## Your Task

Given the structured transcript analysis, generate a chronology table with 4-12 entries that:
- Break the project into distinct phases, iterations, or approaches
- Tie each phase to a specific technological uncertainty
- Classify each as "experimental" (direct SR&ED) or "supporting" (necessary but not experimental)
- Provide a brief description of the work performed in that phase

## Rules
- Only include activities described in the transcript analysis. Do not fabricate.
- Each entry should map to work described in the experiments_iterations or workplan_steps.
- The phase names should be concise (3-6 words).
- Descriptions should be 1-2 sentences.
- If the transcript doesn't provide enough detail for a phase, use [GAP: description] placeholders.

## Output Format

Respond with ONLY valid JSON:
{
  "entries": [
    {
      "phase": "string (concise phase name)",
      "description": "string (1-2 sentence description of work)",
      "uncertaintyAddressed": "string (which technological uncertainty this relates to)",
      "activityType": "experimental" | "supporting",
      "estimatedHours": "string or null (e.g. '[GAP: hours not provided]')"
    }
  ]
}`;

export async function runChronologyAgent(
  client: Anthropic,
  analysis: TranscriptAnalysis
): Promise<ChronologyTable> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: CHRONOLOGY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Generate a chronology table from this transcript analysis:\n\n${JSON.stringify(analysis, null, 2)}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Chronology agent did not return valid JSON");
  }

  return JSON.parse(jsonMatch[0]) as ChronologyTable;
}
