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
  CONTEXT_INPUTS_GUIDANCE,
  GENERATION_WRITING_PROMPT_PROGRAM,
} from "./prompts";
import {
  ANALYSIS_SCHEMA,
  ANALYZER_CATEGORY_LABELS,
  ANALYZER_CATEGORY_ORDER,
  ANALYZER_REQUEST,
} from "./analyzerAgent";
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
  ITERATIVE_PROMPT_SCAFFOLDS,
  ITERATIVE_SECTION_TITLES,
  LENGTH_BUDGET_SCAFFOLD,
  STYLE_GUIDANCE_SCAFFOLDS,
} from "./promptDefinitions";
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
      iterative: [
        "retrieval-brief-with-fallback-query",
        "four-sequential-brain-searches-with-optional-rerank",
        "frozen-analyzer-brain-style-artifacts",
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
    },
    candidatePipeline: [
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
    analyzer: {
      kind: "structured",
      systemTemplate: ANALYZER_SYSTEM_PROMPT,
      contextGuidance: CONTEXT_INPUTS_GUIDANCE,
      contextCategoryLabels: ANALYZER_CATEGORY_LABELS,
      contextCategoryOrder: ANALYZER_CATEGORY_ORDER,
      request: ANALYZER_REQUEST,
      schema: ANALYSIS_SCHEMA,
      model: { kind: "candidate", fallbackModelId: MODEL },
      thinking: { kind: "omitted" },
      structuredPolicy: "two-attempt-repair",
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
