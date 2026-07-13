"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { instrumentedAnthropic } from "./instrument";
import { runAnalyzerAgent, type ContextDoc } from "./analyzerAgent";
import { formatBrainExemplars } from "./brain/retrieve";
import { buildRetrievalBrief } from "./brain/query";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import { candidateModelsForMode } from "./model";
import { normalizeProviderError } from "./providers";
import {
  sectionMetrics,
  wordBudget,
  LINE_LIMITS,
  CHARS_PER_LINE,
  type LengthTarget,
  type SectionKey,
} from "../lib/lineLimits";
import { sha256 } from "../lib/contracts";
import { normalizeCraScienceCode } from "../../shared/craScienceCodes";

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
  section246: string
) {
  const content: Array<Record<string, unknown>> = [];

  content.push({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: title }],
  });

  function textToParagraphs(text: string) {
    return text
      .split(/\n[^\S\n]*\n+/)
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

function toContextDocs(
  documents: Array<{ category: string; fileName: string; content: string }>
): ContextDoc[] {
  return documents.map((document) => {
    let category: ContextDoc["category"] = "other";
    if (
      document.category === "previous_pd" ||
      document.category === "scoping_notes" ||
      document.category === "writer_notes" ||
      document.category === "background"
    ) {
      category = document.category;
    }
    return {
      category,
      fileName: document.fileName,
      content: document.content,
    };
  });
}

type ProvenanceDraft = {
  claimId: string;
  section: "242" | "244" | "246";
  claimText: string;
  sourceQuote?: string;
};

function provenanceDrafts(
  sections: Array<{ section: ProvenanceDraft["section"]; text: string }>,
  transcript: string,
  usefulQuotes: string[]
): ProvenanceDraft[] {
  const exactQuotes = usefulQuotes
    .map((quote) => quote.trim().replace(/^['"]|['"]$/g, ""))
    .filter((quote) => quote.length >= 20 && transcript.includes(quote));
  const drafts: ProvenanceDraft[] = [];
  for (const { section, text } of sections) {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .slice(0, 60);
    paragraphs.forEach((claimText, index) => {
      const claimTokens = new Set(
        claimText.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []
      );
      let sourceQuote: string | undefined;
      let bestOverlap = 1;
      for (const quote of exactQuotes) {
        const quoteTokens = new Set(quote.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
        let overlap = 0;
        for (const token of quoteTokens) {
          if (claimTokens.has(token)) overlap += 1;
        }
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          sourceQuote = quote;
        }
      }
      drafts.push({
        claimId: `${section}-${index + 1}`,
        section,
        claimText,
        sourceQuote,
      });
    });
  }
  return drafts;
}

/**
 * Run the full pipeline once for a single model → a complete candidate report
 * (content + agentOutputs incl. QA + chronology). Used for BNH-15 A/B testing.
 */
async function runPipelineForModel(
  anthropicFor: (callSite: string) => Anthropic,
  modelId: string,
  transcript: string,
  contextDocs: ContextDoc[],
  title: string,
  brainExemplars: BrainExemplarBlocks,
  lengthTarget: LengthTarget = "standard",
  qaCalibration?: string,
  draftStyle?: string
): Promise<{
  content: string;
  agentOutputs: string;
  qaScore: number | null;
  claimDrafts: ProvenanceDraft[];
}> {
  const analysis = await runAnalyzerAgent(
    anthropicFor("generation:analyzer"),
    transcript,
    contextDocs,
    modelId,
    brainExemplars.analyzer
  );
  // Learning loop: recurring writer critiques of past drafts (see
  // convex/ai/learning.ts). CRA structure/phrasing rules take precedence.
  const styleBlock = draftStyle?.trim()
    ? `\n\n## Style guidance learned from writer feedback on past drafts\nApply where it does not conflict with the required structure, CRA phrasing, or banned-word rules:\n${draftStyle.trim()}`
    : "";
  const [raw242, raw244, raw246] = await Promise.all([
    runSection242Agent(anthropicFor("generation:section:242"), analysis, modelId, brainExemplars.s242, lengthBudgetBlock("s242", lengthTarget), styleBlock),
    runSection244Agent(anthropicFor("generation:section:244"), analysis, modelId, brainExemplars.s244, lengthBudgetBlock("s244", lengthTarget), styleBlock),
    runSection246Agent(anthropicFor("generation:section:246"), analysis, modelId, brainExemplars.s246, lengthBudgetBlock("s246", lengthTarget), styleBlock),
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
        await compressSection(anthropicFor(`generation:compression:${key.slice(1)}`), modelId, key, out, lengthTarget, squeeze)
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
    runQAAgent(anthropicFor("generation:qa"), analysis, section242, section244, section246, modelId, qaCalibration),
    runChronologyAgent(anthropicFor("generation:chronology"), analysis, modelId),
  ]);
  const doc = buildTiptapDocument(
    title,
    section242,
    section244,
    section246
  );
  const claimDrafts = provenanceDrafts(
    [
      { section: "242", text: section242 },
      { section: "244", text: section244 },
      { section: "246", text: section246 },
    ],
    transcript,
    analysis.useful_quotes
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
    claimDrafts,
  };
}

/**
 * Main pipeline action (BNH-15). Compare mode stores one candidate per
 * configured model for writer selection; single mode runs the default Sonnet
 * candidate and atomically promotes it when that run completes.
 */
export const generateReport = internalAction({
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
    const lengthTarget: LengthTarget = input.lengthTarget;
    const contextDocs = toContextDocs(input.contextDocs);
    const candidateModels = candidateModelsForMode(
      input.candidateMode,
      input.singleModelId
    );
    const retrievalBriefClient = instrumentedAnthropic(ctx, {
      callSite: "generation:retrieval_brief",
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
      const brainContext = {
        industry: input.industry ?? null,
        scienceCode: scienceCode ?? null,
      };
      try {
        const brief = await buildRetrievalBrief(retrievalBriefClient, title, transcript);
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
            query: brief ? brief.problem : fallbackQuery,
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
              ...(brainContext.industry ? { industry: brainContext.industry } : {}),
              ...(brainContext.scienceCode
                ? { scienceCode: brainContext.scienceCode }
                : {}),
              query: r.query,
              k: r.k,
              docType: "pd",
              projectId,
              usageLabel: r.section,
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
              brainContext.industry ? ` (${brainContext.industry})` : " (all industries)"
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
        totalCandidates: candidateModels.length,
      });

      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: "Generating candidate drafts...",
      });
      // Learning loop: fetch the active digests once per generation so every
      // candidate drafts and scores under the same learned guidance.
      // Wrapped so learning can NEVER break generation.
      let qaCalibration: string | undefined;
      let draftStyle: string | undefined;
      try {
        const [qaDigest, styleDigest] = await Promise.all([
          ctx.runQuery(internal.learning.getActiveDigest, {
            kind: "qa_calibration",
          }),
          ctx.runQuery(internal.learning.getActiveDigest, {
            kind: "draft_style",
          }),
        ]);
        if (qaDigest) {
          qaCalibration = qaDigest.content;
          await log(
            `Applying QA calibration learned from ${qaDigest.sourceCount} writer feedback event(s).`
          );
        }
        if (styleDigest) {
          draftStyle = styleDigest.content;
          await log(
            `Applying drafting style learned from ${styleDigest.sourceCount} writer critique(s).`
          );
        }
      } catch (err) {
        console.error("learning digest fetch failed for generation", genId, err);
      }

      const candidateLabel =
        candidateModels.length === 1 ? "candidate draft" : "candidate drafts";
      await log(
        `Generating ${candidateModels.length} ${candidateLabel} — ${candidateModels.map((model) => model.label).join(", ")}.`
      );
      for (const model of candidateModels) {
        const candidateRunId = await ctx.runMutation(
          internal.generations.createCandidateRun,
          {
            generationId: genId,
            model: model.id,
            label: model.label,
          }
        );
        if (!candidateRunId) continue;
        const scheduledJobId = await ctx.scheduler.runAfter(
          0,
          internal.ai.pipeline.generateCandidate,
          {
            candidateRunId,
            generationId: genId,
            brainExemplars: brainBlocks,
            ...(qaCalibration ? { qaCalibration } : {}),
            ...(draftStyle ? { draftStyle } : {}),
          }
        );
        await ctx.runMutation(internal.generations.setCandidateRunJob, {
          candidateRunId,
          scheduledJobId,
        });
      }
    } catch (error) {
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: genId,
        error: `${normalized.code}: ${normalized.message}`,
      });
    }
  },
});

/** One model pass, fenced by a durable candidate-run row. */
export const generateCandidate = internalAction({
  args: {
    candidateRunId: v.id("generationCandidateRuns"),
    generationId: v.id("generations"),
    brainExemplars: v.object({
      analyzer: v.string(),
      s242: v.string(),
      s244: v.string(),
      s246: v.string(),
    }),
    qaCalibration: v.optional(v.string()),
    draftStyle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.runMutation(internal.generations.claimCandidateRun, {
      candidateRunId: args.candidateRunId,
    });
    if (!run || run.generationId !== args.generationId) return;
    const input = await ctx.runQuery(internal.generations.getGenerationInput, {
      generationId: args.generationId,
    });
    if (!input) {
      await ctx.runMutation(internal.generations.completeCandidateRun, {
        candidateRunId: args.candidateRunId,
        error: "Frozen generation input unavailable",
      });
      return;
    }
    const anthropicFor = (callSite: string) =>
      instrumentedAnthropic(ctx, {
        callSite,
        capability: "generation",
        projectId: run.projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
      });
    try {
      const { content, agentOutputs, qaScore, claimDrafts } =
        await runPipelineForModel(
          anthropicFor,
          run.model,
          input.transcript,
          toContextDocs(input.contextDocs),
          input.title,
          args.brainExemplars,
          input.lengthTarget,
          args.qaCalibration,
          args.draftStyle
        );
      const claims = await Promise.all(
        claimDrafts.map(async (claim) => {
          const startOffset = claim.sourceQuote
            ? input.transcript.indexOf(claim.sourceQuote)
            : -1;
          return {
            claimId: claim.claimId,
            section: claim.section,
            material: true,
            claimText: claim.claimText,
            claimTextHash: await sha256(claim.claimText),
            state:
              startOffset >= 0
                ? ("needs_review" as const)
                : ("unsupported" as const),
            sources:
              claim.sourceQuote && startOffset >= 0
                ? [
                    {
                      generationSourceId: input.transcriptSourceId,
                      sourceContentHash: input.transcriptContentHash,
                      exactExcerpt: claim.sourceQuote,
                      startOffset,
                      endOffset: startOffset + claim.sourceQuote.length,
                    },
                  ]
                : [],
          };
        })
      );
      const provenanceId = await ctx.runMutation(
        internal.reports.createProvenance,
        {
          projectId: run.projectId,
          generationId: run.generationId,
          sourceTranscriptId: input.transcriptId,
          content,
          claims,
        }
      );
      await ctx.runMutation(internal.generations.completeCandidateRun, {
        candidateRunId: args.candidateRunId,
        content,
        agentOutputs,
        qaScore: qaScore ?? undefined,
        provenanceId,
      });
    } catch (error) {
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.generations.completeCandidateRun, {
        candidateRunId: args.candidateRunId,
        error: `${normalized.code}: ${normalized.message}`,
      });
    }
  },
});
