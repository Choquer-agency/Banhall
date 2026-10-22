"use node";

/**
 * The readiness check a track's newer version passes before the track moves
 * to it (2026-10-22 decision: models follow the newest version of their
 * tier). Run once a day from convex/modelCatalog.ts refreshCatalog.
 *
 * For each track with a newer version on OpenRouter:
 * 1. A Claude track first confirms the direct Anthropic id exists, through
 *    Anthropic's models API (GET /v1/models) with the deployment's own key.
 *    Absent: the track stays put and is checked again tomorrow. A Claude
 *    track never moves to the OpenRouter gateway.
 * 2. One tiny plain request through the real transport (the direct gateway
 *    for Claude, with adaptive thinking on as chat sends it), and one forced
 *    tool request. A forced call refused with a 400 marks the model as one
 *    that runs on the unforced path (as Opus 5.5 does); any other failure
 *    holds the track for a day.
 *
 * Reasoning, the output cap, the context and the prices all come from the
 * OpenRouter listing, so a discovered version needs no code change.
 */
import Anthropic from "@anthropic-ai/sdk";
import { v, type Infer } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  FORCED_TOOL_CHOICE_REJECTED_IDS,
  registerModelEntries,
  type ModelEntry,
} from "../../shared/generationModels";
import type { ReadinessResult } from "../../shared/modelCatalog";
import { MODEL_TRACKS } from "../../shared/modelTracks";
import { requireAnthropicClientConfig } from "../lib/providerConfig";
import { modelTrackValidator } from "../lib/modelCatalogValidators";
import {
  applyTrackUpgradeRef,
  planTrackUpgradesRef,
} from "../lib/modelCatalogRefs";
import { startActionDeadline } from "./actionDeadline";
import { instrumentedAnthropic } from "./instrument";
import { instrumentedOpenRouter } from "./openrouter";
import type { GenerationClient, GenerationMessageParams } from "./openrouterCore";

/** The aiUsage call site of every readiness request. */
export const READINESS_CALL_SITE = "model_readiness";
const READINESS_TIMEOUT_MS = 60_000;
const MODELS_API_TIMEOUT_MS = 30_000;
/** The plain request's answer budget; Claude adds its thinking to it. */
const PLAIN_MAX_TOKENS = 2048;
const FORCED_TOOL_NAME = "report_ready";

/** The parts of a planned candidate (modelCatalog.planTrackUpgrades) read here. */
export type TrackCandidateShape = {
  track: keyof typeof MODEL_TRACKS;
  fromModelId: string;
  toModelId: string;
  listingId: string;
  label: string;
  listing: {
    requestId?: string;
    reasoning: boolean;
    maxCompletionTokens?: number;
  };
};

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 200);

function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

/**
 * Whether Anthropic's models API lists `modelId` for this deployment's key.
 * Reads every page (the list is a few dozen models).
 */
export async function anthropicListsModel(apiKey: string, modelId: string): Promise<boolean> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: MODELS_API_TIMEOUT_MS });
  for await (const model of client.models.list({ limit: 1000 })) {
    if (model.id === modelId) return true;
  }
  return false;
}

/** The runtime entry the readiness requests route by. */
export function readinessEntry(candidate: TrackCandidateShape): ModelEntry {
  const track = MODEL_TRACKS[candidate.track];
  if (track.gateway === "anthropic") {
    return {
      id: candidate.toModelId,
      label: candidate.label,
      provider: track.provider,
      gateway: "anthropic",
      reasoning: false,
      ...(candidate.listing.maxCompletionTokens !== undefined
        ? { maxCompletionTokens: candidate.listing.maxCompletionTokens }
        : {}),
    };
  }
  return {
    id: candidate.toModelId,
    label: candidate.label,
    provider: track.provider,
    gateway: "openrouter",
    reasoning: candidate.listing.reasoning,
    ...(candidate.listing.maxCompletionTokens !== undefined
      ? { maxCompletionTokens: candidate.listing.maxCompletionTokens }
      : {}),
    ...(candidate.listing.requestId && candidate.listing.requestId !== candidate.toModelId
      ? { requestId: candidate.listing.requestId }
      : {}),
  };
}

const PROMPT = "Reply with the single word: ready.";

function plainRequest(model: string, anthropic: boolean): GenerationMessageParams {
  return {
    model,
    max_tokens: PLAIN_MAX_TOKENS,
    // Chat streams with adaptive thinking on the direct gateway, so a Claude
    // version must take it.
    ...(anthropic ? { thinking: { type: "adaptive" } } : {}),
    messages: [{ role: "user", content: PROMPT }],
  } as GenerationMessageParams;
}

function forcedRequest(model: string): GenerationMessageParams {
  return {
    model,
    max_tokens: PLAIN_MAX_TOKENS,
    tools: [
      {
        name: FORCED_TOOL_NAME,
        description: "Report that you are ready.",
        input_schema: {
          type: "object",
          properties: { ready: { type: "boolean" } },
          required: ["ready"],
        },
      },
    ],
    tool_choice: { type: "tool", name: FORCED_TOOL_NAME },
    messages: [{ role: "user", content: "Call the report_ready tool with ready set to true." }],
  } as GenerationMessageParams;
}

/**
 * Runs the readiness check for one candidate and reports what it found. A
 * thrown error is a failure of the check, never of the job.
 */
export async function checkReadiness(
  ctx: ActionCtx,
  candidate: TrackCandidateShape,
  deps: { listsModel?: typeof anthropicListsModel } = {}
): Promise<ReadinessResult> {
  const track = MODEL_TRACKS[candidate.track];
  const anthropic = track.gateway === "anthropic";
  if (anthropic) {
    let apiKey: string;
    try {
      const config = requireAnthropicClientConfig("generation", "direct");
      if (config.transport !== "direct") throw new Error("not direct");
      apiKey = config.apiKey;
    } catch {
      return { plainOk: false, forcedToolChoice: false, forcedRejected: false, failure: "no direct Anthropic key is set" };
    }
    let listed: boolean;
    try {
      listed = await (deps.listsModel ?? anthropicListsModel)(apiKey, candidate.toModelId);
    } catch (error) {
      return { plainOk: false, forcedToolChoice: false, forcedRejected: false, failure: `Anthropic's model list did not answer (${errorText(error)})` };
    }
    if (!listed) {
      return {
        plainOk: false,
        forcedToolChoice: false,
        forcedRejected: false,
        failure: `${candidate.toModelId} is not on Anthropic's API yet`,
      };
    }
  }
  registerModelEntries([readinessEntry(candidate)]);
  const client: GenerationClient = anthropic
    ? (instrumentedAnthropic(ctx, {
        callSite: READINESS_CALL_SITE,
        capability: "generation",
        clientOptions: { maxRetries: 0, timeout: READINESS_TIMEOUT_MS },
      }) as unknown as GenerationClient)
    : instrumentedOpenRouter(ctx, { callSite: READINESS_CALL_SITE }, { timeoutMs: READINESS_TIMEOUT_MS, maxRetries: 0 });
  try {
    await client.messages.create(plainRequest(candidate.toModelId, anthropic));
  } catch (error) {
    return { plainOk: false, forcedToolChoice: false, forcedRejected: false, failure: `the plain request failed (${errorText(error)})` };
  }
  // A model already known to refuse a forced call is not asked again.
  if (FORCED_TOOL_CHOICE_REJECTED_IDS.has(candidate.toModelId) || FORCED_TOOL_CHOICE_REJECTED_IDS.has(candidate.listingId)) {
    return { plainOk: true, forcedToolChoice: false, forcedRejected: true };
  }
  try {
    const response = await client.messages.create(forcedRequest(candidate.toModelId));
    const called = response.content.some((block) => block.type === "tool_use");
    return called
      ? { plainOk: true, forcedToolChoice: true, forcedRejected: false }
      : { plainOk: true, forcedToolChoice: false, forcedRejected: false, failure: "the forced tool request came back without a tool call" };
  } catch (error) {
    if (statusOf(error) === 400) return { plainOk: true, forcedToolChoice: false, forcedRejected: true };
    return { plainOk: true, forcedToolChoice: false, forcedRejected: false, failure: `the tool request failed (${errorText(error)})` };
  }
}

const upgradeOutcomeValidator = v.object({
  track: modelTrackValidator,
  outcome: v.union(v.literal("moved"), v.literal("held")),
});

/** Checks every track with a newer version and moves the ones that pass. */
export const upgradeTracks = internalAction({
  args: {},
  returns: v.array(upgradeOutcomeValidator),
  handler: async (ctx): Promise<Array<Infer<typeof upgradeOutcomeValidator>>> => {
    startActionDeadline(ctx);
    const candidates = await ctx.runMutation(planTrackUpgradesRef, {});
    const results: Array<Infer<typeof upgradeOutcomeValidator>> = [];
    for (const candidate of candidates) {
      let readiness: ReadinessResult;
      try {
        readiness = await checkReadiness(ctx, candidate);
      } catch (error) {
        readiness = { plainOk: false, forcedToolChoice: false, forcedRejected: false, failure: errorText(error) };
      }
      const outcome = await ctx.runMutation(applyTrackUpgradeRef, { candidate, readiness });
      results.push({ track: candidate.track, outcome });
    }
    return results;
  },
});
