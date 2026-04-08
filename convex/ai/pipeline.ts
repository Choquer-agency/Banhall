"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { runAnalyzerAgent } from "./analyzerAgent";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { runQAAgent } from "./qaAgent";

/**
 * Build a Tiptap-compatible JSON document from the section texts and QA scorecard.
 */
function buildTiptapDocument(
  title: string,
  section242: string,
  section244: string,
  section246: string,
  qaScorecard: Record<string, unknown>
) {
  const content: Array<Record<string, unknown>> = [];

  content.push({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: title }],
  });

  function textToParagraphs(text: string) {
    return text
      .split(/\n\n+/)
      .filter((p) => p.trim())
      .map((p) => {
        const parts: Array<Record<string, unknown>> = [];
        const gapRegex = /\[GAP:\s*([^\]]+)\]/g;
        let lastIndex = 0;
        let match;

        while ((match = gapRegex.exec(p)) !== null) {
          if (match.index > lastIndex) {
            parts.push({
              type: "text",
              text: p.slice(lastIndex, match.index),
            });
          }
          parts.push({
            type: "text",
            text: match[0],
            marks: [{ type: "highlight", attrs: { color: "#FEF3C7" } }],
          });
          lastIndex = match.index + match[0].length;
        }

        if (lastIndex < p.length) {
          parts.push({ type: "text", text: p.slice(lastIndex) });
        }

        return { type: "paragraph", content: parts };
      });
  }

  // Section 242
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [
      {
        type: "text",
        text: "Line 242 — Scientific/Technological Uncertainty",
      },
    ],
  });
  content.push(...textToParagraphs(section242));

  // Section 244
  content.push({ type: "horizontalRule" });
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Line 244 — Work Performed" }],
  });
  content.push(...textToParagraphs(section244));

  // Section 246
  content.push({ type: "horizontalRule" });
  content.push({
    type: "heading",
    attrs: { level: 2 },
    content: [
      {
        type: "text",
        text: "Line 246 — Scientific/Technological Advancement",
      },
    ],
  });
  content.push(...textToParagraphs(section246));

  return { type: "doc", content };
}

/**
 * Main pipeline action. Runs all 5 agents in sequence (with 2/3/4 in parallel)
 * and saves the result.
 *
 * All mutations are in generations.ts (non-Node.js file) since Convex
 * mutations cannot be defined in "use node" files.
 */
export const generateReport = internalAction({
  args: {
    projectId: v.id("projects"),
    transcriptId: v.id("transcripts"),
  },
  handler: async (ctx, args) => {
    const anthropic = new Anthropic();

    // Create generation record
    const genId = await ctx.runMutation(
      internal.generations.createGeneration,
      {
        projectId: args.projectId,
        transcriptId: args.transcriptId,
      }
    );

    // Set project status to generating
    await ctx.runMutation(internal.generations.setProjectGenerating, {
      projectId: args.projectId,
    });

    try {
      // Step 1: Get transcript content
      const transcript = await ctx.runQuery(
        internal.generations.getTranscriptContent,
        { transcriptId: args.transcriptId }
      );

      if (!transcript) {
        throw new Error("Transcript not found");
      }

      // Step 2: Run Transcript Analyzer
      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: "Analyzing transcript...",
      });

      const analysis = await runAnalyzerAgent(anthropic, transcript);

      // Step 3: Run Section drafters in parallel
      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: "Drafting sections 242, 244, 246...",
      });

      const [section242, section244, section246] = await Promise.all([
        runSection242Agent(anthropic, analysis),
        runSection244Agent(anthropic, analysis),
        runSection246Agent(anthropic, analysis),
      ]);

      // Step 4: Run QA Agent
      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: "Running quality check...",
      });

      const qaScorecard = await runQAAgent(
        anthropic,
        analysis,
        section242,
        section244,
        section246
      );

      // Step 5: Build Tiptap document and save
      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: "Assembling report...",
      });

      const project = await ctx.runQuery(internal.generations.getProjectTitle, {
        projectId: args.projectId,
      });

      const doc = buildTiptapDocument(
        project ?? "Untitled Report",
        section242,
        section244,
        section246,
        qaScorecard as unknown as Record<string, unknown>
      );

      const version = await ctx.runQuery(
        internal.generations.getNextReportVersion,
        { projectId: args.projectId }
      );

      await ctx.runMutation(internal.generations.saveReport, {
        projectId: args.projectId,
        content: JSON.stringify(doc),
        version,
      });

      // Mark generation complete
      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "completed",
        currentStep: "Complete",
        agentOutputs: JSON.stringify({
          analyzer: analysis,
          section242,
          section244,
          section246,
          qa: qaScorecard,
        }),
        completedAt: Date.now(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";

      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "failed",
        currentStep: "Failed",
        error: message,
        completedAt: Date.now(),
      });

      // Reset project status back to draft
      await ctx.runMutation(internal.generations.resetProjectToDraft, {
        projectId: args.projectId,
      }).catch(() => {});

      throw error;
    }
  },
});
