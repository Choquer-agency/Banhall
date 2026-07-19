"use node";

import Anthropic from "@anthropic-ai/sdk";
import { ANALYZER_SYSTEM_PROMPT, CONTEXT_INPUTS_GUIDANCE } from "./prompts";
import { generateStructured } from "./structured";

export interface ContextDoc {
  category:
    | "previous_pd"
    | "scoping_notes"
    | "writer_notes"
    | "background"
    | "other";
  fileName: string;
  content: string;
}

const CATEGORY_LABELS: Record<ContextDoc["category"], string> = {
  writer_notes: "WRITER'S NOTES (unreliable narrator)",
  previous_pd: "PREVIOUS-YEAR REPORT",
  scoping_notes: "SCOPING NOTES",
  background: "BACKGROUND RESEARCH / LINKS",
  other: "OTHER SUPPORTING MATERIAL",
};

// Present highest-trust material first.
const CATEGORY_ORDER: ContextDoc["category"][] = [
  "writer_notes",
  "previous_pd",
  "scoping_notes",
  "background",
  "other",
];

function buildContextBlock(docs: ContextDoc[]): string {
  if (!docs.length) return "";
  const sorted = [...docs].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  );
  const sections = sorted
    .map(
      (d) =>
        `--- [${CATEGORY_LABELS[d.category]}] ${d.fileName} ---\n${d.content}`
    )
    .join("\n\n");
  return `\n\n${CONTEXT_INPUTS_GUIDANCE}\n\n# ATTACHED CONTEXTUAL MATERIALS\n${sections}`;
}

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
  transcript: string,
  contextDocs: ContextDoc[] = [],
  model?: string,
  // BNH-10: gold-standard reference passages retrieved from The Brain (already
  // formatted). Reference patterns only — the prompt forbids copying their facts.
  brainExemplars: string = ""
): Promise<TranscriptAnalysis> {
  const contextBlock = buildContextBlock(contextDocs);
  // Transcript-less projects (spreadsheet-only, drawings, a lone email) analyze
  // the context documents directly instead of presenting an empty interview —
  // an empty "transcript" section would prime the model to hallucinate one.
  const user = transcript.trim()
    ? `Here is the interview transcript to analyze:\n\n${transcript}${contextBlock}${brainExemplars}`
    : `There is NO interview transcript for this project. Analyze the attached contextual materials below as the sole source. Anything the documents do not support must be flagged as a gap — never invent interview content.${contextBlock}${brainExemplars}`;
  return await generateStructured<TranscriptAnalysis>(client, {
    system: ANALYZER_SYSTEM_PROMPT,
    user,
    toolName: "submit_transcript_analysis",
    description:
      "Submit the structured analysis of the SR&ED interview transcript.",
    schema: ANALYSIS_SCHEMA,
    maxTokens: 8192,
    model,
  });
}

const strArray = { type: "array", items: { type: "string" } } as const;

const ANALYSIS_SCHEMA: Anthropic.Tool.InputSchema = {
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
