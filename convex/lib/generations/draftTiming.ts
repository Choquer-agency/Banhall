/**
 * How long a finished draft took, read only from timestamps every generation
 * already stores (2026-11-02, client request: "did it take 15 minutes or an
 * hour"). No field is added and nothing is backfilled: a row that lacks a
 * stamp a rule needs reads as null, and the page shows nothing for it.
 *
 * - Single: from the start of the run to its completion.
 * - Compare: from the start of the run to the moment the last candidate
 *   settled. The writer's pick (the generation's own `completedAt`) is not
 *   drafting time, so it is left out.
 * - Step by step (seed workflow): the Step by step part runs from the start of
 *   the run that signed the Summary off to the sign-off; the drafting part
 *   runs from the sign-off to completion. A retry from a signed-off Summary
 *   drafts from its own start, and its Step by step part is the origin
 *   run's. "Draft the rest" is a later, separate action and never counts.
 * - Legacy section-by-section runs mix writer approvals with drafting, so
 *   they read as null.
 */
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { resolveGatedWorkflow } from "../gatedWorkflow";

export type DraftTiming = {
  /** Drafting time in milliseconds, or null when it cannot be told. */
  draftMs: number | null;
  /** Step by step only: start of Step by step to the Summary sign-off. */
  stepByStepMs: number | null;
};

/** Candidate runs a generation can hold (compare pairs and their retries). */
const MAX_CANDIDATE_RUNS = 10;

function span(from: number | undefined, to: number | undefined): number | null {
  if (typeof from !== "number" || typeof to !== "number") return null;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const ms = to - from;
  return ms > 0 ? ms : null;
}

function result(draftMs: number | null, stepByStepMs: number | null): DraftTiming | null {
  return draftMs === null && stepByStepMs === null ? null : { draftMs, stepByStepMs };
}

/** The timing of one finished draft, or null when there is nothing to show. */
export async function draftTimingOf(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">
): Promise<DraftTiming | null> {
  if (generation.status !== "completed") return null;
  const mode = generation.candidateMode ?? "compare";

  if (mode === "single") {
    return result(span(generation.startedAt, generation.completedAt), null);
  }

  if (mode === "compare") {
    const runs = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(MAX_CANDIDATE_RUNS);
    let lastSettled: number | undefined;
    for (const run of runs) {
      if (run.ghost || run.projectId !== generation.projectId) continue;
      if (run.status !== "succeeded" && run.status !== "failed") continue;
      if (typeof run.completedAt !== "number") continue;
      lastSettled = Math.max(lastSettled ?? run.completedAt, run.completedAt);
    }
    // Never past the pick: a stamp after it is not drafting time.
    if (
      lastSettled !== undefined &&
      typeof generation.completedAt === "number" &&
      lastSettled > generation.completedAt
    ) {
      lastSettled = generation.completedAt;
    }
    return result(span(generation.startedAt, lastSettled), null);
  }

  // Iterative: only the seed workflow has a clean drafting window.
  if (resolveGatedWorkflow(generation) !== "seeds" || !generation.summaryVersionId) {
    return null;
  }
  const summary = await ctx.db.get(generation.summaryVersionId);
  if (!summary || summary.projectId !== generation.projectId) return null;
  const signedOffAt = summary.signedOffAt;
  if (summary.generationId === generation._id) {
    return result(
      span(signedOffAt, generation.completedAt),
      span(generation.startedAt, signedOffAt)
    );
  }
  // A retry from a signed-off Summary: it drafts from its own start, and the
  // Step by step part belongs to the run that signed the Summary off.
  const origin = await ctx.db.get(summary.generationId);
  const stepByStepMs =
    origin && origin.projectId === generation.projectId
      ? span(origin.startedAt, signedOffAt)
      : null;
  return result(span(generation.startedAt, generation.completedAt), stepByStepMs);
}
