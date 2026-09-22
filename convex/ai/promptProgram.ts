"use node";

import { sha256 } from "../lib/contracts";
import {
  CANDIDATE_MODELS,
  MODEL,
  REASONING_TOKEN_MULTIPLIER,
  SECTION_ANSWER_TOKEN_BUDGETS,
  UNKNOWN_MODEL_GATEWAY,
  maxTokensWithReasoningHeadroom,
  sectionAnswerTokenBudget,
} from "../../shared/generationModels";
import {
  CHARS_PER_LINE,
  LENGTH_TARGETS,
  LINE_LIMITS,
  WORD_CAPS,
  WORD_BUDGET_USABLE_LINE_FACTOR,
  WORD_BUDGET_WORDS_PER_LINE,
  wordBudget,
} from "../lib/lineLimits";
import {
  DEFAULT_HOUSE_RULE_MODES,
  HOUSE_RULE_MODES,
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
} from "../../shared/styleOverrides";
import {
  ANALYZER_SYSTEM_PROMPT,
  CONSISTENCY_SYSTEM_PROMPT,
  CONTEXT_INPUTS_GUIDANCE,
  GENERATION_WRITING_PROMPT_PROGRAM,
  SELF_CHECK_SYSTEM_PROMPT,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
} from "./prompts";
import {
  ANALYSIS_SCHEMA,
  ANALYZER_CATEGORY_LABELS,
  ANALYZER_CATEGORY_ORDER,
  ANALYZER_REQUEST,
} from "./analyzerAgent";
import { BRIEF_SYSTEM_PROMPT, BRIEF_REQUEST, BRIEF_SCHEMA } from "./brief";
import {
  ANALYSIS_TOOL_SCHEMA,
  STYLE_ANALYSIS_REQUEST,
  STYLE_ANALYSIS_SYSTEM_PROMPT,
} from "./styleAnalysis";
import { DEFAULT_CONTEXT_BUDGET } from "./trustedContext";
import {
  CONDENSE_CONCURRENCY,
  CONDENSE_REQUEST,
  CONDENSE_SCHEMA,
  CONDENSE_SYSTEM_PROMPT,
  CONDENSE_TIMEOUT_MS,
} from "./condenseAgent";
import {
  CONDENSE_VERSION,
  CONDENSE_WINDOW_CHARS,
  DIGEST_TARGET_CHARS,
  TRANSCRIPT_BUDGET_CHARS,
} from "../lib/transcripts";
import { SECTION_242_REQUEST } from "./section242Agent";
import { SECTION_244_REQUEST } from "./section244Agent";
import { SECTION_246_REQUEST } from "./section246Agent";
import { QA_REQUEST, QA_SCHEMA } from "./qaAgent";
import {
  CHRONOLOGY_REQUEST,
  CHRONOLOGY_SCHEMA,
  CHRONOLOGY_SYSTEM_PROMPT,
} from "./chronologyAgent";
import { STRUCTURED_OUTPUT_PROGRAM } from "./structured";
import {
  COMPRESSION_REQUEST,
  CONSISTENCY_REQUEST,
  CONSISTENCY_SCHEMA,
  ITERATIVE_PROMPT_SCAFFOLDS,
  ITERATIVE_SECTION_TITLES,
  LENGTH_BUDGET_SCAFFOLD,
  ORDERED_PROMPT_SCAFFOLDS,
  ORDERED_SECTION_TITLES,
  SELF_CHECK_REQUEST,
  SELF_CHECK_SCHEMA,
  SEED_PROMPT_PROGRAM,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
  SUMMARY_PLAN_SELF_CHECK_SCHEMA,
  STYLE_GUIDANCE_SCAFFOLDS,
} from "./promptDefinitions";
import {
  FROZEN_SUMMARY_PLAN_CHECKS_SCAFFOLD,
  FROZEN_SUMMARY_PLAN_SCAFFOLD,
  MAX_SUMMARY_ORDINARY_VERDICTS,
  MAX_SUMMARY_PLAN_CHECK_INPUT_UTF8_BYTES,
  MAX_SUMMARY_PLAN_VERDICTS,
  MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES,
  SUMMARY_ORDINARY_LABEL_PROJECTION_VERSION,
  SUMMARY_PLAN_SERIALIZER_VERSION,
} from "../lib/seedRevisions";
import { CANDIDATE_MODE_ROUTING } from "./model";
import {
  RETRIEVAL_BRIEF_MODEL,
  RETRIEVAL_BRIEF_REQUEST,
  RETRIEVAL_BRIEF_SCHEMA,
  RETRIEVAL_BRIEF_SYSTEM_PROMPT,
  RETRIEVAL_BRIEF_TRANSCRIPT_CAP,
} from "./brain/query";
import {
  BRAIN_EMBEDDING_DIMENSION,
  BRAIN_EMBEDDING_MODEL_ID,
  BRAIN_RERANK_MODEL_ID,
} from "./brain/embeddings";
import {
  BRAIN_CHUNK_CONTEXT,
  BRAIN_EXEMPLAR_SCAFFOLDS,
  BRAIN_MAX_EXEMPLAR_CHARS,
  BRAIN_MIN_VECTOR_SIMILARITY,
  BRAIN_RAW_SEARCH_FLOOR,
  BRAIN_RERANK_MAX_RETRIES,
  BRAIN_RERANK_RELEVANCE_FLOOR,
  BRAIN_RERANK_TOP_N_CAP,
  BRAIN_SEARCH_DEFAULT_K,
  BRAIN_SEARCH_LIMIT,
  BRAIN_SEARCH_PROGRAM,
} from "./brain/retrieve";
import { BRAIN_FILTER_NAMES, BRAIN_NAMESPACE } from "./brain/rag";
import { BRAIN_SCIENCE_ROUTING } from "./brain/scienceRouting";
import {
  BRAIN_FALLBACK_TRANSCRIPT_CHARS,
  BRAIN_GENERATION_QUERY_PROGRAM,
  GENERATION_BRAIN_RETRIEVALS,
} from "./brainRetrieval";
import { OPENROUTER_CONVERSION } from "./openrouterCore";
import { PD_SUBSECTIONS } from "../../shared/pdSubsections";
import { seedToolSchema } from "../lib/seedContract";

export const PROMPT_PROGRAM_CONTRACT_ID =
  "banhall.generation-prompt-program/v1";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Serialize JSON-compatible data with recursively sorted object keys. Arrays
 * and string bytes are preserved exactly because their order, whitespace,
 * line endings, and Unicode are prompt semantics.
 */
export function canonicalSerialize(value: unknown): string {
  const ancestors = new WeakSet<object>();

  const serialize = (current: unknown, path: string): string => {
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError(`Prompt program contains a non-finite number at ${path}`);
      }
      return JSON.stringify(current);
    }
    if (typeof current === "undefined") {
      throw new TypeError(`Prompt program contains undefined at ${path}`);
    }
    if (
      typeof current === "function" ||
      typeof current === "symbol" ||
      typeof current === "bigint"
    ) {
      throw new TypeError(
        `Prompt program contains unsupported ${typeof current} at ${path}`
      );
    }
    if (typeof current !== "object") {
      throw new TypeError(`Prompt program contains an unsupported value at ${path}`);
    }
    if (ancestors.has(current)) {
      throw new TypeError(`Prompt program contains a cycle at ${path}`);
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return `[${Array.from({ length: current.length }, (_, index) =>
          serialize(current[index], `${path}[${index}]`)
        )
          .join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`Prompt program contains a non-plain object at ${path}`);
      }
      if (Object.getOwnPropertySymbols(current).length > 0) {
        throw new TypeError(`Prompt program contains a symbol key at ${path}`);
      }
      const record = current as Record<string, unknown>;
      const keys = Object.keys(record).sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0
      );
      return `{${keys
        .map(
          (key) =>
            `${JSON.stringify(key)}:${serialize(record[key], `${path}.${key}`)}`
        )
        .join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  };

  return serialize(value, "$root");
}

const projectedModels = CANDIDATE_MODELS.map((model) => ({
  id: model.id,
  gateway: model.gateway,
  reasoning: "reasoning" in model ? model.reasoning : null,
  maxCompletionTokens:
    "maxCompletionTokens" in model ? model.maxCompletionTokens : null,
  sectionAnswerTokenBudget: sectionAnswerTokenBudget(model.id),
  reasoningHeadroom: [1024, 4096, 8192].map((answerTokens) => ({
    answerTokens,
    requestMaxTokens: maxTokensWithReasoningHeadroom(model.id, answerTokens),
  })),
})).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const seedRolePromptProgram = PD_SUBSECTIONS.map((role) => ({
  roleId: role.roleId,
  section: role.section,
  order: role.order,
  kind: role.kind,
  title: role.title,
  objective: role.objective,
  schemas: {
    batch: seedToolSchema(role.roleId, "batch"),
    feedback: seedToolSchema(role.roleId, "feedback"),
  },
}));

const derivedWordBudgets = Object.keys(LINE_LIMITS).flatMap((section) =>
  Object.keys(LENGTH_TARGETS).map((target) => ({
    section,
    target,
    words: wordBudget(
      section as keyof typeof LINE_LIMITS,
      target as keyof typeof LENGTH_TARGETS
    ),
  }))
).sort((a, b) => {
  const left = `${a.section}:${a.target}`;
  const right = `${b.section}:${b.target}`;
  return left < right ? -1 : left > right ? 1 : 0;
});

/**
 * The deployment-level provider-facing program. It deliberately contains no
 * project, user, transcript, report, Brain result, digest, or other per-call
 * content. Named sentinels describe those runtime slots without filling them.
 */
export const generationPromptProgram = {
  contractId: PROMPT_PROGRAM_CONTRACT_ID,
  topology: {
    modes: {
      single: [
        "retrieval-brief-with-fallback-query",
        "four-sequential-brain-searches-with-optional-rerank",
        "candidate-pipeline",
        "promote-completed-candidate",
      ],
      compare: [
        "retrieval-brief-with-fallback-query",
        "four-sequential-brain-searches-with-optional-rerank",
        "parallel-candidate-pipelines",
        "human-candidate-selection",
      ],
      iterative: {
        selectedBy: "stored-gatedWorkflow",
        sections: [
          "retrieval-brief-with-fallback-query",
          "four-sequential-brain-searches-with-optional-rerank",
          "frozen-analyzer-brain-style-artifacts",
          "brief",
          "section-242-human-review",
          "approved-prior-section-context",
          "section-244-human-review",
          "approved-prior-section-context",
          "section-246-human-review",
          "redraft-with-writer-guidance",
          "one-shot-ghost-candidate-pipeline",
          "assemble-approved-sections",
          "post-terminal-qa-and-chronology",
        ],
        seeds: [
          "retrieval-brief-with-fallback-query",
          "four-sequential-brain-searches-with-optional-rerank",
          "frozen-analyzer-brain-style-artifacts",
          "brief",
          "seed-stage-human-gate",
          "ordered-section-chain-after-sign-off",
          "post-terminal-qa-and-chronology",
        ],
      },
    },
    candidatePipeline: [
      "analyzer",
      // Story 1 (CAP-1/2/4): Brief stage after analyzer, before sections.
      // Derives or reuses Storyline, Claim Exclusions, Confidence Map, Glossary Terms.
      "brief",
      // Story 2 (CAP-5/9/10, AD-24): ordered, ungated section chain in
      // single/compare — one scheduled action per section in the Writer
      // Profile's Build Order (default 242 → 244 → 246), each with the prior
      // DRAFTED sections as context, Self-checked and repaired at most once;
      // no approval gate. Then one consistency pass over the assembled draft
      // before the last section is shown.
      {
        orderedSectionChain: {
          defaultBuildOrder: ["242", "244", "246"],
          perSection: [
            "section",
            "conditionalCompression",
            "selfCheck",
            "atMostOneRepair",
          ],
          gate: "none",
        },
      },
      "assembled-draft-consistency-pass",
      { allSettled: ["qa", "chronology"] },
    ],
    // Iterative's background ghost keeps the one-shot parallel pipeline; it
    // never runs the ordered chain, so it creates no ordered section rows.
    oneShotCandidatePipeline: [
      "analyzer",
      ["section242", "section244", "section246"],
      {
        conditionalCompression: [
          COMPRESSION_REQUEST.squeezes[0],
          COMPRESSION_REQUEST.squeezes[1],
        ],
      },
      { allSettled: ["qa", "chronology"] },
    ],
    brain: {
      briefFailure: "title-plus-truncated-transcript-fallback",
      searches: "sequential-in-generation-retrieval-order",
      rerank: "only-when-candidate-count-exceeds-k",
    },
    structuredOutput: ["initial-forced-tool-attempt", "one-repair-attempt"],
  },
  calls: {
    retrievalBrief: {
      kind: "structured",
      systemTemplate: RETRIEVAL_BRIEF_SYSTEM_PROMPT,
      request: RETRIEVAL_BRIEF_REQUEST,
      schema: RETRIEVAL_BRIEF_SCHEMA,
      model: { kind: "fixed", modelId: RETRIEVAL_BRIEF_MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
    },
    condense: {
      kind: "structured",
      systemTemplate: CONDENSE_SYSTEM_PROMPT,
      request: CONDENSE_REQUEST,
      schema: CONDENSE_SCHEMA,
      model: { kind: "fixed", modelId: MODEL },
      thinking: { kind: "omitted" },
      // One attempt, not the repair pass: the whole generation waits on this
      // call before any drafting starts.
      structuredPolicy: "single-attempt",
    },
    analyzer: {
      kind: "structured",
      systemTemplate: ANALYZER_SYSTEM_PROMPT,
      contextGuidance: CONTEXT_INPUTS_GUIDANCE,
      contextCategoryLabels: ANALYZER_CATEGORY_LABELS,
      contextCategoryOrder: ANALYZER_CATEGORY_ORDER,
      // The analyzer's context budget is part of the disclosed contract: it
      // decides how much of each frozen source actually reaches the model.
      contextBudget: DEFAULT_CONTEXT_BUDGET,
      request: ANALYZER_REQUEST,
      schema: ANALYSIS_SCHEMA,
      // Compare entry analysis is independent of candidate pair order.
      // Older queued candidates without shared analysis still select their model.
      model: {
        kind: "mode-dependent",
        compare: { kind: "fixed", modelId: MODEL },
        single: { kind: "candidate", fallbackModelId: MODEL },
        iterative: { kind: "candidate", fallbackModelId: MODEL },
        legacyCandidate: { kind: "candidate", fallbackModelId: MODEL },
      },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
    },
    // Story 1 (CAP-1/2/4): Generation Brief stage
    brief: {
      kind: "structured",
      systemTemplate: BRIEF_SYSTEM_PROMPT,
      request: BRIEF_REQUEST,
      schema: BRIEF_SCHEMA,
      model: { kind: "candidate", fallbackModelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
      // Slot label for aiUsage tracking (AD-27)
      callSite: "generation:brief",
    },
    seeds: {
      kind: "structured",
      systemTemplate: SEED_PROMPT_PROGRAM.systemPolicy,
      styleOverridesScaffold: SEED_PROMPT_PROGRAM.styleOverrides,
      userScaffold: SEED_PROMPT_PROGRAM.user,
      request: SEED_PROMPT_PROGRAM.request,
      schemaByRole: Object.fromEntries(
        seedRolePromptProgram.map((role) => [role.roleId, role.schemas.batch])
      ),
      model: { kind: "candidate", fallbackModelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
      callSite: "generation:seeds:<roleId>",
    },
    seedFeedback: {
      kind: "structured",
      systemTemplate: SEED_PROMPT_PROGRAM.systemPolicy,
      styleOverridesScaffold: SEED_PROMPT_PROGRAM.styleOverrides,
      userScaffold: SEED_PROMPT_PROGRAM.user,
      request: SEED_PROMPT_PROGRAM.request,
      schemaByRole: Object.fromEntries(
        seedRolePromptProgram.map((role) => [role.roleId, role.schemas.feedback])
      ),
      model: { kind: "candidate", fallbackModelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
      callSite: "generation:seedFeedback:<roleId>",
    },
    // Story 3 (CAP-8, AD-26/27): the PSOS-50 style classifier run on a
    // settings document supplied as Writer's Notes or an attachment, reused
    // verbatim, cached per (projectId, contentHash, classifierVersion) so a
    // document costs one call the first time a classifier version sees it
    // and none after. One attempt, not the repair pass: generateReport waits
    // on it inside its 600 s action.
    settingsAnalysis: {
      kind: "structured",
      systemTemplate: STYLE_ANALYSIS_SYSTEM_PROMPT,
      request: STYLE_ANALYSIS_REQUEST,
      schema: ANALYSIS_TOOL_SCHEMA,
      model: { kind: "fixed", modelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "single-attempt",
      callSite: "generation:settings",
      cache: "per-projectId-and-contentHash-and-classifierVersion",
    },
    section242: {
      kind: "text",
      systemTemplateSet: "writing.sectionSystemTemplates.section242",
      request: SECTION_242_REQUEST,
      model: { kind: "candidate", fallbackModelId: MODEL },
    },
    section244: {
      kind: "text",
      systemTemplateSet: "writing.sectionSystemTemplates.section244",
      request: SECTION_244_REQUEST,
      model: { kind: "candidate", fallbackModelId: MODEL },
    },
    section246: {
      kind: "text",
      systemTemplateSet: "writing.sectionSystemTemplates.section246",
      request: SECTION_246_REQUEST,
      model: { kind: "candidate", fallbackModelId: MODEL },
    },
    compression: {
      kind: "text",
      systemTemplate: COMPRESSION_REQUEST.system,
      request: COMPRESSION_REQUEST,
      model: { kind: "candidate" },
    },
    // Story 2 (CAP-9, AD-25/27): one structured Self-check per section.
    selfCheck: {
      kind: "structured",
      systemTemplate: SELF_CHECK_SYSTEM_PROMPT,
      request: SELF_CHECK_REQUEST,
      schema: SELF_CHECK_SCHEMA,
      model: { kind: "candidate", fallbackModelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
      callSite: "generation:selfCheck:<n>",
      perSection: 1,
      summaryPlan: {
        systemTemplate: SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
        requestScaffold: SUMMARY_PLAN_SELF_CHECK_REQUEST,
        schema: SUMMARY_PLAN_SELF_CHECK_SCHEMA,
        structuredPolicy: "single-attempt-no-repair",
        encodedJsonRecovery: "disabled",
      },
    },
    // Story 2 (CAP-9): the repair is the section agent itself, re-run once
    // with the repair guidance appended; re-checked deterministically only.
    repair: {
      kind: "text",
      reuses: "section-agent",
      systemTemplateSet: "writing.sectionSystemTemplates.<section>",
      scaffold: ORDERED_PROMPT_SCAFFOLDS.repairGuidance,
      model: { kind: "candidate", fallbackModelId: MODEL },
      callSite: "generation:repair:<n>",
      maxPerSection: 1,
      recheck: "deterministic-only",
    },
    // Story 2 (CAP-10, AD-24): one pass over the assembled draft per candidate.
    consistency: {
      kind: "structured",
      systemTemplate: CONSISTENCY_SYSTEM_PROMPT,
      request: CONSISTENCY_REQUEST,
      schema: CONSISTENCY_SCHEMA,
      model: { kind: "candidate", fallbackModelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
      callSite: "generation:consistency",
      perCandidate: 1,
    },
    qa: {
      kind: "structured",
      systemTemplateSet: "writing.qaSystemTemplates",
      request: QA_REQUEST,
      schema: QA_SCHEMA,
      model: { kind: "candidate", fallbackModelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
    },
    chronology: {
      kind: "structured",
      systemTemplate: CHRONOLOGY_SYSTEM_PROMPT,
      request: CHRONOLOGY_REQUEST,
      schema: CHRONOLOGY_SCHEMA,
      model: { kind: "candidate", fallbackModelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
    },
  },
  templates: {
    writing: GENERATION_WRITING_PROMPT_PROGRAM,
    lengthBudget: LENGTH_BUDGET_SCAFFOLD,
    styleGuidance: STYLE_GUIDANCE_SCAFFOLDS,
    iterative: {
      sectionTitles: ITERATIVE_SECTION_TITLES,
      scaffolds: ITERATIVE_PROMPT_SCAFFOLDS,
    },
    ordered: {
      sectionTitles: ORDERED_SECTION_TITLES,
      scaffolds: ORDERED_PROMPT_SCAFFOLDS,
    },
    seeds: {
      scaffolds: SEED_PROMPT_PROGRAM,
      roles: seedRolePromptProgram,
      summaryPlan: {
        drafting: FROZEN_SUMMARY_PLAN_SCAFFOLD,
        checks: FROZEN_SUMMARY_PLAN_CHECKS_SCAFFOLD,
        serializerVersion: SUMMARY_PLAN_SERIALIZER_VERSION,
        ordinaryLabelProjectionVersion:
          SUMMARY_ORDINARY_LABEL_PROJECTION_VERSION,
        capacity: {
          maxOrdinaryVerdicts: MAX_SUMMARY_ORDINARY_VERDICTS,
          maxPlanVerdicts: MAX_SUMMARY_PLAN_VERDICTS,
          maxCheckInputUtf8Bytes: MAX_SUMMARY_PLAN_CHECK_INPUT_UTF8_BYTES,
          maxResponseUtf8Bytes: MAX_SUMMARY_SELF_CHECK_RESPONSE_UTF8_BYTES,
        },
      },
    },
  },
  configuration: {
    models: {
      defaultModelId: MODEL,
      unknownModelGateway: UNKNOWN_MODEL_GATEWAY,
      registry: projectedModels,
      modeRouting: CANDIDATE_MODE_ROUTING,
      randomComparisonPoolGateway:
        CANDIDATE_MODE_ROUTING.compare.randomPoolGateway,
      sectionAnswerTokenBudgets: SECTION_ANSWER_TOKEN_BUDGETS,
      reasoningTokenMultiplier: REASONING_TOKEN_MULTIPLIER,
    },
    style: {
      overrideKeys: STYLE_OVERRIDE_KEYS,
      defaultOverrides: NO_STYLE_OVERRIDES,
      governanceModes: [...HOUSE_RULE_MODES].sort(),
      defaultGovernanceModes: DEFAULT_HOUSE_RULE_MODES,
    },
    length: {
      charsPerLine: CHARS_PER_LINE,
      lineLimits: LINE_LIMITS,
      wordCaps: WORD_CAPS,
      lengthTargets: LENGTH_TARGETS,
      wordBudgetFormula: {
        usableLineFactor: WORD_BUDGET_USABLE_LINE_FACTOR,
        wordsPerLine: WORD_BUDGET_WORDS_PER_LINE,
        rounding: "nearest-integer",
        cap: "section-word-cap",
      },
      derivedWordBudgets,
    },
    transcripts: {
      budgetChars: TRANSCRIPT_BUDGET_CHARS,
      condenseWindowChars: CONDENSE_WINDOW_CHARS,
      digestTargetChars: DIGEST_TARGET_CHARS,
      condenseVersion: CONDENSE_VERSION,
      condenseTimeoutMs: CONDENSE_TIMEOUT_MS,
      condenseConcurrency: CONDENSE_CONCURRENCY,
    },
    brain: {
      namespace: BRAIN_NAMESPACE,
      filterNames: [...BRAIN_FILTER_NAMES].sort(),
      retrievalBrief: {
        modelId: RETRIEVAL_BRIEF_MODEL,
        transcriptCap: RETRIEVAL_BRIEF_TRANSCRIPT_CAP,
      },
      generationRetrievals: GENERATION_BRAIN_RETRIEVALS,
      generationQuery: BRAIN_GENERATION_QUERY_PROGRAM,
      fallbackTranscriptChars: BRAIN_FALLBACK_TRANSCRIPT_CHARS,
      embedding: {
        modelId: BRAIN_EMBEDDING_MODEL_ID,
        dimension: BRAIN_EMBEDDING_DIMENSION,
      },
      rerankModelId: BRAIN_RERANK_MODEL_ID,
      search: {
        request: BRAIN_SEARCH_PROGRAM,
        defaultK: BRAIN_SEARCH_DEFAULT_K,
        limit: BRAIN_SEARCH_LIMIT,
        chunkContext: BRAIN_CHUNK_CONTEXT,
        minimumVectorSimilarity: BRAIN_MIN_VECTOR_SIMILARITY,
        rawSearchFloor: BRAIN_RAW_SEARCH_FLOOR,
        rerankRelevanceFloor: BRAIN_RERANK_RELEVANCE_FLOOR,
        rerankTopNCap: BRAIN_RERANK_TOP_N_CAP,
        rerankMaxRetries: BRAIN_RERANK_MAX_RETRIES,
        scienceRouting: BRAIN_SCIENCE_ROUTING,
      },
      exemplarFormatting: {
        maxChars: BRAIN_MAX_EXEMPLAR_CHARS,
        scaffolds: BRAIN_EXEMPLAR_SCAFFOLDS,
      },
    },
    structuredOutput: STRUCTURED_OUTPUT_PROGRAM,
    openRouterConversion: OPENROUTER_CONVERSION,
  },
} as const;

export async function hashPromptProgram(
  program: unknown = generationPromptProgram
): Promise<string> {
  const canonicalJson = canonicalSerialize(program);
  const digest = await sha256(
    `${PROMPT_PROGRAM_CONTRACT_ID}\n${canonicalJson}`
  );
  return `sha256:${digest}`;
}

let currentPromptVersionPromise: Promise<string> | undefined;

/** Memoize the deployment-level computation, including concurrent callers. */
export function currentPromptVersion(): Promise<string> {
  currentPromptVersionPromise ??= hashPromptProgram(generationPromptProgram).catch(
    (error: unknown) => {
      // Never memoize a rejection: the next caller recomputes instead of
      // inheriting a poisoned promise for the life of the isolate.
      currentPromptVersionPromise = undefined;
      throw error;
    }
  );
  return currentPromptVersionPromise;
}
