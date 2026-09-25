"use node";

// Multi-provider routing (Jul 20): Anthropic models call the direct SDK
// (native prompt caching + existing instrumentation); OpenAI/Google models
// route through OpenRouter (convex/ai/openrouter.ts). Both gateways log into
// the same aiUsage table. clientForModel below is the single routing point —
// candidate-path call sites pick their client through it; auxiliary call
// sites (brain, learning, financial, review) stay on instrumentedAnthropic.

import Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import {
  requireAnthropicClientConfig,
  type AnthropicCapability,
} from "../lib/providerConfig";
import {
  OPENROUTER_ANTHROPIC_BASE_URL,
  OPENROUTER_APP_HEADERS,
  isOpenRouterError,
} from "../../shared/anthropicTransport";
import {
  gatewayForModel,
  isKnownModel,
  registerModelEntries,
} from "../../shared/generationModels";
import type { ModelRole } from "../../shared/modelCatalog";
import {
  assertGenerationCallSite,
  instrumentedAnthropic,
  type GenerationAttribution,
  type ProviderCallMeta,
} from "./instrument";
import { COMPRESSION_REQUEST } from "./promptDefinitions";
import { ActionTimeBudgetError, wasStoppedByDeadline } from "./actionDeadline";
import { instrumentedOpenRouter } from "./openrouter";
import {
  MalformedOutputError,
  type GenerationClient,
  type GenerationResponse,
} from "./openrouterCore";
import { entryFromFrozen } from "../lib/modelRoles";
import type { PlaceholderMap } from "../lib/deidentify";
import { withPlaceholders } from "./placeholderClient";
import type { ModelFreeze } from "../lib/modelCatalogValidators";
import {
  generationModelsRef,
  modelEntryForCallRef,
  recordCallOutcomeRef,
  roleModelEntryRef,
} from "../lib/modelCatalogRefs";


// ─── Provider time budget (CAP-6) ────────────────────────────────────────────
// Pinned explicitly rather than trusting SDK defaults: the SDK's default
// 10-minute timeout equals the Convex action limit, so a hung call would
// consume the entire action budget. providers.test.ts proves the budget
// arithmetic over these exact exports; change them together.
//
// The action limit and the reserve live in actionDeadline.ts, which also
// bounds a whole action (2026-09-25, cutoff review P2-2): see below.

export {
  CONVEX_ACTION_LIMIT_MS,
  RESERVED_NON_REQUEST_MS,
  ACTION_TIME_BUDGET_MESSAGE,
  ActionTimeBudgetError,
  startActionDeadline,
} from "./actionDeadline";

/**
 * One retry (two attempts total). Between attempts the SDK sleeps for its own
 * backoff (0.5 s on the first retry, doubling to an 8 s cap, with jitter) or
 * for whatever a provider Retry-After header asks; that sleep is charged to
 * RESERVED_NON_REQUEST_MS, never to the timeout.
 */
export const ANTHROPIC_MAX_RETRIES = 1;

/**
 * Per-attempt timeout. Sized so ONE provider-call slot fits the action limit
 * together with the reserve: (1 + 1) * 240 s + 60 s = 540 s < 600 s.
 *
 * It is deliberately NOT sized for a whole chain of calls (see
 * SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE). Fitting 5 slots x 2 attempts in
 * 10 minutes would need about 54 s per attempt, which is below the real
 * duration of the analyzer call on a large transcript; that would replace a
 * theoretical bound with real timeouts.
 *
 * The chain is bounded per action instead (2026-09-25, cutoff review P2-2):
 * every generation action records a deadline when it starts
 * (startActionDeadline: start + 600 s - RESERVED_NON_REQUEST_MS), and both
 * gateway transports read it before each request, the structured repair
 * included. A request with less than MIN_USEFUL_REQUEST_MS left is not sent
 * and fails with ActionTimeBudgetError; otherwise its timeout is cut to the
 * time left and a transport retry is kept only if every attempt still fits.
 * So every request of the action ends by start + 540 s, and the failure
 * write runs inside the reserve, through the action's own failure handling.
 * The stale-generation reaper (convex/crons.ts: failStaleGenerations) is no
 * longer the recovery path for a chain that runs long; it stays as the
 * backstop for a crash. One gap remains: a provider Retry-After longer than
 * the reserve can still push an Anthropic SDK retry past it.
 */
export const ANTHROPIC_TIMEOUT_MS = 240_000;

/** Seed attempts own their repair envelope, so transport retries stay off. */
export const SEED_PROVIDER_MAX_RETRIES = 0;

/** Per-request deadline for both seed gateways (AD-34). */
export const SEED_PROVIDER_TIMEOUT_MS = 90_000;

/**
 * The seed gateway policy, shared by production seeds and seed evaluations
 * so an evaluation sends exactly the request production sends. OpenRouter
 * keeps the seed answer budget as is (no reasoning headroom). The direct
 * gateway still gives a model whose thinking is always on its thinking room
 * (instrument.ts adaptAnthropicRequest, 2026-09-25); the 90 s timeout, not
 * max_tokens, bounds a seed request's time.
 */
export const SEED_OPENROUTER_OPTIONS = {
  maxRetries: SEED_PROVIDER_MAX_RETRIES,
  timeoutMs: SEED_PROVIDER_TIMEOUT_MS,
  preserveMaxTokens: true,
} as const;
export const SEED_ANTHROPIC_OPTIONS = {
  maxRetries: SEED_PROVIDER_MAX_RETRIES,
  timeout: SEED_PROVIDER_TIMEOUT_MS,
} as const;

/**
 * Worst-case count of provider calls that run one after another in wall time
 * inside a single generateCandidate action (pipeline.ts, runPipelineForModel).
 * Calls that run in parallel share a slot because their wall time overlaps:
 *   1. analyzer (legacy queued payloads only; new fanout shares entry analysis)
 *   2. section drafts 242 / 244 / 246 (Promise.all: one slot)
 *   3. compression pass 1 (compressToFit, parallel across sections: one slot)
 *   4. compression pass 2 (the 0.85 squeeze, parallel across sections: one slot)
 *   5. QA scorecard + chronology (Promise.allSettled: one slot)
 * Slots 3 and 4 only run for sections still over the CRA form limit, so the
 * typical chain is shorter. New candidates have four slots at most, but
 * retain the five-slot bound while legacy queued payloads remain supported.
 *
 * Story 2 (AD-24): single/compare candidates no longer run that chain in one
 * action; each section is its own scheduled action (orderedGeneration.ts
 * generateOrderedSection) whose worst case is ORDERED_SECTION_ACTION_SLOTS:
 * one draft + the compression squeezes + one Self-check + at most one repair
 * = 5, the same bound. Finalize adds consistency + (QA || chronology) = 2.
 * Iterative's one-shot ghost still runs the five-slot chain above. Since
 * 2026-09-25 each of these actions runs under its action deadline (see
 * ANTHROPIC_TIMEOUT_MS): a chain that runs out of time fails its row
 * through the action's own failure handling instead of overrunning the
 * Convex action limit. failStaleGenerations (DW-119) stays as the backstop
 * for an action that dies another way.
 */
export const SEQUENTIAL_CALLS_PER_GENERATE_CANDIDATE = 5;

/** Worst-case sequential provider calls inside one ordered section action. */
export const ORDERED_SECTION_ACTION_SLOTS = {
  section: 1,
  compression: COMPRESSION_REQUEST.squeezes.length,
  selfCheck: 1,
  repair: 1,
} as const;


/**
 * The Anthropic SDK client on the current transport (owner decision 30).
 * Direct is built exactly as before the switch. OpenRouter sends the key as
 * a bearer token with `apiKey: null`: otherwise the SDK would read
 * ANTHROPIC_API_KEY from the environment and send it to OpenRouter as
 * `x-api-key`. Retries and timeouts are the same on both.
 */
export function createAnthropicClient(
  capability: AnthropicCapability,
  options: {
    maxRetries?: number;
    timeout?: number;
  } = {}
): Anthropic {
  const config = requireAnthropicClientConfig(capability);
  if (config.transport === "openrouter") {
    return new Anthropic({
      baseURL: OPENROUTER_ANTHROPIC_BASE_URL,
      apiKey: null,
      authToken: config.authToken,
      defaultHeaders: OPENROUTER_APP_HEADERS,
      maxRetries: options.maxRetries ?? ANTHROPIC_MAX_RETRIES,
      timeout: options.timeout ?? ANTHROPIC_TIMEOUT_MS,
    });
  }
  return new Anthropic({
    apiKey: config.apiKey,
    maxRetries: options.maxRetries ?? ANTHROPIC_MAX_RETRIES,
    timeout: options.timeout ?? ANTHROPIC_TIMEOUT_MS,
  });
}

// ─── Model catalog resolution (owner decision 21) ───────────────────────────
//
// Routing, output budgets and labels read the synchronous registry in
// shared/generationModels.ts. Seed models are always there; a model the
// catalog added later is registered here from the entry frozen on the
// generation (or the entry a role resolves to) before its first call.

type RunQueryCtx = Pick<ActionCtx, "runQuery">;

/** A generation's freeze never changes, so one read per isolate suffices. */
const freezeCache = new Map<string, Promise<ModelFreeze | null>>();
const FREEZE_CACHE_LIMIT = 200;

/** Test seam: forget cached generation freezes (ids repeat across tests). */
export function resetGenerationModelCache(): void {
  freezeCache.clear();
}

/**
 * Register every model frozen on `generationId` and return the freeze.
 * Generation actions call this before their first provider call so a model
 * the catalog added after this deployment routes, budgets and prices
 * exactly as it did at reservation.
 */
export async function registerGenerationModels(
  ctx: RunQueryCtx,
  generationId: Id<"generations">
): Promise<ModelFreeze | null> {
  let pending = freezeCache.get(generationId);
  if (!pending) {
    if (freezeCache.size >= FREEZE_CACHE_LIMIT) freezeCache.clear();
    pending = ctx.runQuery(generationModelsRef, { generationId }).catch((error: unknown) => {
      freezeCache.delete(generationId);
      throw error;
    });
    freezeCache.set(generationId, pending);
  }
  const freeze = await pending;
  if (freeze) registerModelEntries(freeze.entries.map(entryFromFrozen));
  return freeze;
}

async function ensureModelRegistered(
  ctx: RunQueryCtx,
  modelId: string,
  generationId: Id<"generations"> | undefined
): Promise<void> {
  if (generationId) {
    const freeze = await registerGenerationModels(ctx, generationId);
    if (freeze?.entries.some((entry) => entry.id === modelId)) return;
  }
  if (isKnownModel(modelId)) return;
  const entry = await ctx.runQuery(modelEntryForCallRef, {
    modelId,
    ...(generationId ? { generationId } : {}),
  });
  if (entry) registerModelEntries([entryFromFrozen(entry)]);
}

/**
 * The failure codes the production error-rate rollback counts: the model
 * returned something unusable, refused, or failed in a way nobody has
 * classified. Billing, auth, rate limits and network faults say nothing
 * about the model and are not recorded. Neither is an action running out of
 * time (ActionTimeBudgetError, 2026-09-25): that is our own arithmetic.
 * The same goes for any failure the action's time limit caused: a timeout
 * the deadline cut short (thrown as ActionTimeBudgetError), or a retryable
 * failure whose transport retry the deadline refused (wasStoppedByDeadline).
 * A request that still fails after every retry it was allowed counts as
 * before (decision 21, fix-g review P2-2): a 408, 409 or 5xx answer (529
 * included), a dropped Anthropic connection, or a timeout at the full
 * request timeout. An OpenRouter fetch that never connects reads as
 * `network` and is not counted, as before.
 */
export function modelFaultCode(error: unknown): string | null {
  if (error instanceof ActionTimeBudgetError) return null;
  if (wasStoppedByDeadline(error)) return null;
  // A missing key or an unknown transport or model mapping (decision 30)
  // is our configuration, not the model.
  if (isProviderNotConfigured(error)) return null;
  if (error instanceof MalformedOutputError) return "malformed_output";
  const { code } = normalizeProviderError(error);
  return code === "output_limit" || code === "model_access" || code === "unknown"
    ? code
    : null;
}

/** A PROVIDER_NOT_CONFIGURED domain error (convex/lib/providerConfig.ts). */
function isProviderNotConfigured(error: unknown): boolean {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    (error.data as { code?: unknown }).code === "PROVIDER_NOT_CONFIGURED"
  );
}

/**
 * Records exactly one terminal outcome per provider request, apart from
 * billing (review finding 6): a response that was billed but could not be
 * used (malformed tool JSON, truncation) is one failure and never also a
 * success, which a usage-row count would have made it. Errors that say
 * nothing about the model (billing, auth, rate limits, network) are not
 * counted either way. A recording failure is logged and never fails the
 * call; one small mutation per request is negligible next to the request.
 */
/** How long a request waits for its outcome to be recorded. */
export const OUTCOME_RECORD_DEADLINE_MS = 2_000;

type Outcome = { model: string; callSite: string; outcome: "success" | "failure"; code?: string };

/**
 * Records one outcome with a short deadline. A write that fails or runs
 * past the deadline never fails or holds up the request: it is logged as
 * "model call outcome not recorded" so the gap is visible in the logs.
 */
async function recordOutcome(ctx: Pick<ActionCtx, "runMutation">, outcome: Outcome): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const written = ctx.runMutation(recordCallOutcomeRef, outcome).then(() => "written" as const);
    const deadline = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), OUTCOME_RECORD_DEADLINE_MS);
    });
    // A late write may still land; its eventual rejection is only logged.
    written.catch((error: unknown) =>
      console.error("model call outcome not recorded", { ...outcome, error: String(error) })
    );
    if ((await Promise.race([written, deadline])) === "late") {
      console.error("model call outcome not recorded in time", outcome);
    }
  } catch (error) {
    console.error("model call outcome not recorded", { ...outcome, error: String(error) });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The model that actually answered, carried on a response or an error. */
function servedModelOf(value: unknown): string | undefined {
  return value && typeof value === "object" && "servedModel" in value && typeof value.servedModel === "string"
    ? value.servedModel
    : undefined;
}

/**
 * Wraps a client so each request records exactly one outcome for the model
 * that actually served it (an OpenRouter fallback answer counts for the
 * fallback, review E). Forced-tool calls defer the outcome to the caller's
 * schema validation: the response carries `settleOutcome`, which
 * generateStructured calls once it knows whether the output is usable
 * (review F). Every forced-tool call in production goes through
 * generateStructured. A caller that validates a plain-text answer itself
 * (financial extraction parses JSON from text) opts in with
 * `deferOutcome` and settles after its own validation (round 3, item 6).
 */
export function withOutcomeRecording(
  ctx: Pick<ActionCtx, "runMutation">,
  modelId: string,
  callSite: string,
  client: GenerationClient,
  options: {
    deferOutcome?: boolean;
    /**
     * The caller's abort signal (fact extraction, 2026-09-25): a request the
     * caller gave up on records nothing, since that says nothing about the
     * model (review P3-b).
     */
    signal?: AbortSignal;
  } = {}
): GenerationClient {
  return {
    messages: {
      create: async (params) =>
        await recordedRequest(
          ctx,
          {
            requested: params.model || modelId,
            callSite,
            defer: Boolean(params.tool_choice || options.deferOutcome),
            ...(options.signal ? { signal: options.signal } : {}),
          },
          () => client.messages.create(params)
        ),
    },
  };
}

/** Settles a deferred outcome once the caller knows whether the output is usable. */
export type SettleOutcome = (result: { ok: true } | { ok: false; code: string }) => Promise<void>;

/**
 * The one place a provider request's terminal outcome is recorded: exactly
 * one per request (phase 2 rule), for the model that served it. A deferred
 * request hands the response a `settleOutcome` for the caller to call after
 * its own validation. A request whose own `signal` was aborted records
 * nothing (review 2026-09-25, P3-b): the caller gave up, which says nothing
 * about the model. Any other error, a timeout included, is judged by
 * `modelFaultCode`, so an attempt that timed out on its own timer (a body
 * read past the deadline, say) still counts against the model.
 */
async function recordedRequest<R extends { servedModel?: string; settleOutcome?: SettleOutcome }>(
  ctx: Pick<ActionCtx, "runMutation">,
  request: { requested: string; callSite: string; defer: boolean; signal?: AbortSignal },
  send: () => Promise<R>
): Promise<R> {
  const { requested, callSite } = request;
  let response: R;
  try {
    response = await send();
  } catch (error) {
    const code = request.signal?.aborted ? null : modelFaultCode(error);
    if (code) {
      await recordOutcome(ctx, { model: servedModelOf(error) ?? requested, callSite, outcome: "failure", code });
    }
    throw error;
  }
  const model = response.servedModel ?? requested;
  if (request.defer) {
    let settled = false;
    response.settleOutcome = async (result) => {
      if (settled) return;
      settled = true;
      await recordOutcome(
        ctx,
        result.ok
          ? { model, callSite, outcome: "success" }
          : { model, callSite, outcome: "failure", code: result.code }
      );
    };
    return response;
  }
  await recordOutcome(ctx, { model, callSite, outcome: "success" });
  return response;
}

/** The Anthropic calls citations-mode extraction makes (see citationsExtractor). */
export type OutcomeAnthropicClient = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { signal?: AbortSignal }
    ): Promise<Anthropic.Message & { settleOutcome?: SettleOutcome }>;
  };
};

/**
 * An Anthropic client for requests `withOutcomeRecording` cannot carry:
 * citations-mode fact extraction reads a plain-text answer and passes
 * request options such as `{ signal }` (review 2026-09-25, P3-a). Every
 * request records exactly one outcome: its response carries
 * `settleOutcome`, which the caller settles after parsing, and a failed
 * request records its model fault. A request the caller aborted records
 * nothing.
 */
export function withAnthropicOutcomeRecording(
  ctx: Pick<ActionCtx, "runMutation">,
  modelId: string,
  callSite: string,
  client: Anthropic
): OutcomeAnthropicClient {
  return {
    messages: {
      create: async (params, options) =>
        await recordedRequest(
          ctx,
          {
            requested: params.model || modelId,
            callSite,
            defer: true,
            ...(options?.signal ? { signal: options.signal } : {}),
          },
          async () =>
            (await client.messages.create(params, options?.signal ? { signal: options.signal } : undefined)) as Anthropic.Message & {
              settleOutcome?: SettleOutcome;
            }
        ),
    },
  };
}

type GenerationCallMeta = {
  callSite: string;
  projectId?: Id<"projects">;
  userId?: string;
  attribution?: GenerationAttribution;
  onUsage?: ProviderCallMeta["onUsage"];
};

/** A generation's placeholder map never changes, so one read per isolate. */
const placeholderCache = new Map<string, Promise<PlaceholderMap>>();

/** Test seam: forget cached placeholder maps (ids repeat across tests). */
export function resetGenerationPlaceholderCache(): void {
  placeholderCache.clear();
}

/**
 * Owner decision 26: the placeholder map frozen on the generation, so every
 * generation-owned call reads placeholders instead of names and every
 * response is restored before the caller sees it.
 */
async function generationPlaceholders(
  ctx: RunQueryCtx,
  generationId: Id<"generations">
): Promise<PlaceholderMap> {
  let pending = placeholderCache.get(generationId);
  if (!pending) {
    if (placeholderCache.size >= FREEZE_CACHE_LIMIT) placeholderCache.clear();
    pending = ctx
      .runQuery(internal.generations.getGenerationPlaceholders, { generationId })
      .catch((error: unknown) => {
        placeholderCache.delete(generationId);
        throw error;
      });
    placeholderCache.set(generationId, pending);
  }
  return await pending;
}

/**
 * A client whose gateway is decided on first use, after the model's entry is
 * registered. Construction stays synchronous for every existing call site.
 * A generation-owned client also hides names behind the generation's frozen
 * placeholders (decision 26).
 */
function lazyClient(
  ctx: ActionCtx,
  modelId: string,
  meta: GenerationCallMeta,
  build: () => GenerationClient
): GenerationClient {
  let resolved: Promise<GenerationClient> | undefined;
  const generationId = meta.attribution?.generationId;
  const resolve = () =>
    (resolved ??= ensureModelRegistered(ctx, modelId, generationId)
      .then(async () => {
        const client = build();
        if (!generationId) return client;
        return withPlaceholders(client, await generationPlaceholders(ctx, generationId));
      })
      .catch((error: unknown) => {
        resolved = undefined;
        throw error;
      }));
  return withOutcomeRecording(ctx, modelId, meta.callSite, {
    messages: {
      create: async (params) => (await resolve()).messages.create(params),
    },
  });
}

/**
 * Seed-only client policy. `generateStructured` owns the one repair request,
 * so neither gateway may add a hidden transport retry.
 */
export function seedClientForModel(
  ctx: ActionCtx,
  modelId: string,
  meta: GenerationCallMeta
): GenerationClient {
  assertGenerationCallSite(meta.callSite);
  return lazyClient(ctx, modelId, meta, () => {
    if (gatewayForModel(modelId) === "openrouter") {
      return instrumentedOpenRouter(ctx, meta, SEED_OPENROUTER_OPTIONS);
    }
    return instrumentedAnthropic(ctx, {
      ...meta,
      capability: "generation",
      clientOptions: SEED_ANTHROPIC_OPTIONS,
    }) as unknown as GenerationClient;
  });
}

/**
 * The client for a candidate model, routed by its gateway. Anthropic's SDK
 * client satisfies GenerationClient structurally, so agents typed against it
 * accept both.
 */
export function clientForModel(
  ctx: ActionCtx,
  modelId: string,
  meta: GenerationCallMeta
): GenerationClient {
  assertGenerationCallSite(meta.callSite);
  return lazyClient(ctx, modelId, meta, () => {
    if (gatewayForModel(modelId) === "openrouter") {
      return instrumentedOpenRouter(ctx, meta);
    }
    // Anthropic's response is a superset of GenerationResponse (extra block
    // variants like thinking); safe to narrow: agents only read text/tool_use.
    return instrumentedAnthropic(ctx, {
      ...meta,
      capability: "generation",
    }) as unknown as GenerationClient;
  });
}

/**
 * The structured fact-extraction client (review 2026-09-25, P1): routed and
 * instrumented like `clientForModel`, usage attributed to the generation
 * when there is one, but WITHOUT the generation's placeholder wrapper. Fact
 * extraction hides and restores names itself with the one map
 * `transcripts.factsInput` builds; a second map here numbers people
 * differently and restores one person's placeholder as another's name.
 */
export function factExtractionClient(
  ctx: ActionCtx,
  modelId: string,
  meta: GenerationCallMeta,
  options: { timeoutMs: number; signal?: AbortSignal }
): GenerationClient {
  assertGenerationCallSite(meta.callSite);
  let client: GenerationClient;
  if (gatewayForModel(modelId) === "openrouter") {
    client = instrumentedOpenRouter(ctx, meta, {
      timeoutMs: options.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } else {
    const anthropic = instrumentedAnthropic(ctx, {
      ...meta,
      capability: "generation",
      clientOptions: { timeout: options.timeoutMs },
    });
    client = {
      messages: {
        create: async (params) =>
          (await anthropic.messages.create(
            params as Anthropic.MessageCreateParamsNonStreaming,
            options.signal ? { signal: options.signal } : undefined
          )) as unknown as GenerationResponse,
      },
    };
  }
  return withOutcomeRecording(ctx, modelId, meta.callSite, client, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * The client for a helper role outside any generation (Brain ingest,
 * learning digests, chat-side helpers, admin summaries): the role's current
 * model, with its previous model as an OpenRouter fallback when both run
 * there and the role was never rolled back from it (modelCatalog.ts
 * roleModelEntry). Returns the model id to put in the request.
 */
export async function clientForRole(
  ctx: ActionCtx,
  role: ModelRole,
  meta: GenerationCallMeta & {
    capability?: AnthropicCapability;
    brainSourceId?: Id<"brainSources">;
    /** The caller settles each response's outcome after its own validation. */
    deferOutcome?: boolean;
  }
): Promise<{ client: GenerationClient; model: string }> {
  const { entry, fallback } = await ctx.runQuery(roleModelEntryRef, { role });
  registerModelEntries([
    entryFromFrozen(entry),
    ...(fallback ? [entryFromFrozen(fallback)] : []),
  ]);
  const client =
    entry.gateway === "openrouter"
      ? instrumentedOpenRouter(ctx, meta, fallback ? { fallbackModels: [fallback.id] } : {})
      : (instrumentedAnthropic(ctx, {
          ...meta,
          capability: meta.capability ?? "generation",
        }) as unknown as GenerationClient);
  return {
    client: withOutcomeRecording(ctx, entry.id, meta.callSite, client, {
      deferOutcome: meta.deferOutcome === true,
    }),
    model: entry.id,
  };
}

/**
 * The client for a role inside a generation: the model frozen for that role
 * at reservation, never the role's current model.
 */
export async function clientForFrozenRole(
  ctx: ActionCtx,
  generationId: Id<"generations">,
  role: keyof ModelFreeze["roles"],
  meta: GenerationCallMeta
): Promise<{ client: GenerationClient; model: string }> {
  const freeze = await registerGenerationModels(ctx, generationId);
  const model = freeze?.roles[role];
  if (!model) throw new Error(`Generation ${generationId} has no frozen ${role} model`);
  return { client: clientForModel(ctx, model, meta), model };
}

/** Exact billed token count returned by Voyage embedding/rerank responses. */
export function voyageTokenCount(responseBody: unknown): number | null {
  if (
    !responseBody ||
    typeof responseBody !== "object" ||
    !("usage" in responseBody)
  ) {
    return null;
  }
  const usage = responseBody.usage;
  if (!usage || typeof usage !== "object" || !("total_tokens" in usage)) {
    return null;
  }
  const tokens = usage.total_tokens;
  return typeof tokens === "number" &&
    Number.isFinite(tokens) &&
    tokens >= 0
    ? tokens
    : null;
}

export function normalizeProviderError(error: unknown): {
  code:
    | "billing"
    | "rate_limited"
    | "authentication"
    | "model_access"
    | "output_limit"
    | "network"
    | "unknown";
  message: string;
} {
  // Our own time arithmetic, not a provider answer (actionDeadline.ts). It
  // keeps the "unknown" code, which every stored failure code accepts, with
  // the writer-facing sentence instead of provider text.
  if (error instanceof ActionTimeBudgetError) {
    return { code: "unknown", message: error.message };
  }
  let status: number | undefined;
  let rawMessage = "";
  if (error instanceof Error) rawMessage = error.message;
  if (error && typeof error === "object" && "status" in error) {
    status = typeof error.status === "number" ? error.status : undefined;
  }
  const message = rawMessage.toLowerCase();
  // OpenRouter's in-flight spending budget (decision 30): a 402 that says
  // the account's concurrent spend is full, sent with Retry-After while the
  // balance is positive. It clears on its own, so it reads as a rate limit,
  // not as billing.
  if (status === 402 && (message.includes("in_flight_budget") || message.includes("in-flight budget"))) {
    return {
      code: "rate_limited",
      message: "The AI provider is limiting how many requests can run at once. Try again shortly.",
    };
  }
  // OpenRouter's routing answers on the Anthropic transport (decision 30):
  // 404 when the provider pin matches no endpoint (Anthropic is down for
  // OpenRouter, or the model is not listed there), 403 when the key's
  // guardrail blocks the provider. Neither says anything about the model.
  if (isOpenRouterError(error) && status === 404) {
    return {
      code: "network",
      message: "OpenRouter found no Anthropic endpoint for this request (Anthropic may be unavailable there, or the model is not listed).",
    };
  }
  if (isOpenRouterError(error) && status === 403) {
    return {
      code: "authentication",
      message: "OpenRouter refused this request; the key's guardrail or provider settings may exclude Anthropic.",
    };
  }
  // 402 = OpenRouter insufficient credits; message checks cover both gateways.
  if (
    status === 402 ||
    message.includes("credit balance") ||
    message.includes("insufficient credits") ||
    message.includes("billing")
  ) {
    return {
      code: "billing",
      message: "The AI provider account cannot accept this request because billing or credits need attention.",
    };
  }
  if (message.includes("moderation") || message.includes("flagged")) {
    return {
      code: "model_access",
      message: "The AI provider declined this request (content moderation). Try again or use a different model.",
    };
  }
  if (status === 429 || message.includes("rate limit")) {
    return {
      code: "rate_limited",
      message: "The AI provider is rate-limiting requests. Try again after the limit resets.",
    };
  }
  if (status === 401 || message.includes("api key") || message.includes("authentication")) {
    return {
      code: "authentication",
      message: "The AI provider credentials were rejected by the provider.",
    };
  }
  if (status === 403 || message.includes("model") && message.includes("access")) {
    return {
      code: "model_access",
      message: "The configured account does not have access to a required model.",
    };
  }
  // Thrown locally by fromChatCompletions, not by the provider: the model hit
  // max_tokens before finishing. Distinct code so it is not mistaken for a
  // provider outage — the fix is budget/model, not provider status.
  if (message.includes("truncated at the max_tokens limit")) {
    return {
      code: "output_limit",
      message: "The model ran out of output budget before finishing this step. Retry, or use a different model for this draft.",
    };
  }
  if (message.includes("network") || message.includes("fetch")) {
    return {
      code: "network",
      message: "The AI provider could not be reached from this deployment.",
    };
  }
  // Unclassified: keep the raw message. Replacing it with generic advice made
  // real failures undiagnosable in the generation progress log.
  return {
    code: "unknown",
    message: rawMessage
      ? `The AI provider rejected the request: ${rawMessage.slice(0, 300)}`
      : "The AI provider rejected the request. An administrator should inspect provider status.",
  };
}

/**
 * The failure text a generation, candidate, section or redraft row stores:
 * `<code>: <message>` from normalizeProviderError, which the read side maps
 * to fixed writer copy by its code. An action that ran out of time stores
 * the writer-facing sentence alone (it has no colon), which the read side
 * shows as is.
 */
export function describeProviderFailure(error: unknown): string {
  if (error instanceof ActionTimeBudgetError) return error.message;
  const normalized = normalizeProviderError(error);
  return `${normalized.code}: ${normalized.message}`;
}
