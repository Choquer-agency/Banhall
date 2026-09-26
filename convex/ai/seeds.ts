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
import { internalAction } from "../_generated/server";
import type { Id, TableNames } from "../_generated/dataModel";
import type {
  claimAttempt,
  completeAttempt,
  failAttempt,
} from "../seedRuns";
import type { GenerationClient } from "./openrouterCore";
import { MalformedOutputError, OutputLimitError, messageText } from "./openrouterCore";
import { generateStructured } from "./structured";
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
  seedPromptProjection,
} from "./trustedContext";
import {
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
  seedToolSchema,
  validateBatch,
  type BatchValidationResult,
  type FrozenSeedSource,
  type SeedBatchMode,
  type SeedReference,
  type SeedValidationIssueCode,
  type ValidatedSeedCandidate,
} from "../lib/seedContract";
import {
  readsFactPacks,
  resolveFactCitations,
  seedToolSchemaForFacts,
  type FactSource,
} from "../lib/seedFacts";

type ValidatedSeedBatch = {
  seeds: ValidatedSeedCandidate[];
  dropped: number;
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
function seedIssueHints(mode: SeedBatchMode): Record<SeedValidationIssueCode, string> {
  const [min, max] =
    mode === "batch"
      ? [MIN_BATCH_SEEDS, MAX_BATCH_SEEDS]
      : [MIN_FEEDBACK_SEEDS, MAX_FEEDBACK_SEEDS];
  return {
    INVALID_SHAPE: "wrong fields or tag",
    INVALID_BULLET_COUNT: "use one or two bullets",
    BULLET_TOO_LONG: `a bullet is over ${MAX_BULLET_WORDS} words`,
    BULLET_NOT_ONE_SENTENCE: "a bullet is not one sentence ending in a full stop",
    BULLET_TYPOGRAPHIC_DASH: "use a plain hyphen",
    INVALID_TAG_COUNT: "use one or two tags",
    INVALID_TAG: "use only the allowed tags",
    DUPLICATE_TAG: "a tag is repeated",
    INVALID_ADVANCEMENT_REFERENCE:
      "copy uncertaintySeedId and experimentSeedIds from the frozen selections",
    INVALID_PROVENANCE: "",
    INVALID_BATCH_SIZE: `return ${min} to ${max} valid Seeds`,
    INSUFFICIENT_TAG_DIVERSITY: "use at least two different tags",
    INSUFFICIENT_FORM_DIVERSITY: "mix one-bullet and two-bullet Seeds",
  };
}

const REPAIR_OMITTED = "more issues omitted";

/**
 * Repair feedback the model can act on. The retry never shows the model its
 * failed output, so the note leads with the broken rules and names the Seeds
 * by position only; it never carries Seed text. structured.ts prefixes
 * "(root): ", and the note stays inside the prompt's reserved repair bytes
 * with that prefix, marking any rules it had to leave out.
 */
export function seedRepairSummary(
  result: BatchValidationResult,
  returned: number,
  mode: SeedBatchMode
): string {
  const hints = seedIssueHints(mode);
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
  sources: readonly FrozenSeedSource[];
  /**
   * 2026-09-24 (transcript method): set when every transcript is read
   * through its fact pack. Fact ids and document excerpts are resolved to
   * offsets on frozen rows before the Seed contract byte-checks them.
   */
  factSources?: readonly FactSource[];
}): z.ZodType<ValidatedSeedBatch> {
  const references: SeedReference[] = args.snapshot.items
    .filter((item) => item.kind === "selection")
    .map((item) => ({
      seedId: item.seedId,
      generationId: args.generationId,
      roleId: item.roleId,
      active: true,
    }));
  return z
    .object({ seeds: z.preprocess(parseStringifiedSeeds, z.array(z.unknown())) })
    .transform((value, context): ValidatedSeedBatch => {
      const seeds = args.factSources
        ? resolveFactCitations(value.seeds, args.factSources).seeds
        : value.seeds;
      const result = validateBatch({
        roleId: args.roleId,
        mode: args.mode,
        seeds,
        referenceContext: { generationId: args.generationId, references },
        frozenSources: args.sources,
      });
      if (!result.ok) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: seedRepairSummary(result, seeds.length, args.mode),
        });
        return z.NEVER;
      }
      return {
        seeds: result.seeds,
        dropped: result.dropped,
      };
    });
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
  if (
    error instanceof Error &&
    (error.message.includes(SEED_PROMPT_PROGRAM.request.toolName) ||
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
        projection: seedPromptProjection(claim.context),
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
      const output = await generateStructured<ValidatedSeedBatch>(client, {
        system: request.system,
        user: request.userBlocks,
        toolName: SEED_PROMPT_PROGRAM.request.toolName,
        description: SEED_PROMPT_PROGRAM.request.description,
        // One schema for every role and mode keeps the cached tools
        // prefix shared; validatedBatchSchema enforces role and mode. A
        // generation that reads fact packs uses the fact schema for all.
        schema: factMode ? seedToolSchemaForFacts() : seedToolSchema(),
        maxTokens: SEED_PROMPT_PROGRAM.request.maxTokens,
        model: claim.batch.model,
        attempts: 2,
        validate: validatedBatchSchema({
          roleId: claim.batch.roleId,
          mode,
          generationId: claim.batch.generationId,
          snapshot: claim.context,
          sources,
          ...(factSources ? { factSources } : {}),
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
      await ctx.runMutation(failAttemptRef, {
        batchId: claim.batch.batchId,
        attemptId: claim.batch.attemptId,
        requestsMade,
        errorCode: failureCode(error),
      });
    }
    return null;
  },
});
