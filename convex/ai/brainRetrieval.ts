"use node";

// BNH-10: section-scoped Brain retrieval, shared by the one-shot pipeline
// (convex/ai/pipeline.ts) and the iterative section-by-section flow
// (convex/ai/iterative.ts). Extracted verbatim from generateReport so both
// entry points freeze the exact same exemplar blocks once per generation.

import type Anthropic from "@anthropic-ai/sdk";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { formatBrainExemplars } from "./brain/retrieve";
import { buildRetrievalBrief } from "./brain/query";

/**
 * Per-consumer Brain exemplar prompt blocks — each drafter sees exemplars of
 * ITS OWN section, not a shared blob (uncertainty framing is useless to the
 * work-performed narrative). Empty string = no exemplars for that consumer.
 */
export type BrainExemplarBlocks = {
  analyzer: string;
  s242: string;
  s244: string;
  s246: string;
};

export const EMPTY_BRAIN_BLOCKS: BrainExemplarBlocks = {
  analyzer: "",
  s242: "",
  s244: "",
  s246: "",
};

/**
 * Pull gold-standard reference passages from The Brain once per generation.
 * A good PD is a good PD — retrieval runs with or without an industry;
 * industry narrows it. Wrapped so the Brain can NEVER break generation.
 *
 * Retrieval is section-scoped: a cheap Haiku pre-pass distills the transcript
 * into four report-register queries (raw transcripts retrieve on greetings
 * and client names, not the rhetorical patterns drafters need), then each
 * T661 section gets exemplars of ITSELF — uncertainty framing for 242, work
 * narration for 244, advancement claims for 246. Searches run sequentially on
 * purpose: Voyage rate limits bite when embed+rerank calls burst in parallel.
 *
 * Persists brain provenance on the generation row and appends progress-log
 * lines; never throws.
 */
export async function retrieveBrainBlocks(
  ctx: ActionCtx,
  params: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    title: string;
    transcript: string;
    industry?: string | null;
    scienceCode?: string | null;
    retrievalBriefClient: Anthropic;
    log: (line: string) => Promise<unknown>;
  }
): Promise<BrainExemplarBlocks> {
  const brainBlocks: BrainExemplarBlocks = { ...EMPTY_BRAIN_BLOCKS };
  const brainContext = {
    industry: params.industry ?? null,
    scienceCode: params.scienceCode ?? null,
  };
  try {
    const brief = await buildRetrievalBrief(
      params.retrievalBriefClient,
      params.title,
      params.transcript
    );
    const fallbackQuery = `${params.title}\n\n${params.transcript.slice(0, 2000)}`;
    const retrievals: {
      block: keyof BrainExemplarBlocks;
      section: string;
      query: string;
      k: number;
    }[] = [
      {
        block: "analyzer",
        section: "analyzer",
        query: brief ? brief.problem : fallbackQuery,
        k: 4,
      },
      {
        block: "s242",
        section: "242",
        query: brief ? `${brief.uncertainty}\n\n${brief.problem}` : fallbackQuery,
        k: 3,
      },
      {
        block: "s244",
        section: "244",
        query: brief ? `${brief.work}\n\n${brief.problem}` : fallbackQuery,
        k: 3,
      },
      {
        block: "s246",
        section: "246",
        query: brief ? `${brief.advancement}\n\n${brief.problem}` : fallbackQuery,
        k: 3,
      },
    ];

    const provenance: {
      section: string;
      entryId: string;
      sourceId?: string;
      score: number;
      searchScore?: number;
      rerankScore?: number;
      title?: string;
      writerName?: string;
    }[] = [];
    let anyDegraded = false;
    for (const r of retrievals) {
      const outcome = await ctx.runAction(
        internal.ai.brain.retrieve.retrieveBrainContext,
        {
          ...(brainContext.industry ? { industry: brainContext.industry } : {}),
          ...(brainContext.scienceCode
            ? { scienceCode: brainContext.scienceCode }
            : {}),
          query: r.query,
          k: r.k,
          docType: "pd",
          projectId: params.projectId,
          usageLabel: r.section,
        }
      );
      anyDegraded = anyDegraded || outcome.degraded;
      brainBlocks[r.block] = formatBrainExemplars(outcome.exemplars);
      for (const e of outcome.exemplars) {
        provenance.push({
          section: r.section,
          entryId: e.entryId,
          sourceId: e.sourceId,
          score: e.score,
          searchScore: e.searchScore,
          rerankScore: e.rerankScore,
          title: e.title,
          writerName: e.writerName,
        });
      }
    }

    if (provenance.length > 0) {
      await ctx.runMutation(internal.generations.setBrainProvenance, {
        generationId: params.generationId,
        exemplars: provenance,
        brief: brief ? JSON.stringify(brief) : undefined,
      });
      const perSection = ["242", "244", "246"]
        .map((s) => `${s}: ${provenance.filter((p) => p.section === s).length}`)
        .join(", ");
      await params.log(
        `Pulled ${provenance.length} reference pattern(s) from The Brain${
          brainContext.industry ? ` (${brainContext.industry})` : " (all industries)"
        } — ${perSection}.`
      );
    } else if (anyDegraded) {
      await params.log(
        "The Brain was unreachable — drafting without reference patterns."
      );
    } else {
      await params.log(
        "No sufficiently similar past reports in The Brain — drafting without reference patterns."
      );
    }
  } catch (err) {
    // Never fail the report on Brain issues — but never hide them either.
    console.error("brain retrieval failed for generation", params.generationId, err);
    await params
      .log("The Brain was unreachable — drafting without reference patterns.")
      .catch(() => {});
  }
  return brainBlocks;
}
