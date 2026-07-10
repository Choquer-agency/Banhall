import { internalAction, type ActionCtx } from "../../_generated/server";
import { v } from "convex/values";
import { rerank } from "ai";
import type { Id } from "../../_generated/dataModel";
import { brain, BRAIN_NAMESPACE, type BrainEntryMetadata } from "./rag";
import { brainEmbeddingModel, brainRerankModel } from "./embeddings";
import { scheduleUsage } from "../instrument";
import { voyageTokenCount } from "../providers";
import {
  isCraScienceCode,
  normalizeCraScienceCode,
  scienceCodeLabel,
  type CraScienceCode,
} from "../../../shared/craScienceCodes";
import { pickScienceRouted } from "./scienceRouting";

export type BrainExemplar = {
  text: string;
  /** Final ranking score (rerank × writer-tier blend when reranked, else vector/RRF). */
  score: number;
  entryId: string;
  /** brainSources row behind this entry — flywheel joins + revocation forensics. */
  sourceId?: string;
  title?: string;
  writerName?: string;
  writerTier?: number;
  scienceCode?: CraScienceCode;
  /** First-stage hybrid-search score, kept raw for provenance/eval. */
  searchScore: number;
  /** Raw cross-encoder score (pre tier-blend); absent when rerank was skipped/failed. */
  rerankScore?: number;
};

export type BrainSearchOutcome = {
  exemplars: BrainExemplar[];
  /**
   * True when the search infrastructure itself failed — empty-because-broken,
   * not empty-because-no-match. Callers use this to report honestly (a chat
   * "no knowledge yet" answer would be a lie during a Voyage outage) and to
   * log degradation. A rerank failure is NOT degraded: vector-order fallback
   * still returns valid exemplars.
   */
  degraded: boolean;
};

/** Rerank scores below this are noise — better zero exemplars than wrong ones. */
const RELEVANCE_FLOOR = 0.35;

/**
 * Retrieve top-k approved exemplar passages from The Brain (BNH-10). Never
 * throws — infra failure returns `{ exemplars: [], degraded: true }` so The
 * Brain can NEVER break report generation, while callers can still tell an
 * outage apart from an honest no-match.
 *
 * A good PD is a good PD: everything lives in ONE namespace, so retrieval works
 * with NO industry set (best exemplars across all industries — structure, voice,
 * CRA phrasing transfer). Setting an industry is the perk, not the requirement:
 * it narrows retrieval to that industry via the composite filter.
 */
type BrainSearchArgs = {
  industry?: string;
  scienceCode?: string;
  query: string;
  k?: number;
  docType?: string;
  projectId?: Id<"projects">;
  userId?: string;
  agentThreadId?: string;
  usageLabel?: string;
};

export async function searchBrainExemplars(
  ctx: ActionCtx,
  args: BrainSearchArgs
): Promise<BrainSearchOutcome> {
  const k = args.k ?? 4;
  const usageSuffix = args.usageLabel ? `:${args.usageLabel}` : "";
  const filters: { name: "industryApproved" | "docType"; value: unknown }[] = [];
  if (args.industry) {
    filters.push({
      name: "industryApproved",
      value: { industry: args.industry, approved: true },
    });
  }
  if (args.docType) filters.push({ name: "docType", value: args.docType });

  try {
    const scienceCode = normalizeCraScienceCode(args.scienceCode);
    if (args.scienceCode?.trim() && !scienceCode) {
      throw new Error("Invalid CRA field of science or technology code");
    }
    const retrievalQuery = scienceCode
      ? `${args.query}\n\nCRA T4088 line 206: ${scienceCodeLabel(scienceCode)}`
      : args.query;
    const { results, entries, usage } = await brain.search(ctx, {
      namespace: BRAIN_NAMESPACE,
      query: retrievalQuery,
      searchType: "hybrid",
      limit: 30,
      chunkContext: { before: 1, after: 1 },
      ...(filters.length ? { filters: filters as never } : {}),
    });
    if (usage.tokens > 0) {
      await scheduleUsage(ctx, {
        ...(args.projectId ? { projectId: args.projectId } : {}),
        ...(args.userId ? { userId: args.userId } : {}),
        ...(args.agentThreadId
          ? { agentThreadId: args.agentThreadId }
          : {}),
        callSite: `brain:query_embedding${usageSuffix}`,
        model: brainEmbeddingModel.modelId,
        inputTokens: usage.tokens,
        outputTokens: 0,
      });
    }

    const byEntry = new Map(entries.map((e) => [e.entryId, e]));
    const candidates: BrainExemplar[] = results.map((r) => {
      const entry = byEntry.get(r.entryId);
      const meta = entry?.metadata as BrainEntryMetadata | undefined;
      return {
        text: r.content.map((c) => c.text).join("\n"),
        score: r.score,
        searchScore: r.score,
        entryId: r.entryId as unknown as string,
        sourceId: meta?.sourceId,
        title: entry?.title ?? undefined,
        writerName: meta?.writerName,
        writerTier: meta?.writerTier,
        scienceCode: isCraScienceCode(meta?.scienceCode)
          ? meta.scienceCode
          : undefined,
      };
    });

    // P2 quality layer: rerank a wide slate (not just top-k), then apply a
    // relevance floor, blend the writer tier back in (rerank is tier-blind),
    // cap chunks per source PD for diversity, and take the top k.
    // Falls back to first-stage order — reranking must never break retrieval.
    if (candidates.length > k) {
      try {
        const rerankResult = await rerank({
          model: brainRerankModel,
          query: retrievalQuery,
          documents: candidates.map((c) => c.text),
          topN: Math.min(12, candidates.length),
          maxRetries: 1,
        });
        const rerankTokens = voyageTokenCount(rerankResult.response.body);
        if (rerankTokens !== null) {
          await scheduleUsage(ctx, {
            ...(args.projectId ? { projectId: args.projectId } : {}),
            ...(args.userId ? { userId: args.userId } : {}),
            ...(args.agentThreadId
              ? { agentThreadId: args.agentThreadId }
              : {}),
            callSite: `brain:rerank${usageSuffix}`,
            model: brainRerankModel.modelId,
            inputTokens: rerankTokens,
            outputTokens: 0,
          });
        } else {
          console.error("Voyage rerank response omitted billed token usage");
        }
        const { ranking } = rerankResult;
        const floored = ranking.filter((r) => r.score >= RELEVANCE_FLOOR);
        const blended = floored
          .map((r) => ({
            ...candidates[r.originalIndex],
            rerankScore: r.score,
            // Writer quality re-enters after reranking: score × (0.6 + 0.4·tier)
            score: r.score * (0.6 + 0.4 * (candidates[r.originalIndex].writerTier ?? 0.4)),
          }))
          .sort((a, b) => b.score - a.score);
        // May return < k, or none — floor over filler.
        return {
          exemplars: pickScienceRouted(blended, k, scienceCode),
          degraded: false,
        };
      } catch (err) {
        console.error("brain rerank failed; falling back to vector order", err);
      }
    }
    return {
      exemplars: pickScienceRouted(candidates, k, scienceCode),
      degraded: false,
    };
  } catch (err) {
    console.error("brain search failed; returning no exemplars", err);
    return { exemplars: [], degraded: true };
  }
}

export const retrieveBrainContext = internalAction({
  args: {
    industry: v.optional(v.string()),
    scienceCode: v.optional(v.string()),
    query: v.string(),
    k: v.optional(v.number()),
    docType: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    userId: v.optional(v.string()),
    agentThreadId: v.optional(v.string()),
    usageLabel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BrainSearchOutcome> => {
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
      const label = [
        e.title,
        e.scienceCode ? `CRA ${scienceCodeLabel(e.scienceCode)}` : null,
        e.writerName ? `writer: ${e.writerName}` : null,
      ]
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
