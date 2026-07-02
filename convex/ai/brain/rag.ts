import { RAG } from "@convex-dev/rag";
import { components } from "../../_generated/api";
import type { DataModel } from "../../_generated/dataModel";
import { brainEmbeddingModel, BRAIN_EMBEDDING_DIMENSION } from "./embeddings";

/**
 * The Brain's retrieval engine (BNH-10).
 *
 * The RAG component owns ONLY the vector index + chunks, and it only ever holds
 * APPROVED knowledge — approve = ingest, revoke = deleteByKey (see convex/brain.ts).
 * All governance (approval, weighting, unlearn, audit) lives in our own reactive
 * tables. Killer requirements map to native features:
 *   - industry routing   → optional `industryApproved` filter (see BRAIN_NAMESPACE)
 *   - writer weighting    → `importance` (0..1, scales the vector score)
 *   - provenance          → `entryId` (foreign-keyed back to brainSources)
 *   - unlearn             → `deleteByKey`
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
};

export const brain = new RAG<BrainFilters, BrainEntryMetadata>(components.rag, {
  textEmbeddingModel: brainEmbeddingModel,
  embeddingDimension: BRAIN_EMBEDDING_DIMENSION,
  // Max 16 filter fields per vector index — we use 2 (both set on every entry).
  filterNames: ["industryApproved", "docType"],
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
    if (!source) return;

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

    await ctx.db.patch(source._id, { ragEntryId: entry.entryId });
    await ctx.db.insert("brainAuditLog", {
      action: "ingest",
      sourceId: source._id,
      actorId: "system",
      reason: replacedEntry ? "Re-ingested (replaced prior version)" : "Ingested",
      at: Date.now(),
    });
  }
);
