"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { classifySpeakerRolesCall } from "./speakerRolesAgent";
import { withPlaceholders } from "./placeholderClient";
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
  CONVEX_ACTION_LIMIT_MS,
  normalizeProviderError,
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
  const normalized = normalizeProviderError(error);
  return `${normalized.code}: ${normalized.message}`;
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
