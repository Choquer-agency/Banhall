import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256 } from "./contracts";

type ReadCtx = { db: QueryCtx["db"] };
export type ReportWithBody = Doc<"reports"> & { content: string };
type BodyFields = Pick<Doc<"reportBodies">, "content" | "revisionNumber" | "contentHash" | "updatedAt" | "provenanceId" | "postSaveJobId">;

export async function getReportBody(ctx: ReadCtx, reportId: Id<"reports">) {
  return await ctx.db.query("reportBodies")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId)).unique();
}

export async function getPendingReportProvenance(ctx: ReadCtx, reportId: Id<"reports">) {
  return await ctx.db.query("reportPendingProvenance")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId)).unique();
}

export async function readReportContent(ctx: ReadCtx, report: Doc<"reports">): Promise<string> {
  const body = await getReportBody(ctx, report._id);
  if (body) return body.content;
  if (report.content !== undefined) return report.content;
  throw new Error(`Report ${report._id} has no text`);
}

export async function reportWithBody(ctx: ReadCtx, report: Doc<"reports">): Promise<ReportWithBody> {
  const body = await getReportBody(ctx, report._id);
  if (body) return {
    ...report,
    content: body.content,
    revisionNumber: body.revisionNumber,
    contentHash: body.contentHash,
    updatedAt: body.updatedAt,
    provenanceId: body.provenanceId,
  };
  if (report.content !== undefined) return { ...report, content: report.content };
  throw new Error(`Report ${report._id} has no text`);
}

export async function writeReportBody(
  ctx: MutationCtx,
  report: Doc<"reports">,
  fields: { content: string; revisionNumber: number; updatedAt: number; contentHash?: string; provenanceId?: Id<"reportProvenance">; postSaveJobId?: Id<"_scheduled_functions"> }
): Promise<void> {
  const bodyFields: BodyFields = {
    content: fields.content,
    revisionNumber: fields.revisionNumber,
    contentHash: fields.contentHash ?? await sha256(fields.content),
    updatedAt: fields.updatedAt,
    provenanceId: fields.provenanceId,
    postSaveJobId: fields.postSaveJobId,
  };
  const existing = await getReportBody(ctx, report._id);
  if (existing) await ctx.db.patch(existing._id, bodyFields);
  else await ctx.db.insert("reportBodies", { projectId: report.projectId, reportId: report._id, ...bodyFields });
}

export async function insertReportWithBody(
  ctx: MutationCtx,
  row: Omit<Doc<"reports">, "_id" | "_creationTime" | "content"> & { content: string }
): Promise<Id<"reports">> {
  const { content, ...details } = row;
  const reportId = await ctx.db.insert("reports", details);
  await ctx.db.insert("reportBodies", {
    projectId: row.projectId,
    reportId,
    content,
    revisionNumber: row.revisionNumber ?? 0,
    contentHash: row.contentHash ?? await sha256(content),
    updatedAt: row.updatedAt,
    provenanceId: row.provenanceId,
  });
  return reportId;
}

/**
 * The report of a generation. A generation normally has one report.
 * Restoring a snapshot taken from an earlier draft keeps that snapshot's
 * lineage (snapshots.restoreSnapshot), so the report the writer is working
 * on then names the earlier draft's generation too and two reports share
 * it. Every reader takes the newest of them, the same way
 * reports.getLatestReport picks a project's current report. Taking the
 * oldest scored QA on the superseded draft, so the restored report could
 * never get a current score, and asking for exactly one threw.
 */
export async function newestReportOfGeneration(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
): Promise<Doc<"reports"> | null> {
  return await ctx.db
    .query("reports")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .order("desc")
    .first();
}
