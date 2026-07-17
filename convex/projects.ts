import { query, mutation, internalQuery, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  getFilingReadiness,
  requireFilingReady,
  requireInternalProjectAccess,
  requireProjectCreator,
  requireProjectCreatorOrAdmin,
  requireCurrentUser,
} from "./lib/auth";
import {
  getTeamRosterMemberOrNull,
  userDisplayLabel,
} from "./lib/teamRoster";
import { domainError } from "./lib/contracts";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import { canUseIndustry, industrySlug } from "../shared/industries";
import { findActiveGeneration } from "./lib/activeGeneration";

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
    // Surface "awaiting draft selection" so the dashboard can badge it —
    // the project itself still reads "generating" until a draft is chosen.
    return await Promise.all(
      projects.map(async (project) => ({
        ...project,
        awaitingSelection:
          (await findActiveGeneration(ctx, project, ["awaiting_selection"])) !== null,
        // Iterative mode: a section draft is waiting on the writer's review.
        awaitingInput:
          (await findActiveGeneration(ctx, project, ["awaiting_input"])) !== null,
      }))
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
    await ctx.db.patch(args.projectId, {
      industry,
      updatedAt: Date.now(),
    });
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
    await ctx.db.patch(args.projectId, {
      scienceCode,
      updatedAt: Date.now(),
    });
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
    await ctx.db.patch(args.projectId, {
      fiscalYearEnd: args.fiscalYearEnd,
      updatedAt: Date.now(),
    });
  },
});

export const getProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    return access?.project ?? null;
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
    // BNH-39: review mode reviews an existing written PD instead of generating.
    mode: v.optional(v.union(v.literal("generate"), v.literal("review"))),
    transcriptContent: v.string(),
  },
  handler: async (ctx, args) => {
    const writer = await requireCurrentUser(ctx);
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
    const industry = await validatedIndustry(ctx, args.industry);


    const now = Date.now();
    const shareToken = generateShareToken();

    const projectId = await ctx.db.insert("projects", {
      title: args.title,
      clientName: args.clientName,
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
      ...(args.mode ? { mode: args.mode } : {}),
      status: "draft",
      createdBy: writer._id,
      shareToken,
      createdAt: now,
      updatedAt: now,
    });

    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: args.transcriptContent,
      createdAt: now,
    });

    return { projectId, transcriptId };
  },
});



// Duplicate support: the dashboard "Duplicate" action opens /project/new?from=<id>
// with the wizard prefilled; on commit the wizard calls this to bring the source
// project's non-archived documents along. Text content only — the original file
// bytes stay owned by the source project (sharing a storageId would break
// downloads if either copy is deleted, since document deletion also deletes its
// storage object).
export const copyProjectDocuments = mutation({
  args: {
    fromProjectId: v.id("projects"),
    toProjectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const source = await ctx.db.get(args.fromProjectId);
    const target = await ctx.db.get(args.toProjectId);
    if (!source || !target) domainError("NOT_FOUND", "Project not found");

    const now = Date.now();
    const documents = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
      .collect();
    let copied = 0;
    // Old doc id → new doc id, so copied identity evidence keeps its
    // supporting-document link.
    const docIdMap = new Map<Id<"projectDocuments">, Id<"projectDocuments">>();
    for (const doc of documents) {
      if (doc.archived) continue;
      const newDocId = await ctx.db.insert("projectDocuments", {
        projectId: args.toProjectId,
        fileName: doc.fileName,
        fileType: doc.fileType,
        content: doc.content,
        ...(doc.mimeType ? { mimeType: doc.mimeType } : {}),
        ...(doc.category ? { category: doc.category } : {}),
        source: doc.source,
        uploadedBy: userDisplayLabel(user),
        createdAt: now,
      });
      docIdMap.set(doc._id, newDocId);
      copied += 1;
    }

    // Identity evidence comes along too — it attests the claimant (same
    // client on a duplicate), and without it every duplicate started
    // export-blocked on EVIDENCE_REQUIRED (alerts, Jul 17). Verification
    // status and verifier are preserved; provenance notes the copy.
    const evidence = await ctx.db
      .query("projectIdentityEvidence")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.fromProjectId))
      .take(250);
    let evidenceCopied = 0;
    for (const row of evidence) {
      const remappedDocId = row.projectDocumentId
        ? docIdMap.get(row.projectDocumentId)
        : undefined;
      // A doc-backed evidence row whose document didn't copy (archived)
      // can't stand on its own — skip it rather than copy a broken link.
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
    return { copied, evidenceCopied };
  },
});

export const publishForReview = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
  },
  handler: async (ctx, args) => {
    await requireProjectCreator(ctx, args.projectId);
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
    const { project } = await requireProjectCreator(ctx, args.projectId);
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

    await ctx.db.patch(args.projectId, {
      title: args.title.trim(),
      updatedAt: Date.now(),
    });
  },
});

export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await requireProjectCreatorOrAdmin(ctx, args.projectId);

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

function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // Base64url encoding: URL-safe, 32 characters, 192 bits of entropy
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
