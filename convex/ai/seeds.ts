"use node";

import { z } from "zod";
import { v } from "convex/values";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
} from "convex/server";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id, TableNames } from "../_generated/dataModel";
import type {
  claimAttempt,
  completeAttempt,
  failAttempt,
} from "../seedRuns";
import type { GenerationClient } from "./openrouterCore";
import { MalformedOutputError, OutputLimitError, messageText } from "./openrouterCore";
import { STRUCTURED_OUTPUT_PROGRAM, StructuredValidationError, generateStructured } from "./structured";
import { startActionDeadline } from "./actionDeadline";
import {
  clientForStep,
  normalizeProviderError,
  registerGenerationModels,
} from "./providers";
import { resolveGenerationCall, stepRequestFields } from "../lib/generationSteps";
import { SEED_PROMPT_PROGRAM } from "./promptDefinitions";
import {
  buildSeedPrompt,
  seedAdvancementLinkIds,
  seedBlock,
  seedExperimentLinkIds,
  seedPromptProjection,
} from "./trustedContext";
import {
  MAX_SEED_PROMPT_UTF8_BYTES,
  SeedContextLimitError,
  assertSeedPromptWithinLimit,
  type SeedContextSnapshot,
} from "../lib/seedRevisions";
import {
  MAX_BATCH_SEEDS,
  MAX_BULLET_WORDS,
  MAX_FEEDBACK_SEEDS,
  MIN_BATCH_SEEDS,
  MIN_FEEDBACK_SEEDS,
  linkedSeedSchemas,
  offeredAdvancementLinks,
  seedAnswerCounts,
  wrongToolAnswerCounts,
  seedToolSchema,
  validateBatch,
  withCheckedSpeakers,
  withQuoteChecks,
  type BatchValidationResult,
  type FrozenSeedSource,
  type SeedBatchMode,
  type SeedAnswerCounts,
  type SeedReference,
  type SeedToolKind,
  type SeedToolInputSchema,
  type SeedReferenceContext,
  type SeedValidationIssueCode,
  type ValidatedSeedCandidate,
} from "../lib/seedContract";
import type { QuoteCheckIssue } from "../lib/seedQuoteSupport";
import type { AllowedAdvancementLink } from "../../shared/advancementLinks";
import {
  readsFactPacks,
  resolveFactCitations,
  seedToolSchemaForFacts,
  type FactSource,
} from "../lib/seedFacts";

type ValidatedSeedBatch = {
  seeds: ValidatedSeedCandidate[];
  dropped: number;
  /** Each Seed's place in the model's answer, 0-based. */
  seedIndexes: number[];
};

// Convex 1.41 defines this utility in server/api but does not re-export it
// from the public `convex/server` entry point. Keep the identical mutation
// branch locally so references still derive from the registered exports.
type FunctionReferenceFromExport<Export> =
  Export extends RegisteredMutation<
    infer Visibility,
    infer Args,
    infer ReturnValue
  >
    ? FunctionReference<"mutation", Visibility, Args, Awaited<ReturnValue>>
    : never;

type ClaimAttemptRef = FunctionReferenceFromExport<typeof claimAttempt>;
type CompleteAttemptRef = FunctionReferenceFromExport<typeof completeAttempt>;
type FailAttemptRef = FunctionReferenceFromExport<typeof failAttempt>;

const claimAttemptRef = makeFunctionReference<
  "mutation",
  FunctionArgs<ClaimAttemptRef>,
  FunctionReturnType<ClaimAttemptRef>
>("seedRuns:claimAttempt");
const completeAttemptRef = makeFunctionReference<
  "mutation",
  FunctionArgs<CompleteAttemptRef>,
  FunctionReturnType<CompleteAttemptRef>
>("seedRuns:completeAttempt");
const failAttemptRef = makeFunctionReference<
  "mutation",
  FunctionArgs<FailAttemptRef>,
  FunctionReturnType<FailAttemptRef>
>("seedRuns:failAttempt");

const quoteRepairContextRef = makeFunctionReference<
  "query",
  {
    batchId: Id<"seedBatches">;
    generationId: Id<"generations">;
    seeds: Array<{
      provenance: Array<{
        sourceId: Id<"generationSources">;
        startOffset: number;
        endOffset: number;
        exactExcerpt: string;
      }>;
    }>;
  },
  {
    writerWaiting: boolean;
    checked: Array<Array<{ startOffset: number; endOffset: number; needsSpeakerCheck: boolean } | null>>;
  }
>("seedRuns:quoteRepairContext");

/**
 * 2026-09-27 (third): one answer's quote issues as completeAttempt will
 * find them (after the speaker check outside facts mode, lead answer 3),
 * and whether a writer now waits on the Batch, in one read.
 */
async function quoteReview(
  ctx: ActionCtx,
  args: {
    batchId: Id<"seedBatches">;
    generationId: Id<"generations">;
    seeds: readonly ValidatedSeedCandidate[];
    factMode: boolean;
    mode: SeedBatchMode;
  }
): Promise<{ writerWaiting: boolean; issues: QuoteCheckIssue[] }> {
  const context = await ctx.runQuery(quoteRepairContextRef, {
    batchId: args.batchId,
    generationId: args.generationId,
    seeds: args.factMode
      ? []
      : args.seeds.map((seed) => ({
          provenance: seed.provenance.map((citation) => ({
            sourceId: validatedId<"generationSources">(citation.sourceId),
            startOffset: citation.startOffset,
            endOffset: citation.endOffset,
            exactExcerpt: citation.exactExcerpt,
          })),
        })),
  });
  const checked = args.factMode
    ? [...args.seeds]
    : args.seeds.map((seed, index) => withCheckedSpeakers(seed, context.checked[index] ?? []).seed);
  return { writerWaiting: context.writerWaiting, issues: withQuoteChecks(checked, args.mode).issues };
}

/**
 * 2026-09-27 (third): the soft quote repair's text, or null when every
 * quote backs its Seed. The earlier answer goes back as delimited data, so
 * "idea card 2" names something the model can see; cards are named by
 * their place in that answer (`seedIndexes` maps a kept Seed back to it),
 * never by their words. Fact mode asks for fact ids.
 */
export function seedQuoteRepairText(args: {
  issues: readonly QuoteCheckIssue[];
  seedIndexes: readonly number[];
  citationMode: "offsets" | "facts";
  answer: unknown;
}): string | null {
  const cards = (code: QuoteCheckIssue["code"]) =>
    [...new Set(args.issues.filter((issue) => issue.code === code).map((issue) => (args.seedIndexes[issue.seedIndex] ?? issue.seedIndex) + 1))]
      .sort((left, right) => left - right);
  const list = (numbers: number[]) => `${numbers.length === 1 ? "idea card" : "idea cards"} ${numbers.join(", ")}.`;
  const unrelated = cards("CITATION_UNRELATED");
  const reused = cards("CITATION_REUSED");
  if (unrelated.length === 0 && reused.length === 0) return null;
  const text = SEED_PROMPT_PROGRAM.request.quoteRepair;
  return [
    text.opening,
    seedBlock(text.earlierAnswerLabel, JSON.stringify(args.answer)),
    unrelated.length > 0 ? `${text.unrelated[args.citationMode]}${list(unrelated)}` : "",
    reused.length > 0 ? `${text.reused[args.citationMode]}${list(reused)}` : "",
    text.closing,
  ].join("");
}

function validatedId<TableName extends TableNames>(value: string): Id<TableName> {
  return value as Id<TableName>;
}

function countedClient(client: GenerationClient, onRequest: () => void): GenerationClient {
  return {
    messages: {
      create: async (params) => {
        assertSeedPromptWithinLimit(
          `${params.system ?? ""}${params.messages
            .map((message) => messageText(message.content))
            .join("")}`
        );
        onRequest();
        try {
          return await client.messages.create(params);
        } catch (error) {
          // A cut-off answer keeps its class, so the repair asks for a
          // shorter answer rather than a generic fix.
          if (error instanceof OutputLimitError) {
            throw new OutputLimitError(
              "Seed provider response was truncated at the max_tokens limit before completing"
            );
          }
          if (error instanceof MalformedOutputError) {
            throw new MalformedOutputError(
              "Seed provider returned malformed structured output"
            );
          }
          throw error;
        }
      },
    },
  };
}

/**
 * One actionable hint per validator rule, built from the validator's own
 * limits. The Record is exhaustive, so a new issue code fails the build until
 * it has a hint. INVALID_PROVENANCE never blocks a Seed, so it has none.
 */
function seedIssueHints(mode: SeedBatchMode, minimum?: number): Record<SeedValidationIssueCode, string> {
  const [min, max] =
    mode === "batch"
      ? [minimum ?? MIN_BATCH_SEEDS, MAX_BATCH_SEEDS]
      : [minimum ?? MIN_FEEDBACK_SEEDS, MAX_FEEDBACK_SEEDS];
  return {
    INVALID_SHAPE: "wrong fields or tag",
    INVALID_BULLET_COUNT: "use one or two bullets",
    BULLET_TOO_LONG: `a bullet is over ${MAX_BULLET_WORDS} words`,
    BULLET_NOT_ONE_SENTENCE: "a bullet is not one sentence ending in a full stop",
    BULLET_TYPOGRAPHIC_DASH: "use a plain hyphen",
    INVALID_TAG_COUNT: "use one or two tags",
    INVALID_TAG: "use only the allowed tags",
    DUPLICATE_TAG: "a tag is repeated",
    // 2026-09-28 (fourth): names the block that lists the allowed ids and
    // why a link cannot be found. 2026-09-29 (first): the ids come as
    // pairs, one entry per uncertainty; a request with a link block also
    // shows its earlier answer (seedLinkRepairText).
    INVALID_ADVANCEMENT_REFERENCE:
      "use one FROZEN ADVANCEMENT LINKS entry's ids and write from its experiments",
    // 2026-09-29 (first): an experiment names the uncertainty it tested.
    INVALID_EXPERIMENT_REFERENCE:
      "set uncertaintySeedId to the tested uncertainty from FROZEN EXPERIMENT LINKS",
    INVALID_PROVENANCE: "",
    INVALID_BATCH_SIZE: `return ${min} to ${max} valid Seeds`,
    INSUFFICIENT_TAG_DIVERSITY: "use at least two different tags",
    INSUFFICIENT_FORM_DIVERSITY: "mix one-bullet and two-bullet Seeds",
  };
}

const REPAIR_OMITTED = "more issues omitted";

/**
 * 2026-09-29 (first, run 7 re-check): which Seed tool a request forces: the
 * advancement tool when it sends FROZEN ADVANCEMENT LINKS, the experiment
 * tool when it sends FROZEN EXPERIMENT LINKS, else the shared one.
 */
export function seedToolKindFor(
  snapshot: SeedContextSnapshot,
  roleId: Parameters<typeof validateBatch>[0]["roleId"],
  uncertaintyRoots: Readonly<Record<string, string>> = {}
): SeedToolKind {
  if (seedAdvancementLinkIds(snapshot, roleId, uncertaintyRoots)) return "advancement";
  if (seedExperimentLinkIds(snapshot, roleId)) return "experiment";
  return "shared";
}

/**
 * The three Seed tools every request sends, always the same bytes for one
 * citation mode, so the cached tools prefix is shared; and the name of the
 * one `kind` forces.
 */
export function seedTools(base: SeedToolInputSchema, kind: SeedToolKind) {
  const request = SEED_PROMPT_PROGRAM.request;
  const linked = linkedSeedSchemas(base);
  const tools = [
    { name: request.toolName, description: request.description, input_schema: base },
    { ...request.linkedTools.experiment, input_schema: linked.experiment },
    { ...request.linkedTools.advancement, input_schema: linked.advancement },
  ];
  const toolName =
    kind === "advancement"
      ? request.linkedTools.advancement.name
      : kind === "experiment"
        ? request.linkedTools.experiment.name
        : request.toolName;
  return { tools, toolName };
}

/**
 * 2026-09-29 (first, run 7 re-check): the repair of an invalid answer to a
 * request with a link block shows that answer as data and asks to keep each
 * Seed's links unless an issue names it, so a repair for another rule never
 * loses them. Omitted (null) when the prompt has no room for it.
 */
export function seedLinkRepairText(answer: unknown, promptBytes: number): string | null {
  const text = SEED_PROMPT_PROGRAM.request.linkRepair;
  const repair = `${text.opening}${seedBlock(text.earlierAnswerLabel, JSON.stringify(answer))}`;
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  const reserved =
    bytes(STRUCTURED_OUTPUT_PROGRAM.repairScaffold.prefix) +
    bytes(STRUCTURED_OUTPUT_PROGRAM.repairScaffold.suffix) +
    SEED_PROMPT_PROGRAM.request.repairValidationSummaryMaxUtf8Bytes +
    SEED_PROMPT_PROGRAM.request.repairLinkPairsMaxUtf8Bytes;
  return promptBytes + reserved + bytes(repair) <= MAX_SEED_PROMPT_UTF8_BYTES ? repair : null;
}

/**
 * Repair feedback the model can act on. The note leads with the broken rules
 * and names the Seeds by position only; the note itself never carries Seed
 * text, because it is logged. (Since 2026-09-29, first, a request with a
 * link block also shows the model its earlier answer, after the note and
 * outside it: seedLinkRepairText.) structured.ts prefixes "(root): ", and the
 * note stays inside the prompt's reserved repair bytes with that prefix,
 * marking any rules it had to leave out.
 */
export function seedRepairSummary(
  result: BatchValidationResult,
  returned: number,
  mode: SeedBatchMode,
  options: { offeredLinks?: readonly AllowedAdvancementLink[] } = {}
): string {
  const rules = seedRuleSummary(result, returned, mode);
  const pairs = linkPairsNote(result, options.offeredLinks ?? []);
  return pairs ? `${rules}; ${pairs}` : rules;
}

/**
 * 2026-09-29 (first, run 7): after a broken advancement link, the repair
 * names the exact pairs it may use, within its own reserved bytes after the
 * rules (`repairLinkPairsMaxUtf8Bytes`). Ids only, never Seed text; the
 * block that lists them is named instead when they do not fit.
 */
function linkPairsNote(
  result: BatchValidationResult,
  offeredLinks: readonly AllowedAdvancementLink[]
): string | null {
  const broken = result.issues.filter((issue) => issue.code === "INVALID_ADVANCEMENT_REFERENCE");
  if (broken.length === 0 || offeredLinks.length === 0) return null;
  const unlisted = broken.some((issue) => issue.linkReason === "uncertainty_without_tested_experiment");
  const lead = `the only pairs, one per Seed and each usable by several Seeds${unlisted ? ", and no advancement for any other uncertainty" : ""}: `;
  const list = offeredLinks
    .map((link) => `${link.uncertaintySeedId} with ${link.experimentSeedIds.join(", ")}`)
    .join(" | ");
  const full = `${lead}${list}`;
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  return bytes(`; ${full}`) <= SEED_PROMPT_PROGRAM.request.repairLinkPairsMaxUtf8Bytes
    ? full
    : `${lead}as listed in FROZEN ADVANCEMENT LINKS`;
}

function seedRuleSummary(
  result: BatchValidationResult,
  returned: number,
  mode: SeedBatchMode
): string {
  const hints = seedIssueHints(mode, result.minimum);
  const maxBytes =
    SEED_PROMPT_PROGRAM.request.repairValidationSummaryMaxUtf8Bytes -
    "(root): ".length;
  const seedsByRule = new Map<SeedValidationIssueCode, Set<number>>();
  const batchRules = new Set<SeedValidationIssueCode>();
  for (const issue of result.issues) {
    if (!hints[issue.code]) continue;
    if (issue.seedIndex === undefined) {
      batchRules.add(issue.code);
      continue;
    }
    const seeds = seedsByRule.get(issue.code) ?? new Set<number>();
    seeds.add(issue.seedIndex + 1);
    seedsByRule.set(issue.code, seeds);
  }
  // Variety is counted over valid Seeds only, so a variety hint can repeat
  // what a dropped Seed already broke; it can also be the only reason the
  // batch failed. Keep it, after the Seed rules, so the cap drops it first.
  const parts = [
    `${result.seeds.length} of ${returned} ${returned === 1 ? "Seed" : "Seeds"} valid`,
    ...(batchRules.has("INVALID_BATCH_SIZE") ? [hints.INVALID_BATCH_SIZE] : []),
    ...[...seedsByRule.entries()]
      .sort(([, left], [, right]) => right.size - left.size)
      .map(([code, seeds]) => {
        const list = [...seeds].sort((left, right) => left - right).join(", ");
        return `${hints[code]} (${seeds.size === 1 ? "Seed" : "Seeds"} ${list})`;
      }),
    ...[...batchRules]
      .filter((code) => code !== "INVALID_BATCH_SIZE")
      .map((code) => hints[code]),
  ];
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  const budget = maxBytes - bytes(`; ${REPAIR_OMITTED}`);
  let summary = "";
  for (const [index, part] of parts.entries()) {
    const next = summary ? `${summary}; ${part}` : part;
    const last = index === parts.length - 1;
    if (bytes(next) > (last ? maxBytes : budget)) {
      return `${summary}; ${REPAIR_OMITTED}`;
    }
    summary = next;
  }
  return summary;
}

/**
 * Real Sonnet 5 batches sometimes send the Seed list as a JSON string inside
 * the tool object ({ seeds: "[...]" }). structured.ts only unwraps a whole
 * input sent as a string, so parse this one field when it holds an array;
 * anything else is left for the schema to reject.
 */
/** How many Seeds an answer holds, as the validator reads them. */
function seedsIn(answer: unknown): number {
  const seeds =
    answer && typeof answer === "object" && "seeds" in answer ? parseStringifiedSeeds(answer.seeds) : undefined;
  return Array.isArray(seeds) ? seeds.length : 0;
}

function parseStringifiedSeeds(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim().startsWith("[")) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function validatedBatchSchema(args: {
  roleId: Parameters<typeof validateBatch>[0]["roleId"];
  mode: Parameters<typeof validateBatch>[0]["mode"];
  generationId: string;
  snapshot: SeedContextSnapshot;
  /** 2026-09-29 (first, review P2-2): an uncertainty and its revisions are one. */
  uncertaintyRoots?: Readonly<Record<string, string>>;
  sources: readonly FrozenSeedSource[];
  /**
   * 2026-09-24 (transcript method): set when every transcript is read
   * through its fact pack. Fact ids and document excerpts are resolved to
   * offsets on frozen rows before the Seed contract byte-checks them.
   */
  factSources?: readonly FactSource[];
  /** Told each rejected answer's validation and Seed count, the last one last. */
  onRejected?: (result: BatchValidationResult, returned: number) => void;
}): z.ZodType<ValidatedSeedBatch> {
  const references: SeedReference[] = args.snapshot.items
    .filter((item) => item.kind === "selection")
    .map((item) => ({
      seedId: item.seedId,
      generationId: args.generationId,
      roleId: item.roleId,
      active: true,
      ...(item.uncertaintySeedId ? { uncertaintySeedId: item.uncertaintySeedId } : {}),
    }));
  return z
    .object({ seeds: z.preprocess(parseStringifiedSeeds, z.array(z.unknown())) })
    .transform((value, context): ValidatedSeedBatch => {
      const seeds = args.factSources
        ? resolveFactCitations(value.seeds, args.factSources).seeds
        : value.seeds;
      const referenceContext: SeedReferenceContext = {
        generationId: args.generationId,
        references,
        ...(args.uncertaintyRoots ? { uncertaintyRoots: args.uncertaintyRoots } : {}),
      };
      const result = validateBatch({
        roleId: args.roleId,
        mode: args.mode,
        seeds,
        referenceContext,
        frozenSources: args.sources,
      });
      if (!result.ok) {
        args.onRejected?.(result, seeds.length);
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: seedRepairSummary(result, seeds.length, args.mode, {
            offeredLinks: args.roleId === "specific_advancements" ? offeredAdvancementLinks(referenceContext) : [],
          }),
        });
        return z.NEVER;
      }
      return {
        seeds: result.seeds,
        dropped: result.dropped,
        seedIndexes: result.seedIndexes,
      };
    });
}

/**
 * 2026-09-28 (fourth): why a Batch's answers failed the Seed contract, when
 * the writer can act on it. "advancement_links": the last answer's Seeds
 * linked ids outside the frozen uncertainty and experiment selections, or
 * (2026-09-29 first) paired an uncertainty with experiments that did not
 * test it. "experiment_links" (2026-09-29 first): experiment Seeds named no
 * frozen uncertainty selection, or one outside them.
 */
export type SeedFailureDetail = "advancement_links" | "experiment_links";

function failureDetail(
  error: unknown,
  lastRejection: BatchValidationResult | undefined
): SeedFailureDetail | undefined {
  if (!(error instanceof StructuredValidationError) || !lastRejection) return undefined;
  if (lastRejection.issues.some((issue) => issue.code === "INVALID_ADVANCEMENT_REFERENCE")) {
    return "advancement_links";
  }
  return lastRejection.issues.some((issue) => issue.code === "INVALID_EXPERIMENT_REFERENCE")
    ? "experiment_links"
    : undefined;
}

function failureCode(error: unknown):
  | "PROVIDER_FAILED"
  | "INVALID_OUTPUT"
  | "CONTEXT_LIMIT"
  | "INTERNAL_ERROR" {
  if (error instanceof SeedContextLimitError) return "CONTEXT_LIMIT";
  if (error instanceof MalformedOutputError) return "INVALID_OUTPUT";
  const provider = normalizeProviderError(error);
  if (provider.code !== "unknown") return "PROVIDER_FAILED";
  if (error instanceof StructuredValidationError) return "INVALID_OUTPUT";
  // Any of the three Seed tools (2026-09-29 first, run 7 re-check).
  const toolNames = [
    SEED_PROMPT_PROGRAM.request.toolName,
    SEED_PROMPT_PROGRAM.request.linkedTools.experiment.name,
    SEED_PROMPT_PROGRAM.request.linkedTools.advancement.name,
  ];
  if (
    error instanceof Error &&
    (toolNames.some((name) => error.message.includes(name)) ||
      error.message.includes("structured output"))
  ) {
    return "INVALID_OUTPUT";
  }
  return "INTERNAL_ERROR";
}

/**
 * One Node action owns one claimed attempt. It performs no live reads and no
 * direct writes: the claim payload is the entire immutable request boundary.
 */
export const generateBatch = internalAction({
  args: { batchId: v.id("seedBatches") },
  handler: async (ctx, args) => {
    // Every request ends inside the Convex action limit (actionDeadline.ts).
    startActionDeadline(ctx);
    const claim = await ctx.runMutation(claimAttemptRef, {
      batchId: args.batchId,
    });
    if (claim.kind !== "claimed") return null;
    // Model catalog: the seed model routes by the generation's frozen entry.
    await registerGenerationModels(ctx, claim.batch.generationId).catch(() => null);

    let requestsMade = 0;
    let lastRejection: BatchValidationResult | undefined;
    // 2026-09-29 (first, run 7): every rejected answer as counts, recorded
    // on a failed Batch.
    const rejectedAnswers: SeedAnswerCounts[] = [];
    try {
      const mode = claim.batch.operation === "feedback" ? "feedback" : "batch";
      const sources: FrozenSeedSource[] = claim.input.sources.map((source) => ({
        sourceId: source._id,
        generationId: claim.batch.generationId,
        content: source.content,
        contentHash: source.contentHash,
      }));
      // Transcript method (plan step 7): with a fact pack frozen for every
      // transcript, Seeds read the packs and cite fact ids.
      const factMode = readsFactPacks(claim.input.sources);
      const factSources: FactSource[] | undefined = factMode
        ? claim.input.sources.map((source) => ({
            sourceId: source._id,
            kind: source.kind,
            content: source.content,
            contentHash: source.contentHash,
            ...(source.transcriptId ? { transcriptId: source.transcriptId } : {}),
            ...(source.factSpans ? { factSpans: source.factSpans } : {}),
          }))
        : undefined;
      const toolKind = seedToolKindFor(claim.context, claim.batch.roleId, claim.uncertaintyRoots);
      const request = buildSeedPrompt({
        mode,
        objective: claim.role.objective,
        brief: {
          ...claim.input.brief,
          entries: claim.input.briefEntries,
        },
        sources: claim.input.sources.map((source) => ({
          sourceId: source._id,
          label: source.label,
          kind: source.kind,
          content: source.content,
          contentHash: source.contentHash,
          ...(source.transcriptId ? { transcriptId: source.transcriptId } : {}),
        })),
        projection: seedPromptProjection(claim.context, claim.batch.roleId, claim.uncertaintyRoots),
        writerSettings: claim.input.writerSettings,
        lengthTarget: claim.input.lengthTarget,
      });
      // Owner decision 43: the batch was dispatched on its step's model;
      // the step's request settings come from the same frozen routing.
      const freeze = await registerGenerationModels(ctx, claim.batch.generationId);
      const route = resolveGenerationCall({
        freeze,
        callSite: claim.batch.slot,
        writerModel: claim.batch.model,
      });
      const client = countedClient(
        clientForStep(
          ctx,
          {
            ...route,
            model: claim.batch.model,
            request: stepRequestFields(freeze, route.step, claim.batch.model),
          },
          {
            callSite: claim.batch.slot,
            projectId: claim.batch.projectId,
            attribution: { generationId: claim.batch.generationId },
          },
          { seedPolicy: true }
        ),
        () => {
          requestsMade += 1;
        }
      );
      const review = (seeds: readonly ValidatedSeedCandidate[]) =>
        quoteReview(ctx, {
          batchId: claim.batch.batchId,
          generationId: claim.batch.generationId,
          seeds,
          factMode,
          mode,
        });
      const quoteRepair = () => {
        let firstIssues = 0;
        return {
          ask: async (batch: ValidatedSeedBatch, answer: unknown) => {
            const first = await review(batch.seeds);
            if (first.writerWaiting) return null;
            firstIssues = first.issues.length;
            return seedQuoteRepairText({
              issues: first.issues,
              seedIndexes: batch.seedIndexes,
              citationMode: factMode ? "facts" : "offsets",
              answer,
            });
          },
          keepRepaired: async (first: ValidatedSeedBatch, repaired: ValidatedSeedBatch) =>
            repaired.seeds.length >= first.seeds.length &&
            (await review(repaired.seeds)).issues.length < firstIssues,
        };
      };
      const output = await generateStructured<ValidatedSeedBatch>(client, {
        system: request.system,
        user: request.userBlocks,
        // 2026-09-29 (first, run 7 re-check): three fixed tools in every
        // Seed request; the forced one requires the links when the request
        // sends a link block.
        ...seedTools(factMode ? seedToolSchemaForFacts() : seedToolSchema(), toolKind),
        description: SEED_PROMPT_PROGRAM.request.description,
        // The same tools for every role and mode keep the cached tools
        // prefix shared; validatedBatchSchema enforces role, mode and the
        // offered ids. A generation that reads fact packs uses the fact
        // schemas for all.
        ...(toolKind !== "shared"
          ? { invalidAnswerRepair: (answer: unknown) => seedLinkRepairText(answer, request.promptBytes) }
          : {}),
        // PR #22 review (G13): an answer from another of the three tools is
        // refused and repaired (a model that cannot be forced may pick
        // one), and counted. It is not a link failure, so the writer is not
        // told the links were wrong.
        onWrongTool: (_calledTool: string, answer: unknown) => {
          lastRejection = undefined;
          rejectedAnswers.push(wrongToolAnswerCounts(seedsIn(answer), mode));
        },
        maxTokens: SEED_PROMPT_PROGRAM.request.maxTokens,
        model: claim.batch.model,
        attempts: 2,
        // 2026-09-27 (third, lead answer 1): only a prefetch nobody waits
        // on may spend the one repair on its quotes. Every other Batch keeps
        // its first answer, and completeAttempt marks those quotes. The
        // repaired answer is kept only when it has fewer quote issues and
        // no fewer Seeds (review P2-2).
        ...(claim.batch.operation === "prefetch" ? { softRepair: quoteRepair() } : {}),
        validate: validatedBatchSchema({
          roleId: claim.batch.roleId,
          mode,
          generationId: claim.batch.generationId,
          snapshot: claim.context,
          uncertaintyRoots: claim.uncertaintyRoots,
          sources,
          ...(factSources ? { factSources } : {}),
          onRejected: (result, returned) => {
            lastRejection = result;
            rejectedAnswers.push(seedAnswerCounts(result, returned));
          },
        }),
      });

      const seeds = output.seeds.map((seed) => ({
        bullets: seed.bullets,
        tags: seed.tags,
        provenance: seed.provenance.map((citation) => ({
          sourceId: validatedId<"generationSources">(citation.sourceId),
          startOffset: citation.startOffset,
          endOffset: citation.endOffset,
          exactExcerpt: citation.exactExcerpt,
          ...(factMode && citation.factId ? { factId: citation.factId } : {}),
        })),
        ...(seed.uncertaintySeedId
          ? {
              uncertaintySeedId: validatedId<"seeds">(
                seed.uncertaintySeedId
              ),
            }
          : {}),
        ...(seed.experimentSeedIds
          ? {
              experimentSeedIds: seed.experimentSeedIds.map((seedId) =>
                validatedId<"seeds">(seedId)
              ),
            }
          : {}),
      }));

      await ctx.runMutation(completeAttemptRef, {
        batchId: claim.batch.batchId,
        attemptId: claim.batch.attemptId,
        requestsMade,
        seeds,
        seedsDropped: output.dropped,
      });
    } catch (error) {
      const detail = failureDetail(error, lastRejection);
      await ctx.runMutation(failAttemptRef, {
        batchId: claim.batch.batchId,
        attemptId: claim.batch.attemptId,
        requestsMade,
        errorCode: failureCode(error),
        ...(detail ? { errorDetail: detail } : {}),
        ...(rejectedAnswers.length ? { invalidAnswers: rejectedAnswers } : {}),
      });
    }
    return null;
  },
});
