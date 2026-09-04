import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireInternalProjectAccess } from "./lib/auth";
import { domainError, sha256 } from "./lib/contracts";
import { requireCapability } from "./lib/roleCapabilities";
import { requireAnthropicConfigured } from "./lib/providerConfig";
import { extractPlainText } from "./lib/reportEdits";
import { userDisplayLabel } from "./lib/teamRoster";
import { deriveProcessingStatus } from "../shared/documentStatus";
import { workflowStageRank } from "../shared/workflowStages";
import {
  projectDashboardProjectionPatch,
  upsertDashboardCompany,
} from "./lib/dashboardProjection";
import { generateShareToken } from "./projects";
import { copyProjectContentBetween } from "./projectDuplication";
import {
  copyTranscriptRow,
  listProjectTranscripts,
} from "./lib/transcripts";

/**
 * 2026-08-11 (second) amendment — review projects created from an existing
 * project. From a written PD project, one action starts PD-review mode that
 * inherits the title, writer, and all supporting documents (nothing is
 * re-collected), snapshots the latest report as the written PD under review,
 * and records the association on the review project via
 * `projects.sourceProjectId` (navigational only — no workflow coupling).
 */

/**
 * Creates the review project atomically: project row (mirroring
 * projects.createProject's insert conventions), creation events, dashboard
 * company count, every transcript of the source, the report snapshot as a
 * `review_pd`
 * document, and the started pdReview (same guarded path as startPdReview).
 * The calling action copies the remaining content + file bytes afterwards.
 */
export const createReviewProjectRecord = internalMutation({
  args: { sourceProjectId: v.id("projects") },
  returns: v.object({
    projectId: v.id("projects"),
    transcriptIds: v.array(v.id("transcripts")),
    documentId: v.id("projectDocuments"),
    reviewId: v.id("pdReviews"),
  }),
  handler: async (ctx, args) => {
    const { project: source, user } = await requireInternalProjectAccess(
      ctx,
      args.sourceProjectId
    );
    // Same authority as project creation: creator becomes the initial Owner
    // (2026-07-30 amendment); a review project is never born owned by the
    // source project's Owner.
    await requireCapability(ctx, "project.create");
    if (user.isAnonymous === true || !user.role) {
      domainError(
        "NOT_AUTHORIZED",
        "An active internal role is required to create a project"
      );
    }
    // Fail before creating anything the review could never run against.
    requireAnthropicConfigured("review");

    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", source._id))
      .order("desc")
      .first();
    if (!report) {
      domainError(
        "INVALID_INPUT",
        "This project has no written report to review yet"
      );
    }
    const pdText = extractPlainText(report.content);
    if (!pdText.trim()) {
      domainError(
        "INVALID_INPUT",
        "The report has no readable text to review"
      );
    }

    // Inherited tags: drop any tag deleted since the source was tagged.
    const tagIds: Id<"tags">[] = [];
    for (const tagId of source.tagIds ?? []) {
      if (await ctx.db.get(tagId)) tagIds.push(tagId);
    }

    const sourceTranscripts = await listProjectTranscripts(ctx, source._id);

    const now = Date.now();
    const dashboardProjection = projectDashboardProjectionPatch({
      title: source.title,
      clientName: source.clientName,
      writer: source.writer,
      interviewer: source.interviewer,
      scienceCode: source.scienceCode,
      industry: source.industry,
      fiscalYearEnd: source.fiscalYearEnd,
      workflowStage: "intake",
    });
    const projectId = await ctx.db.insert("projects", {
      title: source.title,
      clientName: source.clientName,
      ...dashboardProjection,
      dashboardCompanyCounted: true,
      ...(source.sredTitle ? { sredTitle: source.sredTitle } : {}),
      // The client's contract: the review inherits the source's writer.
      ...(source.writer ? { writer: source.writer } : {}),
      ...(source.interviewer ? { interviewer: source.interviewer } : {}),
      ...(source.interviewerUserId
        ? { interviewerUserId: source.interviewerUserId }
        : {}),
      ...(source.interviewees?.length
        ? { interviewees: source.interviewees }
        : {}),
      ...(tagIds.length ? { tagIds } : {}),
      ...(source.fiscalYearEnd ? { fiscalYearEnd: source.fiscalYearEnd } : {}),
      ...(source.industry ? { industry: source.industry } : {}),
      ...(source.scienceCode ? { scienceCode: source.scienceCode } : {}),
      mode: "review",
      projectType: "review",
      sourceProjectId: source._id,
      ownerId: user._id,
      workflowStage: "intake",
      workflowStageRank: workflowStageRank("intake"),
      workflowUpdatedAt: now,
      workflowVersion: 0,
      status: "draft",
      createdBy: user._id,
      shareToken: generateShareToken(),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("projectEvents", {
      projectId,
      type: "ownership_transferred",
      actorId: user._id,
      to: user._id,
      note: "creation:initial-owner",
      at: now,
    });
    await ctx.db.insert("projectEvents", {
      projectId,
      type: "stage_changed",
      actorId: user._id,
      to: "intake",
      note: "creation:initial-stage",
      at: now,
    });
    // Born at intake; the company row's stage bucket moves in the same
    // transaction (2026-08-06 second amendment).
    await upsertDashboardCompany(
      ctx,
      dashboardProjection.dashboardCompanyKey,
      source.clientName,
      1,
      "intake"
    );

    const transcriptIds: Id<"transcripts">[] = [];
    for (const [position, transcript] of sourceTranscripts.entries()) {
      transcriptIds.push(
        await copyTranscriptRow(ctx, transcript, { projectId, position })
      );
    }

    // The source report snapshot becomes the written PD under review. The
    // processing status derives from the same observable facts uploadDocument
    // uses; uploadedBy carries the display label like the duplicate-copy path.
    const fileName = `${source.title} (report v${report.version ?? 1}).txt`;
    const derived = deriveProcessingStatus({
      fileName,
      content: pdText,
      extractionFailed: false,
      intake: "file",
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName,
      fileType: "txt",
      content: pdText,
      source: "review_pd",
      processingStatus: derived.status,
      processingDetail: derived.detail,
      uploadedBy: userDisplayLabel(user),
      // CAP-3: the acting internal user authored this review PD.
      ...(user.role ? { uploaderRole: user.role } : {}),
      createdAt: now,
    });

    // Start the review through the same guarded path startPdReview uses. The
    // double-run guard is vacuous on a project created in this transaction
    // but kept so the semantics stay byte-identical with the sanctioned path.
    const running = await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .order("desc")
      .first();
    if (running && running.status === "running") {
      domainError("INVALID_INPUT", "A review is already running for this project");
    }
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId,
      documentId,
      sourceFileName: fileName,
      status: "running",
      revisionNumber: 0,
      contentHash: await sha256(pdText),
      createdBy: user._id,
      createdAt: now,
    });
    await ctx.db.insert("pdReviewEvents", {
      projectId,
      reviewId,
      actor: user._id,
      action: "review_started",
      detail: fileName,
      at: now,
    });
    await ctx.scheduler.runAfter(0, internal.ai.reviewAgent.runPdReview, {
      reviewId,
      projectId,
    });

    return { projectId, transcriptIds, documentId, reviewId };
  },
});

/**
 * Start an AI review from an existing written-PD project (client meeting
 * 2026-08-11, owner top priority). Creates the associated review project,
 * copies every transcript/support document/original file byte through the
 * duplicate-flow internals, and returns the new project to navigate to. The
 * AI review itself is already scheduled and streams in reactively.
 */
export const createReviewFromProject = action({
  args: { projectId: v.id("projects") },
  returns: v.object({ projectId: v.id("projects") }),
  handler: async (ctx, args): Promise<{ projectId: Id<"projects"> }> => {
    const created: {
      projectId: Id<"projects">;
      transcriptIds: Id<"transcripts">[];
      documentId: Id<"projectDocuments">;
      reviewId: Id<"pdReviews">;
    } = await ctx.runMutation(
      internal.reviewFromProject.createReviewProjectRecord,
      { sourceProjectId: args.projectId }
    );
    await copyProjectContentBetween(ctx, {
      fromProjectId: args.projectId,
      toProjectId: created.projectId,
      ...(created.transcriptIds[0]
        ? { targetTranscriptId: created.transcriptIds[0] }
        : {}),
    });
    return { projectId: created.projectId };
  },
});
