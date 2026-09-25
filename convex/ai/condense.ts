"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { classifySpeakerRolesCall } from "./speakerRolesAgent";
import { withPlaceholders } from "./placeholderClient";
import {
  callSlots,
  citationsExtractor,
  extractTranscriptFacts,
  FACTS_CONCURRENCY,
  FACTS_TIMEOUT_MS,
  factWindowCount,
  structuredExtractor,
  type CallSlots,
  type FactWindowExtractor,
} from "./transcriptFactsAgent";
import type { FunctionReturnType } from "convex/server";
import { instrumentedAnthropic } from "./instrument";
import { gatewayForModel, registerModelEntries } from "../../shared/generationModels";
import { entryFromFrozen } from "../lib/modelRoles";
import { roleModelEntryRef } from "../lib/modelCatalogRefs";
import type { VerifiedFact } from "../lib/transcriptFacts";
import { CONDENSE_WINDOW_CHARS } from "../lib/transcripts";
import {
  CONDENSE_CONCURRENCY,
  CONDENSE_TIMEOUT_MS,
  condenseWindow,
  fitsCondenseBudget,
  joinDigestParts,
  renderDigest,
  splitIntoWindows,
  type CondenseWindow,
} from "./condenseAgent";
import type { GenerationClient } from "./openrouterCore";
import { MODEL } from "./model";
import { generationPromptVersion } from "./promptProgram";
import {
  clientForModel,
  clientForRole,
  factExtractionClient,
  withAnthropicOutcomeRecording,
  registerGenerationModels,
  CONVEX_ACTION_LIMIT_MS,
  describeProviderFailure,
  ANTHROPIC_TIMEOUT_MS,
  RESERVED_NON_REQUEST_MS,
} from "./providers";

/**
 * The one sentence a writer sees when a project cannot be condensed inside the
 * generation's time limit, whether the pre-check rejected it or a call ran
 * long. It names the action they can take; the reaper's generic stall message
 * does not.
 */
export const CONDENSE_BUDGET_ERROR =
  "Condensing transcripts would exceed the generation time limit; split the project or shorten transcripts";

/** Raised by the pre-check and by a call that ran past CONDENSE_TIMEOUT_MS. */
export class CondenseBudgetError extends Error {
  constructor() {
    super(CONDENSE_BUDGET_ERROR);
    this.name = "CondenseBudgetError";
  }
}

/**
 * What a failed generation records. Everything reaching a generation's catch
 * is a provider failure except this one, which is our own arithmetic and must
 * not be dressed up as a provider rejection.
 */
export function describeGenerationFailure(error: unknown): string {
  if (error instanceof CondenseBudgetError) return CONDENSE_BUDGET_ERROR;
  // An action out of time stores its writer-facing sentence (2026-09-25).
  return describeProviderFailure(error);
}

/** What condensation needs from the parent action: nothing but its calls. */
export type CondenseCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

/** A condense unit, optionally naming the model its digests record. */
export type BoundCondenser = CondenseWindow & { modelId?: string };

/**
 * The condense unit bound to a real provider: the generation's frozen
 * condense-role model (model catalog), routed by its gateway. Kept separate
 * from `ensureCondensedInputs` so the orchestration is exercisable with a
 * stub: the LLM call is the only part of this flow a test cannot run.
 */
export function condenserFor(
  ctx: ActionCtx,
  meta: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    userId?: Id<"users">;
    /** The generation's frozen condense model. */
    modelId: string;
  }
): BoundCondenser {
  let client: GenerationClient | undefined;
  const condense: BoundCondenser = async (args) =>
    await condenseWindow(
      (client ??= clientForModel(ctx, meta.modelId, {
        callSite: "generation:condense",
        projectId: meta.projectId,
        ...(meta.userId ? { userId: meta.userId } : {}),
        attribution: { generationId: meta.generationId },
      })),
      { ...args, modelId: meta.modelId }
    );
  condense.modelId = meta.modelId;
  return condense;
}

/**
 * Reduces every frozen transcript of an over-budget generation to a stored
 * digest and freezes each digest as its own `generationSources` row. Returns
 * only when every transcript has one, so the caller's re-read gets digest
 * parts rather than quietly drafting from the over-budget full text.
 *
 * A digest already stored for the same bytes under the same CONDENSE_VERSION
 * is reused, so a regeneration pays nothing and a retry after a partial
 * failure pays only for what is missing.
 *
 * Model catalog: digests stay keyed by CONDENSE_VERSION alone, not by the
 * condense model. A switch of the condense role therefore never invalidates
 * a stored digest (no silent re-condensing, no churn); the model is recorded
 * on each digest row for provenance, and a change that must re-condense
 * everything bumps CONDENSE_VERSION deliberately.
 */
export async function ensureCondensedInputs(
  ctx: CondenseCtx,
  args: { generationId: Id<"generations">; elapsedMs: number },
  log: (line: string) => Promise<unknown>,
  condense: BoundCondenser
): Promise<void> {
  const input = await ctx.runQuery(
    internal.transcriptDigests.getCondenseInputs,
    { generationId: args.generationId }
  );
  if (!input || input.transcripts.length === 0) return;

  const total = input.transcripts.length;
  const plans = await Promise.all(
    input.transcripts.map(async (transcript, index) => {
      const stored = await ctx.runQuery(internal.transcriptDigests.findDigest, {
        transcriptId: transcript.transcriptId,
        sourceContentHash: transcript.contentHash,
      });
      return {
        transcript,
        position: index + 1,
        digestId: stored?._id,
        windows: stored
          ? []
          : splitIntoWindows(transcript.content, CONDENSE_WINDOW_CHARS),
      };
    })
  );

  // Before the first provider call: the whole condensation has to fit in what
  // is left of this action, or Convex kills it mid-flight and the writer is
  // told nothing useful.
  const windows = plans.reduce((count, plan) => count + plan.windows.length, 0);
  if (
    !fitsCondenseBudget({
      windows,
      concurrency: CONDENSE_CONCURRENCY,
      perCallMs: CONDENSE_TIMEOUT_MS,
      remainingMs:
        CONVEX_ACTION_LIMIT_MS - args.elapsedMs - RESERVED_NON_REQUEST_MS,
    })
  ) {
    throw new CondenseBudgetError();
  }

  for (const plan of plans) {
    const where = `transcript ${plan.position} of ${total} "${plan.transcript.label}"`;
    await log(
      plan.digestId
        ? `Reusing stored digest for ${where}.`
        : `Condensing ${where} (${plan.transcript.content.length.toLocaleString("en-US")} chars)…`
    );
  }

  const promptVersion = await generationPromptVersion(ctx, args.generationId);
  const tasks = plans.flatMap((plan) =>
    plan.windows.map((text, index) => ({
      plan,
      args: {
        text,
        label: plan.transcript.label,
        part: index + 1,
        totalParts: plan.windows.length,
      },
    }))
  );
  const condensed = await mapWithConcurrency(
    tasks,
    CONDENSE_CONCURRENCY,
    async (task) => await withTimeout(condense(task.args), CONDENSE_TIMEOUT_MS)
  );
  // `tasks` was flattened in plan order, so each plan's windows are a
  // contiguous slice of the results.
  let taken = 0;
  const drafted = plans.map((plan) => {
    const windowDigests = condensed.slice(taken, taken + plan.windows.length);
    taken += plan.windows.length;
    return { ...plan, windowDigests };
  });

  const frozenChars = await Promise.all(
    drafted.map(async ({ windowDigests, ...plan }) => {
      const digestId =
        plan.digestId ??
        (await ctx.runMutation(internal.transcriptDigests.recordDigest, {
          transcriptId: plan.transcript.transcriptId,
          projectId: input.projectId,
          sourceContentHash: plan.transcript.contentHash,
          content: joinDigestParts(windowDigests.map(renderDigest)),
          // The window objects as validated, so a reviewer can see the record
          // the rendered text was built from.
          structured: JSON.stringify(windowDigests),
          model: condense.modelId ?? MODEL,
          promptVersion,
          originalLength: plan.transcript.content.length,
        }));
      return await ctx.runMutation(
        internal.transcriptDigests.freezeDigestSource,
        {
          generationId: args.generationId,
          transcriptId: plan.transcript.transcriptId,
          digestId,
        }
      );
    })
  );

  const chars = frozenChars.reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0
  );
  await log(
    `Drafting from ${total} digest${total === 1 ? "" : "s"} (${chars.toLocaleString("en-US")} chars).`
  );
}

/** Rejects with CONDENSE_BUDGET_ERROR if `promise` has not settled in `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CondenseBudgetError()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Runs `run` over `items` with at most `limit` in flight, results in order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

// ─── Speaker roles (2026-09-24, the transcript method) ─────────────────────

/**
 * One structured_helper call for the speakers of a new transcript that the
 * rules could not place (owner decision 24: warn, never block). Names are
 * replaced by placeholders before the call and restored after (decision 26).
 * A failure leaves the rule-based roles in place: the consultant can still
 * set them in the Speakers popover.
 */
export const classifySpeakerRoles = internalAction({
  args: { transcriptId: v.id("transcripts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const input = await ctx.runQuery(internal.transcripts.speakerRoleInput, {
      transcriptId: args.transcriptId,
    });
    if (!input || input.samples.length === 0) return null;
    try {
      const { client, model } = await clientForRole(ctx, "structured_helper", {
        callSite: "transcript:speakers",
        projectId: input.projectId,
      });
      const roles = await classifySpeakerRolesCall(withPlaceholders(client, input.placeholders), {
        model,
        samples: input.samples.map((sample) => ({
          // The label itself is a name: the wrapper replaces it in the
          // request and restores it in the answer.
          label: sample.label,
          lines: sample.lines,
        })),
      });
      await ctx.runMutation(internal.transcripts.recordModelSpeakerRoles, {
        transcriptId: args.transcriptId,
        roles,
      });
    } catch (error) {
      console.warn("Speaker roles were left to the rules", describeGenerationFailure(error));
    }
    return null;
  },
});

// ─── Transcript facts (2026-09-24, the transcript method) ──────────────────

/** Facts written by one mutation. */
const FACT_WRITE_BATCH = 200;

export type FactsOutcome = "ready" | "busy" | "failed" | "gone";

/** Where an extraction runs: in the background, or inside a generation. */
export type FactsCaller =
  | { kind: "background"; userId?: Id<"users"> }
  | {
      kind: "generation";
      generationId: Id<"generations">;
      /** The generation's frozen condense model. */
      modelId: string;
      userId?: Id<"users">;
    };

/**
 * The extractor for a model: Anthropic's citations mode on the direct
 * gateway, the structured adapter everywhere else.
 */
function extractorFor(
  ctx: ActionCtx,
  model: string,
  meta: { projectId: Id<"projects">; caller: FactsCaller },
  usage: { inputTokens: number; outputTokens: number; costUsd: number }
): { extractor: FactWindowExtractor; adapter: "citations" | "structured" } {
  const callSite = meta.caller.kind === "generation" ? "generation:facts" : "transcript:facts";
  const common = {
    callSite,
    projectId: meta.projectId,
    ...(meta.caller.userId ? { userId: meta.caller.userId } : {}),
    ...(meta.caller.kind === "generation" ? { attribution: { generationId: meta.caller.generationId } } : {}),
    onUsage: (tap: { costUsd: number }) => {
      usage.costUsd += tap.costUsd;
    },
  };
  if (gatewayForModel(model) === "anthropic") {
    // Not placeholder-wrapped either: extractTranscriptFacts applies the
    // one map to every window and every answer. Every request records one
    // outcome for the model catalog, settled after its answer is parsed
    // (review 2026-09-25, P3-a).
    const client = withAnthropicOutcomeRecording(
      ctx,
      model,
      callSite,
      instrumentedAnthropic(ctx, {
        ...common,
        capability: "generation",
        clientOptions: { timeout: FACTS_TIMEOUT_MS },
      })
    );
    return {
      adapter: "citations",
      extractor: citationsExtractor(client, model, (tokens) => {
        usage.inputTokens += tokens.inputTokens;
        usage.outputTokens += tokens.outputTokens;
      }),
    };
  }
  // Never `clientForModel` here: inside a generation it would hide names a
  // second time with the generation's map (review 2026-09-25, P1). One
  // client per call, so each call's abort signal reaches its request.
  return {
    adapter: "structured",
    extractor: structuredExtractor(
      (signal) =>
        factExtractionClient(ctx, model, common, {
          timeoutMs: FACTS_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        }),
      model
    ),
  };
}

/** What `transcripts.factsInput` returns for a transcript that exists. */
export type FactsInput = NonNullable<FunctionReturnType<typeof internal.transcripts.factsInput>>;

/**
 * Extracts one transcript's facts once per text and FACTS_VERSION, unless a
 * ready run already has them. Every request carries placeholders, never
 * names (decision 26); quotes are verified against the verbatim text before
 * anything is stored. A failure is recorded on the run and returned, never
 * thrown: callers fall back to today's path.
 */
export async function ensureTranscriptFacts(
  ctx: ActionCtx,
  transcriptId: Id<"transcripts">,
  caller: FactsCaller,
  options: {
    timeoutMs?: number;
    log?: (line: string) => Promise<unknown>;
    /** Shared with the other transcripts of the same generation. */
    slots?: CallSlots;
    /** Already read by the caller (ensureFactInputs counts its windows). */
    input?: FactsInput;
  } = {}
): Promise<FactsOutcome> {
  const input =
    options.input ??
    (await ctx.runQuery(internal.transcripts.factsInput, {
      transcriptId,
      ...(caller.kind === "generation" ? { generationId: caller.generationId } : {}),
    }));
  if (!input) return "gone";
  if (!input.structureReady || input.turns.length === 0) return "failed";
  let model: string;
  if (caller.kind === "generation") {
    await registerGenerationModels(ctx, caller.generationId);
    model = caller.modelId;
  } else {
    const { entry } = await ctx.runQuery(roleModelEntryRef, { role: "condense" });
    registerModelEntries([entryFromFrozen(entry)]);
    model = entry.id;
  }
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  let chosen: ReturnType<typeof extractorFor>;
  try {
    chosen = extractorFor(ctx, model, { projectId: input.projectId, caller }, usage);
  } catch (error) {
    console.warn("Fact extraction has no provider", describeGenerationFailure(error));
    return "failed";
  }
  const { extractor, adapter } = chosen;
  const claim = await ctx.runMutation(internal.transcripts.claimFactRun, {
    transcriptId,
    sourceContentHash: input.sourceContentHash,
    model,
    adapter,
    excludedLabels: input.excludedLabels,
    ...(input.parserVersion !== undefined ? { parserVersion: input.parserVersion } : {}),
  });
  if (claim.kind !== "claimed") return claim.kind;
  try {
    await options.log?.(`Extracting verified facts from "${input.label}".`);
    const result = await extractTranscriptFacts({
      content: input.content,
      turns: input.turns,
      placeholders: input.placeholders,
      extractWindow: extractor,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.slots ? { slots: options.slots } : {}),
    });
    await writeFacts(ctx, claim.runId, result.facts);
    await ctx.runMutation(internal.transcripts.completeFactRun, {
      runId: claim.runId,
      counts: result.counts,
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...(usage.costUsd > 0 ? { costUsd: usage.costUsd } : {}),
      },
    });
    await options.log?.(
      `Kept ${result.counts.verified} verified facts from "${input.label}" (${result.counts.dropped} dropped without a quote found in the transcript).`
    );
    return "ready";
  } catch (error) {
    await ctx.runMutation(internal.transcripts.failFactRun, {
      runId: claim.runId,
      error: describeGenerationFailure(error),
    });
    await options.log?.(`Facts could not be extracted from "${input.label}"; using today's transcript path.`);
    return "failed";
  }
}

async function writeFacts(ctx: ActionCtx, runId: Id<"transcriptFactRuns">, facts: readonly VerifiedFact[]) {
  for (let start = 0; start < facts.length; start += FACT_WRITE_BATCH) {
    await ctx.runMutation(internal.transcripts.recordFactBatch, {
      runId,
      facts: facts.slice(start, start + FACT_WRITE_BATCH).map((fact) => ({
        key: fact.key,
        type: fact.type,
        claim: fact.claim,
        turnIndexes: fact.turnIndexes,
        quotes: fact.quotes,
        ...(fact.speakerLabel ? { speakerLabel: fact.speakerLabel } : {}),
        confidence: fact.confidence,
      })),
    });
  }
}

/** Background extraction, queued when a consultant opens a transcript. */
export const extractTranscriptFactsInBackground = internalAction({
  args: { transcriptId: v.id("transcripts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      // Each call is bounded like one inside a generation, so an action that
      // is killed never leaves a run "running" behind for long.
      await ensureTranscriptFacts(ctx, args.transcriptId, { kind: "background" }, { timeoutMs: FACTS_TIMEOUT_MS });
    } catch (error) {
      console.warn("Background fact extraction failed", describeGenerationFailure(error));
    }
    return null;
  },
});

/**
 * Time kept free after extraction for the work the same action still does
 * (review 2026-09-25, P2-1): the analyzer and the Brief run after it, and a
 * draft that runs out of time is killed, not saved. One full analyzer
 * attempt (the Anthropic call timeout) covers a typical analyzer and Brief.
 */
export const FACTS_AFTER_EXTRACTION_RESERVE_MS = ANTHROPIC_TIMEOUT_MS;

/** What extraction and today's fallback may spend, `elapsedMs` into the action. */
export function factsTimeLeft(elapsedMs: number): number {
  return CONVEX_ACTION_LIMIT_MS - elapsedMs - RESERVED_NON_REQUEST_MS - FACTS_AFTER_EXTRACTION_RESERVE_MS;
}

/**
 * Whether extracting `factWindows` and then, should that fail, condensing
 * `fallbackWindows` both fit `remainingMs` (see factsTimeLeft). Extraction
 * inside a generation must never cost the writer the draft: today's path,
 * the analyzer and the Brief have to fit after it.
 */
export function factsFitBudget(args: {
  factWindows: number;
  fallbackWindows: number;
  remainingMs: number;
}): boolean {
  const waves = (windows: number, concurrency: number) => Math.ceil(windows / concurrency);
  const factMs = waves(args.factWindows, FACTS_CONCURRENCY) * FACTS_TIMEOUT_MS;
  const fallbackMs = waves(args.fallbackWindows, CONDENSE_CONCURRENCY) * CONDENSE_TIMEOUT_MS;
  return factMs + fallbackMs <= args.remainingMs;
}

/**
 * A generation that reads fact packs (`generations.transcriptFacts`, owner
 * decision 27): extracts what is missing on the generation's frozen condense
 * model, then freezes one pack per transcript. Returns true only when every
 * transcript has its pack; false sends the caller down today's path
 * (digests over the budget, full text under it). That happens when a
 * transcript was cut at freeze or changed since, when another extraction
 * of it is still running, when an extraction fails or a pack cannot be
 * frozen, and when extracting plus today's path would not fit the action's
 * time; in that last case the missing transcripts are queued for background
 * extraction, so the next draft finds their facts ready. The time check
 * counts the exact windows each extraction and each fallback condense makes
 * (review 2026-09-25, P3-1). Never throws for a provider failure.
 */
export async function ensureFactInputs(
  ctx: ActionCtx,
  args: {
    generationId: Id<"generations">;
    elapsedMs: number;
    modelId: string;
    userId?: Id<"users">;
  },
  log: (line: string) => Promise<unknown>
): Promise<boolean> {
  const input = await ctx.runQuery(internal.transcriptDigests.getFactInputs, {
    generationId: args.generationId,
  });
  if (!input || !input.transcriptFacts || input.transcripts.length === 0) return false;
  if (input.transcripts.some((transcript) => transcript.truncated || !transcript.sameText)) {
    await log("A transcript cannot be read as verified facts in this draft, so it reads the transcripts the usual way.");
    return false;
  }
  const missing = input.transcripts.filter((transcript) => !transcript.frozen && !transcript.ready);
  if (missing.some((transcript) => transcript.busy)) {
    await log("Verified facts are still being prepared for a transcript, so this draft reads the transcripts the usual way.");
    return false;
  }
  const inputs = await Promise.all(
    missing.map((transcript) =>
      ctx.runQuery(internal.transcripts.factsInput, {
        transcriptId: transcript.transcriptId,
        generationId: args.generationId,
      })
    )
  );
  if (inputs.some((item) => !item || !item.structureReady || item.turns.length === 0)) {
    await log("A transcript is not ready to be read as verified facts, so this draft reads the transcripts the usual way.");
    return false;
  }
  const factWindows = inputs.reduce((count, item) => count + factWindowCount(item!.turns), 0);
  let fallbackWindows = 0;
  if (input.inputMode === "digest" && input.transcripts.some((transcript) => !transcript.digestStored)) {
    const condense = await ctx.runQuery(internal.transcriptDigests.getCondenseInputs, {
      generationId: args.generationId,
    });
    const stored = new Set(input.transcripts.filter((transcript) => transcript.digestStored).map((row) => row.transcriptId));
    for (const transcript of condense?.transcripts ?? []) {
      if (!stored.has(transcript.transcriptId)) {
        fallbackWindows += splitIntoWindows(transcript.content, CONDENSE_WINDOW_CHARS).length;
      }
    }
  }
  if (!factsFitBudget({ factWindows, fallbackWindows, remainingMs: factsTimeLeft(args.elapsedMs) })) {
    for (const transcript of missing) {
      await ctx.scheduler.runAfter(0, internal.ai.condense.extractTranscriptFactsInBackground, {
        transcriptId: transcript.transcriptId,
      });
    }
    await log(
      "Extracting verified facts would not fit this draft's time limit, so it reads the transcripts the usual way. Facts are being prepared for the next draft."
    );
    return false;
  }
  // Every missing transcript at once, never more than FACTS_CONCURRENCY
  // calls in flight in total: the same arithmetic the check above used.
  const slots = callSlots(FACTS_CONCURRENCY);
  const outcomes = await Promise.all(
    missing.map((transcript, index) =>
      ensureTranscriptFacts(
        ctx,
        transcript.transcriptId,
        {
          kind: "generation",
          generationId: args.generationId,
          modelId: args.modelId,
          ...(args.userId ? { userId: args.userId } : {}),
        },
        { timeoutMs: FACTS_TIMEOUT_MS, log, slots, input: inputs[index]! }
      )
    )
  );
  if (outcomes.some((outcome) => outcome !== "ready")) return false;
  for (const transcript of input.transcripts) {
    if (transcript.frozen) continue;
    // A pack that cannot be frozen (too large for one row, or a failed
    // write) sends the draft down today's path; it never fails it.
    let frozen: number | null;
    try {
      frozen = await ctx.runMutation(internal.transcriptDigests.freezeFactsSource, {
        generationId: args.generationId,
        transcriptId: transcript.transcriptId,
      });
    } catch (error) {
      console.warn("A fact pack could not be frozen", describeGenerationFailure(error));
      frozen = null;
    }
    if (frozen === null) {
      await log("A transcript's verified facts could not be frozen, so this draft reads the transcripts the usual way.");
      return false;
    }
  }
  await log(
    `Drafting from the verified facts of ${input.transcripts.length} transcript${input.transcripts.length === 1 ? "" : "s"}.`
  );
  return true;
}
