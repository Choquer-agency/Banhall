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
import { MalformedOutputError, messageText } from "./openrouterCore";
import { generateStructured } from "./structured";
import {
  normalizeProviderError,
  seedClientForModel,
} from "./providers";
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
  seedToolSchema,
  validateBatch,
  type FrozenSeedSource,
  type SeedReference,
  type ValidatedSeedCandidate,
} from "../lib/seedContract";

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

function validatedBatchSchema(args: {
  roleId: Parameters<typeof validateBatch>[0]["roleId"];
  mode: Parameters<typeof validateBatch>[0]["mode"];
  generationId: string;
  snapshot: SeedContextSnapshot;
  sources: readonly FrozenSeedSource[];
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
    .object({ seeds: z.array(z.unknown()) })
    .transform((value, context): ValidatedSeedBatch => {
      const result = validateBatch({
        roleId: args.roleId,
        mode: args.mode,
        seeds: value.seeds,
        referenceContext: { generationId: args.generationId, references },
        frozenSources: args.sources,
      });
      if (!result.ok) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.issues
            .slice(0, 3)
            .map((issue) => issue.code)
            .join(", "),
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
    const claim = await ctx.runMutation(claimAttemptRef, {
      batchId: args.batchId,
    });
    if (claim.kind !== "claimed") return null;

    let requestsMade = 0;
    try {
      const mode = claim.batch.operation === "feedback" ? "feedback" : "batch";
      const sources: FrozenSeedSource[] = claim.input.sources.map((source) => ({
        sourceId: source._id,
        generationId: claim.batch.generationId,
        content: source.content,
        contentHash: source.contentHash,
      }));
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
      const client = countedClient(
        seedClientForModel(ctx, claim.batch.model, {
          callSite: claim.batch.slot,
          projectId: claim.batch.projectId,
          attribution: { generationId: claim.batch.generationId },
        }),
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
        // prefix shared; validatedBatchSchema enforces role and mode.
        schema: seedToolSchema(),
        maxTokens: SEED_PROMPT_PROGRAM.request.maxTokens,
        model: claim.batch.model,
        attempts: 2,
        validate: validatedBatchSchema({
          roleId: claim.batch.roleId,
          mode,
          generationId: claim.batch.generationId,
          snapshot: claim.context,
          sources,
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
