import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { reportQaRef } from "./qaFindings";
import { isProjectDeleting } from "./projectDeletion";

/**
 * Post-assembly QA results keyed to the exact report revision they scored
 * (reportId, revisionNumber, contentHash), 2026-09-25. A pass still merges its
 * scorecard and chronology into the generation's agent outputs, which the QA
 * panel reads; this row records which revision that scorecard is about, so a
 * reader can tell when the report has changed since (the result is no longer
 * current) instead of showing it as if it were.
 *
 * Only a pass that captured its revision writes a row: legacy settles carry
 * no proof of the content the model evaluated, and a pass whose report
 * changed before it finished is discarded, as before.
 */

type QaSettle = {
  capturedRef?: { reportId: Id<"reports">; revisionNumber: number; contentHash: string };
  qa?: string;
  chronology?: string;
  qaScore?: number;
  attemptStartedAt?: number | null;
};

export async function recordQaResult(
  ctx: MutationCtx,
  generation: Pick<Doc<"generations">, "_id" | "projectId">,
  settle: QaSettle,
  status: "done" | "failed",
  completedAt: number
): Promise<Id<"generationQaResults"> | null> {
  const ref = settle.capturedRef;
  if (!ref) return null;
  if (await isProjectDeleting(ctx, generation.projectId)) return null;
  return await ctx.db.insert("generationQaResults", {
    generationId: generation._id,
    projectId: generation.projectId,
    reportId: ref.reportId,
    revisionNumber: ref.revisionNumber,
    contentHash: ref.contentHash,
    status,
    ...(settle.qa !== undefined ? { qa: settle.qa } : {}),
    ...(settle.chronology !== undefined ? { chronology: settle.chronology } : {}),
    ...(settle.qaScore !== undefined ? { qaScore: settle.qaScore } : {}),
    ...(typeof settle.attemptStartedAt === "number"
      ? { attemptStartedAt: settle.attemptStartedAt }
      : {}),
    completedAt,
  });
}

/** The newest recorded result of a generation's QA passes, or null. */
export async function latestQaResult(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
): Promise<Doc<"generationQaResults"> | null> {
  return await ctx.db
    .query("generationQaResults")
    .withIndex("by_generationId_and_completedAt", (q) => q.eq("generationId", generationId))
    .order("desc")
    .first();
}

/** The result recorded for one exact report revision, newest first. */
export async function qaResultForRevision(
  ctx: { db: QueryCtx["db"] },
  ref: { reportId: Id<"reports">; revisionNumber: number; contentHash: string }
): Promise<Doc<"generationQaResults"> | null> {
  return await ctx.db
    .query("generationQaResults")
    .withIndex("by_reportId_and_revisionNumber_and_contentHash", (q) =>
      q
        .eq("reportId", ref.reportId)
        .eq("revisionNumber", ref.revisionNumber)
        .eq("contentHash", ref.contentHash)
    )
    .order("desc")
    .first();
}

/**
 * Whether a recorded result still describes the report as it is now: same
 * report, same revision and the same content bytes.
 */
export async function qaResultIsCurrent(
  result: Pick<Doc<"generationQaResults">, "reportId" | "revisionNumber" | "contentHash">,
  report: Doc<"reports"> | null
): Promise<boolean> {
  if (!report || report._id !== result.reportId) return false;
  const current = await reportQaRef(report);
  return (
    current.revisionNumber === result.revisionNumber &&
    current.contentHash === result.contentHash
  );
}
