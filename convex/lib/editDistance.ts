import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { extractPlainText } from "./reportEdits";

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

/** The three milestones at which PED is frozen into `reportEditDistance`. */
export type EditDistanceTrigger =
  | "candidate_selection"
  | "milestone"
  | "client_publish";

/**
 * Persist one PED reading for a report. Never throws into the caller's path:
 * a report with no "generated" baseline (or any unexpected failure) records
 * nothing and the triggering mutation proceeds.
 */
export async function recordReportEditDistance(
  ctx: MutationCtx,
  report: Doc<"reports">,
  trigger: EditDistanceTrigger
): Promise<Id<"reportEditDistance"> | null> {
  try {
    const baseline = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", report._id))
      .filter((q) => q.eq(q.field("reason"), "generated"))
      .first();
    if (!baseline) return null;

    const { ped } = computeEditDistance(
      extractPlainText(baseline.content),
      extractPlainText(report.content)
    );
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

    const project = await ctx.db.get(report.projectId);
    return await ctx.db.insert("reportEditDistance", {
      reportId: report._id,
      projectId: report.projectId,
      generationId: report.generationId,
      writerUserId: project?.ownerId,
      revisionNumber,
      ped,
      computedAt: Date.now(),
      trigger,
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
