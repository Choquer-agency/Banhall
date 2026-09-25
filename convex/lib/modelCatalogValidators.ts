import { v, type Infer } from "convex/values";

/**
 * Validators for the model catalog tables (owner decision 21). Kept apart
 * from schema.ts so the catalog module and the generation reservation share
 * one definition of a frozen model entry.
 */

export const modelGatewayValidator = v.union(
  v.literal("anthropic"),
  v.literal("openrouter")
);

export const modelRoleValidator = v.union(
  v.literal("writing"),
  v.literal("structured_helper"),
  v.literal("chat"),
  v.literal("condense"),
  v.literal("retrieval_brief"),
  v.literal("analysis")
);

export const catalogStatusValidator = v.union(
  v.literal("candidate"),
  v.literal("enabled"),
  v.literal("retired")
);

export const benchmarkValidator = v.object({
  source: v.union(v.literal("openrouter_aa"), v.literal("artificial_analysis")),
  metric: v.union(
    v.literal("intelligence_index"),
    v.literal("coding_index"),
    v.literal("agentic_index")
  ),
  value: v.number(),
  fetchedAt: v.number(),
});

export const endpointSupportValidator = v.object({
  checkedAt: v.number(),
  endpointCount: v.number(),
  toolsAndStructuredProviders: v.array(v.string()),
});

/** The catalog fields shared by the table and the refresh mutation. */
export const catalogFieldsValidator = {
  modelId: v.string(),
  gateway: modelGatewayValidator,
  canonicalSlug: v.string(),
  requestId: v.optional(v.string()),
  displayName: v.string(),
  provider: v.string(),
  description: v.optional(v.string()),
  inputUsdPerMTok: v.optional(v.number()),
  outputUsdPerMTok: v.optional(v.number()),
  cacheReadUsdPerMTok: v.optional(v.number()),
  cacheWriteUsdPerMTok: v.optional(v.number()),
  cacheWrite1hUsdPerMTok: v.optional(v.number()),
  contextLength: v.optional(v.number()),
  maxOutputTokens: v.optional(v.number()),
  maxCompletionTokens: v.optional(v.number()),
  reasoning: v.boolean(),
  reasoningMandatory: v.optional(v.boolean()),
  reasoningEfforts: v.array(v.string()),
  supportsTools: v.boolean(),
  supportsToolChoice: v.boolean(),
  supportsStructuredOutputs: v.boolean(),
  supportsReasoning: v.boolean(),
  expirationDate: v.optional(v.string()),
  benchmarks: v.array(benchmarkValidator),
};

export const maxPriceValidator = v.object({
  prompt: v.number(),
  completion: v.number(),
});

/**
 * One model as frozen onto a generation at reservation. Carries only what
 * changes a request (routing, output budget, request id, price ceiling) and
 * the label shown for it, so a later catalog change to prices or scores
 * never reaches a running generation or its prompt version.
 */
export const frozenModelEntryValidator = v.object({
  id: v.string(),
  label: v.string(),
  provider: v.string(),
  gateway: modelGatewayValidator,
  reasoning: v.boolean(),
  maxCompletionTokens: v.optional(v.number()),
  requestId: v.optional(v.string()),
  maxPrice: v.optional(maxPriceValidator),
});
export type FrozenModelEntry = Infer<typeof frozenModelEntryValidator>;

/**
 * The model for every role a generation uses, frozen at reservation. The
 * candidate models themselves stay on `singleModelId` / `compareModelIds`;
 * `entries` holds one entry per distinct model id across both.
 */
export const modelFreezeValidator = v.object({
  entries: v.array(frozenModelEntryValidator),
  roles: v.object({
    writing: v.string(),
    condense: v.string(),
    retrieval_brief: v.string(),
    analysis: v.string(),
  }),
  frozenAt: v.number(),
});
export type ModelFreeze = Infer<typeof modelFreezeValidator>;

export const evalSummaryValidator = v.object({
  schemaValidity: v.number(),
  contractPassRate: v.number(),
  rubricScore: v.number(),
  costUsd: v.number(),
  tasks: v.number(),
});

export const gateResultValidator = v.object({
  gate: v.union(
    v.literal("schema_validity"),
    v.literal("contract_pass_rate"),
    v.literal("rubric"),
    v.literal("cost")
  ),
  passed: v.boolean(),
  detail: v.string(),
});

export const costComparisonValidator = v.object({
  fromInputUsdPerMTok: v.optional(v.number()),
  fromOutputUsdPerMTok: v.optional(v.number()),
  toInputUsdPerMTok: v.optional(v.number()),
  toOutputUsdPerMTok: v.optional(v.number()),
  fromEvalCostUsd: v.optional(v.number()),
  toEvalCostUsd: v.optional(v.number()),
});

export const evalTaskKindValidator = v.union(
  v.literal("seed_batch"),
  v.literal("section_draft"),
  v.literal("qa_structured"),
  v.literal("condense_digest"),
  v.literal("retrieval_queries"),
  v.literal("style_classification"),
  v.literal("changelog_summary")
);

const requestBoundValidator = v.object({
  requests: v.number(),
  maxInputTokens: v.number(),
  answerTokens: v.object({ anthropic: v.number(), openrouter: v.number() }),
  preserveMaxTokens: v.boolean(),
});

/** The evaluation action's request envelope (shared/modelCatalog EvalEnvelope). */
export const evalEnvelopeValidator = v.object({
  seed_batch: requestBoundValidator,
  section_draft: requestBoundValidator,
  qa_structured: requestBoundValidator,
  condense_digest: requestBoundValidator,
  retrieval_queries: requestBoundValidator,
  style_classification: requestBoundValidator,
  changelog_summary: requestBoundValidator,
  judge: requestBoundValidator,
});

/** Per-million-token prices frozen for an evaluation's usage meter. */
export const evalPricingValidator = v.object({
  input: v.number(),
  output: v.number(),
  cacheRead: v.optional(v.number()),
  cacheWrite: v.optional(v.number()),
  cacheWrite1h: v.optional(v.number()),
});

export const evalTaskResultValidator = v.object({
  task: evalTaskKindValidator,
  structured: v.boolean(),
  schemaValid: v.boolean(),
  contractPassed: v.optional(v.boolean()),
  rubricScore: v.optional(v.number()),
  costUsd: v.number(),
  error: v.optional(v.string()),
});

/** An OpenRouter pull, parsed (shared/modelCatalog.ts ParsedModel). */
export const parsedModelValidator = v.object({
  openRouterId: v.string(),
  ...catalogFieldsValidator,
});
