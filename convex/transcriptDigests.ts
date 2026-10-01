import { getConvexSize, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  transcriptDigestStructuredData,
  type TranscriptDigestStructuredData,
} from "./lib/sectionRunData";
import { domainError, sha256 } from "./lib/contracts";
import { isProjectDeleting } from "./lib/projectDeletion";
import {
  CONDENSE_VERSION,
  generationTranscriptIds,
  MAX_TRANSCRIPTS_PER_PROJECT,
} from "./lib/transcripts";
import {
  FACT_PACK_MAX_CHARS,
  FACTS_VERSION,
  isEvidenceRole,
  needsSpeakerCheck,
  packFactId,
  quoteTurnInfo,
} from "./lib/transcriptFacts";
import {
  factRunIsCurrent,
  findFactRun,
  FACT_RUN_STALE_MS,
  readyFactRun,
  renderTranscriptPack,
  transcriptHash,
} from "./lib/transcriptFactRows";

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
      .take(3 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
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
    if (await isProjectDeleting(ctx, args.projectId)) {
      domainError("INVALID_STATE", "Project is being deleted");
    }
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
      // Dual write (2026-09-25): the same windows typed, when they parse
      // strictly; readers take this first.
      ...structuredDataFor(args.structured),
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
    if (await isProjectDeleting(ctx, generation.projectId)) return null;
    const digest = await ctx.db.get(args.digestId);
    if (!digest) return null;
    const sources = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(3 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
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
      .take(3 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
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

// ─── Fact packs (2026-09-24, the transcript method) ────────────────────────

/** Bytes one frozen pack row may take, well under Convex's 1 MiB document limit. */
export const MAX_FACT_PACK_ROW_BYTES = 900_000;

/**
 * The frozen transcripts of a generation that reads fact packs, in frozen
 * order, with what each still needs: whether the row was frozen whole
 * (never cut), whether its pack is already frozen, whether facts for this
 * exact text are ready or being extracted elsewhere, and whether today's
 * digest of it is stored (so the fallback's own cost is known before any
 * extraction starts).
 */
export const getFactInputs = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const sources = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(3 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
    const now = Date.now();
    const transcripts = [];
    for (const transcriptId of generationTranscriptIds(generation) ?? []) {
      const source = sources.find((row) => row.kind === "transcript" && row.transcriptId === transcriptId);
      if (!source) continue;
      const transcript = await ctx.db.get(transcriptId);
      // The live row still holds the frozen text; facts index that text.
      const sameText = transcript !== null && (await transcriptHash(transcript)) === source.contentHash;
      const run = sameText ? await findFactRun(ctx, transcriptId, source.contentHash) : null;
      const digest = await ctx.db
        .query("transcriptDigests")
        .withIndex("by_transcriptId_and_sourceContentHash_and_condenseVersion", (q) =>
          q.eq("transcriptId", transcriptId).eq("sourceContentHash", source.contentHash).eq("condenseVersion", CONDENSE_VERSION)
        )
        .first();
      transcripts.push({
        transcriptId,
        label: source.label,
        truncated: source.truncated,
        chars: source.content.length,
        sameText,
        frozen: sources.some((row) => row.kind === "transcript_facts" && row.transcriptId === transcriptId),
        ready: run !== null && (await factRunIsCurrent(ctx, run)),
        busy:
          run !== null &&
          (run.status === "running" || run.status === "queued") &&
          now - run.startedAt < FACT_RUN_STALE_MS,
        digestStored: digest !== null,
      });
    }
    return {
      projectId: generation.projectId,
      transcriptFacts: generation.transcriptFacts === true,
      inputMode: generation.inputMode ?? ("full" as const),
      transcripts,
    };
  },
});

/**
 * Freezes one transcript's fact pack into the generation, next to its full
 * transcript row, with the evidence spans behind each fact id. Returns the
 * pack's length, or null when the transcript cannot carry facts here: cut
 * at freeze, text changed, or no ready facts. Idempotent.
 */
export const freezeFactsSource = internalMutation({
  args: { generationId: v.id("generations"), transcriptId: v.id("transcripts") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.transcriptFacts !== true) return null;
    if (await isProjectDeleting(ctx, generation.projectId)) return null;
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript) return null;
    const sources = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(3 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
    const transcriptSource = sources.find(
      (source) => source.kind === "transcript" && source.transcriptId === transcript._id
    );
    if (!transcriptSource || transcriptSource.truncated) return null;
    const existing = sources.find(
      (source) => source.kind === "transcript_facts" && source.transcriptId === transcript._id
    );
    if (existing) return existing.content.length;
    // The facts index the transcript's text; the frozen row must be that
    // exact text, or no span can be trusted on it.
    const run = await readyFactRun(ctx, transcript);
    if (!run || run.sourceContentHash !== transcriptSource.contentHash) return null;
    const order = generationTranscriptIds(generation) ?? [];
    const position = order.indexOf(transcript._id) + 1;
    if (position < 1) return null;
    const pack = await renderTranscriptPack(
      ctx,
      transcript,
      { position, label: transcriptSource.label },
      { maxChars: FACT_PACK_MAX_CHARS }
    );
    if (!pack) return null;
    const { roles, turnInfo } = pack;
    // Only the facts the pack shows (a pack past its character cap leaves
    // the lowest-ranked out): nothing may cite a fact no model ever saw, and
    // the row stays bounded (review 2026-09-25, P3-2).
    const shown = new Set([...pack.content.matchAll(/^\[(F\d{1,3}-\d{1,5})\] /gm)].map((match) => match[1]));
    const factSpans = pack.facts.filter((fact) => shown.has(packFactId(position, fact.key))).map((fact) => ({
      id: packFactId(position, fact.key),
      type: fact.type,
      quotes: fact.quotes.flatMap((quote) => {
        const info = quoteTurnInfo(fact, quote, turnInfo);
        const speakerLabel = info?.speakerLabel ?? fact.speakerLabel;
        const role = speakerLabel ? (roles.get(speakerLabel) ?? "unknown") : "unknown";
        // Decision 25: an interviewer's or other speaker's words are never
        // evidence, and the span must still be the verbatim excerpt on the
        // frozen row. A speaker with no role stays citable, flagged.
        if (!isEvidenceRole(role)) return [];
        if (transcriptSource.content.slice(quote.charStart, quote.charEnd) !== quote.exactExcerpt) return [];
        return [
          {
            charStart: quote.charStart,
            charEnd: quote.charEnd,
            ...(speakerLabel ? { speakerLabel } : {}),
            role,
            ...(info?.startMs !== undefined ? { startMs: info.startMs } : {}),
            ...(needsSpeakerCheck(role) ? { needsSpeakerCheck: true } : {}),
          },
        ];
      }),
    }));
    const row = {
      generationId: generation._id,
      projectId: generation.projectId,
      kind: "transcript_facts" as const,
      transcriptId: transcript._id,
      label: transcriptSource.label,
      content: pack.content,
      contentHash: await sha256(pack.content),
      truncated: false,
      originalLength: pack.content.length,
      capturedAt: Date.now(),
      factsVersion: FACTS_VERSION,
      factSpans,
    };
    // A document holds at most 1 MiB; a pack that would not fit (non-Latin
    // text near the character cap) is not frozen, and the draft reads the
    // transcripts the usual way.
    if (getConvexSize(row) > MAX_FACT_PACK_ROW_BYTES) return null;
    await ctx.db.insert("generationSources", row);
    return pack.content.length;
  },
});

/**
 * One live transcript's fact pack for a reader outside a generation (the
 * PD review; plan step 8), or null without ready, current facts. One query
 * per pack, so a large project never renders every pack in one transaction
 * (review 2026-09-25, P3-7).
 */
export const renderLiveFactPack = internalQuery({
  args: { transcriptId: v.id("transcripts"), position: v.number(), label: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript || transcript.archivedAt !== undefined) return null;
    const pack = await renderTranscriptPack(
      ctx,
      transcript,
      { position: args.position, label: args.label },
      { maxChars: FACT_PACK_MAX_CHARS }
    );
    return pack?.content ?? null;
  },
});

// ─── 2026-09-25 widen: typed structured digests ─────────────────────────────

function structuredDataFor(structured: string): {
  structuredData?: TranscriptDigestStructuredData;
} {
  const structuredData = transcriptDigestStructuredData(structured);
  return structuredData ? { structuredData } : {};
}

/** A digest's validated windows: the typed field first, else the parsed
 * string when it converts strictly, else null. */
export function readDigestStructured(
  digest: Pick<Doc<"transcriptDigests">, "structured" | "structuredData">
): TranscriptDigestStructuredData | null {
  return digest.structuredData ?? transcriptDigestStructuredData(digest.structured) ?? null;
}

const STRUCTURED_BACKFILL_PAGE_SIZE = 50;
/** Digest rows carry up to a few hundred KB each; one page stays well inside
 * the transaction read limit. */
const STRUCTURED_BACKFILL_MAX_BYTES_READ = 8 * 1024 * 1024;

/**
 * Batched, self-rescheduling backfill of `transcriptDigests.structuredData`
 * from the `structured` string. Idempotent: rows that already carry the typed
 * field, or whose string does not convert strictly, are left alone. Start it
 * once with `{}` (`npx convex run transcriptDigests:backfillStructuredData '{}'`);
 * `dryRun: true` reports one page without writing or scheduling.
 */
export const backfillStructuredData = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    patched: v.number(),
    unconvertible: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.min(
      Math.max(1, Math.floor(args.pageSize ?? STRUCTURED_BACKFILL_PAGE_SIZE)),
      STRUCTURED_BACKFILL_PAGE_SIZE
    );
    const page = await ctx.db.query("transcriptDigests").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
      maximumBytesRead: STRUCTURED_BACKFILL_MAX_BYTES_READ,
    });
    let patched = 0;
    let unconvertible = 0;
    for (const row of page.page) {
      if (row.structuredData !== undefined) continue;
      const structuredData = transcriptDigestStructuredData(row.structured);
      if (!structuredData) {
        unconvertible += 1;
        continue;
      }
      if (!args.dryRun) await ctx.db.patch(row._id, { structuredData });
      patched += 1;
    }
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, internal.transcriptDigests.backfillStructuredData, {
        cursor: page.continueCursor,
        ...(args.pageSize !== undefined ? { pageSize } : {}),
      });
    }
    return {
      scanned: page.page.length,
      patched,
      unconvertible,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
