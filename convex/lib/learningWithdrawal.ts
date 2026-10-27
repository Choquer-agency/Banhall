/**
 * 2026-10-26 (Phase E, E2a; part 6 of the first 2026-10-26 entry):
 * "Removing a Brain source withdraws the lessons drawn from it; a published
 * lesson set drawn from it is turned off until an Admin publishes a new
 * one." Only `draft_style` sets read Brain feedback; `qa_calibration` sets
 * never draw on it.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

/** The stream name lesson-set builds give approved Brain feedback. */
export const BRAIN_FEEDBACK_STREAM = "brainFeedbackQueue";

/** At most this many withdrawn items are weighed against a set. */
const MAX_WITHDRAWN_READ = 500;
/** At most this many feedback items one source is linked to. */
const MAX_LINKED_FEEDBACK = 200;

export type WithdrawnFeedback = { id: string; approvedAt: number };

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

/** Withdrawn feedback, newest first, each with the approval time builds used. */
export async function withdrawnFeedback(ctx: Ctx): Promise<WithdrawnFeedback[]> {
  const rows = await ctx.db
    .query("brainFeedbackQueue")
    .withIndex("by_withdrawnAt", (q) => q.gt("withdrawnAt", 0))
    .order("desc")
    .take(MAX_WITHDRAWN_READ);
  const items: WithdrawnFeedback[] = [];
  for (const row of rows) items.push({ id: row._id, approvedAt: await feedbackApprovedAt(ctx, row) });
  return items;
}

/**
 * Whether a lesson set drew on withdrawn feedback: exactly, by the feedback
 * its admission record names; a set with no record (an older or the frozen
 * legacy set) counts as drawn from every approved item up to its cutoff.
 */
export function drewOnWithdrawn(
  digest: Pick<Doc<"learningDigests">, "kind" | "admission" | "feedbackCutoff">,
  withdrawn: ReadonlyArray<WithdrawnFeedback>
): boolean {
  if (digest.kind !== "draft_style" || withdrawn.length === 0) return false;
  if (digest.admission) {
    const admitted = new Set(
      digest.admission.streams
        .filter((stream) => stream.stream === BRAIN_FEEDBACK_STREAM)
        .flatMap((stream) => stream.signalIds)
    );
    return withdrawn.some((item) => admitted.has(item.id));
  }
  return withdrawn.some((item) => item.approvedAt <= digest.feedbackCutoff);
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
  if (!digest || !drewOnWithdrawn(digest, await withdrawnFeedback(ctx))) return false;
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
 * Withdraws the feedback a removed Brain source was made from (linked
 * directly, or, for older items, through their approval's audit row), then
 * turns off a published set that drew on it. Returns how many were withdrawn.
 */
export async function withdrawSourceFeedback(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">,
  now = Date.now()
): Promise<number> {
  const ids = new Set<Id<"brainFeedbackQueue">>();
  const linked = await ctx.db
    .query("brainFeedbackQueue")
    .withIndex("by_brainSourceId", (q) => q.eq("brainSourceId", sourceId))
    .take(MAX_LINKED_FEEDBACK);
  for (const row of linked) ids.add(row._id);
  const audits = await ctx.db
    .query("brainAuditLog")
    .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
    .take(MAX_LINKED_FEEDBACK);
  for (const audit of audits) {
    if (audit.action === "approve" && audit.feedbackId) ids.add(audit.feedbackId);
  }
  let withdrawn = 0;
  for (const id of ids) {
    const row = await ctx.db.get(id);
    if (!row || row.withdrawnAt !== undefined) continue;
    await ctx.db.patch(id, { withdrawnAt: now, ...(row.brainSourceId ? {} : { brainSourceId: sourceId }) });
    withdrawn += 1;
  }
  if (withdrawn > 0) await turnOffWithdrawnPublishedSet(ctx, now);
  return withdrawn;
}
