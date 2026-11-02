/**
 * Public background for drafting (2026-11-02, proposed): the cache, the
 * names a query is guarded against, and the record on the generation. The
 * step itself runs in the generation actions (convex/ai/draftWebBackgroundRun.ts).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { listProjectTranscripts } from "./lib/transcripts";
import { projectPlaceholderMap } from "./lib/transcriptPlaceholders";
import { webSearchKnownNames, type WebSearchIdentity } from "./ai/chatWebSearch";
import {
  draftWebBackgroundRecordValidator,
  draftWebResultValidator,
} from "./lib/draftWebBackgroundValidators";
import { DRAFT_WEB_BACKGROUND_VERSION } from "./ai/draftWebBackground";
import { isProjectDeleting } from "./lib/projectDeletion";

/** A cached set of searches for these sources, or null. */
export const getCachedBackground = internalQuery({
  args: { projectId: v.id("projects"), fingerprint: v.string() },
  returns: v.union(
    v.null(),
    v.object({ results: v.array(draftWebResultValidator), droppedQueries: v.number() })
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("draftWebBackgrounds")
      .withIndex("by_projectId_and_fingerprint", (q) =>
        q.eq("projectId", args.projectId).eq("fingerprint", args.fingerprint)
      )
      .order("desc")
      .first();
    if (!row || row.version !== DRAFT_WEB_BACKGROUND_VERSION) return null;
    return { results: row.results, droppedQueries: row.droppedQueries };
  },
});

/**
 * Saves searches that returned something, replacing an older row for the
 * same sources. A deleted or deleting project saves nothing.
 */
export const saveCachedBackground = internalMutation({
  args: {
    projectId: v.id("projects"),
    fingerprint: v.string(),
    results: v.array(draftWebResultValidator),
    droppedQueries: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || (await isProjectDeleting(ctx, args.projectId))) return null;
    const old = await ctx.db
      .query("draftWebBackgrounds")
      .withIndex("by_projectId_and_fingerprint", (q) =>
        q.eq("projectId", args.projectId).eq("fingerprint", args.fingerprint)
      )
      .take(10);
    for (const row of old) await ctx.db.delete(row._id);
    await ctx.db.insert("draftWebBackgrounds", {
      projectId: args.projectId,
      fingerprint: args.fingerprint,
      version: DRAFT_WEB_BACKGROUND_VERSION,
      results: args.results,
      droppedQueries: args.droppedQueries,
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * What the step needs from the database: the writer's choice for this
 * draft, and every name a query is guarded against. The guard reads the
 * project's full placeholder map (record names, transcript speakers, the
 * firm's names), as the chat web search does, plus the generation's own
 * frozen map (company names when company files were sent).
 */
export const webBackgroundContext = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (
    ctx,
    args
  ): Promise<{ requested: boolean; identity: WebSearchIdentity } | null> => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const project = await ctx.db.get(generation.projectId);
    if (!project || (await isProjectDeleting(ctx, project._id))) return null;
    const projectMap = await projectPlaceholderMap(ctx, project, await listProjectTranscripts(ctx, project._id));
    const placeholders = [...projectMap, ...(generation.placeholders ?? [])];
    return {
      // Only a draft started with the choice recorded looks anything up: a
      // generation from before public background (no field) sends exactly
      // the requests it always did.
      requested: generation.webBackgroundRequested === true,
      identity: { placeholders, knownNames: webSearchKnownNames(project, placeholders) },
    };
  },
});

/** Records what the step did, once per generation. */
export const recordWebBackground = internalMutation({
  args: { generationId: v.id("generations"), record: draftWebBackgroundRecordValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    await ctx.db.patch(args.generationId, { webBackground: args.record });
    return null;
  },
});

