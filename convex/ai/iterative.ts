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
import { runAnalyzerAgent, type TranscriptAnalysis } from "./analyzerAgent";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { candidateModelsForMode } from "./model";
import { normalizeProviderError } from "./providers";
import { retrieveBrainBlocks } from "./brainRetrieval";
import {
  buildStyleGuidance,
  compressToFit,
  lengthBudgetBlock,
  scrubBannedWords,
  toContextDocs,
} from "./pipeline";
import { sectionDeterministicFindings } from "./qaChecks";
import { sectionMetrics, type LengthTarget, type SectionKey } from "../lib/lineLimits";
import { normalizeCraScienceCode } from "../../shared/craScienceCodes";

type IterativeSection = "s242" | "s244" | "s246";

const SECTION_TITLES: Record<IterativeSection, string> = {
  s242: "Line 242 — Uncertainty",
  s244: "Line 244 — Work performed",
  s246: "Line 246 — Advancement",
};

/**
 * One-time setup for an iterative generation: analyzer + Brain retrieval +
 * style/flavor capture (all frozen as generationArtifacts), section-run rows,
 * the first section draft, and the background ghost draft.
 */
export const startIterativeGeneration = internalAction({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const started = await ctx.runMutation(internal.generations.beginGeneration, {
      generationId: args.generationId,
    });
    if (!started) return;
    const input = await ctx.runQuery(internal.generations.getGenerationInput, {
      generationId: args.generationId,
    });
    if (!input) {
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: args.generationId,
        error: "The frozen generation input is unavailable.",
      });
      return;
    }
    const genId = input.generationId;
    const projectId = input.projectId;
    const transcript = input.transcript;
    const title = input.title || "Untitled Report";
    const contextDocs = toContextDocs(input.contextDocs);
    // Iterative mode uses single-model semantics: the explicitly selected
    // model, defaulting to Sonnet.
    const model = candidateModelsForMode("single", input.singleModelId)[0];
    const anthropicFor = (callSite: string) =>
      instrumentedAnthropic(ctx, {
        callSite,
        capability: "generation",
        projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
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
      const transcriptWords = transcript.split(/\s+/).filter(Boolean).length;
      await log(`Read frozen interview transcript — ${transcriptWords.toLocaleString()} words.`);
      if (contextDocs.length > 0) {
        await log(`Using ${contextDocs.length} frozen contextual document(s), weighted by SR&ED priority.`);
      }
      await log(`Section-by-section drafting with ${model.label}.`);

      // Frozen once: Brain exemplar blocks (never re-retrieved per section).
      const brainBlocks = await retrieveBrainBlocks(ctx, {
        generationId: genId,
        projectId,
        title,
        transcript,
        industry: input.industry ?? null,
        scienceCode: scienceCode ?? null,
        retrievalBriefClient: anthropicFor("generation:retrieval_brief"),
        log,
      });

      // Frozen once: learned digests + the writer's personal flavor.
      // All wrapped so learning/flavor can NEVER break generation.
      // qaCalibration only feeds the ghost draft's QA agent — section drafts
      // use deterministic checks (the writer is the QA).
      let draftStyle: string | undefined;
      let qaCalibration: string | undefined;
      try {
        const [qaDigest, styleDigest] = await Promise.all([
          ctx.runQuery(internal.learning.getActiveDigest, {
            kind: "qa_calibration",
          }),
          ctx.runQuery(internal.learning.getActiveDigest, {
            kind: "draft_style",
          }),
        ]);
        if (qaDigest) qaCalibration = qaDigest.content;
        if (styleDigest) {
          draftStyle = styleDigest.content;
          await log(
            `Applying drafting style learned from ${styleDigest.sourceCount} writer critique(s).`
          );
        }
      } catch (err) {
        console.error("learning digest fetch failed for generation", genId, err);
      }
      let writerFlavor: string | undefined;
      try {
        if (input.requestedBy) {
          const flavor = await ctx.runQuery(
            internal.writerProfiles.getProfileForGeneration,
            { userId: input.requestedBy }
          );
          if (flavor) {
            writerFlavor = flavor;
            await log("Applying the requesting writer's personal style preferences.");
          }
        }
      } catch (err) {
        console.error("writer flavor fetch failed for generation", genId, err);
      }
      const styleGuidance = buildStyleGuidance(draftStyle, writerFlavor);

      // Frozen once: analyzer output shared by every section draft.
      await log("Analyzing the transcript (runs once — shared by all sections)…");
      const analysis = await runAnalyzerAgent(
        anthropicFor("generation:analyzer"),
        transcript,
        contextDocs,
        model.id,
        brainBlocks.analyzer
      );

      await ctx.runMutation(internal.generations.saveIterativeArtifacts, {
        generationId: genId,
        analysis: JSON.stringify(analysis),
        // Documented shape: { blocks: BrainExemplarBlocks, styleGuidance }.
        brainBlocks: JSON.stringify({ blocks: brainBlocks, styleGuidance }),
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
            ...(writerFlavor ? { writerFlavor } : {}),
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
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: genId,
        error: `${normalized.code}: ${normalized.message}`,
      });
    }
  },
});

/** Prompt block carrying writer-approved prior sections as canonical context. */
function priorSectionsBlock(
  priorSections: Array<{ section: IterativeSection; text: string }>
): string {
  if (priorSections.length === 0) return "";
  const body = priorSections
    .map((p) => `### ${SECTION_TITLES[p.section]} (APPROVED)\n${p.text}`)
    .join("\n\n");
  return `\n\n## Approved prior sections (canonical — the writer has reviewed and edited these; align terminology, chronology, and claims with them; do not contradict them)\n${body}`;
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
    const anthropicFor = (callSite: string) =>
      instrumentedAnthropic(ctx, {
        callSite,
        capability: "generation",
        projectId: input.projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
      });

    try {
      const analysis = JSON.parse(input.analysis) as TranscriptAnalysis;
      const lengthTarget = input.lengthTarget as LengthTarget;
      const sectionKey = args.section as SectionKey;

      // Extra guidance rides on the styleGuidance param (established pattern
      // from the writer-flavor work) so agent signatures stay unchanged.
      const guidanceBlock = run.guidance
        ? `\n\n## Writer guidance for this regeneration (high priority)\n${run.guidance}`
        : "";
      const styleGuidance =
        input.styleGuidance +
        priorSectionsBlock(
          input.priorSections as Array<{ section: IterativeSection; text: string }>
        ) +
        guidanceBlock;
      const budget = lengthBudgetBlock(sectionKey, lengthTarget);

      const runAgent =
        args.section === "s242"
          ? runSection242Agent
          : args.section === "s244"
            ? runSection244Agent
            : runSection246Agent;
      const raw = await runAgent(
        anthropicFor(`generation:section:${args.section.slice(1)}`),
        analysis,
        run.model,
        input.brainBlock,
        budget,
        styleGuidance
      );
      let text = scrubBannedWords(raw);
      text = await compressToFit(
        anthropicFor,
        run.model,
        sectionKey,
        text,
        lengthTarget
      );

      const metrics = sectionMetrics(text, sectionKey);
      const findings = sectionDeterministicFindings(
        args.section as IterativeSection,
        text
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
