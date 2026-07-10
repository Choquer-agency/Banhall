import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  getFilingReadiness,
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
import { domainError } from "./lib/contracts";

const relationshipValidator = v.union(
  v.literal("claimant"),
  v.literal("employee"),
  v.literal("contractor"),
  v.literal("other")
);
const evidenceKindValidator = v.union(
  v.literal("corporate_registry"),
  v.literal("contract"),
  v.literal("invoice"),
  v.literal("payroll"),
  v.literal("project_document"),
  v.literal("other")
);

export const listEvidence = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];
    const rows = await ctx.db
      .query("projectIdentityEvidence")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(250);
    return rows.map((row) => ({
      id: row._id,
      subjectName: row.subjectName,
      relationship: row.relationship,
      evidenceKind: row.evidenceKind,
      projectDocumentId: row.projectDocumentId,
      sourceDescription: row.sourceDescription,
      status: row.status,
      verifiedAt: row.verifiedAt,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const attachEvidence = mutation({
  args: {
    projectId: v.id("projects"),
    subjectName: v.string(),
    relationship: relationshipValidator,
    evidenceKind: evidenceKindValidator,
    projectDocumentId: v.optional(v.id("projectDocuments")),
    sourceDescription: v.string(),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    const subjectName = args.subjectName.trim();
    const sourceDescription = args.sourceDescription.trim();
    if (!subjectName || subjectName.length > 200) {
      domainError("INVALID_INPUT", "Enter a subject name under 200 characters");
    }
    if (!sourceDescription || sourceDescription.length > 2_000) {
      domainError("INVALID_INPUT", "Enter a source description under 2,000 characters");
    }
    if (args.evidenceKind === "project_document" && !args.projectDocumentId) {
      domainError("INVALID_INPUT", "Project-document evidence must name a document");
    }
    if (args.projectDocumentId) {
      const document = await ctx.db.get(args.projectDocumentId);
      if (!document || document.projectId !== args.projectId) {
        domainError("NOT_AUTHORIZED", "Evidence document does not belong to this project");
      }
    }
    const now = Date.now();
    return await ctx.db.insert("projectIdentityEvidence", {
      projectId: args.projectId,
      subjectName,
      relationship: args.relationship,
      evidenceKind: args.evidenceKind,
      projectDocumentId: args.projectDocumentId,
      sourceDescription,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const verifyEvidence = mutation({
  args: { evidenceId: v.id("projectIdentityEvidence") },
  handler: async (ctx, args) => {
    const reviewer = await requireRole(ctx, ["manager", "admin"]);
    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence) domainError("NOT_FOUND", "Evidence record not found");
    if (evidence.projectDocumentId) {
      const document = await ctx.db.get(evidence.projectDocumentId);
      if (!document || document.projectId !== evidence.projectId) {
        domainError("EVIDENCE_REQUIRED", "The supporting project document is unavailable");
      }
    }
    const now = Date.now();
    await ctx.db.patch(args.evidenceId, {
      status: "verified",
      verifiedBy: reviewer._id,
      verifiedAt: now,
      rejectionReason: undefined,
      updatedAt: now,
    });
  },
});

export const rejectEvidence = mutation({
  args: {
    evidenceId: v.id("projectIdentityEvidence"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["manager", "admin"]);
    const evidence = await ctx.db.get(args.evidenceId);
    if (!evidence) domainError("NOT_FOUND", "Evidence record not found");
    const reason = args.reason.trim();
    if (!reason || reason.length > 2_000) {
      domainError("INVALID_INPUT", "Enter a rejection reason under 2,000 characters");
    }
    await ctx.db.patch(args.evidenceId, {
      status: "rejected",
      rejectionReason: reason,
      verifiedBy: undefined,
      verifiedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const getReadiness = query({
  args: {
    projectId: v.id("projects"),
    reportId: v.optional(v.id("reports")),
  },
  handler: async (ctx, args) => {
    const { project } = await requireInternalProjectAccess(ctx, args.projectId);
    const report = args.reportId ? await ctx.db.get(args.reportId) : null;
    if (report && report.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Report does not belong to this project");
    }
    return await getFilingReadiness(ctx, project, report);
  },
});

export const setFilingAttestation = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    status: v.union(v.literal("approved"), v.literal("blocked")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reviewer = await requireRole(ctx, ["manager", "admin"]);
    const project = await ctx.db.get(args.projectId);
    const report = await ctx.db.get(args.reportId);
    if (!project) domainError("NOT_FOUND", "Project not found");
    if (!report || report.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Report does not belong to this project");
    }
    const note = args.note?.trim();
    if (note && note.length > 4_000) {
      domainError("INVALID_INPUT", "Attestation note exceeds 4,000 characters");
    }
    const now = Date.now();
    await ctx.db.patch(args.projectId, {
      filingAttestation: {
        status: args.status,
        reviewedBy: reviewer._id,
        reviewedAt: now,
        evidenceCutoffAt: now,
        reportId: report._id,
        revisionNumber: report.revisionNumber ?? 0,
        ...(note ? { note } : {}),
      },
      updatedAt: now,
    });
  },
});
