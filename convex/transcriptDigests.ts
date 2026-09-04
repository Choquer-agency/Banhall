import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { sha256 } from "./lib/contracts";
import {
  CONDENSE_VERSION,
  generationTranscriptIds,
  MAX_TRANSCRIPTS_PER_PROJECT,
} from "./lib/transcripts";

/**
 * Stored digests of over-budget transcripts. Default runtime on purpose: the
 * `"use node"` condensation action in convex/ai/condense.ts calls these and
 * shares CONDENSE_VERSION with them through convex/lib/transcripts.ts, so the
 * key a digest is written under is the key it is looked up under.
 */

/**
 * The frozen transcript rows a generation still has to condense, with the
 * project and requester the provider call is attributed to. Read separately
 * from `getGenerationInput`, which in digest mode reports digest parts once
 * they exist and would hide the text that still needs condensing.
 */
export const getCondenseInputs = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const sources = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(2 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
    const byTranscriptId = new Map(
      sources
        .filter((source) => source.kind === "transcript" && source.transcriptId)
        .map((source) => [source.transcriptId, source])
    );
    // The frozen set decides the order, so digest part 1 is transcript 1 no
    // matter which condense call finishes first.
    const transcripts = (generationTranscriptIds(generation) ?? []).flatMap(
      (transcriptId) => {
        const source = byTranscriptId.get(transcriptId);
        return source
          ? [
              {
                transcriptId,
                sourceId: source._id,
                label: source.label,
                content: source.content,
                contentHash: source.contentHash,
              },
            ]
          : [];
      }
    );
    return { projectId: generation.projectId, transcripts };
  },
});

/**
 * The stored digest for exactly these bytes under the current contract, if
 * any. `CONDENSE_VERSION` is read here rather than passed in, so no caller can
 * read or write a digest under a version other than the one it is running.
 */
export const findDigest = internalQuery({
  args: {
    transcriptId: v.id("transcripts"),
    sourceContentHash: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transcriptDigests")
      .withIndex(
        "by_transcriptId_and_sourceContentHash_and_condenseVersion",
        (q) =>
          q
            .eq("transcriptId", args.transcriptId)
            .eq("sourceContentHash", args.sourceContentHash)
            .eq("condenseVersion", CONDENSE_VERSION)
      )
      .first();
  },
});

/**
 * Stores one digest, or returns the id of the one already stored under the
 * same key. Idempotent so a generation retried after a partial failure pays
 * only for the transcripts it has not condensed yet.
 */
export const recordDigest = internalMutation({
  args: {
    transcriptId: v.id("transcripts"),
    projectId: v.id("projects"),
    sourceContentHash: v.string(),
    content: v.string(),
    structured: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    originalLength: v.number(),
  },
  returns: v.id("transcriptDigests"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("transcriptDigests")
      .withIndex(
        "by_transcriptId_and_sourceContentHash_and_condenseVersion",
        (q) =>
          q
            .eq("transcriptId", args.transcriptId)
            .eq("sourceContentHash", args.sourceContentHash)
            .eq("condenseVersion", CONDENSE_VERSION)
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("transcriptDigests", {
      transcriptId: args.transcriptId,
      projectId: args.projectId,
      sourceContentHash: args.sourceContentHash,
      condenseVersion: CONDENSE_VERSION,
      content: args.content,
      structured: args.structured,
      model: args.model,
      promptVersion: args.promptVersion,
      charCount: args.content.length,
      originalLength: args.originalLength,
      createdAt: Date.now(),
    });
  },
});

/**
 * Freezes one digest into the generation as its own source row and records it
 * on the generation. The prompt never reads a digest live: every claim cites a
 * `generationSources` row, and `reports.createProvenance` byte-checks the
 * excerpt against the content stored here.
 *
 * Idempotent, and `digestIds` is rebuilt from the frozen rows in transcript
 * order rather than appended to, so a retry converges instead of accumulating.
 */
export const freezeDigestSource = internalMutation({
  args: {
    generationId: v.id("generations"),
    transcriptId: v.id("transcripts"),
    digestId: v.id("transcriptDigests"),
  },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const digest = await ctx.db.get(args.digestId);
    if (!digest) return null;
    const sources = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(2 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
    const transcriptSource = sources.find(
      (source) =>
        source.kind === "transcript" && source.transcriptId === args.transcriptId
    );
    if (!transcriptSource) return null;
    const already = sources.find(
      (source) =>
        source.kind === "transcript_digest" &&
        source.transcriptId === args.transcriptId
    );
    if (!already) {
      // A short transcript inside an over-budget set can condense to more text
      // than it started with. Feed the model the shorter of the two; the
      // structured digest stays on the digest row either way.
      const content =
        digest.content.length <= transcriptSource.content.length
          ? digest.content
          : transcriptSource.content;
      await ctx.db.insert("generationSources", {
        generationId: generation._id,
        projectId: generation.projectId,
        kind: "transcript_digest",
        transcriptId: args.transcriptId,
        digestId: args.digestId,
        label: transcriptSource.label,
        content,
        contentHash: await sha256(content),
        truncated: false,
        originalLength: digest.originalLength,
        capturedAt: Date.now(),
      });
    }
    const frozen = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(2 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
    const digestByTranscriptId = new Map(
      frozen
        .filter((source) => source.kind === "transcript_digest")
        .map((source) => [source.transcriptId, source.digestId])
    );
    const digestIds = (generationTranscriptIds(generation) ?? []).flatMap(
      (transcriptId) => {
        const digestId = digestByTranscriptId.get(transcriptId);
        return digestId ? [digestId] : [];
      }
    );
    await ctx.db.patch(generation._id, { digestIds });
    const frozenDigest = frozen.find(
      (source) =>
        source.kind === "transcript_digest" &&
        source.transcriptId === args.transcriptId
    );
    return frozenDigest ? frozenDigest.content.length : null;
  },
});
