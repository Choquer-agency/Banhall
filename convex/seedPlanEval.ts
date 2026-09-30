import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { PD_SUBSECTIONS } from "../shared/pdSubsections";
import { isReleaseEvalProjectTitle } from "../shared/releaseEval";
import { extractReportSections } from "./lib/tiptapReport";
import {
  draftingInputsStatusValidator,
  draftingInputsView,
} from "./lib/generations/draftingInputs";

/**
 * Read side of the release-blocking semantic suite (Step by step, CAP-13;
 * scripts/seed-plan-eval.mjs). Internal and read-only: the script performs
 * the writer's actions through the public mutations as the named reviewer,
 * and reads the outcome here. Every read refuses a project whose title does
 * not carry the release-eval prefix, so this module never returns a client
 * project's text.
 */

const LIMITS = {
  projects: 500,
  batchesPerRole: 60,
  seedsPerRole: 400,
  feedbackPerRole: 60,
  contextRowsPerBatch: 200,
  events: 4000,
  summaryItems: 400,
  complianceNotes: 1000,
  briefEntries: 400,
  usage: 4000,
};

async function evalGeneration(
  ctx: QueryCtx,
  generationId: Id<"generations">,
): Promise<{ generation: Doc<"generations">; project: Doc<"projects"> }> {
  const generation = await ctx.db.get(generationId);
  if (!generation) throw new Error("Generation not found");
  const project = await ctx.db.get(generation.projectId);
  if (!project || !isReleaseEvalProjectTitle(project.title)) {
    throw new Error("Not a release eval project");
  }
  return { generation, project };
}

/** The reviewer the suite acts as: an internal user with a role. */
export const evalActor = internalQuery({
  args: { email: v.string() },
  returns: v.union(
    v.null(),
    v.object({ userId: v.id("users"), authId: v.string(), role: v.string() }),
  ),
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
      .take(2);
    const user = users.length === 1 ? users[0] : null;
    if (!user || !user.authId || !user.role || user.isAnonymous === true) {
      return null;
    }
    return { userId: user._id, authId: user.authId, role: user.role };
  },
});

/** The eval projects the reviewer owns, for --cleanup and the pre-run notice. */
export const listEvalProjects = internalQuery({
  args: { ownerId: v.id("users") },
  returns: v.array(
    v.object({
      projectId: v.id("projects"),
      title: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
      .take(LIMITS.projects);
    return rows
      .filter(
        (project) =>
          isReleaseEvalProjectTitle(project.title) &&
          project.deletionStartedAt === undefined,
      )
      .map((project) => ({
        projectId: project._id,
        title: project.title,
        createdAt: project.createdAt,
      }));
  },
});

/** The latest generation of an eval project (null before the first start). */
export const latestGeneration = internalQuery({
  args: { projectId: v.id("projects") },
  returns: v.union(v.null(), v.object({ generationId: v.id("generations") })),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !isReleaseEvalProjectTitle(project.title)) {
      throw new Error("Not a release eval project");
    }
    const generation = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    return generation ? { generationId: generation._id } : null;
  },
});

/** What the script polls while it waits: lifecycle, seed stage and report. */
export const progress = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.object({
    status: v.string(),
    candidateMode: v.union(v.string(), v.null()),
    gatedWorkflow: v.union(v.string(), v.null()),
    seedSubsections: v.number(),
    seedStageVersion: v.number(),
    seedStageError: v.union(v.string(), v.null()),
    summaryVersionId: v.union(v.id("summaryVersions"), v.null()),
    draftingInputs: draftingInputsStatusValidator,
    requestedAt: v.union(v.number(), v.null()),
    singleModelId: v.union(v.string(), v.null()),
    reportId: v.union(v.id("reports"), v.null()),
    reportGeneratedAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const { generation } = await evalGeneration(ctx, args.generationId);
    const rows = await ctx.db
      .query("seedSubsections")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(PD_SUBSECTIONS.length + 1);
    const report = await ctx.db
      .query("reports")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .order("asc")
      .first();
    return {
      status: generation.status,
      candidateMode: generation.candidateMode ?? null,
      gatedWorkflow: generation.gatedWorkflow ?? null,
      seedSubsections: rows.length,
      seedStageVersion: generation.seedStageVersion ?? 0,
      seedStageError: generation.seedStageError ?? null,
      summaryVersionId: generation.summaryVersionId ?? null,
      draftingInputs: draftingInputsView(generation).status,
      requestedAt: generation.requestedAt ?? null,
      singleModelId: generation.singleModelId ?? null,
      reportId: report?._id ?? null,
      reportGeneratedAt: report?.generatedAt ?? null,
    };
  },
});

/** The frozen Brief's Claim Exclusions (the exclusion fixture edits one in). */
export const briefExclusions = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.array(
    v.object({
      entryId: v.id("generationBriefEntries"),
      text: v.string(),
      reason: v.union(v.string(), v.null()),
      exactExcerpt: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const { generation } = await evalGeneration(ctx, args.generationId);
    const briefId = generation.briefVersionId ?? generation.briefId;
    if (!briefId) return [];
    const entries = await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
      .take(LIMITS.briefEntries);
    return entries
      .filter((entry) => entry.group === "claimExclusion")
      .map((entry) => ({
        entryId: entry._id,
        text: entry.text,
        reason: entry.reason ?? null,
        exactExcerpt: entry.exactExcerpt,
      }));
  },
});

/**
 * Everything the judging pack needs for one fixture run: the plan as
 * decided and as signed off, the batch timings and events behind the
 * CAP-14 numbers, the drafted Sections, the Compliance Note and the usage
 * rows. Seed-decision events carry no text by design (CAP-15); the text
 * here comes from the seed, summary and report rows of an eval project.
 */
export const collect = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const { generation, project } = await evalGeneration(ctx, args.generationId);
    const truncated: string[] = [];
    const bounded = <T,>(label: string, rows: T[], limit: number): T[] => {
      if (rows.length > limit) {
        truncated.push(label);
        return rows.slice(0, limit);
      }
      return rows;
    };

    const subsections = await ctx.db
      .query("seedSubsections")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(PD_SUBSECTIONS.length + 1);

    const batches: Doc<"seedBatches">[] = [];
    const seeds: Doc<"seeds">[] = [];
    const feedback: Doc<"seedFeedbackRequests">[] = [];
    for (const role of PD_SUBSECTIONS) {
      const roleBatches = await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (q) =>
          q.eq("generationId", generation._id).eq("roleId", role.roleId),
        )
        .take(LIMITS.batchesPerRole + 1);
      batches.push(...bounded(`batches:${role.roleId}`, roleBatches, LIMITS.batchesPerRole));
      const roleSeeds = await ctx.db
        .query("seeds")
        .withIndex("by_generationId_and_roleId", (q) =>
          q.eq("generationId", generation._id).eq("roleId", role.roleId),
        )
        .take(LIMITS.seedsPerRole + 1);
      seeds.push(...bounded(`seeds:${role.roleId}`, roleSeeds, LIMITS.seedsPerRole));
      const roleFeedback = await ctx.db
        .query("seedFeedbackRequests")
        .withIndex("by_generationId_and_roleId", (q) =>
          q.eq("generationId", generation._id).eq("roleId", role.roleId),
        )
        .take(LIMITS.feedbackPerRole + 1);
      feedback.push(...bounded(`feedback:${role.roleId}`, roleFeedback, LIMITS.feedbackPerRole));
    }

    const batchContext = [];
    for (const batch of batches) {
      const rows = await ctx.db
        .query("seedBatchContext")
        .withIndex("by_batchId", (q) => q.eq("batchId", batch._id))
        .take(LIMITS.contextRowsPerBatch + 1);
      for (const row of bounded(`context:${batch._id}`, rows, LIMITS.contextRowsPerBatch)) {
        batchContext.push({
          batchId: row.batchId,
          roleId: row.roleId,
          kind: row.kind,
          sourceRoleId: row.sourceRoleId,
          seedId: row.seedId ?? null,
          feedbackRequestId: row.feedbackRequestId ?? null,
        });
      }
    }

    const events = await ctx.db
      .query("seedDecisionEvents")
      .withIndex("by_generationId_and_at", (q) => q.eq("generationId", generation._id))
      .take(LIMITS.events + 1);

    let summary = null;
    if (generation.summaryVersionId) {
      const version = await ctx.db.get(generation.summaryVersionId);
      if (version) {
        const items = await ctx.db
          .query("summaryItems")
          .withIndex("by_summaryVersionId_and_order", (q) =>
            q.eq("summaryVersionId", version._id),
          )
          .take(LIMITS.summaryItems + 1);
        summary = {
          summaryVersionId: version._id,
          version: version.version,
          skippedRoleIds: version.skippedRoleIds,
          droppedUncertaintySeedIds: (version.droppedUncertainties ?? []).map((entry) => entry.seedId),
          signedOffAt: version.signedOffAt,
          items: bounded("summaryItems", items, LIMITS.summaryItems).map((item) => ({
            itemId: item._id,
            roleId: item.roleId,
            kind: item.kind,
            order: item.order,
            seedId: item.seedId,
            bullets: item.bullets,
            support: item.support,
            tags: item.tags,
            uncertaintySeedId: item.uncertaintySeedId ?? null,
            experimentSeedIds: item.experimentSeedIds ?? [],
            // 2026-09-30 (fourth): the uncertainties a result item answers.
            answeredUncertaintySeedIds: item.answeredUncertaintySeedIds ?? [],
            confirmedExclusion: item.confirmedExclusion ?? false,
            edited: item.edited ?? null,
          })),
        };
      }
    }

    const complianceNotes = await ctx.db
      .query("complianceNotes")
      .withIndex("by_generationId_and_section", (q) => q.eq("generationId", generation._id))
      .take(LIMITS.complianceNotes + 1);

    const report = await ctx.db
      .query("reports")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .order("asc")
      .first();

    const briefId = generation.briefVersionId ?? generation.briefId;
    const briefEntries = briefId
      ? await ctx.db
          .query("generationBriefEntries")
          .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
          .take(LIMITS.briefEntries + 1)
      : [];

    const usage = await ctx.db
      .query("aiUsage")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(LIMITS.usage + 1);

    return {
      project: { projectId: project._id, title: project.title },
      generation: {
        generationId: generation._id,
        status: generation.status,
        candidateMode: generation.candidateMode ?? null,
        gatedWorkflow: generation.gatedWorkflow ?? null,
        requestedAt: generation.requestedAt ?? null,
        seedRequestsReserved: generation.seedRequestsReserved ?? 0,
        seedStageVersion: generation.seedStageVersion ?? 0,
        singleModelId: generation.singleModelId ?? null,
        briefVersionId: briefId ?? null,
        summaryVersionId: generation.summaryVersionId ?? null,
      },
      subsections: subsections.map((row) => ({
        roleId: row.roleId,
        kind: row.kind,
        state: row.state,
        currentContextRevision: row.currentContextRevision,
        approvedContextRevision: row.approvedContextRevision ?? null,
        approvedWithConfirmation: row.approvedWithConfirmation ?? false,
        exclusionAcknowledgedAt: row.exclusionAcknowledgedAt ?? null,
        consecutiveFailures: row.consecutiveFailures,
      })),
      batches: batches.map((batch) => ({
        batchId: batch._id,
        roleId: batch.roleId,
        operation: batch.operation,
        status: batch.status,
        queuedAt: batch.queuedAt,
        startedAt: batch.startedAt ?? null,
        completedAt: batch.completedAt ?? null,
        deliveredLateAt: batch.deliveredLateAt ?? null,
        roleOpen: batch.roleOpen ?? false,
        startedBy: batch.startedBy ?? null,
        requestsMade: batch.requestsMade ?? null,
        seedsDropped: batch.seedsDropped ?? null,
        consumedContextRevision: batch.consumedContextRevision,
        feedbackRequestId: batch.feedbackRequestId ?? null,
        model: batch.model,
        slot: batch.slot,
        failed: batch.status === "failed",
        // 2026-09-28 (fourth): why a Batch failed, so a suite report shows it.
        error: batch.error ?? null,
        errorDetail: batch.errorDetail ?? null,
        // 2026-09-29 (first, run 7): each rejected answer as counts.
        invalidAnswers: batch.invalidAnswers ?? [],
      })),
      seeds: seeds.map((seed) => ({
        seedId: seed._id,
        batchId: seed.batchId,
        roleId: seed.roleId,
        order: seed.order,
        bullets: seed.bullets,
        tags: seed.tags,
        support: seed.support,
        originalSupport: seed.originalSupport,
        revisionOfSeedId: seed.revisionOfSeedId ?? null,
        feedbackRequestId: seed.feedbackRequestId ?? null,
        uncertaintySeedId: seed.uncertaintySeedId ?? null,
        experimentSeedIds: seed.experimentSeedIds ?? [],
        answeredUncertaintySeedIds: seed.answeredUncertaintySeedIds ?? [],
      })),
      feedback: feedback.map((request) => ({
        feedbackRequestId: request._id,
        roleId: request.roleId,
        targetSeedId: request.targetSeedId,
        instruction: request.instruction,
        status: request.status,
        withdrawnAt: request.withdrawnAt ?? null,
        batchId: request.batchId ?? null,
      })),
      batchContext,
      events: bounded("events", events, LIMITS.events).map((event) => ({
        kind: event.kind,
        at: event.at,
        roleId: "roleId" in event ? event.roleId : null,
        actor: "actorUserId" in event ? ("user" as const) : ("system" as const),
        batchId: event.batchId ?? null,
        seedId: event.seedId ?? null,
        feedbackRequestId: event.feedbackRequestId ?? null,
        confirmed: event.confirmed ?? null,
        editRatio: event.editRatio ?? null,
        outcome: event.outcome ?? null,
      })),
      summary,
      complianceNotes: bounded("complianceNotes", complianceNotes, LIMITS.complianceNotes).map(
        (note) => ({
          section: note.section,
          paragraphIndex: note.paragraphIndex ?? null,
          source: note.source,
          instruction: note.instruction,
          outcome: note.outcome,
          tier: note.tier,
          reason: note.reason,
          repaired: note.repaired,
          planRef: note.planRef
            ? {
                itemId: note.planRef.itemId ?? null,
                skippedRoleId: note.planRef.skippedRoleId ?? null,
                // 2026-09-30 (first): the LEAVE OUT rows and Line 246's
                // advancement row.
                droppedSeedId: note.planRef.droppedSeedId ?? null,
                ruleId: note.planRef.ruleId ?? null,
                mergedItemIds: note.planRef.mergedItemIds,
              }
            : null,
        }),
      ),
      report: report
        ? {
            reportId: report._id,
            generatedAt: report.generatedAt,
            sections: extractReportSections(report.content),
          }
        : null,
      briefEntries: bounded("briefEntries", briefEntries, LIMITS.briefEntries).map((entry) => ({
        entryId: entry._id,
        group: entry.group,
        text: entry.text,
        reason: entry.reason ?? null,
      })),
      usage: bounded("usage", usage, LIMITS.usage).map((row) => ({
        callSite: row.callSite,
        model: row.model,
        costUsd: row.costUsd,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        generationId: row.generationId ?? null,
      })),
      truncated,
    };
  },
});
