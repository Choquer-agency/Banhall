"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { runAnalyzerAgent, type ContextDoc } from "./analyzerAgent";
import { formatBrainExemplars } from "./brain/retrieve";
import { buildRetrievalBrief } from "./brain/query";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import { CANDIDATE_MODELS } from "./model";
import {
  sectionMetrics,
  wordBudget,
  LINE_LIMITS,
  CHARS_PER_LINE,
  type LengthTarget,
  type SectionKey,
} from "../lib/lineLimits";

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
 * Per-consumer Brain exemplar prompt blocks — each drafter sees exemplars of
 * ITS OWN section, not a shared blob (uncertainty framing is useless to the
 * work-performed narrative). Empty string = no exemplars for that consumer.
 */
export type BrainExemplarBlocks = {
  analyzer: string;
  s242: string;
  s244: string;
  s246: string;
};

const EMPTY_BRAIN_BLOCKS: BrainExemplarBlocks = {
  analyzer: "",
  s242: "",
  s244: "",
  s246: "",
};

/** BNH-45: the length-budget instruction appended to each drafter prompt. */
function lengthBudgetBlock(section: SectionKey, target: LengthTarget): string {
  const words = wordBudget(section, target);
  const lines = LINE_LIMITS[section];
  return `

# LENGTH BUDGET (CRA form constraint — hard requirement)
The CRA form field for this section holds at most ${lines} lines of ${CHARS_PER_LINE} characters, and EVERY blank line between paragraphs also costs one full line. Write AT MOST ${words} words total. Prefer fewer, denser paragraphs (each blank line spent on a paragraph break is a line of content lost). Do NOT pad. If the material exceeds the budget, keep the most technically load-bearing content and cut the rest.`;
}

/** BNH-45: compression pass for a section that overflows the form.
 * `squeeze` < 1 tightens the word ask on retry. */
async function compressSection(
  anthropic: Anthropic,
  modelId: string,
  section: SectionKey,
  text: string,
  target: LengthTarget,
  squeeze = 1
): Promise<string> {
  const m = sectionMetrics(text, section);
  const words = Math.round(wordBudget(section, target) * squeeze);
  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 4096,
    system:
      "You compress SR&ED report sections to fit CRA form limits. Preserve every distinct technical claim, uncertainty, iteration, and result; cut repetition, filler, and scene-setting. Never invent content. Keep the same paragraph conventions (blank line between paragraphs). Return ONLY the compressed section text.",
    messages: [
      {
        role: "user",
        content: `This section is ${m.lines} lines / ${m.words} words, but the CRA field allows only ${m.limit} lines of ${CHARS_PER_LINE} characters (blank lines between paragraphs each cost one line). Rewrite it to AT MOST ${words} words while preserving all technical substance. Merge paragraphs where natural — fewer paragraph breaks save lines.\n\n${text}`,
      },
    ],
  });
  const out = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
  return out || text;
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
  title: string,
  brainExemplars: BrainExemplarBlocks,
  lengthTarget: LengthTarget = "standard"
): Promise<{ content: string; agentOutputs: string; qaScore: number | null }> {
  const analysis = await runAnalyzerAgent(
    anthropic,
    transcript,
    contextDocs,
    modelId,
    brainExemplars.analyzer
  );
  const [raw242, raw244, raw246] = await Promise.all([
    runSection242Agent(anthropic, analysis, modelId, brainExemplars.s242, lengthBudgetBlock("s242", lengthTarget)),
    runSection244Agent(anthropic, analysis, modelId, brainExemplars.s244, lengthBudgetBlock("s244", lengthTarget)),
    runSection246Agent(anthropic, analysis, modelId, brainExemplars.s246, lengthBudgetBlock("s246", lengthTarget)),
  ]);
  let section242 = scrubBannedWords(raw242);
  let section244 = scrubBannedWords(raw244);
  let section246 = scrubBannedWords(raw246);

  // BNH-45 enforcement: still over the form limit after the budgeted draft →
  // ONE compression pass per offending section (part of generation, before
  // the candidate ever lands).
  const compress = async (
    key: SectionKey,
    text: string
  ): Promise<string> => {
    let out = text;
    // Up to two passes; the second asks for 15% fewer words (models routinely
    // land a hair over on the first squeeze — e2e saw a 51/50).
    for (const squeeze of [1, 0.85]) {
      if (!sectionMetrics(out, key).overLimit) return out;
      out = scrubBannedWords(
        await compressSection(anthropic, modelId, key, out, lengthTarget, squeeze)
      );
    }
    return out;
  };
  [section242, section244, section246] = await Promise.all([
    compress("s242", section242),
    compress("s244", section244),
    compress("s246", section246),
  ]);

  const metrics = {
    s242: sectionMetrics(section242, "s242"),
    s244: sectionMetrics(section244, "s244"),
    s246: sectionMetrics(section246, "s246"),
    lengthTarget,
  };
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
      metrics,
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
    lengthTarget: v.optional(
      v.union(v.literal("concise"), v.literal("standard"), v.literal("full"))
    ),
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
      const contextDocs: ContextDoc[] = await ctx.runQuery(
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

      // BNH-10: pull gold-standard reference passages from The Brain once per
      // generation (shared across all candidate models). A good PD is a good
      // PD — retrieval runs with or without an industry; industry narrows it.
      // Wrapped so the Brain can NEVER break generation.
      //
      // Retrieval is section-scoped: a cheap Haiku pre-pass distills the
      // transcript into four report-register queries (raw transcripts retrieve
      // on greetings and client names, not the rhetorical patterns drafters
      // need), then each T661 section gets exemplars of ITSELF — uncertainty
      // framing for 242, work narration for 244, advancement claims for 246.
      // Searches run sequentially on purpose: Voyage rate limits bite when
      // embed+rerank calls burst in parallel.
      const brainBlocks: BrainExemplarBlocks = { ...EMPTY_BRAIN_BLOCKS };
      const industry = await ctx.runQuery(
        internal.generations.getProjectIndustry,
        { projectId: args.projectId }
      );
      try {
        const brief = await buildRetrievalBrief(anthropic, title, transcript);
        const fallbackQuery = `${title}\n\n${transcript.slice(0, 2000)}`;
        const retrievals: {
          block: keyof BrainExemplarBlocks;
          section: string;
          query: string;
          k: number;
        }[] = [
          {
            block: "analyzer",
            section: "analyzer",
            query: brief?.problem ?? fallbackQuery,
            k: 4,
          },
          {
            block: "s242",
            section: "242",
            query: brief ? `${brief.uncertainty}\n\n${brief.problem}` : fallbackQuery,
            k: 3,
          },
          {
            block: "s244",
            section: "244",
            query: brief ? `${brief.work}\n\n${brief.problem}` : fallbackQuery,
            k: 3,
          },
          {
            block: "s246",
            section: "246",
            query: brief ? `${brief.advancement}\n\n${brief.problem}` : fallbackQuery,
            k: 3,
          },
        ];

        const provenance: {
          section: string;
          entryId: string;
          sourceId?: string;
          score: number;
          searchScore?: number;
          rerankScore?: number;
          title?: string;
          writerName?: string;
        }[] = [];
        let anyDegraded = false;
        for (const r of retrievals) {
          const outcome = await ctx.runAction(
            internal.ai.brain.retrieve.retrieveBrainContext,
            {
              ...(industry ? { industry } : {}),
              query: r.query,
              k: r.k,
              docType: "pd",
            }
          );
          anyDegraded = anyDegraded || outcome.degraded;
          brainBlocks[r.block] = formatBrainExemplars(outcome.exemplars);
          for (const e of outcome.exemplars) {
            provenance.push({
              section: r.section,
              entryId: e.entryId,
              sourceId: e.sourceId,
              score: e.score,
              searchScore: e.searchScore,
              rerankScore: e.rerankScore,
              title: e.title,
              writerName: e.writerName,
            });
          }
        }

        if (provenance.length > 0) {
          await ctx.runMutation(internal.generations.setBrainProvenance, {
            generationId: genId,
            exemplars: provenance,
            brief: brief ? JSON.stringify(brief) : undefined,
          });
          const perSection = ["242", "244", "246"]
            .map((s) => `${s}: ${provenance.filter((p) => p.section === s).length}`)
            .join(", ");
          await log(
            `Pulled ${provenance.length} reference pattern(s) from The Brain${
              industry ? ` (${industry})` : " (all industries)"
            } — ${perSection}.`
          );
        } else if (anyDegraded) {
          await log(
            "The Brain was unreachable — drafting without reference patterns."
          );
        } else {
          await log(
            "No sufficiently similar past reports in The Brain — drafting without reference patterns."
          );
        }
      } catch (err) {
        // Never fail the report on Brain issues — but never hide them either.
        console.error("brain retrieval failed for generation", genId, err);
        await log(
          "The Brain was unreachable — drafting without reference patterns."
        ).catch(() => {});
      }

      // BNH-21: estimate generation time up front so the UI can show a
      // countdown + progress bar. Scales with input volume (transcript +
      // context docs); candidates now run in parallel, so wall-clock ≈ one
      // model's pass, not the sum.
      const contextWords = contextDocs.reduce(
        (n, d) => n + (d.content?.split(/\s+/).filter(Boolean).length ?? 0),
        0
      );
      const inputWords = transcriptWords + contextWords;
      const perModelSec = 45 + inputWords / 150;
      const estimatedMs = Math.round(perModelSec * 1000 * 1.5);
      await ctx.runMutation(internal.generations.setGenerationEstimate, {
        generationId: genId,
        estimatedMs,
        totalCandidates: CANDIDATE_MODELS.length,
      });

      // BNH-15: run the full pipeline once per candidate model. Each candidate
      // is its OWN scheduled action: a sequential in-action loop breached the
      // 10-minute action limit on long transcripts, dying mid-model and
      // stranding the generation in "running" forever. Fan-out gives every
      // model its own time budget (and cuts wall-clock ~3x); the LAST candidate
      // to land finalizes the generation (generations.finalizeCandidate).
      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: "Generating candidate drafts...",
      });
      await log(
        `Generating ${CANDIDATE_MODELS.length} candidate drafts — ${CANDIDATE_MODELS.map((m) => m.label).join(", ")}.`
      );

      for (const m of CANDIDATE_MODELS) {
        await ctx.scheduler.runAfter(0, internal.ai.pipeline.generateCandidate, {
          lengthTarget: args.lengthTarget ?? "standard",
          generationId: genId,
          projectId: args.projectId,
          transcriptId: args.transcriptId,
          model: m.id,
          label: m.label,
          title,
          brainExemplars: brainBlocks,
        });
      }
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

/**
 * One candidate model's full pipeline pass, in its own action so it gets its
 * own 10-minute budget (see fan-out note in generateReport). Success or
 * failure both funnel into generations.finalizeCandidate, which flips the
 * generation to awaiting_selection/failed when the last candidate lands.
 */
export const generateCandidate = internalAction({
  args: {
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    transcriptId: v.id("transcripts"),
    lengthTarget: v.optional(
      v.union(v.literal("concise"), v.literal("standard"), v.literal("full"))
    ),
    model: v.string(),
    label: v.string(),
    title: v.string(),
    brainExemplars: v.object({
      analyzer: v.string(),
      s242: v.string(),
      s244: v.string(),
      s246: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const anthropic = new Anthropic();
    try {
      const transcript = await ctx.runQuery(
        internal.generations.getTranscriptContent,
        { transcriptId: args.transcriptId }
      );
      if (!transcript) throw new Error("Transcript not found");
      const contextDocs: ContextDoc[] = await ctx.runQuery(
        internal.documents.getContextDocsForGeneration,
        { projectId: args.projectId }
      );

      const { content, agentOutputs, qaScore } = await runPipelineForModel(
        anthropic,
        args.model,
        transcript,
        contextDocs,
        args.title,
        args.brainExemplars,
        args.lengthTarget ?? "standard"
      );
      await ctx.runMutation(internal.generations.addCandidate, {
        generationId: args.generationId,
        projectId: args.projectId,
        model: args.model,
        label: args.label,
        content,
        agentOutputs,
      });
      await ctx.runMutation(internal.generations.finalizeCandidate, {
        generationId: args.generationId,
        projectId: args.projectId,
        label: args.label,
        succeeded: true,
        qaScore: qaScore ?? undefined,
      });
    } catch (e) {
      await ctx.runMutation(internal.generations.finalizeCandidate, {
        generationId: args.generationId,
        projectId: args.projectId,
        label: args.label,
        succeeded: false,
        error: e instanceof Error ? e.message : "error",
      });
    }
  },
});
