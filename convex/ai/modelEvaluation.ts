"use node";

/**
 * Evaluates one catalog candidate against a role's current model on the
 * fixed eval set (modelEvalSet.ts), through the same prompts, schemas and
 * gateway policies production uses. Each automatically switchable role runs
 * its own production task (review finding 9):
 * - writing: seed_batch (seed prompt, schema and contract), section_draft
 *   (the Line 242 agent) and qa_structured (the QA scorecard);
 * - condense: condense_digest (facts and verbatim quotes kept);
 * - retrieval_brief: retrieval_queries (four Brain queries, no names);
 * - analysis: style_classification (the settings-document classifier);
 * - structured_helper: changelog_summary (the daily release-notes JSON).
 *
 * Schema validity is the provider's ORIGINAL output checked against the
 * exact tool schema the request declared, on the first attempt, before any
 * contract validation defaults, repairs or drops anything (finding 8). A
 * judge call on the current writing model grades each judged output from 1
 * to 10; convex/modelCatalog.ts refuses to promote unless every judged task
 * has a valid grade on both sides (finding 2).
 *
 * Spend: the claim reserves the most EVAL_ENVELOPE can cost against the
 * monthly budget (finding 7) and hands back frozen per-model prices; the
 * usage meter prices every response at those prices when the provider
 * reported no charge (finding 3). Seed requests use the production seed
 * gateway policy, so a reasoning model gets exactly the output budget it
 * gets in production (finding 1).
 */
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { registerModelEntries, SECTION_ANSWER_TOKEN_BUDGETS } from "../../shared/generationModels";
import { isDashClean } from "../../shared/humanProse";
import { matchesJsonSchema, type JsonSchema } from "../../shared/jsonSchema";
import {
  chargeCeiling,
  isValidGrade,
  JUDGED_EVAL_TASKS,
  type EvalEnvelope,
  type EvalTaskKind,
  type EvalTaskResult,
} from "../../shared/modelCatalog";
import {
  estimateCostWithPricing,
  pricingFromPerMillion,
} from "../../shared/modelPricing";
import { STYLE_OVERRIDE_KEYS } from "../../shared/styleOverrides";
import {
  claimEvaluationRef,
  completeEvaluationRef,
  failEvaluationRef,
} from "../lib/modelCatalogRefs";
import { entryFromFrozen } from "../lib/modelRoles";
import type { FrozenModelEntry } from "../lib/modelCatalogValidators";
import { seedToolSchema, validateBatch, type FrozenSeedSource } from "../lib/seedContract";
import { instrumentedAnthropic, type UsageTap } from "./instrument";
import { instrumentedOpenRouter } from "./openrouter";
import type {
  GenerationClient,
  GenerationMessageParams,
  GenerationResponse,
} from "./openrouterCore";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import { SEED_ANTHROPIC_OPTIONS, SEED_OPENROUTER_OPTIONS } from "./providers";
import { QA_REQUEST, QA_SCHEMA, runQAAgent } from "./qaAgent";
import { runSection242Agent } from "./section242Agent";
import { buildSeedPrompt } from "./trustedContext";
import { generateStructured, STRUCTURED_OUTPUT_PROGRAM } from "./structured";
import {
  CONDENSE_REQUEST,
  CONDENSE_SCHEMA,
  condenseWindow,
  renderDigest,
  type TranscriptDigest,
} from "./condenseAgent";
import {
  RETRIEVAL_BRIEF_REQUEST,
  RETRIEVAL_BRIEF_SCHEMA,
  RETRIEVAL_BRIEF_SYSTEM_PROMPT,
  type RetrievalBrief,
} from "./brain/query";
import {
  ANALYSIS_TOOL_SCHEMA,
  STYLE_ANALYSIS_REQUEST,
  buildStyleAnalysisPrompt,
  styleAnalysisSchema,
  type StyleAnalysis,
} from "./styleAnalysis";
import {
  CHANGELOG_MAX_TOKENS,
  CHANGELOG_SYSTEM_PROMPT,
  changelogUserMessage,
  extractJson,
} from "./changelogPipeline";
import { PD_SUBSECTIONS } from "../../shared/pdSubsections";
import { pdReviewResultSchema } from "../../shared/pdReview";
import {
  PD_REVIEW_MAX_TOKENS,
  PD_REVIEW_SCHEMA,
  PD_REVIEW_TOOL,
  buildPdReviewUserMessage,
  type PdReviewResult,
} from "./reviewAgent";
import { PD_REVIEW_SYSTEM_PROMPT } from "./prompts";
import {
  TIMESHEET_EXTRACTION_PROMPT,
  TIMESHEET_MAX_TOKENS,
  parseTimesheetReply,
  timesheetUserMessage,
} from "./financialAgent";
import {
  CONTEXTUALIZE_MAX_TOKENS,
  CONTEXTUALIZE_SYSTEM_PROMPT,
  contextualizeMessages,
} from "./brain/ingest";
import { maxTokensWithReasoningHeadroom } from "../../shared/generationModels";
import {
  CHANGELOG_EVAL_COMMITS,
  CHANGELOG_EVAL_WORK_DAY,
  CHANGELOG_FORBIDDEN_TERMS,
  CHUNK_EVAL_CHUNK,
  CHUNK_EVAL_DOCUMENT,
  CHUNK_EVAL_SECTION_TERMS,
  CONDENSE_REQUIRED_FACTS,
  PD_REVIEW_EVAL_DOCUMENT,
  PD_REVIEW_PLANTED_TERMS,
  TIMESHEET_EVAL_EXPECTED,
  TIMESHEET_EVAL_FILE_TYPE,
  TIMESHEET_EVAL_LOG,
  EVAL_BRIEF,
  EVAL_SEED_ROLE,
  EVAL_SOURCE_ID,
  HELIOS_ANALYSIS,
  HELIOS_INTERVIEW,
  HELIOS_SECTIONS,
  RETRIEVAL_DOMAIN_TERMS,
  RETRIEVAL_FORBIDDEN_NAMES,
  RETRIEVAL_MIN_DOMAIN_TERMS,
  STYLE_EVAL_DOCUMENT,
  STYLE_EVAL_EXPECTED,
} from "./modelEvalSet";

export const EVAL_CALL_TIMEOUT_MS = 90_000;
export const JUDGE_MAX_TOKENS = 1024;

const both = (tokens: number) => ({ anthropic: tokens, openrouter: tokens });

/**
 * The most each kind of evaluation request can ask for: request count
 * (repairs included), a conservative input size, and the answer budget the
 * call site sends. modelEvaluation.test.ts checks every task's real request
 * against it at the HTTP boundary.
 */
export const EVAL_ENVELOPE: EvalEnvelope = {
  seed_batch: {
    requests: 1,
    maxInputTokens: 40_000,
    answerTokens: both(SEED_PROMPT_PROGRAM.request.maxTokens),
    preserveMaxTokens: SEED_OPENROUTER_OPTIONS.preserveMaxTokens,
  },
  section_draft: {
    requests: 1,
    maxInputTokens: 40_000,
    answerTokens: { ...SECTION_ANSWER_TOKEN_BUDGETS },
    preserveMaxTokens: false,
  },
  qa_structured: {
    requests: STRUCTURED_OUTPUT_PROGRAM.attempts,
    maxInputTokens: 40_000,
    answerTokens: both(QA_REQUEST.maxTokens),
    preserveMaxTokens: false,
  },
  condense_digest: {
    requests: 1,
    maxInputTokens: 20_000,
    answerTokens: both(CONDENSE_REQUEST.maxTokens),
    preserveMaxTokens: false,
  },
  retrieval_queries: {
    requests: 1,
    maxInputTokens: 20_000,
    answerTokens: both(RETRIEVAL_BRIEF_REQUEST.maxTokens),
    preserveMaxTokens: false,
  },
  style_classification: {
    requests: 1,
    maxInputTokens: 30_000,
    answerTokens: both(STYLE_ANALYSIS_REQUEST.maxTokens),
    preserveMaxTokens: false,
  },
  changelog_summary: {
    requests: 1,
    maxInputTokens: 10_000,
    answerTokens: both(CHANGELOG_MAX_TOKENS),
    preserveMaxTokens: false,
  },
  pd_review_report: {
    requests: 1,
    maxInputTokens: 30_000,
    answerTokens: both(PD_REVIEW_MAX_TOKENS),
    preserveMaxTokens: false,
  },
  timesheet_extraction: {
    requests: 1,
    maxInputTokens: 10_000,
    answerTokens: both(TIMESHEET_MAX_TOKENS),
    preserveMaxTokens: false,
  },
  chunk_context: {
    requests: 1,
    maxInputTokens: 10_000,
    answerTokens: both(CONTEXTUALIZE_MAX_TOKENS),
    preserveMaxTokens: false,
  },
  // Enforced before every judge call (judgeRequestBytes): a request over it
  // is never sent and the grade stays missing, so the evaluation is
  // incomplete rather than over its reservation (review B).
  judge: {
    requests: 1,
    maxInputTokens: 24_000,
    answerTokens: both(JUDGE_MAX_TOKENS),
    preserveMaxTokens: false,
  },
};

/**
 * A client plus its spend: `costUsd` for every response that reported a
 * charge, `unsettledUsd` (optional) for requests that failed without one.
 */
export type MeteredClient = {
  client: GenerationClient;
  meter: { costUsd: number; unsettledUsd?: number };
};

/** What the judge grades for one task: its source, the rules, the output. */
export type JudgeInput = { sourceLabel: string; source: string; criteria: string; output: string };

export type EvalOutput = { result: EvalTaskResult; judge?: JudgeInput };

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

/**
 * Counts requests and keeps the first response's tool input: schema
 * validity is judged on what the model returned first, not on a repair.
 */
function capturing(client: GenerationClient) {
  const state: { requests: number; firstTool: { input: unknown } | null } = {
    requests: 0,
    firstTool: null,
  };
  const wrapped: GenerationClient = {
    messages: {
      create: async (params) => {
        state.requests += 1;
        const response: GenerationResponse = await client.messages.create(params);
        if (state.requests === 1) {
          const block = response.content.find((item) => item.type === "tool_use");
          state.firstTool = block?.type === "tool_use" ? { input: block.input } : null;
        }
        return response;
      },
    },
  };
  return { state, client: wrapped };
}

const firstValid = (
  state: { requests: number; firstTool: { input: unknown } | null },
  schema: JsonSchema
) => state.firstTool !== null && matchesJsonSchema(state.firstTool.input, schema);

const WRITING_CRITERIA = [
  "1. Every statement is supported by the interview. Anything invented scores low.",
  "2. It frames technological uncertainty, the work done and its results the way a CRA reviewer expects.",
  "3. It is specific: iterations, figures and outcomes, not generic claims.",
  "4. The language is plain and professional, with no marketing tone.",
].join("\n");

// ─── Tasks ──────────────────────────────────────────────────────────────────

/** One seed batch on the first attempt: no repair, as an honest measure. */
export async function runSeedBatchTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  const objective =
    PD_SUBSECTIONS.find((role) => role.roleId === EVAL_SEED_ROLE)?.objective ?? EVAL_SEED_ROLE;
  const contentHash = "eval-helios";
  const request = buildSeedPrompt({
    mode: "batch",
    objective,
    brief: EVAL_BRIEF,
    sources: [
      { sourceId: EVAL_SOURCE_ID, label: "Interview", kind: "transcript", content: HELIOS_INTERVIEW, contentHash },
    ],
    projection: { decisions: "(none)", feedback: "(none)" },
    writerSettings: { styleOverrides: {} },
    lengthTarget: "standard",
  });
  const schema = seedToolSchema();
  try {
    const response = await metered.client.messages.create({
      model,
      max_tokens: SEED_PROMPT_PROGRAM.request.maxTokens,
      system: request.system,
      tools: [
        {
          name: SEED_PROMPT_PROGRAM.request.toolName,
          description: SEED_PROMPT_PROGRAM.request.description,
          input_schema: schema,
        },
      ],
      tool_choice: { type: "tool", name: SEED_PROMPT_PROGRAM.request.toolName },
      messages: [{ role: "user", content: request.userBlocks }],
    });
    const block = response.content.find((item) => item.type === "tool_use");
    const input = block?.type === "tool_use" ? block.input : undefined;
    // The whole original output against the declared tool schema: one
    // malformed seed fails it even if validateBatch could drop that seed.
    const schemaValid = input !== undefined && matchesJsonSchema(input, schema);
    const sources: FrozenSeedSource[] = [
      { sourceId: EVAL_SOURCE_ID, content: HELIOS_INTERVIEW, contentHash },
    ];
    const contract = schemaValid
      ? validateBatch({
          roleId: EVAL_SEED_ROLE,
          mode: "batch",
          seeds: (input as { seeds: unknown[] }).seeds,
          frozenSources: sources,
        })
      : null;
    return {
      result: {
        task: "seed_batch",
        structured: true,
        schemaValid,
        contractPassed: contract?.ok ?? false,
        costUsd: metered.meter.costUsd - before,
      },
      ...(contract && contract.seeds.length > 0
        ? {
            judge: {
              sourceLabel: "Interview",
              source: HELIOS_INTERVIEW,
              criteria: WRITING_CRITERIA,
              output: contract.seeds.map((seed) => `- ${seed.bullets.join(" ")}`).join("\n"),
            },
          }
        : {}),
    };
  } catch (error) {
    return {
      result: {
        task: "seed_batch",
        structured: true,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

/** One Line 242 draft through the section agent, from the fixed analysis. */
export async function runSectionDraftTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  try {
    const text = await runSection242Agent(metered.client, HELIOS_ANALYSIS, model);
    return {
      result: {
        task: "section_draft",
        structured: false,
        schemaValid: true,
        contractPassed: text.trim().length > 0 && isDashClean(text),
        costUsd: metered.meter.costUsd - before,
      },
      judge: {
        sourceLabel: "Interview",
        source: HELIOS_INTERVIEW,
        criteria: WRITING_CRITERIA,
        output: text,
      },
    };
  } catch (error) {
    return {
      result: {
        task: "section_draft",
        structured: false,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

/** The QA scorecard call on fixed sections, first attempt against QA_SCHEMA. */
export async function runQaStructuredTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  const { state, client } = capturing(metered.client);
  try {
    await runQAAgent(
      client,
      HELIOS_ANALYSIS,
      HELIOS_SECTIONS["242"],
      HELIOS_SECTIONS["244"],
      HELIOS_SECTIONS["246"],
      model
    );
    return {
      result: {
        task: "qa_structured",
        structured: true,
        schemaValid: state.requests === 1 && firstValid(state, QA_SCHEMA as JsonSchema),
        contractPassed: true,
        costUsd: metered.meter.costUsd - before,
      },
    };
  } catch (error) {
    return {
      result: {
        task: "qa_structured",
        structured: true,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** A quote with its speaker label and surrounding quote marks removed. */
export function quoteBody(quote: string): string {
  const unlabelled = quote.replace(/^\s*[^:"“”]{1,60}:\s*/, "");
  return collapse(unlabelled.replace(/^["“'‘]+|["”'’]+$/g, ""));
}

/**
 * The condense contract: every required fact survives, and every key quote
 * is a verbatim passage of the source (speaker label and quote marks aside).
 */
export function condenseContractIssues(digest: TranscriptDigest, source: string): string[] {
  const issues: string[] = [];
  const text = JSON.stringify(digest).toLowerCase();
  for (const fact of CONDENSE_REQUIRED_FACTS) {
    if (!text.includes(fact.toLowerCase())) issues.push(`missing fact: ${fact}`);
  }
  if (digest.keyQuotes.length === 0) issues.push("no key quotes");
  const normalizedSource = collapse(source);
  for (const quote of digest.keyQuotes) {
    const body = quoteBody(quote);
    if (!body || !normalizedSource.includes(body)) issues.push(`quote not verbatim: ${quote.slice(0, 60)}`);
  }
  return issues;
}

/** One condense window over the whole interview, as generations condense. */
export async function runCondenseDigestTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  const { state, client } = capturing(metered.client);
  try {
    const digest = await condenseWindow(client, {
      text: HELIOS_INTERVIEW,
      label: "Interview",
      part: 1,
      totalParts: 1,
      modelId: model,
    });
    return {
      result: {
        task: "condense_digest",
        structured: true,
        schemaValid: firstValid(state, CONDENSE_SCHEMA as JsonSchema),
        contractPassed: condenseContractIssues(digest, HELIOS_INTERVIEW).length === 0,
        costUsd: metered.meter.costUsd - before,
      },
      judge: {
        sourceLabel: "Interview",
        source: HELIOS_INTERVIEW,
        criteria: [
          "1. Every name, date, number and technical fact in the interview is kept exactly.",
          "2. Quotes are verbatim; nothing is paraphrased as a quote.",
          "3. Nothing is invented or inferred beyond what was said.",
          "4. Only greetings and small talk are dropped.",
        ].join("\n"),
        output: renderDigest(digest),
      },
    };
  } catch (error) {
    return {
      result: {
        task: "condense_digest",
        structured: true,
        schemaValid: firstValid(state, CONDENSE_SCHEMA as JsonSchema),
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The retrieval-brief contract: four usable queries (5 to 150 words each),
 * no person or company names, and the project's technical vocabulary.
 */
export function retrievalContractIssues(brief: RetrievalBrief): string[] {
  const issues: string[] = [];
  const fields = [brief.problem, brief.uncertainty, brief.work, brief.advancement];
  for (const [index, field] of fields.entries()) {
    const count = typeof field === "string" ? words(field) : 0;
    if (count < 5 || count > 150) issues.push(`query ${index + 1} has ${count} words`);
  }
  const all = fields.join(" ");
  for (const name of RETRIEVAL_FORBIDDEN_NAMES) {
    if (new RegExp(`\\b${name}\\b`, "i").test(all)) issues.push(`names ${name}`);
  }
  const lower = all.toLowerCase();
  const terms = RETRIEVAL_DOMAIN_TERMS.filter((term) => lower.includes(term)).length;
  if (terms < RETRIEVAL_MIN_DOMAIN_TERMS) issues.push(`only ${terms} technical terms`);
  return issues;
}

/** The Brain retrieval brief over the interview, first attempt. */
export async function runRetrievalQueriesTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  const { state, client } = capturing(metered.client);
  try {
    const brief = await generateStructured<RetrievalBrief>(client, {
      system: RETRIEVAL_BRIEF_SYSTEM_PROMPT,
      user: `${RETRIEVAL_BRIEF_REQUEST.userScaffold.titlePrefix}Project Helios F2025${RETRIEVAL_BRIEF_REQUEST.userScaffold.transcriptPrefix}${HELIOS_INTERVIEW}`,
      toolName: RETRIEVAL_BRIEF_REQUEST.toolName,
      description: RETRIEVAL_BRIEF_REQUEST.toolDescription,
      schema: RETRIEVAL_BRIEF_SCHEMA,
      maxTokens: RETRIEVAL_BRIEF_REQUEST.maxTokens,
      model,
      attempts: 1,
    });
    const schemaValid = firstValid(state, RETRIEVAL_BRIEF_SCHEMA as JsonSchema);
    return {
      result: {
        task: "retrieval_queries",
        structured: true,
        schemaValid,
        contractPassed: schemaValid && retrievalContractIssues(brief).length === 0,
        costUsd: metered.meter.costUsd - before,
      },
      judge: {
        sourceLabel: "Interview",
        source: HELIOS_INTERVIEW,
        criteria: [
          "These are search queries for finding similar past SR&ED reports.",
          "1. Each is technical and specific to this project's problem, uncertainty, work or advancement.",
          "2. None names a person or company.",
          "3. Each would retrieve relevant past report passages, not generic ones.",
        ].join("\n"),
        output: [
          `Problem: ${brief.problem}`,
          `Uncertainty: ${brief.uncertainty}`,
          `Work: ${brief.work}`,
          `Advancement: ${brief.advancement}`,
        ].join("\n"),
      },
    };
  } catch (error) {
    return {
      result: {
        task: "retrieval_queries",
        structured: true,
        schemaValid: firstValid(state, RETRIEVAL_BRIEF_SCHEMA as JsonSchema),
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

/**
 * The classifier contract: exactly the expected categories are addressed,
 * each with verbatim evidence from the document.
 */
export function styleContractIssues(analysis: StyleAnalysis, document: string): string[] {
  const issues: string[] = [];
  const expected = new Set<string>(STYLE_EVAL_EXPECTED);
  for (const key of STYLE_OVERRIDE_KEYS) {
    const category = analysis.categories[key];
    if (category.addressed !== expected.has(key)) {
      issues.push(`${key} ${category.addressed ? "wrongly addressed" : "missed"}`);
    }
    if (category.addressed && (!category.evidence || !document.includes(category.evidence))) {
      issues.push(`${key} evidence is not verbatim`);
    }
  }
  return issues;
}

/** The settings-document classifier on a document with a known answer. */
export async function runStyleClassificationTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  const { state, client } = capturing(metered.client);
  const { system, user } = buildStyleAnalysisPrompt(STYLE_EVAL_DOCUMENT);
  try {
    const analysis = await generateStructured<StyleAnalysis>(client, {
      system,
      user,
      toolName: STYLE_ANALYSIS_REQUEST.toolName,
      description: STYLE_ANALYSIS_REQUEST.description,
      schema: ANALYSIS_TOOL_SCHEMA,
      maxTokens: STYLE_ANALYSIS_REQUEST.maxTokens,
      model,
      validate: styleAnalysisSchema,
      attempts: 1,
    });
    return {
      result: {
        task: "style_classification",
        structured: true,
        schemaValid: firstValid(state, ANALYSIS_TOOL_SCHEMA as JsonSchema),
        contractPassed: styleContractIssues(analysis, STYLE_EVAL_DOCUMENT).length === 0,
        costUsd: metered.meter.costUsd - before,
      },
      judge: {
        sourceLabel: "Writer's instruction document",
        source: STYLE_EVAL_DOCUMENT,
        criteria: [
          "The output classifies which house-style areas the document legislates.",
          "1. A category is marked addressed only when the document states its own rule for it.",
          "2. Each piece of evidence is the shortest decisive phrase, quoted verbatim.",
          "3. Nothing is marked that the document does not cover.",
        ].join("\n"),
        output: STYLE_OVERRIDE_KEYS.map((key) => {
          const category = analysis.categories[key];
          return `${key}: ${category.addressed ? `addressed ("${category.evidence ?? ""}")` : "not addressed"}`;
        }).join("\n"),
      },
    };
  } catch (error) {
    return {
      result: {
        task: "style_classification",
        structured: true,
        schemaValid: firstValid(state, ANALYSIS_TOOL_SCHEMA as JsonSchema),
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

/** The shape the changelog pipeline reads from the model's JSON. */
export const CHANGELOG_JSON_SCHEMA: JsonSchema = {
  type: "object",
  required: ["title", "summary", "sections"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 70 },
    summary: { type: "string", minLength: 1 },
    sections: {
      type: "object",
      required: ["new", "improved", "fixed"],
      properties: {
        new: { type: "array", items: { type: "string" } },
        improved: { type: "array", items: { type: "string" } },
        fixed: { type: "array", items: { type: "string" } },
      },
    },
  },
};

/** The release-notes contract: no implementation terms, plain hyphens only. */
export function changelogContractIssues(notes: {
  title: string;
  summary: string;
  sections: { new: string[]; improved: string[]; fixed: string[] };
}): string[] {
  const issues: string[] = [];
  const all = [notes.title, notes.summary, ...notes.sections.new, ...notes.sections.improved, ...notes.sections.fixed];
  const text = all.join("\n");
  for (const term of CHANGELOG_FORBIDDEN_TERMS) {
    if (text.includes(term)) issues.push(`leaks ${term}`);
  }
  if (!all.every((item) => isDashClean(item))) issues.push("typographic dash");
  if (notes.sections.new.length + notes.sections.improved.length + notes.sections.fixed.length === 0) {
    issues.push("no bullets");
  }
  return issues;
}

/** One day of release notes, as the changelog pipeline writes them. */
export async function runChangelogSummaryTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  try {
    const response = await metered.client.messages.create({
      model,
      max_tokens: CHANGELOG_MAX_TOKENS,
      system: CHANGELOG_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: changelogUserMessage(CHANGELOG_EVAL_WORK_DAY, CHANGELOG_EVAL_COMMITS) },
      ],
    });
    const text = response.content.find((block) => block.type === "text");
    const parsed = text?.type === "text" ? extractJson(text.text) : null;
    const schemaValid = parsed !== null && matchesJsonSchema(parsed, CHANGELOG_JSON_SCHEMA);
    const notes = schemaValid
      ? (parsed as { title: string; summary: string; sections: { new: string[]; improved: string[]; fixed: string[] } })
      : null;
    return {
      result: {
        task: "changelog_summary",
        structured: true,
        schemaValid,
        contractPassed: notes !== null && changelogContractIssues(notes).length === 0,
        costUsd: metered.meter.costUsd - before,
      },
      ...(notes
        ? {
            judge: {
              sourceLabel: "Commits",
              source: changelogUserMessage(CHANGELOG_EVAL_WORK_DAY, CHANGELOG_EVAL_COMMITS),
              criteria: [
                "These are release notes for SR&ED writers who are not programmers.",
                "1. Every bullet describes an effect a writer can see, faithful to the commits.",
                "2. Nothing is invented; implementation-only commits are skipped or folded.",
                "3. Plain language, no file or function names.",
              ].join("\n"),
              output: JSON.stringify(notes, null, 2),
            },
          }
        : {}),
    };
  } catch (error) {
    return {
      result: {
        task: "changelog_summary",
        structured: true,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

/**
 * The PD review contract: a usable review (the production result schema)
 * that lists the planted ineligible claim among its risks.
 */
export function pdReviewContractIssues(review: PdReviewResult): string[] {
  const issues: string[] = [];
  if (review.risks.length === 0) issues.push("no risks");
  const flagged = review.risks.some((risk) =>
    PD_REVIEW_PLANTED_TERMS.some((term) => risk.toLowerCase().includes(term))
  );
  if (!flagged) issues.push("planted ineligible claim not flagged");
  return issues;
}

/** The PD review on a PD with a planted ineligible claim, first attempt. */
export async function runPdReviewTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  const { state, client } = capturing(metered.client);
  const user = buildPdReviewUserMessage(
    {
      title: "Project Helios F2025",
      clientName: "Verdant Grid Technologies Inc.",
      fileName: "helios-pd.docx",
      pdContent: PD_REVIEW_EVAL_DOCUMENT,
      transcript: HELIOS_INTERVIEW,
    },
    []
  );
  try {
    const review = await generateStructured<PdReviewResult>(client, {
      model,
      system: PD_REVIEW_SYSTEM_PROMPT,
      user,
      toolName: PD_REVIEW_TOOL,
      description: "Submit the structured feedback report for the written PD.",
      schema: PD_REVIEW_SCHEMA as never,
      maxTokens: PD_REVIEW_MAX_TOKENS,
      validate: pdReviewResultSchema,
      attempts: 1,
    });
    return {
      result: {
        task: "pd_review_report",
        structured: true,
        schemaValid: firstValid(state, PD_REVIEW_SCHEMA as JsonSchema),
        contractPassed: pdReviewContractIssues(review).length === 0,
        costUsd: metered.meter.costUsd - before,
      },
      judge: {
        sourceLabel: "PD under review",
        source: PD_REVIEW_EVAL_DOCUMENT,
        criteria: [
          "The output reviews an SR&ED project description for CRA eligibility.",
          "1. Risks name real eligibility problems in the PD, citing the passage.",
          "2. Strengths and suggested rewrites are specific, not generic advice.",
          "3. The score and rationale match the risks found.",
        ].join("\n"),
        output: JSON.stringify(review, null, 2),
      },
    };
  } catch (error) {
    return {
      result: {
        task: "pd_review_report",
        structured: true,
        schemaValid: firstValid(state, PD_REVIEW_SCHEMA as JsonSchema),
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

type TimesheetEntry = ReturnType<typeof parseTimesheetReply>["entries"][number];

/**
 * The timesheet contract: every expected entry is found with its stated
 * hours, marked explicit, and classified correctly; no one gets hours the
 * log never states.
 */
export function timesheetContractIssues(entries: readonly TimesheetEntry[]): string[] {
  const issues: string[] = [];
  for (const expected of TIMESHEET_EVAL_EXPECTED) {
    const match = entries.find(
      (entry) =>
        entry.personName.includes(expected.person) &&
        entry.date.startsWith(expected.date) &&
        entry.hours === expected.hours
    );
    if (!match) {
      issues.push(`missing ${expected.person} ${expected.date} ${expected.hours}h`);
      continue;
    }
    if (match.hoursBasis !== "explicit") issues.push(`${expected.person} ${expected.date} not explicit`);
    if (match.sredEligible !== expected.sredEligible) {
      issues.push(`${expected.person} ${expected.date} eligibility wrong`);
    }
  }
  const expectedCount = TIMESHEET_EVAL_EXPECTED.length;
  const explicit = entries.filter((entry) => entry.hoursBasis === "explicit" && entry.hours > 0);
  if (explicit.length > expectedCount) issues.push("invented explicit hours");
  return issues;
}

/** Timesheet extraction from a chat log with a known answer. */
export async function runTimesheetTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  try {
    const response = await metered.client.messages.create({
      model,
      max_tokens: TIMESHEET_MAX_TOKENS,
      system: TIMESHEET_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: timesheetUserMessage(TIMESHEET_EVAL_FILE_TYPE, TIMESHEET_EVAL_LOG) }],
    });
    const text = response.content.find((block) => block.type === "text");
    let parsed: ReturnType<typeof parseTimesheetReply> | null = null;
    try {
      parsed = text?.type === "text" ? parseTimesheetReply(text.text) : null;
    } catch {
      parsed = null;
    }
    return {
      result: {
        task: "timesheet_extraction",
        structured: true,
        schemaValid: parsed !== null,
        contractPassed: parsed !== null && timesheetContractIssues(parsed.entries).length === 0,
        costUsd: metered.meter.costUsd - before,
      },
      ...(parsed
        ? {
            judge: {
              sourceLabel: "Chat log",
              source: TIMESHEET_EVAL_LOG,
              criteria: [
                "The output reconstructs SR&ED timesheets from the log.",
                "1. Every entry's person, date and hours match the log; nothing is invented.",
                "2. Experimental work is eligible; routine development and purchases are not.",
                "3. Reasons and sources are specific.",
              ].join("\n"),
              output: JSON.stringify(parsed.entries, null, 2),
            },
          }
        : {}),
    };
  } catch (error) {
    return {
      result: {
        task: "timesheet_extraction",
        structured: true,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

/**
 * The Brain context contract: one or two sentences, at most 60 words, no
 * preamble, naming the company and the section the chunk belongs to.
 */
export function chunkContextIssues(text: string): string[] {
  const issues: string[] = [];
  const trimmed = text.trim();
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (!trimmed) issues.push("empty");
  if (sentences.length > 2) issues.push(`${sentences.length} sentences`);
  if (words(trimmed) > 60) issues.push("over 60 words");
  if (/^(here is|here's|context:|sure)/i.test(trimmed)) issues.push("preamble");
  if (!/verdant/i.test(trimmed)) issues.push("no company");
  if (!CHUNK_EVAL_SECTION_TERMS.some((term) => trimmed.toLowerCase().includes(term))) {
    issues.push("no section");
  }
  return issues;
}

/** One Brain contextualization request, exactly as ingestion sends it. */
export async function runChunkContextTask(metered: MeteredClient, model: string): Promise<EvalOutput> {
  const before = metered.meter.costUsd;
  try {
    const response = await metered.client.messages.create({
      model,
      max_tokens: CONTEXTUALIZE_MAX_TOKENS,
      system: CONTEXTUALIZE_SYSTEM_PROMPT,
      messages: contextualizeMessages(CHUNK_EVAL_DOCUMENT, CHUNK_EVAL_CHUNK),
    });
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join(" ")
      .trim();
    return {
      result: {
        task: "chunk_context",
        structured: false,
        schemaValid: true,
        contractPassed: chunkContextIssues(text).length === 0,
        costUsd: metered.meter.costUsd - before,
      },
      ...(text
        ? {
            judge: {
              sourceLabel: "Document and chunk",
              source: `${CHUNK_EVAL_DOCUMENT}\n\nCHUNK\n${CHUNK_EVAL_CHUNK}`,
              criteria: [
                "The output is a short blurb that situates the chunk for search.",
                "1. It names the company and the report section the chunk belongs to.",
                "2. It says what the chunk covers, accurately.",
                "3. It is one or two sentences with no preamble.",
              ].join("\n"),
              output: text,
            },
          }
        : {}),
    };
  } catch (error) {
    return {
      result: {
        task: "chunk_context",
        structured: false,
        schemaValid: false,
        contractPassed: false,
        costUsd: metered.meter.costUsd - before,
        error: errorText(error),
      },
    };
  }
}

// ─── Judge ──────────────────────────────────────────────────────────────────

export const JUDGE_TOOL = "record_grade";

export const JUDGE_SYSTEM = [
  "You grade one output of a tool that helps write Canadian SR&ED technical reports (CRA form T661).",
  "Grade strictly and the same way every time, against the criteria given with the output.",
  "Score from 1 (unusable) to 10 (flawless).",
].join("\n");

const TASK_LABELS: Record<EvalTaskKind, string> = {
  seed_batch: "Idea seeds for the technological uncertainties subsection",
  section_draft: "Line 242 draft",
  qa_structured: "QA scorecard",
  condense_digest: "Transcript digest",
  retrieval_queries: "Retrieval queries",
  style_classification: "Style classification",
  changelog_summary: "Release notes",
  pd_review_report: "PD review",
  timesheet_extraction: "Timesheet entries",
  chunk_context: "Chunk context",
};

const utf8 = new TextEncoder();
/** UTF-8 bytes: a token is at least one byte, so bytes never undercount tokens. */
export const utf8Bytes = (text: string) => utf8.encode(text).byteLength;

/** The judge request for one output, exactly as sent. */
export function judgeRequest(judgeModel: string, task: EvalTaskKind, input: JudgeInput): GenerationMessageParams {
  return {
    model: judgeModel,
    max_tokens: JUDGE_MAX_TOKENS,
    system: JUDGE_SYSTEM,
    tools: [
      {
        name: JUDGE_TOOL,
        description: "Record the grade for the output.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["score", "reason"],
          properties: {
            score: { type: "integer", minimum: 1, maximum: 10 },
            reason: { type: "string" },
          },
        },
      },
    ],
    tool_choice: { type: "tool", name: JUDGE_TOOL },
    messages: [
      {
        role: "user",
        content: `${input.sourceLabel.toUpperCase()}\n${input.source}\n\nCRITERIA\n${input.criteria}\n\n${TASK_LABELS[task].toUpperCase()}\n${input.output}`,
      },
    ],
  };
}

/**
 * An upper bound on a request's input tokens: the UTF-8 size of everything
 * it sends (system, messages and tool definitions).
 */
export function requestInputBytes(params: GenerationMessageParams): number {
  return utf8Bytes(JSON.stringify({ system: params.system ?? "", messages: params.messages, tools: params.tools ?? [] }));
}

/**
 * 1 to 10 from the judge, or undefined when it did not return a valid grade.
 * A judge request larger than the reserved judge input (a long generated
 * output) is never sent: the grade stays missing and the evaluation is
 * incomplete instead of spending past its reservation (review B).
 */
export async function judgeOutput(
  judge: MeteredClient,
  judgeModel: string,
  task: EvalTaskKind,
  input: JudgeInput
): Promise<number | undefined> {
  const request = judgeRequest(judgeModel, task, input);
  const bytes = requestInputBytes(request);
  if (bytes > EVAL_ENVELOPE.judge.maxInputTokens) {
    console.warn(`Judge input for ${task} is ${bytes} bytes, over the reserved ${EVAL_ENVELOPE.judge.maxInputTokens}; not judged`);
    return undefined;
  }
  try {
    const response = await judge.client.messages.create(request);
    const block = response.content.find((item) => item.type === "tool_use");
    const score =
      block?.type === "tool_use" && block.input && typeof block.input === "object"
        ? (block.input as { score?: unknown }).score
        : undefined;
    return isValidGrade(score) ? score : undefined;
  } catch (error) {
    console.warn(`Judge failed on ${task}: ${errorText(error)}`);
    return undefined;
  }
}

const TASK_RUNNERS: Record<EvalTaskKind, (metered: MeteredClient, model: string) => Promise<EvalOutput>> = {
  seed_batch: runSeedBatchTask,
  section_draft: runSectionDraftTask,
  qa_structured: runQaStructuredTask,
  condense_digest: runCondenseDigestTask,
  retrieval_queries: runRetrievalQueriesTask,
  style_classification: runStyleClassificationTask,
  changelog_summary: runChangelogSummaryTask,
  pd_review_report: runPdReviewTask,
  timesheet_extraction: runTimesheetTask,
  chunk_context: runChunkContextTask,
};

/** Run `tasks` for one model in parallel and have the judge grade them. */
export async function runEvalSet(args: {
  tasks: readonly EvalTaskKind[];
  model: string;
  makeClient: (task: EvalTaskKind) => MeteredClient;
  judge: MeteredClient;
  judgeModel: string;
}): Promise<EvalTaskResult[]> {
  const outputs = await Promise.all(
    args.tasks.map((task) => TASK_RUNNERS[task](args.makeClient(task), args.model))
  );
  return await Promise.all(
    outputs.map(async ({ result, judge }) => {
      if (!judge || !JUDGED_EVAL_TASKS.has(result.task)) return result;
      const score = await judgeOutput(args.judge, args.judgeModel, result.task, judge);
      return score === undefined ? result : { ...result, rubricScore: score };
    })
  );
}

export type EvalPricing = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
};

/**
 * The most one request can cost: its input at most one token per UTF-8 byte,
 * its output at the max_tokens the gateway will actually send, both at the
 * most the request can be charged per token (an OpenRouter request's
 * max_price, not just the listed price; round 8).
 */
export function requestMaxCostUsd(
  entry: Pick<FrozenModelEntry, "id" | "gateway" | "maxPrice">,
  params: GenerationMessageParams,
  pricing: EvalPricing,
  preserveMaxTokens: boolean
): number {
  const output =
    entry.gateway === "openrouter" && !preserveMaxTokens
      ? maxTokensWithReasoningHeadroom(entry.id, params.max_tokens)
      : params.max_tokens;
  const ceiling = chargeCeiling(entry, pricing);
  return (requestInputBytes(params) * ceiling.input + output * ceiling.output) / 1_000_000;
}

/**
 * An unattributed, metered client for one eval call site. Responses the
 * provider did not price are priced at `pricing`, the prices the claim
 * froze for this model, never at a fallback model's. Seed requests use the
 * production seed gateway policy.
 *
 * Every request is metered on its own (review C): a request that ends
 * without reporting a charge (a lost response, a timeout after the provider
 * already billed, or an answer that simply carried no usage) keeps its
 * maximum cost as unsettled spend instead of counting as free.
 */
export function evalClient(
  ctx: ActionCtx,
  entry: FrozenModelEntry,
  task: EvalTaskKind | "judge",
  pricing: EvalPricing
): MeteredClient {
  const meter = { costUsd: 0, unsettledUsd: 0 };
  const perMillion = pricingFromPerMillion(pricing);
  const callSite = `model_eval:${task}`;
  const seed = task === "seed_batch";
  const gatewayClient = (onUsage: UsageTap): GenerationClient =>
    entry.gateway === "openrouter"
      ? instrumentedOpenRouter(
          ctx,
          { callSite, onUsage },
          seed ? SEED_OPENROUTER_OPTIONS : { timeoutMs: EVAL_CALL_TIMEOUT_MS, maxRetries: 0 }
        )
      : (instrumentedAnthropic(ctx, {
          callSite,
          onUsage,
          capability: "generation",
          clientOptions: seed ? SEED_ANTHROPIC_OPTIONS : { maxRetries: 0, timeout: EVAL_CALL_TIMEOUT_MS },
        }) as unknown as GenerationClient);
  const client: GenerationClient = {
    messages: {
      create: async (params) => {
        let settled = false;
        const onUsage: UsageTap = ({ nativeCostUsd, tokens }) => {
          settled = true;
          const cost = nativeCostUsd ?? estimateCostWithPricing(perMillion, tokens);
          meter.costUsd += Number.isFinite(cost) ? cost : 0;
        };
        // Any request that ends, answered or not, without a reported charge
        // keeps its maximum cost (round 3, item 5).
        try {
          return await gatewayClient(onUsage).messages.create(params);
        } finally {
          if (!settled) meter.unsettledUsd += requestMaxCostUsd(entry, params, pricing, seed);
        }
      },
    },
  };
  return { client, meter };
}

export const runEvaluation = internalAction({
  args: { evaluationId: v.id("modelEvaluations") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(claimEvaluationRef, {
      evaluationId: args.evaluationId,
      envelope: EVAL_ENVELOPE,
    });
    if (!claim) return null;
    registerModelEntries([claim.candidate, claim.incumbent, claim.judge].map(entryFromFrozen));
    const meters: MeteredClient[] = [];
    const metered = (entry: FrozenModelEntry, task: EvalTaskKind | "judge") => {
      const client = evalClient(ctx, entry, task, claim.pricing[entry.id]);
      meters.push(client);
      return client;
    };
    const unsettled = () => meters.reduce((sum, client) => sum + (client.meter.unsettledUsd ?? 0), 0);
    // Unsettled requests keep their maximum cost until reconciled.
    const spent = () => meters.reduce((sum, client) => sum + client.meter.costUsd, 0) + unsettled();
    try {
      const judge = metered(claim.judge, "judge");
      const [candidateResults, incumbentResults] = await Promise.all(
        [claim.candidate, claim.incumbent].map((entry) =>
          runEvalSet({
            tasks: claim.tasks,
            model: entry.id,
            makeClient: (task) => metered(entry, task),
            judge,
            judgeModel: claim.judge.id,
          })
        )
      );
      await ctx.runMutation(completeEvaluationRef, {
        evaluationId: claim.evaluationId,
        candidateResults,
        incumbentResults,
        evalCostUsd: spent(),
        unsettledCostUsd: unsettled(),
      });
    } catch (error) {
      await ctx.runMutation(failEvaluationRef, {
        evaluationId: claim.evaluationId,
        error: errorText(error),
        evalCostUsd: spent(),
        unsettledCostUsd: unsettled(),
      });
    }
    return null;
  },
});
