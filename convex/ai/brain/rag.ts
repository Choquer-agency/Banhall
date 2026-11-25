import { RAG } from "@convex-dev/rag";
import { v } from "convex/values";
import { components, internal } from "../../_generated/api";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../../_generated/server";
import {
  BRAIN_DEFAULT_SERVING_INDEX,
  BRAIN_EMBEDDING_DIMENSION,
  BRAIN_EMBEDDING_MODELS,
  BRAIN_INDEX_IDS,
  BRAIN_SEARCH_EMBEDDING_MODELS,
  BRAIN_SEARCH_INDEXES,
  brainIndexForNamespace,
  type BrainIndexId,
} from "./embeddings";

/**
 * The Brain's retrieval engine (BNH-10).
 *
 * The RAG component owns ONLY the vector index + chunks, and it only ever holds
 * APPROVED knowledge — approve = ingest, revoke = confirmed erasure via
 * `unlearnSource` (see convex/brain.ts and ./erase.ts).
 * All governance (approval, weighting, unlearn, audit) lives in our own reactive
 * tables. Killer requirements map to native features:
 *   - industry routing    → optional `industryApproved` filter (see BRAIN_NAMESPACE)
 *   - science routing     → metadata grouping with cross-code fallback
 *   - writer weighting    → our own blend after the relevance floor
 *                           (retrieve.ts); every entry's `importance` is
 *                           BRAIN_ENTRY_IMPORTANCE (2026-11-17)
 *   - provenance          → `entryId` (foreign-keyed back to brainSources)
 *   - unlearn             → confirmed `delete` + `getEntry` re-read (./erase.ts)
 *
 * Convex vector filtering is equality/OR only, so `industryApproved` is a
 * COMPOSITE value ({ industry, approved }) letting us AND the two in one filter.
 */
/**
 * ONE global namespace: a good PD is a good PD — structure/voice/CRA phrasing
 * transfer across industries, so retrieval must work with no industry set.
 * Industry scoping is an optional FILTER (industryApproved), not a namespace.
 * (CRA rejection letters will still get their own separate namespace — they're
 * negative signal, never mixed into exemplar retrieval.)
 */
export const BRAIN_NAMESPACE = BRAIN_SEARCH_INDEXES.voyage3.namespace;
export const BRAIN_FILTER_NAMES = ["industryApproved", "docType"] as const;

/**
 * Every entry's RAG `importance` (2026-11-17). The component multiplies a
 * vector score by importance before the relevance floor
 * (`vectorScoreThreshold`), so a tier-0.4 entry needed a cosine of 0.75 to
 * pass a 0.3 floor and imported PDs by most writers were near invisible.
 * With importance 1 the floor reads raw similarity; the writer tier is a
 * ranking weight applied after it (`blendWriterTier`, retrieve.ts).
 */
export const BRAIN_ENTRY_IMPORTANCE = 1;

/**
 * The chunk note prompt's version (`contextualizeMessages`, ingest.ts).
 * 1: the prompt asked for the company. 2 (2026-11-17): it never names it.
 * Recorded on each source whose embed had notes; the deploy re-embed
 * renews older notes when chunk notes are on.
 */
export const BRAIN_CHUNK_NOTES_VERSION = 2;

/**
 * Voyage 4 embedding prompt version (2026-11-21).
 * Unrecorded (pre-asymmetric) v4 entries lack this version so buildSearchIndex
 * rebuilds them with input_type "document" and cutover refuses mixed spaces.
 */
export const BRAIN_V4_EMBEDDING_VERSION = 2;
// NOTE: rag requires a value for EVERY declared filterName on every add, so we
// only declare filters we set on 100% of entries. `craOutcome` is intentionally
// NOT a filter (CRA rejections live in their own namespace); it's kept in
// metadata for display/provenance.
export type BrainFilters = {
  industryApproved: { industry: string; approved: boolean };
  docType: string;
};

export type BrainEntryMetadata = {
  sourceId: string;
  industry: string;
  writerName?: string;
  writerTier: number;
  docType: string;
  fiscalYear?: number;
  craOutcome?: string;
  scienceCode?: string;
  /** BRAIN_CHUNK_NOTES_VERSION when the chunks carry notes (2026-11-17). */
  chunkNotesVersion?: number;
  /** BRAIN_V4_EMBEDDING_VERSION on voyage4 entries embedded with asymmetric input_type. */
  embeddingVersion?: number;
};

/** The voyage3 index (voyage-3-large, namespace "brain"), the one from before 2026-11-18. */
export const brain = new RAG<BrainFilters, BrainEntryMetadata>(components.rag, {
  textEmbeddingModel: BRAIN_EMBEDDING_MODELS.voyage3,
  embeddingDimension: BRAIN_EMBEDDING_DIMENSION,
  // Max 16 filter fields per vector index — we use 2 (both set on every entry).
  filterNames: [...BRAIN_FILTER_NAMES],
});

/**
 * The voyage4 index (2026-11-18 (fourth)): voyage-4-large at 1024, its own
 * namespace name ("brain-v4"), the same filters. Same component, so an entry
 * of either index is read and deleted by its id alone (erase.ts).
 */
export const brainV4 = new RAG<BrainFilters, BrainEntryMetadata>(components.rag, {
  textEmbeddingModel: BRAIN_EMBEDDING_MODELS.voyage4,
  embeddingDimension: BRAIN_EMBEDDING_DIMENSION,
  filterNames: [...BRAIN_FILTER_NAMES],
});

/** Each index's ingest RAG instance (voyage4 uses input_type "document"). */
export const BRAIN_RAGS: Record<BrainIndexId, RAG<BrainFilters, BrainEntryMetadata>> = {
  voyage3: brain,
  voyage4: brainV4,
};

/** The voyage4 search instance (same namespace, input_type "query"). */
export const brainSearchV4 = new RAG<BrainFilters, BrainEntryMetadata>(components.rag, {
  textEmbeddingModel: BRAIN_SEARCH_EMBEDDING_MODELS.voyage4,
  embeddingDimension: BRAIN_EMBEDDING_DIMENSION,
  filterNames: [...BRAIN_FILTER_NAMES],
});

/** Each index's search RAG instance (voyage4 uses input_type "query"). */
export const BRAIN_SEARCH_RAGS: Record<BrainIndexId, RAG<BrainFilters, BrainEntryMetadata>> = {
  voyage3: brain,
  voyage4: brainSearchV4,
};

export const vBrainIndexId = v.union(v.literal("voyage3"), v.literal("voyage4"));

/**
 * The source fields that hold each index's entry (2026-11-18 (fourth)). A
 * source may have an entry in each index, so each has its own id: revoke and
 * unlearn erase every id the row holds. voyage3 keeps the original fields.
 */
export const BRAIN_INDEX_FIELDS = {
  voyage3: { entryId: "ragEntryId", notesVersion: "chunkNotesVersion" },
  voyage4: { entryId: "ragEntryIdV4", notesVersion: "chunkNotesVersionV4" },
} as const satisfies Record<BrainIndexId, { entryId: keyof Doc<"brainSources">; notesVersion: keyof Doc<"brainSources"> }>;

type IndexFieldsRow = Pick<
  Doc<"brainSources">,
  "ragEntryId" | "ragEntryIdV4" | "chunkNotesVersion" | "chunkNotesVersionV4" | "embeddingVersionV4"
>;

/** The entry id a source holds in one index. */
export function entryIdIn(source: IndexFieldsRow, index: BrainIndexId): string | undefined {
  return source[BRAIN_INDEX_FIELDS[index].entryId];
}

/** Every (index, entry id) pair the row holds, voyage3 first. */
export function heldEntries(source: IndexFieldsRow): { index: BrainIndexId; entryId: string }[] {
  const out: { index: BrainIndexId; entryId: string }[] = [];
  for (const index of BRAIN_INDEX_IDS) {
    const entryId = entryIdIn(source, index);
    if (entryId) out.push({ index, entryId });
  }
  return out;
}

/**
 * Whether a source's voyage3 vectors may not be at importance 1 (2026-11-17).
 * Every embed since then records the importance its entry was made with
 * (`ragImportance`, from the entry itself on completion). A row with none
 * recorded was embedded before that, at its tier as it stood then, which the
 * current tier does not tell: a reweight changes the tier before an embed
 * reads it. So no recorded importance is unknown, and needs the refresh
 * (PR #51 review, Greptile). It describes the voyage3 index only: every
 * voyage4 entry is made by this code at importance 1.
 */
export function needsFullImportanceEmbed(source: Pick<Doc<"brainSources">, "ragImportance">): boolean {
  return source.ragImportance === undefined || source.ragImportance < 1;
}

/**
 * Whether the source's entry in an index is current, so an embed may pass
 * that index over without paying Voyage again (`add` embeds before the
 * component can tell the entry is unchanged). Current: it has an entry, at
 * importance 1 (voyage3 only can be older), at BRAIN_V4_EMBEDDING_VERSION
 * (voyage4 asymmetric input_type), and with notes from this prompt version
 * when chunk notes are on.
 */
export function entryIsCurrent(
  source: IndexFieldsRow & Pick<Doc<"brainSources">, "ragImportance" | "writerTier">,
  index: BrainIndexId,
  notesOn: boolean
): boolean {
  if (!entryIdIn(source, index)) return false;
  if (index === "voyage3" && needsFullImportanceEmbed(source)) return false;
  if (index === "voyage4" && source.embeddingVersionV4 !== BRAIN_V4_EMBEDDING_VERSION) return false;
  return !notesOn || source[BRAIN_INDEX_FIELDS[index].notesVersion] === BRAIN_CHUNK_NOTES_VERSION;
}

/**
 * Which index search reads, and which indexes embeds write (2026-11-18
 * (fourth)). One row, key "search", in `brainSearchIndexState`; none means
 * voyage3 serves. voyage4 is always written; voyage3 is written until
 * `brain:dropOldSearchIndex` starts.
 */
export type BrainIndexState = {
  serving: BrainIndexId;
  written: BrainIndexId[];
  row: Doc<"brainSearchIndexState"> | null;
};

export async function readBrainIndexState(ctx: QueryCtx | MutationCtx): Promise<BrainIndexState> {
  const row = await ctx.db
    .query("brainSearchIndexState")
    .withIndex("by_key", (q) => q.eq("key", "search"))
    .unique();
  const serving = row?.serving ?? BRAIN_DEFAULT_SERVING_INDEX;
  const written: BrainIndexId[] = row?.oldIndexDropped ? ["voyage4"] : ["voyage3", "voyage4"];
  return { serving, written, row };
}

/** What a finished embed records on its source for one index. */
function entryPatch(
  index: BrainIndexId,
  entryId: string,
  importance: number,
  notesVersion: number | undefined,
  embeddingVersion: number | undefined
): Partial<Doc<"brainSources">> {
  return index === "voyage3"
    ? { ragEntryId: entryId, ragImportance: importance, chunkNotesVersion: notesVersion }
    : { ragEntryIdV4: entryId, chunkNotesVersionV4: notesVersion, embeddingVersionV4: embeddingVersion };
}

/**
 * Where a ready entry goes once its add finished (the completion below, and
 * `recordReadyEntry` for an add the component found unchanged). The source
 * must still be approved and the index still written; otherwise the entry
 * is erased through the confirmed-erasure path and nothing is recorded.
 * Returns whether the entry was recorded.
 */
async function bookReadyEntry(
  ctx: MutationCtx,
  source: Doc<"brainSources">,
  index: BrainIndexId,
  entry: {
    entryId: string;
    importance: number;
    notesVersion: number | undefined;
    embeddingVersion: number | undefined;
  }
): Promise<boolean> {
  // Close the revoke-during-embed race. The completion callback and the
  // governance mutation serialize through Convex transactions: if revoke
  // committed first, this removes the late vector instead of restoring it;
  // if completion committed first, revoke observes the entry id and removes it.
  if (source.status !== "approved") {
    // Compensation is the SAME confirmed-erasure path as revoke-time unlearn
    // (this is a mutation, so it cannot confirm anything inline). Never patch
    // an entry id here: a non-approved source must not gain one except as
    // failure evidence, which the action writes if erasure fails.
    await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
      ragEntryId: entry.entryId,
      sourceId: source._id,
      index,
    });
    await ctx.db.insert("brainAuditLog", {
      action: "ingest",
      sourceId: source._id,
      actorId: "system",
      reason:
        "Discarded completed embedding because the source is no longer approved",
      at: Date.now(),
    });
    return false;
  }
  const state = await readBrainIndexState(ctx);
  if (!state.written.includes(index)) {
    // An embed that started before the old index's drop: its entry goes too.
    await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
      ragEntryId: entry.entryId,
      sourceId: source._id,
      index,
      droppedIndex: true,
    });
    return false;
  }
  await patchBrainSource(
    ctx,
    source,
    entryPatch(index, entry.entryId, entry.importance, entry.notesVersion, entry.embeddingVersion)
  );
  return true;
}

/**
 * Commits in the same transaction that marks a new entry "ready". Records the
 * component's entryId back on the brainSources row (provenance), in the
 * field of the index whose namespace the entry is in, and logs the ingestion
 * outcome. Never auto-applies anything: the source was already
 * admin-approved before ingest was scheduled. Both RAG instances use it.
 *
 * (Replaced-entry garbage collection on re-ingest is a Phase-3 cron, not P0.)
 */
export const ingestOnComplete = brain.defineOnComplete<DataModel>(
  async (ctx, { namespace, entry, replacedEntry, error }) => {
    if (!entry.key) return; // we always add with a key; narrows string|undefined
    const index = brainIndexForNamespace(namespace.namespace);
    if (!index) {
      // Review 51 (P3-7): a namespace this handler does not know (a future
      // one reusing it, say) is never booked into a Brain index's field.
      console.warn(`ingestOnComplete: namespace ${namespace.namespace} is not a Brain search index; nothing recorded`);
      return;
    }
    const source = await ctx.db
      .query("brainSources")
      .withIndex("by_ragKey", (q) => q.eq("ragKey", entry.key!))
      .first();
    if (!source) {
      // Orphan: no governance row owns this entry. Route it through the
      // confirmed-erasure action — `deleteAsync` is workpool-backed and returns
      // before the entry is gone, so it can never confirm anything. No
      // `sourceId`: there is no row to book against.
      if (!error) {
        await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
          ragEntryId: entry.entryId,
          index,
        });
      }
      return;
    }

    const where = index === "voyage3" ? "" : ` (${BRAIN_SEARCH_INDEXES[index].embeddingModelId} index)`;
    if (error) {
      await ctx.db.insert("brainAuditLog", {
        action: "ingest",
        sourceId: source._id,
        actorId: "system",
        reason: `Ingestion failed${where}: ${error}`,
        at: Date.now(),
      });
      return;
    }

    const meta = entry.metadata as BrainEntryMetadata | undefined;
    const notesVersion = meta?.chunkNotesVersion;
    const embeddingVersion = meta?.embeddingVersion;
    const recorded = await bookReadyEntry(ctx, source, index, {
      entryId: entry.entryId,
      importance: entry.importance,
      notesVersion: typeof notesVersion === "number" ? notesVersion : undefined,
      embeddingVersion: typeof embeddingVersion === "number" ? embeddingVersion : undefined,
    });
    if (!recorded) return;
    await ctx.db.insert("brainAuditLog", {
      action: "ingest",
      sourceId: source._id,
      actorId: "system",
      reason: replacedEntry
        ? `Re-ingested (replaced prior version)${where}`
        : `Ingested${where}`,
      at: Date.now(),
    });
  },
);

/**
 * An add the component found unchanged (same key, content hash, importance
 * and filters) returns the existing ready entry and calls no completion
 * (`entries.add`, @convex-dev/rag 0.7.5). The embed action reports it here so
 * the source still records that entry; without it the build chain would
 * queue the source again on every run. Same rules as a completion.
 */
export const recordReadyEntry = internalMutation({
  args: {
    sourceId: v.id("brainSources"),
    index: vBrainIndexId,
    entryId: v.string(),
    importance: v.number(),
    notesVersion: v.optional(v.number()),
    embeddingVersion: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.sourceId);
    if (!source) {
      await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, { ragEntryId: args.entryId, index: args.index });
      return null;
    }
    if (
      entryIdIn(source, args.index) === args.entryId &&
      (args.index !== "voyage4" || source.embeddingVersionV4 === args.embeddingVersion) &&
      source.status === "approved"
    ) {
      return null;
    }
    await bookReadyEntry(ctx, source, args.index, {
      entryId: args.entryId,
      importance: args.importance,
      notesVersion: args.notesVersion,
      embeddingVersion: args.embeddingVersion,
    });
    return null;
  },
});

// ─── Writing brainSources (2026-11-17, Brain reads at volume) ───────────────
// Every insert, patch and delete of a `brainSources` row goes through these
// three helpers, so its list card (`brainSourceCards`) and the stored counts
// (`brainSourceCounts`) change in the same transaction. The admin list and
// `brainStats` read only those two tables and never a source's text.
// They live here, not in convex/brain.ts, because `ingestOnComplete` above
// patches `ragEntryId` and this module must not import brain.ts (it is also
// bundled into the Node embed action).

type BrainSourceFields = Omit<Doc<"brainSources">, "_id" | "_creationTime">;
type BrainSourcePatch = Partial<BrainSourceFields>;
type CardFields = Omit<Doc<"brainSourceCards">, "_id" | "_creationTime">;
export type CountKey = { scope: "status" | "industry"; key: string };

function cardFields(source: Doc<"brainSources">): CardFields {
  return {
    sourceId: source._id,
    kind: source.kind,
    status: source.status,
    title: source.title,
    industry: source.industry,
    scienceCode: source.scienceCode,
    writerName: source.writerName,
    writerTier: source.writerTier,
    docType: source.docType,
    craOutcome: source.craOutcome,
    ragEntryId: source.ragEntryId,
    createdAt: source.createdAt,
    importItemId: source.importItemId,
    ragImportance: source.ragImportance,
    chunkNotesVersion: source.chunkNotesVersion,
    ragEntryIdV4: source.ragEntryIdV4,
    chunkNotesVersionV4: source.chunkNotesVersionV4,
    embeddingVersionV4: source.embeddingVersionV4,
  };
}

/** What one source adds to the counts: its status, and its industry while approved. */
export function countKeys(card: Pick<CardFields, "status" | "industry"> | null): CountKey[] {
  if (!card) return [];
  const keys: CountKey[] = [{ scope: "status", key: card.status }];
  if (card.status === "approved") keys.push({ scope: "industry", key: card.industry });
  return keys;
}

async function bumpCount(ctx: MutationCtx, { scope, key }: CountKey, delta: number) {
  const row = await ctx.db
    .query("brainSourceCounts")
    .withIndex("by_scope_and_key", (q) => q.eq("scope", scope).eq("key", key))
    .unique();
  if (!row) {
    if (delta > 0) await ctx.db.insert("brainSourceCounts", { scope, key, count: delta });
    // The counts have drifted from the cards; brain:recountBrainSourceCounts repairs them.
    else console.warn(`brainSourceCounts: no ${scope}:${key} row to take ${-delta} from; run brain:recountBrainSourceCounts`);
    return;
  }
  if (row.count + delta < 0) {
    console.warn(`brainSourceCounts: ${scope}:${key} would go below 0 (${row.count} ${delta}); run brain:recountBrainSourceCounts`);
  }
  const count = Math.max(0, row.count + delta);
  if (count === 0) await ctx.db.delete(row._id);
  else await ctx.db.patch(row._id, { count });
}

function sameCard(a: CardFields, b: Doc<"brainSourceCards">): boolean {
  return (Object.keys(a) as (keyof CardFields)[]).every((k) => a[k] === b[k]);
}

/**
 * Brings a source's card and the counts in step with the source as it now
 * is (`null`: the source is gone). Idempotent: a card that already matches
 * changes nothing, so the backfill may run over rows written since deploy.
 */
export async function syncBrainSourceCard(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">,
  source: Doc<"brainSources"> | null
): Promise<void> {
  const card = await ctx.db
    .query("brainSourceCards")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
    .unique();
  const next = source ? cardFields(source) : null;
  const before = countKeys(card);
  const after = countKeys(next);
  const id = (k: CountKey) => `${k.scope}:${k.key}`;
  for (const k of before) if (!after.some((a) => id(a) === id(k))) await bumpCount(ctx, k, -1);
  for (const k of after) if (!before.some((b) => id(b) === id(k))) await bumpCount(ctx, k, 1);
  if (!next) {
    if (card) await ctx.db.delete(card._id);
  } else if (!card) {
    await ctx.db.insert("brainSourceCards", next);
  } else if (!sameCard(next, card)) {
    await ctx.db.replace(card._id, next);
  }
  if (changesPointerCheck(card, next)) await restartMoveCheck(ctx);
}

/**
 * The card fields the pointer's live check reads (`entryIsCurrent` over
 * approved cards): whether the card is approved, and each index's entry
 * id, note version, (voyage3) importance, and (voyage4) embedding version.
 */
const POINTER_CHECK_FIELDS = [
  "status",
  "ragEntryId",
  "ragImportance",
  "chunkNotesVersion",
  "ragEntryIdV4",
  "chunkNotesVersionV4",
  "embeddingVersionV4",
] as const satisfies readonly (keyof CardFields)[];

/** Whether a card write can change what a saved pointer check already read. */
function changesPointerCheck(before: CardFields | null, after: CardFields | null): boolean {
  if (!before && !after) return false;
  if (!before || !after) return (before ?? after)!.status === "approved";
  if (before.status !== "approved" && after.status !== "approved") return false;
  return POINTER_CHECK_FIELDS.some((field) => before[field] !== after[field]);
}

/**
 * Greptile on #51 (P1): a pointer check longer than one call keeps its
 * place (`moveCheck`) and does not read the cards before it again. Every
 * card write goes through syncBrainSourceCard, so a write that changes what
 * the check reads (an entry erased, replaced or renewed, a note version or
 * importance, a source approved or no longer approved) clears the saved
 * place here, and the next call checks every card again from the first.
 * One indexed read of the pointer row, only on such a write.
 */
async function restartMoveCheck(ctx: MutationCtx): Promise<void> {
  const { row } = await readBrainIndexState(ctx);
  if (row?.moveCheck) await ctx.db.patch(row._id, { moveCheck: undefined });
}

/** Insert a source with its card and counts. */
export async function insertBrainSource(
  ctx: MutationCtx,
  fields: BrainSourceFields
): Promise<Id<"brainSources">> {
  const sourceId = await ctx.db.insert("brainSources", fields);
  await syncBrainSourceCard(ctx, sourceId, { _id: sourceId, _creationTime: Date.now(), ...fields });
  return sourceId;
}

/**
 * Patch a source read in this transaction (`before`), with its card and
 * counts. Returns the row as patched, without reading its text again.
 */
export async function patchBrainSource(
  ctx: MutationCtx,
  before: Doc<"brainSources">,
  patch: BrainSourcePatch
): Promise<Doc<"brainSources">> {
  await ctx.db.patch(before._id, patch);
  const after = { ...before, ...patch } as Doc<"brainSources">;
  // A patch to `undefined` removes the field, as `ctx.db.patch` does.
  for (const [k, value] of Object.entries(patch)) {
    if (value === undefined) delete (after as Record<string, unknown>)[k];
  }
  await syncBrainSourceCard(ctx, before._id, after);
  return after;
}

/** Delete a source with its card and its import file links, taking it out of the counts. */
/** Import file links one cleanup step deletes. */
const IMPORT_LINK_PAGE = 200;

/**
 * Delete one page of a removed source's import file links. Returns true when
 * more may remain, so the caller schedules the next page
 * (brain:deleteBrainSourceImportLinks) instead of draining them all in one
 * mutation.
 */
export async function deleteSourceImportLinksPage(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">
): Promise<boolean> {
  const links = await ctx.db
    .query("brainSourceImportFiles")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
    .take(IMPORT_LINK_PAGE);
  for (const link of links) await ctx.db.delete("brainSourceImportFiles", link._id);
  return links.length === IMPORT_LINK_PAGE;
}

export async function deleteBrainSource(ctx: MutationCtx, sourceId: Id<"brainSources">) {
  const more = await deleteSourceImportLinksPage(ctx, sourceId);
  // Chunk notes an unfinished embed kept (one row per note version, so few).
  await deleteKeptChunkNotes(ctx, sourceId);
  // The old-page job's rows for this copy (a copy is recorded once, so few).
  for (const row of await ctx.db
    .query("brainOldPageCopies")
    .withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId))
    .take(20)) {
    await ctx.db.delete(row._id);
  }
  await ctx.db.delete(sourceId);
  await syncBrainSourceCard(ctx, sourceId, null);
  // Links left over point at a source that no longer exists; lookups skip
  // them (sourcesForImportFile) until the scheduled pages remove them.
  if (more) await ctx.scheduler.runAfter(0, internal.brain.deleteBrainSourceImportLinks, { sourceId });
}

/**
 * Remember that an import file (by its `ingestionItems.contentHash`) is
 * linked to a source, so dedup finds the source by those bytes later. A
 * file whose bytes are already linked to this source adds nothing.
 */
export async function linkBrainSourceImportFile(
  ctx: MutationCtx,
  sourceId: Id<"brainSources">,
  importItem: { itemId: Id<"ingestionItems">; contentHash: string }
): Promise<void> {
  const known = await ctx.db
    .query("brainSourceImportFiles")
    .withIndex("by_contentHash_and_sourceId", (q) =>
      q.eq("contentHash", importItem.contentHash).eq("sourceId", sourceId)
    )
    .unique();
  if (known) return;
  await ctx.db.insert("brainSourceImportFiles", {
    contentHash: importItem.contentHash,
    sourceId,
    importItemId: importItem.itemId,
  });
}

/**
 * Whether a revoked source was revoked by Send back to review on Import
 * (2026-11-17): it undid an approval, not a judgment of the PD, so the
 * Import's Brain check may make a new copy of that PD after its next
 * approval (brain.ts `importSource` with `supersedeSentBack`).
 */
export function revokedBySendBack(source: Pick<Doc<"brainSources">, "status" | "sentBackItemId">): boolean {
  return source.status === "revoked" && source.sentBackItemId !== undefined;
}

/** The most link rows read for one import file hash (a few sources at most). */
const IMPORT_HASH_LINKS = 50;

/**
 * The live sources an import file's bytes are linked to, oldest first. A
 * hash belongs to one live source, besides the sources Send back to review
 * revoked (2026-11-17), each of which a later Brain check may follow with a
 * new copy of the same PD. Links of a source removed for good may still be
 * waiting for their scheduled cleanup, so they are skipped; two live
 * sources for one hash that Send back did not revoke is broken data and
 * fails loudly.
 */
export async function sourcesForImportFile(
  ctx: MutationCtx,
  contentHash: string
): Promise<Doc<"brainSources">[]> {
  const links = await ctx.db
    .query("brainSourceImportFiles")
    .withIndex("by_contentHash_and_sourceId", (q) => q.eq("contentHash", contentHash))
    .take(IMPORT_HASH_LINKS);
  const live = new Map<Id<"brainSources">, Doc<"brainSources">>();
  for (const link of links) {
    if (live.has(link.sourceId)) continue;
    const source = await ctx.db.get(link.sourceId);
    if (source) live.set(source._id, source);
  }
  const sources = [...live.values()].sort((a, b) => a._creationTime - b._creationTime);
  const current = sources.filter((source) => !revokedBySendBack(source));
  if (current.length > 1) {
    throw new Error(`Import file hash ${contentHash} is linked to ${current.length} Brain sources.`);
  }
  return sources;
}

// ─── Chunk notes kept across retries, and index add leases (review 51) ─────

/**
 * The most a kept row's notes may weigh, well under Convex's 1 MiB document
 * limit; a source with more is not kept (its retry makes the notes again).
 */
export const CHUNK_NOTES_MAX_BYTES = 800_000;
/** The most notes a kept row holds: Convex caps an array at 8,192 values. */
export const CHUNK_NOTES_MAX_COUNT = 8192;

/**
 * Whether one embed's notes may be kept for its retry: within both caps,
 * and not every note empty (the notes model was down: a retry makes them
 * again rather than stamping an entry with this version and no notes).
 */
export function keepableNotes(notes: string[]): boolean {
  if (notes.length === 0 || notes.length > CHUNK_NOTES_MAX_COUNT) return false;
  if (notes.every((note) => note === "")) return false;
  return new TextEncoder().encode(JSON.stringify(notes)).length <= CHUNK_NOTES_MAX_BYTES;
}

/** Delete every kept notes row of a source (one per note version, so few). */
export async function deleteKeptChunkNotes(ctx: MutationCtx, sourceId: Id<"brainSources">): Promise<void> {
  for (const row of await ctx.db
    .query("brainChunkNotes")
    .withIndex("by_sourceId_and_notesVersion", (q) => q.eq("sourceId", sourceId))
    .take(20)) {
    await ctx.db.delete(row._id);
  }
}

/** The notes an earlier attempt of this embed made, if they match the chunk count. */
export const keptChunkNotes = internalQuery({
  args: { sourceId: v.id("brainSources"), notesVersion: v.number(), chunkCount: v.number() },
  returns: v.union(v.array(v.string()), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("brainChunkNotes")
      .withIndex("by_sourceId_and_notesVersion", (q) => q.eq("sourceId", args.sourceId).eq("notesVersion", args.notesVersion))
      .unique();
    if (!row || row.chunkCount !== args.chunkCount || row.notes.length !== args.chunkCount) return null;
    // Notes that are all empty are never reused: a retry makes them again.
    if (row.notes.every((note) => note === "")) return null;
    return row.notes;
  },
});

/** Keep one embed's notes until its adds finish (replacing an older row). */
export const keepChunkNotes = internalMutation({
  args: { sourceId: v.id("brainSources"), notesVersion: v.number(), notes: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("brainChunkNotes")
      .withIndex("by_sourceId_and_notesVersion", (q) => q.eq("sourceId", args.sourceId).eq("notesVersion", args.notesVersion))
      .unique();
    if (old) await ctx.db.delete(old._id);
    const source = await ctx.db.get(args.sourceId);
    if (!source || source.status !== "approved") return null;
    await ctx.db.insert("brainChunkNotes", {
      sourceId: args.sourceId,
      notesVersion: args.notesVersion,
      chunkCount: args.notes.length,
      notes: args.notes,
      createdAt: Date.now(),
    });
    return null;
  },
});

/** Drop the kept notes once every add of the embed has finished. */
export const dropChunkNotes = internalMutation({
  args: { sourceId: v.id("brainSources"), notesVersion: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("brainChunkNotes")
      .withIndex("by_sourceId_and_notesVersion", (q) => q.eq("sourceId", args.sourceId).eq("notesVersion", args.notesVersion))
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/** A lease row older than this is from an action that can no longer be running. */
export const INDEX_WRITE_LEASE_MS = 15 * 60_000;

/**
 * Start one add to one index. Refused (null) when the index is no longer
 * written (its drop started after the embed read the state), so the add
 * never runs and never makes the namespace again; otherwise a lease row the
 * add deletes when done.
 */
export const beginIndexWrite = internalMutation({
  args: { sourceId: v.id("brainSources"), index: vBrainIndexId },
  returns: v.union(v.id("brainIndexWrites"), v.null()),
  handler: async (ctx, args) => {
    const state = await readBrainIndexState(ctx);
    if (!state.written.includes(args.index)) return null;
    return await ctx.db.insert("brainIndexWrites", { index: args.index, sourceId: args.sourceId, startedAt: Date.now() });
  },
});

export const endIndexWrite = internalMutation({
  args: { leaseId: v.id("brainIndexWrites") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.leaseId)) await ctx.db.delete(args.leaseId);
    return null;
  },
});
