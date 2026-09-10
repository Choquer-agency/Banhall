"use node";

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { GenerationClient } from "./openrouterCore";
import { generateStructured } from "./structured";
import { briefInputsHash } from "../lib/briefInputsHash";
import { citeQuote, type FrozenSource } from "../lib/citations";
import {
  flaggedGlossaryTerms,
  matchGlossaryTermsAcrossSources,
} from "../lib/glossaryMatcher";
import { MODEL } from "./model";

/**
 * Generation Brief derivation stage (story 1, CAP-1/2/4).
 *
 * A plain helper module, not a registered Convex function — same pattern as
 * `analyzerAgent.ts`'s `runAnalyzerAgent`. `deriveOrReuseBrief` is called
 * directly from `pipeline.ts`/`iterative.ts`, once per generation, right
 * after the shared analyzer call resolves. Its only reads/writes are the
 * `internal.generations.*` helpers next to `getGenerationInput` — the
 * exactly-two-writers rule from AD-23 (this stage, and `briefs.saveEntryEdit`)
 * is enforced there, not by this file being reachable via `internal.*`.
 *
 * **Reuse:** `inputsHash` (over frozen `generationSources`, excluding
 * `writer_storyline` and `transcript_digest`) is computed once; identical
 * inputs reuse the stored Brief at MAX(version) with no model call.
 *
 * **Citation validation:** every derived entry's quote is located verbatim in
 * a frozen source (never trusted offsets from the model) and re-validated
 * byte-for-byte at the write boundary; entries that can't be found are
 * dropped and counted, never inserted.
 *
 * **Writer-supplied Storyline:** frozen by `reserveGeneration` as a
 * `writer_storyline` generationSources row before this stage runs. When
 * present, the Brief stores it verbatim (origin `writer`) — never validated,
 * parsed, or turned into cited Storyline entries. Claim Exclusions,
 * Confidence Map and Glossary Terms are still derived from the other sources.
 *
 * **Glossary matcher + model classification:** `lib/glossaryMatcher.ts`'s
 * rule-based exact + inflected matching runs first and is authoritative for
 * any term it finds — those entries are never second-guessed by the model.
 * AD-27 caps this stage at one model call, so classification of the terms
 * the rules flag (`flaggedGlossaryTerms`: zero rule-based occurrences —
 * genuinely present but phrased as a synonym the inflection list doesn't
 * cover) can't be a second call; instead the same structured call already
 * asks the model for an optional citing `quote` per proposed term, and that
 * `quote` is only ever consulted for the flagged subset — a term the rules
 * already matched ignores the model's `quote` entirely. This is "model
 * classification only classifies candidates the matcher flags" without a
 * second `generation:brief` call.
 */

const CLAIM_EXCLUSION_REASONS = [
  "business_risk",
  "routine_engineering",
  "outside_claim_period",
  "not_technological",
] as const;
const CONFIDENCE_LEVELS = [
  "established",
  "partial",
  "unresolved",
  "unreliable",
] as const;

export interface BriefAgentOutput {
  storyline: string;
  storylineClaims: Array<{ text: string; quote: string }>;
  claimExclusions: Array<{
    text: string;
    quote: string;
    reason: (typeof CLAIM_EXCLUSION_REASONS)[number];
  }>;
  confidenceMap: Array<{
    text: string;
    quote: string;
    confidence: (typeof CONFIDENCE_LEVELS)[number];
  }>;
  glossaryTerms: Array<{
    term: string;
    inflections?: string[];
    // Model classification: an exact quote from the evidence where this
    // concept is expressed in different words. Only consulted for terms the
    // rule-based matcher flags (zero exact/inflected occurrences) — a term
    // the rules already matched never reaches this field.
    quote?: string;
  }>;
}

const briefOutputSchema: z.ZodType<BriefAgentOutput> = z.object({
  storyline: z.string().default(""),
  storylineClaims: z
    .array(z.object({ text: z.string(), quote: z.string() }))
    .default([]),
  claimExclusions: z
    .array(
      z.object({
        text: z.string(),
        quote: z.string(),
        reason: z.enum(CLAIM_EXCLUSION_REASONS),
      })
    )
    .default([]),
  confidenceMap: z
    .array(
      z.object({
        text: z.string(),
        quote: z.string(),
        confidence: z.enum(CONFIDENCE_LEVELS),
      })
    )
    .default([]),
  glossaryTerms: z
    .array(
      z.object({
        term: z.string(),
        inflections: z.array(z.string()).optional(),
        quote: z.string().optional(),
      })
    )
    .default([]),
});

export const BRIEF_SYSTEM_PROMPT = `You derive a Generation Brief for a Canadian SR&ED (Scientific Research & Experimental Development) project description, before any section is drafted.

The Brief has four parts:
1. Storyline — the most defensible narrative account of the project against the CRA's Five Questions (technological uncertainty, hypotheses, systematic investigation, technological advancement, records kept). Write it as flowing prose, then restate its individual claims with the exact supporting quote from the evidence.
2. Claim Exclusions — statements in the evidence that must NEVER be claimed as SR&ED work, however prominent, because they fall outside eligible work. Every exclusion needs a reason: business_risk, routine_engineering, outside_claim_period, or not_technological.
3. Confidence Map — the evidence's facts classified established (directly and clearly supported), partial (supported but incomplete or hedged), unresolved (evidence conflicts or is silent), or unreliable (the source itself is suspect, e.g. contradicts itself or another source).
4. Glossary Terms — the handful of technical phrases the project description should use consistently, one name per concept.

Rules:
- Every Storyline claim, Claim Exclusion, and Confidence Map entry MUST carry a "quote" field that is an EXACT, VERBATIM, character-for-character substring copied from the evidence below. Never paraphrase the quote, never invent one. An entry whose quote cannot be found verbatim in the evidence is discarded before it ever reaches the report — so a paraphrased quote is a wasted entry.
- Never fabricate a claim, exclusion, or fact absent from the evidence.
- Glossary terms are the canonical term string plus, optionally, inflected forms already used in the evidence verbatim (plurals, past tense) — those are matched back into the evidence separately by rule, so no quote is needed for them.
- Some concepts appear in the evidence only under a different phrasing than your canonical term (a genuine synonym, not just a plural or tense change) — for those, and ONLY those, also give a "quote" field: an exact, verbatim substring where that different phrasing appears. Leave "quote" empty for any term whose exact wording (or an obvious plural/past-tense form) is already present.
- Write in plain, specific, technical language. No filler, no marketing language.`;

export const BRIEF_REQUEST = {
  roleOrder: ["system", "user"],
  toolName: "submit_generation_brief",
  toolDescription:
    "Submit the derived Generation Brief: Storyline, Claim Exclusions, Confidence Map, Glossary Terms.",
  maxTokens: 8192,
} as const;

const strArray = { type: "array", items: { type: "string" } } as const;

export const BRIEF_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    storyline: {
      type: "string",
      description: "The full Storyline narrative, in flowing prose.",
    },
    storylineClaims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          quote: { type: "string", description: "Exact verbatim quote from the evidence." },
        },
        required: ["text", "quote"],
      },
    },
    claimExclusions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          quote: { type: "string" },
          reason: { type: "string", enum: [...CLAIM_EXCLUSION_REASONS] },
        },
        required: ["text", "quote", "reason"],
      },
    },
    confidenceMap: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          quote: { type: "string" },
          confidence: { type: "string", enum: [...CONFIDENCE_LEVELS] },
        },
        required: ["text", "quote", "confidence"],
      },
    },
    glossaryTerms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          inflections: strArray,
          quote: {
            type: "string",
            description:
              "Only when this term's exact wording (or an obvious plural/past-tense form) is NOT already present: an exact, verbatim quote showing a different phrasing of the same concept. Omit otherwise.",
          },
        },
        required: ["term"],
      },
    },
  },
  required: [
    "storyline",
    "storylineClaims",
    "claimExclusions",
    "confidenceMap",
    "glossaryTerms",
  ],
};

/** Pure model call — takes an already-assembled, pre-delimited user message. */
export async function runBriefAgent(
  client: GenerationClient,
  userMessage: string,
  model?: string
): Promise<BriefAgentOutput> {
  return await generateStructured<BriefAgentOutput>(client, {
    system: BRIEF_SYSTEM_PROMPT,
    user: userMessage,
    toolName: BRIEF_REQUEST.toolName,
    description: BRIEF_REQUEST.toolDescription,
    schema: BRIEF_SCHEMA,
    maxTokens: BRIEF_REQUEST.maxTokens,
    model,
    validate: briefOutputSchema,
  });
}

const BRIEF_TASK_GUIDANCE =
  "Derive the Generation Brief from the evidence below. Every quote you give must be an exact, verbatim substring of one of these blocks.";

/** AD-11 delimited data blocks: one per frozen evidence source. Never
 * includes a writer-supplied Storyline — that source is context for the
 * writer, not evidence to derive Claim Exclusions/Confidence Map/Glossary
 * from, and is never fed to this call. */
export function buildBriefUserMessage(
  sources: Array<Pick<Doc<"generationSources">, "label" | "content" | "kind">>
): string {
  const evidence = sources.filter((s) => s.kind !== "writer_storyline");
  const blocks = evidence
    .map(
      (s) =>
        `--- BEGIN [${s.label.toUpperCase()}] ---\n${s.content}\n--- END [${s.label.toUpperCase()}] ---`
    )
    .join("\n\n");
  return `${BRIEF_TASK_GUIDANCE}\n\n${blocks}`;
}

type CandidateEntry = {
  group: "storyline" | "claimExclusion" | "confidenceMap" | "glossaryTerm";
  text: string;
  reason?: (typeof CLAIM_EXCLUSION_REASONS)[number];
  confidence?: (typeof CONFIDENCE_LEVELS)[number];
  sourceId: Id<"generationSources">;
  sourceContentHash: string;
  startOffset: number;
  endOffset: number;
  exactExcerpt: string;
};

/**
 * The stage: compute inputsHash, reuse the stored Brief when inputs are
 * unchanged, otherwise run one structured call and persist the result.
 * Returns the Brief id, or `undefined` if the generation has no evidence to
 * derive from (never expected in practice — `reserveGeneration` requires at
 * least one readable source).
 */
export async function deriveOrReuseBrief(
  ctx: ActionCtx,
  client: GenerationClient,
  args: {
    projectId: Id<"projects">;
    generationId: Id<"generations">;
    model?: string;
  }
): Promise<Id<"generationBriefs"> | undefined> {
  const sources = await ctx.runQuery(
    internal.generations.getGenerationSourcesForBrief,
    { generationId: args.generationId }
  );
  if (sources.length === 0) return undefined;

  const inputsHash = await briefInputsHash(sources);
  const reusable = await ctx.runQuery(internal.generations.findReusableBrief, {
    projectId: args.projectId,
    inputsHash,
  });
  if (reusable) {
    await ctx.runMutation(internal.generations.stampGenerationBriefId, {
      generationId: args.generationId,
      briefId: reusable._id,
    });
    return reusable._id;
  }

  const writerSource = sources.find((s) => s.kind === "writer_storyline");
  const evidenceSources: FrozenSource[] = sources.filter(
    (s) => s.kind !== "writer_storyline"
  );

  const model = args.model ?? MODEL;
  const output = await runBriefAgent(
    client,
    buildBriefUserMessage(sources),
    model
  );

  const candidateEntries: CandidateEntry[] = [];
  // Block-If: "a derived entry's citation fails the byte-match — the entry
  // is dropped and the drop counted on the Brief; the generation continues."
  // Counted here (the quote never even resolved to a citation) and again by
  // `persistDerivedBrief`'s own re-validation (defense in depth).
  let upstreamDroppedEntryCount = 0;

  // Writer-supplied Storyline: never validated, parsed, or turned into
  // cited entries — stored verbatim on the Brief row itself.
  if (!writerSource) {
    for (const claim of output.storylineClaims) {
      const citation = citeQuote(evidenceSources, claim.quote);
      if (!citation) {
        upstreamDroppedEntryCount += 1;
        continue;
      }
      candidateEntries.push({
        group: "storyline",
        text: claim.text,
        sourceId: citation.sourceId,
        sourceContentHash: citation.sourceContentHash,
        startOffset: citation.startOffset,
        endOffset: citation.endOffset,
        exactExcerpt: citation.exactExcerpt,
      });
    }
  }
  for (const exclusion of output.claimExclusions) {
    const citation = citeQuote(evidenceSources, exclusion.quote);
    if (!citation) {
      upstreamDroppedEntryCount += 1;
      continue;
    }
    candidateEntries.push({
      group: "claimExclusion",
      text: exclusion.text,
      reason: exclusion.reason,
      sourceId: citation.sourceId,
      sourceContentHash: citation.sourceContentHash,
      startOffset: citation.startOffset,
      endOffset: citation.endOffset,
      exactExcerpt: citation.exactExcerpt,
    });
  }
  for (const fact of output.confidenceMap) {
    const citation = citeQuote(evidenceSources, fact.quote);
    if (!citation) {
      upstreamDroppedEntryCount += 1;
      continue;
    }
    candidateEntries.push({
      group: "confidenceMap",
      text: fact.text,
      confidence: fact.confidence,
      sourceId: citation.sourceId,
      sourceContentHash: citation.sourceContentHash,
      startOffset: citation.startOffset,
      endOffset: citation.endOffset,
      exactExcerpt: citation.exactExcerpt,
    });
  }
  const glossaryMatches = matchGlossaryTermsAcrossSources(
    output.glossaryTerms,
    evidenceSources
  );
  for (const match of glossaryMatches) {
    candidateEntries.push({
      group: "glossaryTerm",
      text: match.text,
      sourceId: match.sourceId,
      sourceContentHash: match.sourceContentHash,
      startOffset: match.startOffset,
      endOffset: match.endOffset,
      exactExcerpt: match.text,
    });
  }
  // Model classification, flagged candidates only (Boundaries: "model
  // classification only classifies candidates the matcher flags"). A term
  // the rule-based matcher already found above never reaches this branch —
  // it is never re-litigated by a possibly-hallucinated model quote. AD-27
  // caps the stage at one call, so this reads the SAME call's own optional
  // `quote` field rather than making a second one; a flagged term the model
  // didn't classify (no quote) is simply absent, not dropped — it was never
  // a proposed entry to begin with.
  const flagged = flaggedGlossaryTerms(output.glossaryTerms, evidenceSources);
  for (const term of flagged) {
    const classified = output.glossaryTerms.find(
      (t) => t.term.toLowerCase() === term.term.toLowerCase()
    );
    if (!classified?.quote) continue;
    const citation = citeQuote(evidenceSources, classified.quote);
    if (!citation) {
      upstreamDroppedEntryCount += 1;
      continue;
    }
    candidateEntries.push({
      group: "glossaryTerm",
      text: classified.term,
      sourceId: citation.sourceId,
      sourceContentHash: citation.sourceContentHash,
      startOffset: citation.startOffset,
      endOffset: citation.endOffset,
      exactExcerpt: citation.exactExcerpt,
    });
  }

  const storylineText = writerSource ? writerSource.content : output.storyline;
  const origin = writerSource ? ("writer" as const) : ("derived" as const);

  const briefId = await ctx.runMutation(internal.generations.persistDerivedBrief, {
    projectId: args.projectId,
    generationId: args.generationId,
    inputsHash,
    origin,
    storylineText,
    entries: candidateEntries,
    upstreamDroppedEntryCount,
  });
  return briefId;
}
