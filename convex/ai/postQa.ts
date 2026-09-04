/**
 * Post-assembly QA + chronology for iterative (section-by-section) reports.
 *
 * One-shot/compare candidates get their scorecard inside generateCandidate;
 * iterative reports assemble from writer-approved text with no LLM pass. This
 * action runs the SAME QA + chronology agents over the assembled sections so
 * every generation mode ends with a scorecard — more feedback for the Brain's
 * learning loops. Scheduled automatically at assembly; also runnable on demand
 * from the QA panel for reports that predate this file.
 */
import { internalAction } from "../_generated/server";
import { detectFirstPersonPreference } from "../../shared/humanProse";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { clientForModel } from "./providers";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import type { TranscriptAnalysis } from "./analyzerAgent";
import {
  normalizeStyleOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import type { Id } from "../_generated/dataModel";

export const runReportQa = internalAction({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const input = await ctx.runQuery(internal.generations.getPostQaInput, {
      generationId: args.generationId,
    });
    if (!input) {
      // requestReportQa already flipped postQaStatus to "running" — leave it
      // stuck and the panel spins forever. Mark the pass failed instead.
      await ctx.runMutation(internal.generations.saveReportQa, {
        generationId: args.generationId,
        failed: true,
      });
      return;
    }

    // Routed by the report's model gateway (may be an OpenRouter model;
    // undefined model → Anthropic default via gatewayForModel fallback).
    const clientFor = (
      callSite: string,
      learningDigestIds?: Id<"learningDigests">[]
    ) =>
      clientForModel(ctx, input.model ?? "", {
        callSite,
        projectId: input.projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
        attribution: {
          generationId: args.generationId,
          ...(learningDigestIds?.length ? { learningDigestIds } : {}),
        },
      });

    // Reviewer calibration digest and (for legacy generations without a
    // frozen copy) the live style policy load in parallel — both optional,
    // neither may block the scorecard.
    const calibrationPromise = (async (): Promise<
      | { content: string; digestId: Id<"learningDigests"> }
      | undefined
    > => {
      try {
        const digest = await ctx.runQuery(internal.learning.getActiveDigest, {
          kind: "qa_calibration",
        });
        return digest?.content.trim()
          ? { content: digest.content, digestId: digest._id }
          : undefined;
      } catch (err) {
        console.error("qa calibration fetch failed for post-QA", args.generationId, err);
        return undefined;
      }
    })();
    // PSOS-49/50: score under the SAME house-style waivers the sections were
    // drafted with — frozen at generation time (input.styleOverrides, all-false
    // included). Only legacy generations predating the freeze fall back to the
    // live effective policy (org modes apply even without a recorded requester).
    const stylePromise = (async (): Promise<{
      overrides: StyleOverrides | undefined;
      firstPerson: boolean | null;
    }> => {
      // Frozen waivers carry no preference text, so first-person intent is
      // unknown on that path; the QA prompt falls back to report-based detection.
      if (input.styleOverrides) {
        return { overrides: normalizeStyleOverrides(input.styleOverrides), firstPerson: null };
      }
      try {
        const profile = await ctx.runQuery(
          internal.writerProfiles.getProfileForGeneration,
          input.requestedBy ? { userId: input.requestedBy } : {}
        );
        return profile
          ? {
              overrides: normalizeStyleOverrides(profile.styleOverrides),
              firstPerson: detectFirstPersonPreference(profile.customInstructions),
            }
          : { overrides: undefined, firstPerson: null };
      } catch (err) {
        console.error("writer profile fetch failed for post-QA", args.generationId, err);
        return { overrides: undefined, firstPerson: null };
      }
    })();
    const [calibration, style] = await Promise.all([
      calibrationPromise,
      stylePromise,
    ]);

    try {
      const analysis = JSON.parse(input.analysis) as TranscriptAnalysis;
      // Independently settled: a malformed scorecard must not also throw away
      // a perfectly good chronology, and vice versa.
      const [qaSettled, chronologySettled] = await Promise.allSettled([
        runQAAgent(
          clientFor(
            "generation:post_qa",
            calibration ? [calibration.digestId] : undefined
          ),
          analysis,
          input.section242,
          input.section244,
          input.section246,
          input.model,
          calibration?.content,
          style.overrides,
          style.firstPerson
        ),
        runChronologyAgent(
          clientFor("generation:post_chronology"),
          analysis,
          input.model
        ),
      ]);
      if (qaSettled.status === "rejected") {
        console.error("post-assembly QA scorecard failed", args.generationId, qaSettled.reason);
      }
      if (chronologySettled.status === "rejected") {
        console.error("post-assembly chronology failed", args.generationId, chronologySettled.reason);
      }
      const qa = qaSettled.status === "fulfilled" ? qaSettled.value : null;
      const chronology =
        chronologySettled.status === "fulfilled" ? chronologySettled.value : null;

      // Only a missing scorecard makes the pass "failed" — that is what the
      // panel offers to re-run.
      if (!qa) {
        await ctx.runMutation(internal.generations.saveReportQa, {
          generationId: args.generationId,
          capturedRef: input.capturedRef,
          failed: true,
          ...(chronology ? { chronology: JSON.stringify(chronology) } : {}),
        });
        return;
      }
      await ctx.runMutation(internal.generations.saveReportQa, {
        generationId: args.generationId,
        capturedRef: input.capturedRef,
        qa: JSON.stringify(qa),
        ...(chronology ? { chronology: JSON.stringify(chronology) } : {}),
        ...(typeof qa.overall_score === "number"
          ? { qaScore: qa.overall_score }
          : {}),
      });
    } catch (err) {
      // Advisory pass: the report is already assembled and usable.
      console.error("post-assembly QA failed for generation", args.generationId, err);
      await ctx.runMutation(internal.generations.saveReportQa, {
        generationId: args.generationId,
        capturedRef: input.capturedRef,
        failed: true,
      });
    }
  },
});
