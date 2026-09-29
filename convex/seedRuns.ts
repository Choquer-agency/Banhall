import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../shared/pdSubsections";
import { MODEL } from "./ai/model";
import { buildSeedPrompt, seedPromptProjection } from "./ai/trustedContext";
import { domainError } from "./lib/contracts";
import { notifyIdeasReady } from "./lib/generations/notifications";
import { resolveGenerationStep } from "./lib/generationSteps";
import { reconcileRestoredSeedApproval } from "./lib/seedDecisionWrites";
import { checkSeedSpeakers, checkedCitations, citationSpeakerReader } from "./lib/citationSpeakers";
import { resolveGatedWorkflow } from "./lib/gatedWorkflow";
import {
  SEED_ATTEMPT_LEASE_MS,
  SEED_ATTEMPT_REQUESTS_RESERVED,
  seedDedupeKey,
  seedOperationClass,
  type SeedOperation,
} from "./lib/seedDispatch";
import {
  MAX_SEED_SNAPSHOT_ROWS,
  SeedContextLimitError,
  decodeBatchContext,
  encodeBatchContext,
  sha256Text,
} from "./lib/seedRevisions";
import {
  loadFrozenSeedActionInput,
  loadSeedDispatchSnapshot,
  loadUncertaintyRoots,
  MAX_SEED_SOURCE_ROWS,
} from "./lib/seedSnapshotLoader";
import {
  SEED_TAGS,
  locateCitations,
  seedAnswerCounts,
  validateBatch,
  withQuoteChecks,
  type CitationLocation,
  type FrozenSeedSource,
  type SeedReferenceContext,
} from "./lib/seedContract";
import { MAX_RECORDED_ANSWERS, seedAnswerCountsValidator } from "./lib/seedAnswerCounts";
import { createSeedDecisionBudget } from "./lib/seedDecisionState";
import {
  adjustSeedRequestsReserved,
  bumpSeedStageVersion,
} from "./generations";
import {
  factModeCitations,
  factStamp,
  readsFactPacks,
  type FactSource,
} from "./lib/seedFacts";

const seedRoleIdValidator = v.union(
  ...PD_SUBSECTIONS.map((subsection) => v.literal(subsection.roleId))
);
const seedOperationValidator = v.union(
  v.literal("open"),
  v.literal("prefetch"),
  v.literal("retry"),
  v.literal("regenerate"),
  v.literal("feedback")
);
const seedTagValidator = v.union(...SEED_TAGS.map((tag) => v.literal(tag)));
const seedCandidateValidator = v.object({
  bullets: v.array(v.string()),
  tags: v.array(seedTagValidator),
  provenance: v.array(
    v.object({
      sourceId: v.id("generationSources"),
      startOffset: v.number(),
      endOffset: v.number(),
      exactExcerpt: v.string(),
      // 2026-09-24 (transcript method): the fact a transcript citation was
      // resolved from; checked against the frozen spans below.
      factId: v.optional(v.string()),
    })
  ),
  uncertaintySeedId: v.optional(v.id("seeds")),
  experimentSeedIds: v.optional(v.array(v.id("seeds"))),
});
const failureCodeValidator = v.union(
  v.literal("PROVIDER_FAILED"),
  v.literal("INVALID_OUTPUT"),
  v.literal("CONTEXT_LIMIT"),
  v.literal("INTERNAL_ERROR"),
  v.literal("LEASE_EXPIRED"),
  v.literal("GENERATION_TERMINATED")
);

const failureDetailValidator = v.union(
  v.literal("advancement_links"),
  v.literal("experiment_links")
);

type SeedFailureCode =
  | "PROVIDER_FAILED"
  | "INVALID_OUTPUT"
  | "CONTEXT_LIMIT"
  | "INTERNAL_ERROR"
  | "LEASE_EXPIRED"
  | "GENERATION_TERMINATED";

const generateBatchRef = makeFunctionReference<
  "action",
  { batchId: Id<"seedBatches"> },
  void
>("ai/seeds:generateBatch");

const expireAttemptRef = makeFunctionReference<
  "mutation",
  { batchId: Id<"seedBatches">; attemptId: string },
  null
>("seedRuns:expireAttempt");

type DispatchArgs = {
  generationId: Id<"generations">;
  roleId: PdSubsectionRoleId;
  operation: SeedOperation;
  commandId: string;
  feedbackRequestId?: Id<"seedFeedbackRequests">;
  actorUserId?: Id<"users">;
  bumpVersion?: boolean;
  budget?: import("./lib/seedDecisionState").SeedDecisionReadBudget;
  /** Decision 65: the server's first Batch, kept out of writer-wait metrics. */
  startedBy?: "server";
};

export type SeedDispatchResult =
  | { kind: "dispatched"; batchId: Id<"seedBatches"> }
  | { kind: "reused"; batchId: Id<"seedBatches"> }
  | { kind: "history"; batchId: Id<"seedBatches"> }
  | { kind: "not_dispatched"; reason: "prefetch_ineligible" };

function roleDefinition(roleId: PdSubsectionRoleId) {
  const role = PD_SUBSECTIONS.find((candidate) => candidate.roleId === roleId);
  if (!role) throw new Error(`Unknown seed role: ${roleId}`);
  return role;
}

async function seedStageFence(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"generations">
): Promise<{
  generation: Doc<"generations">;
  project: Doc<"projects">;
}> {
  const generation = await ctx.db.get(generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  const project = await ctx.db.get(generation.projectId);
  if (!project) domainError("NOT_FOUND", "Project not found");
  if (project.deletionStartedAt !== undefined) {
    domainError("INVALID_STATE", "Project is being deleted");
  }
  if (project.activeGenerationId !== generation._id) {
    domainError("INVALID_STATE", "This generation is no longer active");
  }
  if (generation.status !== "awaiting_input") {
    domainError("INVALID_STATE", "The seed stage is not awaiting writer input", {
      reason: "SEED_STAGE_CLOSED",
    });
  }
  if (resolveGatedWorkflow(generation) !== "seeds") {
    domainError("INVALID_STATE", "This generation does not use the seed workflow");
  }
  return { generation, project };
}

async function roleRow(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"generations">,
  roleId: PdSubsectionRoleId
) {
  const rows = await ctx.db
    .query("seedSubsections")
    .withIndex("by_generationId_and_roleId", (q) =>
      q.eq("generationId", generationId).eq("roleId", roleId)
    )
    .take(2);
  if (rows.length !== 1) {
    domainError("INVALID_STATE", "Seed subsection is missing or duplicated");
  }
  return rows[0];
}

async function latestRoleBatch(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"generations">,
  roleId: PdSubsectionRoleId
) {
  return await ctx.db
    .query("seedBatches")
    .withIndex("by_generationId_and_roleId", (q) =>
      q.eq("generationId", generationId).eq("roleId", roleId)
    )
    .order("desc")
    .first();
}

async function existingCommandBatch(
  ctx: Pick<MutationCtx, "db">,
  args: DispatchArgs
) {
  if (seedOperationClass(args.operation) !== "command") return null;
  const batch = await ctx.db
    .query("seedBatches")
    .withIndex("by_generationId_and_roleId_and_commandId", (q) =>
      q
        .eq("generationId", args.generationId)
        .eq("roleId", args.roleId)
        .eq("commandId", args.commandId)
    )
    .order("desc")
    .first();
  if (!batch) return null;
  if (
    batch.operation !== args.operation ||
    batch.feedbackRequestId !== args.feedbackRequestId
  ) {
    domainError("INVALID_INPUT", "Command id was already used for different seed work");
  }
  return batch;
}

async function hasQueuedPrefetch(
  ctx: Pick<MutationCtx, "db">,
  generationId: Id<"generations">
): Promise<boolean> {
  const rows = await ctx.db
    .query("seedSubsections")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(14);
  for (const row of rows) {
    if (!row.pendingBatchId) continue;
    const batch = await ctx.db.get(row.pendingBatchId);
    if (
      batch?.operation === "prefetch" &&
      (batch.status === "queued" || batch.status === "running")
    ) return true;
  }
  return false;
}

/**
 * 2026-09-27 (third): a writer now waits on this Batch. A queued or running
 * prefetch is marked so it never spends the quote repair (ai/seeds.ts);
 * anything else already counts as waited on. Idempotent.
 */
export async function markWriterWaiting(
  ctx: Pick<MutationCtx, "db">,
  batchId: Id<"seedBatches"> | undefined
): Promise<void> {
  if (!batchId) return;
  const batch = await ctx.db.get(batchId);
  if (
    batch?.operation === "prefetch" &&
    (batch.status === "queued" || batch.status === "running") &&
    batch.writerWaitingAt === undefined
  ) {
    await ctx.db.patch(batch._id, { writerWaitingAt: Date.now() });
  }
}

/** Plain transaction helper so Story 3 can dispatch inside a decision write. */
export async function dispatchSeedAttempt(
  ctx: MutationCtx,
  args: DispatchArgs
): Promise<SeedDispatchResult> {
  const { generation, project } = await seedStageFence(ctx, args.generationId);
  const subsection = await roleRow(ctx, args.generationId, args.roleId);

  const redelivered = await existingCommandBatch(ctx, args);
  if (redelivered) return { kind: "reused", batchId: redelivered._id };

  if (args.operation === "open") {
    if (subsection.pendingBatchId) {
      await markWriterWaiting(ctx, subsection.pendingBatchId);
      return { kind: "reused", batchId: subsection.pendingBatchId };
    }
    if (subsection.shownBatchId) {
      return { kind: "reused", batchId: subsection.shownBatchId };
    }
    const history = await latestRoleBatch(ctx, args.generationId, args.roleId);
    if (history) return { kind: "history", batchId: history._id };
  }

  if (args.operation === "prefetch") {
    if (subsection.pendingBatchId) {
      const pending = await ctx.db.get(subsection.pendingBatchId);
      if (
        pending &&
        seedOperationClass(pending.operation) === "initial" &&
        (pending.status === "queued" || pending.status === "running") &&
        pending.consumedContextRevision === subsection.currentContextRevision
      ) {
        return { kind: "reused", batchId: pending._id };
      }
    }
    const history = await latestRoleBatch(ctx, args.generationId, args.roleId);
    if (
      subsection.state !== "untouched" ||
      subsection.pendingBatchId ||
      subsection.shownBatchId ||
      history ||
      (await hasQueuedPrefetch(ctx, args.generationId))
    ) {
      return { kind: "not_dispatched", reason: "prefetch_ineligible" };
    }
  }

  const loaded = await loadSeedDispatchSnapshot(ctx, {
    generationId: args.generationId,
    roleId: args.roleId,
    budget: args.budget,
    ...(args.feedbackRequestId
      ? { feedbackRequestId: args.feedbackRequestId }
      : {}),
  });
  if (loaded.contextRevision !== subsection.currentContextRevision) {
    domainError("INVALID_STATE", "Seed context revision does not match its decisions");
  }
  const dedupeKey = await seedDedupeKey({
    generationId: args.generationId,
    roleId: args.roleId,
    operation: args.operation,
    contextRevision: loaded.contextRevision,
    ...(args.feedbackRequestId
      ? { feedbackRequestId: args.feedbackRequestId }
      : {}),
    commandId: args.commandId,
  });
  const duplicate = await ctx.db
    .query("seedBatches")
    .withIndex("by_generationId_and_dedupeKey", (q) =>
      q.eq("generationId", args.generationId).eq("dedupeKey", dedupeKey)
    )
    .order("desc")
    .first();

  if (args.operation === "retry") {
    if (subsection.pendingBatchId) {
      if (
        duplicate?._id === subsection.pendingBatchId &&
        (duplicate.status === "queued" || duplicate.status === "running")
      ) {
        return { kind: "reused", batchId: duplicate._id };
      }
      domainError("INVALID_STATE", "Different seed work is already pending");
    }
    const latest = await latestRoleBatch(ctx, args.generationId, args.roleId);
    if (!latest || latest.status !== "failed") {
      domainError("INVALID_STATE", "Retry requires a failed latest attempt");
    }
  } else if (duplicate && (duplicate.status === "queued" || duplicate.status === "running")) {
    return { kind: "reused", batchId: duplicate._id };
  }

  if (subsection.pendingBatchId) {
    domainError("INVALID_STATE", "Seed work is already pending for this role");
  }
  if (args.operation === "feedback" && !args.feedbackRequestId) {
    domainError("INVALID_INPUT", "Feedback dispatch requires a feedback request");
  }

  const briefVersionId = generation.briefVersionId;
  if (!briefVersionId) {
    domainError("INVALID_STATE", "Seed stage has no frozen Brief");
  }
  let frozen: Awaited<ReturnType<typeof loadFrozenSeedActionInput>>;
  try {
    frozen = await loadFrozenSeedActionInput(ctx, { generation, briefVersionId, budget: args.budget });
    buildSeedPrompt({
      mode: args.operation === "feedback" ? "feedback" : "batch",
      objective: roleDefinition(args.roleId).objective,
      brief: { ...frozen.brief, entries: frozen.briefEntries },
      sources: frozen.sources.map((source) => ({
        sourceId: source._id,
        label: source.label,
        kind: source.kind,
        content: source.content,
        contentHash: source.contentHash,
        ...(source.transcriptId ? { transcriptId: source.transcriptId } : {}),
      })),
      projection: seedPromptProjection(loaded.snapshot),
      writerSettings: frozen.writerSettings,
      lengthTarget: frozen.lengthTarget,
    });
  } catch (error) {
    if (error instanceof SeedContextLimitError) {
      domainError("INVALID_INPUT", `Seed context for ${args.roleId} exceeds the prompt limit`, { reason: "SEED_PROCESSING_LIMIT" });
    }
    throw error;
  }

  const now = Date.now();
  const settingsHash = await sha256Text(
    JSON.stringify({
      writerSettings: frozen.writerSettings ?? null,
      lengthTarget: frozen.lengthTarget,
    })
  );
  const attemptId = crypto.randomUUID();
  const batchId = await ctx.db.insert("seedBatches", {
    projectId: project._id,
    generationId: generation._id,
    roleId: args.roleId,
    operation: args.operation,
    dedupeKey,
    commandId: args.commandId,
    attemptId,
    ...(args.feedbackRequestId
      ? { feedbackRequestId: args.feedbackRequestId }
      : {}),
    consumedContextRevision: loaded.contextRevision,
    briefVersionId,
    settingsHash,
    status: "queued",
    queuedAt: now,
    leaseExpiresAt: now + SEED_ATTEMPT_LEASE_MS,
    // Owner decision 43: seed cards run on the generation's frozen planning
    // model; a generation frozen before step routing keeps the writer's.
    model: resolveGenerationStep({
      freeze: generation.modelFreeze,
      step: args.operation === "feedback" ? "seedFeedback" : "seeds",
      writerModel: generation.singleModelId ?? MODEL,
    }).model,
    slot:
      args.operation === "feedback"
        ? `generation:seedFeedback:${args.roleId}`
        : `generation:seeds:${args.roleId}`,
    promptVersion: generation.promptVersion ?? "unversioned",
    roleOpen: args.operation === "open",
    ...(args.startedBy ? { startedBy: args.startedBy } : {}),
    requestsReserved: SEED_ATTEMPT_REQUESTS_RESERVED,
  });
  const encoded = await encodeBatchContext(loaded.snapshot, {
    targetRoleId: args.roleId,
  });
  for (const row of encoded) {
    await ctx.db.insert("seedBatchContext", {
      projectId: project._id,
      generationId: generation._id,
      batchId,
      roleId: row.roleId,
      sourceRoleId: row.sourceRoleId,
      kind: row.kind,
      ...(row.seedId
        ? { seedId: ctx.db.normalizeId("seeds", row.seedId) ?? undefined }
        : {}),
      ...(row.uncertaintySeedId
        ? {
            uncertaintySeedId:
              ctx.db.normalizeId("seeds", row.uncertaintySeedId) ?? undefined,
          }
        : {}),
      ...(row.feedbackRequestId
        ? {
            feedbackRequestId:
              ctx.db.normalizeId("seedFeedbackRequests", row.feedbackRequestId) ??
              undefined,
          }
        : {}),
      ...(row.bullets ? { bullets: row.bullets } : {}),
      ...(row.text !== undefined ? { text: row.text } : {}),
      order: row.order,
      contributionHash: row.contributionHash,
    });
  }
  await ctx.db.patch(subsection._id, {
    priorState: subsection.state,
    pendingApprovalReasons: undefined,
    state: "generating",
    pendingBatchId: batchId,
  });
  await adjustSeedRequestsReserved(
    ctx,
    generation._id,
    SEED_ATTEMPT_REQUESTS_RESERVED
  );
  if (args.bumpVersion !== false) await bumpSeedStageVersion(ctx, generation._id);
  await ctx.db.insert("seedDecisionEvents", {
    projectId: project._id,
    generationId: generation._id,
    kind: "batchDispatched",
    roleId: args.roleId,
    at: now,
    ...(args.operation === "prefetch"
      ? { actorSystem: true as const }
      : args.actorUserId
        ? { actorUserId: args.actorUserId }
        : { actorSystem: true as const }),
    batchId,
    attemptId,
    contextRevision: loaded.contextRevision,
  });
  await ctx.scheduler.runAfter(0, generateBatchRef, { batchId });
  // The attempt's own lease check (audit 2026-09-25 a3 P3): an attempt whose
  // action was killed fails when its lease ends, not at the next reaper
  // sweep up to ten minutes later.
  await ctx.scheduler.runAfter(SEED_ATTEMPT_LEASE_MS, expireAttemptRef, {
    batchId,
    attemptId,
  });
  return { kind: "dispatched", batchId };
}

export const dispatch = internalMutation({
  args: {
    generationId: v.id("generations"),
    roleId: seedRoleIdValidator,
    operation: seedOperationValidator,
    commandId: v.string(),
    feedbackRequestId: v.optional(v.id("seedFeedbackRequests")),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => await dispatchSeedAttempt(ctx, args),
});

/** The command id of the server's first Batch: one per generation. */
export function firstBatchCommandId(generationId: Id<"generations">): string {
  return `server-open:${generationId}`;
}

export type FirstBatchResult =
  | SeedDispatchResult
  | { kind: "skipped"; reason: "closed" | "started" };

/**
 * Owner decision 65 (eighth 2026-09-26 amendment): once the seed stage
 * opens, the server starts the first step's Batch itself, so the first
 * ideas are written even if nobody has the Seed workspace open. It is the
 * browser's `open` (same fence, read budget, freeze, validation, dedupe and
 * "ideas ready" notification), sent by the system. Idempotent: a closed
 * stage, or a first step that is no longer untouched or already has a Batch
 * (a repeated delivery, or the browser opened it first), is left alone. A
 * refusal from the dispatch itself rolls this back and the browser's own
 * open meets the same refusal, as before.
 */
export async function startFirstSeedBatch(
  ctx: MutationCtx,
  generationId: Id<"generations">
): Promise<FirstBatchResult> {
  const generation = await ctx.db.get(generationId);
  const project = generation ? await ctx.db.get(generation.projectId) : null;
  if (
    !generation ||
    !project ||
    project.deletionStartedAt !== undefined ||
    project.activeGenerationId !== generation._id ||
    generation.status !== "awaiting_input" ||
    generation.summaryVersionId ||
    resolveGatedWorkflow(generation) !== "seeds"
  ) {
    return { kind: "skipped", reason: "closed" };
  }
  // Only the first step counts: a writer who opened another step first
  // (a deep link) still gets the first step's Batch.
  const roleId = PD_SUBSECTIONS[0].roleId;
  const row = await roleRow(ctx, generationId, roleId);
  if (
    row.state !== "untouched" ||
    row.pendingBatchId ||
    row.shownBatchId ||
    (await latestRoleBatch(ctx, generationId, roleId))
  ) {
    return { kind: "skipped", reason: "started" };
  }
  return await dispatchSeedAttempt(ctx, {
    generationId,
    roleId,
    operation: "open",
    commandId: firstBatchCommandId(generationId),
    startedBy: "server",
    // The budget a browser open's fence builds (convex/seeds.ts).
    budget: createSeedDecisionBudget(),
  });
}

export const startFirstBatch = internalMutation({
  args: { generationId: v.id("generations") },
  returns: v.union(
    v.object({
      kind: v.union(v.literal("dispatched"), v.literal("reused"), v.literal("history")),
      batchId: v.id("seedBatches"),
    }),
    v.object({ kind: v.literal("not_dispatched"), reason: v.literal("prefetch_ineligible") }),
    v.object({
      kind: v.literal("skipped"),
      reason: v.union(v.literal("closed"), v.literal("started")),
    })
  ),
  handler: async (ctx, args): Promise<FirstBatchResult> =>
    await startFirstSeedBatch(ctx, args.generationId),
});

type NotClaimedReason =
  | "missing"
  | "not_queued"
  | "inactive_generation"
  | "wrong_phase"
  | "wrong_workflow"
  | "deleting"
  | "not_pending"
  | "lease_expired";

function notClaimed(reason: NotClaimedReason) {
  return { kind: "not_claimed" as const, reason };
}

export const claimAttempt = internalMutation({
  args: { batchId: v.id("seedBatches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return notClaimed("missing");
    if (batch.status !== "queued") return notClaimed("not_queued");
    const [generation, project, subsection] = await Promise.all([
      ctx.db.get(batch.generationId),
      ctx.db.get(batch.projectId),
      roleRow(ctx, batch.generationId, batch.roleId),
    ]);
    if (!generation || !project || project.activeGenerationId !== batch.generationId) {
      return notClaimed("inactive_generation");
    }
    if (project.deletionStartedAt !== undefined) return notClaimed("deleting");
    if (generation.status !== "awaiting_input") return notClaimed("wrong_phase");
    if (resolveGatedWorkflow(generation) !== "seeds") return notClaimed("wrong_workflow");
    if (subsection.pendingBatchId !== batch._id) return notClaimed("not_pending");
    if (batch.leaseExpiresAt <= Date.now()) {
      await failSeedAttempt(ctx, {
        batch, requestsMade: batch.requestsReserved, errorCode: "LEASE_EXPIRED",
      });
      return notClaimed("lease_expired");
    }

    const contextRows = await ctx.db
      .query("seedBatchContext")
      .withIndex("by_batchId", (q) => q.eq("batchId", batch._id))
      .take(MAX_SEED_SNAPSHOT_ROWS + 1);
    if (contextRows.length > MAX_SEED_SNAPSHOT_ROWS) {
      throw new Error("Seed attempt context exceeds its bounded row limit");
    }
    const context = decodeBatchContext(contextRows);
    // 2026-09-29 (first, review P2-2): an uncertainty and its revisions are one.
    const uncertaintyRoots =
      batch.roleId === "specific_advancements" ? await loadUncertaintyRoots(ctx, context) : {};
    const input = await loadFrozenSeedActionInput(ctx, {
      generation,
      briefVersionId: batch.briefVersionId,
    });
    const now = Date.now();
    await ctx.db.patch(batch._id, { status: "running", startedAt: now });
    await bumpSeedStageVersion(ctx, generation._id);
    const role = roleDefinition(batch.roleId);
    return {
      kind: "claimed" as const,
      batch: {
        batchId: batch._id,
        attemptId: batch.attemptId,
        projectId: batch.projectId,
        generationId: batch.generationId,
        roleId: batch.roleId,
        operation: batch.operation,
        feedbackRequestId: batch.feedbackRequestId,
        model: batch.model,
        slot: batch.slot,
        promptVersion: batch.promptVersion,
        consumedContextRevision: batch.consumedContextRevision,
      },
      role: {
        roleId: role.roleId,
        kind: role.kind,
        objective: role.objective,
        title: role.title,
      },
      context,
      uncertaintyRoots,
      input,
    };
  },
});

function settledRequestCount(batch: Doc<"seedBatches">, requestsMade: number): number {
  return Math.max(0, Math.min(batch.requestsReserved, Math.floor(requestsMade)));
}

async function settleSeedAttempt(
  ctx: MutationCtx,
  batch: Doc<"seedBatches">,
  requestsMade: number
): Promise<boolean> {
  if (batch.settledAt !== undefined) return false;
  const settled = settledRequestCount(batch, requestsMade);
  await ctx.db.patch(batch._id, {
    requestsMade: settled,
    settledAt: Date.now(),
  });
  const generation = await ctx.db.get(batch.generationId);
  if (generation) {
    await adjustSeedRequestsReserved(
      ctx,
      generation._id,
      -(batch.requestsReserved - settled)
    );
  }
  return true;
}

export const settleAttempt = internalMutation({
  args: {
    batchId: v.id("seedBatches"),
    attemptId: v.string(),
    requestsMade: v.number(),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.attemptId !== args.attemptId) return false;
    const settled = await settleSeedAttempt(ctx, batch, args.requestsMade);
    if (settled && (await ctx.db.get(batch.generationId))) {
      await bumpSeedStageVersion(ctx, batch.generationId);
    }
    return settled;
  },
});

async function recordLateCompletion(
  ctx: MutationCtx,
  batch: Doc<"seedBatches">,
  now: number
) {
  if (batch.deliveredLateAt !== undefined) return;
  await ctx.db.patch(batch._id, { deliveredLateAt: now });
  const [generation, project] = await Promise.all([
    ctx.db.get(batch.generationId),
    ctx.db.get(batch.projectId),
  ]);
  if (!generation || !project || project.deletionStartedAt !== undefined) return;
  await ctx.db.insert("seedDecisionEvents", {
    projectId: batch.projectId,
    generationId: batch.generationId,
    kind: "batchLate",
    roleId: batch.roleId,
    at: now,
    actorSystem: true,
    batchId: batch._id,
    attemptId: batch.attemptId,
    outcome: batch.status,
  });
  await bumpSeedStageVersion(ctx, batch.generationId);
}

async function failSeedAttempt(
  ctx: MutationCtx,
  args: {
    batch: Doc<"seedBatches">;
    requestsMade: number;
    errorCode: SeedFailureCode;
    errorDetail?: "advancement_links" | "experiment_links";
    /** 2026-09-29 (first, run 7): the rejected answers as counts. */
    invalidAnswers?: Infer<typeof seedAnswerCountsValidator>[];
    actorSystem?: boolean;
    bumpVersion?: boolean;
  }
) {
  const now = Date.now();
  const current = await ctx.db.get(args.batch._id);
  if (!current) return { kind: "missing" as const };
  await settleSeedAttempt(ctx, current, args.requestsMade);
  if (current.status !== "queued" && current.status !== "running") {
    await recordLateCompletion(ctx, current, now);
    return { kind: "terminal" as const, status: current.status };
  }

  await ctx.db.patch(current._id, {
    status: "failed",
    completedAt: now,
    error: args.errorCode,
    ...(args.errorDetail ? { errorDetail: args.errorDetail } : {}),
    ...(args.invalidAnswers?.length
      ? { invalidAnswers: args.invalidAnswers.slice(-MAX_RECORDED_ANSWERS) }
      : {}),
  });
  const [generation, project] = await Promise.all([
    ctx.db.get(current.generationId),
    ctx.db.get(current.projectId),
  ]);
  const subsectionRows = await ctx.db
    .query("seedSubsections")
    .withIndex("by_generationId_and_roleId", (q) =>
      q.eq("generationId", current.generationId).eq("roleId", current.roleId)
    )
    .take(2);
  const subsection = subsectionRows.length === 1 ? subsectionRows[0] : null;
  if (subsection?.pendingBatchId === current._id) {
    // A deliberate stop (skip, cancel, deletion) is not a failed attempt: it
    // neither says "Writing seeds for this step failed" nor counts toward
    // the three-failure state (step-by-step review s1 P3-2).
    const failures =
      args.errorCode === "GENERATION_TERMINATED"
        ? subsection.consecutiveFailures
        : subsection.consecutiveFailures + 1;
    const wasGenerating = subsection.state === "generating";
    const restored = wasGenerating
      ? subsection.priorState ?? "untouched"
      : subsection.state;
    const nextState =
      wasGenerating && failures >= 3 && !subsection.shownBatchId
        ? "failed"
        : restored;
    // 2026-09-28 (fourth): answers that keep breaking the Seed contract are
    // counted apart, so the step can say why instead of only "failed".
    const invalidOutputStreak =
      args.errorCode === "INVALID_OUTPUT"
        ? {
            failures: (subsection.invalidOutputStreak?.failures ?? 0) + 1,
            ...(args.errorDetail ? { detail: args.errorDetail } : {}),
          }
        : args.errorCode === "GENERATION_TERMINATED"
          ? subsection.invalidOutputStreak
          : undefined;
    await ctx.db.patch(subsection._id, {
      pendingBatchId: undefined,
      priorState: undefined,
      pendingApprovalReasons: undefined,
      consecutiveFailures: failures,
      invalidOutputStreak,
      state: nextState,
    });
    if (
      wasGenerating &&
      nextState === "approved" &&
      args.errorCode !== "GENERATION_TERMINATED" &&
      generation?.status === "awaiting_input" &&
      resolveGatedWorkflow(generation) === "seeds" &&
      !generation.summaryVersionId &&
      project?.activeGenerationId === generation._id &&
      project.deletionStartedAt === undefined
    ) {
      await reconcileRestoredSeedApproval(ctx, { ...subsection, state: nextState });
    }
  }
  if (generation && args.bumpVersion !== false) await bumpSeedStageVersion(ctx, generation._id);
  if (generation && project && project.deletionStartedAt === undefined) {
    await ctx.db.insert("seedDecisionEvents", {
      projectId: current.projectId,
      generationId: current.generationId,
      kind: "batchFailed",
      roleId: current.roleId,
      at: now,
      actorSystem: true,
      batchId: current._id,
      attemptId: current.attemptId,
      outcome: args.errorCode,
    });
  }
  return { kind: "failed" as const };
}

/**
 * Fails one attempt still queued or running when its lease ends, like the
 * reaper sweep does. A settled attempt, or a newer attempt on the same
 * row, is left alone.
 */
export const expireAttempt = internalMutation({
  args: { batchId: v.id("seedBatches"), attemptId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (
      !batch ||
      batch.attemptId !== args.attemptId ||
      (batch.status !== "queued" && batch.status !== "running") ||
      batch.leaseExpiresAt > Date.now()
    ) {
      return null;
    }
    await failSeedAttempt(ctx, {
      batch,
      requestsMade: batch.requestsReserved,
      errorCode: "LEASE_EXPIRED",
      actorSystem: true,
    });
    return null;
  },
});

export const failAttempt = internalMutation({
  args: {
    batchId: v.id("seedBatches"),
    attemptId: v.string(),
    requestsMade: v.number(),
    errorCode: failureCodeValidator,
    errorDetail: v.optional(failureDetailValidator),
    invalidAnswers: v.optional(v.array(seedAnswerCountsValidator)),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.attemptId !== args.attemptId) return { kind: "missing" as const };
    return await failSeedAttempt(ctx, {
      batch,
      requestsMade: args.requestsMade,
      errorCode: args.errorCode,
      ...(args.errorDetail ? { errorDetail: args.errorDetail } : {}),
      ...(args.invalidAnswers ? { invalidAnswers: args.invalidAnswers } : {}),
    });
  },
});

export const completeAttempt = internalMutation({
  args: {
    batchId: v.id("seedBatches"),
    attemptId: v.string(),
    requestsMade: v.number(),
    seeds: v.array(seedCandidateValidator),
    seedsDropped: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.attemptId !== args.attemptId) return { kind: "missing" as const };
    const now = Date.now();
    await settleSeedAttempt(ctx, batch, args.requestsMade);
    if (batch.status !== "running") {
      await recordLateCompletion(ctx, batch, now);
      return { kind: "late" as const };
    }

    if (batch.leaseExpiresAt <= now) {
      await failSeedAttempt(ctx, { batch, requestsMade: args.requestsMade, errorCode: "LEASE_EXPIRED" });
      const expired = await ctx.db.get(batch._id);
      if (expired) await recordLateCompletion(ctx, expired, now);
      return { kind: "late" as const };
    }

    const [generation, project, subsectionRows, contextRows, sources] =
      await Promise.all([
        ctx.db.get(batch.generationId),
        ctx.db.get(batch.projectId),
        ctx.db
          .query("seedSubsections")
          .withIndex("by_generationId_and_roleId", (q) =>
            q.eq("generationId", batch.generationId).eq("roleId", batch.roleId)
          )
          .take(2),
        ctx.db
          .query("seedBatchContext")
          .withIndex("by_batchId", (q) => q.eq("batchId", batch._id))
          .take(MAX_SEED_SNAPSHOT_ROWS + 1),
        ctx.db
          .query("generationSources")
          .withIndex("by_generationId", (q) => q.eq("generationId", batch.generationId))
          .take(MAX_SEED_SOURCE_ROWS + 1),
      ]);
    if (
      contextRows.length > MAX_SEED_SNAPSHOT_ROWS ||
      sources.length > MAX_SEED_SOURCE_ROWS
    ) {
      return await failSeedAttempt(ctx, {
        batch,
        requestsMade: args.requestsMade,
        errorCode: "CONTEXT_LIMIT",
      });
    }
    const subsection = subsectionRows.length === 1 ? subsectionRows[0] : null;
    const ownsAttempt =
      generation !== null &&
      project !== null &&
      project.deletionStartedAt === undefined &&
      project.activeGenerationId === batch.generationId &&
      generation.status === "awaiting_input" &&
      resolveGatedWorkflow(generation) === "seeds" &&
      subsection?.pendingBatchId === batch._id;
    if (!ownsAttempt) {
      await recordLateCompletion(ctx, batch, now);
      return { kind: "late" as const };
    }

    const snapshot = decodeBatchContext(contextRows);
    const referenceContext: SeedReferenceContext = {
      generationId: batch.generationId,
      ...(batch.roleId === "specific_advancements"
        ? { uncertaintyRoots: await loadUncertaintyRoots(ctx, snapshot) }
        : {}),
      references: snapshot.items
        .filter((item) => item.kind === "selection")
        .map((item) => ({
          seedId: item.seedId,
          generationId: batch.generationId,
          roleId: item.roleId,
          active: true,
          ...(item.uncertaintySeedId ? { uncertaintySeedId: item.uncertaintySeedId } : {}),
        })),
    };
    const frozenSources: FrozenSeedSource[] = sources.map((source) => ({
      sourceId: source._id,
      generationId: source.generationId,
      content: source.content,
      contentHash: source.contentHash,
    }));
    // Transcript method (plan step 7, owner decision 25): with a fact pack
    // for every transcript, a transcript row is cited only at a verified
    // span of the fact the citation names, and a pack or digest row never.
    // Other generations keep today's rule and carry no fact ids.
    const factSources: FactSource[] = sources.map((source) => ({
      sourceId: source._id,
      kind: source.kind,
      content: source.content,
      contentHash: source.contentHash,
      ...(source.transcriptId ? { transcriptId: source.transcriptId } : {}),
      ...(source.factSpans ? { factSpans: source.factSpans } : {}),
    }));
    const factMode = readsFactPacks(sources);
    let factDropped = 0;
    const candidateSeeds = args.seeds.map((seed) => {
      if (!factMode) {
        return {
          ...seed,
          provenance: seed.provenance.map(({ factId: _factId, ...citation }) => citation),
        };
      }
      const { kept, dropped } = factModeCitations(seed.provenance, factSources);
      factDropped += dropped;
      // Each dropped citation stays as a malformed item, so the Seed
      // contract reports it like any other bad citation (review P3-5).
      return { ...seed, provenance: [...kept, ...Array.from({ length: dropped }, () => null)] };
    });
    const validation = validateBatch({
      roleId: batch.roleId,
      mode: batch.operation === "feedback" ? "feedback" : "batch",
      seeds: candidateSeeds,
      referenceContext,
      frozenSources,
    });
    if (factDropped > 0) {
      console.warn(`Seed batch ${batch._id}: ${factDropped} citation(s) outside the frozen fact spans were dropped`);
    }
    if (!validation.ok) {
      return await failSeedAttempt(ctx, {
        batch,
        requestsMade: args.requestsMade,
        errorCode: "INVALID_OUTPUT",
        invalidAnswers: [seedAnswerCounts(validation, args.seeds.length)],
      });
    }

    const feedbackRequest = batch.feedbackRequestId
      ? await ctx.db.get(batch.feedbackRequestId)
      : null;
    const targetItems = snapshot.items.filter((item) => item.kind === "target");
    const feedbackTargetSeedId =
      targetItems.length === 1
        ? ctx.db.normalizeId("seeds", targetItems[0].seedId)
        : null;
    if (
      batch.operation === "feedback" &&
      (!feedbackRequest ||
        feedbackRequest.generationId !== batch.generationId ||
        feedbackRequest.roleId !== batch.roleId ||
        !feedbackTargetSeedId)
    ) {
      return await failSeedAttempt(ctx, {
        batch,
        requestsMade: args.requestsMade,
        errorCode: "INVALID_OUTPUT",
      });
    }

    // Owner decision 25 outside facts mode (2026-09-25): a transcript
    // citation of only the interviewer's or another speaker's words is
    // dropped (a Seed left with none stays, writer-asserted), and one of a
    // speaker with no role yet is marked for a speaker check. Facts mode
    // already cites verified client spans only. Transcripts without stored
    // turns keep today's byte check alone.
    let checkedSeeds = validation.seeds;
    if (!factMode) {
      const speakerChecked = await checkSeedSpeakers(
        citationSpeakerReader(ctx),
        validation.seeds,
        new Map(sources.map((source) => [source._id as string, source]))
      );
      checkedSeeds = speakerChecked.seeds;
      if (speakerChecked.dropped > 0) {
        console.warn(`Seed batch ${batch._id}: ${speakerChecked.dropped} citation(s) of interviewer or other speakers' words were dropped`);
      }
    }
    // 2026-09-27 (third): after the speaker check, so a dropped quote is
    // never judged. A quote that may not back its Seed is kept and marked.
    const quoteChecked = withQuoteChecks(checkedSeeds, batch.operation === "feedback" ? "feedback" : "batch");
    checkedSeeds = quoteChecked.seeds;
    if (quoteChecked.issues.length > 0) {
      console.warn(`Seed batch ${batch._id}: ${quoteChecked.issues.length} citation(s) marked for a quote check`);
    }

    const preparedSeeds = checkedSeeds.map((seed) => ({
      seed,
      uncertaintySeedId: seed.uncertaintySeedId
        ? ctx.db.normalizeId("seeds", seed.uncertaintySeedId)
        : null,
      experimentSeedIds: seed.experimentSeedIds?.map((id) =>
        ctx.db.normalizeId("seeds", id)
      ),
      provenance: seed.provenance.map((citation) => ({
        citation,
        sourceId: ctx.db.normalizeId("generationSources", citation.sourceId),
      })),
    }));
    if (
      preparedSeeds.some(
        ({ seed, uncertaintySeedId, experimentSeedIds, provenance }) =>
          (seed.uncertaintySeedId !== undefined && !uncertaintySeedId) ||
          experimentSeedIds?.some((id) => id === null) ||
          provenance.some(({ sourceId }) => sourceId === null)
      )
    ) {
      return await failSeedAttempt(ctx, {
        batch,
        requestsMade: args.requestsMade,
        errorCode: "INVALID_OUTPUT",
      });
    }

    // Speaker and line are stamped now, from the frozen transcript already in
    // hand, so readers never reread it. One pass per cited transcript;
    // documents, digests and the storyline carry neither. A citation that
    // came from a fact also gets the fact id and its turn's speaker, role
    // and time (2026-09-24, transcript method).
    const locations = new Map<object, CitationLocation>();
    const transcriptCitations = new Map<
      string,
      (typeof preparedSeeds)[number]["provenance"][number]["citation"][]
    >();
    for (const { provenance } of preparedSeeds) {
      for (const { citation } of provenance) {
        const list = transcriptCitations.get(citation.sourceId) ?? [];
        list.push(citation);
        transcriptCitations.set(citation.sourceId, list);
      }
    }
    for (const source of sources) {
      const cited = transcriptCitations.get(source._id);
      if (!cited || source.kind !== "transcript") continue;
      const located = locateCitations(source.content, cited);
      cited.forEach((citation, index) => locations.set(citation, located[index]));
    }

    for (let order = 0; order < preparedSeeds.length; order += 1) {
      const prepared = preparedSeeds[order];
      const seed = prepared.seed;
      const uncertaintySeedId = prepared.uncertaintySeedId;
      const experimentSeedIds = prepared.experimentSeedIds;
      const seedId = await ctx.db.insert("seeds", {
        projectId: batch.projectId,
        generationId: batch.generationId,
        batchId: batch._id,
        roleId: batch.roleId,
        order,
        bullets: seed.bullets,
        tags: seed.tags,
        support: seed.support,
        originalSupport: seed.originalSupport,
        ...(feedbackRequest && feedbackTargetSeedId
          ? {
              revisionOfSeedId: feedbackTargetSeedId,
              feedbackRequestId: feedbackRequest._id,
            }
          : {}),
        ...(uncertaintySeedId ? { uncertaintySeedId } : {}),
        ...(experimentSeedIds
          ? { experimentSeedIds: experimentSeedIds.filter((id) => id !== null) }
          : {}),
      });
      for (const { citation, sourceId } of prepared.provenance) {
        if (!sourceId) throw new Error("Validated seed provenance lost source identity");
        await ctx.db.insert("seedProvenance", {
          seedId,
          projectId: batch.projectId,
          generationId: batch.generationId,
          sourceId,
          sourceContentHash: citation.sourceContentHash,
          startOffset: citation.startOffset,
          endOffset: citation.endOffset,
          exactExcerpt: citation.exactExcerpt,
          ...locations.get(citation),
          ...(citation.needsSpeakerCheck ? { needsSpeakerCheck: true } : {}),
          ...(citation.needsQuoteCheck ? { needsQuoteCheck: true } : {}),
          ...(factMode ? factStamp(factSources, citation) : null),
        });
      }
    }

    if (batch.operation !== "feedback" && subsection.shownBatchId) {
      const previous = await ctx.db.get(subsection.shownBatchId);
      if (previous?.status === "shown") {
        await ctx.db.patch(previous._id, { status: "superseded" });
      }
    }
    if (feedbackRequest) {
      await ctx.db.patch(feedbackRequest._id, { batchId: batch._id });
    }
    await ctx.db.patch(batch._id, {
      status: "shown",
      completedAt: now,
      seedsDropped: (args.seedsDropped ?? 0) + validation.dropped,
      error: undefined,
    });
    await ctx.db.patch(subsection._id, {
      pendingBatchId: undefined,
      priorState: undefined,
      pendingApprovalReasons: undefined,
      state: subsection.state === "generating" ? "in_progress" : subsection.state,
      consecutiveFailures: 0,
      invalidOutputStreak: undefined,
      ...(batch.operation === "feedback" ? {} : { shownBatchId: batch._id }),
    });
    await bumpSeedStageVersion(ctx, generation._id);
    await ctx.db.insert("seedDecisionEvents", {
      projectId: batch.projectId,
      generationId: batch.generationId,
      kind: "batchCompleted",
      roleId: batch.roleId,
      at: now,
      actorSystem: true,
      batchId: batch._id,
      attemptId: batch.attemptId,
      contextRevision: batch.consumedContextRevision,
      outcome: "shown",
    });
    // Round 2 (WS3 F6): the writer who opened this step may have left the
    // page. Only an `open` Batch notifies (never a prefetch); the dedupe key
    // keeps it to the first one per step.
    if (batch.operation === "open") {
      await notifyIdeasReady(ctx, generation, batch.roleId);
    }
    return { kind: "completed" as const, seeds: validation.seeds.length };
  },
});

/**
 * 2026-09-27 (third): what a Seed action needs to decide on its quote
 * repair, in one read. `writerWaiting`: only a prefetch nobody has opened
 * or landed on is unwatched; the server's first Batch, a writer's open,
 * retry, regenerate and feedback always have someone waiting. `checked`: the
 * speaker check (owner decision 25) for each citation of each Seed given,
 * as completeAttempt will apply it, so the quote check never judges a
 * quote this check drops. Reads only the cited frozen rows of this
 * generation; a citation of another row is left to completeAttempt, which
 * refuses it.
 */
export const quoteRepairContext = internalQuery({
  args: {
    batchId: v.id("seedBatches"),
    generationId: v.id("generations"),
    seeds: v.array(
      v.object({
        provenance: v.array(
          v.object({
            sourceId: v.id("generationSources"),
            startOffset: v.number(),
            endOffset: v.number(),
            exactExcerpt: v.string(),
          })
        ),
      })
    ),
  },
  returns: v.object({
    writerWaiting: v.boolean(),
    checked: v.array(
      v.array(
        v.union(
          v.null(),
          v.object({ startOffset: v.number(), endOffset: v.number(), needsSpeakerCheck: v.boolean() })
        )
      )
    ),
  }),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    const writerWaiting = !batch || batch.operation !== "prefetch" || batch.writerWaitingAt !== undefined;
    const sources = new Map<string, Doc<"generationSources">>();
    for (const seed of args.seeds) {
      for (const citation of seed.provenance) {
        if (sources.has(citation.sourceId)) continue;
        const source = await ctx.db.get(citation.sourceId);
        if (source && source.generationId === args.generationId) sources.set(citation.sourceId, source);
      }
    }
    const reader = citationSpeakerReader(ctx);
    const checked = [];
    for (const seed of args.seeds) {
      checked.push(await checkedCitations(reader, seed.provenance, sources));
    }
    return { writerWaiting, checked };
  },
});

export const markSuperseded = internalMutation({
  args: { batchId: v.id("seedBatches") },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.status !== "shown") return false;
    const { generation } = await seedStageFence(ctx, batch.generationId);
    await ctx.db.patch(batch._id, { status: "superseded" });
    await bumpSeedStageVersion(ctx, generation._id);
    return true;
  },
});

/**
 * Terminalize the small set of active attempts during cancellation/deletion.
 * Historical batches are never scanned. More than 50 live rows indicates a
 * broken one-pending invariant and aborts rather than silently omitting work.
 */
export async function terminateSeedAttempts(
  ctx: MutationCtx,
  generationId: Id<"generations">
): Promise<number> {
  const [queued, running] = await Promise.all([
    ctx.db
      .query("seedBatches")
      .withIndex("by_generationId_and_status", (q) =>
        q.eq("generationId", generationId).eq("status", "queued")
      )
      .take(51),
    ctx.db
      .query("seedBatches")
      .withIndex("by_generationId_and_status", (q) =>
        q.eq("generationId", generationId).eq("status", "running")
      )
      .take(51),
  ]);
  if (queued.length > 50 || running.length > 50 || queued.length + running.length > 50) {
    throw new Error("Seed attempt termination exceeded its bounded live-row limit");
  }
  for (const batch of [...queued, ...running]) {
    await failSeedAttempt(ctx, {
      batch,
      requestsMade: batch.requestsReserved,
      errorCode: "GENERATION_TERMINATED",
      actorSystem: true,
    });
  }
  const subsections = await ctx.db
    .query("seedSubsections")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(14);
  if (subsections.length > 13) {
    throw new Error("Seed attempt termination found duplicate subsection rows");
  }
  let clearedDetachedPointer = false;
  for (const subsection of subsections) {
    if (!subsection.pendingBatchId) continue;
    const pending = await ctx.db.get(subsection.pendingBatchId);
    if (pending && (pending.status === "queued" || pending.status === "running")) {
      // A live row should have been handled above. Refuse silent partial
      // terminalization if an index invariant is broken.
      throw new Error("Live seed attempt remained after terminalization");
    }
    await ctx.db.patch(subsection._id, {
      pendingBatchId: undefined,
      priorState: undefined,
      state:
        subsection.state === "generating"
          ? subsection.priorState ?? "untouched"
          : subsection.state,
    });
    clearedDetachedPointer = true;
  }
  if (clearedDetachedPointer && (await ctx.db.get(generationId))) {
    await bumpSeedStageVersion(ctx, generationId);
  }
  return queued.length + running.length;
}

export type ReapSeedAttemptsArgs = {
  status: "queued" | "running";
  cutoff: number;
  cursor: string | null;
  pageSize: number;
};

export type ReapSeedAttemptsResult = {
  reaped: number;
  continueCursor: string | null;
  isDone: boolean;
};

/** One bounded reaper page. Callers restart at null because rows leave range. */
export async function reapSeedAttempts(
  ctx: MutationCtx,
  args: ReapSeedAttemptsArgs
): Promise<ReapSeedAttemptsResult> {
  const pageSize = Math.min(50, Math.max(1, Math.floor(args.pageSize)));
  const page = await ctx.db
    .query("seedBatches")
    .withIndex("by_status_and_leaseExpiresAt", (q) =>
      q.eq("status", args.status).lte("leaseExpiresAt", args.cutoff)
    )
    .paginate({ numItems: pageSize, cursor: args.cursor });
  for (const batch of page.page) {
    await failSeedAttempt(ctx, {
      batch,
      requestsMade: batch.requestsReserved,
      errorCode: "LEASE_EXPIRED",
      actorSystem: true,
    });
  }
  return {
    reaped: page.page.length,
    continueCursor: null,
    isDone: page.isDone,
  };
}

/** Decision writers retain Batch patch ownership in this module. */
export async function restoreSeedBatch(
  ctx: MutationCtx,
  subsection: Doc<"seedSubsections">,
  batchId: Id<"seedBatches">,
) {
  const batch = await ctx.db.get(batchId);
  if (
    !batch ||
    batch.projectId !== subsection.projectId ||
    batch.generationId !== subsection.generationId ||
    batch.roleId !== subsection.roleId ||
    batch.operation === "feedback" ||
    (batch.status !== "shown" && batch.status !== "superseded") ||
    batch.completedAt === undefined
  )
    domainError(
      "INVALID_INPUT",
      "Only a completed ordinary Batch of this subsection can be restored",
    );
  if (subsection.pendingBatchId)
    domainError("INVALID_STATE", "A seed attempt is already generating");
  if (subsection.shownBatchId && subsection.shownBatchId !== batchId) {
    const previous = await ctx.db.get(subsection.shownBatchId);
    if (previous?.status === "shown")
      await ctx.db.patch(previous._id, { status: "superseded" });
  }
  await ctx.db.patch(batchId, { status: "shown" });
  return batch;
}

export async function terminateSeedRoleAttempt(
  ctx: MutationCtx,
  subsection: Doc<"seedSubsections">,
) {
  if (!subsection.pendingBatchId) return;
  const batch = await ctx.db.get(subsection.pendingBatchId);
  if (
    batch &&
    batch.generationId === subsection.generationId &&
    batch.roleId === subsection.roleId &&
    (batch.status === "queued" || batch.status === "running")
  ) {
    await failSeedAttempt(ctx, {
      batch,
      requestsMade: batch.requestsReserved,
      errorCode: "GENERATION_TERMINATED",
      bumpVersion: false,
    });
  }
  await ctx.db.patch(subsection._id, {
    pendingBatchId: undefined,
    priorState: undefined,
    pendingApprovalReasons: undefined,
  });
}
