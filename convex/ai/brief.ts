"use node";

import { z } from "zod";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  BRIEF_BASELINE_PAGE_BYTES,
  MAX_BRIEF_ENTRY_ROWS,
  briefDiffKey,
} from "../generations";
import type { GenerationClient } from "./openrouterCore";
import {
  BRIEF_REQUEST,
  BRIEF_SCHEMA,
  BRIEF_SYSTEM_PROMPT,
  CLAIM_EXCLUSION_REASONS,
  CONFIDENCE_LEVELS,
  buildBriefUserMessage,
} from "../lib/briefRequest";
import { normalizeProviderError, preparationClientForStep, startActionDeadline } from "./providers";
import { resolveGenerationStep } from "../lib/generationSteps";
import {
  appendPreparationFactsRef,
  completePreparationRef,
  failPreparationRef,
  getPreparationCitationSpeakersRef,
  getPreparationRunRef,
} from "../lib/briefPreparationRefs";
import { generateStructured } from "./structured";
import { briefInputsHash } from "../lib/briefInputsHash";
import {
  BRIEF_OUTCOME_DETAIL_CHARS,
  type BriefOutcome,
} from "../lib/briefRender";
import {
  citeQuote,
  quoteOccurrences,
  type Citation,
  type FrozenSource,
} from "../lib/citations";
import { mayMoveQuote, type CitationSpeaker } from "../lib/citationSpeakers";
import { citeFactQuote, readsFactPacks } from "../lib/seedFacts";
import {
  flaggedGlossaryTerms,
  matchGlossaryTermsAcrossSources,
} from "../lib/glossaryMatcher";
import { MODEL } from "./model";
import { createReadingFactsCollector, type ReadingFactsTarget } from "../lib/readingFacts";
import type { PlaceholderMap } from "../lib/deidentify";

/**
 * Generation Brief derivation stage (story 1, CAP-1/2/4).
 *
 * A plain helper module, not a registered Convex function — same pattern as
 * `analyzerAgent.ts`'s `runAnalyzerAgent`. `runGenerationBriefStage` is called
 * directly from `pipeline.ts`/`iterative.ts`, once per generation, right
 * after the shared analyzer call resolves; it runs `deriveOrReuseBrief` and
 * records the attempt's outcome. Its only reads/writes are the
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

export {
  BRIEF_INPUT_BUDGET,
  BRIEF_OMITTED_SOURCES_NOTICE,
  BRIEF_REQUEST,
  BRIEF_SCHEMA,
  BRIEF_SYSTEM_PROMPT,
  briefOmittedSourcesNotice,
  buildBriefUserMessage,
} from "../lib/briefRequest";

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

/** Pure model call — takes an already-assembled, pre-delimited user message.
 * `onPartialToolInput` (Step-by-step startup only, decision 57) streams the
 * first attempt; the request then gains `stream: true` and nothing else. */
export async function runBriefAgent(
  client: GenerationClient,
  userMessage: string,
  model?: string,
  onPartialToolInput?: (json: string) => void
): Promise<BriefAgentOutput> {
  return await generateStructured<BriefAgentOutput>(client, {
    ...(onPartialToolInput ? { onPartialToolInput } : {}),
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

/** The only database access the publish path needs — an action's, or a test
 * adapter over `t.query`/`t.mutation`. */
export type BriefPublishCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

/** Publish attempts before a derivation whose baseline keeps moving gives up. */
export const BRIEF_PUBLISH_ATTEMPTS = 3;

type PersistDerivedBriefArgs = FunctionArgs<
  typeof internal.generations.persistDerivedBrief
>;
type BaselineRetained = PersistDerivedBriefArgs["baselineRetained"][number];
type BaselineRemoved = PersistDerivedBriefArgs["baselineRemoved"][number];

/**
 * The complete diff baseline for a new derivation, already compared with its
 * candidates: the project's newest Brief (pinned by id) and every one of its
 * live rows, however many there are, partitioned by `briefDiffKey`.
 *
 * Each page is its own bounded query transaction (`getBriefDiffBaselinePage`),
 * so no single read grows with the Brief. A `SplitRequired` page may be
 * incomplete, so it is discarded and re-read from the same cursor with half
 * as many rows; a one-row page that still reports it cannot be read within
 * the byte budget and throws. The baseline is complete only when an accepted
 * page reports `isDone` — never a prefix, never a refusal by size.
 *
 * Only compact results outlive a page. A live key some candidate shares keeps
 * a `retained` reference (the row id and the first such candidate's index) and
 * its old text is dropped with the page; a live key no candidate shares keeps
 * its full payload in `removed`, because it becomes a marker. As in the
 * mutation, the last row with a key wins.
 */
export async function readCompleteBriefDiffBaseline(
  ctx: BriefPublishCtx,
  projectId: Id<"projects">,
  candidates: ReadonlyArray<Parameters<typeof briefDiffKey>[0]>
): Promise<{
  briefId: Id<"generationBriefs"> | null;
  retained: BaselineRetained[];
  removed: BaselineRemoved[];
}> {
  const briefId = await ctx.runQuery(internal.generations.getBriefDiffBaselineId, {
    projectId,
  });
  if (briefId === null) return { briefId: null, retained: [], removed: [] };

  const candidateIndexByKey = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    const key = briefDiffKey(candidate);
    if (!candidateIndexByKey.has(key)) candidateIndexByKey.set(key, index);
  });
  const retainedByKey = new Map<string, BaselineRetained>();
  const removedByKey = new Map<string, BaselineRemoved>();
  let cursor: string | null = null;
  let numItems = MAX_BRIEF_ENTRY_ROWS;
  for (;;) {
    const page: FunctionReturnType<typeof internal.generations.getBriefDiffBaselinePage> =
      await ctx.runQuery(internal.generations.getBriefDiffBaselinePage, {
        briefId,
        cursor,
        numItems,
      });
    if (page.pageStatus === "SplitRequired") {
      if (numItems <= 1) {
        throw new Error(
          `Generation Brief ${briefId} diff baseline: one row exceeds the ${BRIEF_BASELINE_PAGE_BYTES}-byte page budget`
        );
      }
      numItems = Math.max(1, Math.floor(numItems / 2));
      continue;
    }
    for (const { entryId, ...payload } of page.entries) {
      const key = briefDiffKey(payload);
      const candidateIndex = candidateIndexByKey.get(key);
      if (candidateIndex === undefined) removedByKey.set(key, payload);
      else retainedByKey.set(key, { entryId, candidateIndex });
    }
    if (page.isDone) {
      return {
        briefId,
        retained: [...retainedByKey.values()],
        removed: [...removedByKey.values()],
      };
    }
    if (page.continueCursor === cursor) {
      throw new Error(
        `Generation Brief ${briefId} diff baseline: a page made no progress`
      );
    }
    cursor = page.continueCursor;
  }
}

/**
 * Publish one derived Brief version against a complete, fenced baseline.
 *
 * Reads and compares the baseline (`readCompleteBriefDiffBaseline`), then
 * publishes the whole version in one `persistDerivedBrief` mutation that
 * first adopts and returns the latest same-key Brief when one exists. If no
 * same-key Brief exists, persistence checks that the pinned Brief is still
 * the project's newest. Its argument carries references, not text, for
 * baseline keys the candidates reuse, so it stays bounded by what the new
 * version writes rather than by the old version's size. If a different-key
 * version was published in between, that mutation writes nothing and returns
 * `null`; the baseline is re-read and the same candidates are re-published.
 * The model is never re-run. After `BRIEF_PUBLISH_ATTEMPTS` lost fences it
 * throws under the derivation's existing fail-open catch, and no version from
 * this derivation exists.
 */
export async function publishDerivedBrief(
  ctx: BriefPublishCtx,
  args: Omit<
    PersistDerivedBriefArgs,
    "baselineBriefId" | "baselineRetained" | "baselineRemoved"
  >
): Promise<Id<"generationBriefs">> {
  for (let attempt = 1; attempt <= BRIEF_PUBLISH_ATTEMPTS; attempt += 1) {
    const baseline = args.seedStartup
      ? { briefId: null, retained: [], removed: [] }
      : await readCompleteBriefDiffBaseline(ctx, args.projectId, args.entries);
    const briefId: Id<"generationBriefs"> | null = await ctx.runMutation(
      internal.generations.persistDerivedBrief,
      {
        ...args,
        baselineBriefId: baseline.briefId,
        baselineRetained: baseline.retained,
        baselineRemoved: baseline.removed,
      }
    );
    if (briefId !== null) return briefId;
  }
  throw new Error(
    `Generation Brief for generation ${args.generationId} not published: the project's newest Brief changed during each of ${BRIEF_PUBLISH_ATTEMPTS} attempts`
  );
}

type BriefEntryGroup = "storyline" | "claimExclusion" | "confidenceMap" | "glossaryTerm";

/**
 * One located, speaker-checked Brief entry, citing a row of the evidence it
 * was derived from: a generation's `generationSources` row, or a Brief
 * preparation's `briefPreparationSources` row (decision 65).
 */
export type BriefCandidate<I extends string = Id<"generationSources">> = {
  group: BriefEntryGroup;
  text: string;
  reason?: (typeof CLAIM_EXCLUSION_REASONS)[number];
  confidence?: (typeof CONFIDENCE_LEVELS)[number];
  sourceId: I;
  sourceContentHash: string;
  startOffset: number;
  endOffset: number;
  exactExcerpt: string;
};

/** A frozen evidence row one Brief derivation reads. */
export type BriefSourceRow<I extends string = Id<"generationSources">> = Pick<
  Doc<"generationSources">,
  "kind" | "label" | "content" | "contentHash" | "transcriptId" | "factSpans"
> & { _id: I };

/** One span whose speaker verdict (owner decision 25) is asked for. */
export type BriefSpeakerSpan<I extends string> = {
  sourceId: I;
  startOffset: number;
  endOffset: number;
  movedFrom?: { startOffset: number; endOffset: number };
};

/**
 * The source adapter (2026-09-26, decision 65): the evidence one Brief
 * derivation reads and how its speaker rule is read. A generation's adapter
 * reads its frozen `generationSources`; a preparation's reads its frozen
 * `briefPreparationSources`. Everything else (the request, quote matching,
 * relocation and the speaker rule) is this module's one implementation.
 */
export type BriefSourceAdapter<I extends string = Id<"generationSources">> = {
  sources: ReadonlyArray<BriefSourceRow<I>>;
  /** Verdicts for spans on transcript rows, in order; at most CITATION_SPEAKER_BATCH per call. */
  speakers: (spans: BriefSpeakerSpan<I>[]) => Promise<CitationSpeaker[]>;
};

/** A derivation's result before publication. */
export type DerivedBriefCandidates<I extends string = Id<"generationSources">> = {
  storylineText: string;
  origin: "writer" | "derived";
  entries: BriefCandidate<I>[];
  upstreamDroppedEntryCount: number;
};

type BriefStageArgs = {
  seedStartup?: boolean;
  projectId: Id<"projects">;
  generationId: Id<"generations">;
  model?: string;
};

/** What `deriveOrReuseBrief` did when it did not throw. */
export type BriefStageAttempt =
  | { kind: "derived" | "reused"; briefId: Id<"generationBriefs"> }
  | { kind: "no_evidence" };

/** Places of one quote tried under owner decision 25 before it is dropped. */
const MAX_QUOTE_PLACES = 8;
/** Spans per `getCitationSpeakers` call; it accepts at most 250 (MAX_CITATION_SPEAKER_SPANS). */
export const CITATION_SPEAKER_BATCH = 250;

/** A generation's adapter: its frozen rows and `generations.getCitationSpeakers`. */
export function generationBriefAdapter(
  ctx: BriefPublishCtx,
  generationId: Id<"generations">,
  sources: ReadonlyArray<BriefSourceRow>
): BriefSourceAdapter {
  return {
    sources,
    speakers: async (spans) =>
      await ctx.runQuery(internal.generations.getCitationSpeakers, { generationId, spans }),
  };
}

/**
 * Owner decision 25 verdicts for candidate places on transcript rows, one
 * query per batch. Places on any other row are not asked about and read as
 * `unchecked` (no entry in the map). In an `anchored` group every place
 * after the first is a new place for the first one's words: it counts only
 * on the same row and near that place (review 2026-09-25, P2-3). Glossary
 * terms are not anchored: a term the client used anywhere is theirs.
 */
async function citationSpeakersFor<I extends string>(
  adapter: BriefSourceAdapter<I>,
  groups: ReadonlyArray<{ places: readonly Citation<I>[]; anchored: boolean }>
): Promise<Map<Citation<I>, CitationSpeaker>> {
  const transcriptRows = new Set<string>(
    adapter.sources.filter((source) => source.kind === "transcript").map((source) => source._id)
  );
  const verdicts = new Map<Citation<I>, CitationSpeaker>();
  const asked: Array<{ place: Citation<I>; movedFrom?: Citation<I> }> = [];
  for (const { places, anchored } of groups) {
    const [first] = places;
    for (const place of places) {
      if (anchored && place !== first && place.sourceId !== first.sourceId) {
        verdicts.set(place, "excluded");
      } else if (transcriptRows.has(place.sourceId)) {
        asked.push({ place, ...(anchored && place !== first ? { movedFrom: first } : {}) });
      }
    }
  }
  for (let at = 0; at < asked.length; at += CITATION_SPEAKER_BATCH) {
    const batch = asked.slice(at, at + CITATION_SPEAKER_BATCH);
    const answers = await adapter.speakers(
      batch.map(({ place, movedFrom }) => ({
        sourceId: place.sourceId,
        startOffset: place.startOffset,
        endOffset: place.endOffset,
        ...(movedFrom
          ? { movedFrom: { startOffset: movedFrom.startOffset, endOffset: movedFrom.endOffset } }
          : {}),
      }))
    );
    batch.forEach(({ place }, index) => verdicts.set(place, answers[index]));
  }
  return verdicts;
}

/**
 * The evidence views every step of one derivation shares: which rows a
 * quote may cite, and the fact-mode citation rule.
 */
function briefEvidence<I extends string>(adapter: BriefSourceAdapter<I>) {
  const sources = [...adapter.sources];
  const writerSource = sources.find((s) => s.kind === "writer_storyline");
  // 2026-09-24 (transcript method, plan step 8): a Brief derived from fact
  // packs cites what the packs show on the frozen transcript row, inside a
  // verified client span (owner decision 25), and a document by its own
  // text; a pack or digest row is never cited. Otherwise, as before, a
  // quote cites the first frozen source that holds it.
  const factMode = readsFactPacks(sources);
  const evidenceSources: FrozenSource<I>[] = sources.filter(
    (s) =>
      s.kind !== "writer_storyline" &&
      s.kind !== "transcript_facts" &&
      !(factMode && s.kind === "transcript_digest")
  );
  const documentSources: FrozenSource<I>[] = sources.filter(
    (s) => s.kind !== "writer_storyline" && s.kind !== "transcript" && s.kind !== "transcript_facts" && s.kind !== "transcript_digest"
  );
  const citeInFactMode = (quote: string): Citation<I> | null => {
    const fact = citeFactQuote(
      sources.map((s) => ({
        sourceId: s._id,
        kind: s.kind,
        content: s.content,
        contentHash: s.contentHash,
        transcriptId: s.transcriptId,
        factSpans: s.factSpans,
      })),
      quote
    );
    if (fact) {
      return {
        sourceId: fact.sourceId as I,
        sourceContentHash: fact.sourceContentHash,
        exactExcerpt: fact.exactExcerpt,
        startOffset: fact.startOffset,
        endOffset: fact.endOffset,
      };
    }
    return citeQuote(documentSources, quote);
  };
  return { sources, writerSource, factMode, evidenceSources, citeInFactMode };
}

/**
 * Where a streamed entry's quote sits, owner decision 25 applied, the way
 * publication locates it; null when it does not locate. Feeds the display
 * only (decision 57).
 */
export function briefQuoteLocator<I extends string>(adapter: BriefSourceAdapter<I>) {
  const { factMode, evidenceSources, citeInFactMode } = briefEvidence(adapter);
  return async (quote: string, glossary: boolean): Promise<Citation<I> | null> => {
    if (factMode) return citeInFactMode(quote);
    let candidates = quoteOccurrences(
      evidenceSources,
      quote,
      mayMoveQuote(quote) ? MAX_QUOTE_PLACES : 1
    );
    if (!candidates.length && glossary) candidates = termOccurrence(evidenceSources, quote);
    if (!candidates.length) return null;
    const verdicts = await citationSpeakersFor(adapter, [
      { places: candidates, anchored: !glossary },
    ]);
    return candidates.find((place) => verdicts.get(place) !== "excluded") ?? null;
  };
}

/**
 * Shared operation "run the model": one structured Brief call over the
 * adapter's evidence. The request is `buildBriefUserMessage(sources)` under
 * the Brief prompt and tool; masking and usage belong to `client`, which
 * the caller builds with its placeholders and attribution. With
 * `onToolInput` the first attempt streams (decision 57) and nothing else
 * about the request changes.
 */
export async function runBriefRequest<I extends string>(
  adapter: BriefSourceAdapter<I>,
  client: GenerationClient,
  model: string,
  onToolInput?: (json: string) => void
): Promise<BriefAgentOutput> {
  return await runBriefAgent(client, buildBriefUserMessage([...adapter.sources]), model, onToolInput);
}

/**
 * Shared operation "locate and validate entries": every quote the model
 * gave, cited on the adapter's rows under owner decision 25, with the
 * writer-supplied Storyline rule and the glossary matcher applied. Entries
 * that do not locate are dropped and counted.
 */
export async function briefCandidatesFromOutput<I extends string>(
  adapter: BriefSourceAdapter<I>,
  output: BriefAgentOutput
): Promise<DerivedBriefCandidates<I>> {
  const { writerSource, factMode, evidenceSources, citeInFactMode } = briefEvidence(adapter);

  // Owner decision 25 (2026-09-25): a quote that is only the interviewer's
  // or another speaker's words never backs an entry. Each quote is cited at
  // its first place, as before, unless the stored speaker turns say that
  // place is not evidence; then the next place with the same words wins,
  // and a quote with none is dropped and counted. Transcripts without
  // stored turns, documents and digests keep the first place. Facts mode
  // already cites verified client spans; its glossary matches are checked.
  const places = new Map<string, Citation<I>[]>();
  if (!factMode) {
    const quotes = [
      ...(writerSource ? [] : output.storylineClaims.map((claim) => claim.quote)),
      ...output.claimExclusions.map((exclusion) => exclusion.quote),
      ...output.confidenceMap.map((fact) => fact.quote),
      ...output.glossaryTerms.flatMap((term) => (term.quote ? [term.quote] : [])),
    ];
    for (const quote of quotes) {
      if (!places.has(quote)) {
        // A short quote never moves off an excluded place (review
        // 2026-09-25, P2-3): only its first place is tried.
        const limit = mayMoveQuote(quote) ? MAX_QUOTE_PLACES : 1;
        places.set(quote, quoteOccurrences(evidenceSources, quote, limit));
      }
    }
  }
  const glossaryMatches = matchGlossaryTermsAcrossSources(
    output.glossaryTerms,
    evidenceSources
  );
  const glossaryPlaces = glossaryMatches.map((match) => {
    const first: Citation<I> = {
      sourceId: match.sourceId,
      sourceContentHash: match.sourceContentHash,
      startOffset: match.startOffset,
      endOffset: match.endOffset,
      exactExcerpt: match.text,
    };
    return [
      first,
      ...quoteOccurrences(evidenceSources, match.text, MAX_QUOTE_PLACES).filter(
        (place) =>
          place.sourceId !== first.sourceId || place.startOffset !== first.startOffset
      ),
    ];
  });
  const speakerAt = await citationSpeakersFor(adapter, [
    ...[...places.values()].map((candidates) => ({ places: candidates, anchored: true })),
    ...glossaryPlaces.map((candidates) => ({ places: candidates, anchored: false })),
  ]);
  const firstEvidence = (candidates: readonly Citation<I>[]): Citation<I> | null =>
    candidates.find((place) => speakerAt.get(place) !== "excluded") ?? null;
  const cite = (quote: string): Citation<I> | null => {
    if (factMode) return citeInFactMode(quote);
    const candidates = places.get(quote);
    return candidates ? firstEvidence(candidates) : citeQuote(evidenceSources, quote);
  };

  const candidateEntries: BriefCandidate<I>[] = [];
  // Block-If: "a derived entry's citation fails the byte-match — the entry
  // is dropped and the drop counted on the Brief; the generation continues."
  // Counted here (the quote never even resolved to a citation) and again by
  // `persistDerivedBrief`'s own re-validation (defense in depth).
  let upstreamDroppedEntryCount = 0;
  const push = (
    group: BriefEntryGroup,
    text: string,
    citation: Citation<I> | null,
    extra: Pick<BriefCandidate<I>, "reason" | "confidence"> = {}
  ) => {
    if (!citation) {
      upstreamDroppedEntryCount += 1;
      return;
    }
    candidateEntries.push({
      group,
      text,
      ...extra,
      sourceId: citation.sourceId,
      sourceContentHash: citation.sourceContentHash,
      startOffset: citation.startOffset,
      endOffset: citation.endOffset,
      exactExcerpt: citation.exactExcerpt,
    });
  };

  // Writer-supplied Storyline: never validated, parsed, or turned into
  // cited entries, stored verbatim on the Brief row itself.
  if (!writerSource) {
    for (const claim of output.storylineClaims) push("storyline", claim.text, cite(claim.quote));
  }
  for (const exclusion of output.claimExclusions) {
    push("claimExclusion", exclusion.text, cite(exclusion.quote), { reason: exclusion.reason });
  }
  for (const fact of output.confidenceMap) {
    push("confidenceMap", fact.text, cite(fact.quote), { confidence: fact.confidence });
  }
  glossaryMatches.forEach((match, index) => {
    push("glossaryTerm", match.canonicalTerm, firstEvidence(glossaryPlaces[index]));
  });
  // Model classification, flagged candidates only (Boundaries: "model
  // classification only classifies candidates the matcher flags"). A term
  // the rule-based matcher already found above never reaches this branch —
  // it is never re-litigated by a possibly-hallucinated model quote. AD-27
  // caps the stage at one call, so this reads the SAME call's own optional
  // `quote` field rather than making a second one; a flagged term the model
  // didn't classify (no quote) is simply absent, not dropped — it was never
  // a proposed entry to begin with.
  const flagged = flaggedGlossaryTerms(output.glossaryTerms, evidenceSources);
  // The model can echo the same term twice in its own output; flaggedGlossaryTerms
  // filters by match status, not uniqueness, so dedupe by canonical term here too
  // (mirrors matchGlossaryTermsAcrossSources' "at most one entry per canonical term").
  const classifiedCanonicalTerms = new Set<string>();
  for (const term of flagged) {
    const canonicalTerm = term.term.toLowerCase();
    if (classifiedCanonicalTerms.has(canonicalTerm)) continue;
    const classified = output.glossaryTerms.find(
      (t) => t.term.toLowerCase() === canonicalTerm
    );
    if (!classified?.quote) continue;
    classifiedCanonicalTerms.add(canonicalTerm);
    push("glossaryTerm", classified.term, cite(classified.quote));
  }

  return {
    storylineText: writerSource ? writerSource.content : output.storyline,
    origin: writerSource ? "writer" : "derived",
    entries: candidateEntries,
    upstreamDroppedEntryCount,
  };
}

/**
 * Shared operations "run the model" and "locate and validate entries" in
 * one: the model call, the optional display stream of located entries
 * (decision 57; `readingFacts` says where they are written), then every
 * entry located and speaker-checked. Publication is the caller's.
 */
export async function deriveBriefCandidates<I extends string>(
  adapter: BriefSourceAdapter<I>,
  client: GenerationClient,
  args: {
    model: string;
    readingFacts?: { target: ReadingFactsTarget; placeholders: PlaceholderMap };
  }
): Promise<DerivedBriefCandidates<I>> {
  const readingFacts = args.readingFacts
    ? createReadingFactsCollector({
        ...args.readingFacts.target,
        sources: adapter.sources,
        writerStoryline: adapter.sources.some((s) => s.kind === "writer_storyline"),
        placeholders: args.readingFacts.placeholders,
        locate: briefQuoteLocator(adapter),
      })
    : null;
  let output: BriefAgentOutput;
  try {
    output = await runBriefRequest(adapter, client, args.model, readingFacts?.onToolInput);
  } finally {
    await readingFacts?.finish();
  }
  return await briefCandidatesFromOutput(adapter, output);
}

/**
 * The stage: compute inputsHash, reuse the stored Brief when inputs are
 * unchanged, otherwise run one structured call and persist the result.
 * Returns which of those happened with the Brief id, or `no_evidence` if the
 * generation has no frozen sources to derive from (never expected in
 * practice: `reserveGeneration` requires at least one readable source).
 * Throws on any failure; `runGenerationBriefStage` is its only caller.
 */
export async function deriveOrReuseBrief(
  ctx: BriefPublishCtx,
  client: GenerationClient,
  args: BriefStageArgs
): Promise<BriefStageAttempt> {
  const sources = await ctx.runQuery(
    internal.generations.getGenerationSourcesForBrief,
    { generationId: args.generationId }
  );
  if (sources.length === 0) return { kind: "no_evidence" };

  const inputsHash = await briefInputsHash(sources);
  const reusableId = args.seedStartup
    ? await ctx.runMutation(internal.generations.pinSeedBrief, { generationId: args.generationId, inputsHash })
    : (await ctx.runQuery(internal.generations.findReusableBrief, {
        generationId: args.generationId,
        inputsHash,
      }))?._id;
  if (reusableId) {
    // Outside Step-by-step the stamp checks the reused Brief under owner
    // decision 25 and may return a new version of it (review 2026-09-25).
    const briefId = args.seedStartup
      ? reusableId
      : ((await ctx.runMutation(internal.generations.stampGenerationBriefId, {
          generationId: args.generationId, briefId: reusableId,
        })) ?? reusableId);
    if (args.seedStartup) {
      // Round 2 (F2): the reused Brief's entries fill "Reading the
      // interview" at once. Display only; never fails the stage.
      try {
        await ctx.runMutation(internal.seeds.copyBriefToReadingFacts, {
          generationId: args.generationId,
          briefId,
        });
      } catch (error) {
        logBriefStageError("Reading facts not copied from the reused Brief", args.generationId, error);
      }
    }
    return { kind: "reused", briefId };
  }

  const adapter = generationBriefAdapter(ctx, args.generationId, sources);
  // Round 2 (F2, decision 57): during Step-by-step startup the Brief
  // streams, and each entry is located as it arrives the way publishing
  // locates it (decision 25 applied) and written as a display-only reading
  // fact. Single and Compare send their request unchanged.
  const derived = await deriveBriefCandidates(adapter, client, {
    model: args.model ?? MODEL,
    ...(args.seedStartup
      ? {
          readingFacts: {
            target: {
              ctx,
              generationId: args.generationId,
              append: internal.seeds.appendReadingFacts,
            },
            placeholders: await ctx.runQuery(internal.generations.getGenerationPlaceholders, {
              generationId: args.generationId,
            }),
          },
        }
      : {}),
  });

  const briefId = await publishDerivedBrief(ctx, {
    ...(args.seedStartup ? { seedStartup: true } : {}),
    projectId: args.projectId,
    generationId: args.generationId,
    inputsHash,
    ...derived,
  });
  return { kind: "derived", briefId };
}

/** What the Step-by-step start did with its Brief. */
export type SeedBriefAttempt =
  | BriefStageAttempt
  | { kind: "adopted"; briefId: Id<"generationBriefs"> }
  | { kind: "attached" };

/**
 * The Step-by-step start's Brief (decision 65). A reusable Brief pinned at
 * startup wins, as before. Otherwise a ready Brief preparation with the
 * run's exact key is adopted (a new generation-bound Brief, no model call),
 * or the run attaches to the running attempt with that key and returns
 * `attached`: the preparation's completion schedules the run's continuation.
 * Anything else derives the run's own Brief (`deriveOrReuseBrief`).
 */
export async function deriveOrAdoptSeedBrief(
  ctx: BriefPublishCtx,
  client: GenerationClient,
  args: Omit<BriefStageArgs, "seedStartup">
): Promise<SeedBriefAttempt> {
  const sources = await ctx.runQuery(internal.generations.getGenerationSourcesForBrief, {
    generationId: args.generationId,
  });
  if (sources.length === 0) return { kind: "no_evidence" };
  const inputsHash = await briefInputsHash(sources);
  const pinned = await ctx.runMutation(internal.generations.pinSeedBrief, {
    generationId: args.generationId,
    inputsHash,
  });
  if (pinned === null) {
    // Fail open: a preparation that cannot be adopted never costs the run
    // its Brief; the adoption transaction wrote nothing, and the run
    // derives its own.
    try {
      const adoption = await ctx.runMutation(internal.generations.adoptPreparedBrief, {
        generationId: args.generationId,
        inputsHash,
      });
      if (adoption.kind === "adopted") return { kind: "adopted", briefId: adoption.briefId };
      if (adoption.kind === "attached") return { kind: "attached" };
    } catch (error) {
      logBriefStageError("Brief preparation not adopted", args.generationId, briefFailureCode(error));
    }
  }
  return await deriveOrReuseBrief(ctx, client, { ...args, seedStartup: true });
}

/**
 * One Brief preparation attempt (decision 65): the shared derivation over
 * the preparation's frozen rows, on the planning model frozen for it, its
 * placeholder map applied, its usage attributed to it, and its located
 * entries streamed to its own display rows. Every write is fenced by the
 * attempt id; a failure records a normalized code and nothing else.
 */
export const runBriefPreparation = internalAction({
  args: { preparationId: v.id("briefPreparations"), attemptId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    startActionDeadline(ctx);
    const run = await ctx.runQuery(getPreparationRunRef, args);
    if (!run) return null;
    try {
      const route = resolveGenerationStep({ freeze: run.modelFreeze, step: "brief", writerModel: MODEL });
      if (route.model !== run.planningModel) throw new Error("The frozen planning model does not resolve");
      const client = preparationClientForStep(
        ctx,
        route,
        {
          callSite: "preparation:brief",
          projectId: run.projectId,
          userId: run.triggeredBy,
          preparation: { briefPreparationId: args.preparationId, attemptId: args.attemptId },
        },
        { freeze: run.modelFreeze, placeholders: run.placeholders }
      );
      const adapter: BriefSourceAdapter<Id<"briefPreparationSources">> = {
        sources: run.sources,
        speakers: async (spans) =>
          await ctx.runQuery(getPreparationCitationSpeakersRef, { preparationId: args.preparationId, spans }),
      };
      const derived = await deriveBriefCandidates(adapter, client, {
        model: route.model,
        readingFacts: {
          target: {
            write: async (facts) =>
              await ctx.runMutation(appendPreparationFactsRef, { ...args, facts }),
          },
          placeholders: run.placeholders,
        },
      });
      await ctx.runMutation(completePreparationRef, {
        ...args,
        storylineText: derived.storylineText,
        entries: derived.entries,
        upstreamDroppedEntryCount: derived.upstreamDroppedEntryCount,
      });
    } catch (error) {
      logBriefStageError("Brief preparation failed", args.preparationId, briefFailureCode(error));
      await ctx.runMutation(failPreparationRef, { ...args, code: briefFailureCode(error) });
    }
    return null;
  },
});

/** A glossary term's first place, ignoring case (the term as the client wrote it). */
function termOccurrence<I extends string>(sources: FrozenSource<I>[], term: string): Citation<I>[] {
  const needle = term.toLowerCase();
  for (const source of sources) {
    const at = source.content.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    return [
      {
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        exactExcerpt: source.content.slice(at, at + term.length),
        startOffset: at,
        endOffset: at + term.length,
      },
    ];
  }
  return [];
}

type BriefFailureOutcome = Extract<BriefOutcome, { kind: "failed" }>;

const UNAVAILABLE_BRIEF_ERROR_DETAIL =
  "Thrown value could not be converted to text.";

function briefFailureDetail(error: unknown): string {
  let message: string;
  try {
    if (error instanceof Error) {
      const rawMessage: unknown = error.message;
      message =
        typeof rawMessage === "string" ? rawMessage : String(rawMessage);
    } else {
      message = String(error);
    }
  } catch {
    message = UNAVAILABLE_BRIEF_ERROR_DETAIL;
  }

  let bounded = message.slice(0, BRIEF_OUTCOME_DETAIL_CHARS);
  // Do not keep the first half of a surrogate pair when the bound lands
  // between its two code units.
  if (/[\uD800-\uDBFF]$/.test(bounded)) bounded = bounded.slice(0, -1);

  // A thrown string can already contain lone surrogates away from the bound.
  // Replace those invalid code units so Convex can always store the detail.
  let valid = "";
  for (let index = 0; index < bounded.length; index += 1) {
    const codeUnit = bounded.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = bounded.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        valid += bounded[index] + bounded[index + 1];
        index += 1;
      } else {
        valid += "\uFFFD";
      }
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      valid += "\uFFFD";
    } else {
      valid += bounded[index];
    }
  }
  return valid;
}

function briefFailureCode(error: unknown): BriefFailureOutcome["code"] {
  try {
    return normalizeProviderError(error).code;
  } catch {
    return "unknown";
  }
}

function logBriefStageError(...values: unknown[]): void {
  try {
    console.error(...values);
  } catch {
    // Logging is telemetry too. A logger failure must remain fail-open.
  }
}

/** A failed attempt's outcome: the provider code and the raw error message,
 * bounded by `BRIEF_OUTCOME_DETAIL_CHARS`. This normalizer is total so it is
 * safe to call from the stage runner's catch block. */
export function briefFailureOutcome(
  error: unknown
): BriefFailureOutcome {
  return {
    kind: "failed",
    code: briefFailureCode(error),
    detail: briefFailureDetail(error),
  };
}

/**
 * DW-109/DW-120: the Generation Brief stage as both entry actions run it —
 * `generateReport` (single/compare) and `startIterativeGeneration` — once per
 * generation, right after the shared analysis is saved.
 *
 * Never throws. Brief is read-only guidance, never required, so a failed
 * derivation is logged for ops (with the generation id and the original
 * error) and the generation continues with no Brief. Every attempt, whatever
 * its result, is recorded once through `generations.recordBriefOutcome`,
 * which stores the outcome and appends its authored progress line together.
 * A failure to record is itself only logged: telemetry never fails, stalls or
 * reorders a generation.
 */
export async function runGenerationBriefStage(
  ctx: BriefPublishCtx,
  client: GenerationClient,
  args: BriefStageArgs
): Promise<void> {
  let outcome: BriefOutcome;
  try {
    const attempt = await deriveOrReuseBrief(ctx, client, args);
    outcome = { kind: attempt.kind };
  } catch (error) {
    logBriefStageError(
      "Generation Brief derivation failed; continuing without a Brief",
      args.generationId,
      error
    );
    outcome = briefFailureOutcome(error);
  }
  try {
    await ctx.runMutation(internal.generations.recordBriefOutcome, {
      generationId: args.generationId,
      outcome,
    });
  } catch (error) {
    logBriefStageError(
      "Generation Brief outcome not recorded",
      args.generationId,
      outcome.kind,
      error
    );
  }
}
