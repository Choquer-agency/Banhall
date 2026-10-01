/**
 * Which model, and which request settings, each generation step uses
 * (owner decision 43, 2026-09-25). The model a writer picks writes the
 * report: the Section drafts, their repairs, their compression and the
 * redrafts. The helper steps run on two roles frozen on the generation at
 * reservation: `planning` (transcript analysis, the generation Brief, the
 * seed cards and seed feedback) and `checking` (Self-check, consistency,
 * QA and chronology, inline and after the report).
 *
 * One resolver, keyed by call site, replaces the per-file choices. A
 * generation frozen before step routing (no `stepPolicyVersion` on its
 * freeze) resolves every step to the model it used before, passed in as
 * `legacyModel`, and sends every request unchanged. Pure: queries,
 * mutations and actions all call it.
 */
import { MODEL, entryAlwaysThinks, seedModelById } from "../../shared/generationModels";
import type { ModelFreeze } from "./modelCatalogValidators";

/** Stamped on every freeze written from now on (freezeModelsForGeneration). */
export const GENERATION_STEP_POLICY_VERSION = 1;

export const GENERATION_STEPS = [
  "analyzer",
  "brief",
  "seeds",
  "seedFeedback",
  "section",
  "repair",
  "compression",
  "selfCheck",
  "consistency",
  "qa",
  "chronology",
  "postQa",
  "postChronology",
] as const;
export type GenerationStep = (typeof GENERATION_STEPS)[number];

/** Where a step's model comes from under the current policy. */
export type StepModelSource = "planning" | "checking" | "writer";

export type StepPolicy = {
  source: StepModelSource;
  /** The `generation:*` call-site slot, `<n>` for a T661 line, `<roleId>` for a seed role. */
  callSite: string;
  /**
   * The answer budget the step's request asks for (the request constants in
   * the step's agent; convex/generationStepRouting.sdk.test.ts checks they
   * agree). A model whose thinking is always on is sent four times this on
   * the direct gateway (instrument.ts adaptAnthropicRequest).
   */
  maxTokens: number | "section-answer-token-budget";
  /** Per-attempt request timeout in milliseconds. */
  timeoutMs: number;
  /**
   * `off`: every request of the step is sent `thinking: {type: "disabled"}`,
   * which a model whose thinking is always on turns into low effort on the
   * direct gateway. `low-when-always-thinking`: only such a model is sent it
   * (low effort); every other model's request is unchanged. `as-sent`: the
   * step's own request decides (the Section agents already send it off).
   */
  thinking: "off" | "low-when-always-thinking" | "as-sent";
};

const DEFAULT_TIMEOUT_MS = 240_000;
const SEED_TIMEOUT_MS = 90_000;

/**
 * The step table. Timeouts are the transport's (providers.ts
 * ANTHROPIC_TIMEOUT_MS, SEED_PROVIDER_TIMEOUT_MS); the Summary Self-check
 * asks for more answer room (SUMMARY_PLAN_SELF_CHECK_MAX_TOKENS), and the
 * consistency pass after "Draft the rest" runs on the seed transport (90 s).
 */
export const GENERATION_STEP_POLICY: Readonly<Record<GenerationStep, StepPolicy>> = {
  analyzer: { source: "planning", callSite: "generation:analyzer", maxTokens: 16_000, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  brief: { source: "planning", callSite: "generation:brief", maxTokens: 16_000, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  seeds: { source: "planning", callSite: "generation:seeds:<roleId>", maxTokens: 4_000, timeoutMs: SEED_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  seedFeedback: { source: "planning", callSite: "generation:seedFeedback:<roleId>", maxTokens: 4_000, timeoutMs: SEED_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  section: { source: "writer", callSite: "generation:section:<n>", maxTokens: "section-answer-token-budget", timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "as-sent" },
  repair: { source: "writer", callSite: "generation:repair:<n>", maxTokens: "section-answer-token-budget", timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "as-sent" },
  compression: { source: "writer", callSite: "generation:compression:<n>", maxTokens: 4_096, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "off" },
  selfCheck: { source: "checking", callSite: "generation:selfCheck:<n>", maxTokens: 4_096, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  consistency: { source: "checking", callSite: "generation:consistency", maxTokens: 4_096, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  qa: { source: "checking", callSite: "generation:qa", maxTokens: 4_096, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  chronology: { source: "checking", callSite: "generation:chronology", maxTokens: 4_096, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  postQa: { source: "checking", callSite: "generation:post_qa", maxTokens: 4_096, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "low-when-always-thinking" },
  postChronology: { source: "checking", callSite: "generation:post_chronology", maxTokens: 4_096, timeoutMs: DEFAULT_TIMEOUT_MS, thinking: "low-when-always-thinking" },
};

const STEP_BY_SLOT: Readonly<Record<string, GenerationStep>> = {
  analyzer: "analyzer",
  brief: "brief",
  seeds: "seeds",
  seedFeedback: "seedFeedback",
  section: "section",
  repair: "repair",
  compression: "compression",
  selfCheck: "selfCheck",
  consistency: "consistency",
  qa: "qa",
  chronology: "chronology",
  post_qa: "postQa",
  post_chronology: "postChronology",
};

/**
 * The step a `generation:*` call site belongs to, or null for a call the
 * step table does not route (retrieval brief, condense, facts, settings:
 * each has its own frozen role).
 */
export function generationStepOf(callSite: string): GenerationStep | null {
  if (!callSite.startsWith("generation:")) return null;
  const family = callSite.slice("generation:".length).split(":")[0];
  return STEP_BY_SLOT[family] ?? null;
}

type StepFreeze = Pick<ModelFreeze, "roles" | "entries" | "stepPolicyVersion">;

/** Request fields a step adds to what its agent sends. Empty: sent as is. */
export type StepRequestFields = { thinking?: { type: "disabled" } };

export type StepRoute = {
  step: GenerationStep;
  /** `legacy`: a generation frozen before step routing. */
  source: StepModelSource | "legacy";
  model: string;
  policyVersion: number | null;
  request: StepRequestFields;
};

/** Whether `model`, as frozen on the generation, always thinks. */
function alwaysThinks(freeze: StepFreeze, model: string): boolean {
  const entry = freeze.entries.find((item) => item.id === model) ?? seedModelById(model);
  return entry !== undefined && entryAlwaysThinks(entry);
}

/** The fields `step` adds to a request for `model` under `freeze`. */
export function stepRequestFields(
  freeze: StepFreeze | null | undefined,
  step: GenerationStep,
  model: string
): StepRequestFields {
  if (!freeze || freeze.stepPolicyVersion === undefined) return {};
  const thinking = GENERATION_STEP_POLICY[step].thinking;
  if (thinking === "off") return { thinking: { type: "disabled" } };
  if (thinking === "low-when-always-thinking" && alwaysThinks(freeze, model)) {
    return { thinking: { type: "disabled" } };
  }
  return {};
}

/**
 * The model and request settings of one step of one generation.
 * `writerModel` is the candidate model the writer picked (or was given) for
 * this draft; `legacyModel` is what the call used before step routing, and
 * is what a generation frozen before it keeps (defaults to `writerModel`).
 */
export function resolveGenerationStep(args: {
  freeze: StepFreeze | null | undefined;
  step: GenerationStep;
  writerModel: string;
  legacyModel?: string;
}): StepRoute {
  const { freeze, step } = args;
  if (!freeze || freeze.stepPolicyVersion === undefined) {
    return {
      step,
      source: "legacy",
      model: args.legacyModel ?? args.writerModel,
      policyVersion: null,
      request: {},
    };
  }
  const source = GENERATION_STEP_POLICY[step].source;
  const model =
    source === "writer"
      ? args.writerModel
      : (freeze.roles[source] ?? MODEL);
  return {
    step,
    source,
    model,
    policyVersion: freeze.stepPolicyVersion,
    request: stepRequestFields(freeze, step, model),
  };
}

/** resolveGenerationStep for a `generation:*` call site; throws for one the table does not route. */
export function resolveGenerationCall(args: {
  freeze: StepFreeze | null | undefined;
  callSite: string;
  writerModel: string;
  legacyModel?: string;
}): StepRoute {
  const step = generationStepOf(args.callSite);
  if (!step) throw new Error(`No generation step routes ${args.callSite}`);
  return resolveGenerationStep({ ...args, step });
}
