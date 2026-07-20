/**
 * Jul 17 meeting: in-app changelog. Writers who aren't in the sprint meetings
 * hit changed behavior with no context ("every time I try, it's not working").
 * Admins publish dated entries; every signed-in user can read them, and an
 * unseen-entries badge nudges non-early-adopters to look.
 */
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser, requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";

export const listEntries = query({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    return await ctx.db
      .query("changelogEntries")
      .withIndex("by_publishedAt")
      .order("desc")
      .take(100);
  },
});

/** Count of entries newer than the user's read watermark (for the nav badge). */
export const unseenCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const read = await ctx.db
      .query("changelogReads")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    const since = read?.lastSeenAt ?? 0;
    const entries = await ctx.db
      .query("changelogEntries")
      .withIndex("by_publishedAt", (q) => q.gt("publishedAt", since))
      .collect();
    return entries.length;
  },
});

export const markSeen = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    const now = Date.now();
    const read = await ctx.db
      .query("changelogReads")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
    if (read) {
      await ctx.db.patch(read._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert("changelogReads", { userId: user._id, lastSeenAt: now });
    }
  },
});

export const publishEntry = mutation({
  args: {
    title: v.string(),
    body: v.string(),
    kind: v.union(v.literal("feature"), v.literal("fix"), v.literal("mixed")),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    const title = args.title.trim();
    const body = args.body.trim();
    if (!title || !body) {
      domainError("INVALID_INPUT", "Title and body are required");
    }
    return await ctx.db.insert("changelogEntries", {
      title,
      body,
      kind: args.kind,
      publishedAt: Date.now(),
      createdBy: user._id,
    });
  },
});

export const deleteEntry = mutation({
  args: { id: v.id("changelogEntries") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const entry = await ctx.db.get(args.id);
    if (!entry) domainError("NOT_FOUND", "Changelog entry not found");
    await ctx.db.delete(args.id);
  },
});

/** Pipeline upsert: one auto entry per work day, keyed by workDay so re-runs
 *  replace instead of duplicating. Internal — called by changelogPipeline. */
export const upsertPipelineEntry = internalMutation({
  args: {
    workDay: v.string(),
    title: v.string(),
    body: v.string(),
    kind: v.union(v.literal("feature"), v.literal("fix"), v.literal("mixed")),
    publishedAt: v.number(),
    commitHashes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("changelogEntries")
      .withIndex("by_workDay", (q) => q.eq("workDay", args.workDay))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        body: args.body,
        kind: args.kind,
        publishedAt: args.publishedAt,
        commitHashes: args.commitHashes,
      });
      return existing._id;
    }
    return await ctx.db.insert("changelogEntries", {
      workDay: args.workDay,
      title: args.title,
      body: args.body,
      kind: args.kind,
      publishedAt: args.publishedAt,
      commitHashes: args.commitHashes,
    });
  },
});

/** Newest commit hash the pipeline has already covered — the publish script's
 *  watermark, so every commit is summarized exactly once. */
export const lastProcessedCommits = internalQuery({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db
      .query("changelogEntries")
      .withIndex("by_publishedAt")
      .order("desc")
      .take(30);
    return entries.flatMap((e) => e.commitHashes ?? []);
  },
});
