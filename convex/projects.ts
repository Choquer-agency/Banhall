import { query, mutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  getFilingReadiness,
  requireFilingReady,
  requireInternalProjectAccess,
  requireProjectCreatorOrAdmin,
  requireCurrentUser,
} from "./lib/auth";
import {
  getTeamRosterMemberOrNull,
  resolveLiveUserLabel,
  userDisplayLabel,
} from "./lib/teamRoster";
import { domainError, projectTypeValidator, sha256 } from "./lib/contracts";
import { effectiveProjectType } from "../shared/projectTypes";
import { requireCapability } from "./lib/roleCapabilities";
import { workflowStageRank } from "../shared/workflowStages";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { deriveStoredProcessing } from "../shared/documentStatus";
import { canUseIndustry, industrySlug } from "../shared/industries";
import { findActiveGeneration } from "./lib/activeGeneration";
import {
  projectDashboardProjectionPatch,
  stageCountBucket,
  syncProjectDashboardFields,
  upsertDashboardCompany,
} from "./lib/dashboardProjection";

async function validatedIndustry(
  ctx: MutationCtx,
  value: string | undefined
): Promise<string | undefined> {
  const industry = value ? industrySlug(value) : "";
  if (!industry) return undefined;
  const existingProject = await ctx.db
    .query("projects")
    .withIndex("by_industry", (q) => q.eq("industry", industry))
    .first();
  const user = await requireCurrentUser(ctx);
  if (!canUseIndustry(user.role, industry, Boolean(existingProject))) {
    domainError("NOT_AUTHORIZED", "Only admins can add a new industry");
  }
  return industry;
}
async function validateProjectTagIds(
  ctx: MutationCtx,
  tagIds: Id<"tags">[]
): Promise<Id<"tags">[]> {
  const uniqueTagIds = [...new Set(tagIds)];
  for (const tagId of uniqueTagIds) {
    if (!(await ctx.db.get(tagId))) {
      domainError("NOT_FOUND", "One or more selected tags no longer exist");
    }
  }
  return uniqueTagIds;
}


export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const projects = await ctx.db.query("projects").order("desc").collect();
    return await Promise.all(
      projects.map(async (project) => {
        const activeGeneration = await findActiveGeneration(ctx, project, [
          "reserved",
          "running",
          "awaiting_selection",
          "awaiting_input",
        ]);
        const generationActivity: "generating" | "awaiting_selection" | "awaiting_input" | null =
          activeGeneration?.status === "reserved" || activeGeneration?.status === "running"
            ? "generating"
            : activeGeneration?.status === "awaiting_selection" ||
                activeGeneration?.status === "awaiting_input"
              ? activeGeneration.status
              : null;
        return {
          ...project,
          writer: await resolveLiveUserLabel(ctx, project.writer, project.createdBy),
          interviewer: await resolveLiveUserLabel(
            ctx,
            project.interviewer,
            project.interviewerUserId
          ),
          generationActivity,
        };
      })
    );
  },
});

/**
 * Distinct industry strings already used on projects. Feeds the creatable
 * industry picker so ad-hoc industries typed by one writer become options
 * for everyone.
 */
export const listIndustries = query({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const projects = await ctx.db.query("projects").collect();
    return [
      ...new Set(
        projects
          .map((p) => p.industry)
          .filter((i): i is string => Boolean(i && i.trim()))
      ),
    ].sort();
  },
});

/** BNH-23: edit the internal and/or formal SR&ED title on an existing project. */
export const updateProjectTitles = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    sredTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined && args.title.trim()) {
      patch.title = args.title.trim();
    }
    if (args.sredTitle !== undefined) {
      patch.sredTitle = args.sredTitle.trim() || undefined;
    }
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/** BNH-36: set/clear the client's fiscal year-end on an existing project. */
/**
 * BNH-10: industry scopes Brain retrieval to same-industry exemplars. Optional —
 * without it the Brain still retrieves best PDs across all industries. Values
 * must match the Brain's industry strings (see docs/the-brain.md).
 */
export const updateProjectIndustry = mutation({
  args: {
    projectId: v.id("projects"),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const industry = await validatedIndustry(ctx, args.industry);
    const patch = { industry, updatedAt: Date.now() };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/** BNH-54: set/clear the CRA T4088 line 206 science/technology code. */
export const updateProjectScienceCode = mutation({
  args: {
    projectId: v.id("projects"),
    scienceCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const scienceCode = normalizeCraScienceCode(args.scienceCode);
    if (args.scienceCode?.trim() && !scienceCode) {
      domainError("INVALID_INPUT", "Select a valid CRA science code");
    }
    const patch = { scienceCode, updatedAt: Date.now() };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/**
 * 2026-08-11 amendment — per-company project numbering. Accepts "1".."20"
 * (final, sequential per company) or a single letter "A".."Z" (uncertain/
 * draft identity, convertible to a number later — a label-only change).
 * Empty/omitted clears the field. Stored trimmed and uppercased. Not part
 * of the dashboard projection (mirrors updateProjectTags: patch + updatedAt
 * only; no dashboardSearchText/projection field derives from it).
 * Shared by setProjectNumber and createProject (flag 2026-08-14: the number
 * should be settable in the creation form, not only after generation).
 */
function normalizeProjectNumberInput(
  input: string | undefined
): string | undefined {
  const raw = input?.trim().toUpperCase() ?? "";
  if (!raw) return undefined;
  // 1–20, a letter A–Z, or a combined form like 2A/14B (owner
  // clarification 2026-08-11: numbering and lettering compose).
  if (!/^(?:[1-9][0-9]?[A-Z]?|[A-Z])$/.test(raw)) {
    domainError(
      "INVALID_INPUT",
      "Project number must be 1–20, a letter A–Z, or combined like 2A"
    );
  }
  const numericPart = raw.match(/^[0-9]+/)?.[0];
  if (numericPart && Number(numericPart) > 20) {
    domainError(
      "INVALID_INPUT",
      "Numbered projects are capped at 20 per company"
    );
  }
  return raw;
}

export const setProjectNumber = mutation({
  args: {
    projectId: v.id("projects"),
    projectNumber: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const projectNumber = normalizeProjectNumberInput(args.projectNumber);
    await ctx.db.patch(args.projectId, {
      projectNumber,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Additive work-product identity. This does not change workflow or access. */
export const setProjectType = mutation({
  args: {
    projectId: v.id("projects"),
    projectType: projectTypeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    await ctx.db.patch(args.projectId, {
      projectType: args.projectType,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** BNH-35: replace the project's applied tags. */
export const updateProjectTags = mutation({
  args: {
    projectId: v.id("projects"),
    tagIds: v.array(v.id("tags")),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const tagIds = await validateProjectTagIds(ctx, args.tagIds);
    await ctx.db.patch(args.projectId, {
      tagIds,
      updatedAt: Date.now(),
    });
  },
});

export const updateProjectFiscalYear = mutation({
  args: {
    projectId: v.id("projects"),
    fiscalYearEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const patch = {
      fiscalYearEnd: args.fiscalYearEnd,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

/**
 * Bulk edit from the dashboard selection: set the company name and/or
 * set/clear the fiscal year-end across many projects at once.
 */
export const bulkUpdateProjects = mutation({
  args: {
    projectIds: v.array(v.id("projects")),
    clientName: v.optional(v.string()),
    // Omitted = leave untouched; null = clear the fiscal year-end.
    fiscalYearEnd: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const clientName = args.clientName?.trim();
    if (args.clientName !== undefined && !clientName) {
      domainError("INVALID_INPUT", "Company name cannot be empty");
    }
    if (clientName === undefined && args.fiscalYearEnd === undefined) {
      domainError("INVALID_INPUT", "Nothing to update");
    }
    const projectIds = [...new Set(args.projectIds)];
    if (projectIds.length === 0) {
      domainError("INVALID_INPUT", "No projects selected");
    }
    if (projectIds.length > 200) {
      domainError("INVALID_INPUT", "Too many projects selected — 200 max per edit");
    }
    const now = Date.now();
    let updated = 0;
    let skipped = 0;
    for (const projectId of projectIds) {
      const project = await ctx.db.get(projectId);
      if (!project) {
        skipped++;
        continue;
      }
      const patch: Record<string, unknown> = { updatedAt: now };
      if (clientName !== undefined) patch.clientName = clientName;
      if (args.fiscalYearEnd !== undefined) {
        patch.fiscalYearEnd = args.fiscalYearEnd ?? undefined;
      }
      await ctx.db.patch(projectId, patch);
      await syncProjectDashboardFields(ctx, projectId, patch);
      updated++;
    }
    return { updated, skipped };
  },
});

export const getProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;
    return {
      ...access.project,
      writer: await resolveLiveUserLabel(
        ctx,
        access.project.writer,
        access.project.createdBy
      ),
      interviewer: await resolveLiveUserLabel(
        ctx,
        access.project.interviewer,
        access.project.interviewerUserId
      ),
    };
  },
});

export const getProjectByShareToken = query({
  args: { shareToken: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
      .unique();
    if (!project?.sharedReportId) return null;
    const report = await ctx.db.get(project.sharedReportId);
    if (!report || report.projectId !== project._id) return null;
    return {
      _id: project._id,
      title: project.title,
      clientName: project.clientName,
      sharedReportId: report._id,
      reportVersion: report.version,
      revisionNumber: report.revisionNumber ?? 0,
    };
  },
});

export const getScienceCodeSuggestionContext = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;

    const [transcript, report] = await Promise.all([
      ctx.db
        .query("transcripts")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
        .first(),
      ctx.db
        .query("reports")
        .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .first(),
    ]);

    return {
      title: access.project.title,
      sredTitle: access.project.sredTitle,
      industry: access.project.industry,
      transcript: transcript?.content,
      report: report?.content,
    };
  },
});

export const createProject = mutation({
  args: {
    title: v.string(),
    sredTitle: v.optional(v.string()),
    clientName: v.string(),
    interviewerUserId: v.optional(v.id("users")),
    // BNH-22: client-side interview participants.
    interviewees: v.optional(v.array(v.string())),
    // BNH-35: initial tags applied at creation.
    tagIds: v.optional(v.array(v.id("tags"))),
    fiscalYearEnd: v.optional(v.number()),
    // BNH-10: routes Brain retrieval — must match the Brain namespace strings
    // (software / manufacturing / life-sciences, see docs/the-brain.md).
    industry: v.optional(v.string()),
    // BNH-54: CRA T4088 line 206 field of science or technology code.
    scienceCode: v.optional(v.string()),
    // Flag 2026-08-14 (Michael): settable at creation for both Generate PD
    // and Review PD, not only after generation. Same rules as
    // setProjectNumber.
    projectNumber: v.optional(v.string()),
    // BNH-39: review mode reviews an existing written PD instead of generating.
    mode: v.optional(v.union(v.literal("generate"), v.literal("review"))),
    projectType: v.optional(projectTypeValidator),
    transcriptContent: v.string(),
    ownerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const writer = await requireCurrentUser(ctx);
    await requireCapability(ctx, "project.create");
    if (writer.isAnonymous === true || !writer.role) {
      domainError("NOT_AUTHORIZED", "An active internal role is required to create a project");
    }
    // Compatibility: older clients may still submit ownerId. New projects are
    // always owned by their authenticated creator; never silently accept a
    // stale client assigning initial ownership to someone else.
    if (args.ownerId && args.ownerId !== writer._id) {
      domainError(
        "NOT_AUTHORIZED",
        "New projects are initially owned by the person creating them"
      );
    }
    const interviewer = args.interviewerUserId
      ? await getTeamRosterMemberOrNull(ctx, args.interviewerUserId)
      : null;
    if (args.interviewerUserId && !interviewer) {
      domainError("INVALID_INPUT", "Interviewer must be a current team member");
    }
    const tagIds = args.tagIds
      ? await validateProjectTagIds(ctx, args.tagIds)
      : [];
    const scienceCode = normalizeCraScienceCode(args.scienceCode);
    if (args.scienceCode?.trim() && !scienceCode) {
      domainError("INVALID_INPUT", "Select a valid CRA science code");
    }
    const projectNumber = normalizeProjectNumberInput(args.projectNumber);
    const industry = await validatedIndustry(ctx, args.industry);


    const now = Date.now();
    const shareToken = generateShareToken();

    const dashboardProjection = projectDashboardProjectionPatch({
      title: args.title,
      clientName: args.clientName,
      writer: userDisplayLabel(writer),
      interviewer: interviewer ? userDisplayLabel(interviewer) : undefined,
      scienceCode,
      industry,
      fiscalYearEnd: args.fiscalYearEnd,
      workflowStage: "intake",
    });
    const projectId = await ctx.db.insert("projects", {
      title: args.title,
      clientName: args.clientName,
      ...dashboardProjection,
      dashboardCompanyCounted: true,
      ...(args.sredTitle ? { sredTitle: args.sredTitle } : {}),
      writer: userDisplayLabel(writer),
      ...(interviewer
        ? {
            interviewerUserId: interviewer._id,
            interviewer: userDisplayLabel(interviewer),
          }
        : {}),
      ...(args.interviewees?.length ? { interviewees: args.interviewees } : {}),
      ...(tagIds.length ? { tagIds } : {}),
      ...(args.fiscalYearEnd ? { fiscalYearEnd: args.fiscalYearEnd } : {}),
      ...(industry ? { industry } : {}),
      ...(scienceCode ? { scienceCode } : {}),
      ...(projectNumber ? { projectNumber } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
      projectType: args.projectType ?? effectiveProjectType({ mode: args.mode }),
      ownerId: writer._id,
      workflowStage: "intake",
      workflowStageRank: workflowStageRank("intake"),
      workflowUpdatedAt: now,
      workflowVersion: 0,
      status: "draft",
      createdBy: writer._id,
      shareToken,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("projectEvents", {
      projectId,
      type: "ownership_transferred",
      actorId: writer._id,
      to: writer._id,
      note: "creation:initial-owner",
      at: now,
    });
    await ctx.db.insert("projectEvents", {
      projectId,
      type: "stage_changed",
      actorId: writer._id,
      to: "intake",
      note: "creation:initial-stage",
      at: now,
    });

    // New projects are always born at intake; the company row's stage bucket
    // moves in the same transaction (2026-08-06 second amendment).
    await upsertDashboardCompany(
      ctx,
      dashboardProjection.dashboardCompanyKey,
      args.clientName,
      1,
      "intake"
    );

    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: args.transcriptContent,
      createdAt: now,
    });

    return { projectId, transcriptId };
  },
});



type ProjectDocumentCopy = {
  sourceId: Id<"projectDocuments">;
  documentId: Id<"projectDocuments">;
  storageId?: Id<"_storage">;
};

async function requireDuplicatePair(
  ctx: MutationCtx,
  fromProjectId: Id<"projects">,
  toProjectId: Id<"projects">
) {
  const user = await requireCurrentUser(ctx);
  const source = await ctx.db.get(fromProjectId);
  const target = await ctx.db.get(toProjectId);
  if (!source || !target) domainError("NOT_FOUND", "Project not found");
  await requireInternalProjectAccess(ctx, source._id);
  await requireInternalProjectAccess(ctx, target._id);
  return { user, source, target };
}

async function copyProjectInputRows(
  ctx: MutationCtx,
  args: {
    fromProjectId: Id<"projects">;
    toProjectId: Id<"projects">;
    targetTranscriptId?: Id<"transcripts">;
  }
) {
  const { user } = await requireDuplicatePair(
    ctx,
    args.fromProjectId,
    args.toProjectId
  );
  const now = Date.now();
  const documents = await ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
    .take(250);
  const copies: ProjectDocumentCopy[] = [];
  const docIdMap = new Map<Id<"projectDocuments">, Id<"projectDocuments">>();

  // Copy every support document, including archived records and review-mode PDs.
  // Storage ids are filled by the action after it clones the original bytes.
  for (const doc of documents) {
    // A duplicate must report the same truth as its source. Rows that predate
    // PSOS-04 carry no status, so derive it from the copied content — the same
    // function the read-time fallback and the backfill use.
    const processing = doc.processingStatus
      ? { status: doc.processingStatus, detail: doc.processingDetail }
      : deriveStoredProcessing(doc);
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId: args.toProjectId,
      fileName: doc.fileName,
      fileType: doc.fileType,
      content: doc.content,
      ...(doc.mimeType ? { mimeType: doc.mimeType } : {}),
      ...(doc.category ? { category: doc.category } : {}),
      ...(doc.archived !== undefined ? { archived: doc.archived } : {}),
      processingStatus: processing.status,
      ...(processing.detail ? { processingDetail: processing.detail } : {}),
      source: doc.source,
      uploadedBy: userDisplayLabel(user),
      createdAt: now,
    });
    docIdMap.set(doc._id, documentId);
    copies.push({
      sourceId: doc._id,
      documentId,
      ...(doc.storageId ? { storageId: doc.storageId } : {}),
    });
  }

  const evidence = await ctx.db
    .query("projectIdentityEvidence")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
    .take(250);
  let evidenceCopied = 0;
  for (const row of evidence) {
    const remappedDocId = row.projectDocumentId
      ? docIdMap.get(row.projectDocumentId)
      : undefined;
    if (row.projectDocumentId && !remappedDocId) continue;
    await ctx.db.insert("projectIdentityEvidence", {
      projectId: args.toProjectId,
      subjectName: row.subjectName,
      relationship: row.relationship,
      evidenceKind: row.evidenceKind,
      ...(remappedDocId ? { projectDocumentId: remappedDocId } : {}),
      sourceDescription: `${row.sourceDescription} (copied from source project)`,
      status: row.status,
      ...(row.verifiedBy ? { verifiedBy: row.verifiedBy } : {}),
      ...(row.verifiedAt ? { verifiedAt: row.verifiedAt } : {}),
      ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
      createdAt: now,
      updatedAt: now,
    });
    evidenceCopied += 1;
  }

  const sourceReport = await ctx.db
    .query("reports")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
    .order("desc")
    .first();
  let reportId: Id<"reports"> | undefined;
  if (sourceReport) {
    const contentHash = sourceReport.contentHash ?? (await sha256(sourceReport.content));
    reportId = await ctx.db.insert("reports", {
      projectId: args.toProjectId,
      content: sourceReport.content,
      version: sourceReport.version,
      generatedAt: now,
      updatedAt: now,
      ...(args.targetTranscriptId
        ? { sourceTranscriptId: args.targetTranscriptId }
        : {}),
      revisionNumber: sourceReport.revisionNumber ?? 0,
      contentHash,
    });
    await ctx.db.patch(args.toProjectId, {
      status: "review",
      updatedAt: now,
    });
  }

  const reviews = await ctx.db
    .query("pdReviews")
    .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
    .take(100);
  let pdReviewsCopied = 0;
  for (const review of reviews) {
    const documentId = docIdMap.get(review.documentId);
    if (!documentId) continue;
    await ctx.db.insert("pdReviews", {
      projectId: args.toProjectId,
      documentId,
      sourceFileName: review.sourceFileName,
      status: review.status,
      ...(review.result ? { result: review.result } : {}),
      ...(review.model ? { model: review.model } : {}),
      ...(review.error ? { error: review.error } : {}),
      createdBy: review.createdBy,
      createdAt: now,
      ...(review.completedAt ? { completedAt: review.completedAt } : {}),
    });
    pdReviewsCopied += 1;
  }

  return {
    documents: copies,
    evidenceCopied,
    pdReviewsCopied,
    ...(reportId ? { reportId } : {}),
  };
}

// Called by projectDuplication:copyProjectContent. This mutation creates the
// destination rows atomically; the action then clones any original file bytes.
export const prepareProjectContentCopy = mutation({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
    targetTranscriptId: v.optional(v.id("transcripts")),
  },
  handler: async (ctx, args) => {
    return await copyProjectInputRows(ctx, args);
  },
});

export const finishProjectContentCopy = mutation({
  args: {
    toProjectId: v.id("projects"),
    storageCopies: v.array(
      v.object({
        documentId: v.id("projectDocuments"),
        storageId: v.id("_storage"),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.toProjectId);
    for (const copy of args.storageCopies) {
      const document = await ctx.db.get(copy.documentId);
      if (!document || document.projectId !== args.toProjectId) {
        domainError("INVALID_INPUT", "Copied document does not belong to this project");
      }
      await ctx.db.patch(copy.documentId, { storageId: copy.storageId });
    }
    return null;
  },
});

/** Legacy text-only entry point retained for older clients during rollout. */
export const copyProjectDocuments = mutation({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const result = await copyProjectInputRows(ctx, args);
    return {
      copied: result.documents.length,
      evidenceCopied: result.evidenceCopied,
      pdReviewsCopied: result.pdReviewsCopied,
    };
  },
});

export const publishForReview = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
  },
  handler: async (ctx, args) => {
    await requireProjectCreatorOrAdmin(ctx, args.projectId);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Report does not belong to this project");
    }
    await ctx.db.patch(args.projectId, {
      sharedReportId: report._id,
      status: "client_review",
      updatedAt: Date.now(),
    });
  },
});

export const unpublishReview = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { project } = await requireProjectCreatorOrAdmin(ctx, args.projectId);
    await ctx.db.patch(args.projectId, {
      sharedReportId: undefined,
      status: project.status === "client_review" ? "review" : project.status,
      updatedAt: Date.now(),
    });
  },
});

export const finalizeProject = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
  },
  handler: async (ctx, args) => {
    const { project } = await requireInternalProjectAccess(ctx, args.projectId);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Report does not belong to this project");
    }
    await requireFilingReady(ctx, project, report);
    await ctx.db.patch(args.projectId, {
      status: "final",
      updatedAt: Date.now(),
    });
  },
});

export const getProjectReadiness = query({
  args: {
    projectId: v.id("projects"),
    reportId: v.optional(v.id("reports")),
  },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;
    const report = args.reportId ? await ctx.db.get(args.reportId) : null;
    if (report && report.projectId !== args.projectId) return null;
    return await getFilingReadiness(ctx, access.project, report);
  },
});

export const updateProjectTitle = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);

    const patch = { title: args.title.trim(), updatedAt: Date.now() };
    await ctx.db.patch(args.projectId, patch);
    await syncProjectDashboardFields(ctx, args.projectId, patch);
  },
});

export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { project } = await requireProjectCreatorOrAdmin(ctx, args.projectId);
    if (project.dashboardCompanyCounted === true) {
      // Decrement the exact stage bucket the row occupied (2026-08-06
      // second amendment): workflowStage ?? "legacy".
      await upsertDashboardCompany(
        ctx,
        project.dashboardCompanyKey ?? projectDashboardProjectionPatch(project).dashboardCompanyKey,
        project.clientName,
        -1,
        stageCountBucket(project.workflowStage)
      );
    }

    const openWorkItem = await ctx.db
      .query("workItems")
      .withIndex("by_projectId_and_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "open")
      )
      .first();
    if (openWorkItem) {
      domainError(
        "INVALID_STATE",
        "Complete, decline, or cancel open work before deleting this project"
      );
    }

    // Delete related records
    const transcripts = await ctx.db
      .query("transcripts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const t of transcripts) await ctx.db.delete(t._id);

    const reports = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const r of reports) await ctx.db.delete(r._id);

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);

    const generations = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const g of generations) await ctx.db.delete(g._id);

    const commenters = await ctx.db
      .query("commenters")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const c of commenters) await ctx.db.delete(c._id);

    const pdReviews = await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const r of pdReviews) await ctx.db.delete(r._id);

    const pdReviewEvents = await ctx.db
      .query("pdReviewEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const e of pdReviewEvents) await ctx.db.delete(e._id);

    await ctx.db.delete(args.projectId);
  },
});

// Exported for reviewFromProject.createReviewProjectRecord, which mirrors
// this mutation's insert conventions for review projects created from an
// existing project (2026-08-11 second amendment).
export function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // Base64url encoding: URL-safe, 32 characters, 192 bits of entropy
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
