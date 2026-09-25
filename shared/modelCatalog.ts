/**
 * Model catalog rules (owner decision 21, 2026-09-24): the pure half of the
 * automatic model catalog. The Convex tables, cron and actions live in
 * convex/modelCatalog.ts and convex/ai/modelEvaluation.ts; everything that
 * decides something lives here so it tests from fixtures without a
 * deployment.
 *
 * Flow, once a day:
 * 1. parseOpenRouterModels + diffCatalog: refresh the catalog, flag new,
 *    renamed, expiring and gone models.
 * 2. prefilterCandidate + selectEvaluations: pick at most a few candidates
 *    per run that could beat a role's current model on paper.
 * 3. summarizeEvalRun + promotionGates: run the candidate and the incumbent
 *    on the same fixed eval set and switch only when every gate passes.
 * 4. productionErrorVerdict: roll a switched role back when its model fails
 *    in production.
 *
 * Artificial Analysis scores (embedded in OpenRouter's catalog, or read with
 * AA_API_KEY) are for internal use only: shown on the admin page with an
 * attribution line and never exposed to clients.
 */
import {
  CANDIDATE_MODELS,
  MODEL,
  REASONING_TOKEN_MULTIPLIER,
  type ModelEntry,
  type ModelGateway,
} from "./generationModels";
import { pricingFor } from "./modelPricing";

// ─── Roles ──────────────────────────────────────────────────────────────────

/**
 * Every model role maps to the production call sites it serves. A role
 * switches on its own only if every one of those call sites is covered by
 * an evaluation task with its own fixture and contract; call sites without
 * one have their own manual role (review A, 2026-09-24).
 */
export const MODEL_ROLES = [
  "writing",
  "condense",
  "retrieval_brief",
  "analysis",
  "structured_helper",
  "pd_review",
  "financial_extraction",
  "brain_context",
  "chat",
  "learning_digest",
  "science_code",
  "feedback_summary",
] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export function isModelRole(value: string): value is ModelRole {
  return (MODEL_ROLES as readonly string[]).includes(value);
}

/**
 * One production task an evaluation runs. Each automatically switchable
 * role is evaluated on every task it serves in production:
 * - writing: seed_batch, section_draft, qa_structured (seeds, sections, QA);
 * - condense: condense_digest (facts and verbatim quotes kept);
 * - retrieval_brief: retrieval_queries (four Brain queries, no names);
 * - analysis: style_classification (the settings classifier, used both in
 *   generations and for saved writer settings);
 * - structured_helper: changelog_summary (the daily release-notes JSON);
 * - pd_review: pd_review_report (flags a planted ineligible claim);
 * - financial_extraction: timesheet_extraction (known hours and eligibility);
 * - brain_context: chunk_context (Brain contextual retrieval blurbs).
 */
export const EVAL_TASK_KINDS = [
  "seed_batch",
  "section_draft",
  "qa_structured",
  "condense_digest",
  "retrieval_queries",
  "style_classification",
  "changelog_summary",
  "pd_review_report",
  "timesheet_extraction",
  "chunk_context",
] as const;
export type EvalTaskKind = (typeof EVAL_TASK_KINDS)[number];

/** Plain labels for the admin page and the judge. */
export const EVAL_TASK_LABELS: Readonly<Record<EvalTaskKind, string>> = {
  seed_batch: "Idea seeds",
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

/** Tasks whose output the judge grades. QA is scored by its contract only. */
export const JUDGED_EVAL_TASKS: ReadonlySet<EvalTaskKind> = new Set<EvalTaskKind>([
  "seed_batch",
  "section_draft",
  "condense_digest",
  "retrieval_queries",
  "style_classification",
  "changelog_summary",
  "pd_review_report",
  "timesheet_extraction",
  "chunk_context",
]);

/**
 * Price ceiling for a role. Prices are USD per million tokens, the unit
 * OpenRouter's `provider.max_price` takes. `maxCostRatio` bounds a
 * candidate's measured eval cost against the incumbent's on the same eval
 * set, so a model that is cheap per token but spends far more tokens still
 * fails the cost gate.
 */
export type CostCap = {
  maxInputUsdPerMTok: number;
  maxOutputUsdPerMTok: number;
  maxCostRatio: number;
};

export type RolePolicy = {
  label: string;
  description: string;
  defaultModelId: string;
  gateways: readonly ModelGateway[];
  minContextTokens: number;
  minOutputTokens: number;
  /** Whether the daily job may evaluate and switch this role on its own. */
  autoSwitch: boolean;
  /** Why a role never switches on its own (shown on the admin page). */
  manualOnlyReason?: string;
  defaultCostCap: CostCap;
  evalTasks: readonly EvalTaskKind[];
  /** Roles whose model is frozen on each generation at reservation. */
  frozenPerGeneration: boolean;
};

const HAIKU = "claude-haiku-4-5-20251001";

export const ROLE_POLICIES: Readonly<Record<ModelRole, RolePolicy>> = {
  writing: {
    label: "Writing",
    description: "Default model for report generation, seeds and redrafts.",
    defaultModelId: MODEL,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 200_000,
    minOutputTokens: 32_000,
    autoSwitch: true,
    defaultCostCap: { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 30, maxCostRatio: 2 },
    evalTasks: ["seed_batch", "section_draft", "qa_structured"],
    frozenPerGeneration: true,
  },
  structured_helper: {
    label: "Release notes",
    description: "The daily changelog summary for writers.",
    defaultModelId: HAIKU,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 128_000,
    minOutputTokens: 8_000,
    autoSwitch: true,
    defaultCostCap: { maxInputUsdPerMTok: 1.5, maxOutputUsdPerMTok: 8, maxCostRatio: 2 },
    evalTasks: ["changelog_summary"],
    frozenPerGeneration: false,
  },
  chat: {
    label: "Chat",
    description: "The report chat assistant.",
    defaultModelId: MODEL,
    // The chat agent streams through the AI SDK's Anthropic provider with
    // Anthropic thinking and cache controls, so only direct Anthropic models
    // can serve it. No eval covers streamed tool turns, so it never switches
    // on its own.
    gateways: ["anthropic"],
    minContextTokens: 200_000,
    minOutputTokens: 16_000,
    autoSwitch: false,
    manualOnlyReason:
      "Chat streams tool calls through Anthropic's own provider and no evaluation covers a streamed chat turn yet, so an admin chooses its model.",
    defaultCostCap: { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 25, maxCostRatio: 2 },
    evalTasks: [],
    frozenPerGeneration: false,
  },
  condense: {
    label: "Condense",
    description: "Condenses long transcripts into digests before drafting.",
    defaultModelId: MODEL,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 128_000,
    minOutputTokens: 16_000,
    autoSwitch: true,
    defaultCostCap: { maxInputUsdPerMTok: 3, maxOutputUsdPerMTok: 15, maxCostRatio: 2 },
    evalTasks: ["condense_digest"],
    frozenPerGeneration: true,
  },
  retrieval_brief: {
    label: "Retrieval brief",
    description: "Turns a transcript into Brain search queries.",
    defaultModelId: HAIKU,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 128_000,
    minOutputTokens: 4_000,
    autoSwitch: true,
    defaultCostCap: { maxInputUsdPerMTok: 1.5, maxOutputUsdPerMTok: 8, maxCostRatio: 2 },
    evalTasks: ["retrieval_queries"],
    frozenPerGeneration: true,
  },
  analysis: {
    label: "Style analysis",
    description: "Classifies writer settings documents and saved style instructions.",
    defaultModelId: MODEL,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 200_000,
    minOutputTokens: 16_000,
    autoSwitch: true,
    defaultCostCap: { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 25, maxCostRatio: 2 },
    evalTasks: ["style_classification"],
    frozenPerGeneration: true,
  },
  pd_review: {
    label: "PD review",
    description: "Structured feedback on an uploaded, externally written PD.",
    defaultModelId: MODEL,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 200_000,
    minOutputTokens: 16_000,
    autoSwitch: true,
    defaultCostCap: { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 25, maxCostRatio: 2 },
    evalTasks: ["pd_review_report"],
    frozenPerGeneration: false,
  },
  financial_extraction: {
    label: "Timesheet extraction",
    description: "Reconstructs timesheets from uploaded chat, commit or spreadsheet data.",
    defaultModelId: MODEL,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 200_000,
    minOutputTokens: 16_000,
    autoSwitch: true,
    defaultCostCap: { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 25, maxCostRatio: 2 },
    evalTasks: ["timesheet_extraction"],
    frozenPerGeneration: false,
  },
  brain_context: {
    label: "Brain context",
    description: "Situates each approved PD chunk before it is embedded in the Brain.",
    defaultModelId: HAIKU,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 128_000,
    minOutputTokens: 4_000,
    autoSwitch: true,
    defaultCostCap: { maxInputUsdPerMTok: 1.5, maxOutputUsdPerMTok: 8, maxCostRatio: 2 },
    evalTasks: ["chunk_context"],
    frozenPerGeneration: false,
  },
  learning_digest: {
    label: "Learning digests",
    description: "Distills writer and QA feedback into learned drafting rules.",
    defaultModelId: MODEL,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 200_000,
    minOutputTokens: 4_000,
    autoSwitch: false,
    manualOnlyReason:
      "No fixed test can tell a good learned rule from a plausible one without real feedback history, so an admin chooses its model.",
    defaultCostCap: { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 25, maxCostRatio: 2 },
    evalTasks: [],
    frozenPerGeneration: false,
  },
  science_code: {
    label: "Science code suggestion",
    description: "Suggests the CRA field of science code for a project.",
    defaultModelId: MODEL,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 200_000,
    minOutputTokens: 1_000,
    autoSwitch: false,
    manualOnlyReason:
      "More than one science code can be right for a project and the writer always confirms it, so no fixture has a single correct answer; an admin chooses its model.",
    defaultCostCap: { maxInputUsdPerMTok: 5, maxOutputUsdPerMTok: 25, maxCostRatio: 2 },
    evalTasks: [],
    frozenPerGeneration: false,
  },
  feedback_summary: {
    label: "Feedback summaries",
    description: "Summarizes writers' comments on each model for this page.",
    defaultModelId: HAIKU,
    gateways: ["anthropic", "openrouter"],
    minContextTokens: 128_000,
    minOutputTokens: 1_000,
    autoSwitch: false,
    manualOnlyReason:
      "An admin-only summary with no fixed right answer; an admin chooses its model.",
    defaultCostCap: { maxInputUsdPerMTok: 1.5, maxOutputUsdPerMTok: 8, maxCostRatio: 2 },
    evalTasks: [],
    frozenPerGeneration: false,
  },
};

/**
 * A role switches on its own only when the policy allows it AND it has its
 * own evaluation task. A role without one stays candidate-only: its
 * evaluations never run and it is never promoted automatically.
 */
export function roleAutoSwitches(role: ModelRole): boolean {
  const policy = ROLE_POLICIES[role];
  return policy.autoSwitch && policy.evalTasks.length > 0;
}

// ─── Thresholds ─────────────────────────────────────────────────────────────

export const AUTOMATION_THRESHOLDS = {
  /** A candidate must beat the incumbent's benchmark by this many points. */
  benchmarkMargin: 2,
  /** A candidate's judged rubric (1 to 10) must beat the incumbent's by this. */
  rubricMargin: 0.5,
  /** Every structured call must validate against its schema. */
  requiredSchemaValidity: 1,
  /** At most this many evaluations start per daily run, across all roles. */
  maxEvaluationsPerRun: 2,
  /** Default monthly spend ceiling for evaluations, USD. */
  defaultMonthlyEvalBudgetUsd: 20,
  /** A candidate evaluated for a role is not evaluated again for this long. */
  evaluationCooldownMs: 30 * 24 * 60 * 60 * 1000,
  /** A model whose expiration date is this close is flagged. */
  expiringWithinDays: 30,
  /** Production error rollback: window, minimum calls and error rate. */
  errorWindowMs: 24 * 60 * 60 * 1000,
  errorMinCalls: 20,
  maxErrorRate: 0.2,
  /** A refresh that returns fewer models than this is treated as partial. */
  minPlausibleCatalogSize: 50,
} as const;

export const EVAL_SET_VERSION = "banhall-eval/v1";

// ─── Catalog entries ────────────────────────────────────────────────────────

export type BenchmarkSource = "openrouter_aa" | "artificial_analysis";
export type BenchmarkMetric =
  | "intelligence_index"
  | "coding_index"
  | "agentic_index";

export type Benchmark = {
  source: BenchmarkSource;
  metric: BenchmarkMetric;
  value: number;
  fetchedAt: number;
};

export type CatalogStatus = "candidate" | "enabled" | "retired";

/** The fields of a catalog row this module reads and writes. */
export type CatalogFields = {
  modelId: string;
  gateway: ModelGateway;
  canonicalSlug: string;
  requestId?: string;
  displayName: string;
  provider: string;
  description?: string;
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  cacheReadUsdPerMTok?: number;
  cacheWriteUsdPerMTok?: number;
  cacheWrite1hUsdPerMTok?: number;
  contextLength?: number;
  /** The provider's reported output ceiling. */
  maxOutputTokens?: number;
  /** The output cap requests are clamped to (a declaration for seeds). */
  maxCompletionTokens?: number;
  reasoning: boolean;
  reasoningMandatory?: boolean;
  reasoningEfforts: string[];
  supportsTools: boolean;
  supportsToolChoice: boolean;
  supportsStructuredOutputs: boolean;
  supportsReasoning: boolean;
  expirationDate?: string;
  benchmarks: Benchmark[];
};

export type EndpointSupport = {
  checkedAt: number;
  endpointCount: number;
  /** Providers serving the model with both tools and structured outputs. */
  toolsAndStructuredProviders: string[];
};

export type CatalogModel = CatalogFields & {
  status: CatalogStatus;
  source: "seed" | "openrouter";
  firstSeenAt: number;
  lastSeenAt: number;
  missingSince?: number;
  renamedFrom?: string;
  endpointSupport?: EndpointSupport;
};

/**
 * OpenRouter canonical slugs for the seed models, read from the 2026-09-24
 * catalog. Direct Anthropic models map to their OpenRouter listing so the
 * daily refresh can attach benchmark scores and expiration dates to them.
 */
export const SEED_CANONICAL_SLUGS: Readonly<Record<string, string>> = {
  "claude-sonnet-5": "anthropic/claude-sonnet-5-20260630",
  "claude-opus-4-8": "anthropic/claude-4.8-opus-20260528",
  "claude-haiku-4-5-20251001": "anthropic/claude-4.5-haiku-20251001",
  "openai/gpt-5.6-sol": "openai/gpt-5.6-sol-20260709",
  "openai/gpt-5.6-luna": "openai/gpt-5.6-luna-20260709",
  "google/gemini-3.1-pro-preview": "google/gemini-3.1-pro-preview-20260219",
  "google/gemini-3.5-flash": "google/gemini-3.5-flash-20260519",
};

/** Seed maximum output for direct Anthropic models (published limits). */
const ANTHROPIC_SEED_LIMITS: Readonly<Record<string, { context: number; output: number }>> = {
  "claude-sonnet-5": { context: 1_000_000, output: 128_000 },
  "claude-opus-4-8": { context: 1_000_000, output: 128_000 },
  "claude-haiku-4-5-20251001": { context: 200_000, output: 64_000 },
};

/**
 * The catalog rows the table starts from: today's `CANDIDATE_MODELS`, all
 * enabled, with their reasoning and max-output declarations kept exactly.
 */
export function seedCatalogModels(now: number): CatalogModel[] {
  return CANDIDATE_MODELS.map((seed) => {
    const entry = seed as ModelEntry;
    const pricing = pricingFor(entry.id);
    const limits = ANTHROPIC_SEED_LIMITS[entry.id];
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    return {
      modelId: entry.id,
      gateway: entry.gateway,
      canonicalSlug: SEED_CANONICAL_SLUGS[entry.id] ?? entry.id,
      displayName: entry.label,
      provider: entry.provider,
      ...(entry.description ? { description: entry.description } : {}),
      ...(pricing
        ? {
            inputUsdPerMTok: pricing.input,
            outputUsdPerMTok: pricing.output,
            cacheReadUsdPerMTok: round(pricing.input * pricing.cacheReadMultiplier),
            ...(pricing.cacheWrite5mMultiplier > 0
              ? { cacheWriteUsdPerMTok: round(pricing.input * pricing.cacheWrite5mMultiplier) }
              : {}),
            ...(pricing.cacheWrite1hMultiplier > 0
              ? { cacheWrite1hUsdPerMTok: round(pricing.input * pricing.cacheWrite1hMultiplier) }
              : {}),
          }
        : {}),
      ...(limits ? { contextLength: limits.context, maxOutputTokens: limits.output } : {}),
      ...(entry.maxCompletionTokens !== undefined
        ? { maxCompletionTokens: entry.maxCompletionTokens, maxOutputTokens: entry.maxCompletionTokens }
        : {}),
      reasoning: entry.reasoning === true,
      reasoningEfforts: [],
      supportsTools: true,
      supportsToolChoice: true,
      supportsStructuredOutputs: true,
      supportsReasoning: entry.reasoning === true,
      benchmarks: [],
      status: "enabled",
      source: "seed",
      firstSeenAt: now,
      lastSeenAt: now,
    };
  });
}

/** The runtime entry a catalog row resolves to. */
export function entryFromCatalog(
  row: Pick<
    CatalogModel,
    | "modelId"
    | "displayName"
    | "provider"
    | "gateway"
    | "description"
    | "reasoning"
    | "maxCompletionTokens"
    | "requestId"
  >
): ModelEntry {
  return {
    id: row.modelId,
    label: row.displayName,
    provider: row.provider,
    gateway: row.gateway,
    ...(row.description ? { description: row.description } : {}),
    reasoning: row.reasoning,
    ...(row.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: row.maxCompletionTokens }
      : {}),
    ...(row.requestId && row.requestId !== row.modelId
      ? { requestId: row.requestId }
      : {}),
  };
}

// ─── OpenRouter catalog parsing ─────────────────────────────────────────────

export type ParsedModel = CatalogFields & { openRouterId: string };

export type ParseResult = {
  models: ParsedModel[];
  skipped: { alias: number; variant: number; notText: number; invalid: number };
};

type RawModel = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** USD per token as OpenRouter's string, to USD per million tokens. */
export function perMillion(value: unknown): number | undefined {
  const parsed =
    typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * 1e6 * 1e6) / 1e6;
}

const positiveInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** "OpenAI: GPT-5.6 Sol" -> provider "OpenAI", label "GPT-5.6 Sol". */
export function splitModelName(name: string, id: string): { provider: string; label: string } {
  const colon = name.indexOf(": ");
  if (colon > 0) {
    return { provider: name.slice(0, colon).trim(), label: name.slice(colon + 2).trim() };
  }
  const vendor = id.split("/")[0] ?? id;
  return {
    provider: vendor.charAt(0).toUpperCase() + vendor.slice(1),
    label: name.trim() || id,
  };
}

/**
 * An alias (`~vendor/model-latest`, or any row with `alias_target`) moves
 * underneath us, so it is never stored or pinned. A `:variant` id (`:batch`,
 * `:free`, `:thinking`) shares its canonical slug with the base model and
 * is skipped in favour of the base id.
 */
export function openRouterIdKind(model: RawModel): "alias" | "variant" | "model" {
  const id = typeof model.id === "string" ? model.id : "";
  if (id.startsWith("~") || isRecord(model.alias_target)) return "alias";
  if (id.includes(":")) return "variant";
  return "model";
}

function aaBenchmarks(model: RawModel, fetchedAt: number): Benchmark[] {
  const benchmarks = isRecord(model.benchmarks) ? model.benchmarks : undefined;
  const aa = benchmarks && isRecord(benchmarks.artificial_analysis)
    ? benchmarks.artificial_analysis
    : undefined;
  if (!aa) return [];
  const metrics: BenchmarkMetric[] = ["intelligence_index", "coding_index", "agentic_index"];
  return metrics.flatMap((metric) => {
    const value = aa[metric];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ source: "openrouter_aa" as const, metric, value, fetchedAt }]
      : [];
  });
}

export function parseOpenRouterModel(model: RawModel, fetchedAt: number): ParsedModel | null {
  const id = typeof model.id === "string" ? model.id.trim() : "";
  if (!id) return null;
  const canonicalSlug =
    typeof model.canonical_slug === "string" && model.canonical_slug.trim()
      ? model.canonical_slug.trim()
      : id;
  const name = typeof model.name === "string" ? model.name : id;
  const { provider, label } = splitModelName(name, id);
  const pricing = isRecord(model.pricing) ? model.pricing : {};
  const topProvider = isRecord(model.top_provider) ? model.top_provider : {};
  const params = stringArray(model.supported_parameters);
  const reasoning = isRecord(model.reasoning) ? model.reasoning : undefined;
  const supportsReasoning = params.includes("reasoning") || reasoning !== undefined;
  const maxOutput = positiveInt(topProvider.max_completion_tokens);
  const expiration =
    typeof model.expiration_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(model.expiration_date)
      ? model.expiration_date.slice(0, 10)
      : undefined;
  const description =
    typeof model.description === "string" && model.description.trim()
      ? model.description.trim().slice(0, 280)
      : undefined;
  const fields: ParsedModel = {
    openRouterId: id,
    modelId: id,
    gateway: "openrouter",
    canonicalSlug,
    displayName: label,
    provider,
    ...(description ? { description } : {}),
    reasoning: supportsReasoning,
    ...(reasoning?.mandatory === true ? { reasoningMandatory: true } : {}),
    reasoningEfforts: stringArray(reasoning?.supported_efforts),
    supportsTools: params.includes("tools"),
    supportsToolChoice: params.includes("tool_choice"),
    supportsStructuredOutputs:
      params.includes("structured_outputs") || params.includes("response_format"),
    supportsReasoning,
    benchmarks: aaBenchmarks(model, fetchedAt),
    ...(expiration ? { expirationDate: expiration } : {}),
  };
  const input = perMillion(pricing.prompt);
  const output = perMillion(pricing.completion);
  const cacheRead = perMillion(pricing.input_cache_read);
  const cacheWrite = perMillion(pricing.input_cache_write);
  const cacheWrite1h = perMillion(pricing.input_cache_write_1h);
  if (input !== undefined) fields.inputUsdPerMTok = input;
  if (output !== undefined) fields.outputUsdPerMTok = output;
  if (cacheRead !== undefined) fields.cacheReadUsdPerMTok = cacheRead;
  if (cacheWrite !== undefined) fields.cacheWriteUsdPerMTok = cacheWrite;
  if (cacheWrite1h !== undefined) fields.cacheWrite1hUsdPerMTok = cacheWrite1h;
  const context = positiveInt(model.context_length) ?? positiveInt(topProvider.context_length);
  if (context !== undefined) fields.contextLength = context;
  if (maxOutput !== undefined) {
    fields.maxOutputTokens = maxOutput;
    fields.maxCompletionTokens = maxOutput;
  }
  return fields;
}

/** Parse OpenRouter's `GET /api/v1/models` body. */
export function parseOpenRouterModels(body: unknown, fetchedAt: number): ParseResult {
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  const skipped = { alias: 0, variant: 0, notText: 0, invalid: 0 };
  const byCanonical = new Map<string, ParsedModel>();
  for (const raw of data) {
    if (!isRecord(raw)) {
      skipped.invalid += 1;
      continue;
    }
    const kind = openRouterIdKind(raw);
    if (kind === "alias") {
      skipped.alias += 1;
      continue;
    }
    if (kind === "variant") {
      skipped.variant += 1;
      continue;
    }
    const architecture = isRecord(raw.architecture) ? raw.architecture : {};
    const outputs = stringArray(architecture.output_modalities);
    const inputs = stringArray(architecture.input_modalities);
    if (
      (outputs.length > 0 && !outputs.includes("text")) ||
      (inputs.length > 0 && !inputs.includes("text"))
    ) {
      skipped.notText += 1;
      continue;
    }
    const parsed = parseOpenRouterModel(raw, fetchedAt);
    if (!parsed) {
      skipped.invalid += 1;
      continue;
    }
    // Two base ids on one canonical slug: keep the first, which is the
    // catalog's own ordering (newest first) and never a variant.
    if (!byCanonical.has(parsed.canonicalSlug)) byCanonical.set(parsed.canonicalSlug, parsed);
  }
  return { models: [...byCanonical.values()], skipped };
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

/** Parse `GET /api/v1/models/{slug}/endpoints` into per-provider support. */
export function parseEndpointSupport(body: unknown, checkedAt: number): EndpointSupport {
  const data = isRecord(body) && isRecord(body.data) ? body.data : undefined;
  const endpoints = data && Array.isArray(data.endpoints) ? data.endpoints : [];
  const providers = new Set<string>();
  let endpointCount = 0;
  for (const endpoint of endpoints) {
    if (!isRecord(endpoint)) continue;
    endpointCount += 1;
    const params = stringArray(endpoint.supported_parameters);
    const tools = params.includes("tools");
    const structured =
      params.includes("structured_outputs") || params.includes("response_format");
    const status = typeof endpoint.status === "number" ? endpoint.status : 0;
    if (tools && structured && status >= 0) {
      const name =
        typeof endpoint.provider_name === "string"
          ? endpoint.provider_name
          : typeof endpoint.name === "string"
            ? endpoint.name
            : "unknown";
      providers.add(name);
    }
  }
  return {
    checkedAt,
    endpointCount,
    toolsAndStructuredProviders: [...providers].sort().slice(0, 20),
  };
}

// ─── Artificial Analysis (optional, AA_API_KEY) ─────────────────────────────

/** Lower-case alphanumerics only, vendor prefix and date suffix removed. */
export function normalizeModelName(value: string): string {
  const withoutVendor = value.includes("/") ? value.slice(value.indexOf("/") + 1) : value;
  const withoutColon = withoutVendor.includes(": ")
    ? withoutVendor.slice(withoutVendor.indexOf(": ") + 2)
    : withoutVendor;
  return withoutColon
    .toLowerCase()
    .replace(/-?\d{8}$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Index Artificial Analysis `/api/v2/data/llms/models` rows by normalized
 * slug and name. Only the intelligence index is read.
 */
export function parseArtificialAnalysis(body: unknown): Map<string, number> {
  const data = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  const index = new Map<string, number>();
  for (const row of data) {
    if (!isRecord(row)) continue;
    const evaluations = isRecord(row.evaluations) ? row.evaluations : {};
    const value = evaluations.artificial_analysis_intelligence_index;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    for (const key of [row.slug, row.name]) {
      if (typeof key === "string" && key.trim()) {
        const normalized = normalizeModelName(key);
        if (normalized && !index.has(normalized)) index.set(normalized, value);
      }
    }
  }
  return index;
}

export function artificialAnalysisScore(
  model: Pick<CatalogFields, "modelId" | "displayName">,
  index: ReadonlyMap<string, number>
): number | undefined {
  return (
    index.get(normalizeModelName(model.modelId)) ??
    index.get(normalizeModelName(model.displayName))
  );
}

/**
 * The best available intelligence score: the Artificial Analysis API when
 * present, else the Artificial Analysis index OpenRouter embeds.
 */
export function bestIntelligenceScore(
  benchmarks: readonly Benchmark[]
): { value: number; source: BenchmarkSource } | null {
  const pick = (source: BenchmarkSource) =>
    benchmarks.find(
      (benchmark) => benchmark.source === source && benchmark.metric === "intelligence_index"
    );
  const found = pick("artificial_analysis") ?? pick("openrouter_aa");
  return found ? { value: found.value, source: found.source } : null;
}

// ─── Diffing ────────────────────────────────────────────────────────────────

export type ExistingCatalogRow = Pick<
  CatalogModel,
  "modelId" | "gateway" | "canonicalSlug" | "requestId" | "status" | "missingSince" | "expirationDate"
>;

export type CatalogChange =
  | { kind: "new"; model: ParsedModel }
  | { kind: "update"; modelId: string; model: ParsedModel }
  | { kind: "renamed"; modelId: string; fromId: string; toId: string }
  | { kind: "expiring"; modelId: string; expirationDate: string; daysLeft: number }
  | { kind: "gone"; modelId: string }
  | { kind: "returned"; modelId: string };

export function daysUntil(date: string, now: number): number {
  const at = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(at) ? Math.ceil((at - now) / 86_400_000) : Infinity;
}

export function isExpiringSoon(date: string | undefined, now: number): boolean {
  return date !== undefined && daysUntil(date, now) <= AUTOMATION_THRESHOLDS.expiringWithinDays;
}

/**
 * Compare the stored catalog with a fresh OpenRouter pull. Rows are matched
 * on the canonical slug, which OpenRouter never changes. Direct Anthropic
 * rows borrow the matching OpenRouter listing for scores and expiry but are
 * never "gone": OpenRouter does not serve them.
 *
 * New rows are only proposed for models that support tool calls, the one
 * capability every Banhall call path needs.
 */
export function diffCatalog(
  existing: readonly ExistingCatalogRow[],
  fetched: readonly ParsedModel[],
  now: number
): CatalogChange[] {
  const changes: CatalogChange[] = [];
  const fetchedBySlug = new Map(fetched.map((model) => [model.canonicalSlug, model]));
  const fetchedById = new Map(fetched.map((model) => [model.openRouterId, model]));
  // Canonical slugs of fetched models an OpenRouter row already accounts
  // for, by slug or by id, so none of them is proposed as new.
  const matchedSlugs = new Set<string>();
  for (const row of existing) {
    const currentId = row.requestId ?? row.modelId;
    // Match on the canonical slug first. When the recorded slug drifted but
    // the model is still listed under the same id, adopt it by id: it is the
    // same model, never "gone" (review finding 10).
    const model =
      fetchedBySlug.get(row.canonicalSlug) ??
      (row.gateway === "openrouter"
        ? (fetchedById.get(currentId) ?? fetchedById.get(row.modelId))
        : undefined);
    if (!model) {
      if (row.gateway === "openrouter" && row.missingSince === undefined) {
        changes.push({ kind: "gone", modelId: row.modelId });
      }
      continue;
    }
    if (row.gateway === "openrouter") matchedSlugs.add(model.canonicalSlug);
    changes.push({ kind: "update", modelId: row.modelId, model });
    if (row.missingSince !== undefined) {
      changes.push({ kind: "returned", modelId: row.modelId });
    }
    if (row.gateway === "openrouter" && model.openRouterId !== currentId) {
      changes.push({
        kind: "renamed",
        modelId: row.modelId,
        fromId: currentId,
        toId: model.openRouterId,
      });
    }
    if (model.expirationDate && isExpiringSoon(model.expirationDate, now)) {
      changes.push({
        kind: "expiring",
        modelId: row.modelId,
        expirationDate: model.expirationDate,
        daysLeft: daysUntil(model.expirationDate, now),
      });
    }
  }
  for (const model of fetched) {
    if (matchedSlugs.has(model.canonicalSlug)) continue;
    if (!model.supportsTools) continue;
    changes.push({ kind: "new", model });
  }
  return changes;
}

/**
 * The catalog fields a refresh writes onto an existing row. A seed row keeps
 * its reasoning and max-output declarations, its label and its app-facing
 * id; the rest follows the provider.
 */
export function refreshedFields(
  row: Pick<CatalogModel, "source" | "gateway" | "modelId">,
  model: ParsedModel
): Partial<CatalogFields> {
  const {
    openRouterId,
    modelId: _modelId,
    gateway: _gateway,
    reasoning,
    maxCompletionTokens,
    displayName,
    provider,
    description,
    ...rest
  } = model;
  void _modelId;
  void _gateway;
  const refreshed: Partial<CatalogFields> = { ...rest };
  if (row.source !== "seed") {
    refreshed.reasoning = reasoning;
    if (maxCompletionTokens !== undefined) refreshed.maxCompletionTokens = maxCompletionTokens;
    refreshed.displayName = displayName;
    refreshed.provider = provider;
    if (description) refreshed.description = description;
  }
  if (row.gateway === "openrouter") {
    refreshed.requestId = openRouterId;
  } else {
    // Direct Anthropic rows are priced and limited by Anthropic, not by the
    // OpenRouter listing they borrow scores from.
    delete refreshed.inputUsdPerMTok;
    delete refreshed.outputUsdPerMTok;
    delete refreshed.cacheReadUsdPerMTok;
    delete refreshed.cacheWriteUsdPerMTok;
    delete refreshed.cacheWrite1hUsdPerMTok;
    delete refreshed.contextLength;
    delete refreshed.maxOutputTokens;
    delete refreshed.supportsTools;
    delete refreshed.supportsToolChoice;
    delete refreshed.supportsStructuredOutputs;
  }
  return refreshed;
}

// ─── Prefilter ──────────────────────────────────────────────────────────────

export type PrefilterModel = Pick<
  CatalogModel,
  | "modelId"
  | "gateway"
  | "status"
  | "inputUsdPerMTok"
  | "outputUsdPerMTok"
  | "contextLength"
  | "maxOutputTokens"
  | "supportsTools"
  | "supportsStructuredOutputs"
  | "endpointSupport"
  | "expirationDate"
  | "benchmarks"
  | "missingSince"
>;

export type PrefilterResult = {
  ok: boolean;
  reasons: string[];
  score: number | null;
  incumbentScore: number | null;
};

/**
 * Cheap paper checks before any money is spent on an evaluation. Every
 * failing rule is reported, so the admin page can say why a model that looks
 * strong was not tried.
 */
export function prefilterCandidate(args: {
  role: ModelRole;
  candidate: PrefilterModel;
  incumbent: PrefilterModel | null;
  cap: CostCap;
  now: number;
  /** Evaluated for this role inside the cooldown, or rolled back from it. */
  blocked?: boolean;
}): PrefilterResult {
  const { candidate, incumbent, cap, now } = args;
  const policy = ROLE_POLICIES[args.role];
  const reasons: string[] = [];
  if (candidate.modelId === incumbent?.modelId) reasons.push("already the role's model");
  if (candidate.status === "retired" || candidate.missingSince !== undefined) {
    reasons.push("no longer listed");
  }
  if (isExpiringSoon(candidate.expirationDate, now)) reasons.push("expires within 30 days");
  if (!policy.gateways.includes(candidate.gateway)) reasons.push("gateway not allowed for role");
  if (!candidate.supportsTools || !candidate.supportsStructuredOutputs) {
    reasons.push("missing tools or structured outputs");
  }
  if (
    candidate.endpointSupport &&
    candidate.endpointSupport.toolsAndStructuredProviders.length === 0
  ) {
    reasons.push("no endpoint serves tools and structured outputs");
  }
  if ((candidate.contextLength ?? 0) < policy.minContextTokens) reasons.push("context too small");
  if ((candidate.maxOutputTokens ?? 0) < policy.minOutputTokens) reasons.push("output limit too small");
  if (
    candidate.inputUsdPerMTok === undefined ||
    candidate.outputUsdPerMTok === undefined
  ) {
    reasons.push("price unknown");
  } else if (
    candidate.inputUsdPerMTok > cap.maxInputUsdPerMTok ||
    candidate.outputUsdPerMTok > cap.maxOutputUsdPerMTok
  ) {
    reasons.push("over the role's price cap");
  }
  const score = bestIntelligenceScore(candidate.benchmarks)?.value ?? null;
  const incumbentScore = incumbent
    ? (bestIntelligenceScore(incumbent.benchmarks)?.value ?? null)
    : null;
  if (score === null) reasons.push("no benchmark score");
  else if (incumbentScore === null) reasons.push("current model has no benchmark score");
  else if (score < incumbentScore + AUTOMATION_THRESHOLDS.benchmarkMargin) {
    reasons.push("benchmark not better by the margin");
  }
  if (args.blocked) reasons.push("evaluated recently or rolled back");
  return { ok: reasons.length === 0, reasons, score, incumbentScore };
}

/** Eval token volume assumed when estimating what an evaluation will cost. */
export const EVAL_TOKEN_ESTIMATE = { input: 60_000, output: 12_000 } as const;

/**
 * Estimated USD for one evaluation: candidate and incumbent over the eval
 * set plus the judge. Reasoning models are assumed to spend twice the output.
 */
export function estimateEvaluationCostUsd(
  models: Array<Pick<CatalogModel, "inputUsdPerMTok" | "outputUsdPerMTok" | "reasoning">>
): number {
  return models.reduce((total, model) => {
    const input = (model.inputUsdPerMTok ?? 5) * EVAL_TOKEN_ESTIMATE.input;
    const output =
      (model.outputUsdPerMTok ?? 25) *
      EVAL_TOKEN_ESTIMATE.output *
      (model.reasoning ? 2 : 1);
    return total + (input + output) / 1_000_000;
  }, 0);
}

export type EvaluationPlanItem = {
  role: ModelRole;
  modelId: string;
  score: number;
  estimatedCostUsd: number;
};

/**
 * Pick which prefiltered candidates to evaluate this run: best score first,
 * at most `maxPerRun`, and only while the month's remaining eval budget
 * covers the estimate. One candidate per role per run.
 */
export function selectEvaluations(args: {
  eligible: readonly EvaluationPlanItem[];
  budgetRemainingUsd: number;
  maxPerRun?: number;
}): { selected: EvaluationPlanItem[]; deferred: EvaluationPlanItem[] } {
  const maxPerRun = args.maxPerRun ?? AUTOMATION_THRESHOLDS.maxEvaluationsPerRun;
  const ordered = [...args.eligible].sort(
    (a, b) => b.score - a.score || a.estimatedCostUsd - b.estimatedCostUsd
  );
  const selected: EvaluationPlanItem[] = [];
  const deferred: EvaluationPlanItem[] = [];
  const roles = new Set<ModelRole>();
  let remaining = args.budgetRemainingUsd;
  for (const item of ordered) {
    if (
      selected.length < maxPerRun &&
      !roles.has(item.role) &&
      item.estimatedCostUsd <= remaining
    ) {
      selected.push(item);
      roles.add(item.role);
      remaining -= item.estimatedCostUsd;
    } else {
      deferred.push(item);
    }
  }
  return { selected, deferred };
}

// ─── Evaluation scoring and promotion gates ─────────────────────────────────

export type EvalTaskResult = {
  task: EvalTaskKind;
  /** The call used a forced tool with a schema. */
  structured: boolean;
  /** The tool output parsed and matched its schema. */
  schemaValid: boolean;
  /** The task's own contract (seed contract, QA shape); undefined if none. */
  contractPassed?: boolean;
  /** Judge rubric, 1 to 10; undefined when no valid grade came back. */
  rubricScore?: number;
  costUsd: number;
  error?: string;
};

export type EvalSummary = {
  schemaValidity: number;
  contractPassRate: number;
  rubricScore: number;
  costUsd: number;
  tasks: number;
};

export function summarizeEvalRun(results: readonly EvalTaskResult[]): EvalSummary {
  const structured = results.filter((result) => result.structured);
  const contracts = results.filter((result) => result.contractPassed !== undefined);
  const rubrics = results
    .map((result) => result.rubricScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const ratio = (passed: number, total: number) => (total === 0 ? 0 : passed / total);
  return {
    schemaValidity: ratio(
      structured.filter((result) => result.schemaValid).length,
      structured.length
    ),
    contractPassRate: ratio(
      contracts.filter((result) => result.contractPassed).length,
      contracts.length
    ),
    rubricScore:
      rubrics.length === 0 ? 0 : rubrics.reduce((sum, score) => sum + score, 0) / rubrics.length,
    costUsd: results.reduce((sum, result) => sum + (result.costUsd || 0), 0),
    tasks: results.length,
  };
}

/** A judge grade is usable only as a number from 1 to 10. */
export function isValidGrade(score: unknown): score is number {
  return typeof score === "number" && Number.isFinite(score) && score >= 1 && score <= 10;
}

/**
 * Every judged task of the role must carry a valid grade on BOTH sides, or
 * the evaluation is incomplete and never promotes (review finding 2): a
 * failed judge call on one side would otherwise hand the other side a free
 * rubric win, and a partial failure would compare different task sets.
 * Returns the missing grades as "candidate section_draft" and so on.
 */
export function missingJudgeGrades(args: {
  tasks: readonly EvalTaskKind[];
  candidate: readonly EvalTaskResult[];
  incumbent: readonly EvalTaskResult[];
}): string[] {
  const missing: string[] = [];
  for (const [side, results] of [
    ["candidate", args.candidate],
    ["incumbent", args.incumbent],
  ] as const) {
    for (const task of args.tasks) {
      if (!JUDGED_EVAL_TASKS.has(task)) continue;
      const result = results.find((item) => item.task === task);
      if (!result || !isValidGrade(result.rubricScore)) missing.push(`${side} ${task}`);
    }
  }
  return missing;
}

// ─── Evaluation spending ceiling ────────────────────────────────────────────

/**
 * The most one kind of evaluation request can cost: how many requests it
 * makes at most (repairs included), a conservative input size, the answer
 * budget per gateway as the call site asks for it, and whether the gateway
 * keeps that budget as is (seeds) or adds reasoning headroom.
 */
export type EvalRequestBound = {
  requests: number;
  maxInputTokens: number;
  answerTokens: Record<ModelGateway, number>;
  preserveMaxTokens: boolean;
};

export type EvalEnvelope = Record<EvalTaskKind | "judge", EvalRequestBound>;

export type PricedModel = {
  gateway: ModelGateway;
  reasoning: boolean;
  maxCompletionTokens?: number;
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
};

/** Prices assumed for a model whose price is unknown: deliberately high. */
export const UNKNOWN_EVAL_PRICE = { inputUsdPerMTok: 30, outputUsdPerMTok: 150 } as const;

/**
 * The max_tokens a request actually carries: OpenRouter scales a reasoning
 * model's budget by the reasoning multiplier (capped by its output limit)
 * unless the call preserves it; direct Anthropic calls send it as is.
 */
export function maxRequestOutputTokens(model: PricedModel, bound: EvalRequestBound): number {
  const answer = bound.answerTokens[model.gateway];
  if (bound.preserveMaxTokens || !model.reasoning || model.gateway !== "openrouter") {
    return answer;
  }
  const scaled = answer * REASONING_TOKEN_MULTIPLIER;
  return model.maxCompletionTokens ? Math.min(scaled, model.maxCompletionTokens) : scaled;
}

function boundCostUsd(model: PricedModel, bound: EvalRequestBound): number {
  const input = model.inputUsdPerMTok ?? UNKNOWN_EVAL_PRICE.inputUsdPerMTok;
  const output = model.outputUsdPerMTok ?? UNKNOWN_EVAL_PRICE.outputUsdPerMTok;
  return (
    (bound.requests *
      (bound.maxInputTokens * input + maxRequestOutputTokens(model, bound) * output)) /
    1_000_000
  );
}

/**
 * The most an evaluation can spend: both models on every task at their
 * full request envelope (repairs included) plus one judge call per judged
 * task per side. Reserved against the monthly budget at claim time and
 * released down to the actual spend afterwards (review finding 7).
 */
export function maxEvaluationCostUsd(args: {
  tasks: readonly EvalTaskKind[];
  envelope: EvalEnvelope;
  candidate: PricedModel;
  incumbent: PricedModel;
  judge: PricedModel;
}): number {
  let total = 0;
  for (const model of [args.candidate, args.incumbent]) {
    for (const task of args.tasks) {
      total += boundCostUsd(model, args.envelope[task]);
      if (JUDGED_EVAL_TASKS.has(task)) total += boundCostUsd(args.judge, args.envelope.judge);
    }
  }
  return total;
}

export type GateName = "schema_validity" | "contract_pass_rate" | "rubric" | "cost";
export type GateResult = { gate: GateName; passed: boolean; detail: string };

const fmt = (value: number, digits = 2) => value.toFixed(digits);

/**
 * The owner's promotion rule: every gate must pass.
 * - schema validity: 100 percent of structured calls valid;
 * - contract pass rate: at least the incumbent's;
 * - rubric: at least the incumbent's plus the margin;
 * - cost: per-token prices within the role cap and the measured eval cost
 *   within `maxCostRatio` times the incumbent's.
 */
export function promotionGates(args: {
  candidate: EvalSummary;
  incumbent: EvalSummary;
  candidatePrices: Pick<CatalogModel, "inputUsdPerMTok" | "outputUsdPerMTok">;
  cap: CostCap;
}): { passed: boolean; gates: GateResult[] } {
  const { candidate, incumbent, candidatePrices, cap } = args;
  const withinPrice =
    candidatePrices.inputUsdPerMTok !== undefined &&
    candidatePrices.outputUsdPerMTok !== undefined &&
    candidatePrices.inputUsdPerMTok <= cap.maxInputUsdPerMTok &&
    candidatePrices.outputUsdPerMTok <= cap.maxOutputUsdPerMTok;
  const costLimit = incumbent.costUsd * cap.maxCostRatio;
  const withinCost = candidate.costUsd <= costLimit || incumbent.costUsd === 0;
  const gates: GateResult[] = [
    {
      gate: "schema_validity",
      passed: candidate.schemaValidity >= AUTOMATION_THRESHOLDS.requiredSchemaValidity,
      detail: `${fmt(candidate.schemaValidity * 100, 0)} percent valid (needs 100)`,
    },
    {
      gate: "contract_pass_rate",
      passed: candidate.contractPassRate >= incumbent.contractPassRate,
      detail: `${fmt(candidate.contractPassRate * 100, 0)} percent vs ${fmt(incumbent.contractPassRate * 100, 0)} percent`,
    },
    {
      gate: "rubric",
      passed:
        candidate.rubricScore >= incumbent.rubricScore + AUTOMATION_THRESHOLDS.rubricMargin,
      detail: `${fmt(candidate.rubricScore, 1)} vs ${fmt(incumbent.rubricScore, 1)} (needs +${AUTOMATION_THRESHOLDS.rubricMargin})`,
    },
    {
      gate: "cost",
      passed: withinPrice && withinCost,
      detail: withinPrice
        ? `eval cost $${fmt(candidate.costUsd, 4)} vs limit $${fmt(costLimit, 4)}`
        : "price over the role's cap",
    },
  ];
  return { passed: gates.every((gate) => gate.passed), gates };
}

// ─── Production error rollback ──────────────────────────────────────────────

export type ErrorVerdict = {
  rollback: boolean;
  calls: number;
  failures: number;
  errorRate: number;
};

/**
 * A role's model is rolled back when, over the window, at least
 * `errorMinCalls` calls were attempted and more than `maxErrorRate` of them
 * failed. Successes come from aiUsage; failures from modelCallFailures.
 */
export function productionErrorVerdict(args: {
  successes: number;
  failures: number;
  minCalls?: number;
  maxErrorRate?: number;
}): ErrorVerdict {
  const minCalls = args.minCalls ?? AUTOMATION_THRESHOLDS.errorMinCalls;
  const maxErrorRate = args.maxErrorRate ?? AUTOMATION_THRESHOLDS.maxErrorRate;
  const calls = Math.max(0, args.successes) + Math.max(0, args.failures);
  const errorRate = calls === 0 ? 0 : Math.max(0, args.failures) / calls;
  return {
    rollback: calls >= minCalls && errorRate > maxErrorRate,
    calls,
    failures: Math.max(0, args.failures),
    errorRate,
  };
}

// ─── Settings ───────────────────────────────────────────────────────────────

export function parseCostCap(raw: string | undefined, fallback: CostCap): CostCap {
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return fallback;
    const positive = (field: unknown, otherwise: number) =>
      typeof field === "number" && Number.isFinite(field) && field > 0 ? field : otherwise;
    return {
      maxInputUsdPerMTok: positive(value.maxInputUsdPerMTok, fallback.maxInputUsdPerMTok),
      maxOutputUsdPerMTok: positive(value.maxOutputUsdPerMTok, fallback.maxOutputUsdPerMTok),
      maxCostRatio: positive(value.maxCostRatio, fallback.maxCostRatio),
    };
  } catch {
    return fallback;
  }
}

export function validCostCap(cap: CostCap): boolean {
  return [cap.maxInputUsdPerMTok, cap.maxOutputUsdPerMTok, cap.maxCostRatio].every(
    (value) => Number.isFinite(value) && value > 0 && value < 10_000
  );
}

// ─── OpenRouter routing fields ──────────────────────────────────────────────

export type MaxPrice = { prompt: number; completion: number };

export type OpenRouterProviderPreferences = {
  require_parameters?: true;
  max_price?: MaxPrice;
};

/**
 * The max price to send for a model: the role's cap, raised to the model's
 * own listed price when a writer explicitly picked a model above the cap, so
 * the ceiling guards against a costlier endpoint without refusing a model
 * the writer chose.
 */
export function maxPriceFor(
  cap: Pick<CostCap, "maxInputUsdPerMTok" | "maxOutputUsdPerMTok">,
  model: Pick<CatalogFields, "inputUsdPerMTok" | "outputUsdPerMTok">
): MaxPrice {
  return {
    prompt: Math.max(cap.maxInputUsdPerMTok, model.inputUsdPerMTok ?? 0),
    completion: Math.max(cap.maxOutputUsdPerMTok, model.outputUsdPerMTok ?? 0),
  };
}

/**
 * Provider preferences for one OpenRouter request. Tool and structured calls
 * require every parameter they send: model-level `supported_parameters` is a
 * union over endpoints, so without this a request can land on an endpoint
 * that silently drops the tool schema.
 */
export function openRouterProviderPreferences(args: {
  usesTools: boolean;
  maxPrice?: MaxPrice;
}): OpenRouterProviderPreferences | undefined {
  const preferences: OpenRouterProviderPreferences = {};
  if (args.usesTools) preferences.require_parameters = true;
  if (args.maxPrice) preferences.max_price = args.maxPrice;
  return Object.keys(preferences).length > 0 ? preferences : undefined;
}
