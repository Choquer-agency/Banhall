/**
 * 2026-10-26 (Phase E, E2a; part 6 of the first 2026-10-26 entry):
 * "Removing a Brain source withdraws the lessons drawn from it; a published
 * lesson set drawn from it is turned off until an Admin publishes a new
 * one." Only `draft_style` sets read Brain feedback; `qa_calibration` sets
 * never draw on it.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AdmissionSnapshot } from "./learningAdmission";

type Ctx = QueryCtx | MutationCtx;

/** The stream name lesson-set builds give approved Brain feedback. */
export const BRAIN_FEEDBACK_STREAM = "brainFeedbackQueue";

/** Rows read per page while walking a source's links. */
const LINK_PAGE = 200;

type SetLike = { kind: Doc<"learningDigests">["kind"]; admission?: AdmissionSnapshot; feedbackCutoff: number };

/**
 * When a build counts a feedback item as approved: its latest decision's
 * audit time, else when it was sent (the same time
 * `getApprovedBrainFeedbackForDigest` gives the build).
 */
export async function feedbackApprovedAt(ctx: Ctx, row: Doc<"brainFeedbackQueue">): Promise<number> {
  const decision = await ctx.db
    .query("brainAuditLog")
    .withIndex("by_feedbackId", (q) => q.eq("feedbackId", row._id))
    .order("desc")
    .first();
  return decision?.at ?? row.createdAt;
}

/** The learning revision: the latest withdrawal, 0 before any. */
export async function learningRevision(ctx: Ctx): Promise<number> {
  const latest = await ctx.db
    .query("brainFeedbackQueue")
    .withIndex("by_withdrawnAt", (q) => q.gt("withdrawnAt", 0))
    .order("desc")
    .first();
  return latest?.withdrawnAt ?? 0;
}

/**
 * A memo of which feedback items are withdrawn, so one request that weighs
 * several sets reads each item once.
 */
export function withdrawnLookup(ctx: Ctx): (id: string) => Promise<boolean> {
  const seen = new Map<string, boolean>();
  return async (id) => {
    const known = seen.get(id);
    if (known !== undefined) return known;
    const normalized = ctx.db.normalizeId("brainFeedbackQueue", id);
    const row = normalized ? await ctx.db.get(normalized) : null;
    const withdrawn = row?.withdrawnAt !== undefined && row !== null;
    seen.set(id, withdrawn);
    return withdrawn;
  };
}

/**
 * Whether a lesson set drew on withdrawn feedback: exactly, by reading each
 * item its admission record names (review: no cap on how many were
 * withdrawn); a set with no record (an older or the frozen legacy set)
 * counts as drawn from every item approved up to its cutoff.
 */
export async function drewOnWithdrawn(
  ctx: Ctx,
  set: SetLike,
  isWithdrawn: (id: string) => Promise<boolean> = withdrawnLookup(ctx)
): Promise<boolean> {
  if (set.kind !== "draft_style") return false;
  if (set.admission) {
    for (const stream of set.admission.streams) {
      if (stream.stream !== BRAIN_FEEDBACK_STREAM) continue;
      for (const id of stream.signalIds) if (await isWithdrawn(id)) return true;
    }
    return false;
  }
  const approvedByCutoff = await ctx.db
    .query("brainFeedbackQueue")
    .withIndex("by_withdrawnApprovedAt", (q) => q.gt("withdrawnApprovedAt", 0).lte("withdrawnApprovedAt", set.feedbackCutoff))
    .first();
  return approvedByCutoff !== null;
}

/**
 * Whether a build with these inputs adds nothing to the newest candidate: no
 * newer admitted feedback and no withdrawal since it was built.
 */
export function sameLearningInputs(
  newest: Pick<Doc<"learningDigests">, "feedbackCutoff" | "learningRevision"> | null,
  feedbackCutoff: number,
  revision: number
): boolean {
  return newest !== null && feedbackCutoff <= newest.feedbackCutoff && revision <= (newest.learningRevision ?? 0);
}

/** The published `draft_style` set and the selection that published it (none before the first selection). */
async function publishedStyleSet(ctx: Ctx): Promise<{
  selection: Doc<"learningDigestSelections"> | null;
  digest: Doc<"learningDigests"> | null;
}> {
  const selection = await ctx.db
    .query("learningDigestSelections")
    .withIndex("by_kind", (q) => q.eq("kind", "draft_style"))
    .order("desc")
    .first();
  if (selection) {
    const digest = selection.selectedDigestId ? await ctx.db.get(selection.selectedDigestId) : null;
    return { selection, digest };
  }
  // Before the first selection the newest global set is the published one.
  const legacy = await ctx.db
    .query("learningDigests")
    .withIndex("by_kind_and_userId", (q) => q.eq("kind", "draft_style").eq("userId", undefined))
    .order("desc")
    .first();
  return { selection: null, digest: legacy };
}

/** Turns off the published `draft_style` set when it drew on withdrawn feedback. */
export async function turnOffWithdrawnPublishedSet(ctx: MutationCtx, now = Date.now()): Promise<boolean> {
  const { selection, digest } = await publishedStyleSet(ctx);
  if (!digest || !(await drewOnWithdrawn(ctx, digest))) return false;
  await ctx.db.insert("learningDigestSelections", {
    kind: "draft_style",
    selectedDigestId: null,
    ...(selection ? { previousSelectionId: selection._id } : {}),
    actorKind: "system",
    action: "source_withdrawn",
    reason: "A Brain source this guidance drew on was removed.",
    selectedAt: now,
  });
  return true;
}

/**
 * Withdraws one feedback item, recording the approval time builds used for
 * it. Returns false when it was already withdrawn.
 */
export async function withdrawFeedback(
  ctx: MutationCtx,
  row: Doc<"brainFeedbackQueue">,
  sourceId: Id<"brainSources">,
  now: number
): Promise<boolean> {
  if (row.withdrawnAt !== undefined) return false;
  await ctx.db.patch(row._id, {
    withdrawnAt: now,
    withdrawnApprovedAt: await feedbackApprovedAt(ctx, row),
    ...(row.brainSourceId ? {} : { brainSourceId: sourceId }),
  });
  return true;
}

/**
 * Withdraws every feedback item a removed Brain source was made from (linked
 * directly, or, for older items, through their approval's audit row), page
 * by page with no cap (review), then turns off a published set that drew on
 * them. Returns how many were withdrawn.
 */
export async function withdrawSourceFeedback(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">,
  now = Date.now()
): Promise<number> {
  let withdrawn = 0;
  let after = -1;
  for (;;) {
    const page = await ctx.db
      .query("brainFeedbackQueue")
      .withIndex("by_brainSourceId", (q) => q.eq("brainSourceId", sourceId).gt("_creationTime", after))
      .take(LINK_PAGE);
    for (const row of page) if (await withdrawFeedback(ctx, row, sourceId, now)) withdrawn += 1;
    if (page.length < LINK_PAGE) break;
    after = page[page.length - 1]!._creationTime;
  }
  after = -1;
  for (;;) {
    const audits = await ctx.db
      .query("brainAuditLog")
      .withIndex("by_source", (q) => q.eq("sourceId", sourceId).gt("_creationTime", after))
      .take(LINK_PAGE);
    for (const audit of audits) {
      if (audit.action !== "approve" || !audit.feedbackId) continue;
      const row = await ctx.db.get(audit.feedbackId);
      if (row && (await withdrawFeedback(ctx, row, sourceId, now))) withdrawn += 1;
    }
    if (audits.length < LINK_PAGE) break;
    after = audits[audits.length - 1]!._creationTime;
  }
  if (withdrawn > 0) await turnOffWithdrawnPublishedSet(ctx, now);
  return withdrawn;
}
