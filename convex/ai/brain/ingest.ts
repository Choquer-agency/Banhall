"use node";

import Anthropic from "@anthropic-ai/sdk";
import { instrumentedAnthropic, scheduleUsage } from "../instrument";
import { defaultChunker } from "@convex-dev/rag";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { brain, BRAIN_NAMESPACE } from "./rag";
import { brainEmbeddingModel } from "./embeddings";

/** Off by default so a first bring-up ingest costs nothing; flip on for prod. */
const USE_CONTEXTUAL = process.env.BRAIN_CONTEXTUAL === "1";

/**
 * Anthropic Contextual Retrieval: prepend a short model-generated blurb that
 * situates each chunk inside its parent PD before embedding. The full document
 * is sent as a cached prefix, so the repeated cost is ~nil. Measured to cut
 * retrieval failures ~35–49% (more with a reranker).
 */
async function contextualizeChunks(
  client: Anthropic,
  fullDoc: string,
  chunks: string[]
): Promise<string[]> {
  const out: string[] = [];
  for (const chunk of chunks) {
    try {
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 100,
        system:
          "You situate a chunk within its source document for retrieval. Reply with 1–2 sentences of context only — no preamble.",
        messages: [
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
                text: `<chunk>\n${chunk}\n</chunk>\nGive a short context situating this chunk within the document (company, which SR&ED section, what it covers). Context only.`,
              },
            ],
          },
        ],
      });
      const ctx = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
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

/**
 * Embed one approved brainSources row into the RAG (BNH-10). Scheduled by
 * `approveSource` / `importPdPair` — only ever runs on approved knowledge.
 * Same `key` re-ingest replaces the prior version; `contentHash` dedups.
 */
export const embedSource = internalAction({
  args: { sourceId: v.id("brainSources") },
  handler: async (ctx, args) => {
    const src = await ctx.runQuery(
      internal.brain.getBrainSourceForIngest,
      { sourceId: args.sourceId }
    );
    if (!src) throw new Error("brainSource not found for ingest");

    const importance = Math.max(0, Math.min(1, src.writerTier));

    // Every declared filterName gets a value on every add. Science code stays
    // in metadata so adding it does not strand legacy entries in a new RAG
    // namespace; retrieval applies the exact-code preference structurally.
    const filterValues: { name: "industryApproved" | "docType"; value: unknown }[] = [
      { name: "industryApproved", value: { industry: src.industry, approved: true } },
      { name: "docType", value: src.docType },
    ];

    const common = {
      namespace: BRAIN_NAMESPACE,
      key: src.ragKey,
      title: src.title,
      importance,
      contentHash: src.sourceHash,
      metadata: {
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

    const addResult = USE_CONTEXTUAL
      ? await (async () => {
          const client = instrumentedAnthropic(ctx, {
            callSite: "brain:contextualize",
            brainSourceId: args.sourceId,
          });
          const rawChunks = defaultChunker(src.content);
          const chunks = await contextualizeChunks(
            client,
            src.content,
            rawChunks
          );
          return await brain.add(ctx, { ...common, chunks });
        })()
      : await brain.add(ctx, { ...common, text: src.content });

    if (addResult.usage.tokens > 0) {
      await scheduleUsage(ctx, {
        brainSourceId: args.sourceId,
        callSite: "brain:corpus_embedding",
        model: brainEmbeddingModel.modelId,
        inputTokens: addResult.usage.tokens,
        outputTokens: 0,
      });
    }
  },
});
