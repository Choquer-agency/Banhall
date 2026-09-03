import { query } from "./_generated/server";
import { v } from "convex/values";
import { getInternalProjectAccessOrNull } from "./lib/auth";
import {
  listProjectTranscripts,
  transcriptLabel,
  transcriptMetadata,
} from "./lib/transcripts";

export const getTranscript = query({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("transcripts"),
      _creationTime: v.number(),
      projectId: v.id("projects"),
      content: v.string(),
      createdAt: v.number(),
      label: v.optional(v.string()),
      position: v.optional(v.number()),
      contentHash: v.optional(v.string()),
    })
  ),
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;

    // The first transcript of the project's ordered set. Callers move to
    // listTranscripts / getTranscriptContent in transcripts-5.
    return (await listProjectTranscripts(ctx, args.projectId))[0] ?? null;
  },
});

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
