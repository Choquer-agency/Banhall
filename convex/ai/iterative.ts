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

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { instrumentedAnthropic } from "./instrument";
import { clientForModel } from "./providers";
import { runAnalyzerAgent, type TranscriptAnalysis } from "./analyzerAgent";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { candidateModelsForMode } from "./model";
import { normalizeProviderError } from "./providers";
import {
  anthropicCondenser,
  describeGenerationFailure,
  ensureCondensedInputs,
} from "./condense";
import { retrieveBrainBlocks } from "./brainRetrieval";
import { describeTranscriptInput } from "../lib/transcripts";
import {
  beginTrackedGeneration,
  buildStyleGuidance,
  compressToFit,
  lengthBudgetBlock,
  toContextDocs,
} from "./pipeline";
import { scrubBannedWordsUnlessWaived } from "../../shared/bannedWords";
import { sectionDeterministicFindings } from "./qaChecks";
import { sectionMetrics, type LengthTarget, type SectionKey } from "../lib/lineLimits";
import { normalizeCraScienceCode } from "../../shared/craScienceCodes";
import {
  NO_STYLE_OVERRIDES,
  normalizeStyleOverrides,
} from "../../shared/styleOverrides";
import { fetchWriterStyle } from "./writerStyle";
import type { Id } from "../_generated/dataModel";
import {
  ITERATIVE_PROMPT_SCAFFOLDS,
  ITERATIVE_SECTION_TITLES,
} from "./promptDefinitions";

type IterativeSection = "s242" | "s244" | "s246";

const SECTION_TITLES: Record<IterativeSection, string> =
  ITERATIVE_SECTION_TITLES;

export { ITERATIVE_PROMPT_SCAFFOLDS } from "./promptDefinitions";

/**
 * One-time setup for an iterative generation: analyzer + Brain retrieval +
 * style/flavor capture (all frozen as generationArtifacts), section-run rows,
 * the first section draft, and the background ghost draft.
 */
export const startIterativeGeneration = internalAction({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const actionStartedAt = Date.now();
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
    const contextDocs = toContextDocs(input.contextDocs);
    // Iterative mode uses single-model semantics: the explicitly selected
    // model, defaulting to Sonnet.
    const model = candidateModelsForMode("iterative", input.singleModelId)[0];
    // Routed by the selected model's gateway (Anthropic direct / OpenRouter).
    const clientFor = (
      callSite: string,
      learningDigestIds?: Id<"learningDigests">[]
    ) =>
      clientForModel(ctx, model.id, {
        callSite,
        projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
        attribution: {
          generationId: genId,
          ...(learningDigestIds?.length ? { learningDigestIds } : {}),
        },
      });
    // The Brain's retrieval brief always runs on Anthropic Haiku — never the
    // candidate model.
    const briefClient = instrumentedAnthropic(ctx, {
      callSite: "generation:retrieval_brief",
      capability: "generation",
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
      if (contextDocs.length > 0) {
        await log(`Using ${contextDocs.length} frozen contextual document(s), weighted by SR&ED priority.`);
      }
      await log(`Section-by-section drafting with ${model.label}.`);

      // Over-budget transcript sets are reduced to stored digests and frozen
      // as their own source rows before anything reads the transcript text;
      // the re-read below returns the digest parts every later step cites.
      if (input.inputMode === "digest") {
        await ensureCondensedInputs(
          ctx,
          { generationId: genId, elapsedMs: Date.now() - actionStartedAt },
          log,
          anthropicCondenser(ctx, {
            generationId: genId,
            projectId,
            ...(input.requestedBy ? { userId: input.requestedBy } : {}),
          })
        );
        const condensed = await ctx.runQuery(
          internal.generations.getGenerationInput,
          { generationId: args.generationId }
        );
        if (!condensed) throw new Error("The frozen generation input is unavailable.");
        input = condensed;
      }
      const transcript = input.transcript;

      // Frozen once: Brain exemplar blocks (never re-retrieved per section).
      const brainBlocks = await retrieveBrainBlocks(ctx, {
        generationId: genId,
        projectId,
        title,
        transcript,
        industry: input.industry ?? null,
        scienceCode: scienceCode ?? null,
        retrievalBriefClient: briefClient,
        log,
      });

      // Frozen once: learned digests + the writer's personal flavor.
      // All wrapped so learning/flavor can NEVER break generation.
      // qaCalibration only feeds the ghost draft's QA agent — section drafts
      // use deterministic checks (the writer is the QA).
      // Shared per-writer style policy (PSOS-49/50, writerStyle.ts) — started
      // in parallel with the digest fetch; it swallows its own errors.
      const writerStylePromise = fetchWriterStyle(ctx, input.requestedBy, log);
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
      const { writerFlavor, styleOverrides } = await writerStylePromise;
      const styleGuidance = buildStyleGuidance(
        draftStyle,
        writerFlavor,
        styleOverrides ?? NO_STYLE_OVERRIDES
      );

      // Frozen once: analyzer output shared by every section draft.
      await log("Analyzing the transcript (runs once — shared by all sections)…");
      const analysis = await runAnalyzerAgent(
        clientFor("generation:analyzer"),
        transcript,
        contextDocs,
        model.id,
        brainBlocks.analyzer
      );

      await ctx.runMutation(internal.generations.saveIterativeArtifacts, {
        generationId: genId,
        analysis: JSON.stringify(analysis),
        // Documented shape: { blocks: BrainExemplarBlocks, styleGuidance,
        // styleOverrides }. Overrides are frozen at generation start (like
        // styleGuidance) so a mid-generation profile change cannot skew later
        // sections — INCLUDING the all-false "full enforcement" state, so a
        // later profile/mode change can never re-score this draft under
        // waivers it was not written with.
        brainBlocks: JSON.stringify({
          blocks: brainBlocks,
          styleGuidance,
          ...(draftStyleDigestId ? { draftStyleDigestId } : {}),
          styleOverrides: styleOverrides ?? NO_STYLE_OVERRIDES,
        }),
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
    // Routed by the section run's model gateway.
    const clientFor = (
      callSite: string,
      learningDigestIds?: Id<"learningDigests">[]
    ) =>
      clientForModel(ctx, run.model, {
        callSite,
        projectId: input.projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
        attribution: {
          generationId: args.generationId,
          ...(learningDigestIds?.length ? { learningDigestIds } : {}),
        },
      });

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
        styleOverrides
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
      const normalized = normalizeProviderError(error);
      await fail(`${normalized.code}: ${normalized.message}`);
    }
  },
});
