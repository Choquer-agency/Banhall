import {
  query,
  mutation,
  action,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { importSource } from "./brain";
import { getCurrentUserOrNull } from "./lib/auth";
import { graphConfiguration } from "./lib/providerConfig";

// ─── OneDrive corpus ingestion staging (BNH-17) ─────────────────────────────
// Human-in-the-loop bridge between the client's OneDrive and The Brain.
// Two feeders — the Graph delta sync (convex/ingestionSync.ts, Path A) and
// the local crawler upload endpoint (convex/http.ts, Path B) — stage files
// here; the admin reviews them at /admin/ingestion and each approval creates
// an approved brainSources row (which schedules its embedding). Nothing is
// ever auto-ingested — same gate as the rest of the Brain.

const SYNC_STATE_KEY = "onedrive";
// Statuses that participate in pair math / can still be acted on.
const LIVE_STATUSES = new Set(["discovered", "fetched", "pending_review", "approved"]);

async function assertAdmin(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new Error("Not authenticated");
  if (user.role !== "admin") throw new Error("Admin only");
  return user._id;
}

async function adminOrNull(ctx: QueryCtx): Promise<string | null> {
  const user = await getCurrentUserOrNull(ctx);
  return user?.role === "admin" ? user._id : null;
}

/** Recompute pairStatus for one client+FY group (small rows — text lives in
 * storage, so reading a whole group stays far under transaction read limits).
 * Non-live rows (rejected/failed) neither count nor carry a pairStatus. */
async function recomputePairGroup(ctx: MutationCtx, groupKey: string) {
  const items = await ctx.db
    .query("ingestionItems")
    .withIndex("by_pairGroupKey", (q) => q.eq("pairGroupKey", groupKey))
    .take(300);
  const live = items.filter((i) => LIVE_STATUSES.has(i.status));
  const pds = live.filter((i) => i.docKind === "pd").length;
  const transcripts = live.filter((i) => i.docKind === "transcript").length;
  for (const item of items) {
    let pairStatus: Doc<"ingestionItems">["pairStatus"];
    if (!LIVE_STATUSES.has(item.status)) {
      pairStatus = undefined;
    } else if (item.docKind === "pd") {
      pairStatus =
        pds > 1 ? "ambiguous_pd" : transcripts > 0 ? "paired" : "missing_transcript";
    } else if (item.docKind === "transcript") {
      pairStatus = pds > 0 ? "paired" : "missing_pd";
    } else {
      pairStatus = pds > 0 ? "paired" : undefined;
    }
    if (item.pairStatus !== pairStatus) {
      await ctx.db.patch(item._id, { pairStatus, updatedAt: Date.now() });
    }
  }
}

// ─── Admin dashboard queries ────────────────────────────────────────────────

export const ingestionStats = query({
  args: {},
  handler: async (ctx) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const count = async (
      status: Doc<"ingestionItems">["status"]
    ): Promise<number> =>
      (
        await ctx.db
          .query("ingestionItems")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(1000)
      ).length;
    return {
      pendingReview: await count("pending_review"),
      discovered: await count("discovered"),
      fetched: await count("fetched"),
      approved: await count("approved"),
      rejected: await count("rejected"),
      failed: await count("failed"),
      deleted: await count("deleted"),
      graph: graphConfiguration(),
    };
  },
});

export const listItems = query({
  args: {
    status: v.union(
      v.literal("discovered"),
      v.literal("fetched"),
      v.literal("pending_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("failed"),
      v.literal("deleted")
    ),
  },
  handler: async (ctx, args) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const items = await ctx.db
      .query("ingestionItems")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .take(300);
    // The review UI groups by client + fiscal year; sorting here keeps groups
    // contiguous without a client-side re-sort of a reactive array.
    return items.sort((a, b) =>
      a.pairGroupKey === b.pairGroupKey
        ? a.name.localeCompare(b.name)
        : a.pairGroupKey.localeCompare(b.pairGroupKey)
    );
  },
});

/** Pairing gaps — "we need to get the transcript for this one" (Jun 19).
 * Non-live rows never carry a pairStatus, so these lists are review-relevant
 * by construction. */
export const listGaps = query({
  args: {},
  handler: async (ctx) => {
    if ((await adminOrNull(ctx)) === null) return null;
    const missingTranscript = await ctx.db
      .query("ingestionItems")
      .withIndex("by_pairStatus", (q) => q.eq("pairStatus", "missing_transcript"))
      .take(200);
    const missingPd = await ctx.db
      .query("ingestionItems")
      .withIndex("by_pairStatus", (q) => q.eq("pairStatus", "missing_pd"))
      .take(200);
    const ambiguous = await ctx.db
      .query("ingestionItems")
      .withIndex("by_pairStatus", (q) => q.eq("pairStatus", "ambiguous_pd"))
      .take(200);
    return { missingTranscript, missingPd, ambiguous };
  },
});

export const listSyncRuns = query({
  args: {},
  handler: async (ctx) => {
    if ((await adminOrNull(ctx)) === null) return null;
    return await ctx.db
      .query("oneDriveSyncRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .take(20);
  },
});

// ─── Review actions (the human in the loop) ─────────────────────────────────

/** Auth + preconditions for approval; runs with the caller's identity. */
export const getItemForApproval = internalQuery({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Ingestion item not found");
    if (item.status !== "pending_review") {
      throw new Error("Only items pending review can be approved");
    }
    if (!item.text?.trim() && !item.textStorageId) {
      throw new Error("No extracted text on this item — it cannot enter the Brain");
    }
    return item;
  },
});

export const finalizeApproval = internalMutation({
  args: {
    itemId: v.id("ingestionItems"),
    content: v.string(),
    industry: v.string(),
    writerName: v.optional(v.string()),
    writerTier: v.number(),
    scienceCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "pending_review") {
      throw new Error("Item is no longer pending review");
    }
    const docType =
      item.docKind === "pd"
        ? "pd"
        : item.docKind === "transcript"
          ? "transcript"
          : "supporting_doc";
    const title = [item.clientName, item.fiscalYearLabel, item.name]
      .filter(Boolean)
      .join(" — ");
    const sourceId = await importSource(
      ctx,
      {
        kind: "pd_pair",
        title,
        industry: args.industry.trim(),
        writerName: args.writerName?.trim() || undefined,
        writerTier: args.writerTier,
        docType,
        fiscalYear: item.fiscalYear,
        content: args.content,
        scienceCode: args.scienceCode?.trim() || undefined,
        approve: true,
      },
      admin
    );
    await ctx.db.patch(args.itemId, {
      status: "approved",
      brainSourceId: sourceId,
      reviewedBy: admin,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recomputePairGroup(ctx, item.pairGroupKey);
    return sourceId;
  },
});

/**
 * Approve one reviewed item into The Brain. An action (not a mutation)
 * because the full extracted text lives in storage; reuses brain.importSource
 * with approve=true (the review happening here IS the approval), so dedupe,
 * audit logging, and embed scheduling behave exactly like a curated import.
 */
export const approveItem = action({
  args: {
    itemId: v.id("ingestionItems"),
    industry: v.string(),
    writerName: v.optional(v.string()),
    writerTier: v.number(),
    scienceCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"brainSources">> => {
    if (
      !Number.isFinite(args.writerTier) ||
      args.writerTier < 0 ||
      args.writerTier > 1
    ) {
      throw new Error("Writer tier must be between 0 and 1");
    }
    if (!args.industry.trim()) throw new Error("Industry is required");
    const item = await ctx.runQuery(internal.ingestion.getItemForApproval, {
      itemId: args.itemId,
    });
    let content = item.text ?? "";
    if (item.textStorageId) {
      const blob = await ctx.storage.get(item.textStorageId);
      if (!blob) throw new Error("Extracted text not found in storage");
      content = await blob.text();
    }
    if (!content.trim()) {
      throw new Error("No extracted text on this item — it cannot enter the Brain");
    }
    return await ctx.runMutation(internal.ingestion.finalizeApproval, {
      itemId: args.itemId,
      content,
      industry: args.industry,
      writerName: args.writerName,
      writerTier: args.writerTier,
      scienceCode: args.scienceCode,
    });
  },
});

export const rejectItem = mutation({
  args: { itemId: v.id("ingestionItems"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Ingestion item not found");
    if (item.status === "approved") {
      throw new Error(
        "Already in the Brain — revoke it from the Brain admin page instead"
      );
    }
    if (item.status === "deleted") {
      throw new Error("Restore this item before rejecting it");
    }
    await ctx.db.patch(args.itemId, {
      status: "rejected",
      pairStatus: undefined,
      reviewNote: args.note?.trim() || undefined,
      reviewedBy: admin,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recomputePairGroup(ctx, item.pairGroupKey);
    return null;
  },
});

/**
 * Remove a staged item from active review without touching OneDrive or an
 * approved Brain source. The explicit deleted state keeps this reversible;
 * the prior queue state is restored exactly by restoreItem.
 */
export const removeItem = mutation({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Ingestion item not found");
    if (item.status === "approved") {
      throw new Error(
        "Already in the Brain — revoke it from the Brain admin page instead"
      );
    }
    if (item.status === "deleted") return null;
    if (
      item.status !== "pending_review" &&
      item.status !== "rejected" &&
      item.status !== "failed"
    ) {
      throw new Error("This file is still processing and cannot be deleted yet");
    }
    const now = Date.now();
    await ctx.db.patch(args.itemId, {
      status: "deleted",
      pairStatus: undefined,
      deletedFromStatus: item.status,
      deletedBy: admin,
      deletedAt: now,
      updatedAt: now,
    });
    await recomputePairGroup(ctx, item.pairGroupKey);
    return null;
  },
});

export const restoreItem = mutation({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    await assertAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Ingestion item not found");
    if (item.status !== "deleted") {
      throw new Error("Only deleted ingestion items can be restored");
    }
    const restoredStatus = item.deletedFromStatus ?? "pending_review";
    await ctx.db.patch(args.itemId, {
      status: restoredStatus,
      deletedFromStatus: undefined,
      deletedBy: undefined,
      deletedAt: undefined,
      updatedAt: Date.now(),
    });
    await recomputePairGroup(ctx, item.pairGroupKey);
    return null;
  },
});

// ─── Sync trigger ───────────────────────────────────────────────────────────

export const startSync = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await assertAdmin(ctx);
    if (graphConfiguration().state !== "configured") {
      throw new Error(
        "Microsoft Graph is not configured — set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_DRIVE_ID"
      );
    }
    const latest = await ctx.db
      .query("oneDriveSyncRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .first();
    // Heartbeat-based staleness: a healthy continuation chain keeps patching
    // lastProgressAt, so long backlogs don't trip this; a crashed action goes
    // quiet and frees the lock after 15 minutes.
    const lastBeat = latest?.lastProgressAt ?? latest?.startedAt ?? 0;
    if (latest?.status === "running" && Date.now() - lastBeat < 15 * 60 * 1000) {
      throw new Error("A sync is already running");
    }
    const runId = await ctx.db.insert("oneDriveSyncRuns", {
      status: "running",
      triggeredBy: admin,
      startedAt: Date.now(),
      lastProgressAt: Date.now(),
      discovered: 0,
      processed: 0,
      skipped: 0,
    });
    await ctx.scheduler.runAfter(0, internal.ingestionSync.syncOneDrive, {
      runId,
    });
    return runId;
  },
});

// ─── Internal plumbing used by convex/ingestionSync.ts and http.ts ──────────

export const getSyncState = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("oneDriveSyncState")
      .withIndex("by_key", (q) => q.eq("key", SYNC_STATE_KEY))
      .unique();
  },
});

async function patchSyncState(
  ctx: MutationCtx,
  patch: { deltaLink?: string | undefined; nextLink?: string | undefined }
) {
  const existing = await ctx.db
    .query("oneDriveSyncState")
    .withIndex("by_key", (q) => q.eq("key", SYNC_STATE_KEY))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("oneDriveSyncState", {
      key: SYNC_STATE_KEY,
      ...patch,
      updatedAt: Date.now(),
    });
  }
}

/** Walk complete: store the deltaLink, clear any mid-walk checkpoint. */
export const saveDeltaLink = internalMutation({
  args: { deltaLink: v.string() },
  handler: async (ctx, args) => {
    await patchSyncState(ctx, { deltaLink: args.deltaLink, nextLink: undefined });
    return null;
  },
});

/** Mid-walk checkpoint so a large discovery resumes instead of replaying. */
export const saveNextLink = internalMutation({
  args: { nextLink: v.string() },
  handler: async (ctx, args) => {
    await patchSyncState(ctx, { nextLink: args.nextLink });
    return null;
  },
});

/** Graph 410 resyncRequired: drop cursors and re-walk from scratch. */
export const clearSyncCursor = internalMutation({
  args: {},
  handler: async (ctx) => {
    await patchSyncState(ctx, { deltaLink: undefined, nextLink: undefined });
    return null;
  },
});

const upsertFields = {
  driveItemId: v.string(),
  path: v.string(),
  name: v.string(),
  clientName: v.optional(v.string()),
  fiscalYearLabel: v.optional(v.string()),
  fiscalYear: v.optional(v.number()),
  docKind: v.union(
    v.literal("pd"),
    v.literal("transcript"),
    v.literal("supporting"),
    v.literal("unknown")
  ),
  size: v.number(),
  lastModifiedAt: v.number(),
  contentHash: v.string(),
  pairGroupKey: v.string(),
};

type UpsertArgs = {
  driveItemId: string;
  path: string;
  name: string;
  clientName?: string;
  fiscalYearLabel?: string;
  fiscalYear?: number;
  docKind: "pd" | "transcript" | "supporting" | "unknown";
  size: number;
  lastModifiedAt: number;
  contentHash: string;
  pairGroupKey: string;
};

async function upsertDiscovered(
  ctx: MutationCtx,
  args: UpsertArgs
): Promise<Id<"ingestionItems"> | null> {
  const existing = await ctx.db
    .query("ingestionItems")
    .withIndex("by_driveItemId", (q) => q.eq("driveItemId", args.driveItemId))
    .unique();
  if (!existing) {
    return await ctx.db.insert("ingestionItems", {
      ...args,
      status: "discovered",
      updatedAt: Date.now(),
    });
  }
  if (existing.contentHash === args.contentHash) {
    // Failed items with unchanged bytes still deserve a retry — a transient
    // download/extract error must not be permanent.
    if (existing.status === "failed") {
      await ctx.db.patch(existing._id, {
        ...args,
        status: "discovered",
        error: undefined,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    // Metadata-only change (rename/move) — keep the review state.
    await ctx.db.patch(existing._id, {
      path: args.path,
      name: args.name,
      lastModifiedAt: args.lastModifiedAt,
      updatedAt: Date.now(),
    });
    return null;
  }
  if (existing.status === "approved") {
    // Never silently reset an approved item: its brainSources row would go
    // stale with no revocation. Flag it for the admin instead.
    await ctx.db.patch(existing._id, {
      extractNote:
        "Content changed in OneDrive after approval — re-review; the Brain still holds the earlier version",
      lastModifiedAt: args.lastModifiedAt,
      updatedAt: Date.now(),
    });
    return null;
  }
  // Content changed on the drive — back to the start of the pipeline.
  await ctx.db.patch(existing._id, {
    ...args,
    status: "discovered",
    text: undefined,
    textStorageId: undefined,
    extractNote: undefined,
    error: undefined,
    deletedFromStatus: undefined,
    deletedBy: undefined,
    deletedAt: undefined,
    updatedAt: Date.now(),
  });
  return existing._id;
}

/**
 * Upsert a discovered drive item. Returns the item id when it needs
 * fetching/extraction, or null when the stored copy is already current or the
 * item was already reviewed.
 */
export const upsertDiscoveredItem = internalMutation({
  args: upsertFields,
  handler: async (ctx, args): Promise<Id<"ingestionItems"> | null> => {
    return await upsertDiscovered(ctx, args);
  },
});

/** Page-sized batch upsert for the delta walk (one mutation per Graph page
 * instead of one per file — keeps huge initial crawls inside action limits). */
export const upsertDiscoveredBatch = internalMutation({
  args: { items: v.array(v.object(upsertFields)) },
  handler: async (ctx, args): Promise<number> => {
    let inserted = 0;
    for (const item of args.items.slice(0, 250)) {
      if ((await upsertDiscovered(ctx, item)) !== null) inserted++;
    }
    return inserted;
  },
});

/** Graph delta reported the item deleted — retire it from the queue. */
export const markDriveItemRemoved = internalMutation({
  args: { driveItemId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ingestionItems")
      .withIndex("by_driveItemId", (q) => q.eq("driveItemId", args.driveItemId))
      .unique();
    if (!existing) return null;
    if (existing.status === "approved") {
      await ctx.db.patch(existing._id, {
        extractNote:
          "Deleted in OneDrive after approval — the Brain still holds it; revoke from the Brain page if unwanted",
        updatedAt: Date.now(),
      });
      return null;
    }
    if (existing.status === "rejected" || existing.status === "deleted") return null;
    await ctx.db.patch(existing._id, {
      status: "rejected",
      pairStatus: undefined,
      reviewNote: "Deleted in OneDrive",
      updatedAt: Date.now(),
    });
    await recomputePairGroup(ctx, existing.pairGroupKey);
    return null;
  },
});

export const getItem = internalQuery({
  args: { itemId: v.id("ingestionItems") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.itemId);
  },
});

/** Path B (crawler upload): attach stored bytes and hand off to extraction. */
export const attachUpload = internalMutation({
  args: { itemId: v.id("ingestionItems"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.status !== "discovered") return null;
    await ctx.db.patch(args.itemId, {
      storageId: args.storageId,
      status: "fetched",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.ingestionSync.extractUploadedItem,
      { itemId: args.itemId }
    );
    return null;
  },
});

export const takeUnprocessedItems = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, Math.floor(args.limit)), 50);
    return await ctx.db
      .query("ingestionItems")
      .withIndex("by_status", (q) => q.eq("status", "discovered"))
      .take(limit);
  },
});

export const markItemProcessed = internalMutation({
  args: {
    itemId: v.id("ingestionItems"),
    storageId: v.id("_storage"),
    text: v.optional(v.string()),
    textStorageId: v.optional(v.id("_storage")),
    extractNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    // Compare-and-set: never clobber a concurrent admin decision (e.g. a
    // reject that landed while this item's download was in flight).
    if (!item || (item.status !== "discovered" && item.status !== "fetched")) {
      return null;
    }
    await ctx.db.patch(args.itemId, {
      storageId: args.storageId,
      text: args.text,
      textStorageId: args.textStorageId,
      extractNote: args.extractNote,
      // No text (pdf/legacy .doc) still lands in review — the admin can see
      // the file exists and chase a readable copy; it just can't be approved.
      status: "pending_review",
      error: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markItemFailed = internalMutation({
  args: { itemId: v.id("ingestionItems"), error: v.string() },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || !LIVE_STATUSES.has(item.status) || item.status === "approved") {
      return null;
    }
    await ctx.db.patch(args.itemId, {
      status: "failed",
      pairStatus: undefined,
      error: args.error.slice(0, 500),
      updatedAt: Date.now(),
    });
    // Failure changes the group's live membership — a failed lone PD must
    // surface the transcript's missing_pd gap, and vice versa.
    await recomputePairGroup(ctx, item.pairGroupKey);
    return null;
  },
});

/** Recompute pairing for the given groups, one bounded mutation per call. */
export const recomputePairs = internalMutation({
  args: { groupKeys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const keys = [...new Set(args.groupKeys)].slice(0, 25);
    for (const key of keys) {
      await recomputePairGroup(ctx, key);
    }
    return null;
  },
});

export const updateSyncRun = internalMutation({
  args: {
    runId: v.id("oneDriveSyncRuns"),
    status: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
    error: v.optional(v.string()),
    addDiscovered: v.optional(v.number()),
    addProcessed: v.optional(v.number()),
    addSkipped: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    await ctx.db.patch(args.runId, {
      ...(args.status ? { status: args.status, completedAt: Date.now() } : {}),
      ...(args.error ? { error: args.error.slice(0, 500) } : {}),
      discovered: run.discovered + (args.addDiscovered ?? 0),
      processed: run.processed + (args.addProcessed ?? 0),
      skipped: run.skipped + (args.addSkipped ?? 0),
      lastProgressAt: Date.now(),
    });
    return null;
  },
});
