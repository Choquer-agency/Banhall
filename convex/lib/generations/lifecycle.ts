/**
 * Generation-wide lifecycle writes the pipeline makes: start, failure,
 * estimates, provenance, progress, writer settings and status updates.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { v, type ObjectType } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import { transitionGeneration } from "../generationTransitions";
import { refreshProjectGenerationActivity } from "../dashboardProjection";
import {
  terminalizeOrphanedCandidateRuns,
  terminalizeSignedOffSeedSections,
} from "./candidates";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { appendGenerationProgress } from "../generationProgress";
import { writerSettingsValidator } from "../orderedChain";
import { isProjectDeleting } from "../projectDeletion";
import { isTerminalGenerationStatus } from "../../../shared/generationTransitions";
import { writeAgentOutputs, writeBrainProvenance } from "../generationOutputs";
import { restorableProjectStatus } from "./restoreStatus";

/** Argument validators of generations.beginGeneration. */
export const beginGenerationArgs = {
  generationId: v.id("generations"),
  promptVersion: v.string(),
};

/** Handler of generations.beginGeneration. */
export async function beginGenerationHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof beginGenerationArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation || generation.status !== "reserved") return false;
  if (
    generation.learningDigestIds !== undefined &&
    !/^sha256:[0-9a-f]{64}$/.test(args.promptVersion)
  ) {
    throw new Error("Invalid promptVersion hash");
  }
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.deletionStartedAt !== undefined || project.activeGenerationId !== generation._id) return false;
  await transitionGeneration(ctx, generation, "running", {
    // A present digest array is the new-reservation marker. Legacy reserved
    // rows remain valid and are deliberately not retroactively attributed.
    ...(generation.learningDigestIds !== undefined
      ? { promptVersion: args.promptVersion }
      : {}),
    currentStep: "Preparing frozen project sources...",
    startedAt: Date.now(),
  });
  await refreshProjectGenerationActivity(ctx, generation.projectId);
  return true;
}

/** Argument validators of generations.unionLearningDigestIds. */
export const unionLearningDigestIdsArgs = {
  generationId: v.id("generations"),
  digestIds: v.array(v.id("learningDigests")),
};

/** Handler of generations.unionLearningDigestIds. */
export async function unionLearningDigestIdsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof unionLearningDigestIdsArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) {
    throw new Error("Generation not found for learning digest handoff");
  }
  if (
    generation.promptVersion === undefined ||
    generation.learningDigestIds === undefined
  ) {
    // A legacy row (neither field) is a deliberate no-op. Either field
    // present without the other is a provenance state the entry actions
    // never produce, so say so rather than dropping the ids silently.
    if (generation.learningDigestIds !== undefined) {
      console.warn(
        `Learning digest handoff for generation ${generation._id} arrived before its prompt version was stamped; ids were not recorded.`
      );
    } else if (generation.promptVersion !== undefined) {
      console.warn(
        `Learning digest handoff for generation ${generation._id} found a prompt version without a digest union array; ids were not recorded.`
      );
    }
    return null;
  }
  const next = [
    ...new Set([...generation.learningDigestIds, ...args.digestIds]),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (
    next.length !== generation.learningDigestIds.length ||
    next.some((id, index) => id !== generation.learningDigestIds?.[index])
  ) {
    await ctx.db.patch(generation._id, { learningDigestIds: next });
  }
  return null;
}

/** Argument validators of generations.failGeneration. */
export const failGenerationArgs = {
  generationId: v.id("generations"),
  error: v.string(),
};

/** Handler of generations.failGeneration. */
export async function failGenerationHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof failGenerationArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (
    !generation ||
    (generation.status !== "reserved" && generation.status !== "running")
  ) {
    return;
  }
  await transitionGeneration(ctx, generation, "failed", {
    currentStep: "Failed",
    error: args.error.slice(0, 500),
    completedAt: Date.now(),
  });
  await terminalizeOrphanedCandidateRuns(
    ctx,
    generation._id,
    "The generation failed before this draft completed."
  );
  if (
    resolveGatedWorkflow(generation) === "seeds" &&
    generation.summaryVersionId !== undefined
  ) {
    await terminalizeSignedOffSeedSections(
      ctx,
      generation._id,
      "The generation failed before this section draft completed."
    );
  }
  const project = await ctx.db.get(generation.projectId);
  if (project?.activeGenerationId === generation._id) {
    await ctx.db.patch(project._id, {
      activeGenerationId: undefined,
      status: restorableProjectStatus(generation.previousProjectStatus),
      updatedAt: Date.now(),
    });
  }
  await refreshProjectGenerationActivity(ctx, generation.projectId);
}

/** Argument validators of generations.setGenerationEstimate. */
export const setGenerationEstimateArgs = {
  generationId: v.id("generations"),
  estimatedMs: v.number(),
  totalCandidates: v.number(),
};

/** Handler of generations.setGenerationEstimate. */
export async function setGenerationEstimateHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof setGenerationEstimateArgs>
) {
  await ctx.db.patch(args.generationId, {
    estimatedMs: args.estimatedMs,
    totalCandidates: args.totalCandidates,
  });
}

/** Argument validators of generations.setBrainProvenance. */
export const setBrainProvenanceArgs = {
  generationId: v.id("generations"),
  exemplars: v.array(
    v.object({
      entryId: v.string(),
      score: v.number(),
      title: v.optional(v.string()),
      writerName: v.optional(v.string()),
      section: v.optional(v.string()),
      sourceId: v.optional(v.string()),
      searchScore: v.optional(v.number()),
      rerankScore: v.optional(v.number()),
    })
  ),
  brief: v.optional(v.string()),
};

/** Handler of generations.setBrainProvenance. */
export async function setBrainProvenanceHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof setBrainProvenanceArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) throw new Error(`Generation ${args.generationId} not found`);
  // Child rows (2026-09-25), not fields of the live generation row.
  await writeBrainProvenance(ctx, generation, args.exemplars, args.brief);
}

/** Argument validators of generations.appendProgress. */
export const appendProgressArgs = { generationId: v.id("generations"), line: v.string() };

/** Handler of generations.appendProgress. */
export async function appendProgressHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof appendProgressArgs>
) {
  const gen = await ctx.db.get(args.generationId);
  if (!gen) return;
  // A child row, not a rewrite of the live generation row (2026-09-25).
  await appendGenerationProgress(ctx, gen, [args.line]);
}

/** Argument validators of generations.recordWriterSettings. */
export const recordWriterSettingsArgs = {
  generationId: v.id("generations"),
  writerSettings: writerSettingsValidator,
};

/** Handler of generations.recordWriterSettings. */
export async function recordWriterSettingsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof recordWriterSettingsArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  if (await isProjectDeleting(ctx, generation.projectId)) return null;
  if (resolveGatedWorkflow(generation) === "seeds") {
    const project = await ctx.db.get(generation.projectId);
    if (generation.status !== "running" || project?.activeGenerationId !== generation._id) return null;
  }
  if (resolveGatedWorkflow(generation) === "seeds" && generation.writerSettings) return null;
  // The validator admits only the six categories; dedupe bounds the list.
  const { addressedCategories, ...record } = args.writerSettings;
  await ctx.db.patch(args.generationId, {
    writerSettings: {
      ...record,
      ...(addressedCategories
        ? { addressedCategories: [...new Set(addressedCategories)] }
        : {}),
    },
  });
  return null;
}

/** Argument validators of generations.updateGenerationStatus. */
export const updateGenerationStatusArgs = {
  generationId: v.id("generations"),
  status: v.union(
    v.literal("running"),
    v.literal("awaiting_selection"),
    v.literal("awaiting_input"),
    v.literal("completed"),
    v.literal("failed")
  ),
  currentStep: v.optional(v.string()),
  agentOutputs: v.optional(v.string()),
  error: v.optional(v.string()),
  completedAt: v.optional(v.number()),
};

/** Handler of generations.updateGenerationStatus. */
export async function updateGenerationStatusHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof updateGenerationStatusArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  // Never resurrect a terminal generation: a writer cancel (→ failed) can
  // land inside the pipeline's multi-mutation setup window, after which the
  // action's own "running" patch would zombie the row while the project
  // pointer is already cleared.
  if (!generation || isTerminalGenerationStatus(generation.status)) return;
  if (await isProjectDeleting(ctx, generation.projectId)) return;
  // Any other move the transition table does not declare for this row's
  // flow is refused (INVALID_TRANSITION) rather than written.
  if (args.agentOutputs !== undefined) {
    await writeAgentOutputs(ctx, generation, args.agentOutputs);
  }
  await transitionGeneration(ctx, generation, args.status, {
    ...(args.currentStep !== undefined ? { currentStep: args.currentStep } : {}),
    ...(args.error !== undefined ? { error: args.error } : {}),
    ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
  });
  await refreshProjectGenerationActivity(ctx, generation.projectId);
}
