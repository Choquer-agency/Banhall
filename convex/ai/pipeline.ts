"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { runAnalyzerAgent, ContextDoc } from "./analyzerAgent";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import { CANDIDATE_MODELS } from "./model";

/**
 * Programmatic safety net: replace banned words that the LLM self-check may have missed.
 * Case-insensitive, whole-word replacements to avoid corrupting partial matches.
 */
const BANNED_REPLACEMENTS: [RegExp, string][] = [
  [/\bnovel\b/gi, "new"],
  [/\bpioneering\b/gi, "new"],
  [/\brevolutionary\b/gi, "new"],
  [/\bpivotal\b/gi, "critical"],
  [/\bseamless\b/gi, "smooth"],
  [/\bsubstantially?\b/gi, "considerably"],
  [/\bsignificantly?\b/gi, "markedly"],
  [/\bunique\b/gi, "distinct"],
  [/\bgroundbreaking\b/gi, "new"],
  [/\bcutting-edge\b/gi, "advanced"],
  [/\bstate-of-the-art\b/gi, "current"],
  [/\bcomprehensive\b/gi, "thorough"],
  [/\brobust\b/gi, "reliable"],
  [/\bholistic\b/gi, "complete"],
  [/\bsynergy\b/gi, "coordination"],
  [/\bleverage[ds]?\b/gi, "use"],
  [/\bleveraging\b/gi, "using"],
  [/\bharness(?:ed|ing)?\b/gi, "use"],
  [/\brevolutioniz(?:e[ds]?|ing)\b/gi, "change"],
  [/\btransformative\b/gi, "important"],
  [/\bgame-changing\b/gi, "important"],
  [/\bfundamentally\b/gi, ""],
  [/\bparadigm\b/gi, "approach"],
  [/\becosystem\b/gi, "environment"],
  [/\bfurthermore,?\s*/gi, ""],
  [/\bmoreover,?\s*/gi, ""],
  [/\badditionally,?\s*/gi, ""],
  [/\binnovative\b/gi, "new"],
  [/\bspearheading\b/gi, "leading"],
  [/\bdelving into\b/gi, "examining"],
];

function scrubBannedWords(text: string): string {
  let result = text;
  for (const [pattern, replacement] of BANNED_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  // Clean up any double spaces from removals
  return result.replace(/ {2,}/g, " ").trim();
}

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
 * Run the full pipeline once for a single model → a complete candidate report
 * (content + agentOutputs incl. QA + chronology). Used for BNH-15 A/B testing.
 */
async function runPipelineForModel(
  anthropic: Anthropic,
  modelId: string,
  transcript: string,
  contextDocs: ContextDoc[],
  title: string
): Promise<{ content: string; agentOutputs: string; qaScore: number | null }> {
  const analysis = await runAnalyzerAgent(anthropic, transcript, contextDocs, modelId);
  const [raw242, raw244, raw246] = await Promise.all([
    runSection242Agent(anthropic, analysis, modelId),
    runSection244Agent(anthropic, analysis, modelId),
    runSection246Agent(anthropic, analysis, modelId),
  ]);
  const section242 = scrubBannedWords(raw242);
  const section244 = scrubBannedWords(raw244);
  const section246 = scrubBannedWords(raw246);
  const [qaScorecard, chronology] = await Promise.all([
    runQAAgent(anthropic, analysis, section242, section244, section246, modelId),
    runChronologyAgent(anthropic, analysis, modelId),
  ]);
  const doc = buildTiptapDocument(
    title,
    section242,
    section244,
    section246,
    qaScorecard as unknown as Record<string, unknown>
  );
  return {
    content: JSON.stringify(doc),
    agentOutputs: JSON.stringify({
      analyzer: analysis,
      section242,
      section244,
      section246,
      qa: qaScorecard,
      chronology,
    }),
    qaScore: qaScorecard?.overall_score ?? null,
  };
}

/**
 * Main pipeline action (BNH-15). Runs the full pipeline once per candidate
 * model and stores each as a candidate report for the writer to choose from.
 * The chosen draft is promoted to the report on selection (see selectReportCandidate).
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

    // Live "thinking" log shown in the generation UI.
    const log = (line: string) =>
      ctx.runMutation(internal.generations.appendProgress, {
        generationId: genId,
        line,
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

      const transcriptWords = transcript.split(/\s+/).filter(Boolean).length;
      await log(`Read interview transcript — ${transcriptWords.toLocaleString()} words.`);

      // BNH-9: pull categorized contextual inputs (shared across all candidates).
      const contextDocs = await ctx.runQuery(
        internal.documents.getContextDocsForGeneration,
        { projectId: args.projectId }
      );
      if (contextDocs.length > 0) {
        await log(`Pulling in ${contextDocs.length} contextual document(s) and weighting by SR&ED priority.`);
      }

      const title =
        (await ctx.runQuery(internal.generations.getProjectTitle, {
          projectId: args.projectId,
        })) ?? "Untitled Report";

      // BNH-21: estimate generation time up front so the UI can show a
      // countdown + progress bar. Scales with input volume (transcript +
      // context docs) and the number of candidate models we run end-to-end.
      const contextWords = contextDocs.reduce(
        (n, d) => n + (d.content?.split(/\s+/).filter(Boolean).length ?? 0),
        0
      );
      const inputWords = transcriptWords + contextWords;
      const perModelSec = 45 + inputWords / 150;
      const estimatedMs = Math.round(
        perModelSec * CANDIDATE_MODELS.length * 1000
      );
      await ctx.runMutation(internal.generations.setGenerationEstimate, {
        generationId: genId,
        estimatedMs,
        totalCandidates: CANDIDATE_MODELS.length,
      });

      // BNH-15: run the full pipeline once per candidate model.
      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: "Generating candidate drafts...",
      });
      await log(
        `Generating ${CANDIDATE_MODELS.length} candidate drafts — ${CANDIDATE_MODELS.map((m) => m.label).join(", ")}.`
      );

      let succeeded = 0;
      for (const m of CANDIDATE_MODELS) {
        await log(`Generating with ${m.label}…`);
        try {
          const { content, agentOutputs, qaScore } = await runPipelineForModel(
            anthropic,
            m.id,
            transcript,
            contextDocs,
            title
          );
          await ctx.runMutation(internal.generations.addCandidate, {
            generationId: genId,
            projectId: args.projectId,
            model: m.id,
            label: m.label,
            content,
            agentOutputs,
          });
          await ctx.runMutation(internal.generations.incrementCandidatesDone, {
            generationId: genId,
          });
          await log(`✓ ${m.label} draft ready (QA ${qaScore ?? "—"}/100).`);
          succeeded++;
        } catch (e) {
          await log(
            `✗ ${m.label} failed: ${e instanceof Error ? e.message : "error"} — skipping.`
          );
        }
      }

      if (succeeded === 0) {
        throw new Error("All candidate models failed to generate.");
      }

      // Hand off to the writer to choose a draft.
      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "awaiting_selection",
        currentStep: "Choose your preferred draft",
      });
      await log(`All ${succeeded} candidate(s) ready — choose your preferred draft.`);
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
