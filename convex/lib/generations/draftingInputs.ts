/**
 * The reordered Step-by-step start (owner decision 32, 2026-09-25).
 *
 * A seed generation freezes its writer style and derives its Brief as soon
 * as its sources are frozen, and opens the seed stage when both exist. The
 * drafting inputs the Seeds never read (Brain retrieval and the transcript
 * analysis) are prepared by a separate background action, tracked on
 * `generations.draftingInputs`, and must be `ready` before sign-off. A
 * failure is retryable by the writer; an attempt that never answers is
 * failed by a scheduled lease check so the Summary never waits forever.
 *
 * The Convex functions are registered in convex/generations.ts; this module
 * holds their handlers and helpers.
 */
import { makeFunctionReference } from "convex/server";
import { v, type ObjectType } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { isProjectDeleting } from "../projectDeletion";
import { domainError } from "../contracts";
import { requireReportEditAccess } from "../roleCapabilities";
import {
  draftingInputsStateOf,
  transitionDraftingInputs,
} from "../generationTransitions";
import { DRAFTING_INPUTS_REQUIRE } from "../../../shared/generationTransitions";
import {
  brainBlocksFromWriterStyle,
  parseFrozenBrainBlocks,
} from "../frozenWriterStyle";
import { brainProvenanceEntryValidator, writeBrainProvenance } from "../generationOutputs";
import {
  draftingInputsFailureCodeValidator,
  type DraftingInputsFailureCode,
} from "../draftingInputsFailure";

/**
 * How long an attempt may stay unanswered before it is failed. Longer than
 * Convex's 10-minute action limit plus scheduling slack, so a live attempt
 * is never failed while it can still answer.
 */
export const DRAFTING_INPUTS_LEASE_MS = 15 * 60 * 1000;

export const prepareSeedDraftingInputsRef = makeFunctionReference<
  "action",
  { generationId: Id<"generations">; attempt: number; shorterAnalysis?: boolean },
  null
>("ai/iterative:prepareSeedDraftingInputs");

const expireDraftingInputsRef = makeFunctionReference<
  "mutation",
  { generationId: Id<"generations">; attempt: number },
  null
>("generations:expireDraftingInputs");

/** What the Summary and sign-off see. An absent sub-state is a generation
 * started before the reorder: it froze both inputs before its seed stage
 * opened, so it reads as ready. */
export type DraftingInputsStatus = "preparing" | "ready" | "failed";

/** What the Seed workspace and the Summary show: the status and, after a
 * failure, why (a normalized code, never provider text). */
export type DraftingInputsView = {
  status: DraftingInputsStatus;
  failureCode?: DraftingInputsFailureCode;
};

type DraftingInputs = NonNullable<Doc<"generations">["draftingInputs"]>;

/** An attempt still `preparing` after its lease: the lease check never ran
 * (it failed, or the functions were missing after a rollback), so it gets
 * the same recovery as an expired lease. */
function preparingPastLease(drafting: DraftingInputs, now: number): boolean {
  return drafting.status === "preparing" && now - drafting.startedAt >= DRAFTING_INPUTS_LEASE_MS;
}

export function draftingInputsView(
  generation: Pick<Doc<"generations">, "draftingInputs">,
  now: number = Date.now()
): DraftingInputsView {
  const drafting = generation.draftingInputs;
  if (!drafting) return { status: "ready" };
  if (preparingPastLease(drafting, now)) return { status: "failed", failureCode: "timed_out" };
  return {
    status: drafting.status,
    ...(drafting.status === "failed" && drafting.failureCode
      ? { failureCode: drafting.failureCode }
      : {}),
  };
}

async function artifactOf(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  kind: "analysis" | "brain_blocks" | "writer_style"
) {
  return await ctx.db
    .query("generationArtifacts")
    .withIndex("by_generationId_and_kind", (q) =>
      q.eq("generationId", generationId).eq("kind", kind)
    )
    .first();
}

/** A seed-stage generation that is still the project's live one. */
async function openSeedStage(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
): Promise<Doc<"generations"> | null> {
  const generation = await ctx.db.get(generationId);
  if (
    !generation ||
    resolveGatedWorkflow(generation) !== "seeds" ||
    generation.summaryVersionId !== undefined ||
    !DRAFTING_INPUTS_REQUIRE.statuses.includes(generation.status)
  ) {
    return null;
  }
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.activeGenerationId !== generation._id) return null;
  if (await isProjectDeleting(ctx, generation.projectId)) return null;
  return generation;
}

/** The open generation, only while `attempt` is its preparing attempt. */
async function currentAttempt(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  attempt: number
): Promise<Doc<"generations"> | null> {
  const generation = await openSeedStage(ctx, generationId);
  if (
    !generation ||
    generation.draftingInputs?.status !== "preparing" ||
    generation.draftingInputs.attempt !== attempt
  ) {
    return null;
  }
  return generation;
}

async function scheduleAttempt(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  attempt: number,
  shorterAnalysis = false
) {
  await ctx.scheduler.runAfter(0, prepareSeedDraftingInputsRef, {
    generationId,
    attempt,
    ...(shorterAnalysis ? { shorterAnalysis: true } : {}),
  });
  await ctx.scheduler.runAfter(DRAFTING_INPUTS_LEASE_MS, expireDraftingInputsRef, {
    generationId,
    attempt,
  });
}

/** Argument validators of generations.saveWriterStyle. */
export const saveWriterStyleArgs = {
  generationId: v.id("generations"),
  writerStyle: v.string(),
};

/** Handler of generations.saveWriterStyle: freeze the style Seeds read, once. */
export async function saveWriterStyleHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof saveWriterStyleArgs>
): Promise<null> {
  const generation = await openSeedStage(ctx, args.generationId);
  if (!generation || generation.status !== "running") return null;
  if (await artifactOf(ctx, generation._id, "writer_style")) return null;
  await ctx.db.insert("generationArtifacts", {
    generationId: generation._id,
    kind: "writer_style",
    content: args.writerStyle,
  });
  return null;
}

/** Argument validators of generations.startDraftingInputs. */
export const startDraftingInputsArgs = { generationId: v.id("generations") };

export const draftingInputsStatusValidator = v.union(
  v.literal("preparing"),
  v.literal("ready"),
  v.literal("failed")
);

/**
 * Handler of generations.startDraftingInputs: schedule attempt 1 of the
 * background step, once per generation. A generation that already froze
 * both inputs is ready at once and schedules nothing.
 */
export async function startDraftingInputsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof startDraftingInputsArgs>
): Promise<DraftingInputsStatus | null> {
  const generation = await openSeedStage(ctx, args.generationId);
  if (!generation) return null;
  if (generation.draftingInputs) return generation.draftingInputs.status;
  const now = Date.now();
  const [analysis, brain] = await Promise.all([
    artifactOf(ctx, generation._id, "analysis"),
    artifactOf(ctx, generation._id, "brain_blocks"),
  ]);
  if (analysis && brain) {
    await transitionDraftingInputs(ctx, generation, {
      status: "ready",
      attempt: 0,
      startedAt: now,
      settledAt: now,
    });
    return "ready";
  }
  await transitionDraftingInputs(ctx, generation, {
    status: "preparing",
    attempt: 1,
    startedAt: now,
  });
  await scheduleAttempt(ctx, generation._id, 1);
  return "preparing";
}

/** Argument validators of generations.isDraftingInputsAttemptCurrent. */
export const draftingInputsAttemptArgs = {
  generationId: v.id("generations"),
  attempt: v.number(),
};

/** Handler of generations.isDraftingInputsAttemptCurrent: lets the action
 * stop before a paid call once its attempt no longer counts (a cancel, a
 * deletion, sign-off or a newer attempt). */
export async function isDraftingInputsAttemptCurrentHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof draftingInputsAttemptArgs>
): Promise<boolean> {
  return (await currentAttempt(ctx, args.generationId, args.attempt)) !== null;
}

/** Argument validators of generations.completeDraftingInputs. */
export const completeDraftingInputsArgs = {
  generationId: v.id("generations"),
  attempt: v.number(),
  analysis: v.string(),
  // JSON of the four Brain exemplar blocks; the style comes from the
  // generation's frozen `writer_style` artifact.
  brainBlocks: v.string(),
  // The Brain exemplars behind the blocks and the retrieval brief, written
  // here so a stale or cancelled attempt never records provenance either.
  brainProvenance: v.optional(
    v.object({
      exemplars: v.array(brainProvenanceEntryValidator),
      brief: v.optional(v.string()),
    })
  ),
};

/**
 * Handler of generations.completeDraftingInputs: freeze the analysis and
 * the `brain_blocks` artifact (Brain blocks plus the frozen writer style, in
 * the shape every drafting reader parses) and mark the inputs ready, in one
 * transaction. A result from an attempt that no longer counts is dropped.
 */
export async function completeDraftingInputsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof completeDraftingInputsArgs>
): Promise<"ready" | "ignored"> {
  const generation = await currentAttempt(ctx, args.generationId, args.attempt);
  if (!generation) return "ignored";
  const style = await artifactOf(ctx, generation._id, "writer_style");
  if (!style) domainError("INVALID_STATE", "Frozen writer style is unavailable");
  const brainBlocks = brainBlocksFromWriterStyle(
    parseFrozenBrainBlocks(args.brainBlocks),
    style.content
  );
  for (const [kind, content] of [
    ["analysis", args.analysis],
    ["brain_blocks", brainBlocks],
  ] as const) {
    // Frozen once: an artifact that already exists is never rewritten.
    if (await artifactOf(ctx, generation._id, kind)) continue;
    await ctx.db.insert("generationArtifacts", {
      generationId: generation._id,
      kind,
      content,
    });
  }
  if (args.brainProvenance) {
    await writeBrainProvenance(
      ctx,
      generation,
      args.brainProvenance.exemplars,
      args.brainProvenance.brief
    );
  }
  await transitionDraftingInputs(ctx, generation, {
    status: "ready",
    attempt: args.attempt,
    startedAt: generation.draftingInputs?.startedAt ?? Date.now(),
    settledAt: Date.now(),
    ...(generation.draftingInputs?.shorterAnalysis ? { shorterAnalysis: true } : {}),
  });
  return "ready";
}

/** Settle a preparing attempt as failed, with the code only. A cut-off
 * analysis, or one the attempt reports as too long (`shorter`), makes every
 * later attempt ask for a shorter one. */
async function settleFailed(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  drafting: DraftingInputs,
  code: DraftingInputsFailureCode | undefined,
  shorter = false
): Promise<void> {
  await transitionDraftingInputs(ctx, generation, {
    ...drafting,
    status: "failed",
    settledAt: Date.now(),
    ...(code ? { failureCode: code } : {}),
    ...(shorter || code === "output_limit" ? { shorterAnalysis: true } : {}),
  });
}

async function failAttempt(
  ctx: MutationCtx,
  args: ObjectType<typeof draftingInputsAttemptArgs>,
  code: DraftingInputsFailureCode | undefined,
  shorter = false
): Promise<null> {
  const generation = await currentAttempt(ctx, args.generationId, args.attempt);
  if (!generation?.draftingInputs) return null;
  await settleFailed(ctx, generation, generation.draftingInputs, code, shorter);
  return null;
}

/** Argument validators of generations.failDraftingInputs. */
export const failDraftingInputsArgs = {
  ...draftingInputsAttemptArgs,
  // Optional: attempts scheduled before the code was stored report none.
  code: v.optional(draftingInputsFailureCodeValidator),
  // The attempt's analysis was too long, whatever it finally failed with:
  // an answer cut off before a repair that failed another way, or a
  // timeout of a model that always thinks (review 2026-09-25).
  shorterAnalysis: v.optional(v.boolean()),
};

/** Handler of generations.failDraftingInputs: the attempt reported failure.
 * Only the normalized code is stored, never provider error or source text. */
export async function failDraftingInputsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof failDraftingInputsArgs>
): Promise<null> {
  return await failAttempt(ctx, args, args.code, args.shorterAnalysis === true);
}

/** Handler of generations.expireDraftingInputs: the attempt's lease ran out
 * without an answer (the action died, for example in a deploy). */
export async function expireDraftingInputsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof draftingInputsAttemptArgs>
): Promise<null> {
  return await failAttempt(ctx, args, "timed_out");
}

/** Argument validators of generations.retryDraftingInputs. */
export const retryDraftingInputsArgs = { generationId: v.id("generations") };

/** Handler of generations.retryDraftingInputs: the writer starts a new
 * attempt after a failure, or after an attempt that stayed preparing past
 * its lease (settled here as the lease check would have). Needs the
 * prose-edit capability, like sign-off. After a cut-off analysis the new
 * attempt asks for a shorter one. */
export async function retryDraftingInputsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof retryDraftingInputsArgs>
): Promise<null> {
  const existing = await ctx.db.get(args.generationId);
  if (!existing) domainError("NOT_FOUND", "Generation not found");
  await requireReportEditAccess(ctx, existing.projectId);
  const generation = await openSeedStage(ctx, args.generationId);
  if (!generation) {
    domainError("INVALID_STATE", "The seed stage is closed", {
      reason: "SEED_STAGE_CLOSED",
    });
  }
  let current = generation;
  let drafting = generation.draftingInputs;
  if (drafting && preparingPastLease(drafting, Date.now())) {
    await settleFailed(ctx, generation, drafting, "timed_out");
    current = (await ctx.db.get(generation._id)) ?? generation;
    drafting = current.draftingInputs;
  }
  if (!drafting || drafting.status !== "failed") {
    domainError("INVALID_STATE", "The transcript analysis has not failed, so there is nothing to try again");
  }
  const attempt = drafting.attempt + 1;
  const shorterAnalysis =
    drafting.shorterAnalysis === true || drafting.failureCode === "output_limit";
  await transitionDraftingInputs(ctx, current, {
    status: "preparing",
    attempt,
    startedAt: Date.now(),
    ...(shorterAnalysis ? { shorterAnalysis: true } : {}),
  });
  await scheduleAttempt(ctx, generation._id, attempt, shorterAnalysis);
  return null;
}

/**
 * Sign-off precondition: drafting reads the analysis and the Brain blocks,
 * so a seed stage whose background step is still preparing or failed cannot
 * be signed off. The artifacts themselves are re-read by the sign-off, which
 * refuses when they are missing (a generation from before the reorder).
 */
export function requireDraftingInputsReady(generation: Doc<"generations">): void {
  const state = draftingInputsStateOf(generation.draftingInputs);
  if (state === "preparing") {
    domainError("INVALID_STATE", "The transcript analysis is still running. Sign off when it finishes", {
      reason: "DRAFTING_INPUTS_PREPARING",
    });
  }
  if (state === "failed") {
    domainError("INVALID_STATE", "The transcript analysis did not finish. Try it again before you sign off", {
      reason: "DRAFTING_INPUTS_FAILED",
    });
  }
}
