import { voyage } from "voyage-ai-provider";

/**
 * Embedding model for The Brain (BNH-10).
 *
 * Voyage `voyage-3-large` (1024 dims) — Anthropic's recommended embedder for
 * domain/technical text (Anthropic has no embeddings API of their own; they
 * point at Voyage). The `voyage` instance reads `VOYAGE_API_KEY` from the
 * Convex deployment environment.
 *
 * voyage-3-large also supports 256/512/2048 output dims; we use the 1024
 * default. NOTE: the embedding dimension is baked into a namespace version — to
 * change model or dimension later you must re-embed through a NEW RAG instance
 * (the old vectors are not comparable to the new ones).
 */
export const BRAIN_EMBEDDING_DIMENSION = 1024;

export const brainEmbeddingModel = voyage.textEmbeddingModel("voyage-3-large");

/**
 * Cross-encoder reranker for retrieval's second stage (P2 quality layer).
 * Hybrid search casts a wide net (limit 30); the reranker re-scores
 * query↔chunk pairs jointly and keeps only the truly relevant top-k.
 */
export const brainRerankModel = voyage.rerankingModel("rerank-2.5");
