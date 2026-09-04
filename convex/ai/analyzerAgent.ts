"use node";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { GenerationClient } from "./openrouterCore";
import { ANALYZER_SYSTEM_PROMPT } from "./prompts";
import { CONTEXT_SCAFFOLDS } from "./trustedContext";
import { generateStructured } from "./structured";

// Context assembly (classification, delimiting, budgeting) lives in
// convex/ai/trustedContext.ts — a non-node module queries can import too.
// Re-exported here so existing importers keep their import path.
export {
  ANALYZER_CATEGORY_LABELS,
  ANALYZER_CATEGORY_ORDER,
} from "./trustedContext";
export type { ContextDoc, ContextDocCategory, TrustLevel } from "./trustedContext";

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

/**
 * Runtime contract for the analyzer.
 *
 * The provider's JSON Schema lists `unreliable_narrator_flags`, `gaps`, and
 * `useful_quotes` as properties but NOT as required, while the TypeScript type
 * declares them present. A model that omits `useful_quotes` therefore produced
 * an `undefined` that survived the cast and only exploded much later, at
 * `provenanceDrafts`' `.map()` (pipeline.ts) — after all three sections had
 * been drafted and paid for. Defaulting the optional collections here keeps
 * that from failing an otherwise-good candidate.
 *
 * The load-bearing narrative fields stay required: a analysis missing those is
 * genuinely unusable, and failing fast beats drafting from nothing.
 */
const analysisSchema: z.ZodType<TranscriptAnalysis> = z.object({
  company_context: z.string(),
  project_goal: z.string(),
  business_problem: z.string(),
  scientific_technical_problem: z.string(),
  passive_uncertainties: z.array(z.string()).default([]),
  active_uncertainties: z.array(z.string()).default([]),
  technological_objective: z.string(),
  work_performed: z.object({
    prior_year_status: z.string().nullable().default(null),
    workplan_steps: z.array(z.string()).default([]),
    hypothesis: z.string().default(""),
    experiments_iterations: z
      .array(
        z.object({
          problem_addressed: z.string().default(""),
          approach: z.string().default(""),
          results: z.string().default(""),
          conclusions: z.string().default(""),
        })
      )
      .default([]),
  }),
  advancements_achieved: z.array(z.string()).default([]),
  remaining_uncertainties: z.array(z.string()).default([]),
  project_status: z.string(),
  unreliable_narrator_flags: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  useful_quotes: z.array(z.string()).default([]),
});

export const ANALYZER_REQUEST = {
  userScaffolds: CONTEXT_SCAFFOLDS,
  roleOrder: ["system", "user"],
  toolName: "submit_transcript_analysis",
  toolDescription:
    "Submit the structured analysis of the SR&ED interview transcript.",
  jsonIndentation: 2,
  maxTokens: 8192,
  modelSelector: "candidate-model-or-default",
} as const;

export async function runAnalyzerAgent(
  client: GenerationClient,
  // Prebuilt by buildTrustedContext (transcript + guidance + delimited
  // materials, already budgeted). The agent no longer assembles context; it
  // only sends it.
  userMessage: string,
  model?: string,
  // BNH-10: gold-standard reference passages retrieved from The Brain (already
  // formatted). Reference patterns only — the prompt forbids copying their facts.
  brainExemplars: string = ""
): Promise<TranscriptAnalysis> {
  return await generateStructured<TranscriptAnalysis>(client, {
    system: ANALYZER_SYSTEM_PROMPT,
    user: `${userMessage}${brainExemplars}`,
    toolName: ANALYZER_REQUEST.toolName,
    description: ANALYZER_REQUEST.toolDescription,
    schema: ANALYSIS_SCHEMA,
    maxTokens: ANALYZER_REQUEST.maxTokens,
    model,
    validate: analysisSchema,
  });
}

const strArray = { type: "array", items: { type: "string" } } as const;

export const ANALYSIS_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    company_context: { type: "string" },
    project_goal: { type: "string" },
    business_problem: { type: "string" },
    scientific_technical_problem: { type: "string" },
    passive_uncertainties: strArray,
    active_uncertainties: strArray,
    technological_objective: { type: "string" },
    work_performed: {
      type: "object",
      properties: {
        prior_year_status: {
          type: "string",
          description: "Prior-year status, or an empty string if this is a new project.",
        },
        workplan_steps: strArray,
        hypothesis: { type: "string" },
        experiments_iterations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              problem_addressed: { type: "string" },
              approach: { type: "string" },
              results: { type: "string" },
              conclusions: { type: "string" },
            },
          },
        },
      },
    },
    advancements_achieved: strArray,
    remaining_uncertainties: strArray,
    project_status: { type: "string" },
    unreliable_narrator_flags: strArray,
    gaps: strArray,
    useful_quotes: strArray,
  },
  required: [
    "company_context",
    "project_goal",
    "business_problem",
    "scientific_technical_problem",
    "passive_uncertainties",
    "active_uncertainties",
    "technological_objective",
    "work_performed",
    "advancements_achieved",
    "remaining_uncertainties",
    "project_status",
  ],
};
