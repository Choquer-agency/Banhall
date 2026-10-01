/**
 * The guard every seed-stage write shares (the Brief and the seed stage both
 * use it, so it sits below both).
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { domainError } from "../contracts";
import { isProjectDeleting } from "../projectDeletion";

/** Seeds pin a reusable Brief (including explicit absence) before model work. */
export async function requireSeedInitialization(ctx: MutationCtx, generationId: Id<"generations">) {
  const generation = await ctx.db.get(generationId);
  if (!generation || resolveGatedWorkflow(generation) !== "seeds") {
    domainError("INVALID_STATE", "Seed initialization is unavailable");
  }
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.activeGenerationId !== generationId ||
      await isProjectDeleting(ctx, generation.projectId) ||
      (generation.status !== "running" && generation.status !== "awaiting_input") ||
      generation.summaryVersionId) {
    domainError("INVALID_STATE", "Seed initialization is no longer active");
  }
  return generation;
}
