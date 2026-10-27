import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { tryExtractPlainText } from "./reportEdits";
import { isEvaluationProject } from "./evaluationProjects";

// ─── BNH-10 flywheel: post-edit distance (PED) ───────────────────────────────

/** Lowercased word multiset — cheap, order-insensitive edit signal. */
function wordBag(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!w) continue;
    bag.set(w, (bag.get(w) ?? 0) + 1);
  }
  return bag;
}

function bagOverlap(a: Map<string, number>, b: Map<string, number>): number {
  let n = 0;
  for (const [w, ca] of a) n += Math.min(ca, b.get(w) ?? 0);
  return n;
}

function bagSize(bag: Map<string, number>): number {
  let n = 0;
  for (const c of bag.values()) n += c;
  return n;
}

const normalizePara = (p: string) => p.replace(/\s+/g, " ").trim().toLowerCase();

export type EditDistanceResult = {
  /** 0 = untouched draft, 1 = fully rewritten. */
  ped: number;
  wordSimilarity: number;
  draftWords: number;
  currentWords: number;
  paragraphsTotal: number;
  paragraphsUnchanged: number;
};

/**
 * Post-edit distance (PED): how much of the AI draft the writer changed before
 * the report's current state — the north-star "is the system improving" metric
 * (regulatory-writing shops track exactly this; falling PED over time = better
 * drafts, >40-50% sustained = fix prompts/retrieval, not writers).
 *
 * v1 is deliberately cheap and order-insensitive: `ped` is `1 -` the
 * word-multiset (Sørensen–Dice) similarity against the "generated" baseline
 * snapshot frozen at candidate selection. The unchanged-paragraph counts are
 * reported alongside it for context and are deliberately NOT folded into
 * `ped` — the persisted number is the word-similarity term only. It trends
 * correctly; it does not attribute edits to positions.
 */
export function computeEditDistance(
  draftText: string,
  currentText: string
): EditDistanceResult {
  const draftBag = wordBag(draftText);
  const currentBag = wordBag(currentText);
  const draftWords = bagSize(draftBag);
  const currentWords = bagSize(currentBag);
  const similarity =
    draftWords + currentWords === 0
      ? 1
      : (2 * bagOverlap(draftBag, currentBag)) / (draftWords + currentWords);

  const draftParas = draftText.split(/\n{2,}|\n/).map(normalizePara).filter(Boolean);
  const currentParas = new Map<string, number>();
  for (const p of currentText.split(/\n{2,}|\n/).map(normalizePara).filter(Boolean)) {
    currentParas.set(p, (currentParas.get(p) ?? 0) + 1);
  }
  let unchanged = 0;
  for (const p of draftParas) {
    const left = currentParas.get(p) ?? 0;
    if (left > 0) {
      unchanged += 1;
      currentParas.set(p, left - 1);
    }
  }

  return {
    ped: 1 - similarity,
    wordSimilarity: similarity,
    draftWords,
    currentWords,
    paragraphsTotal: draftParas.length,
    paragraphsUnchanged: unchanged,
  };
}

/**
 * When PED is frozen into `reportEditDistance`: the three milestones, a chat
 * card applied, and the end of an editing burst (2026-10-27, Phase E, E3).
 */
export type EditDistanceTrigger =
  | "candidate_selection"
  | "milestone"
  | "client_publish"
  | "chat_apply"
  | "edit";

/** Who made the change a reading measures, and a chat apply's lesson set. */
export type EditDistanceExtra = {
  editorUserId?: Id<"users">;
  learningDigestId?: Id<"learningDigests">;
};

/**
 * Persist one PED reading for a report. Never throws into the caller's path:
 * a report with no "generated" baseline (or any unexpected failure) records
 * nothing and the triggering mutation proceeds.
 */
export async function recordReportEditDistance(
  ctx: MutationCtx,
  report: Doc<"reports">,
  trigger: EditDistanceTrigger,
  extra: EditDistanceExtra = {}
): Promise<Id<"reportEditDistance"> | null> {
  try {
    const project = await ctx.db.get(report.projectId);
    // Phase E (E3): an evaluation project records no edit size.
    if (isEvaluationProject(project)) return null;
    const baseline = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", report._id))
      .filter((q) => q.eq(q.field("reason"), "generated"))
      .first();
    if (!baseline) return null;

    const draftText = tryExtractPlainText(baseline.content);
    const currentText = tryExtractPlainText(report.content);
    if (draftText === null || currentText === null) return null;

    const { ped } = computeEditDistance(draftText, currentText);
    const revisionNumber = report.revisionNumber ?? 0;

    // Repeat-trigger dedupe: a second identical reading (same trigger, same
    // revision, same ped) adds no signal — e.g. publishForReview called twice
    // with no edit in between.
    const newest = await ctx.db
      .query("reportEditDistance")
      .withIndex("by_reportId", (q) => q.eq("reportId", report._id))
      .order("desc")
      .first();
    if (
      newest &&
      newest.trigger === trigger &&
      newest.revisionNumber === revisionNumber &&
      newest.ped === ped
    ) {
      return null;
    }
    // An editing burst records the latest revision only when that revision
    // has no reading yet (a chat apply or a milestone may have read it).
    if (trigger === "edit" && newest && newest.revisionNumber === revisionNumber) {
      return null;
    }

    return await ctx.db.insert("reportEditDistance", {
      reportId: report._id,
      projectId: report.projectId,
      generationId: report.generationId,
      writerUserId: project?.ownerId,
      revisionNumber,
      ped,
      computedAt: Date.now(),
      trigger,
      ...(extra.editorUserId ? { editorUserId: extra.editorUserId } : {}),
      ...(extra.learningDigestId ? { learningDigestId: extra.learningDigestId } : {}),
    });
  } catch (error) {
    console.error("recordReportEditDistance failed", {
      reportId: report._id,
      projectId: report.projectId,
      trigger,
      error,
    });
    return null;
  }
}

/**
 * E3 review: before an AI change to the report's text (a redraft), an open
 * editing burst is closed with its reading of the person's own revision, so
 * its later reading never measures the AI's text under the person's name.
 */
export async function closeEditBurst(ctx: MutationCtx, report: Doc<"reports">): Promise<void> {
  const due = await ctx.db
    .query("reportEditSizeDue")
    .withIndex("by_reportId", (q) => q.eq("reportId", report._id))
    .unique();
  if (!due) return;
  await ctx.db.delete(due._id);
  await recordReportEditDistance(ctx, report, "edit", { editorUserId: due.editorUserId });
}

/** An editing burst: its reading is taken this long after its first save. */
export const EDIT_SIZE_BURST_MS = 10 * 60 * 1000;

/**
 * A person changed the report's text (a save, an accepted client edit, a
 * restore, an undo). The first change of a burst writes the report's
 * `reportEditSizeDue` row and schedules the burst's reading
 * (`reportEditDistance.recordEditBurst`); later changes only name the latest
 * editor. Saves never read `reportEditDistance`, and the reading reads the
 * report's latest revision, so the last change of a burst is always read.
 */
export async function noteReportEditForSize(
  ctx: MutationCtx,
  report: Doc<"reports">,
  editorUserId: Id<"users">
): Promise<void> {
  const due = await ctx.db
    .query("reportEditSizeDue")
    .withIndex("by_reportId", (q) => q.eq("reportId", report._id))
    .unique();
  if (due) {
    if (due.editorUserId !== editorUserId) await ctx.db.patch(due._id, { editorUserId });
    return;
  }
  const dueAt = Date.now() + EDIT_SIZE_BURST_MS;
  await ctx.db.insert("reportEditSizeDue", {
    reportId: report._id,
    projectId: report.projectId,
    editorUserId,
    dueAt,
  });
  // The job names its burst, so a burst closed early never has its job cut
  // the next burst short (re-check).
  await ctx.scheduler.runAfter(EDIT_SIZE_BURST_MS, internal.reportEditDistance.recordEditBurst, {
    reportId: report._id,
    dueAt,
  });
}
