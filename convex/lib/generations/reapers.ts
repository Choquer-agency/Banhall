/**
 * Recovery of stranded work: stale generations and seed batches, and
 * projects left in "generating".
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { v, type Infer, type ObjectType } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import { reapSeedAttempts } from "../../seedRuns";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { isProjectDeleting } from "../projectDeletion";
import { SEED_INITIALIZATION_ERROR } from "./seedStage";
import { appendGenerationProgress } from "../generationProgress";
import { transitionGeneration } from "../generationTransitions";
import { refreshProjectGenerationActivity } from "../dashboardProjection";
import {
  terminalizeSignedOffSeedSections,
  terminalizeOrphanedCandidateRuns,
} from "./candidates";
import {
  isTerminalGenerationStatus,
  ACTIVE_GENERATION_STATUSES,
} from "../../../shared/generationTransitions";
import { findActiveGeneration } from "../activeGeneration";

/** Argument validators of generations.reapSeedBatchPage. */
export const reapSeedBatchPageArgs = { status: v.union(v.literal("queued"), v.literal("running")), cutoff: v.number(), pageSize: v.optional(v.number()) };

/** Handler of generations.reapSeedBatchPage. */
export async function reapSeedBatchPageHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof reapSeedBatchPageArgs>
): Promise<null> {
  const pageSize = Math.min(50, Math.max(1, Math.floor(args.pageSize ?? 50)));
  const page = await reapSeedAttempts(ctx, { ...args, cursor: null, pageSize });
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.generations.reapSeedBatchPage, { status: args.status, cutoff: args.cutoff, pageSize });
  return null;
}

/** Page size for the running-generation scan: one page of `generations` in
 * "running" older than the cutoff per transaction. Tests override it through
 * `pageSize`. */
export const STALE_GENERATION_SCAN_PAGE_SIZE = 100;

/** The one `staleGenerationScans` row: the scan owner record. */
export const STALE_SCAN_KEY = "stale_generations";

export async function staleScanRecord(ctx: MutationCtx) {
  return await ctx.db
    .query("staleGenerationScans")
    .withIndex("by_key", (q) => q.eq("key", STALE_SCAN_KEY))
    .unique();
}

export const staleScanResultValidator = v.object({
  failed: v.number(),
  orphanedRuns: v.number(),
  scanned: v.number(),
  isDone: v.boolean(),
  projectSweepJobId: v.optional(v.id("_scheduled_functions")),
  skipped: v.optional(
    v.union(v.literal("scan_in_progress"), v.literal("stale_continuation"))
  ),
});

export type StaleScanResult = Infer<typeof staleScanResultValidator>;

/** Argument validators of generations.failStaleGenerations. */
export const failStaleGenerationsArgs = {
  olderThanMinutes: v.optional(v.number()),
  // Continuation pages only: the first page's cutoff (kept stable so the
  // cursor stays valid for the same index range), where to resume, and the
  // scan sequence number this page belongs to.
  cutoff: v.optional(v.number()),
  cursor: v.optional(v.union(v.string(), v.null())),
  scan: v.optional(v.number()),
  pageSize: v.optional(v.number()),
};

/** Handler of generations.failStaleGenerations. */
export async function failStaleGenerationsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof failStaleGenerationsArgs>
): Promise<StaleScanResult> {
  const cutoff =
    args.cutoff ?? Date.now() - (args.olderThanMinutes ?? 30) * 60 * 1000;
  const firstPage = args.cursor === undefined;
  const skipped = (reason: "scan_in_progress" | "stale_continuation") => ({
    failed: 0,
    orphanedRuns: 0,
    scanned: 0,
    isDone: false,
    skipped: reason,
  });
  const owner = await staleScanRecord(ctx);
  let scan: number;
  let ownerId: Id<"staleGenerationScans">;
  if (firstPage) {
    const continuation = owner?.continuationJobId
      ? await ctx.db.system.get("_scheduled_functions", owner.continuationJobId)
      : null;
    if (
      continuation &&
      (continuation.state.kind === "pending" || continuation.state.kind === "inProgress")
    ) {
      return skipped("scan_in_progress");
    }
    // Take ownership: the next sequence number, no pending page yet.
    scan = (owner?.scan ?? 0) + 1;
    const now = Date.now();
    if (owner) {
      ownerId = owner._id;
      await ctx.db.patch(owner._id, {
        scan,
        cutoff,
        continuationJobId: undefined,
        startedAt: now,
        updatedAt: now,
      });
    } else {
      ownerId = await ctx.db.insert("staleGenerationScans", {
        key: STALE_SCAN_KEY,
        scan,
        cutoff,
        startedAt: now,
        updatedAt: now,
      });
    }
  } else {
    if (!owner || args.scan === undefined || owner.scan !== args.scan) {
      return skipped("stale_continuation");
    }
    scan = args.scan;
    ownerId = owner._id;
  }
  if (firstPage) {
    for (const status of ["queued", "running"] as const) {
      await ctx.scheduler.runAfter(0, internal.generations.reapSeedBatchPage, { status, cutoff: Date.now() });
    }
  }
  // A caller may shrink the page (tests) but never grow it past the bound.
  const pageSize = Math.min(
    Math.max(1, Math.floor(args.pageSize ?? STALE_GENERATION_SCAN_PAGE_SIZE)),
    STALE_GENERATION_SCAN_PAGE_SIZE
  );
  // Reserved rows never stamp progress, so every one selected here is
  // failed below and leaves the range: one page per cron run drains them.
  const reserved = firstPage
    ? await ctx.db
        .query("generations")
        .withIndex("by_status_and_startedAt", (q) =>
          q.eq("status", "reserved").lt("startedAt", cutoff)
        )
        .take(100)
    : [];
  const runningPage = await ctx.db
    .query("generations")
    .withIndex("by_status_and_startedAt", (q) =>
      q.eq("status", "running").lt("startedAt", cutoff)
    )
    .paginate({ numItems: pageSize, cursor: args.cursor ?? null });
  const stale = [...reserved, ...runningPage.page];
  let failed = 0;
  for (const generation of stale) {
    const signedOffSeedDrafting =
      generation.status === "running" &&
      resolveGatedWorkflow(generation) === "seeds" &&
      generation.summaryVersionId !== undefined;
    if (generation.status === "running" && resolveGatedWorkflow(generation) === "seeds" && !generation.summaryVersionId) {
      if (!await isProjectDeleting(ctx, generation.projectId)) {
        const project = await ctx.db.get(generation.projectId);
        if (project?.activeGenerationId === generation._id) {
          await ctx.db.patch(generation._id, { seedStageError: SEED_INITIALIZATION_ERROR, currentStep: "Seed preparation needs a retry" });
        }
      }
      continue;
    }
    // Iterative generations in "running" mean ONE section is drafting; a
    // stale section run fails alone and hands control back to the writer
    // (awaiting_input → regenerate), never killing the whole run. Note the
    // reaper deliberately skips awaiting_input generations entirely —
    // writer thinking time is unbounded.
    if (
      generation.status === "running" &&
      (generation.candidateMode ?? "compare") === "iterative" &&
      !signedOffSeedDrafting
    ) {
      const sectionRuns = await ctx.db
        .query("generationSectionRuns")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", generation._id)
        )
        .take(10);
      // No section runs at all = the startup action died before fan-out
      // (analyzer/brain phase); fall through to the whole-generation fail.
      if (sectionRuns.length > 0) {
        const staleRuns = sectionRuns.filter(
          (run) =>
            (run.status === "queued" || run.status === "running") &&
            (run.startedAt ?? run.queuedAt) < cutoff
        );
        if (staleRuns.length === 0) continue;
        for (const run of staleRuns) {
          await ctx.db.patch(run._id, {
            status: "failed",
            error: "Timed out before the section draft completed.",
            completedAt: Date.now(),
          });
        }
        await appendGenerationProgress(ctx, generation, [
          "✗ Section draft timed out. Use Regenerate to retry.",
        ]);
        await transitionGeneration(ctx, generation, "awaiting_input", {
          currentStep: "Section draft timed out — regenerate to retry",
        });
        await refreshProjectGenerationActivity(ctx, generation.projectId);
        failed += 1;
        continue;
      }
    }
    // DW-119 (progress-aware recovery): an ordered single/compare chain
    // stamps lastProgressAt when a section run is created, claimed or
    // drafted, so a slow but live chain is aged from its last progress,
    // not from startedAt. A chain whose current action died (timeout,
    // deploy restart) stops stamping and is failed here once the same
    // window elapses from that last stamp — a single stuck action is still
    // reaped. Iterative never stamps and keeps its per-section path above.
    if (
      generation.status === "running" &&
      ((generation.candidateMode ?? "compare") !== "iterative" ||
        signedOffSeedDrafting) &&
      generation.lastProgressAt !== undefined &&
      generation.lastProgressAt >= cutoff
    ) {
      continue;
    }
    failed += 1;
    await transitionGeneration(ctx, generation, "failed", {
      currentStep: "Failed",
      error: "Timed out before generation completed.",
      completedAt: Date.now(),
    });
    // In-flight candidate runs die with the generation — otherwise they
    // read "running" forever (skewed stats, invisible to retry).
    if (signedOffSeedDrafting) {
      await terminalizeSignedOffSeedSections(
        ctx,
        generation._id,
        "Timed out before the section draft completed."
      );
    }
    await terminalizeOrphanedCandidateRuns(
      ctx,
      generation._id,
      "Timed out before the draft completed."
    );
    const project = await ctx.db.get(generation.projectId);
    if (project?.activeGenerationId === generation._id) {
      await ctx.db.patch(project._id, {
        activeGenerationId: undefined,
        status: generation.previousProjectStatus ?? "draft",
        updatedAt: Date.now(),
      });
    } else if (project?.status === "generating" && !project.activeGenerationId) {
      const [reservedActive, runningActive] = await Promise.all([
        ctx.db
          .query("generations")
          .withIndex("by_projectId_and_status", (q) =>
            q.eq("projectId", project._id).eq("status", "reserved")
          )
          .first(),
        ctx.db
          .query("generations")
          .withIndex("by_projectId_and_status", (q) =>
            q.eq("projectId", project._id).eq("status", "running")
          )
          .first(),
      ]);
      if (!reservedActive && !runningActive) {
        await ctx.db.patch(project._id, {
          status: generation.previousProjectStatus ?? "draft",
          updatedAt: Date.now(),
        });
      }
    }
    await refreshProjectGenerationActivity(ctx, generation.projectId);
  }

  if (!runningPage.isDone) {
    // Failed rows have left the "running" range and live rows stay in it,
    // but the cursor is an index position rather than an offset, so the
    // next page resumes exactly after the last row read here. The owner
    // record names the new page in the same transaction that schedules it.
    const continuationJobId = await ctx.scheduler.runAfter(
      0,
      internal.generations.failStaleGenerations,
      {
        cutoff,
        cursor: runningPage.continueCursor,
        scan,
        ...(args.pageSize !== undefined ? { pageSize } : {}),
      }
    );
    await ctx.db.patch(ownerId, { continuationJobId, updatedAt: Date.now() });
  } else {
    // The scan's last page: release ownership.
    await ctx.db.patch(ownerId, { continuationJobId: undefined, updatedAt: Date.now() });
  }
  const scanned = runningPage.page.length;
  if (!firstPage) {
    return { failed, orphanedRuns: 0, scanned, isDone: runningPage.isDone };
  }

  // Also free projects orphaned in "generating" with no live generation —
  // e.g. the client dies between createProject and requestGeneration, or a
  // legacy failure predates the activeGenerationId cleanup. Without this the
  // project stays locked on a generation that never existed. The sweep walks
  // the projects.by_status index one bounded page per transaction (CAP-11),
  // so it runs as its own self-continuing job rather than inline here.
  const projectSweepJobId: Id<"_scheduled_functions"> = await ctx.scheduler.runAfter(
    0,
    internal.generations.freeOrphanedGeneratingProjects,
    { cutoff }
  );

  // Candidate runs stranded queued/running after their generation already
  // went terminal (e.g. a hard ghost-draft death after a writer cancel, or
  // whole-fails from before runs were terminalized in the same mutation).
  // A run under a live generation is left alone — it may still report back.
  let orphanedRuns = 0;
  const queuedRuns = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_status_and_startedAt", (q) => q.eq("status", "queued"))
    .take(100);
  const runningRuns = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_status_and_startedAt", (q) =>
      q.eq("status", "running").lt("startedAt", cutoff)
    )
    .take(100);
  for (const run of [...queuedRuns, ...runningRuns]) {
    // Queued rows carry no startedAt; age them from queuedAt instead.
    if ((run.startedAt ?? run.queuedAt) >= cutoff) continue;
    const generation = await ctx.db.get(run.generationId);
    if (generation && !isTerminalGenerationStatus(generation.status)) continue;
    await ctx.db.patch(run._id, {
      status: "failed",
      error: "The generation ended before this draft completed.",
      completedAt: Date.now(),
    });
    orphanedRuns += 1;
  }
  return { failed, orphanedRuns, scanned, isDone: runningPage.isDone, projectSweepJobId };
}

/** Page size for the orphaned-project sweep: one page of `projects` in
 * "generating" per transaction. Tests override it through `pageSize`. */
export const STALE_PROJECT_SWEEP_PAGE_SIZE = 100;

/** Argument validators of generations.freeOrphanedGeneratingProjects. */
export const freeOrphanedGeneratingProjectsArgs = {
  cutoff: v.number(),
  cursor: v.optional(v.union(v.string(), v.null())),
  pageSize: v.optional(v.number()),
};

/** Handler of generations.freeOrphanedGeneratingProjects. */
export async function freeOrphanedGeneratingProjectsHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof freeOrphanedGeneratingProjectsArgs>
) {
  const pageSize = Math.max(
    1,
    Math.floor(args.pageSize ?? STALE_PROJECT_SWEEP_PAGE_SIZE)
  );
  const { page, isDone, continueCursor } = await ctx.db
    .query("projects")
    .withIndex("by_status", (q) => q.eq("status", "generating"))
    .paginate({ numItems: pageSize, cursor: args.cursor ?? null });
  let freed = 0;
  for (const project of page) {
    if (project.updatedAt > args.cutoff) continue;
    const active = await findActiveGeneration(
      ctx,
      project,
      ACTIVE_GENERATION_STATUSES
    );
    if (active) continue;
    const lastGeneration = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .order("desc")
      .first();
    await ctx.db.patch(project._id, {
      activeGenerationId: undefined,
      status: lastGeneration?.previousProjectStatus ?? "draft",
      updatedAt: Date.now(),
    });
    await refreshProjectGenerationActivity(ctx, project._id);
    freed += 1;
  }
  if (!isDone) {
    // Freed rows have left the "generating" index range, but the cursor is
    // an index position rather than an offset, so the next page resumes
    // exactly after the last row read here.
    await ctx.scheduler.runAfter(
      0,
      internal.generations.freeOrphanedGeneratingProjects,
      {
        cutoff: args.cutoff,
        cursor: continueCursor,
        ...(args.pageSize !== undefined ? { pageSize: args.pageSize } : {}),
      }
    );
  }
  return { freed, scanned: page.length, isDone };
}
