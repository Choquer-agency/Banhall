import { internalAction, type ActionCtx } from "../../_generated/server";
import { v } from "convex/values";
import { rerank } from "ai";
import { brain, BRAIN_NAMESPACE, type BrainEntryMetadata } from "./rag";
import { brainRerankModel } from "./embeddings";

export type BrainExemplar = {
  text: string;
  score: number;
  entryId: string;
  title?: string;
  writerName?: string;
};

/**
 * Retrieve top-k approved exemplar passages from The Brain (BNH-10). Returns []
 * on any error so The Brain can NEVER break report generation.
 *
 * A good PD is a good PD: everything lives in ONE namespace, so retrieval works
 * with NO industry set (best exemplars across all industries — structure, voice,
 * CRA phrasing transfer). Setting an industry is the perk, not the requirement:
 * it narrows retrieval to that industry via the composite filter.
 *
 * Writer quality is already folded into ranking via each entry's `importance`
 * (set at ingest from writerTier). A Cohere/Voyage cross-encoder rerank is the
 * Phase-2 quality upgrade.
 */
export async function searchBrainExemplars(
  ctx: ActionCtx,
  args: { industry?: string; query: string; k?: number; docType?: string }
): Promise<BrainExemplar[]> {
  const k = args.k ?? 4;
  const filters: { name: "industryApproved" | "docType"; value: unknown }[] = [];
  if (args.industry) {
    filters.push({
      name: "industryApproved",
      value: { industry: args.industry, approved: true },
    });
  }
  if (args.docType) filters.push({ name: "docType", value: args.docType });

  try {
    const { results, entries } = await brain.search(ctx, {
      namespace: BRAIN_NAMESPACE,
      query: args.query,
      searchType: "hybrid",
      limit: 30,
      chunkContext: { before: 1, after: 1 },
      ...(filters.length ? { filters: filters as never } : {}),
    });

    const byEntry = new Map(entries.map((e) => [e.entryId, e]));
    const candidates: BrainExemplar[] = results.map((r) => {
      const entry = byEntry.get(r.entryId);
      const meta = entry?.metadata as BrainEntryMetadata | undefined;
      return {
        text: r.content.map((c) => c.text).join("\n"),
        score: r.score,
        entryId: r.entryId as unknown as string,
        title: entry?.title ?? undefined,
        writerName: meta?.writerName,
      };
    });

    // P2 quality layer: cross-encoder rerank of the wide hybrid-search net.
    // Falls back to first-stage order — reranking must never break retrieval.
    if (candidates.length > k) {
      try {
        const { ranking } = await rerank({
          model: brainRerankModel,
          query: args.query,
          documents: candidates.map((c) => c.text),
          topN: k,
        });
        return ranking.map((r) => ({
          ...candidates[r.originalIndex],
          score: r.score,
        }));
      } catch {
        // fall through to vector-order top-k
      }
    }
    return candidates.slice(0, k);
  } catch {
    return [];
  }
}

export const retrieveBrainContext = internalAction({
  args: {
    industry: v.optional(v.string()),
    query: v.string(),
    k: v.optional(v.number()),
    docType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BrainExemplar[]> => {
    return await searchBrainExemplars(ctx, args);
  },
});

/**
 * Render exemplars into a prompt block. Framed as REFERENCE PATTERNS, never as
 * facts to copy — the analyzer/section prompts already forbid fabrication, and
 * these gold passages are for structure/voice/CRA-phrasing only.
 */
export function formatBrainExemplars(exemplars: BrainExemplar[]): string {
  if (!exemplars.length) return "";
  const blocks = exemplars
    .map((e, i) => {
      const label = [e.title, e.writerName ? `writer: ${e.writerName}` : null]
        .filter(Boolean)
        .join(" — ");
      return `--- REFERENCE PATTERN ${i + 1}${label ? ` (${label})` : ""} ---\n${e.text}`;
    })
    .join("\n\n");
  return `\n\n# SIMILAR PAST REPORTS FROM THE BRAIN (reference patterns only)
These are gold-standard passages from past approved SR&ED reports in this industry.
Use them ONLY as a guide to structure, voice, and CRA phrasing. NEVER copy their
facts, company details, or technical claims into this report — every claim here
must come from THIS project's transcript and materials.

${blocks}`;
}
