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
import { instrumentedAnthropic } from "./instrument";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import type { TranscriptAnalysis } from "./analyzerAgent";

export const runReportQa = internalAction({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const input = await ctx.runQuery(internal.generations.getPostQaInput, {
      generationId: args.generationId,
    });
    if (!input) return;

    const anthropicFor = (callSite: string) =>
      instrumentedAnthropic(ctx, {
        callSite,
        capability: "generation",
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
      const [qa, chronology] = await Promise.all([
        runQAAgent(
          anthropicFor("generation:post_qa"),
          analysis,
          input.section242,
          input.section244,
          input.section246,
          input.model,
          qaCalibration
        ),
        runChronologyAgent(
          anthropicFor("generation:post_chronology"),
          analysis,
          input.model
        ),
      ]);
      await ctx.runMutation(internal.generations.saveReportQa, {
        generationId: args.generationId,
        qa: JSON.stringify(qa),
        chronology: JSON.stringify(chronology),
        ...(typeof qa?.overall_score === "number"
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
