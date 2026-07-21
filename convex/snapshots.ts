import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./lib/auth";
import {
  pruneSnapshots,
  snapshotAuditFields,
} from "./lib/snapshots";
import { domainError } from "./lib/contracts";

const MILESTONE_LABELS: Record<string, string> = {
  R0: "R0 draft",
  R1: "R1 internal review",
  R2: "R2 client send",
  R3: "R3 client edits",
  R4: "R4 final",
};

function milestoneKeyFor(label: string): string {
  const match = /^R(\d+)(?:\s+|$)/i.exec(label.trim());
  const milestoneNumber = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(milestoneNumber)) {
    domainError(
      "INVALID_INPUT",
      "Milestone label must start with an R-number, such as R1."
    );
  }
  return `R${milestoneNumber}`;
}

function canonicalMilestoneLabel(label: string, milestoneKey: string): string {
  const suffix = label.trim().replace(/^R\d+/i, "").trim();
  return MILESTONE_LABELS[milestoneKey] ??
    (suffix ? `${milestoneKey} ${suffix}` : milestoneKey);
}


export const listSnapshots = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const currentReport = await ctx.db.get(args.reportId);
    if (
      !currentReport ||
      !(await getInternalProjectAccessOrNull(ctx, currentReport.projectId))
    ) {
      return [];
    }

    const snapshots = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_projectId", (q) =>
        q.eq("projectId", currentReport.projectId)
      )
      .order("desc")
      .take(1_000);
    const reportIds = new Set<Id<"reports">>();
    for (const snapshot of snapshots) reportIds.add(snapshot.reportId);
    const reports = await Promise.all(
      Array.from(reportIds, (reportId) => ctx.db.get(reportId))
    );
    const reportVersions = new Map<Id<"reports">, number>();
    for (const report of reports) {
      if (report?.projectId === currentReport.projectId) {
        reportVersions.set(report._id, report.version);
      }
    }
    const rows = await Promise.all(
      snapshots.map(async (snapshot) => {
        const reportVersion = reportVersions.get(snapshot.reportId);
        if (reportVersion === undefined) return null;
        const provenance = snapshot.provenanceId
          ? await ctx.db.get(snapshot.provenanceId)
          : null;
        return {
          _id: snapshot._id,
          reportId: snapshot.reportId,
          reportVersion,
          isCurrentReport: snapshot.reportId === currentReport._id,
          reason: snapshot.reason,
          label: snapshot.label,
          milestoneKey: snapshot.milestoneKey,
          createdByRole: snapshot.createdByRole,
          createdAt: snapshot.createdAt,
          sourceRevisionNumber: snapshot.sourceRevisionNumber,
          provenanceStatus: provenance?.status ?? "unavailable_legacy",
          researchSessionId: snapshot.researchSessionId ?? null,
          researchSourceCount: snapshot.researchSourceCount ?? 0,
        };
      })
    );
    return rows.filter((row) => row !== null);
  },
});

/** The one-shot ghost draft snapshot for an iterative generation, if any. */
export const getGhostSnapshot = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) {
      return null;
    }
    const snapshots = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_projectId", (q) => q.eq("projectId", generation.projectId))
      .order("desc")
      .take(200);
    return (
      snapshots.find(
        (s) =>
          s.generationId === args.generationId &&
          s.label?.startsWith("One-shot ghost draft")
      ) ?? null
    );
  },
});

export const getSnapshot = query({
  args: {
    snapshotId: v.id("reportSnapshots"),
    targetReportId: v.id("reports"),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    const targetReport = await ctx.db.get(args.targetReportId);
    if (
      !snapshot ||
      !targetReport ||
      targetReport.projectId !== snapshot.projectId ||
      !(await getInternalProjectAccessOrNull(ctx, snapshot.projectId))
    ) {
      return null;
    }
    const sourceReport = await ctx.db.get(snapshot.reportId);
    if (!sourceReport || sourceReport.projectId !== snapshot.projectId) {
      return null;
    }
    return {
      ...snapshot,
      sourceReportVersion: sourceReport.version,
    };
  },
});

/** Create a manual restore point of the report's current content. */
export const createManualSnapshot = mutation({
  args: {
    reportId: v.id("reports"),
    label: v.optional(v.string()),
    reason: v.optional(
      v.union(v.literal("manual"), v.literal("periodic"))
    ),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) domainError("NOT_FOUND", "Report not found");
    await requireInternalProjectAccess(ctx, report.projectId);
    const audit = await snapshotAuditFields(ctx, report);

    // Skip only an exact persisted-revision/audit-state duplicate. Legacy or
    // stale rows with the same content are superseded by a complete checkpoint.
    const latest = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .first();
    if (
      latest?.content === report.content &&
      latest.sourceRevisionNumber === (report.revisionNumber ?? 0) &&
      latest.contentHash === audit.contentHash &&
      latest.provenanceId === audit.provenanceId &&
      latest.generationId === audit.generationId &&
      latest.sourceTranscriptId === audit.sourceTranscriptId
    ) {
      return latest._id;
    }

    const label = args.label?.trim();
    const id = await ctx.db.insert("reportSnapshots", {
      projectId: report.projectId,
      reportId: args.reportId,
      content: report.content,
      sourceRevisionNumber: report.revisionNumber ?? 0,
      ...audit,
      reason: args.reason ?? "manual",
      ...(label ? { label } : {}),
      createdByRole: "writer",
      createdAt: Date.now(),
    });
    await pruneSnapshots(ctx, args.reportId);
    return id;
  },
});

/** BNH-56: named workflow checkpoint that is kept distinct from edit history. */
export const createMilestoneSnapshot = mutation({
  args: {
    reportId: v.id("reports"),
    label: v.string(),
    expectedRevisionNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) domainError("NOT_FOUND", "Report not found");
    await requireInternalProjectAccess(ctx, report.projectId);
    const revisionNumber = report.revisionNumber ?? 0;
    if (revisionNumber !== args.expectedRevisionNumber) {
      domainError(
        "STALE_REVISION",
        "The report changed before the milestone was captured"
      );
    }

    const label = args.label.trim();
    if (!label) domainError("INVALID_INPUT", "Milestone label is required");
    const milestoneKey = milestoneKeyFor(label);
    const canonicalLabel = canonicalMilestoneLabel(label, milestoneKey);
    const duplicate = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_projectId_and_milestoneKey", (q) =>
        q
          .eq("projectId", report.projectId)
          .eq("milestoneKey", milestoneKey)
      )
      .first();
    if (duplicate) {
      domainError(
        "INVALID_INPUT",
        `${milestoneKey} already exists for this project`
      );
    }

    const audit = await snapshotAuditFields(ctx, report);
    const id = await ctx.db.insert("reportSnapshots", {
      projectId: report.projectId,
      reportId: args.reportId,
      content: report.content,
      sourceRevisionNumber: revisionNumber,
      ...audit,
      reason: "milestone",
      label: canonicalLabel,
      milestoneKey,
      createdByRole: "writer",
      createdAt: Date.now(),
    });
    await pruneSnapshots(ctx, args.reportId);
    return id;
  },
});

/**
 * Non-destructive restore: snapshots the CURRENT content first (so the present
 * state is never lost), then sets the report content back to the snapshot.
 */
export const restoreSnapshot = mutation({
  args: {
    snapshotId: v.id("reportSnapshots"),
    targetReportId: v.id("reports"),
    expectedRevisionNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) domainError("NOT_FOUND", "Snapshot not found");
    await requireInternalProjectAccess(ctx, snapshot.projectId);
    const report = await ctx.db.get(args.targetReportId);
    if (!report || report.projectId !== snapshot.projectId) {
      domainError("NOT_AUTHORIZED", "Restore target belongs to another project");
    }
    const revisionNumber = report.revisionNumber ?? 0;
    if (revisionNumber !== args.expectedRevisionNumber) {
      domainError("STALE_REVISION", "The report changed while restore was open");
    }

    const now = Date.now();
    const currentAudit = await snapshotAuditFields(ctx, report);
    await ctx.db.insert("reportSnapshots", {
      projectId: report.projectId,
      reportId: report._id,
      content: report.content,
      sourceRevisionNumber: revisionNumber,
      ...currentAudit,
      reason: "pre_restore",
      label: "Before restore",
      createdByRole: "system",
      createdAt: now,
    });

    const restoredAudit = await snapshotAuditFields(ctx, snapshot);
    await ctx.db.patch(report._id, {
      content: snapshot.content,
      provenanceId: restoredAudit.provenanceId,
      generationId: restoredAudit.generationId,
      sourceTranscriptId: restoredAudit.sourceTranscriptId,
      contentHash: restoredAudit.contentHash,
      revisionNumber: revisionNumber + 1,
      updatedAt: now,
    });
    await pruneSnapshots(ctx, report._id);
    return revisionNumber + 1;
  },
});
