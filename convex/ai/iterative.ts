"use node";

// Iterative (section-by-section) PD generation.
//
// The writer's workflow: analyzer + Brain retrieval run ONCE (frozen as
// generationArtifacts), then sections draft one at a time — 242 → review/
// edit/approve → 244 (with approved 242 as canonical context) → 246 →
// assemble. A background one-shot "ghost" draft runs through the existing
// candidate pipeline in parallel, peekable for comparison only: its content
// is NEVER used as context for section drafting and never selectable as the
// report.

import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import {
  clientForModel,
  clientForStep,
  describeProviderFailure,
  generationStepClients,
  registerGenerationModels,
  startActionDeadline,
} from "./providers";
import { resolveGenerationStep } from "../lib/generationSteps";
import { RETRIEVAL_BRIEF_MODEL } from "./brain/query";
import Anthropic from "@anthropic-ai/sdk";
import { ANALYZER_REQUEST, runAnalyzerAgent, type TranscriptAnalysis } from "./analyzerAgent";
import { ActionTimeBudgetError, isErrorOf } from "./actionDeadline";
import { OpenRouterError } from "./openrouter";
import { alwaysThinkingMaxTokens } from "../../shared/generationModels";
import { runGenerationBriefStage, deriveOrReuseBrief } from "./brief";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { MODEL, candidateModelsForMode } from "./model";
import { normalizeProviderError } from "./providers";
import { OutputLimitError } from "./openrouterCore";
import type { BrainProvenanceEntry } from "../lib/generationOutputs";
import type { DraftingInputsFailureCode } from "../lib/draftingInputsFailure";
import {
  condenserFor,
  describeGenerationFailure,
  ensureCondensedInputs,
  ensureFactInputs,
} from "./condense";
import { retrieveBrainBlocks } from "./brainRetrieval";
import { describeTranscriptInput } from "../lib/transcripts";
import {
  beginTrackedGeneration,
  buildStyleGuidance,
  buildAnalyzerContext,
  compressToFit,
  includedDocumentCount,
  lengthBudgetBlock,
  recordContextBudget,
} from "./pipeline";
import { describeContextCuts } from "./trustedContext";
import { scrubBannedWordsUnlessWaived } from "../../shared/bannedWords";
import { sectionDeterministicFindings } from "./qaChecks";
import { sectionMetrics, type LengthTarget, type SectionKey } from "../lib/lineLimits";
import { normalizeCraScienceCode } from "../../shared/craScienceCodes";
import {
  NO_STYLE_OVERRIDES,
  normalizeStyleOverrides,
} from "../../shared/styleOverrides";
import { resolveGenerationWriterSettings } from "./writerSettings";
import type { Id } from "../_generated/dataModel";
import type { ModelFreeze } from "../lib/modelCatalogValidators";
import type { StyleOverrides } from "../../shared/styleOverrides";
import {
  brainBlocksArtifactContent,
  writerStyleArtifactContent,
  type FrozenWriterStyle,
} from "../lib/frozenWriterStyle";
import {
  ITERATIVE_PROMPT_SCAFFOLDS,
  ITERATIVE_SECTION_TITLES,
} from "./promptDefinitions";

type IterativeSection = "s242" | "s244" | "s246";

const SECTION_TITLES: Record<IterativeSection, string> =
  ITERATIVE_SECTION_TITLES;

export { ITERATIVE_PROMPT_SCAFFOLDS } from "./promptDefinitions";

/** Derive or reuse the frozen seed Brief. Never throws: this boundary
 * never persists provider errors or source/model text. */
async function deriveSeedBrief(
  ctx: ActionCtx,
  generationId: Id<"generations">,
  projectId: Id<"projects">,
  model: string,
  freeze: ModelFreeze | null,
  requestedBy?: Id<"users">
): Promise<boolean> {
  try {
    // Owner decision 43: the Brief runs on the frozen planning model.
    const route = resolveGenerationStep({ freeze, step: "brief", writerModel: model });
    const client = clientForStep(ctx, route, {
      callSite: "generation:brief", projectId,
      ...(requestedBy ? { userId: requestedBy } : {}),
      attribution: { generationId },
    });
    const result = await deriveOrReuseBrief(ctx, client, {
      projectId, generationId, model: route.model, seedStartup: true,
    });
    return result.kind !== "no_evidence";
  } catch {
    return false;
  }
}

/** Open the seed stage once its Brief exists, or leave a retryable failure. */
async function openSeedStageOrRecordFailure(
  ctx: ActionCtx,
  generationId: Id<"generations">,
  briefReady: boolean
): Promise<void> {
  try {
    if (!briefReady) throw new Error("Frozen seed evidence is unavailable");
    await ctx.runMutation(internal.generations.initializeSeedStage, { generationId });
  } catch {
    // This boundary never persists provider errors or source/model text.
    await ctx.runMutation(internal.generations.recordSeedInitializationFailure, { generationId });
  }
}

async function finishSeedInitialization(
  ctx: ActionCtx,
  generationId: Id<"generations">,
  projectId: Id<"projects">,
  model: string,
  freeze: ModelFreeze | null,
  requestedBy?: Id<"users">
): Promise<void> {
  const briefReady = await deriveSeedBrief(ctx, generationId, projectId, model, freeze, requestedBy);
  await openSeedStageOrRecordFailure(ctx, generationId, briefReady);
}

/**
 * Frozen once: learned digests + the writer's personal flavor, as the
 * style every later step reads. All wrapped so learning/flavor can NEVER
 * break generation. qaCalibration only feeds the ghost draft's QA agent;
 * section drafts use deterministic checks (the writer is the QA).
 */
async function resolveFrozenWriterStyle(
  ctx: ActionCtx,
  args: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    requestedBy?: Id<"users">;
    freeze: ModelFreeze | null;
    log: (line: string) => Promise<unknown>;
  }
): Promise<{
  style: FrozenWriterStyle;
  /** The resolver's own waivers, absent when it returned none. */
  resolvedStyleOverrides?: StyleOverrides;
}> {
  const { generationId: genId, projectId, freeze, log } = args;
  // Shared writer-settings resolver (story 3, writerSettings.ts): saved
  // profile or settings document, started in parallel with the digest
  // fetch; it degrades instead of throwing. Iterative keeps its gate and
  // reads only the flavor and waivers.
  const writerStylePromise = resolveGenerationWriterSettings(ctx, {
    generationId: genId,
    projectId,
    requestedBy: args.requestedBy,
    // The analysis role's model frozen at reservation.
    model: freeze?.roles.analysis ?? MODEL,
    clientFor: (callSite) =>
      clientForModel(ctx, freeze?.roles.analysis ?? MODEL, {
        callSite,
        projectId,
        ...(args.requestedBy ? { userId: args.requestedBy } : {}),
        attribution: { generationId: genId },
      }),
    log,
  });
  let draftStyle: string | undefined;
  let qaCalibration: string | undefined;
  let draftStyleDigestId: Id<"learningDigests"> | undefined;
  let qaCalibrationDigestId: Id<"learningDigests"> | undefined;
  try {
    const [qaDigest, styleDigest] = await Promise.all([
      ctx.runQuery(internal.learning.getActiveDigest, {
        kind: "qa_calibration",
      }),
      ctx.runQuery(internal.learning.getActiveDigest, {
        kind: "draft_style",
      }),
    ]);
    if (qaDigest?.content.trim()) {
      qaCalibration = qaDigest.content;
      qaCalibrationDigestId = qaDigest._id;
    }
    if (styleDigest?.content.trim()) {
      draftStyle = styleDigest.content;
      draftStyleDigestId = styleDigest._id;
      await log(
        `Applying drafting style learned from ${styleDigest.sourceCount} writer critique(s).`
      );
    }
  } catch (err) {
    console.error("learning digest fetch failed for generation", genId, err);
  }
  const { writerFlavor, styleOverrides, orderedContext } = await writerStylePromise;
  return {
    style: {
      styleGuidance: buildStyleGuidance(
        draftStyle,
        writerFlavor,
        styleOverrides ?? NO_STYLE_OVERRIDES
      ),
      orderedContext,
      ...(qaCalibration ? { qaCalibration } : {}),
      ...(draftStyle ? { draftStyle } : {}),
      ...(qaCalibrationDigestId ? { qaCalibrationDigestId } : {}),
      ...(draftStyleDigestId ? { draftStyleDigestId } : {}),
      ...(writerFlavor ? { writerFlavor } : {}),
      styleOverrides: styleOverrides ?? NO_STYLE_OVERRIDES,
    },
    ...(styleOverrides ? { resolvedStyleOverrides: styleOverrides } : {}),
  };
}

/**
 * The reordered Step-by-step start (owner decision 32, 2026-09-25). Seeds
 * read the Brief, the frozen sources, the frozen writer style and the
 * writer's decisions, never the analysis or Brain blocks. So once the
 * sources are frozen the Brief starts at once, beside the writer style;
 * the analysis and Brain retrieval are scheduled as their own background
 * action (prepareSeedDraftingInputs) and must be ready before sign-off; and
 * the seed stage opens as soon as the Brief and the style exist.
 */
async function startSeedStage(
  ctx: ActionCtx,
  args: {
    generationId: Id<"generations">;
    projectId: Id<"projects">;
    model: string;
    requestedBy?: Id<"users">;
    freeze: ModelFreeze | null;
    log: (line: string) => Promise<unknown>;
  }
): Promise<void> {
  const { generationId } = args;
  const brief = deriveSeedBrief(
    ctx,
    generationId,
    args.projectId,
    args.model,
    args.freeze,
    args.requestedBy
  );
  try {
    const { style } = await resolveFrozenWriterStyle(ctx, args);
    await ctx.runMutation(internal.generations.saveWriterStyle, {
      generationId,
      writerStyle: writerStyleArtifactContent(style),
    });
    // Scheduled only after the style is frozen: the background step builds
    // `brain_blocks` from it.
    await ctx.runMutation(internal.generations.startDraftingInputs, { generationId });
  } catch (error) {
    await ctx.runMutation(internal.generations.failGeneration, {
      generationId,
      error: describeGenerationFailure(error),
    });
    // The Brief's own writes are fenced to a live seed stage.
    await brief;
    return;
  }
  await openSeedStageOrRecordFailure(ctx, generationId, await brief);
}

/** Retry only frozen Brief publication and row initialization, never analysis or retrieval. */
export const resumeSeedInitialization = internalAction({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // The action's deadline bounds every provider request (actionDeadline.ts).
    startActionDeadline(ctx);
    const input = await ctx.runQuery(internal.generations.getGenerationInput, args);
    if (!input || input.gatedWorkflow !== "seeds") return null;
    const freeze = await registerGenerationModels(ctx, args.generationId);
    const model = candidateModelsForMode("iterative", input.singleModelId)[0];
    await finishSeedInitialization(ctx, args.generationId, input.projectId, model.id, freeze, input.requestedBy);
    return null;
  },
});

/** The stored reason for a failed background attempt: a normalized code,
 * never provider or model text. A cut-off structured answer is checked by
 * class first, whatever its message says. An action that ran out of time,
 * or a request that ran to its own timeout, is `timed_out` (review
 * 2026-09-25). */
export function draftingInputsFailureCode(error: unknown): DraftingInputsFailureCode {
  if (error instanceof OutputLimitError) return "output_limit";
  if (error instanceof ActionTimeBudgetError) return "timed_out";
  if (isErrorOf(error, Anthropic.APIConnectionTimeoutError)) return "timed_out";
  if (error instanceof OpenRouterError && error.status === undefined && /timed out/i.test(error.message)) {
    return "timed_out";
  }
  return normalizeProviderError(error).code;
}

/**
 * Whether the next attempt should ask for a shorter analysis: this one saw
 * an answer cut off at the output limit (even when its repair then failed
 * another way), or the analyzer of a model that always thinks ran out of
 * time. Such a model is given four times the answer budget as thinking
 * room, so a long analysis runs into the time limit instead of the output
 * limit (review 2026-09-25).
 */
export function draftingInputsNeedShorterAnalysis(args: {
  code: DraftingInputsFailureCode;
  sawCutOff: boolean;
  analyzerModel: string | undefined;
}): boolean {
  if (args.sawCutOff || args.code === "output_limit") return true;
  if (args.code !== "timed_out" || args.analyzerModel === undefined) return false;
  return alwaysThinkingMaxTokens(args.analyzerModel, ANALYZER_REQUEST.maxTokens) > ANALYZER_REQUEST.maxTokens;
}

/**
 * The background step of the reordered Step-by-step start (owner decision
 * 32, 2026-09-25): Brain retrieval and the transcript analysis, run on the
 * generation's frozen inputs while the writer works the Seeds, then frozen
 * as the `analysis` and `brain_blocks` artifacts sign-off needs. The same
 * calls, clients and inputs as before the reorder, so the provider requests
 * are unchanged. Fenced by `attempt`: a cancel, a deletion, sign-off or a
 * newer attempt stops it before its paid calls and drops its result. Any
 * failure leaves the drafting inputs failed with its normalized code, for
 * the writer to retry. `shorterAnalysis` (a retry after an analysis that
 * was too long, draftingInputsNeedShorterAnalysis) appends
 * ANALYZER_REQUEST.shorterRetryNote to the analyzer's request; its template
 * and caps are unchanged, but each attempt reruns Brain retrieval on the
 * project's live details, so its exemplars can differ.
 */
export const prepareSeedDraftingInputs = internalAction({
  args: {
    generationId: v.id("generations"),
    attempt: v.number(),
    shorterAnalysis: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // The action's deadline bounds every provider request (actionDeadline.ts).
    startActionDeadline(ctx);
    const attemptArgs = { generationId: args.generationId, attempt: args.attempt };
    const stillCurrent = () =>
      ctx.runQuery(internal.generations.isDraftingInputsAttemptCurrent, attemptArgs);
    if (!(await stillCurrent())) return null;
    // Set once the analyzer runs: what the failure path needs to decide
    // whether the next attempt asks for a shorter analysis.
    let analyzerModel: string | undefined;
    let sawCutOff = false;
    try {
      // Model catalog: routing and output budgets read the frozen models.
      const freeze = await registerGenerationModels(ctx, args.generationId);
      const input = await ctx.runQuery(internal.generations.getGenerationInput, {
        generationId: args.generationId,
      });
      if (!input || input.gatedWorkflow !== "seeds") return null;
      const genId = input.generationId;
      const projectId = input.projectId;
      const model = candidateModelsForMode("iterative", input.singleModelId)[0];
      const briefModel = freeze?.roles.retrieval_brief ?? RETRIEVAL_BRIEF_MODEL;
      const log = (line: string) =>
        ctx.runMutation(internal.generations.appendProgress, {
          generationId: genId,
          line,
        });
      // The same bounded analyzer input startup recorded (pure, from the
      // same frozen rows).
      const analyzerContext = buildAnalyzerContext(input);
      // Written with the attempt-fenced completion, not at once.
      let brainProvenance: { exemplars: BrainProvenanceEntry[]; brief?: string } | undefined;
      const brainBlocks = await retrieveBrainBlocks(ctx, {
        generationId: genId,
        projectId,
        title: input.title || "Untitled Report",
        transcript: input.transcript,
        industry: input.industry ?? null,
        scienceCode: normalizeCraScienceCode(input.scienceCode) ?? null,
        ...(input.transcriptReading === "facts"
          ? { factPacks: input.transcriptParts.map((part) => part.content), placeholders: input.placeholders }
          : {}),
        retrievalBriefClient: clientForModel(ctx, briefModel, {
          callSite: "generation:retrieval_brief",
          projectId,
          ...(input.requestedBy ? { userId: input.requestedBy } : {}),
          attribution: { generationId: genId },
        }),
        retrievalBriefModel: briefModel,
        log,
        recordProvenance: async (exemplars, brief) => {
          brainProvenance = { exemplars, ...(brief !== undefined ? { brief } : {}) };
        },
      });
      if (!(await stillCurrent())) return null;
      // Owner decision 43: the analysis runs on the frozen planning model.
      const analyzerRoute = resolveGenerationStep({ freeze, step: "analyzer", writerModel: model.id });
      analyzerModel = analyzerRoute.model;
      const analysis = await runAnalyzerAgent(
        clientForStep(ctx, analyzerRoute, {
          callSite: "generation:analyzer",
          projectId,
          ...(input.requestedBy ? { userId: input.requestedBy } : {}),
          attribution: { generationId: genId },
        }),
        analyzerContext.userMessage,
        analyzerRoute.model,
        brainBlocks.analyzer,
        {
          shorter: args.shorterAnalysis === true,
          onCutOff: () => {
            sawCutOff = true;
          },
        }
      );
      await ctx.runMutation(internal.generations.completeDraftingInputs, {
        ...attemptArgs,
        analysis: JSON.stringify(analysis),
        brainBlocks: JSON.stringify(brainBlocks),
        ...(brainProvenance ? { brainProvenance } : {}),
      });
    } catch (error) {
      // Only the normalized code: never provider or source text.
      const code = draftingInputsFailureCode(error);
      const shorterAnalysis = draftingInputsNeedShorterAnalysis({ code, sawCutOff, analyzerModel });
      console.error("drafting inputs failed for generation", args.generationId, code);
      await ctx.runMutation(internal.generations.failDraftingInputs, {
        ...attemptArgs,
        code,
        ...(shorterAnalysis ? { shorterAnalysis: true } : {}),
      });
    }
    return null;
  },
});

/**
 * One-time setup for an iterative generation. Section approval: analyzer +
 * Brain retrieval + style/flavor capture (all frozen as
 * generationArtifacts), section-run rows, the first section draft, and the
 * background ghost draft. Step by step (owner decision 32): the writer style
 * and the Brief open the seed stage while prepareSeedDraftingInputs runs the
 * analysis and Brain retrieval in the background (startSeedStage).
 */
export const startIterativeGeneration = internalAction({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const actionStartedAt = Date.now();
    // The action's deadline bounds every provider request (actionDeadline.ts).
    startActionDeadline(ctx, actionStartedAt);
    if (!(await beginTrackedGeneration(ctx, args.generationId))) return;
    const reservedInput = await ctx.runQuery(
      internal.generations.getGenerationInput,
      { generationId: args.generationId }
    );
    if (!reservedInput) {
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: args.generationId,
        error: "The frozen generation input is unavailable.",
      });
      return;
    }
    let input = reservedInput;
    const genId = input.generationId;
    const projectId = input.projectId;
    const title = input.title || "Untitled Report";
    // Model catalog: resolve the models frozen at reservation first.
    const freeze = await registerGenerationModels(ctx, genId);
    // Iterative mode uses single-model semantics: the explicitly selected
    // model, defaulting to the writing role's model at reservation.
    const model = candidateModelsForMode("iterative", input.singleModelId)[0];
    // Routed by each step's model (owner decision 43) and its gateway
    // (Anthropic direct / OpenRouter).
    const steps = generationStepClients(ctx, {
      freeze,
      writerModel: model.id,
      meta: (callSite, learningDigestIds) => ({
        callSite,
        projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
        attribution: {
          generationId: genId,
          ...(learningDigestIds?.length ? { learningDigestIds } : {}),
        },
      }),
    });
    // The Brain's retrieval brief runs on the retrieval_brief role's model
    // frozen at reservation, never the candidate model.
    const briefModel = freeze?.roles.retrieval_brief ?? RETRIEVAL_BRIEF_MODEL;
    const briefClient = clientForModel(ctx, briefModel, {
      callSite: "generation:retrieval_brief",
      projectId,
      ...(input.requestedBy ? { userId: input.requestedBy } : {}),
      attribution: { generationId: genId },
    });
    const log = (line: string) =>
      ctx.runMutation(internal.generations.appendProgress, {
        generationId: genId,
        line,
      });

    try {
      const scienceCode = normalizeCraScienceCode(input.scienceCode);
      if (input.scienceCode?.trim() && !scienceCode) {
        throw new Error("Project science code is not a valid CRA T4088 line 206 code");
      }
      await log(describeTranscriptInput(input.transcriptParts));
      await log(`Section-by-section drafting with ${model.label}.`);

      // Over-budget transcript sets are reduced to stored digests and frozen
      // as their own source rows before anything reads the transcript text;
      // the re-read below returns the digest parts every later step cites.
      // 2026-09-24 (transcript method, decision 27): a generation frozen to
      // read fact packs extracts and freezes them first; any gap falls back
      // to today's path below.
      const factsReady = input.transcriptFacts
        ? await ensureFactInputs(
            ctx,
            {
              generationId: genId,
              elapsedMs: Date.now() - actionStartedAt,
              modelId: freeze?.roles.condense ?? MODEL,
              ...(input.requestedBy ? { userId: input.requestedBy } : {}),
            },
            log
          )
        : false;
      if (!factsReady && input.inputMode === "digest") {
        await ensureCondensedInputs(
          ctx,
          { generationId: genId, elapsedMs: Date.now() - actionStartedAt },
          log,
          condenserFor(ctx, {
            generationId: genId,
            projectId,
            ...(input.requestedBy ? { userId: input.requestedBy } : {}),
            modelId: freeze?.roles.condense ?? MODEL,
          })
        );
      }
      if (factsReady || input.inputMode === "digest") {
        const condensed = await ctx.runQuery(
          internal.generations.getGenerationInput,
          { generationId: args.generationId }
        );
        if (!condensed) throw new Error("The frozen generation input is unavailable.");
        input = condensed;
      }
      const transcript = input.transcript;

      // Bounded, delimited analyzer input — built once, recorded once, and
      // reported to the writer by what the budget actually kept.
      const analyzerContext = buildAnalyzerContext(input);
      await recordContextBudget(ctx, genId, analyzerContext.report);
      const includedDocs = includedDocumentCount(analyzerContext.report);
      if (includedDocs > 0) {
        await log(`Using ${includedDocs} frozen contextual document(s), weighted by SR&ED priority.`);
      }
      const cuts = describeContextCuts(analyzerContext.report);
      if (cuts) await log(cuts);

      if (input.gatedWorkflow === "seeds") {
        await startSeedStage(ctx, {
          generationId: genId,
          projectId,
          model: model.id,
          ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
          freeze,
          log,
        });
        return;
      }

      // Frozen once: Brain exemplar blocks (never re-retrieved per section).
      const brainBlocks = await retrieveBrainBlocks(ctx, {
        generationId: genId,
        projectId,
        title,
        transcript,
        industry: input.industry ?? null,
        scienceCode: scienceCode ?? null,
        // Plan step 8: reading fact packs, the retrieval brief comes from
        // their claims with no call.
        ...(input.transcriptReading === "facts"
          ? { factPacks: input.transcriptParts.map((part) => part.content), placeholders: input.placeholders }
          : {}),
        retrievalBriefClient: briefClient,
        retrievalBriefModel: briefModel,
        log,
      });

      // Frozen once: learned digests + the writer's personal flavor.
      const { style, resolvedStyleOverrides: styleOverrides } =
        await resolveFrozenWriterStyle(ctx, {
          generationId: genId,
          projectId,
          ...(input.requestedBy ? { requestedBy: input.requestedBy } : {}),
          freeze,
          log,
        });
      const {
        qaCalibration,
        draftStyle,
        qaCalibrationDigestId,
        draftStyleDigestId,
        writerFlavor,
      } = style;

      // Frozen once: analyzer output shared by every section draft.
      await log("Analyzing the transcript (runs once — shared by all sections)…");
      const analysis = await runAnalyzerAgent(
        steps.client("generation:analyzer"),
        analyzerContext.userMessage,
        steps.route("generation:analyzer").model,
        brainBlocks.analyzer
      );

      await ctx.runMutation(internal.generations.saveIterativeArtifacts, {
        generationId: genId,
        analysis: JSON.stringify(analysis),
        // Documented shape: { blocks: BrainExemplarBlocks, styleGuidance,
        // styleOverrides, ... } (convex/lib/frozenWriterStyle.ts).
        brainBlocks: brainBlocksArtifactContent(brainBlocks, style),
      });

      // Story 1 (CAP-1/2/4): derive or reuse the Generation Brief once,
      // shared by every section below. Never fatal — Brief is read-only
      // guidance, so the stage runner never throws: a failure logs and the
      // generation continues without one. DW-109/DW-120: every attempt is
      // recorded on generations.briefOutcome and narrated with one authored
      // progress line.
      await runGenerationBriefStage(ctx, steps.client("generation:brief"), {
        projectId,
        generationId: genId,
        model: steps.route("generation:brief").model,
      });

      const created = await ctx.runMutation(
        internal.generations.createSectionRuns,
        { generationId: genId, model: model.id, label: model.label }
      );
      if (!created) return;

      // Background ghost: one-shot full draft via the existing candidate
      // pipeline, for comparison only. Never used as section context.
      const ghostRunId = await ctx.runMutation(
        internal.generations.createCandidateRun,
        { generationId: genId, model: model.id, label: model.label, ghost: true }
      );
      if (ghostRunId) {
        const ghostJobId = await ctx.scheduler.runAfter(
          0,
          internal.ai.pipeline.generateCandidate,
          {
            candidateRunId: ghostRunId,
            generationId: genId,
            brainExemplars: brainBlocks,
            ...(qaCalibration ? { qaCalibration } : {}),
            ...(draftStyle ? { draftStyle } : {}),
            ...(qaCalibrationDigestId ? { qaCalibrationDigestId } : {}),
            ...(draftStyleDigestId ? { draftStyleDigestId } : {}),
            ...(writerFlavor ? { writerFlavor } : {}),
            ...(styleOverrides ? { styleOverrides } : {}),
          }
        );
        await ctx.runMutation(internal.generations.setCandidateRunJob, {
          candidateRunId: ghostRunId,
          scheduledJobId: ghostJobId,
        });
        await log("One-shot comparison draft generating in the background.");
      }

      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: `Drafting ${SECTION_TITLES.s242}…`,
      });
      await ctx.scheduler.runAfter(0, internal.ai.iterative.generateSection, {
        generationId: genId,
        section: "s242",
      });
    } catch (error) {
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: genId,
        error: describeGenerationFailure(error),
      });
    }
  },
});

/** Prompt block carrying writer-approved prior sections as canonical context. */
export function priorSectionsBlock(
  priorSections: Array<{ section: IterativeSection; text: string }>
): string {
  if (priorSections.length === 0) return "";
  const body = priorSections
    .map(
      (p) =>
        `${ITERATIVE_PROMPT_SCAFFOLDS.approvedPriorSections.itemTitlePrefix}${SECTION_TITLES[p.section]}${ITERATIVE_PROMPT_SCAFFOLDS.approvedPriorSections.itemTitleSuffix}${p.text}`
    )
    .join(ITERATIVE_PROMPT_SCAFFOLDS.approvedPriorSections.separator);
  return `${ITERATIVE_PROMPT_SCAFFOLDS.approvedPriorSections.prefix}${body}`;
}

/** Draft (or redraft) one section, fenced by its durable section-run row. */
export const generateSection = internalAction({
  args: {
    generationId: v.id("generations"),
    section: v.union(v.literal("s242"), v.literal("s244"), v.literal("s246")),
  },
  handler: async (ctx, args) => {
    // The action's deadline bounds every provider request (actionDeadline.ts).
    startActionDeadline(ctx);
    // Model catalog: routing and output budgets read the frozen models.
    const freeze = await registerGenerationModels(ctx, args.generationId).catch(() => null);
    const run = await ctx.runMutation(internal.generations.claimSectionRun, {
      generationId: args.generationId,
      section: args.section,
    });
    if (!run) return;
    const input = await ctx.runQuery(
      internal.generations.getIterativeSectionInput,
      { generationId: args.generationId, section: args.section }
    );
    const fail = (error: string) =>
      ctx.runMutation(internal.generations.failSectionRun, {
        generationId: args.generationId,
        section: args.section,
        error,
      });
    if (!input) {
      await fail("The frozen section inputs are unavailable.");
      return;
    }
    // The section run's model writes and compresses (owner decision 43),
    // routed by its gateway.
    const clientFor = generationStepClients(ctx, {
      freeze,
      writerModel: run.model,
      meta: (callSite, learningDigestIds) => ({
        callSite,
        projectId: input.projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
        attribution: {
          generationId: args.generationId,
          ...(learningDigestIds?.length ? { learningDigestIds } : {}),
        },
      }),
    }).client;

    try {
      const analysis = JSON.parse(input.analysis) as TranscriptAnalysis;
      const lengthTarget = input.lengthTarget as LengthTarget;
      const sectionKey = args.section as SectionKey;

      // Extra guidance rides on the styleGuidance param (established pattern
      // from the writer-flavor work) so agent signatures stay unchanged.
      const guidanceBlock = run.guidance
        ? `${ITERATIVE_PROMPT_SCAFFOLDS.regenerationGuidance.prefix}${run.guidance}`
        : "";
      const styleGuidance =
        input.styleGuidance +
        priorSectionsBlock(
          input.priorSections as Array<{ section: IterativeSection; text: string }>
        ) +
        guidanceBlock;
      const budget = lengthBudgetBlock(sectionKey, lengthTarget);

      // PSOS-49: waivers frozen into the generation artifacts at start.
      const styleOverrides = normalizeStyleOverrides(input.styleOverrides);

      const runAgent =
        args.section === "s242"
          ? runSection242Agent
          : args.section === "s244"
            ? runSection244Agent
            : runSection246Agent;
      // Story 1 (CAP-1/2/4): "" when the generation has no Brief yet.
      const briefBlock = await ctx.runQuery(
        internal.generations.renderBriefForGeneration,
        { generationId: args.generationId }
      );
      const raw = await runAgent(
        clientFor(
          `generation:section:${args.section.slice(1)}`,
          input.draftStyleDigestId && input.styleGuidance.trim()
            ? [input.draftStyleDigestId]
            : undefined
        ),
        analysis,
        run.model,
        input.brainBlock,
        budget,
        styleGuidance,
        styleOverrides,
        briefBlock
      );
      let text = scrubBannedWordsUnlessWaived(raw, styleOverrides.bannedWords);
      text = await compressToFit(
        clientFor,
        run.model,
        sectionKey,
        text,
        lengthTarget,
        styleOverrides
      );

      const metrics = sectionMetrics(text, sectionKey);
      const findings = sectionDeterministicFindings(
        args.section as IterativeSection,
        text,
        styleOverrides
      );
      await ctx.runMutation(internal.generations.completeSectionRun, {
        generationId: args.generationId,
        section: args.section,
        draftText: text,
        metrics: JSON.stringify(metrics),
        qa: JSON.stringify(findings),
      });
    } catch (error) {
      await fail(describeProviderFailure(error));
    }
  },
});
