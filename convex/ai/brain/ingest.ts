"use node";

import { scheduleUsage } from "../instrument";
import { clientForRole } from "../providers";
import type {
  GenerationClient,
  GenerationContentBlock,
  GenerationMessageParams,
} from "../openrouterCore";
import { defaultChunker } from "@convex-dev/rag";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import type { ActionCtx } from "../../_generated/server";
import {
  BRAIN_CHUNK_NOTES_VERSION,
  BRAIN_ENTRY_IMPORTANCE,
  BRAIN_INDEX_FIELDS,
  BRAIN_RAGS,
  entryIdIn,
  entryIsCurrent,
  vBrainIndexId,
} from "./rag";
import { BRAIN_SEARCH_INDEXES, type BrainIndexId } from "./embeddings";

/**
 * Off by default so a first bring-up ingest costs nothing; flip on for prod.
 * Read on each embed (2026-11-18 (fourth)), as `reembedBelowFullImportance`
 * reads it.
 */
const useContextual = () => process.env.BRAIN_CONTEXTUAL === "1";

/**
 * Anthropic Contextual Retrieval: prepend a short model-generated blurb that
 * situates each chunk inside its parent PD before embedding. The full document
 * is sent as a cached prefix, so the repeated cost is ~nil. Measured to cut
 * retrieval failures ~35–49% (more with a reranker).
 */
/**
 * The request, shared with the brain_context evaluation. Since 2026-11-17 a
 * note never names the company (Brain copies are read by every company):
 * the prompt no longer asks for it and says not to.
 */
export const CONTEXTUALIZE_MAX_TOKENS = 100;
export const CONTEXTUALIZE_SYSTEM_PROMPT =
  "You situate a chunk within its source document for retrieval. Reply with 1-2 sentences of context only, no preamble. Never name a company, a person, a product or a place: say \"the company\" instead.";

export function contextualizeMessages(fullDoc: string, chunk: string): GenerationMessageParams["messages"] {
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `<document>\n${fullDoc}\n</document>`,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: `<chunk>\n${chunk}\n</chunk>\nGive a short context situating this chunk within the document: which SR&ED section it is in and what it covers. Do not name the company or anyone in it. Context only.`,
        },
      ],
    },
  ];
}

async function contextualizeChunks(
  client: GenerationClient,
  model: string,
  fullDoc: string,
  chunks: string[]
): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunks) {
    try {
      const res = await client.messages.create({
        model,
        max_tokens: CONTEXTUALIZE_MAX_TOKENS,
        system: CONTEXTUALIZE_SYSTEM_PROMPT,
        messages: contextualizeMessages(fullDoc, chunk),
      });
      const ctx = res.content
        .filter((b): b is Extract<GenerationContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      out.push(ctx ? `${ctx}\n\n${chunk}` : chunk);
    } catch (err) {
      // Never fail ingestion on a contextualization hiccup — but log it: a
      // silent run of raw chunks would quietly lose the contextual-retrieval
      // quality gain with nothing in the dashboard to show why.
      console.warn("brain chunk contextualization failed; using raw chunk", err);
      out.push(chunk);
    }
  }
  return out;
}

/** Chunks read per page when an embed reuses another index's chunk notes. */
const REUSE_CHUNK_PAGE = 100;

/**
 * The chunk texts of an entry another index already holds, when they are
 * exactly what a new embed would make: the same raw chunks, in order, each
 * with or without its note. Returns null on any doubt (an entry not ready, a
 * chunk count or text that does not match), and the caller makes the notes
 * again. Reading chunks costs nothing at Voyage or Anthropic.
 */
export async function reusableNoteChunks(
  ctx: ActionCtx,
  index: BrainIndexId,
  entryId: string,
  rawChunks: string[]
): Promise<string[] | null> {
  const rag = BRAIN_RAGS[index];
  const entry = await rag.getEntry(ctx, { entryId: entryId as never });
  if (!entry || entry.status !== "ready") return null;
  const texts: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await rag.listChunks(ctx, {
      entryId: entryId as never,
      order: "asc",
      paginationOpts: { cursor, numItems: REUSE_CHUNK_PAGE },
    });
    for (const chunk of page.page) {
      if (chunk.state !== "ready") return null;
      texts.push(chunk.text);
    }
    if (texts.length > rawChunks.length) return null;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  if (texts.length !== rawChunks.length) return null;
  for (const [i, text] of texts.entries()) {
    const raw = rawChunks[i];
    if (text !== raw && !text.endsWith(`\n\n${raw}`)) return null;
  }
  return texts;
}

/**
 * The indexes one embed adds to, the serving index first: the written ones
 * (only those in `indexes` when given) whose entry for this source is not
 * current, so a retry after one index failed never pays the finished one
 * again. `force` adds to each of them even when current (the full requeue,
 * which unlearned the entry first).
 */
export function embedTargets(
  src: Parameters<typeof entryIsCurrent>[0],
  state: { serving: BrainIndexId; written: BrainIndexId[] },
  notesOn: boolean,
  options: { indexes?: BrainIndexId[]; force?: boolean } = {}
): BrainIndexId[] {
  const { indexes, force } = options;
  const targets = state.written
    .filter((index) => !indexes || indexes.includes(index))
    .filter((index) => force === true || !entryIsCurrent(src, index, notesOn));
  return targets.sort((a, b) => Number(b === state.serving) - Number(a === state.serving));
}

/**
 * Embed one approved brainSources row into the RAG (BNH-10). Scheduled by
 * `approveSource` / `importPdPair` — only ever runs on approved knowledge.
 * Same `key` re-ingest replaces the prior version; `contentHash` dedups.
 *
 * 2026-11-18 (fourth): there are two indexes (voyage3 and voyage4,
 * embeddings.ts). The chunks, with their notes when chunk notes are on, are
 * made once and added to each index in `embedTargets`; when another index
 * already holds this source's chunks with current notes, those are reused,
 * so Haiku is not paid again. Each add records its own entry id through
 * `ingestOnComplete`, and its tokens under its own model.
 */
export const embedSource = internalAction({
  args: {
    sourceId: v.id("brainSources"),
    indexes: v.optional(v.array(vBrainIndexId)),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const src = await ctx.runQuery(
      internal.brain.getBrainSourceForIngest,
      { sourceId: args.sourceId }
    );
    // Silent no-op, never a throw: `getBrainSourceForIngest` returns null for a
    // missing row AND for any non-approved (revoked/pending) one, and the
    // `embedPool` retries thrown actions up to 6 times — a throw here would
    // retry an embed against a source that must never be embedded.
    if (!src) return;

    const notesOn = useContextual();
    const targets = embedTargets(src, src.indexState, notesOn, { indexes: args.indexes, force: args.force });
    if (targets.length === 0) return;

    // 2026-11-17: the same importance for every entry, so the search's
    // relevance floor reads raw similarity; the writer tier ranks results
    // after the floor (retrieve.ts) and stays in metadata.
    const importance = BRAIN_ENTRY_IMPORTANCE;

    // Every declared filterName gets a value on every add. Science code stays
    // in metadata so adding it does not strand legacy entries in a new RAG
    // namespace; retrieval applies the exact-code preference structurally.
    const filterValues: { name: "industryApproved" | "docType"; value: unknown }[] = [
      { name: "industryApproved", value: { industry: src.industry, approved: true } },
      { name: "docType", value: src.docType },
    ];

    // With chunk notes, the notes' prompt version is part of the entry: it
    // is recorded on the source, and a new version changes the content hash
    // so the RAG component replaces the entry instead of keeping old notes.
    const notesVersion = notesOn ? BRAIN_CHUNK_NOTES_VERSION : undefined;
    const common = {
      key: src.ragKey,
      title: src.title,
      importance,
      contentHash: notesVersion ? `${src.sourceHash}:notes${notesVersion}` : src.sourceHash,
      metadata: {
        ...(notesVersion ? { chunkNotesVersion: notesVersion } : {}),
        sourceId: args.sourceId,
        industry: src.industry,
        writerName: src.writerName,
        writerTier: src.writerTier,
        docType: src.docType,
        fiscalYear: src.fiscalYear,
        craOutcome: src.craOutcome,
        scienceCode: src.scienceCode,
      },
      filterValues: filterValues as never,
      onComplete: internal.ai.brain.rag.ingestOnComplete,
    };

    let chunks: string[] | undefined;
    if (notesOn) {
      const rawChunks = defaultChunker(src.content);
      // Notes this prompt version already made for another index.
      for (const other of src.indexState.written) {
        if (chunks || targets.includes(other)) continue;
        const entryId = entryIdIn(src, other);
        if (!entryId || src[BRAIN_INDEX_FIELDS[other].notesVersion] !== BRAIN_CHUNK_NOTES_VERSION) continue;
        chunks = (await reusableNoteChunks(ctx, other, entryId, rawChunks)) ?? undefined;
      }
      if (!chunks) {
        // Model catalog: the brain_context role's model.
        const { client, model } = await clientForRole(ctx, "brain_context", {
          callSite: "brain:contextualize",
          brainSourceId: args.sourceId,
        });
        chunks = await contextualizeChunks(client, model, src.content, rawChunks);
      }
    }

    for (const index of targets) {
      const namespace = BRAIN_SEARCH_INDEXES[index].namespace;
      const rag = BRAIN_RAGS[index];
      const addResult = chunks
        ? await rag.add(ctx, { ...common, namespace, chunks })
        : await rag.add(ctx, { ...common, namespace, text: src.content });
      if (addResult.usage.tokens > 0) {
        await scheduleUsage(ctx, {
          brainSourceId: args.sourceId,
          callSite: "brain:corpus_embedding",
          model: BRAIN_SEARCH_INDEXES[index].embeddingModelId,
          inputTokens: addResult.usage.tokens,
          outputTokens: 0,
        });
      }
      if (!addResult.created && addResult.status === "ready") {
        // The component kept the entry it had and calls no completion.
        await ctx.runMutation(internal.ai.brain.rag.recordReadyEntry, {
          sourceId: args.sourceId,
          index,
          entryId: addResult.entryId,
          importance,
          ...(notesVersion ? { notesVersion } : {}),
        });
      }
    }
  },
});
