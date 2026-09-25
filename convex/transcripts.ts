import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getInternalProjectAccessOrNull } from "./lib/auth";
import { isProjectDeleting } from "./lib/projectDeletion";
import { buildStructureStep } from "./lib/transcriptStructure";
import { TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import {
  listProjectTranscripts,
  transcriptLabel,
  transcriptMetadata,
} from "./lib/transcripts";

/**
 * Metadata for every transcript on a project, in order. Deliberately carries no
 * content: a project page subscribes to this list and pulls one body at a time
 * through `getTranscriptContent`.
 */
export const listTranscripts = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("transcripts"),
      label: v.string(),
      position: v.optional(v.number()),
      createdAt: v.number(),
      charCount: v.number(),
      wordCount: v.number(),
      contentHash: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];

    const transcripts = await listProjectTranscripts(ctx, args.projectId);
    return transcripts.map(transcriptMetadata);
  },
});

/** One transcript body. Silent `null` without access, same policy as above. */
export const getTranscriptContent = query({
  args: { transcriptId: v.id("transcripts") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("transcripts"),
      label: v.string(),
      content: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript) return null;
    if (!(await getInternalProjectAccessOrNull(ctx, transcript.projectId))) {
      return null;
    }

    return {
      _id: transcript._id,
      label: transcriptLabel(transcript),
      content: transcript.content,
    };
  },
});

// ─── Turns and speakers (2026-09-24, the transcript method) ────────────────

/**
 * Builds one transcript's turns and rule-based speaker roles from its stored
 * text, one bounded batch per run, rescheduling itself until done. No model
 * call. Idempotent: a transcript already at the current parser version is
 * left alone, and a replayed batch inserts only what is missing.
 */
export const buildTranscriptStructure = internalMutation({
  args: { transcriptId: v.id("transcripts"), fromIndex: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || (await isProjectDeleting(ctx, transcript.projectId))) return null;
    const step = await buildStructureStep(ctx, args.transcriptId, args.fromIndex ?? 0);
    if (step.kind === "continue") {
      await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
        transcriptId: args.transcriptId,
        fromIndex: step.fromIndex,
      });
    }
    return null;
  },
});

/** Transcripts one backfill page looks at. */
const BACKFILL_PAGE_SIZE = 20;

/**
 * Batched, self-rescheduling backfill of turns and heuristic speaker roles
 * for every transcript row written before the transcript method. Run once
 * from the dashboard (`transcripts:backfillTranscriptStructure` with `{}`);
 * safe to run again, since rows already at the current parser version are
 * skipped. Archived and empty rows are skipped too.
 */
export const backfillTranscriptStructure = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ scheduled: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("transcripts")
      .paginate({ cursor: args.cursor ?? null, numItems: BACKFILL_PAGE_SIZE });
    let scheduled = 0;
    for (const row of page.page) {
      if (row.parserVersion === TRANSCRIPT_PARSER_VERSION) continue;
      if (row.archivedAt !== undefined || row.content.trim() === "") continue;
      await ctx.scheduler.runAfter(0, internal.transcripts.buildTranscriptStructure, {
        transcriptId: row._id,
      });
      scheduled += 1;
    }
    if (!page.isDone) {
      // Spaced out so the builds of one page finish before the next starts.
      await ctx.scheduler.runAfter(2_000, internal.transcripts.backfillTranscriptStructure, {
        cursor: page.continueCursor,
      });
    }
    return { scheduled, isDone: page.isDone };
  },
});
