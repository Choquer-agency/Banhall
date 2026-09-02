"use node";

import type Anthropic from "@anthropic-ai/sdk";
import type { GenerationClient } from "./openrouterCore";
import type { TranscriptAnalysis } from "./analyzerAgent";
import { generateStructured } from "./structured";

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

export const CHRONOLOGY_SYSTEM_PROMPT = `You are an expert SR&ED consultant generating a chronology table for a CRA audit file.

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

export const CHRONOLOGY_REQUEST = {
  userPrefix:
    "Generate a chronology table from this transcript analysis:\n\n",
  runtimeSentinel: "{{runtime.transcriptAnalysis}}",
  roleOrder: ["system", "user"],
  toolName: "submit_chronology_table",
  toolDescription: "Submit the SR&ED chronology table.",
  jsonIndentation: 2,
  maxTokens: 4096,
  modelSelector: "candidate-model-or-default",
} as const;

/**
 * Tool output is trusted as-is by generateStructured, so a model can return an
 * off-spec shape despite the schema — observed in production: `entries` came
 * back as a JSON *string* wrapping another `{ entries: [...] }`, which crashed
 * the report page's chronology panel. Normalize here so the stored shape always
 * matches ChronologyTable.
 */
export function normalizeChronology(value: unknown, depth = 0): ChronologyTable {
  if (typeof value === "string" && depth < 3) {
    try {
      return normalizeChronology(JSON.parse(value), depth + 1);
    } catch {
      return { entries: [] };
    }
  }
  if (Array.isArray(value)) {
    return {
      entries: value.filter(
        (entry): entry is ChronologyEntry => !!entry && typeof entry === "object"
      ),
    };
  }
  if (value && typeof value === "object" && "entries" in value) {
    return normalizeChronology((value as { entries: unknown }).entries, depth + 1);
  }
  return { entries: [] };
}

export async function runChronologyAgent(
  client: GenerationClient,
  analysis: TranscriptAnalysis,
  model?: string
): Promise<ChronologyTable> {
  const raw = await generateStructured<unknown>(client, {
    system: CHRONOLOGY_SYSTEM_PROMPT,
    user: `${CHRONOLOGY_REQUEST.userPrefix}${JSON.stringify(analysis, null, CHRONOLOGY_REQUEST.jsonIndentation)}`,
    toolName: CHRONOLOGY_REQUEST.toolName,
    description: CHRONOLOGY_REQUEST.toolDescription,
    schema: CHRONOLOGY_SCHEMA,
    maxTokens: CHRONOLOGY_REQUEST.maxTokens,
    model,
  });
  return normalizeChronology(raw);
}

export const CHRONOLOGY_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          phase: { type: "string" },
          description: { type: "string" },
          uncertaintyAddressed: { type: "string" },
          activityType: { type: "string", enum: ["experimental", "supporting"] },
          estimatedHours: { type: "string" },
        },
        required: ["phase", "description", "uncertaintyAddressed", "activityType"],
      },
    },
  },
  required: ["entries"],
};
