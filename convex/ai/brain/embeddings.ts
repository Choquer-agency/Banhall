import { voyage } from "@ai-sdk/voyage";

/**
 * Embedding and rerank models for The Brain (BNH-10).
 *
 * Voyage is Anthropic's recommended embedder (Anthropic has no embeddings
 * API of its own). The `voyage` instance reads `VOYAGE_API_KEY` from the
 * Convex deployment environment; the provider is the first-party
 * `@ai-sdk/voyage`.
 *
 * 2026-11-18 (fourth): the Brain moves from voyage-3-large and rerank-2.5 to
 * voyage-4-large and rerank-3. Vectors of two models are not comparable, and
 * the RAG component keeps one "ready" namespace per name, so the new model
 * gets its own index: a second RAG instance on its own namespace name
 * (rag.ts). A stored pointer says which index search reads (brain.ts,
 * `brainSearchIndexState`); moving it is the cutover and moving it back is
 * the rollback. Never point the old namespace name at a new model: its first
 * add would mark the old index "replaced" and search would read an almost
 * empty one, with no way back.
 *
 * Model ids and prices read from Voyage's docs on 2026-11-18:
 * https://docs.voyageai.com/docs/embeddings (voyage-4-large, 1024 default
 * dimension), https://docs.voyageai.com/docs/reranker (rerank-3),
 * https://docs.voyageai.com/docs/pricing.
 */
export const BRAIN_EMBEDDING_DIMENSION = 1024;

/** The two Brain search indexes. "voyage3" is the index from before 2026-11-18. */
export const BRAIN_INDEX_IDS = ["voyage3", "voyage4"] as const;
export type BrainIndexId = (typeof BRAIN_INDEX_IDS)[number];

/** The index search reads when no pointer row exists (every deployment before the cutover). */
export const BRAIN_DEFAULT_SERVING_INDEX: BrainIndexId = "voyage3";

/**
 * Per index: its embedding model, its RAG namespace name, the reranker used
 * when it serves, and the two floors that depend on those models.
 *
 * The voyage4 floors are PROVISIONAL, equal to voyage3's: a floor can only
 * be calibrated on real vectors. `brain:calibrateSearchIndexes` (owner run,
 * read only, after the build) reports both indexes' score spreads and
 * suggests floors; change these constants before the cutover if it says so.
 * The raw search floor (retrieve.ts) is a position in the fused ranking,
 * not a model score, so it is shared.
 */
export const BRAIN_SEARCH_INDEXES = {
  voyage3: {
    embeddingModelId: "voyage-3-large",
    namespace: "brain",
    rerankModelId: "rerank-2.5",
    minVectorSimilarity: 0.3,
    rerankRelevanceFloor: 0.35,
  },
  voyage4: {
    embeddingModelId: "voyage-4-large",
    namespace: "brain-v4",
    rerankModelId: "rerank-3",
    minVectorSimilarity: 0.3,
    rerankRelevanceFloor: 0.35,
  },
} as const satisfies Record<
  BrainIndexId,
  {
    embeddingModelId: string;
    namespace: string;
    rerankModelId: string;
    minVectorSimilarity: number;
    rerankRelevanceFloor: number;
  }
>;

/** The index a RAG namespace name belongs to, or null for a name the Brain does not use. */
export function brainIndexForNamespace(namespace: string): BrainIndexId | null {
  for (const id of BRAIN_INDEX_IDS) {
    if (BRAIN_SEARCH_INDEXES[id].namespace === namespace) return id;
  }
  return null;
}

// The voyage3 models keep their old export names: the index from before
// 2026-11-18 and every test that stubs it read them.
export const BRAIN_EMBEDDING_MODEL_ID = BRAIN_SEARCH_INDEXES.voyage3.embeddingModelId;
export const brainEmbeddingModel = voyage.embedding(BRAIN_EMBEDDING_MODEL_ID);
export const BRAIN_RERANK_MODEL_ID = BRAIN_SEARCH_INDEXES.voyage3.rerankModelId;

/**
 * Cross-encoder reranker for retrieval's second stage (P2 quality layer).
 * Hybrid search casts a wide net (limit 30); the reranker re-scores
 * query and chunk pairs jointly and keeps only the truly relevant top-k.
 */
export const brainRerankModel = voyage.reranking(BRAIN_RERANK_MODEL_ID);

export const brainEmbeddingModelV4 = voyage.embedding(BRAIN_SEARCH_INDEXES.voyage4.embeddingModelId);
export const brainRerankModelV4 = voyage.reranking(BRAIN_SEARCH_INDEXES.voyage4.rerankModelId);

type VoyageEmbeddingModel = ReturnType<typeof voyage.embedding>;

/**
 * Wraps a Voyage embedding model so `@convex-dev/rag` (which sends no
 * providerOptions on embedMany/embed) passes Voyage's asymmetric `input_type`
 * ("document" at ingest, "query" at search). Delegates through `model.doEmbed`
 * so existing spies on the base model still observe every call.
 */
function withVoyageInputType(
  model: VoyageEmbeddingModel,
  inputType: "document" | "query"
): VoyageEmbeddingModel {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    maxEmbeddingsPerCall: model.maxEmbeddingsPerCall,
    supportsParallelCalls: model.supportsParallelCalls,
    doEmbed: (options) =>
      model.doEmbed({
        ...options,
        providerOptions: {
          ...options.providerOptions,
          voyage: {
            ...(options.providerOptions?.voyage as Record<string, unknown> | undefined),
            inputType,
          },
        },
      }),
  };
}

/**
 * Each index's ingest embedding model. voyage3 stays unprompted to match its
 * already-indexed production vectors; voyage4 uses input_type "document".
 */
export const BRAIN_EMBEDDING_MODELS = {
  voyage3: brainEmbeddingModel,
  voyage4: withVoyageInputType(brainEmbeddingModelV4, "document"),
} as const;

/**
 * Each index's query embedding model. voyage3 stays unprompted to match its
 * already-indexed production vectors; voyage4 uses input_type "query".
 */
export const BRAIN_SEARCH_EMBEDDING_MODELS = {
  voyage3: brainEmbeddingModel,
  voyage4: withVoyageInputType(brainEmbeddingModelV4, "query"),
} as const;

/** The reranker used while an index serves. */
export const BRAIN_RERANK_MODELS = {
  voyage3: brainRerankModel,
  voyage4: brainRerankModelV4,
} as const;
