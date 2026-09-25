import { v, ConvexError, getConvexSize } from "convex/values";
import {
  query,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../shared/pdSubsections";
import { requireCurrentUser, requireInternalProjectAccess } from "./lib/auth";
import {
  getReportEditAccessOrNull,
  requireReportEditAccess,
} from "./lib/roleCapabilities";
import { domainError } from "./lib/contracts";
import { resolveGatedWorkflow } from "./lib/gatedWorkflow";
import { draftingInputsStatus } from "./lib/generations/draftingInputs";
import { createReadBudget, DOCUMENT_HEADROOM } from "./lib/readBudget";
import {
  loadSeedDecisionState,
  SEED_DECISION_READ_BYTES,
  SEED_DECISION_READ_RANGES,
  SEED_DECISION_COLLECTION_ROWS,
  type SeedDecisionReadBudget,
} from "./lib/seedDecisionState";
import {
  materializeFinalWording,
  orderShownSet,
  sha256Text,
  stableSerialize,
} from "./lib/seedRevisions";
import { computeEditDistance } from "./lib/editDistance";
import { MAX_EDITED_BULLET_CHARS } from "./lib/seedContract";
import {
  buildSeedApprovalChallenge,
  unlinkedAdvancementIds,
} from "./lib/seedApproval";
import {
  appendSeedRoleEvent,
  disposeSeedEpisode,
  recomputeSeedDecisions,
} from "./lib/seedDecisionWrites";
import { bumpSeedStageVersion } from "./generations";
import {
  dispatchSeedAttempt,
  restoreSeedBatch,
  terminateSeedRoleAttempt,
} from "./seedRuns";
import { readSeedReadiness } from "./lib/seedReadiness";
import { MAX_SEED_SOURCE_ROWS } from "./lib/seedSnapshotLoader";

export const seedRoleIdValidator = v.union(
  ...PD_SUBSECTIONS.map((r) => v.literal(r.roleId)),
);
const common = {
  generationId: v.id("generations"),
  roleId: seedRoleIdValidator,
  expectedSeedStageVersion: v.number(),
};
type DecisionArgs = {
  generationId: Id<"generations">;
  roleId: PdSubsectionRoleId;
  expectedSeedStageVersion: number;
};

async function decisionFence(ctx: MutationCtx, args: DecisionArgs) {
  await requireCurrentUser(ctx);
  const generation = await ctx.db.get(args.generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  const { user, project } = await requireReportEditAccess(
    ctx,
    generation.projectId,
  );
  if (
    resolveGatedWorkflow(generation) !== "seeds" ||
    generation.status !== "awaiting_input" ||
    generation.summaryVersionId ||
    project.activeGenerationId !== generation._id
  )
    domainError("INVALID_STATE", "The seed stage is closed", {
      reason: "SEED_STAGE_CLOSED",
    });
  if (
    !Number.isSafeInteger(args.expectedSeedStageVersion) ||
    args.expectedSeedStageVersion !== (generation.seedStageVersion ?? 0)
  )
    domainError("STALE_REVISION", "Seed decisions changed; refresh and retry");
  const row = await ctx.db
    .query("seedSubsections")
    .withIndex("by_generationId_and_roleId", (q) =>
      q.eq("generationId", generation._id).eq("roleId", args.roleId),
    )
    .unique();
  if (!row || row.projectId !== project._id)
    domainError("INVALID_STATE", "Seed subsection is missing");
  const budget = createReadBudget({
    maxBytes: SEED_DECISION_READ_BYTES,
    maxRanges: SEED_DECISION_READ_RANGES,
    reservedBytes: 3 * DOCUMENT_HEADROOM,
  });
  return { generation, row, user, project, budget };
}
async function seedOf(
  ctx: MutationCtx,
  row: Doc<"seedSubsections">,
  seedId: Id<"seeds">,
) {
  const seed = await ctx.db.get(seedId);
  if (
    !seed ||
    seed.projectId !== row.projectId ||
    seed.generationId !== row.generationId ||
    seed.roleId !== row.roleId
  )
    domainError("INVALID_INPUT", "Seed does not belong to this subsection");
  return seed;
}
function editable(row: Doc<"seedSubsections">) {
  if (row.state === "skipped")
    domainError(
      "INVALID_STATE",
      "Unskip this subsection before changing its decisions",
    );
}
function validCommand(commandId: string) {
  if (!commandId || commandId.length > 128)
    domainError("INVALID_INPUT", "A bounded command identity is required");
}
// A writer's edit keeps the one-or-two-bullet shape but is never held to the
// AI Seed's 25-word, one-sentence contract (PRD FR-11, owner 2026-09-23); the
// client shows a soft "Long for a seed" note instead.
function validBullets(bullets: string[]) {
  if (
    bullets.length < 1 ||
    bullets.length > 2 ||
    bullets.some((b) => !b.trim() || b.length > MAX_EDITED_BULLET_CHARS)
  )
    domainError(
      "INVALID_INPUT",
      `Seeds require one or two non-empty bullets, each at most ${MAX_EDITED_BULLET_CHARS} characters`,
    );
}
async function currentVersion(
  ctx: MutationCtx,
  generationId: Id<"generations">,
) {
  return (await ctx.db.get(generationId))?.seedStageVersion ?? 0;
}

/** The single selection insertion owner, reused by edit/restore without selecting. */
async function selectionForWrite(
  ctx: MutationCtx,
  seed: Doc<"seeds">,
  budget: SeedDecisionReadBudget,
) {
  const existing = await ctx.db
    .query("seedSelections")
    .withIndex("by_seedId", (q) => q.eq("seedId", seed._id))
    .unique();
  if (existing) {
    if (
      existing.projectId !== seed.projectId ||
      existing.generationId !== seed.generationId ||
      existing.roleId !== seed.roleId
    )
      domainError("INVALID_STATE", "Selection ownership mismatch");
    return existing;
  }
  const orderKey = await selectionOrderKey(ctx, seed, budget);
  const id = await ctx.db.insert("seedSelections", {
    projectId: seed.projectId,
    generationId: seed.generationId,
    roleId: seed.roleId,
    seedId: seed._id,
    selected: false,
    selectedAt: Date.now(),
    version: 0,
    orderKey,
  });
  const result = await ctx.db.get(id);
  if (!result) throw new Error("Inserted selection missing");
  return result;
}
async function selectionOrderKey(
  ctx: MutationCtx,
  seed: Doc<"seeds">,
  budget: SeedDecisionReadBudget,
): Promise<string> {
  let root = seed;
  const seen = new Set<string>();
  while (root.revisionOfSeedId) {
    if (seen.has(root._id)) domainError("INVALID_STATE", "Seed revision cycle");
    seen.add(root._id);
    const parentId = root.revisionOfSeedId;
    const loaded = await budget.one(() => ctx.db.get(parentId));
    if (loaded.kind === "not-loaded")
      domainError(
        "INVALID_INPUT",
        `Seed ancestry for ${seed.roleId} exceeds the read budget`,
        { reason: "SEED_PROCESSING_LIMIT" },
      );
    const parent = loaded.value;
    if (
      !parent ||
      parent.projectId !== seed.projectId ||
      parent.generationId !== seed.generationId ||
      parent.roleId !== seed.roleId
    )
      domainError("INVALID_STATE", "Seed revision ownership mismatch");
    root = parent;
  }
  const rootBatchRead = await budget.one(() => ctx.db.get(root.batchId));
  const batchRead = await budget.one(() => ctx.db.get(seed.batchId));
  if (rootBatchRead.kind === "not-loaded" || batchRead.kind === "not-loaded")
    domainError(
      "INVALID_INPUT",
      `Seed ordering for ${seed.roleId} exceeds the read budget`,
      { reason: "SEED_PROCESSING_LIMIT" },
    );
  const rootBatch = rootBatchRead.value;
  const batch = batchRead.value;
  if (
    !rootBatch ||
    !batch ||
    [rootBatch, batch].some(
      (row) =>
        row.projectId !== seed.projectId ||
        row.generationId !== seed.generationId ||
        row.roleId !== seed.roleId,
    )
  )
    domainError(
      "INVALID_STATE",
      "Seed Batch missing or outside the subsection",
    );
  const time = (n: number) => n.toFixed(6).padStart(30, "0");
  return `${time(rootBatch._creationTime)}:${root.order.toString().padStart(5, "0")}:${root._id}:${seed._id === root._id ? "0" : "1"}:${time(batch._creationTime)}:${seed.order.toString().padStart(5, "0")}:${seed._id}`;
}
async function selectHandler(
  ctx: MutationCtx,
  args: DecisionArgs & { seedId: Id<"seeds">; selected: boolean },
) {
  const f = await decisionFence(ctx, args);
  editable(f.row);
  const seed = await seedOf(ctx, f.row, args.seedId);
  const prior = await ctx.db
    .query("seedSelections")
    .withIndex("by_seedId", (q) => q.eq("seedId", seed._id))
    .unique();
  if ((prior?.selected ?? false) === args.selected)
    return { seedStageVersion: f.generation.seedStageVersion ?? 0 };
  const selection = await selectionForWrite(ctx, seed, f.budget);
  await ctx.db.patch(selection._id, {
    selected: args.selected,
    selectedAt: Date.now(),
    version: selection.version + 1,
  });
  const row = await recomputeSeedDecisions(
    ctx,
    args.generationId,
    args.roleId,
    true,
    f.budget,
  );
  await bumpSeedStageVersion(ctx, args.generationId);
  await appendSeedRoleEvent(
    ctx,
    row,
    args.selected ? "select" : "deselect",
    f.user._id,
    { seedId: seed._id, batchId: seed.batchId },
  );
  return { seedStageVersion: await currentVersion(ctx, args.generationId) };
}
export const select = mutation({
  args: { ...common, seedId: v.id("seeds"), selected: v.boolean() },
  handler: selectHandler,
});
export const deselect = mutation({
  args: { ...common, seedId: v.id("seeds") },
  handler: (ctx, args) => selectHandler(ctx, { ...args, selected: false }),
});

async function wordingHandler(
  ctx: MutationCtx,
  args: DecisionArgs & { seedId: Id<"seeds">; bullets?: string[] },
  restore: boolean,
) {
  const f = await decisionFence(ctx, args);
  editable(f.row);
  const seed = await seedOf(ctx, f.row, args.seedId);
  const prior = await ctx.db
    .query("seedSelections")
    .withIndex("by_seedId", (q) => q.eq("seedId", seed._id))
    .unique();
  if (restore && prior?.editedBullets === undefined)
    return { seedStageVersion: f.generation.seedStageVersion ?? 0 };
  const selection = await selectionForWrite(ctx, seed, f.budget);
  const bullets = restore ? seed.bullets : (args.bullets ?? []);
  validBullets(bullets);
  const before = materializeFinalWording(seed, selection);
  if (
    stableSerialize(before) === stableSerialize(bullets) &&
    (restore
      ? selection.editedBullets === undefined
      : selection.editedBullets !== undefined)
  )
    return { seedStageVersion: f.generation.seedStageVersion ?? 0 };
  await ctx.db.patch(selection._id, {
    editedBullets: restore ? undefined : bullets,
    editedBy: restore ? undefined : f.user._id,
    editedAt: restore ? undefined : Date.now(),
    version: selection.version + 1,
  });
  await ctx.db.patch(seed._id, {
    support: restore ? seed.originalSupport : "writer_asserted",
  });
  const row = await recomputeSeedDecisions(
    ctx,
    args.generationId,
    args.roleId,
    selection.selected,
    f.budget,
  );
  await bumpSeedStageVersion(ctx, args.generationId);
  const a = before.join("\n"),
    b = bullets.join("\n");
  // Reuse the linear word-multiset edit signal used by report learning.
  const editRatio = computeEditDistance(a, b).ped;
  await appendSeedRoleEvent(
    ctx,
    row,
    restore ? "restoreWording" : "edit",
    f.user._id,
    {
      seedId: seed._id,
      batchId: seed.batchId,
      ...(restore ? {} : { editRatio }),
    },
  );
  return { seedStageVersion: await currentVersion(ctx, args.generationId) };
}
export const edit = mutation({
  args: { ...common, seedId: v.id("seeds"), bullets: v.array(v.string()) },
  handler: (ctx, args) => wordingHandler(ctx, args, false),
});
export const restoreWording = mutation({
  args: { ...common, seedId: v.id("seeds") },
  handler: (ctx, args) => wordingHandler(ctx, args, true),
});

export const giveFeedback = mutation({
  args: {
    ...common,
    seedId: v.id("seeds"),
    instruction: v.string(),
    commandId: v.string(),
  },
  handler: async (ctx, args) => {
    const f = await decisionFence(ctx, args);
    validCommand(args.commandId);
    if (!args.instruction.trim() || args.instruction.length > 300)
      domainError(
        "INVALID_INPUT",
        "Feedback must contain at most 300 characters",
      );
    const target = await seedOf(ctx, f.row, args.seedId);
    const prior = await ctx.db
      .query("seedFeedbackRequests")
      .withIndex("by_generationId_and_roleId_and_commandId", (q) =>
        q
          .eq("generationId", args.generationId)
          .eq("roleId", args.roleId)
          .eq("commandId", args.commandId),
      )
      .unique();
    if (prior) {
      if (
        prior.targetSeedId !== args.seedId ||
        prior.instruction !== args.instruction
      )
        domainError(
          "INVALID_INPUT",
          "Command identity already belongs to different feedback",
        );
      const batch = await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId_and_commandId", (q) =>
          q
            .eq("generationId", args.generationId)
            .eq("roleId", args.roleId)
            .eq("commandId", args.commandId),
        )
        .unique();
      if (!batch || batch.feedbackRequestId !== prior._id)
        domainError(
          "INVALID_STATE",
          "Feedback command has no matching attempt",
        );
      return {
        feedbackRequestId: prior._id,
        batchId: batch._id,
        seedStageVersion: f.generation.seedStageVersion ?? 0,
      };
    }
    editable(f.row);
    const selection = await ctx.db
      .query("seedSelections")
      .withIndex("by_seedId", (q) => q.eq("seedId", target._id))
      .unique();
    const feedbackRequestId = await ctx.db.insert("seedFeedbackRequests", {
      projectId: f.project._id,
      generationId: args.generationId,
      roleId: args.roleId,
      targetSeedId: target._id,
      targetWording: [
        ...materializeFinalWording(target, selection ?? undefined),
      ],
      instruction: args.instruction,
      status: "active",
      commandId: args.commandId,
    });
    const row = await recomputeSeedDecisions(
      ctx,
      args.generationId,
      args.roleId,
      true,
      f.budget,
    );
    const result = await dispatchSeedAttempt(ctx, {
      generationId: args.generationId,
      roleId: args.roleId,
      operation: "feedback",
      commandId: args.commandId,
      feedbackRequestId,
      actorUserId: f.user._id,
      bumpVersion: false,
      budget: f.budget,
    });
    if (result.kind === "not_dispatched")
      domainError("INVALID_STATE", "Feedback attempt was not dispatched");
    await bumpSeedStageVersion(ctx, args.generationId);
    await appendSeedRoleEvent(ctx, row, "feedbackRequested", f.user._id, {
      feedbackRequestId,
      seedId: target._id,
      batchId: result.batchId,
    });
    return {
      feedbackRequestId,
      batchId: result.batchId,
      seedStageVersion: await currentVersion(ctx, args.generationId),
    };
  },
});
export const withdrawFeedback = mutation({
  args: { ...common, feedbackRequestId: v.id("seedFeedbackRequests") },
  handler: async (ctx, args) => {
    const f = await decisionFence(ctx, args);
    const request = await ctx.db.get(args.feedbackRequestId);
    if (
      !request ||
      request.generationId !== args.generationId ||
      request.projectId !== f.project._id ||
      request.roleId !== args.roleId
    )
      domainError(
        "INVALID_INPUT",
        "Feedback request does not belong to this subsection",
      );
    if (request.status === "withdrawn")
      return { seedStageVersion: f.generation.seedStageVersion ?? 0 };
    await ctx.db.patch(request._id, {
      status: "withdrawn",
      withdrawnAt: Date.now(),
    });
    const row = await recomputeSeedDecisions(
      ctx,
      args.generationId,
      args.roleId,
      true,
      f.budget,
    );
    await bumpSeedStageVersion(ctx, args.generationId);
    await appendSeedRoleEvent(ctx, row, "feedbackWithdrawn", f.user._id, {
      feedbackRequestId: request._id,
      seedId: request.targetSeedId,
    });
    return { seedStageVersion: await currentVersion(ctx, args.generationId) };
  },
});

async function dispatchHandler(
  ctx: MutationCtx,
  args: DecisionArgs & { commandId: string },
  operation: "open" | "regenerate" | "retry",
) {
  const f = await decisionFence(ctx, args);
  editable(f.row);
  validCommand(args.commandId);
  const result = await dispatchSeedAttempt(ctx, {
    generationId: args.generationId,
    roleId: args.roleId,
    commandId: args.commandId,
    operation,
    actorUserId: f.user._id,
    bumpVersion: false,
    budget: f.budget,
  });
  if (result.kind === "dispatched") {
    await bumpSeedStageVersion(ctx, args.generationId);
    if (operation !== "open")
      await appendSeedRoleEvent(ctx, f.row, operation, f.user._id, {
        batchId: result.batchId,
      });
  }
  return {
    ...result,
    seedStageVersion: await currentVersion(ctx, args.generationId),
  };
}
export const open = mutation({
  args: { ...common, commandId: v.string() },
  handler: (ctx, args) => dispatchHandler(ctx, args, "open"),
});
export const regenerate = mutation({
  args: { ...common, commandId: v.string() },
  handler: (ctx, args) => dispatchHandler(ctx, args, "regenerate"),
});
export const retry = mutation({
  args: { ...common, commandId: v.string() },
  handler: (ctx, args) => dispatchHandler(ctx, args, "retry"),
});
export const restoreBatch = mutation({
  args: { ...common, batchId: v.id("seedBatches") },
  handler: async (ctx, args) => {
    const f = await decisionFence(ctx, args);
    editable(f.row);
    await restoreSeedBatch(ctx, f.row, args.batchId);
    if (f.row.shownBatchId === args.batchId)
      return { seedStageVersion: f.generation.seedStageVersion ?? 0 };
    await ctx.db.patch(f.row._id, {
      shownBatchId: args.batchId,
      state: "in_progress",
    });
    const row = await recomputeSeedDecisions(
      ctx,
      args.generationId,
      args.roleId,
      true,
      f.budget,
    );
    await bumpSeedStageVersion(ctx, args.generationId);
    await appendSeedRoleEvent(ctx, row, "restoreBatch", f.user._id, {
      batchId: args.batchId,
    });
    return { seedStageVersion: await currentVersion(ctx, args.generationId) };
  },
});

async function skipHandler(
  ctx: MutationCtx,
  args: DecisionArgs,
  unskip: boolean,
) {
  const f = await decisionFence(ctx, args);
  if (f.row.kind !== "optional")
    domainError("INVALID_INPUT", "Only Optional subsections can be skipped");
  if ((f.row.state === "skipped") === !unskip)
    return { seedStageVersion: f.generation.seedStageVersion ?? 0 };
  if (unskip && f.row.state !== "skipped")
    domainError("INVALID_STATE", "Subsection is not skipped");
  const state = await loadSeedDecisionState(ctx, {
    generationId: args.generationId,
    requireComplete: true,
    roleId: args.roleId,
    budget: f.budget,
  });
  if (!unskip) {
    await terminateSeedRoleAttempt(ctx, f.row);
    await disposeSeedEpisode(ctx, f.row, "bypassed");
  }
  for (const request of state.feedbackRows.filter(
    (r) => r.roleId === args.roleId,
  )) {
    if (!unskip && request.status === "active")
      await ctx.db.patch(request._id, { status: "suspendedBySkip" });
    if (unskip && request.status === "suspendedBySkip")
      await ctx.db.patch(request._id, { status: "active" });
  }
  const history = await ctx.db
    .query("seedBatches")
    .withIndex("by_generationId_and_roleId", (q) =>
      q.eq("generationId", args.generationId).eq("roleId", args.roleId),
    )
    .first();
  await ctx.db.patch(f.row._id, {
    state: unskip ? (history ? "in_progress" : "untouched") : "skipped",
    pendingBatchId: undefined,
    priorState: undefined,
    pendingApprovalReasons: undefined,
  });
  const row = await recomputeSeedDecisions(
    ctx,
    args.generationId,
    args.roleId,
    true,
    f.budget,
  );
  await bumpSeedStageVersion(ctx, args.generationId);
  await appendSeedRoleEvent(ctx, row, unskip ? "unskip" : "skip", f.user._id);
  return { seedStageVersion: await currentVersion(ctx, args.generationId) };
}
export const skip = mutation({
  args: common,
  handler: (ctx, args) => skipHandler(ctx, args, false),
});
export const unskip = mutation({
  args: common,
  handler: (ctx, args) => skipHandler(ctx, args, true),
});

function sameIds(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    [...left].sort().every((id, i) => id === [...right].sort()[i])
  );
}
function isPrefetchOverflow(error: unknown) {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    error.data.code === "INVALID_INPUT" &&
    "reason" in error.data &&
    error.data.reason === "SEED_PROCESSING_LIMIT"
  );
}
export const approve = mutation({
  args: {
    ...common,
    approvalChallenge: v.string(),
    acknowledgedCarriedSeedIds: v.array(v.id("seeds")),
    acknowledgedExclusionEntryIds: v.array(v.id("generationBriefEntries")),
  },
  handler: async (ctx, args) => {
    const f = await decisionFence(ctx, args);
    editable(f.row);
    const state = await loadSeedDecisionState(ctx, {
      generationId: args.generationId,
      requireComplete: true,
      roleId: args.roleId,
      budget: f.budget,
    });
    const selectedRows = state.selectionRows.filter(
      (s) => s.roleId === args.roleId && s.selected,
    );
    if (!selectedRows.length)
      domainError("INVALID_STATE", "Select at least one Seed before approval");
    if (
      args.roleId === "specific_advancements" &&
      unlinkedAdvancementIds(state).length
    )
      domainError(
        "INVALID_STATE",
        "Advancement references must be active selections",
        { reason: "UNLINKED_ADVANCEMENT" },
      );
    const challenge = await buildSeedApprovalChallenge(ctx, state, f.row);
    if (
      challenge.approvalChallenge !== args.approvalChallenge ||
      !sameIds(challenge.carriedSeedIds, args.acknowledgedCarriedSeedIds) ||
      !sameIds(challenge.exclusionEntryIds, args.acknowledgedExclusionEntryIds)
    )
      domainError(
        "INVALID_INPUT",
        "Approval challenge or acknowledgments changed; refresh before approving",
      );
    const selected = orderShownSet({
      seeds: state.seeds,
      batches: state.batches,
    }).filter((seed) => selectedRows.some((s) => s.seedId === seed._id));
    const snapshot = {
      items: await Promise.all(
        selected.map(async (seed) => {
          const selection = selectedRows.find((s) => s.seedId === seed._id)!;
          return {
            seedId: seed._id,
            wordingHash: await sha256Text(
              stableSerialize(materializeFinalWording(seed, selection)),
            ),
            selectionVersion: selection.version,
          };
        }),
      ),
    };
    if (snapshot.items.length > 8192 || getConvexSize(snapshot) > 900 * 1024)
      domainError(
        "INVALID_INPUT",
        `Approval snapshot for ${args.roleId} exceeds the document processing budget`,
        { reason: "SEED_PROCESSING_LIMIT" },
      );
    await ctx.db.patch(f.row._id, {
      state: "approved",
      pendingApprovalReasons: undefined,
      approvedBy: f.user._id,
      approvedAt: Date.now(),
      approvedContextRevision: f.row.currentContextRevision,
      approvedSelectionRevision: f.row.selectionRevision,
      approvedWithConfirmation: challenge.carriedSeedIds.length > 0,
      ...(challenge.exclusionEntryIds.length
        ? { exclusionAcknowledgedAt: Date.now() }
        : {}),
    });
    const approveEventId = await appendSeedRoleEvent(
      ctx,
      f.row,
      "approve",
      f.user._id,
      {
        confirmed: challenge.carriedSeedIds.length > 0,
        snapshot,
        contributionHashes: challenge.contributionHashes,
      },
    );
    for (const request of state.feedbackRows.filter(
      (r) => r.roleId === args.roleId,
    )) {
      const batch = request.batchId
        ? state.batches.find((b) => b._id === request.batchId)
        : undefined;
      const completed =
        !!batch?.completedAt &&
        (batch.status === "shown" || batch.status === "superseded");
      const responseSelected = selected.some(
        (s) => s.feedbackRequestId === request._id,
      );
      if (!request.firstApproveExposure)
        await ctx.db.patch(request._id, {
          firstApproveExposure: {
            approveEventId,
            outcome: completed
              ? responseSelected
                ? "selected"
                : "not_selected"
              : "response_not_available",
          },
        });
      if (completed && !request.eligibleScore)
        await ctx.db.patch(request._id, {
          eligibleScore: { approveEventId, selected: responseSelected },
        });
    }
    if (f.row.activeStaleEpisodeId) {
      const episode = await ctx.db.get(f.row.activeStaleEpisodeId);
      const fresh = await state.budget.list(
        ctx.db
          .query("seedBatches")
          .withIndex("by_generationId_and_roleId", (q) =>
            q.eq("generationId", args.generationId).eq("roleId", args.roleId),
          ),
        SEED_DECISION_COLLECTION_ROWS,
      );
      if (!fresh.complete)
        domainError(
          "INVALID_INPUT",
          `Stale episode for ${args.roleId} exceeds the read budget`,
          { reason: "SEED_PROCESSING_LIMIT" },
        );
      const batches = fresh.rows.filter(
        (b) =>
          b.completedAt !== undefined &&
          b.completedAt > (episode?.openedAt ?? Infinity) &&
          b.consumedContextRevision === f.row.currentContextRevision &&
          (b.status === "shown" || b.status === "superseded"),
      );
      await disposeSeedEpisode(ctx, f.row, "resolved", {
        freshAttemptCompleted: batches.length > 0,
        freshSeedsInSnapshot: selected.some((s) =>
          batches.some((b) => b._id === s.batchId),
        ),
        olderSelectionsConfirmed: challenge.carriedSeedIds.length > 0,
      });
    }
    const definition = PD_SUBSECTIONS.find((r) => r.roleId === args.roleId)!;
    const next = PD_SUBSECTIONS.find(
      (r) =>
        r.order > definition.order &&
        state.subsections.some(
          (s) => s.roleId === r.roleId && s.state === "untouched",
        ),
    );
    if (next) {
      try {
        await dispatchSeedAttempt(ctx, {
          generationId: args.generationId,
          roleId: next.roleId,
          operation: "prefetch",
          commandId: `approve:${approveEventId}`,
          bumpVersion: false,
          budget: f.budget,
        });
      } catch (error) {
        if (!isPrefetchOverflow(error)) throw error;
      }
    }
    await bumpSeedStageVersion(ctx, args.generationId);
    return { seedStageVersion: await currentVersion(ctx, args.generationId) };
  },
});
export const markBatchViewed = mutation({
  args: { ...common, batchId: v.id("seedBatches") },
  handler: async (ctx, args) => {
    const f = await decisionFence(ctx, args);
    const batch = await ctx.db.get(args.batchId);
    if (
      !batch ||
      batch.generationId !== args.generationId ||
      batch.projectId !== f.project._id ||
      batch.roleId !== args.roleId ||
      !batch.completedAt ||
      (batch.status !== "shown" && batch.status !== "superseded")
    )
      domainError(
        "INVALID_INPUT",
        "Only a completed Batch of this subsection can be viewed",
      );
    const prior = await ctx.db
      .query("seedDecisionEvents")
      .withIndex("by_batchId_and_actorUserId_and_kind", (q) =>
        q
          .eq("batchId", args.batchId)
          .eq("actorUserId", f.user._id)
          .eq("kind", "batchViewed"),
      )
      .first();
    if (!prior) {
      await appendSeedRoleEvent(ctx, f.row, "batchViewed", f.user._id, {
        batchId: args.batchId,
        attemptId: batch.attemptId,
      });
      await bumpSeedStageVersion(ctx, args.generationId);
    }
    return { seedStageVersion: await currentVersion(ctx, args.generationId) };
  },
});

export async function requireSeedRead(
  ctx: QueryCtx,
  generationId: Id<"generations">,
) {
  await requireCurrentUser(ctx);
  const generation = await ctx.db.get(generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  await requireInternalProjectAccess(ctx, generation.projectId);
  if (resolveGatedWorkflow(generation) !== "seeds")
    domainError("INVALID_STATE", "Generation does not use Seeds");
  return generation;
}
export const getReadiness = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    await requireSeedRead(ctx, args.generationId);
    return await readSeedReadiness(ctx, {
      generationId: args.generationId,
      budget: createReadBudget({
        maxBytes: SEED_DECISION_READ_BYTES,
        maxRanges: SEED_DECISION_READ_RANGES,
        reservedBytes: 3 * DOCUMENT_HEADROOM,
      }),
    });
  },
});

import {
  frozenSeedSettings,
  getOutlineData,
  getSubsectionData,
  listBatchesData,
  getSummaryData,
} from "./lib/seedReaders";
export const getOutline = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await requireSeedRead(ctx, args.generationId);
    const editAccess = await getReportEditAccessOrNull(ctx, generation.projectId);
    return {
      ...(await getOutlineData(ctx, args.generationId)),
      // Mutation controls follow the same open-stage rule as decisionFence:
      // a failed, cancelled, signed-off or inactive run is read-only.
      canEdit:
        editAccess !== null &&
        generation.status === "awaiting_input" &&
        !generation.summaryVersionId &&
        editAccess.project.activeGenerationId === generation._id,
      workflow: resolveGatedWorkflow(generation),
      // Owner decision 32: the analysis and Brain retrieval prepared in the
      // background. Sign-off needs "ready"; "failed" offers a retry.
      draftingInputs: { status: draftingInputsStatus(generation) },
      frozen: {
        briefVersionId: generation.briefVersionId ?? null,
        summaryVersionId: generation.summaryVersionId ?? null,
        ...frozenSeedSettings(generation),
      },
    };
  },
});
export const getSubsection = query({
  args: { generationId: v.id("generations"), roleId: seedRoleIdValidator },
  handler: async (ctx, args) => {
    await requireSeedRead(ctx, args.generationId);
    return getSubsectionData(ctx, args.generationId, args.roleId);
  },
});
export const getApprovalReview = query({
  args: common,
  handler: async (ctx, args) => {
    const generation = await requireSeedRead(ctx, args.generationId);
    if (
      !Number.isSafeInteger(args.expectedSeedStageVersion) ||
      args.expectedSeedStageVersion !== (generation.seedStageVersion ?? 0)
    ) {
      domainError("STALE_REVISION", "Seed decisions changed; refresh and retry");
    }
    const state = await loadSeedDecisionState(ctx, {
      generationId: args.generationId,
      requireComplete: true,
      roleId: args.roleId,
      budget: createReadBudget({
        maxBytes: SEED_DECISION_READ_BYTES,
        maxRanges: SEED_DECISION_READ_RANGES,
        reservedBytes: 3 * DOCUMENT_HEADROOM,
      }),
    });
    const row = state.subsections.find((candidate) => candidate.roleId === args.roleId);
    if (!row || row.projectId !== generation.projectId) {
      domainError("INVALID_STATE", "Seed subsection is missing");
    }
    return {
      approvalChallenge: await buildSeedApprovalChallenge(ctx, state, row),
      selectedCount: state.selectionRows.filter(
        (selection) => selection.roleId === args.roleId && selection.selected,
      ).length,
      seedStageVersion: generation.seedStageVersion ?? 0,
    };
  },
});
/** Readable names for the frozen sources Seed provenance cites. The rows are
 * immutable, so this subscription stays cached while decisions change. */
export const getSourceAttribution = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await requireSeedRead(ctx, args.generationId);
    const budget = createReadBudget({
      maxBytes: SEED_DECISION_READ_BYTES,
      maxRanges: 1,
    });
    const read = await budget.list(
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", generation._id),
        ),
      MAX_SEED_SOURCE_ROWS,
    );
    return {
      generationId: generation._id,
      sources: read.rows
        .filter((source) => source.projectId === generation.projectId)
        .map((source) => ({
          sourceId: source._id,
          label: source.label,
          kind: source.kind,
        })),
      complete: read.complete,
    };
  },
});
/** Bounded recovery for names a partial attribution read left out: at most
 * `MAX_SEED_SOURCE_ROWS` exact ids, each read by key under the same byte
 * budget and returned only when it is one of this generation's own frozen
 * sources. `complete: false` says the budget stopped the walk, so the client
 * can refuse honestly instead of retrying forever. */
export const getSourceAttributionByIds = query({
  args: {
    generationId: v.id("generations"),
    sourceIds: v.array(v.id("generationSources")),
  },
  handler: async (ctx, args) => {
    const generation = await requireSeedRead(ctx, args.generationId);
    const requested = [...new Set(args.sourceIds)];
    if (requested.length > MAX_SEED_SOURCE_ROWS)
      domainError(
        "INVALID_INPUT",
        `At most ${MAX_SEED_SOURCE_ROWS} source names can be recovered per request`,
        { reason: "SEED_PROCESSING_LIMIT" },
      );
    const budget = createReadBudget({
      maxBytes: SEED_DECISION_READ_BYTES,
      maxRanges: MAX_SEED_SOURCE_ROWS,
    });
    const sources: Array<{
      sourceId: Id<"generationSources">;
      label: string;
      kind: Doc<"generationSources">["kind"];
    }> = [];
    let complete = true;
    for (const sourceId of requested) {
      const read = await budget.one(() => ctx.db.get(sourceId));
      if (read.kind === "not-loaded") {
        complete = false;
        break;
      }
      const source = read.value;
      if (
        !source ||
        source.generationId !== generation._id ||
        source.projectId !== generation.projectId
      )
        continue;
      sources.push({ sourceId: source._id, label: source.label, kind: source.kind });
    }
    return { generationId: generation._id, sources, complete };
  },
});
export const listBatches = query({
  args: {
    generationId: v.id("generations"),
    roleId: seedRoleIdValidator,
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const generation = await requireSeedRead(ctx, args.generationId);
    return listBatchesData(
      ctx,
      generation,
      args.roleId,
      args.cursor,
      args.numItems ?? 20,
    );
  },
});
export const getSummary = query({
  args: {
    generationId: v.id("generations"),
    versionId: v.optional(v.id("summaryVersions")),
    cursor: v.union(v.string(), v.null()),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const generation = await requireSeedRead(ctx, args.generationId);
    return getSummaryData(
      ctx,
      generation,
      args.versionId,
      args.cursor,
      args.numItems ?? 50,
    );
  },
});
