import { RAG } from "@convex-dev/rag";
import { components, internal } from "../../_generated/api";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { brainEmbeddingModel, BRAIN_EMBEDDING_DIMENSION } from "./embeddings";

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
export const BRAIN_NAMESPACE = "brain";
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
};

export const brain = new RAG<BrainFilters, BrainEntryMetadata>(components.rag, {
  textEmbeddingModel: brainEmbeddingModel,
  embeddingDimension: BRAIN_EMBEDDING_DIMENSION,
  // Max 16 filter fields per vector index — we use 2 (both set on every entry).
  filterNames: [...BRAIN_FILTER_NAMES],
});

/**
 * Commits in the same transaction that marks a new entry "ready". Records the
 * component's entryId back on the brainSources row (provenance) and logs
 * ingestion outcome. Never auto-applies anything — the source was already
 * admin-approved before ingest was scheduled.
 *
 * (Replaced-entry garbage collection on re-ingest is a Phase-3 cron, not P0.)
 */
export const ingestOnComplete = brain.defineOnComplete<DataModel>(
  async (ctx, { entry, replacedEntry, error }) => {
    if (!entry.key) return; // we always add with a key; narrows string|undefined
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
        });
      }
      return;
    }

    if (error) {
      await ctx.db.insert("brainAuditLog", {
        action: "ingest",
        sourceId: source._id,
        actorId: "system",
        reason: `Ingestion failed: ${error}`,
        at: Date.now(),
      });
      return;
    }

    // Close the revoke-during-embed race. The completion callback and the
    // governance mutation serialize through Convex transactions: if revoke
    // committed first, this removes the late vector instead of restoring it;
    // if completion committed first, revoke observes ragEntryId and removes it.
    if (source.status !== "approved") {
      // Compensation is the SAME confirmed-erasure path as revoke-time unlearn
      // (this is a mutation, so it cannot confirm anything inline). Never patch
      // `ragEntryId` here: a non-approved source must not gain an entry id
      // except as failure evidence, which the action writes if erasure fails.
      await ctx.scheduler.runAfter(0, internal.brain.unlearnSource, {
        ragEntryId: entry.entryId,
        sourceId: source._id,
      });
      await ctx.db.insert("brainAuditLog", {
        action: "ingest",
        sourceId: source._id,
        actorId: "system",
        reason:
          "Discarded completed embedding because the source is no longer approved",
        at: Date.now(),
      });
      return;
    }

    const notesVersion = (entry.metadata as BrainEntryMetadata | undefined)?.chunkNotesVersion;
    await patchBrainSource(ctx, source, {
      ragEntryId: entry.entryId,
      ragImportance: entry.importance,
      chunkNotesVersion: typeof notesVersion === "number" ? notesVersion : undefined,
    });
    await ctx.db.insert("brainAuditLog", {
      action: "ingest",
      sourceId: source._id,
      actorId: "system",
      reason: replacedEntry
        ? "Re-ingested (replaced prior version)"
        : "Ingested",
      at: Date.now(),
    });
  },
);

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
  await ctx.db.delete(sourceId);
  await syncBrainSourceCard(ctx, sourceId, null);
  // Links left over point at a source that no longer exists; lookups skip
  // them (sourceIdForImportFile) until the scheduled pages remove them.
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

/**
 * The source an import file's bytes are already linked to, if any: the one
 * Send back did not revoke, else (only sources Send back revoked) the
 * oldest of those.
 */
export async function sourceIdForImportFile(
  ctx: MutationCtx,
  contentHash: string
): Promise<Id<"brainSources"> | null> {
  const sources = await sourcesForImportFile(ctx, contentHash);
  return (sources.find((source) => !revokedBySendBack(source)) ?? sources[0])?._id ?? null;
}
