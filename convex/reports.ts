import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertProjectAccess, assertProjectOwner } from "./lib/auth";
import { extractPlainText } from "./lib/reportEdits";

export const getLatestReport = query({
  args: {
    projectId: v.id("projects"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectAccess(
      ctx,
      args.projectId,
      args.shareToken
    );
    if (!project) return null;

    return await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const updateReportContent = mutation({
  args: {
    reportId: v.id("reports"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");

    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) throw new Error("Not authorized");

    await ctx.db.patch(args.reportId, {
      content: args.content,
      updatedAt: Date.now(),
    });
  },
});

// ─── BNH-10 flywheel: post-edit distance ─────────────────────────────────────

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

/**
 * Post-edit distance (PED): how much of the AI draft the writer changed before
 * the report's current state — the north-star "is the system improving" metric
 * (regulatory-writing shops track exactly this; falling PED over time = better
 * drafts, >40-50% sustained = fix prompts/retrieval, not writers).
 *
 * v1 is deliberately cheap and order-insensitive: word-multiset similarity
 * (Sørensen–Dice) + unchanged-paragraph ratio against the "generated" baseline
 * snapshot frozen at candidate selection. It trends correctly; it does not
 * attribute edits to positions. Returns null for reports predating baseline
 * snapshots.
 */
export const postEditDistance = query({
  args: {
    reportId: v.id("reports"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    const project = await assertProjectAccess(
      ctx,
      report.projectId,
      args.shareToken
    );
    if (!project) return null;

    const baseline = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .filter((q) => q.eq(q.field("reason"), "generated"))
      .first();
    if (!baseline) return null;

    const draftText = extractPlainText(baseline.content);
    const currentText = extractPlainText(report.content);

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
      /** 0 = untouched draft, 1 = fully rewritten. */
      ped: 1 - similarity,
      wordSimilarity: similarity,
      draftWords,
      currentWords,
      paragraphsTotal: draftParas.length,
      paragraphsUnchanged: unchanged,
      draftLabel: baseline.label,
      baselineAt: baseline.createdAt,
    };
  },
});
