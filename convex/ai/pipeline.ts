"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { instrumentedAnthropic } from "./instrument";
import { runAnalyzerAgent, type ContextDoc } from "./analyzerAgent";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import { candidateModelsForMode } from "./model";
import { normalizeProviderError } from "./providers";
import { buildTiptapDocument } from "../lib/tiptapReport";
import {
  retrieveBrainBlocks,
  type BrainExemplarBlocks,
} from "./brainRetrieval";
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

export type { BrainExemplarBlocks };

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

export function scrubBannedWords(text: string): string {
  let result = text;
  for (const [pattern, replacement] of BANNED_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  // Clean up any double spaces from removals
  return result.replace(/ {2,}/g, " ").trim();
}

/** BNH-45: the length-budget instruction appended to each drafter prompt. */
export function lengthBudgetBlock(section: SectionKey, target: LengthTarget): string {
  const words = wordBudget(section, target);
  const lines = LINE_LIMITS[section];
  return `

# LENGTH BUDGET (CRA form constraint — hard requirement)
The CRA form field for this section holds at most ${lines} lines of ${CHARS_PER_LINE} characters, and EVERY blank line between paragraphs also costs one full line. Write AT MOST ${words} words total. Prefer fewer, denser paragraphs (each blank line spent on a paragraph break is a line of content lost). Do NOT pad. If the material exceeds the budget, keep the most technically load-bearing content and cut the rest.`;
}

/** BNH-45: compression pass for a section that overflows the form.
 * `squeeze` < 1 tightens the word ask on retry. */
export async function compressSection(
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
      "You compress SR&ED report sections to fit CRA form limits. Preserve every distinct technical claim, uncertainty, iteration, and result; cut repetition, filler, and scene-setting. Never invent content. [GAP: …] markers must be preserved verbatim — never remove or reword them. Keep the same paragraph conventions (blank line between paragraphs). Return ONLY the compressed section text.",
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
 * Combined style-guidance prompt block: learned draft style (learning loop)
 * followed by the requesting writer's personal flavor, both concatenated onto
 * the styleGuidance param so section-agent signatures stay unchanged.
 */
export function buildStyleGuidance(
  draftStyle?: string,
  writerFlavor?: string
): string {
  // Learning loop: recurring writer critiques of past drafts (see
  // convex/ai/learning.ts). CRA structure/phrasing rules take precedence.
  const styleBlock = draftStyle?.trim()
    ? `\n\n## Style guidance learned from writer feedback on past drafts\nApply where it does not conflict with the required structure, CRA phrasing, or banned-word rules:\n${draftStyle.trim()}`
    : "";
  // Per-writer flavor (Phase A): the requesting writer's personal preferences,
  // framed as the LOWEST-priority guidance so it can never override CRA
  // structure, phrasing rules, the length budget, or the learned style above.
  // The headers keep the two blocks visually separate.
  const flavorBlock = writerFlavor?.trim()
    ? `\n\n## Writer's personal style preferences (lowest priority)\nThe requesting writer recorded these personal preferences. Apply them ONLY where\nthey do not conflict with: (1) the required CRA section structure and paragraph\nmandates, (2) CRA phrasing and banned-word rules, (3) the length budget,\n(4) the learned style guidance above. When in conflict, ignore the preference\nsilently.\n\n${writerFlavor.trim()}`
    : "";
  return styleBlock + flavorBlock;
}

/**
 * BNH-45 enforcement: still over the form limit after the budgeted draft →
 * up to two compression passes for the offending section; the second asks for
 * 15% fewer words (models routinely land a hair over on the first squeeze —
 * e2e saw a 51/50). Output is re-scrubbed for banned words each pass.
 */
export async function compressToFit(
  anthropicFor: (callSite: string) => Anthropic,
  modelId: string,
  key: SectionKey,
  text: string,
  lengthTarget: LengthTarget
): Promise<string> {
  let out = text;
  for (const squeeze of [1, 0.85]) {
    if (!sectionMetrics(out, key).overLimit) return out;
    out = scrubBannedWords(
      await compressSection(
        anthropicFor(`generation:compression:${key.slice(1)}`),
        modelId,
        key,
        out,
        lengthTarget,
        squeeze
      )
    );
  }
  return out;
}

export function toContextDocs(
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
  draftStyle?: string,
  writerFlavor?: string
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
  const styleGuidance = buildStyleGuidance(draftStyle, writerFlavor);
  const [raw242, raw244, raw246] = await Promise.all([
    runSection242Agent(anthropicFor("generation:section:242"), analysis, modelId, brainExemplars.s242, lengthBudgetBlock("s242", lengthTarget), styleGuidance),
    runSection244Agent(anthropicFor("generation:section:244"), analysis, modelId, brainExemplars.s244, lengthBudgetBlock("s244", lengthTarget), styleGuidance),
    runSection246Agent(anthropicFor("generation:section:246"), analysis, modelId, brainExemplars.s246, lengthBudgetBlock("s246", lengthTarget), styleGuidance),
  ]);
  let section242 = scrubBannedWords(raw242);
  let section244 = scrubBannedWords(raw244);
  let section246 = scrubBannedWords(raw246);

  // BNH-45 enforcement: still over the form limit after the budgeted draft →
  // compression pass(es) per offending section (part of generation, before
  // the candidate ever lands).
  [section242, section244, section246] = await Promise.all([
    compressToFit(anthropicFor, modelId, "s242", section242, lengthTarget),
    compressToFit(anthropicFor, modelId, "s244", section244, lengthTarget),
    compressToFit(anthropicFor, modelId, "s246", section246, lengthTarget),
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
      input.singleModelId,
      input.compareModelIds
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
      // generation (shared across all candidate models). Extracted to
      // convex/ai/brainRetrieval.ts; also used by the iterative flow.
      const brainBlocks = await retrieveBrainBlocks(ctx, {
        generationId: genId,
        projectId,
        title,
        transcript,
        industry: input.industry ?? null,
        scienceCode: scienceCode ?? null,
        retrievalBriefClient,
        log,
      });

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

      // Per-writer flavor (Phase A): the requesting writer's saved personal
      // preferences, injected as the lowest-priority prompt block. Wrapped so
      // flavor can NEVER break generation.
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
            ...(writerFlavor ? { writerFlavor } : {}),
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
    writerFlavor: v.optional(v.string()),
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
          args.draftStyle,
          args.writerFlavor
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
