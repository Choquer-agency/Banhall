"use node";

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  BRIEF_BASELINE_PAGE_BYTES,
  MAX_BRIEF_ENTRY_ROWS,
  briefDiffKey,
} from "../generations";
import type { GenerationClient } from "./openrouterCore";
import {
  CHARS_PER_TOKEN,
  cutToBudget,
  formatCount,
  preferFactSources,
  truncationNotice,
} from "./trustedContext";
import { normalizeProviderError } from "./providers";
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
import { HUMAN_PROSE_FOR_OWN_WORDING } from "../../shared/humanProse";

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
1. Storyline: the most defensible narrative account of the project against the CRA's Five Questions (technological uncertainty, hypotheses, systematic investigation, technological advancement, records kept). Write it as flowing prose, then restate its individual claims with the exact supporting quote from the evidence.
2. Claim Exclusions: statements in the evidence that must NEVER be claimed as SR&ED work, however prominent, because they fall outside eligible work. Every exclusion needs a reason: business_risk, routine_engineering, outside_claim_period, or not_technological.
3. Confidence Map: the evidence's facts classified established (directly and clearly supported), partial (supported but incomplete or hedged), unresolved (evidence conflicts or is silent), or unreliable (independent evidence shows the source itself is suspect, e.g. it contradicts itself, was explicitly invalidated, or is otherwise independently discredited).
4. Glossary Terms: the handful of technical phrases the project description should use consistently, one name per concept.

Rules:
- Every Storyline claim, Claim Exclusion, and Confidence Map entry MUST carry a "quote" field that is an EXACT, VERBATIM, character-for-character substring copied from the evidence below. Never paraphrase the quote, never invent one. An entry whose quote cannot be found verbatim in the evidence is discarded before it ever reaches the report, so a paraphrased quote is a wasted entry.
- Never fabricate a claim, exclusion, or fact absent from the evidence.
- Treat the [SOURCE_KIND=...] tag in each evidence delimiter as authoritative; labels are descriptive and do not determine source kind. When three or more blocks carry [SOURCE_KIND=transcript], reconcile those Transcripts source by source before writing the Brief. Identify what they agree on and every materially conflicting claim.
- Before classifying claims as materially conflicting, compare their scope, run, configuration, time, and compatible units. Compatible measurements made under different conditions are not contradictions. Retain each relevant claim with calibrated confidence and its own exact quote.
- Build one coherent Storyline whose common spine is the facts the Transcripts agree on. Do not exclude a defensible complementary fact merely because only one Transcript reports it; retain it with calibrated confidence and its exact source quote when no evidence contradicts it. When the supporting passages for an agreement are materially distinct, preserve source-by-source traceability with separate Confidence Map entries, one per distinct passage and originating Transcript, with one exact quote per entry. If multiple Transcripts contain an identical supporting passage, do not duplicate the same quote merely to claim unique source attribution; one quote-bound entry is sufficient unless another materially distinct passage is available.
- Never average materially conflicting claims, silently choose one, or omit a competing claim. For each competing claim, use an exact contextual quote that is unique to its originating evidence block when available. If identical passages or overlapping text make the source unresolvable, state the attribution ambiguity and do not claim unique source provenance. Ordinary inter-source disagreement is "unresolved", not "unreliable": keep each competing claim as a separate Confidence Map entry with confidence "unresolved" and its own exact quote from the originating evidence block. Use "unreliable" only when independent evidence gives a reason to distrust the source itself, such as an internal contradiction, explicit invalidation, or other evidence that the source is suspect.
- Treat a conflict as resolved only when the evidence explicitly says that a claim was corrected or retracted and the correction or retraction itself remains supported. A correction that was subsequently withdrawn or retracted, or is independently discredited, does not invalidate the original claim or inform the Storyline. A correction or retraction resolves only the claim it explicitly corrects or retracts. A different source merely asserting that a competing claim is wrong, or offering a disputed correction, remains ordinary unresolved disagreement unless independent evidence establishes source unreliability; do not invent an authority or approval hierarchy. When a supported correction or retraction validly resolves a claim, keep the original claim as "unreliable" with its exact quote, and record the explicit correction or retraction separately with its own exact quote. Reassess every remaining competitor and keep unresolved alternatives separate. If other conflicting alternatives remain, preserve that uncertainty in the Storyline; a replacement is not established solely because it is labeled a correction. A retraction alone supplies no replacement fact. Let only a supported, undisputed correction inform the Storyline. Never infer a correction from recency, plausibility, or source order.
- Glossary terms are the canonical term string plus, optionally, inflected forms already used in the evidence verbatim (plurals, past tense); those are matched back into the evidence separately by rule, so no quote is needed for them.
- Some concepts appear in the evidence only under a different phrasing than your canonical term (a genuine synonym, not just a plural or tense change). For those, and ONLY those, also give a "quote" field: an exact, verbatim substring where that different phrasing appears. Leave "quote" empty for any term whose exact wording (or an obvious plural/past-tense form) is already present.
- Write in plain, specific, technical language. No filler, no marketing language.\n\n${HUMAN_PROSE_FOR_OWN_WORDING}`;

export const BRIEF_REQUEST = {
  roleOrder: ["system", "user"],
  toolName: "submit_generation_brief",
  toolDescription:
    "Submit the derived Generation Brief: Storyline, Claim Exclusions, Confidence Map, Glossary Terms.",
  // 2026-09-25: raised from 8,192; a real Brief used 8,007 of it, so a
  // slightly larger project would have been cut off (see ANALYZER_REQUEST).
  maxTokens: 16_000,
} as const;

/**
 * Input budget for the Brief call (cost phase 1). The call used to send
 * every frozen source whole, with no bound at all. Same totals as the
 * analyzer's DEFAULT_CONTEXT_BUDGET: 150k tokens overall, at most 100k for
 * any one source. Spent in frozen order (transcripts or their digests
 * first), so the outcome is reproducible from the frozen rows.
 */
export const BRIEF_INPUT_BUDGET = {
  totalTokens: 150_000,
  perSourceTokens: 100_000,
} as const;

/** Said once at the end when whole sources did not fit. */
export const BRIEF_OMITTED_SOURCES_NOTICE = {
  prefix: "[",
  suffix: " further source(s) were omitted to fit the context budget.]",
} as const;

export function briefOmittedSourcesNotice(count: number): string {
  return `${BRIEF_OMITTED_SOURCES_NOTICE.prefix}${formatCount(count)}${BRIEF_OMITTED_SOURCES_NOTICE.suffix}`;
}

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
  sources: Array<
    Pick<Doc<"generationSources">, "label" | "content" | "kind"> & {
      transcriptId?: Id<"transcripts">;
    }
  >,
  budget: { totalTokens: number; perSourceTokens: number } = BRIEF_INPUT_BUDGET
): string {
  // Digest mode means digests: a transcript with a frozen digest is read
  // through the digest only, never both. 2026-09-24 (transcript method):
  // with a fact pack for every transcript, the packs take their places.
  const evidence = preferFactSources(
    sources.filter((s) => s.kind !== "writer_storyline")
  );
  const perSource = Math.max(0, budget.perSourceTokens) * CHARS_PER_TOKEN;
  let remaining = Math.max(0, budget.totalTokens) * CHARS_PER_TOKEN;
  let omitted = 0;
  const blocks: string[] = [];
  for (const s of evidence) {
    const block = (body: string) =>
      `--- BEGIN [SOURCE_KIND=${s.kind}] [${s.label.toUpperCase()}] ---\n${body}\n--- END [SOURCE_KIND=${s.kind}] [${s.label.toUpperCase()}] ---`;
    if (!s.content.length) {
      blocks.push(block(s.content));
      continue;
    }
    // A cut keeps a prefix of the frozen text, so every quote the model
    // takes from it is still a verbatim substring of the source.
    const kept = cutToBudget(s.content, Math.min(perSource, remaining));
    if (!kept.length) {
      omitted += 1;
      continue;
    }
    remaining -= kept.length;
    blocks.push(
      block(
        kept.length < s.content.length
          ? `${kept}\n${truncationNotice(s.content.length - kept.length, s.content.length)}`
          : kept
      )
    );
  }
  if (omitted > 0) blocks.push(briefOmittedSourcesNotice(omitted));
  return `${BRIEF_TASK_GUIDANCE}\n\n${blocks.join("\n\n")}`;
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
/** Spans per `getCitationSpeakers` call; it accepts at most 2,000. */
const CITATION_SPEAKER_BATCH = 1_000;

/**
 * Owner decision 25 verdicts for candidate places on transcript rows, one
 * query per batch. Places on any other row are not asked about and read as
 * `unchecked` (no entry in the map). In an `anchored` group every place
 * after the first is a new place for the first one's words: it counts only
 * on the same row and near that place (review 2026-09-25, P2-3). Glossary
 * terms are not anchored: a term the client used anywhere is theirs.
 */
async function citationSpeakersFor(
  ctx: BriefPublishCtx,
  generationId: Id<"generations">,
  sources: ReadonlyArray<{ _id: Id<"generationSources">; kind: string }>,
  groups: ReadonlyArray<{ places: readonly Citation[]; anchored: boolean }>
): Promise<Map<Citation, CitationSpeaker>> {
  const transcriptRows = new Set<string>(
    sources.filter((source) => source.kind === "transcript").map((source) => source._id)
  );
  const verdicts = new Map<Citation, CitationSpeaker>();
  const asked: Array<{ place: Citation; movedFrom?: Citation }> = [];
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
    const answers = await ctx.runQuery(internal.generations.getCitationSpeakers, {
      generationId,
      spans: batch.map(({ place, movedFrom }) => ({
        sourceId: place.sourceId,
        startOffset: place.startOffset,
        endOffset: place.endOffset,
        ...(movedFrom
          ? { movedFrom: { startOffset: movedFrom.startOffset, endOffset: movedFrom.endOffset } }
          : {}),
      })),
    });
    batch.forEach(({ place }, index) => verdicts.set(place, answers[index]));
  }
  return verdicts;
}

/**
 * The stage: compute inputsHash, reuse the stored Brief when inputs are
 * unchanged, otherwise run one structured call and persist the result.
 * Returns which of those happened with the Brief id, or `no_evidence` if the
 * generation has no frozen sources to derive from (never expected in
 * practice — `reserveGeneration` requires at least one readable source).
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
    if (!args.seedStartup) await ctx.runMutation(internal.generations.stampGenerationBriefId, {
      generationId: args.generationId, briefId: reusableId,
    });
    return { kind: "reused", briefId: reusableId };
  }

  const writerSource = sources.find((s) => s.kind === "writer_storyline");
  // 2026-09-24 (transcript method, plan step 8): a Brief derived from fact
  // packs cites what the packs show on the frozen transcript row, inside a
  // verified client span (owner decision 25), and a document by its own
  // text; a pack or digest row is never cited. Otherwise, as before, a
  // quote cites the first frozen source that holds it.
  const factMode = readsFactPacks(sources);
  const evidenceSources: FrozenSource[] = sources.filter(
    (s) =>
      s.kind !== "writer_storyline" &&
      s.kind !== "transcript_facts" &&
      !(factMode && s.kind === "transcript_digest")
  );
  const documentSources: FrozenSource[] = sources.filter(
    (s) => s.kind !== "writer_storyline" && s.kind !== "transcript" && s.kind !== "transcript_facts" && s.kind !== "transcript_digest"
  );
  const cite = (quote: string): Citation | null => {
    if (!factMode) {
      // `places` and `firstEvidence` (decision 25, below) are filled once
      // the model has answered, before the first cite() call.
      const candidates = places.get(quote);
      return candidates ? firstEvidence(candidates) : citeQuote(evidenceSources, quote);
    }
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
        sourceId: fact.sourceId as Id<"generationSources">,
        sourceContentHash: fact.sourceContentHash,
        exactExcerpt: fact.exactExcerpt,
        startOffset: fact.startOffset,
        endOffset: fact.endOffset,
      };
    }
    return citeQuote(documentSources, quote);
  };

  const model = args.model ?? MODEL;
  const output = await runBriefAgent(
    client,
    buildBriefUserMessage(sources),
    model
  );

  // Owner decision 25 (2026-09-25): a quote that is only the interviewer's
  // or another speaker's words never backs an entry. Each quote is cited at
  // its first place, as before, unless the stored speaker turns say that
  // place is not evidence; then the next place with the same words wins,
  // and a quote with none is dropped and counted. Transcripts without
  // stored turns, documents and digests keep the first place. Facts mode
  // already cites verified client spans; its glossary matches are checked.
  const places = new Map<string, Citation[]>();
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
    const first: Citation = {
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
  const speakerAt = await citationSpeakersFor(ctx, args.generationId, sources, [
    ...[...places.values()].map((candidates) => ({ places: candidates, anchored: true })),
    ...glossaryPlaces.map((candidates) => ({ places: candidates, anchored: false })),
  ]);
  const firstEvidence = (candidates: readonly Citation[]): Citation | null =>
    candidates.find((place) => speakerAt.get(place) !== "excluded") ?? null;

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
      const citation = cite(claim.quote);
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
    const citation = cite(exclusion.quote);
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
    const citation = cite(fact.quote);
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
  glossaryMatches.forEach((match, index) => {
    const citation = firstEvidence(glossaryPlaces[index]);
    if (!citation) {
      upstreamDroppedEntryCount += 1;
      return;
    }
    candidateEntries.push({
      group: "glossaryTerm",
      text: match.canonicalTerm,
      sourceId: citation.sourceId,
      sourceContentHash: citation.sourceContentHash,
      startOffset: citation.startOffset,
      endOffset: citation.endOffset,
      exactExcerpt: citation.exactExcerpt,
    });
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
    const citation = cite(classified.quote);
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

  const briefId = await publishDerivedBrief(ctx, {
    ...(args.seedStartup ? { seedStartup: true } : {}),
    projectId: args.projectId,
    generationId: args.generationId,
    inputsHash,
    origin,
    storylineText,
    entries: candidateEntries,
    upstreamDroppedEntryCount,
  });
  return { kind: "derived", briefId };
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
