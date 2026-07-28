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
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { clientForModel } from "./providers";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import type { TranscriptAnalysis } from "./analyzerAgent";

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
    const clientFor = (callSite: string) =>
      clientForModel(ctx, input.model ?? "", {
        callSite,
        projectId: input.projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
      });

    // Reviewer calibration digest is optional — never blocks the scorecard.
    let qaCalibration: string | undefined;
    try {
      const digest = await ctx.runQuery(internal.learning.getActiveDigest, {
        kind: "qa_calibration",
      });
      if (digest) qaCalibration = digest.content;
    } catch (err) {
      console.error("qa calibration fetch failed for post-QA", args.generationId, err);
    }

    try {
      const analysis = JSON.parse(input.analysis) as TranscriptAnalysis;
      // Independently settled: a malformed scorecard must not also throw away
      // a perfectly good chronology, and vice versa.
      const [qaSettled, chronologySettled] = await Promise.allSettled([
        runQAAgent(
          clientFor("generation:post_qa"),
          analysis,
          input.section242,
          input.section244,
          input.section246,
          input.model,
          qaCalibration
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
          failed: true,
          ...(chronology ? { chronology: JSON.stringify(chronology) } : {}),
        });
        return;
      }
      await ctx.runMutation(internal.generations.saveReportQa, {
        generationId: args.generationId,
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
        failed: true,
      });
    }
  },
});
