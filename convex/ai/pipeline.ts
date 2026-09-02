"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { instrumentedAnthropic } from "./instrument";
import { clientForModel } from "./providers";
import type { GenerationClient } from "./openrouterCore";
import { runAnalyzerAgent, type ContextDoc } from "./analyzerAgent";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import { CANDIDATE_MODELS, candidateModelsForMode } from "./model";
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
import {
  scrubBannedWords,
  scrubBannedWordsUnlessWaived,
} from "../../shared/bannedWords";
import {
  NO_STYLE_OVERRIDES,
  normalizeStyleOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { styleOverridesValidator } from "../lib/styleOverrides";
import { waivedCategoryLabels } from "./prompts";
import { fetchWriterStyle } from "./writerStyle";
import { detectFirstPersonPreference } from "../../shared/humanProse";

export type { BrainExemplarBlocks };

// Programmatic safety net behind the LLM self-check. Canonical table +
// scrubber live in shared/bannedWords.ts (same list the QA scan derives
// from); re-exported for the iterative flow.
export { scrubBannedWords };

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
  anthropic: GenerationClient,
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
      "You compress SR&ED report sections to fit CRA form limits. Preserve every distinct technical claim, uncertainty, iteration, and result; cut repetition, filler, and scene-setting. Never invent content. [GAP: …] markers must be preserved verbatim — never remove or reword them. Keep the same paragraph conventions (blank line between paragraphs). Never join clauses with an em dash or a dash stand-in (double hyphen, spaced hyphen); use a colon, semicolon, comma, or period. Return ONLY the compressed section text.",
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
  writerFlavor?: string,
  styleOverrides: StyleOverrides = NO_STYLE_OVERRIDES
): string {
  const waived = waivedCategoryLabels(styleOverrides);
  // Learning loop: recurring writer critiques of past drafts (see
  // convex/ai/learning.ts). CRA structure/phrasing rules take precedence;
  // PSOS-49: a writer's waived categories outrank the learned guidance.
  const styleBlock = draftStyle?.trim()
    ? `\n\n## Style guidance learned from writer feedback on past drafts\nApply where it does not conflict with the required structure, CRA phrasing, or banned-word rules${
        waived.length > 0
          ? ", or with the writer's personal preferences in their waived house-style areas below"
          : ""
      }:\n${draftStyle.trim()}`
    : "";
  // Per-writer flavor (Phase A + PSOS-49): the requesting writer's personal
  // preferences. For waived house-style categories they are AUTHORITATIVE;
  // everywhere else they stay the lowest-priority guidance so they can never
  // override CRA structure, the remaining house rules, or the length budget.
  const flavorBlock = writerFlavor?.trim()
    ? styleOverrides.reportSkeleton
      ? `\n\n## Writer's personal style preferences (AUTHORITATIVE)\nThe requesting writer recorded these preferences and their profile waives the built-in report skeleton. They are the authority for section architecture (paragraph count, roles, order, openers, framing) and for these waived house-style areas: ${waived.join("; ")}. Apply them fully. The only limits they cannot override are the length budget and the evidence rules (use only the provided material; [GAP] placeholders instead of invention); the learned style guidance above yields to them wherever the two conflict.\n\n${writerFlavor.trim()}`
      : waived.length > 0
      ? `\n\n## Writer's personal style preferences\nThe requesting writer recorded these preferences. For the following waived house-style areas they are AUTHORITATIVE and replace the default house rules: ${waived.join("; ")}.\nOutside those areas, apply them ONLY where they do not conflict with: (1) the required CRA section structure and paragraph mandates, (2) the remaining house-style and CRA phrasing rules, (3) the length budget, (4) the learned style guidance above. When in conflict outside the waived areas, ignore the preference silently.\n\n${writerFlavor.trim()}`
      : `\n\n## Writer's personal style preferences (lowest priority)\nThe requesting writer recorded these personal preferences. Apply them ONLY where\nthey do not conflict with: (1) the required CRA section structure and paragraph\nmandates, (2) CRA phrasing and banned-word rules, (3) the length budget,\n(4) the learned style guidance above. When in conflict, ignore the preference\nsilently.\n\n${writerFlavor.trim()}`
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
  anthropicFor: (callSite: string) => GenerationClient,
  modelId: string,
  key: SectionKey,
  text: string,
  lengthTarget: LengthTarget,
  styleOverrides: StyleOverrides = NO_STYLE_OVERRIDES
): Promise<string> {
  let out = text;
  for (const squeeze of [1, 0.85]) {
    if (!sectionMetrics(out, key).overLimit) return out;
    const compressed = await compressSection(
      anthropicFor(`generation:compression:${key.slice(1)}`),
      modelId,
      key,
      out,
      lengthTarget,
      squeeze
    );
    // PSOS-49: a bannedWords waiver exempts this writer from the scrub —
    // re-scrubbing here would sneak the house vocabulary back in.
    out = scrubBannedWordsUnlessWaived(compressed, styleOverrides.bannedWords);
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
  anthropicFor: (callSite: string) => GenerationClient,
  modelId: string,
  transcript: string,
  contextDocs: ContextDoc[],
  title: string,
  brainExemplars: BrainExemplarBlocks,
  lengthTarget: LengthTarget = "standard",
  qaCalibration?: string,
  draftStyle?: string,
  writerFlavor?: string,
  styleOverrides: StyleOverrides = NO_STYLE_OVERRIDES
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
  const styleGuidance = buildStyleGuidance(draftStyle, writerFlavor, styleOverrides);
  const [raw242, raw244, raw246] = await Promise.all([
    runSection242Agent(anthropicFor("generation:section:242"), analysis, modelId, brainExemplars.s242, lengthBudgetBlock("s242", lengthTarget), styleGuidance, styleOverrides),
    runSection244Agent(anthropicFor("generation:section:244"), analysis, modelId, brainExemplars.s244, lengthBudgetBlock("s244", lengthTarget), styleGuidance, styleOverrides),
    runSection246Agent(anthropicFor("generation:section:246"), analysis, modelId, brainExemplars.s246, lengthBudgetBlock("s246", lengthTarget), styleGuidance, styleOverrides),
  ]);
  // PSOS-49: a bannedWords waiver exempts this writer from the mechanical scrub.
  let section242 = scrubBannedWordsUnlessWaived(raw242, styleOverrides.bannedWords);
  let section244 = scrubBannedWordsUnlessWaived(raw244, styleOverrides.bannedWords);
  let section246 = scrubBannedWordsUnlessWaived(raw246, styleOverrides.bannedWords);

  // BNH-45 enforcement: still over the form limit after the budgeted draft →
  // compression pass(es) per offending section (part of generation, before
  // the candidate ever lands).
  [section242, section244, section246] = await Promise.all([
    compressToFit(anthropicFor, modelId, "s242", section242, lengthTarget, styleOverrides),
    compressToFit(anthropicFor, modelId, "s244", section244, lengthTarget, styleOverrides),
    compressToFit(anthropicFor, modelId, "s246", section246, lengthTarget, styleOverrides),
  ]);

  const metrics = {
    s242: sectionMetrics(section242, "s242"),
    s244: sectionMetrics(section244, "s244"),
    s246: sectionMetrics(section246, "s246"),
    lengthTarget,
  };
  // QA and chronology are ADVISORY: the report is already drafted and usable
  // without them. Neither may fail a generation the writer would otherwise
  // have received — losing a full multi-model draft because a scorecard came
  // back malformed is far worse than shipping the draft with no scorecard.
  const [qaSettled, chronologySettled] = await Promise.allSettled([
    runQAAgent(anthropicFor("generation:qa"), analysis, section242, section244, section246, modelId, qaCalibration, styleOverrides, detectFirstPersonPreference(writerFlavor)),
    runChronologyAgent(anthropicFor("generation:chronology"), analysis, modelId),
  ]);
  if (qaSettled.status === "rejected") {
    console.error("QA scorecard failed; continuing without it", qaSettled.reason);
  }
  if (chronologySettled.status === "rejected") {
    console.error("Chronology failed; continuing without it", chronologySettled.reason);
  }
  const qaScorecard = qaSettled.status === "fulfilled" ? qaSettled.value : null;
  const chronology =
    chronologySettled.status === "fulfilled" ? chronologySettled.value : null;
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
      // PSOS-50: the waivers this draft was written under, frozen so QA
      // re-runs score the same way (all-false included).
      styleOverrides,
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
    const candidateModels = input.retryModelIds?.length
      ? input.retryModelIds
          .map((id) => CANDIDATE_MODELS.find((model) => model.id === id))
          .filter((model): model is (typeof CANDIDATE_MODELS)[number] => model !== undefined)
      : candidateModelsForMode(
          input.candidateMode,
          input.singleModelId,
          input.compareModelIds
        );
    const seededCandidates = input.seededCandidates ?? 0;
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
      if (transcriptWords > 0) {
        await log(`Read frozen interview transcript — ${transcriptWords.toLocaleString()} words.`);
      } else {
        await log("No interview transcript — drafting from context documents only.");
      }
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
        totalCandidates: candidateModels.length + seededCandidates,
      });

      await ctx.runMutation(internal.generations.updateGenerationStatus, {
        generationId: genId,
        status: "running",
        currentStep: "Generating candidate drafts...",
      });
      // Per-writer flavor (Phase A) + style overrides (PSOS-49/50): shared
      // policy in writerStyle.ts. Started here so it loads in parallel with
      // the learning digests (data-independent; it swallows its own errors).
      const writerStylePromise = fetchWriterStyle(ctx, input.requestedBy, log);

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

      const { writerFlavor, styleOverrides } = await writerStylePromise;

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
            ...(styleOverrides ? { styleOverrides } : {}),
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
    styleOverrides: v.optional(styleOverridesValidator),
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
    // Routed by the candidate model's gateway: Anthropic models use the
    // direct SDK, OpenAI/Google models go through OpenRouter. Usage from both
    // lands in the same aiUsage table.
    const clientFor = (callSite: string) =>
      clientForModel(ctx, run.model, {
        callSite,
        projectId: run.projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
      });
    try {
      const { content, agentOutputs, qaScore, claimDrafts } =
        await runPipelineForModel(
          clientFor,
          run.model,
          input.transcript,
          toContextDocs(input.contextDocs),
          input.title,
          args.brainExemplars,
          input.lengthTarget,
          args.qaCalibration,
          args.draftStyle,
          args.writerFlavor,
          normalizeStyleOverrides(args.styleOverrides)
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
