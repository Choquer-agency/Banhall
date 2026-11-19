import { internalAction, type ActionCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { rerank } from "ai";
import type { Id } from "../../_generated/dataModel";
import {
  BRAIN_ENTRY_IMPORTANCE,
  BRAIN_FILTER_NAMES,
  BRAIN_RAGS,
  type BrainEntryMetadata,
} from "./rag";
import { BRAIN_RERANK_MODELS, BRAIN_SEARCH_INDEXES } from "./embeddings";
import { scheduleUsage } from "../instrument";
import { voyageTokenCount } from "../providers";
import {
  isCraScienceCode,
  normalizeCraScienceCode,
  scienceCodeLabel,
  type CraScienceCode,
} from "../../../shared/craScienceCodes";
import { pickScienceRouted } from "./scienceRouting";
import { recordRerankOutcome, type RerankOutcome } from "../../lib/rerankTelemetry";
import { safeErrorDetails } from "../../lib/safeErrorDetails";

export type BrainExemplar = {
  text: string;
  /** Final ranking score: the rerank or search score × the writer-tier blend. */
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

/**
 * Rerank scores below this are noise: better zero exemplars than wrong ones.
 * The voyage3 index's (rerank-2.5); since 2026-11-18 (fourth) each index
 * sets its own (`BRAIN_SEARCH_INDEXES`, embeddings.ts).
 */
export const BRAIN_RERANK_RELEVANCE_FLOOR = BRAIN_SEARCH_INDEXES.voyage3.rerankRelevanceFloor;

/**
 * Relevance gates for the NON-reranked paths (≤k candidates, or a rerank
 * outage), which previously passed raw hybrid results with no floor at all —
 * low-relevance exemplars slipped in precisely when the corpus is small.
 *
 * Two layers, because raw hybrid `searchScore`s are NOT similarities: the RAG
 * component assigns position-based RRF scores ((n − i) / n — the top hit scores
 * 1.0 even on a garbage match), so no searchScore floor can measure relevance
 * on its own:
 *  - MIN_VECTOR_SIMILARITY is a true cosine floor applied inside the search
 *    (`vectorScoreThreshold`): vector candidates below it never enter the
 *    slate, on every path. Deliberately low — voyage-3 cosine similarity for
 *    on-topic text runs ≳0.4; 0.3 prunes clear junk without starving a small
 *    corpus.
 *    The component multiplies the cosine by the entry's importance before
 *    this floor, so since 2026-11-17 every entry is ingested with importance
 *    1 (BRAIN_ENTRY_IMPORTANCE) and the floor reads raw similarity; entries
 *    ingested before keep their tier in the vector until re-embedded.
 *  - RAW_SEARCH_FLOOR then trims the tail of the fused slate on the
 *    non-reranked returns: the bottom of the RRF ordering is where text-only
 *    stragglers (which bypass the cosine floor) land.
 */
export const BRAIN_MIN_VECTOR_SIMILARITY = BRAIN_SEARCH_INDEXES.voyage3.minVectorSimilarity;
export const BRAIN_RAW_SEARCH_FLOOR = 0.25;
export const BRAIN_SEARCH_LIMIT = 30;
/**
 * Hits fetched when a company's own imported PDs are left out (2026-11-17):
 * they are dropped after the search, then the slate is cut back to
 * BRAIN_SEARCH_LIMIT, so a company's own PDs never shrink its slate unless
 * they fill all of these.
 */
export const BRAIN_OWN_COMPANY_SEARCH_LIMIT = 90;
export const BRAIN_SEARCH_DEFAULT_K = 4;
export const BRAIN_CHUNK_CONTEXT = { before: 1, after: 1 } as const;
export const BRAIN_RERANK_TOP_N_CAP = 12;
export const BRAIN_RERANK_MAX_RETRIES = 1;
export const BRAIN_SEARCH_PROGRAM = {
  searchType: "hybrid",
  filterNames: BRAIN_FILTER_NAMES,
  filters: {
    industryApproved: "industryApproved",
    documentType: "docType",
  },
  rerankTrigger: {
    left: "candidate-count",
    comparator: "greater-than",
    right: "requested-k",
  },
  writerTierBlend: {
    rerankCoefficient: 0.6,
    writerTierCoefficient: 0.4,
    defaultWriterTier: 0.4,
    // 2026-11-17: every entry's RAG importance is 1, so the floors read raw
    // relevance; the tier ranks after them on both exits, and comes from
    // the source's card (its current weight) before the entry's metadata.
    entryImportance: BRAIN_ENTRY_IMPORTANCE,
    appliesAfterFloor: ["rerank", "no-rerank"],
    noRerankPositions: "recounted-over-the-kept-slate",
    tierSource: "source-card-then-entry-metadata",
    // 2026-11-17 (edit after approval on Import): the writer's name and the
    // science code an exemplar is labelled and routed by come from its
    // source's card too, so an Admin's edit shows without a re-embed.
    labelSource: "source-card-then-entry-metadata",
  },
  ownCompanyExclusion: {
    leavesOut: "sources-from-import-files-of-the-searching-project-company",
    widerFetchOnlyWhen: "the-company-has-import-files-with-a-brain-source",
    searchLimit: BRAIN_OWN_COMPANY_SEARCH_LIMIT,
    slateLimit: BRAIN_SEARCH_LIMIT,
  },
  scienceLabelScaffold: {
    separator: "\n\n",
    prefix: "CRA T4088 line 206: ",
  },
} as const;

export const BRAIN_EXEMPLAR_SCAFFOLDS = {
  blockPrefix:
    "\n\n# SIMILAR PAST REPORTS FROM THE BRAIN (reference patterns only)\nThese are gold-standard passages from past approved SR&ED reports in this industry.\nUse them ONLY as a guide to structure, voice, and CRA phrasing. NEVER copy their\nfacts, company details, or technical claims into this report. Every claim here\nmust come from THIS project's transcript and materials.\n\n",
  itemPrefix: "--- REFERENCE PATTERN ",
  itemLabelOpen: " (",
  itemLabelClose: ")",
  itemSuffix: " ---\n",
  labelSeparator: ": ",
  scienceLabelPrefix: "CRA ",
  writerLabelPrefix: "writer: ",
  truncationSuffix: "\n[… exemplar truncated]",
  itemSeparator: "\n\n",
  labelOrder: ["title", "scienceCode", "writerName"],
} as const;

/**
 * Floor applied whenever the cross-encoder didn't rank (see RAW_SEARCH_FLOOR).
 * Exported for unit tests.
 */
export function applyRawSearchFloor(
  candidates: BrainExemplar[]
): BrainExemplar[] {
  return candidates.filter(
    (candidate) => candidate.searchScore >= BRAIN_RAW_SEARCH_FLOOR
  );
}

/**
 * Writer quality as a ranking weight: score × (0.6 + 0.4·tier), with a
 * missing tier read as 0.4. Applied after the relevance floor, never before
 * it, so a low tier lowers a match's rank but never hides an on-topic one.
 */
export function blendWriterTier(score: number, writerTier: number | undefined): number {
  const blend = BRAIN_SEARCH_PROGRAM.writerTierBlend;
  return score * (blend.rerankCoefficient + blend.writerTierCoefficient * (writerTier ?? blend.defaultWriterTier));
}

/**
 * The non-reranked exit (2026-11-17). Hybrid search scores are positions
 * ((n - i) / n over every hit it returned), so after revoked and
 * own-company hits are dropped the positions are counted again over the
 * kept slate, in search order; then the raw-slate floor, then the writer
 * tier blended in and the slate sorted by it (ties keep search order).
 * `searchScore` keeps the component's score for provenance. Exported for
 * unit tests.
 */
export function rankWithoutRerank(candidates: BrainExemplar[]): BrainExemplar[] {
  const kept = candidates.length;
  return candidates
    .map((candidate, index) => ({ candidate, index, position: (kept - index) / kept }))
    .filter(({ position }) => position >= BRAIN_RAW_SEARCH_FLOOR)
    .map(({ candidate, index, position }) => ({
      candidate: { ...candidate, score: blendWriterTier(position, candidate.writerTier) },
      index,
    }))
    .sort((a, b) => b.candidate.score - a.candidate.score || a.index - b.index)
    .map(({ candidate }) => candidate);
}

export function shouldRerankBrainCandidates(
  candidateCount: number,
  requestedK: number
): boolean {
  // The comparator is manifest data even though only the production-supported
  // branch is accepted here. Changing the routing rule therefore changes both
  // request behavior and the prompt-program hash.
  return (
    BRAIN_SEARCH_PROGRAM.rerankTrigger.comparator === "greater-than" &&
    candidateCount > requestedK
  );
}

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
  /**
   * The project whose company's own imported PDs are left out (2026-11-17).
   * Defaults to `projectId`; chat, which bills no project, passes it here.
   */
  ownCompanyProjectId?: Id<"projects">;
  userId?: string;
  agentThreadId?: string;
  usageLabel?: string;
};

/**
 * Governance join on the served results (CAP-10 g). An entry orphaned by a
 * revoke keeps `approved: true` in its OWN RAG filter value until deletion
 * succeeds, so `brain.search` keeps matching it. Rather than accept that
 * window, every hit is joined back to `brainSources.status` and dropped unless
 * the row is currently `approved`.
 *
 * Legacy hits with no `metadata.sourceId` cannot be joined and pass through
 * unchanged — they predate revocation tracking.
 *
 * The query, the search filters and the ranking ALGORITHM are unchanged; what
 * changes is the candidate slate the ranking stages see. Because this runs
 * before `shouldRerankBrainCandidates`, dropping hits can narrow the slate
 * below the rerank threshold (skipping rerank entirely) and always narrows the
 * documents/topN handed to the reranker. That is intended: a non-servable hit
 * must not influence ranking, and it must not be served.
 *
 * 2026-11-17: it also drops hits from the searching project's company's own
 * imported PDs (when that company has any, the search fetched
 * BRAIN_OWN_COMPANY_SEARCH_LIMIT hits for that), takes each kept hit's
 * writer tier from its source (the current weight), and cuts the slate back
 * to BRAIN_SEARCH_LIMIT. Each kept hit's writer name and science code come
 * from its source too (an edit after approval on Import changes them there,
 * never in the entry's metadata, which the component keeps when the text is
 * the same).
 */
async function dropNonServableCandidates(
  ctx: ActionCtx,
  candidates: BrainExemplar[],
  ownCompanyKeys: string[] | undefined
): Promise<BrainExemplar[]> {
  const sourceIds = [
    ...new Set(
      candidates
        .map((c) => c.sourceId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  if (sourceIds.length === 0) return candidates.slice(0, BRAIN_SEARCH_LIMIT);
  const servable = new Map(
    (
      await ctx.runQuery(internal.brain.servableBrainSources, {
        sourceIds,
        ...(ownCompanyKeys ? { ownCompanyKeys } : {}),
      })
    ).map((row) => [row.sourceId, row])
  );
  return candidates
    .filter((c) => !c.sourceId || servable.has(c.sourceId))
    .map((c) => {
      const row = c.sourceId ? servable.get(c.sourceId) : undefined;
      if (!row) return c;
      return {
        ...c,
        writerTier: row.writerTier,
        writerName: row.writerName,
        scienceCode: isCraScienceCode(row.scienceCode) ? row.scienceCode : undefined,
      };
    })
    .slice(0, BRAIN_SEARCH_LIMIT);
}

export async function searchBrainExemplars(
  ctx: ActionCtx,
  args: BrainSearchArgs
): Promise<BrainSearchOutcome> {
  const k = args.k ?? BRAIN_SEARCH_DEFAULT_K;
  const ownCompanyProjectId = args.ownCompanyProjectId ?? args.projectId;
  const usageSuffix = args.usageLabel ? `:${args.usageLabel}` : "";
  let terminalOutcome: RerankOutcome = "search_error";
  const filters: {
    name: (typeof BRAIN_SEARCH_PROGRAM.filterNames)[number];
    value: unknown;
  }[] = [];
  if (args.industry) {
    filters.push({
      name: BRAIN_SEARCH_PROGRAM.filters.industryApproved,
      value: { industry: args.industry, approved: true },
    });
  }
  if (args.docType) {
    filters.push({
      name: BRAIN_SEARCH_PROGRAM.filters.documentType,
      value: args.docType,
    });
  }

  try {
    const scienceCode = normalizeCraScienceCode(args.scienceCode);
    if (args.scienceCode?.trim() && !scienceCode) {
      throw new Error("Invalid CRA field of science or technology code");
    }
    const retrievalQuery = scienceCode
      ? `${args.query}${BRAIN_SEARCH_PROGRAM.scienceLabelScaffold.separator}${BRAIN_SEARCH_PROGRAM.scienceLabelScaffold.prefix}${scienceCodeLabel(scienceCode)}`
      : args.query;
    // 2026-11-18 (fourth): the stored pointer chooses the index, read once
    // per search; its model, namespace, reranker and floors go together.
    const { serving } = await ctx.runQuery(internal.brain.servingSearchIndex, {});
    const index = BRAIN_SEARCH_INDEXES[serving];
    // Only a company with imported PDs in the Brain needs the wider fetch.
    const ownCompany = ownCompanyProjectId
      ? await ctx.runQuery(internal.brain.ownCompanyImports, { projectId: ownCompanyProjectId })
      : null;
    const { results, entries, usage } = await BRAIN_RAGS[serving].search(ctx, {
      namespace: index.namespace,
      query: retrievalQuery,
      searchType: BRAIN_SEARCH_PROGRAM.searchType,
      limit: ownCompany ? BRAIN_OWN_COMPANY_SEARCH_LIMIT : BRAIN_SEARCH_LIMIT,
      vectorScoreThreshold: index.minVectorSimilarity,
      chunkContext: BRAIN_CHUNK_CONTEXT,
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
        model: index.embeddingModelId,
        inputTokens: usage.tokens,
        outputTokens: 0,
      });
    }

    const byEntry = new Map(entries.map((e) => [e.entryId, e]));
    const rawCandidates: BrainExemplar[] = results.map((r) => {
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

    const candidates = await dropNonServableCandidates(ctx, rawCandidates, ownCompany?.companyKeys);

    // P2 quality layer: rerank a wide slate (not just top-k), then apply a
    // relevance floor, blend the writer tier back in (rerank is tier-blind),
    // cap chunks per source PD for diversity, and take the top k.
    // Falls back to first-stage order — reranking must never break retrieval.
    let rerankFailed = false;
    if (shouldRerankBrainCandidates(candidates.length, k)) {
      try {
        const rerankResult = await rerank({
          model: BRAIN_RERANK_MODELS[serving],
          query: retrievalQuery,
          documents: candidates.map((c) => c.text),
          topN: Math.min(BRAIN_RERANK_TOP_N_CAP, candidates.length),
          maxRetries: BRAIN_RERANK_MAX_RETRIES,
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
            model: index.rerankModelId,
            inputTokens: rerankTokens,
            outputTokens: 0,
          });
        } else {
          console.error("Voyage rerank response omitted billed token usage");
        }
        const { ranking } = rerankResult;
        const floored = ranking.filter(
          (ranked) => ranked.score >= index.rerankRelevanceFloor
        );
        const blended = floored
          .map((r) => ({
            ...candidates[r.originalIndex],
            rerankScore: r.score,
            // Writer quality re-enters after reranking: score × (0.6 + 0.4·tier)
            score: blendWriterTier(r.score, candidates[r.originalIndex].writerTier),
          }))
          .sort((a, b) => b.score - a.score);
        // May return < k, or none — floor over filler.
        const result = {
          exemplars: pickScienceRouted(blended, k, scienceCode),
          degraded: false,
        };
        terminalOutcome = "success";
        return result;
      } catch (err) {
        rerankFailed = true;
        console.error("brain rerank failed; falling back to vector order", safeErrorDetails(err));
      }
    }
    // Non-reranked exit (≤k candidates, or the rerank catch above): apply the
    // raw-slate floor since RELEVANCE_FLOOR never ran here, then rank by the
    // writer tier blend (2026-11-17: the search itself no longer weighs it).
    const result = {
      exemplars: pickScienceRouted(rankWithoutRerank(candidates), k, scienceCode),
      degraded: false,
    };
    terminalOutcome = rerankFailed ? "fallback" : "skip";
    return result;
  } catch (err) {
    console.error("brain search failed; returning no exemplars", safeErrorDetails(err));
    return { exemplars: [], degraded: true };
  } finally {
    await recordRerankOutcome(ctx, terminalOutcome, `brain:rerank${usageSuffix}`);
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
    ownCompanyProjectId: v.optional(v.id("projects")),
    userId: v.optional(v.string()),
    agentThreadId: v.optional(v.string()),
    usageLabel: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BrainSearchOutcome> => {
    return await searchBrainExemplars(ctx, args);
  },
});

/**
 * Defensive per-exemplar cap. Retrieved ranges are normally ~3 chunks (±1
 * chunk context) and land well under this; the cap only bites on a
 * pathological over-long chunk, so one exemplar can never flood a section
 * prompt. Generous on purpose — truncating healthy exemplars costs quality.
 */
export const BRAIN_MAX_EXEMPLAR_CHARS = 6000;

/**
 * Render exemplars into a prompt block. Framed as REFERENCE PATTERNS, never as
 * facts to copy — the analyzer/section prompts already forbid fabrication, and
 * these gold passages are for structure/voice/CRA-phrasing only.
 */
export function formatBrainExemplars(exemplars: BrainExemplar[]): string {
  if (!exemplars.length) return "";
  const blocks = exemplars
    .map((e, i) => {
      const labels = {
        title: e.title ?? null,
        scienceCode: e.scienceCode
          ? `${BRAIN_EXEMPLAR_SCAFFOLDS.scienceLabelPrefix}${scienceCodeLabel(e.scienceCode)}`
          : null,
        writerName: e.writerName
          ? `${BRAIN_EXEMPLAR_SCAFFOLDS.writerLabelPrefix}${e.writerName}`
          : null,
      };
      const label = BRAIN_EXEMPLAR_SCAFFOLDS.labelOrder
        .map((key) => labels[key])
        .filter(Boolean)
        .join(BRAIN_EXEMPLAR_SCAFFOLDS.labelSeparator);
      const text =
        e.text.length > BRAIN_MAX_EXEMPLAR_CHARS
          ? `${e.text.slice(0, BRAIN_MAX_EXEMPLAR_CHARS)}${BRAIN_EXEMPLAR_SCAFFOLDS.truncationSuffix}`
          : e.text;
      return `${BRAIN_EXEMPLAR_SCAFFOLDS.itemPrefix}${i + 1}${
        label
          ? `${BRAIN_EXEMPLAR_SCAFFOLDS.itemLabelOpen}${label}${BRAIN_EXEMPLAR_SCAFFOLDS.itemLabelClose}`
          : ""
      }${BRAIN_EXEMPLAR_SCAFFOLDS.itemSuffix}${text}`;
    })
    .join(BRAIN_EXEMPLAR_SCAFFOLDS.itemSeparator);
  // A bounded, versioned header is the only UI metadata boundary. Bodies are
  // untrusted reference prose and must never be scanned for source labels.
  const sources = exemplars.slice(0, 20).map(e => ({
    ...(e.title?.trim() ? { title: Array.from(e.title.trim()).slice(0, 240).join("") } : {}),
    ...(e.scienceCode ? { scienceCode: Array.from(`${BRAIN_EXEMPLAR_SCAFFOLDS.scienceLabelPrefix}${scienceCodeLabel(e.scienceCode)}`).slice(0, 160).join("") } : {}),
  }));
  return `BRAIN_SOURCES_V1:${JSON.stringify(sources)}\n${BRAIN_EXEMPLAR_SCAFFOLDS.blockPrefix}${blocks}`;
}
