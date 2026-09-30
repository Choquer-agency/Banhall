"use node";

// Story 2 (CAP-5/9/10, AD-24/25/27): ordered, ungated section generation for
// single and compare. One scheduled action per section, in the Writer
// Profile's Build Order, each reading the prior DRAFTED sections as context,
// Self-checked (deterministic + one structured model call) and repaired at
// most once before its completion mutation schedules the next section; then
// one finalize action runs the assembled-draft consistency pass, QA and
// chronology, and completes the candidate. Actions only: every write goes
// through the fenced internal mutations in convex/generations.ts.

import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import {
  clientForStep,
  describeProviderFailure,
  generationStepClients,
  normalizeProviderError,
  registerGenerationModels,
  startActionDeadline,
} from "./providers";
import { resolveGenerationStep } from "../lib/generationSteps";
import type { ModelFreeze } from "../lib/modelCatalogValidators";
import type { GenerationClient, GenerationMessageParams } from "./openrouterCore";
import { parseTranscriptAnalysis } from "./analyzerAgent";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import {
  buildStyleGuidance,
  compressWithinLimit,
  lengthBudgetBlock,
  quotedTerms,
  limitOverage,
  type LimitFit,
  provenanceDrafts,
  recordCandidateProvenance,
} from "./pipeline";
import {
  consistencyFailureReason,
  runConsistencyPass,
  runFinalCoverageSelfCheck,
  runModelSelfCheck,
  selfCheckFailureDiagnostic,
  type ModelSelfCheckResult,
} from "./selfCheck";
import {
  generationSlotOf,
  mergeSlotCounts,
  ORDERED_SLOT_ALLOWANCES,
  summarizeSlotUsage,
} from "./instrument";
import {
  ORDERED_PROMPT_SCAFFOLDS,
  ORDERED_SECTION_TITLES,
} from "./promptDefinitions";
import { scrubBannedWordsUnlessWaived } from "../../shared/bannedWords";
import { normalizeStyleOverrides } from "../../shared/styleOverrides";
import { detectFirstPersonPreference } from "../../shared/humanProse";
import { buildTiptapDocument } from "../lib/tiptapReport";
import {
  LINE_LIMITS,
  WORD_CAPS,
  sectionMetrics,
  draftWordTarget,
  type LengthTarget,
  type SectionKey,
} from "../lib/lineLimits";
import {
  orderedPayloadValidator,
  sectionKeyOf,
  sectionNumberValidator,
  type OrderedPayload,
  type SectionNumber,
} from "../lib/orderedChain";
import {
  assembleSectionNotes,
  consistencyNoteDrafts,
  consistencySummaryNote,
  repairIssues,
  runDeterministicSelfCheck,
  type DeterministicSelfCheck,
  type ModelVerdict,
} from "../lib/selfCheckRules";
import { noteDraft, type ComplianceNoteDraft } from "../lib/complianceNote";
import { containsTerm } from "../lib/editedTerms";
import {
  confirmedConflictParagraph,
  confirmedConflictsOf,
  conflictExclusionsPhrase,
  governingFeedbackPhrase,
  ideaWords,
  quoteForPrompt,
  stepTitle,
  type ConfirmedConflict,
  type FeedbackGovernedTerm,
  type GlossarySetAside,
  type WriterFeedback,
} from "../lib/writerPrecedence";
import { generationPromptVersion } from "./promptProgram";
import { forwardOrderedPayload } from "../lib/orderedPayloadStore";
import type { PdSubsectionRoleId } from "../../shared/pdSubsections";

const SECTION_AGENTS = {
  "242": runSection242Agent,
  "244": runSection244Agent,
  "246": runSection246Agent,
} as const;

/** Stamp the deployment's current prompt program, then enter the frozen plan. */
export const startSummaryRecovery = internalAction({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    try {
      await ctx.runMutation(internal.generations.beginSummaryRecovery, {
        generationId: args.generationId,
        promptVersion: await generationPromptVersion(ctx, args.generationId),
      });
    } catch (error) {
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.generations.failGeneration, {
        generationId: args.generationId,
        error: `${normalized.code}: ${normalized.message}`,
      });
    }
    return null;
  },
});

/** Prompt block carrying this candidate's prior DRAFTED sections (ungated:
 * context for consistency, never iterative's "approved" canonical text). */
export function draftedPriorSectionsBlock(
  priorSections: Array<{ section: SectionNumber; text: string }>
): string {
  if (priorSections.length === 0) return "";
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections;
  const body = priorSections
    .map(
      (prior) =>
        `${scaffold.itemTitlePrefix}${ORDERED_SECTION_TITLES[prior.section]}${scaffold.itemTitleSuffix}${prior.text}`
    )
    .join(scaffold.separator);
  return `${scaffold.prefix}${body}`;
}

/**
 * The repair instruction appended to the section agent's prompt. A Line with
 * edited terms (2026-09-28 second, edited terms) also tells the repair to
 * keep them word for word, whatever an issue says about them.
 */
export function repairGuidanceBlock(
  issues: string[],
  draft: string,
  editedTerms: readonly string[] = [],
  /** 2026-09-29 (second): the Line has WRITER'S DECISIONS. */
  writerDecisions = false
): string {
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.repairGuidance;
  const terms =
    editedTerms.length > 0
      ? `${scaffold.exactTermsPrefix}${quotedTerms(editedTerms)}${scaffold.exactTermsSuffix}`
      : "";
  return `${scaffold.prefix}${issues
    .map((issue) => `${scaffold.issuePrefix}${issue}`)
    .join(scaffold.issueSeparator)}${terms}${writerDecisions ? scaffold.writerDecisions : ""}${scaffold.draftPrefix}${draft}`;
}

/**
 * 2026-09-29 (second): the writer's decisions that outrank the Brief (CAP-13
 * rules 4 and 5), read after the plan and the Brief and before the writer's
 * exact terms and the Locked length: the ideas kept despite a Claim
 * Exclusion, the active Feedback that reaches the Line, the Glossary Terms
 * that Feedback governs there (PR #22 lead decision: "For the term X, follow
 * the writer's Feedback ...") and the ones a signed-off edit set aside.
 * Empty without any, so those requests are unchanged.
 */
export function writerDecisionsBlock(args: {
  confirmed: readonly ConfirmedConflict[];
  feedback: readonly WriterFeedback[];
  glossarySetAside: readonly GlossarySetAside[];
  feedbackTerms?: readonly FeedbackGovernedTerm[];
}): string {
  const governedTerms = args.feedbackTerms ?? [];
  if (
    args.confirmed.length === 0 &&
    args.feedback.length === 0 &&
    args.glossarySetAside.length === 0 &&
    governedTerms.length === 0
  ) {
    return "";
  }
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.writerDecisions;
  const kept = args.confirmed.length > 0
    ? `${scaffold.keptIntro}${args.confirmed
        .map((conflict) =>
          `${scaffold.keptPrefix}${quoteForPrompt(ideaWords(conflict.wording, 600))}${
            conflict.exclusions.length > 0
              ? `${scaffold.keptExclusionPrefix}${conflictExclusionsPhrase(conflict.exclusions.map((entry) => entry.text))}${scaffold.keptExclusionSuffix}`
              : ""
          }`)
        .join("")}`
    : "";
  // Review P3-3: the writer's words are delimited data, each quoted on one
  // line (quoteForPrompt), so an instruction can never close the block or
  // pose as a rule, and a name after a line break is still masked.
  const feedback = args.feedback.length > 0
    ? `${scaffold.feedbackIntro}${scaffold.feedbackBegin}${args.feedback
        .map((entry) =>
          `${scaffold.feedbackPrefix}${stepTitle(entry.roleId)}${scaffold.feedbackMiddle}${quoteForPrompt(entry.instruction)}`)
        .join("")}${scaffold.feedbackEnd}`
    : "";
  const governed = governedTerms.length > 0
    ? `${scaffold.governedIntro}${governedTerms
        .map((entry) =>
          `${scaffold.governedPrefix}${quoteForPrompt(entry.term)}${scaffold.governedMiddle}${governingFeedbackPhrase(entry.feedback)}`)
        .join("")}`
    : "";
  const glossary = args.glossarySetAside.length > 0
    ? `${scaffold.glossaryIntro}${args.glossarySetAside
        .map((entry) => `${scaffold.glossaryPrefix}${quoteForPrompt(entry.term)}`)
        .join("")}`
    : "";
  return `${scaffold.heading}${kept}${feedback}${governed}${glossary}`;
}

/**
 * Why a repair that no longer covers an idea the writer kept despite a
 * Claim Exclusion was not used: the coverage check of its final text found
 * it not covered (a drop or a disclaimer), or, with no verdict to read, its
 * excluded words went.
 */
export function repairDroppedKeptIdeaReason(conflict: Pick<ConfirmedConflict, "wording">): string {
  return `the repaired text no longer covers the idea the writer kept despite a Claim Exclusion ("${ideaWords(conflict.wording, 120)}"), so the checked draft was kept`;
}

/** The repair fix for an idea the writer kept despite a Claim Exclusion that the draft does not cover. */
export function keptIdeaRepairIssue(conflict: Pick<ConfirmedConflict, "wording" | "exclusions">): string {
  return `Whole section: state the idea the writer kept despite ${conflictExclusionsPhrase(conflict.exclusions.map((entry) => entry.text))} as work the project did, as the plan gives it: ${quoteForPrompt(ideaWords(conflict.wording, 600))}. A disclaimer or a "not claimed" mention does not cover it.`;
}

/** Compliance Note reasons for an idea the writer kept despite a Claim Exclusion. */
export function keptIdeaReason(
  state: "drafted" | "missing" | "over_limit" | "not_checked",
  words: string,
  exclusions: readonly string[] = [],
  detail: {
    section?: SectionNumber;
    paragraphInText?: number;
    /** A repair closer to the Locked limit, without its words, was kept. */
    wordsWentForLimit?: boolean;
  } = {}
): string {
  const named = conflictExclusionsPhrase(exclusions);
  if (state === "drafted") {
    return `Drafted despite ${named}: the writer kept the idea "${words}" at sign-off, so it stays in the report as work the project did and is not repaired away.`;
  }
  if (state === "missing") {
    return `Not drafted: the writer kept the idea "${words}" at sign-off despite ${named}, but the final text does not state it as work the project did. Add it before filing, or confirm with the writer that it should go.`;
  }
  if (state === "over_limit") {
    return `Not drafted: the writer kept the idea "${words}" at sign-off despite ${named}, but the draft that held it is further over the Line ${detail.section ?? ""} limit and the Locked Rules come first, so the text closer to the limit was kept without it. Shorten something else and add it before filing.`;
  }
  const where = detail.wordsWentForLimit
    ? `went from the text when a repair closer to the Line ${detail.section ?? ""} limit replaced a draft further over it, since the Locked Rules come first`
    : detail.paragraphInText === undefined
      ? "are not in the text as written"
      : `appear in paragraph ${detail.paragraphInText + 1} as written, which alone does not show it is stated as work the project did`;
  return `Not checked: the Self-check gave no usable verdict for the idea the writer kept despite ${named} ("${words}"); its excluded words ${where}.`;
}

/**
 * 2026-09-28 (second, edited terms): the writer's edited terms, read after
 * the plan and the Brief and before the Locked length. Empty without any.
 */
export function editedTermsBlock(editedTerms: readonly string[]): string {
  if (editedTerms.length === 0) return "";
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.editedTerms;
  return `${scaffold.prefix}${quotedTerms(editedTerms)}${scaffold.suffix}`;
}

/** Why a repair that dropped a writer's edited term was not used. */
export function repairDroppedTermReason(term: string): string {
  return `the repaired text dropped the writer's edited term "${term}", so the checked draft was kept`;
}

/**
 * 2026-09-28 (second): the Locked length restated after a signed-off plan,
 * so the drafter reads it after "Cover every COVER item"; since the full
 * release suite it asks for the draft target, well under the cap.
 */
export function planLengthBudgetBlock(section: SectionKey, target: LengthTarget): string {
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.planLengthBudget;
  return `${scaffold.prefix}${WORD_CAPS[section]}${scaffold.wordCapToLines}${LINE_LIMITS[section]}${scaffold.linesToBudget}${draftWordTarget(section, target)}${scaffold.suffix}`;
}

/** Why a repair that broke a Locked limit was not used (Compliance Note wording). */
export function repairOverLimitReason(section: SectionNumber, words: number, lines: number): string {
  const key = sectionKeyOf(section);
  return `the repaired text came out at ${words}/${WORD_CAPS[key]} words, ${lines}/${LINE_LIMITS[key]} lines, further from the Line ${section} limit than the checked draft, so the checked draft was kept`;
}

type PlanCheck = {
  itemId?: Id<"summaryItems">;
  skippedRoleId?: PdSubsectionRoleId;
  roleId: PdSubsectionRoleId;
  mergedItemIds: Id<"summaryItems">[];
  instruction: "cover" | "skip";
  confirmedExclusion: boolean;
  support?: "source_supported" | "writer_asserted";
  wording: string[];
  relationshipReferences: Array<{
    seedId: Id<"seeds">;
    wording: string[];
  }>;
  sourceReferences: Array<{
    originatingItemId: Id<"summaryItems">;
    sourceId: string;
    exactExcerpt: string;
  }>;
  quotesLeftOut?: number;
};

/**
 * 2026-09-27 (third): one row per signed-off item whose quotes marked for a
 * check were left out of the drafting evidence, naming the idea by its
 * wording (review P3-9), never an id. Its wording and support status were
 * drafted as signed off. No planRef, so plan coverage counts are unchanged.
 */
export function leftOutQuoteNoteDrafts(args: {
  section: SectionNumber;
  checks: readonly PlanCheck[];
}): ComplianceNoteDraft[] {
  return args.checks.flatMap((check) => {
    const count = check.quotesLeftOut ?? 0;
    if (!check.itemId || count === 0) return [];
    const wording = check.wording.join(" ").trim();
    const idea = wording.length > 120 ? `${wording.slice(0, 119).trimEnd()}...` : wording;
    return [noteDraft({
      section: args.section,
      source: "deterministic",
      instruction: `Leave out quotes marked for a check from the evidence for the idea "${idea}"`,
      outcome: "applied",
      tier: "none",
      reason: `${count} ${count === 1 ? "quote was" : "quotes were"} marked as possibly not backing this idea, so the draft did not use ${count === 1 ? "it" : "them"} as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence.`,
    })];
  });
}

function sameUtf8Bytes(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  return leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((byte, index) => byte === rightBytes[index]);
}

/** Compliance Note reason when the final text's coverage check failed. */
export const FINAL_COVERAGE_NOT_CHECKED_REASON =
  "Not checked: the plan coverage Self-check of the final text did not complete.";

type PlanVerdicts = ModelSelfCheckResult["planVerdicts"];

/**
 * The Compliance Note row for a final coverage check that failed as a whole,
 * worded like the "Model Self-check" row: the failure kind and the stored
 * diagnostic, never model text (2026-09-28, run 4).
 */
export function finalCoverageFailureNoteDraft(
  section: SectionNumber,
  reason: string,
  detail: string
): ComplianceNoteDraft {
  return noteDraft({
    section,
    source: "deterministic",
    instruction: "Final coverage Self-check",
    outcome: "not_applied",
    tier: "none",
    reason: `Final coverage Self-check failed (${reason}${detail ? `: ${detail}` : ""}); plan rows not checked on the final text`,
  });
}

function planVerdictFor(
  verdicts: PlanVerdicts,
  check: Pick<PlanCheck, "itemId" | "skippedRoleId">
): PlanVerdicts[number] | undefined {
  return verdicts.find((verdict) =>
    check.itemId ? verdict.itemId === check.itemId : verdict.skippedRoleId === check.skippedRoleId
  );
}

/**
 * Convert the Self-check response into one AD-37 row per item/Skip. When an
 * accepted repair changed the checked text, `finalCoverage` carries the
 * coverage-only Self-check of the final text (2026-09-28, third), and the
 * rows record its verdicts: a row is marked repaired only when the first
 * check sent it to the repair and the final check found it applied.
 */
export function planComplianceNoteDrafts(args: {
  section: SectionNumber;
  summaryVersionId: Id<"summaryVersions">;
  checks: PlanCheck[];
  verdicts: PlanVerdicts;
  repairSucceeded?: boolean;
  /** The accepted repair was then shortened by compression (review P2-1). */
  repairShortened?: boolean;
  coverageCheckSucceeded?: boolean;
  finalCoverage?: { ok: true; verdicts: PlanVerdicts } | { ok: false };
  /**
   * 2026-09-28 (second, edited terms): why the repair came back but was not
   * used, recorded on the rows that were sent to it.
   */
  repairNotUsedReason?: string;
  /**
   * 2026-09-29 (second, CAP-13 rule 4): each idea the writer kept despite a
   * Claim Exclusion, by item id: the exclusion it matches, its words and the
   * paragraph of the final text that holds its excluded words as written,
   * if any. Its row is decided from the final text.
   */
  confirmed?: ReadonlyMap<string, {
    exclusions: readonly string[];
    words: string;
    /** The final text's paragraph that holds its excluded words as written. */
    paragraphIndex?: number;
    /** A repair that left it out was used because the draft that held it was further over the Locked limit. */
    droppedForLimit?: boolean;
  }>;
}): ComplianceNoteDraft[] {
  return args.verdicts.flatMap((verdict) => {
    const expected = args.checks.find((check) =>
      verdict.itemId
        ? check.itemId === verdict.itemId
        : check.skippedRoleId === verdict.skippedRoleId
    );
    if (!expected) return [];
    const conflict = expected.confirmedExclusion;
    const sentToRepair =
      !conflict &&
      verdict.outcome === "not_applied" &&
      verdict.actionableRepair !== false &&
      args.coverageCheckSucceeded !== false &&
      (args.repairSucceeded ?? false);
    const planRef = {
      summaryVersionId: args.summaryVersionId,
      ...(expected.itemId ? { itemId: expected.itemId } : {}),
      ...(expected.skippedRoleId ? { skippedRoleId: expected.skippedRoleId } : {}),
      mergedItemIds: expected.mergedItemIds,
    };
    const instruction = expected.instruction === "skip"
      ? `Omit signed-off role ${expected.skippedRoleId}`
      : `Cover signed-off Summary item ${expected.itemId}`;
    if (conflict) {
      // CAP-13 rule 4 (2026-09-29, second): the idea is drafted and kept,
      // and its row says so from the verdict that describes the final text
      // (the coverage-only check after a used repair, else the first
      // check). Its excluded words standing in the text never decide it
      // (review P2-1: a disclaimer holds them too); with no usable verdict
      // the row is "Not checked". Tier conflict; never marked repaired.
      const kept = expected.itemId ? args.confirmed?.get(expected.itemId) : undefined;
      const final = args.finalCoverage
        ? args.finalCoverage.ok
          ? planVerdictFor(args.finalCoverage.verdicts, expected)
          : undefined
        : args.coverageCheckSucceeded === false
          ? undefined
          : verdict;
      const checked = final !== undefined && final.actionableRepair !== false;
      const drafted = checked && final.outcome === "applied";
      // Rule 4 (g): with no usable verdict the row is "Not checked", even
      // when a repair within the limit was kept (re-check P3-4).
      const state = drafted
        ? "drafted" as const
        : !checked
          ? "not_checked" as const
          : kept?.droppedForLimit
            ? "over_limit" as const
            : "missing" as const;
      return [noteDraft({
        section: args.section,
        ...(drafted && final.paragraphIndex !== undefined ? { paragraphIndex: final.paragraphIndex } : {}),
        source: "model",
        instruction,
        outcome: drafted ? "applied" : "not_applied",
        tier: "conflict",
        reason: keptIdeaReason(
          state,
          kept?.words ?? ideaWords(expected.wording, 120),
          kept?.exclusions ?? [],
          {
            section: args.section,
            ...(kept?.paragraphIndex !== undefined ? { paragraphInText: kept.paragraphIndex } : {}),
            ...(kept?.droppedForLimit ? { wordsWentForLimit: true } : {}),
          }
        ),
        repaired: false,
        planRef,
      })];
    }
    if (args.finalCoverage) {
      // The final text's own verdict, or not checked when that check failed
      // or gave none; the first verdict described text that is gone.
      const final = args.finalCoverage.ok
        ? planVerdictFor(args.finalCoverage.verdicts, expected)
        : undefined;
      return [noteDraft({
        section: args.section,
        ...(final?.paragraphIndex === undefined ? {} : { paragraphIndex: final.paragraphIndex }),
        source: "model",
        instruction,
        outcome: final?.outcome ?? "not_applied",
        tier: "none",
        reason: final?.reason ?? FINAL_COVERAGE_NOT_CHECKED_REASON,
        repaired: sentToRepair && final?.outcome === "applied",
        planRef,
      })];
    }
    // A repair compression then changed was never checked again.
    const notReverified = sentToRepair && args.repairShortened === true;
    const repairNotUsed =
      !args.repairSucceeded &&
      args.repairNotUsedReason !== undefined &&
      verdict.outcome === "not_applied" &&
      verdict.actionableRepair !== false &&
      args.coverageCheckSucceeded !== false
        ? `; repair not used (${args.repairNotUsedReason})`
        : "";
    return [noteDraft({
      section: args.section,
      ...(verdict.paragraphIndex === undefined ? {} : { paragraphIndex: verdict.paragraphIndex }),
      source: "model",
      instruction,
      outcome: verdict.outcome,
      tier: "none",
      reason: notReverified
        ? `${verdict.reason}; repaired, then shortened to fit the Line limit, so not re-verified`
        : `${verdict.reason}${repairNotUsed}`,
      repaired: sentToRepair && !notReverified,
      planRef,
    })];
  });
}

/** AD-27: one increment per messages.create, keyed by slot. */
function countingClient(
  client: GenerationClient,
  callSite: string,
  counts: Record<string, number>
): GenerationClient {
  const slot = generationSlotOf(callSite) ?? callSite;
  return {
    messages: {
      create: async (params: GenerationMessageParams) => {
        counts[slot] = (counts[slot] ?? 0) + 1;
        return await client.messages.create(params);
      },
    },
  };
}

/**
 * The chain's clients keyed by call site (owner decision 43): the
 * candidate's model drafts, repairs and compresses; the generation's frozen
 * checking model runs the Self-check, consistency, QA and chronology.
 * `modelFor` names the model each call site's request must carry.
 */
function chainClientFactory(
  ctx: ActionCtx,
  meta: {
    model: string;
    projectId: Id<"projects">;
    requestedBy?: Id<"users">;
    generationId: Id<"generations">;
    candidateRunId: Id<"generationCandidateRuns">;
    freeze: ModelFreeze | null;
  },
  counts: Record<string, number>
) {
  const steps = generationStepClients(ctx, {
    freeze: meta.freeze,
    writerModel: meta.model,
    meta: (callSite, learningDigestIds) => ({
      callSite,
      projectId: meta.projectId,
      ...(meta.requestedBy ? { userId: meta.requestedBy } : {}),
      attribution: {
        generationId: meta.generationId,
        candidateRunId: meta.candidateRunId,
        ...(learningDigestIds?.length ? { learningDigestIds } : {}),
      },
    }),
  });
  const client = (callSite: string, learningDigestIds?: Id<"learningDigests">[]) =>
    countingClient(steps.client(callSite, learningDigestIds), callSite, counts);
  return Object.assign(client, {
    modelFor: (callSite: string) => steps.route(callSite).model,
  });
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseCounts(value: string | null): Record<string, number> {
  const parsed = parseJsonObject(value);
  const out: Record<string, number> = {};
  if (!parsed) return out;
  for (const [slot, count] of Object.entries(parsed)) {
    if (typeof count === "number") out[slot] = count;
  }
  return out;
}

/** The chain payload a scheduled step was handed: in its arguments (chains
 * scheduled before 2026-09-25) or stored once and named by id. */
async function loadChainPayload(
  ctx: ActionCtx,
  args: {
    generationId: Id<"generations">;
    payload?: OrderedPayload;
    payloadId?: Id<"generationArtifacts">;
  }
): Promise<OrderedPayload | null> {
  if (args.payload) return args.payload;
  if (!args.payloadId) return null;
  return await ctx.runQuery(internal.generations.getOrderedPayload, {
    generationId: args.generationId,
    payloadId: args.payloadId,
  });
}

/** The claim both the ordered chain and the seed redraft draft from. */
type SectionClaim = Exclude<
  NonNullable<FunctionReturnType<typeof internal.generations.claimOrderedSectionRun>>,
  { stopped: true }
>;

/**
 * The clients one Section drafts and checks with: chainClientFactory in
 * production, keyed by call site, with the model each call site must carry.
 */
type SectionClients = ((
  callSite: string,
  learningDigestIds?: Id<"learningDigests">[]
) => GenerationClient) & { modelFor: (callSite: string) => string };

/** What one drafted, Self-checked Section persists (slot counts aside). */
type SectionCompletion = {
  draftText: string;
  metrics: string;
  selfCheck: string;
  notes: ComplianceNoteDraft[];
  storylineQuestion?: {
    question: string;
    sectionClaim: string;
    storylineAlternative: string;
    evidenceEntryId: Id<"generationBriefEntries">;
  };
};

/**
 * Draft, Self-check and (at most once) repair one section. Worst case:
 * draft 1 + compression 3 (two squeezes and, when the text is still at most
 * 10 percent over, one targeted pass, 2026-09-28 fifth) + Self-check 2 (its
 * answer plus one structured retry, or in Summary mode its one follow-up for
 * missing labels, 2026-09-28) + repair 1 + compression of the repair 3 + the
 * coverage-only Self-check of the final text 2 (its answer and one
 * follow-up, Summary mode only, when the repair changed the text, 2026-09-28
 * third) = 12 sequential calls (providers.ts ORDERED_SECTION_ACTION_SLOTS);
 * the action deadline bounds their time. Shared by the ordered chain and
 * the seed redraft so both draft under the same rules. Throws on a failed
 * draft; the caller records the failure.
 */
export async function draftCheckedSection(input: {
  claim: SectionClaim;
  payload: OrderedPayload;
  section: SectionNumber;
  clientFor: SectionClients;
}): Promise<SectionCompletion> {
  const { claim, payload, section, clientFor } = input;
  const analysis = parseTranscriptAnalysis(payload.analysis);
  const styleOverrides = normalizeStyleOverrides(payload.styleOverrides);
  const key = sectionKeyOf(section);
  const lengthTarget = claim.lengthTarget as LengthTarget;
  const styleGuidance =
    (payload.frozenStyleGuidance ??
      buildStyleGuidance(payload.draftStyle, payload.writerFlavor, styleOverrides)) +
    draftedPriorSectionsBlock(claim.priorSections);
  const styleDigestIds =
    payload.draftStyleDigestId && payload.draftStyle?.trim()
      ? [payload.draftStyleDigestId]
      : undefined;
  const agent = SECTION_AGENTS[section];
  // 2026-09-29 (second, CAP-13 rules 4 and 5): the writer's decisions that
  // outrank the Brief. Claims frozen before them carry none.
  const confirmed = confirmedConflictsOf(claim.planChecks, claim.brief?.claimExclusions ?? []);
  const writerFeedback: readonly WriterFeedback[] = claim.writerFeedback ?? [];
  const glossarySetAside: readonly GlossarySetAside[] = claim.glossarySetAside ?? [];
  // PR #22 lead decision: a Glossary Term the Line's Feedback names is
  // governed by that Feedback, checked by its own Self-check label.
  const feedbackTerms: readonly FeedbackGovernedTerm[] = claim.feedbackTerms ?? [];
  const decisions = writerDecisionsBlock({
    confirmed,
    feedback: writerFeedback,
    glossarySetAside,
    feedbackTerms,
  });
  // Review P3-6: the checked text is over a Locked limit and further over
  // it than the other text, which must never be traded back for it.
  const overLimitMore = (checked: string, other: string) =>
    sectionMetrics(checked, key).overLimit && limitOverage(checked, key) > limitOverage(other, key);
  const draftWith = async (callSite: string, extraGuidance = "") =>
    scrubBannedWordsUnlessWaived(
      await agent(
        clientFor(callSite, styleDigestIds),
        analysis,
        claim.model,
        payload.brainExemplars[key],
        // 2026-09-28 (second, full suite): drafts and repairs aim well under the cap.
        lengthBudgetBlock(key, lengthTarget, draftWordTarget(key, lengthTarget)),
        styleGuidance + extraGuidance,
        styleOverrides,
        // A signed-off plan run restates the Locked length last, after the
        // plan and the Brief (review P3-5).
        claim.planBlock
          ? claim.briefBlock + decisions + editedTermsBlock(claim.editedTerms) + planLengthBudgetBlock(key, lengthTarget)
          : claim.briefBlock,
        claim.planBlock
      ),
      styleOverrides.bannedWords
    );

  let text = await draftWith(`generation:section:${section}`);
  if (!text.trim()) {
    // The raw model response is non-empty (requireTextResponse already
    // guards that); only the banned-word scrub can empty it here. There
    // is no repair fallback for the first draft, so this fails the
    // section run rather than persisting an empty body.
    throw new Error("Section draft empty after the banned-word scrub");
  }
  // Review P2-1: the signed-off plan's COVER items stay in every
  // compression, and the repair's fixes stay in the repair's. Since
  // 2026-09-29 (second) that includes an idea the writer kept despite a
  // Claim Exclusion (CAP-13 rule 4).
  const coverItems = claim.planChecks
    .filter((planCheck) => planCheck.instruction === "cover")
    .map((planCheck) => planCheck.wording.join(" "));
  // A compression pass that comes back empty after the scrub, no closer to
  // the limits or missing required content never replaces the draft it was
  // given. A pass that fails keeps the best text so far; only a failure
  // before any pass was kept fails the Section, as before (review P2-2).
  const firstFit = await compressWithinLimit(
    clientFor,
    claim.model,
    key,
    text,
    lengthTarget,
    styleOverrides,
    coverItems,
    claim.editedTerms,
    { finalCut: true }
  );
  if (firstFit.error !== undefined) {
    if (firstFit.text === text) throw firstFit.error;
    console.warn(
      `generation:compression:${section}: a later pass failed (${normalizeProviderError(firstFit.error).code}); the best pass so far is kept`
    );
  }
  text = firstFit.text;
  // The fit whose text is kept, for the Locked row (review P3-6).
  let keptFit: LimitFit = firstFit;

  const brief = claim.brief;
  const check = (draft: string): DeterministicSelfCheck =>
    runDeterministicSelfCheck({
      section,
      text: draft,
      brief,
      profile: payload.orderedContext,
      isFirstInOrder: claim.isFirstInOrder,
      confirmedPlanConflicts: claim.planChecks
        .filter((planCheck) => planCheck.confirmedExclusion)
        .map((planCheck) => planCheck.wording),
      glossarySetAside,
      feedbackTerms: feedbackTerms.map((entry) => entry.term),
    });
  const before = check(text);

  let verdicts: ModelVerdict[] = [];
  let storylineQuestion: ModelSelfCheckResult["storylineQuestion"] = null;
  let storylineQuestionWithheld: string | undefined;
  let planVerdicts: ModelSelfCheckResult["planVerdicts"] = [];
  let modelCheck: { ok: true } | { ok: false; reason: string; detail?: string } = { ok: true };
  try {
    const result = await runModelSelfCheck(clientFor(`generation:selfCheck:${section}`), {
      section,
      text,
      storylineText: brief?.storylineText ?? "",
      confidenceMap: brief?.confidenceMap ?? [],
      glossaryCandidates: before.glossaryCandidates,
      writerInstructions: payload.writerFlavor,
      rules: before.modelRules,
      model: clientFor.modelFor(`generation:selfCheck:${section}`),
      planChecks: claim.planChecks,
      planChecksBlock: claim.planChecksBlock,
      editedTerms: claim.editedTerms,
      ...(writerFeedback.length > 0 ? { writerFeedback } : {}),
      ...(feedbackTerms.length > 0 ? { feedbackTerms } : {}),
    });
    verdicts = result.verdicts;
    storylineQuestion = result.storylineQuestion;
    storylineQuestionWithheld = result.storylineQuestionWithheld;
    planVerdicts = result.planVerdicts;
    if (storylineQuestionWithheld) {
      console.warn(
        `generation:selfCheck:${section}: Storyline question withheld: ${storylineQuestionWithheld}`
      );
    }
  } catch (error) {
    // An unrepaired or unrun check never blocks the section (Never-rule);
    // the failure is recorded in the Compliance Note instead, with a short
    // diagnostic that names the failed clause but carries no model text.
    const reason = normalizeProviderError(error).code;
    const detail = selfCheckFailureDiagnostic(error);
    console.warn(
      `generation:selfCheck:${section}: Self-check failed (${reason}): ${detail}`
    );
    // The stored diagnostic belongs to the Summary check only: legacy,
    // single and compare runs keep their Compliance Note exactly as before.
    modelCheck =
      claim.planChecks.length > 0 ? { ok: false, reason, detail } : { ok: false, reason };
    planVerdicts = claim.planChecks.map((check) => ({
      ...(check.itemId ? { itemId: check.itemId } : {}),
      ...(check.skippedRoleId ? { skippedRoleId: check.skippedRoleId } : {}),
      mergedItemIds: [...check.mergedItemIds],
      outcome: "not_applied" as const,
      reason: "The plan coverage Self-check did not complete.",
    }));
  }

  const planIssues = modelCheck.ok
    ? planVerdicts.flatMap((verdict) => {
        const expected = claim.planChecks.find((check) =>
          verdict.itemId
            ? check.itemId === verdict.itemId
            : check.skippedRoleId === verdict.skippedRoleId
        );
        if (verdict.outcome !== "not_applied" || verdict.actionableRepair === false) return [];
        // CAP-13 rule 4: an idea the writer kept despite a Claim Exclusion
        // that the check found not covered (left out, or disclaimed) goes
        // to the repair with a fixed fix that names its words, never the
        // model's guidance.
        if (expected?.confirmedExclusion) {
          const kept = confirmed.find((conflict) => conflict.itemId === expected.itemId);
          return kept ? [keptIdeaRepairIssue(kept)] : [];
        }
        return [verdict.repairText ?? verdict.repairGuidance ?? verdict.reason];
      })
    : [];
  const issues = [...repairIssues(before, verdicts, feedbackTerms), ...planIssues];
  const repair: {
    attempted: boolean;
    succeeded: boolean;
    failureReason?: string;
    notUsedReason?: string;
    shortened?: boolean;
  } = {
    attempted: issues.length > 0,
    succeeded: false,
  };
  let finalText = text;
  let after: DeterministicSelfCheck | null = null;
  // Review P3-6: kept ideas a used repair left out because the draft that
  // held them was further over a Locked limit (Locked Rules come first).
  const droppedForLimit = new Set<string>();
  if (repair.attempted) {
    try {
      // The same section agent that drafted it, with the repair guidance
      // appended: a separate model interaction, never an inline edit.
      const repaired = await draftWith(
        `generation:repair:${section}`,
        repairGuidanceBlock(issues, text, claim.editedTerms, decisions !== "")
      );
      if (repaired.trim()) {
        // 2026-09-28 (second): the repair is a whole new draft, so it is
        // compressed and measured like the first one before it can replace
        // the checked draft, keeping the COVER items and the fixes it was
        // made for (length guidance aside). A compression that fails here
        // (a provider error, the action deadline) keeps its best text so far.
        // A fix that names an edited term (to add it, or to call it
        // invented) is not a Must keep point: the term itself is kept word
        // for word as an exact term.
        const fixes = issues.filter(
          (issue) =>
            !issue.startsWith("Shorten ") &&
            !claim.editedTerms.some((term) => containsTerm(issue, term))
        );
        const fit = await compressWithinLimit(
          clientFor,
          claim.model,
          key,
          repaired,
          lengthTarget,
          styleOverrides,
          [...coverItems, ...fixes],
          claim.editedTerms,
          { finalCut: true }
        );
        // CAP-13: a repair never removes a writer's edited term the checked
        // draft held (release suite run 4).
        const droppedTerm = claim.editedTerms.find(
          (term) => containsTerm(text, term) && !containsTerm(fit.text, term)
        );
        // CAP-13 rule 4 (2026-09-29, second): nor an idea the writer kept
        // despite a Claim Exclusion. The coverage check of the final text
        // decides that below; only with no verdict to read (the first
        // Self-check failed) do its excluded words going count as a drop.
        const droppedKept = modelCheck.ok
          ? []
          : confirmed.filter(
              (conflict) =>
                confirmedConflictParagraph(text, conflict) !== undefined &&
                confirmedConflictParagraph(fit.text, conflict) === undefined
            );
        // Review P3-6: the Locked Rules outrank the writer's decisions, so
        // a draft further over the limit never comes back for a kept idea.
        const keptOverLimit =
          droppedKept.length > 0 && overLimitMore(text, fit.text);
        const failure =
          fit.error === undefined
            ? undefined
            : `compression of the repair failed (${normalizeProviderError(fit.error).code})`;
        if (failure) console.warn(`generation:compression:${section}: ${failure}`);
        // Ties go to the repair: it fixed the checked issues (review P3-3).
        if (fit.overLimit && limitOverage(fit.text, key) > limitOverage(text, key)) {
          // Locked Rules outrank every repaired issue: a repair further
          // over the limit than the checked draft is not used.
          const metrics = sectionMetrics(fit.text, key);
          repair.notUsedReason = `${repairOverLimitReason(section, metrics.words, metrics.lines)}${
            failure ? `; ${failure}` : ""
          }`;
        } else if (droppedTerm !== undefined) {
          repair.notUsedReason = `${repairDroppedTermReason(droppedTerm)}${failure ? `; ${failure}` : ""}`;
        } else if (droppedKept.length > 0 && !keptOverLimit) {
          repair.notUsedReason = `${repairDroppedKeptIdeaReason(droppedKept[0]!)}${failure ? `; ${failure}` : ""}`;
        } else {
          if (keptOverLimit) for (const conflict of droppedKept) droppedForLimit.add(conflict.itemId);
          finalText = fit.text;
          repair.succeeded = true;
          // Review P2-1: a repair the compression changed was not checked
          // again by the model, so its fixes are not claimed as repaired.
          repair.shortened = !sameUtf8Bytes(fit.text, repaired);
          keptFit = fit;
          after = check(finalText);
        }
      } else {
        // An empty repair never replaces the draft it was meant to fix.
        repair.failureReason = "EMPTY_OUTPUT";
      }
    } catch (error) {
      repair.failureReason = normalizeProviderError(error).code;
    }
  }

  // 2026-09-28 (third): the coverage record describes the final text. When
  // an accepted repair (and its compression) changed the text the Self-check
  // saw, a coverage-only Self-check on the frozen checking model checks the
  // final text; nothing changes the text after it. Unchanged text makes no
  // call, and a first check that failed as a whole stays unavailable.
  let finalCoverage:
    | { ok: true; verdicts: PlanVerdicts }
    | { ok: false; reason: string; detail: string }
    | undefined;
  if (
    payload.summaryVersionId &&
    claim.planChecks.length > 0 &&
    modelCheck.ok &&
    !sameUtf8Bytes(text, finalText)
  ) {
    try {
      finalCoverage = {
        ok: true,
        verdicts: await runFinalCoverageSelfCheck(
          clientFor(`generation:selfCheck:${section}`),
          {
            section,
            text: finalText,
            model: clientFor.modelFor(`generation:selfCheck:${section}`),
            planChecks: claim.planChecks,
            planChecksBlock: claim.planChecksBlock,
            editedTerms: claim.editedTerms,
            ...(writerFeedback.length > 0 ? { writerFeedback } : {}),
          }
        ),
      };
    } catch (error) {
      // Stored beside modelCheckDetail with the same diagnostic: the clause,
      // positions, byte counts and app-supplied ids, never model text.
      const reason = normalizeProviderError(error).code;
      const detail = selfCheckFailureDiagnostic(error);
      console.warn(
        `generation:selfCheck:${section}: final coverage Self-check failed (${reason}): ${detail}`
      );
      finalCoverage = { ok: false, reason, detail };
    }
  }

  // CAP-13 rule 4 (2026-09-29, second): a used repair whose final text the
  // coverage check finds not covering an idea the writer kept despite a
  // Claim Exclusion, which the first check found covered (left out, or
  // turned into a disclaimer), is not used after all: the checked draft is
  // kept, and the first check's verdicts describe it. With no final verdict
  // to read, its excluded words going count as a drop. A repair that also
  // leaves out an idea the first check found not covered is still used for
  // its other fixes: the checked draft does not cover it either. Review P3-6:
  // a checked draft further over a Locked limit never comes back; the
  // repair is kept and the idea recorded as left out for the limit.
  if (repair.succeeded && finalCoverage) {
    const coverage = finalCoverage;
    const dropped = confirmed.filter((conflict) => {
      const ref = { itemId: conflict.itemId as Id<"summaryItems"> };
      const before = planVerdictFor(planVerdicts, ref);
      const coveredBefore = before?.outcome === "applied" && before.actionableRepair !== false;
      // The accepted rule: only an idea the first check found covered can
      // make the repair not used (re-check P3-2). With no final verdict to
      // read, its excluded words going from the text count as not covered.
      if (!coveredBefore) return false;
      if (!coverage.ok) {
        return confirmedConflictParagraph(text, conflict) !== undefined &&
          confirmedConflictParagraph(finalText, conflict) === undefined;
      }
      const after = planVerdictFor(coverage.verdicts, ref);
      const checkedAfter = after !== undefined && after.actionableRepair !== false;
      return checkedAfter && after.outcome !== "applied";
    });
    if (dropped.length > 0 && overLimitMore(text, finalText)) {
      for (const conflict of dropped) droppedForLimit.add(conflict.itemId);
    } else if (dropped.length > 0) {
      console.warn(`generation:repair:${section}: the repair no longer covers an idea the writer kept despite a Claim Exclusion; the checked draft is kept`);
      finalText = text;
      repair.succeeded = false;
      repair.shortened = undefined;
      repair.notUsedReason = repairDroppedKeptIdeaReason(dropped[0]!);
      keptFit = firstFit;
      after = null;
      finalCoverage = undefined;
    }
  }

  // The question is stored only when it cites a Confidence Map entry of
  // this Brief; the note must not claim a question the Brief never got.
  const evidence =
    storylineQuestion && storylineQuestion.confidenceEntryIndex !== null
      ? brief?.confidenceMap[storylineQuestion.confidenceEntryIndex]
      : undefined;
  const { rows: baseRows, summary: baseSummary } = assembleSectionNotes({
    section,
    before,
    after,
    verdicts,
    modelCheck,
    storylineQuestion: storylineQuestion
      ? { question: storylineQuestion.question, recorded: evidence !== undefined }
      : null,
    ...(storylineQuestionWithheld ? { storylineQuestionWithheld } : {}),
    repair,
    finalText,
    compression: {
      passes: keptFit.passes,
      ...(keptFit.error !== undefined
        ? { failure: normalizeProviderError(keptFit.error).code }
        : {}),
    },
    ...(feedbackTerms.length > 0 ? { governed: feedbackTerms } : {}),
  });
  const rows = [...baseRows];
  let planRows: ComplianceNoteDraft[] = [];
  if (payload.summaryVersionId) {
    planRows = planComplianceNoteDrafts({
      section,
      summaryVersionId: payload.summaryVersionId,
      checks: claim.planChecks,
      verdicts: planVerdicts,
      repairSucceeded: repair.succeeded,
      ...(repair.notUsedReason ? { repairNotUsedReason: repair.notUsedReason } : {}),
      repairShortened: repair.shortened === true,
      coverageCheckSucceeded: modelCheck.ok,
      ...(finalCoverage ? { finalCoverage } : {}),
      confirmed: new Map(confirmed.map((conflict) => [conflict.itemId, {
        exclusions: conflict.exclusions.map((entry) => entry.text),
        words: ideaWords(conflict.wording, 120),
        paragraphIndex: confirmedConflictParagraph(finalText, conflict),
        ...(droppedForLimit.has(conflict.itemId) ? { droppedForLimit: true } : {}),
      }])),
    });
    rows.push(...planRows);
    if (finalCoverage && !finalCoverage.ok) {
      rows.push(finalCoverageFailureNoteDraft(section, finalCoverage.reason, finalCoverage.detail));
    }
    rows.push(...leftOutQuoteNoteDrafts({ section, checks: claim.planChecks }));
  }
  const initialPlanFailures = planVerdicts.filter((verdict) => verdict.outcome !== "applied").length;
  const finalPlanFailures = planRows.filter(
    (row) => row.outcome !== "applied"
  ).length;
  const summary = {
    ...baseSummary,
    failedChecks: baseSummary.failedChecks + initialPlanFailures,
    remainingFailures: baseSummary.remainingFailures + finalPlanFailures,
    ...(finalCoverage && !finalCoverage.ok
      ? { finalCoverageCheckDetail: finalCoverage.detail }
      : {}),
    ...(payload.summaryVersionId
      ? {
          planCoverage: {
            status: modelCheck.ok
              ? finalPlanFailures === 0
                ? "complete" as const
                : "incomplete" as const
              : "unavailable" as const,
            applied: planRows.length - finalPlanFailures,
            total: planRows.length,
          },
        }
      : {}),
  };
  return {
    draftText: finalText,
    metrics: JSON.stringify(sectionMetrics(finalText, key)),
    selfCheck: JSON.stringify(summary),
    notes: rows,
    ...(storylineQuestion && evidence
      ? {
          storylineQuestion: {
            question: storylineQuestion.question,
            sectionClaim: storylineQuestion.sectionClaim,
            storylineAlternative: storylineQuestion.storylineAlternative,
            evidenceEntryId: evidence.entryId,
          },
        }
      : {}),
  };
}

/**
 * One scheduled action per Section of the ordered chain: claim, draft with
 * draftCheckedSection, then the fenced completion that schedules what comes
 * next.
 */
export const generateOrderedSection = internalAction({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    section: sectionNumberValidator,
    // The chain's stored payload (2026-09-25), or the payload itself for a
    // chain scheduled before payloads were stored.
    payload: v.optional(orderedPayloadValidator),
    payloadId: v.optional(v.id("generationArtifacts")),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // The action's deadline bounds every provider request (actionDeadline.ts).
    startActionDeadline(ctx);
    // Model catalog: routing and output budgets read the frozen models.
    await registerGenerationModels(ctx, args.generationId).catch(() => null);
    const payloadRef = forwardOrderedPayload(args);
    const payload = await loadChainPayload(ctx, args);
    if (!payload) {
      await ctx.runMutation(internal.generations.failOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        error: "unknown: Frozen ordered payload is unavailable",
      });
      return null;
    }
    let claim: FunctionReturnType<
      typeof internal.generations.claimOrderedSectionRun
    >;
    try {
      claim = await ctx.runMutation(internal.generations.claimOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        promptVersion: await generationPromptVersion(ctx, args.generationId),
        ...payloadRef,
      });
    } catch (error) {
      // The failed claim mutation rolls back atomically. The owning action is
      // still responsible for terminalizing its live signed-off chain so the
      // immutable Summary can be retried.
      await ctx.runMutation(internal.generations.failOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        error: describeProviderFailure(error),
      });
      return null;
    }
    if (!claim) return null;
    if ("stopped" in claim) {
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeOrderedCandidate, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        ...payloadRef,
      });
      return null;
    }
    const slotCounts: Record<string, number> = {};
    try {
      const clientFor = chainClientFactory(
        ctx,
        {
          model: claim.model,
          projectId: claim.projectId,
          requestedBy: claim.requestedBy,
          generationId: args.generationId,
          candidateRunId: args.candidateRunId,
          freeze: await registerGenerationModels(ctx, args.generationId),
        },
        slotCounts
      );
      const completion = await draftCheckedSection({
        claim,
        payload,
        section: args.section,
        clientFor,
      });
      await ctx.runMutation(internal.generations.completeOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        ...completion,
        slotCounts: JSON.stringify(slotCounts),
        ...payloadRef,
      });
    } catch (error) {
      await ctx.runMutation(internal.generations.failOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        error: describeProviderFailure(error),
        ...payloadRef,
      });
    }
    return null;
  },
});

/**
 * After the last drafted section: one consistency call (when every section
 * was drafted), then QA and chronology as today (skipped for a signed-off
 * seed run, whose QA runs in the background after the report exists), the
 * Tiptap document (with [NOT GENERATED] for sections a stop left undrafted),
 * provenance, and the candidate's completion with its Self-check summary,
 * call budget and production order.
 */
export const finalizeOrderedCandidate = internalAction({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    payload: v.optional(orderedPayloadValidator),
    payloadId: v.optional(v.id("generationArtifacts")),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // The action's deadline bounds every provider request (actionDeadline.ts).
    startActionDeadline(ctx);
    // Model catalog: routing and output budgets read the frozen models.
    await registerGenerationModels(ctx, args.generationId).catch(() => null);
    const complete = (
      fields: Omit<
        Parameters<typeof ctx.runMutation<typeof internal.generations.completeCandidateRun>>[1],
        "candidateRunId"
      >
    ) =>
      ctx.runMutation(internal.generations.completeCandidateRun, {
        candidateRunId: args.candidateRunId,
        ...fields,
      });
    try {
      const [drafts, input, payload] = await Promise.all([
        ctx.runQuery(internal.generations.getOrderedCandidateDrafts, {
          generationId: args.generationId,
          candidateRunId: args.candidateRunId,
        }),
        ctx.runQuery(internal.generations.getGenerationInput, {
          generationId: args.generationId,
        }),
        loadChainPayload(ctx, args),
      ]);
      if (!drafts || !input || !payload || drafts.runStatus !== "running") {
        if (drafts?.runStatus === "running") {
          await complete({ error: "Frozen generation input unavailable" });
        }
        return null;
      }
      const slotCounts: Record<string, number> = {};
      const clientFor = chainClientFactory(
        ctx,
        {
          model: drafts.model,
          projectId: input.projectId,
          requestedBy: input.requestedBy,
          generationId: args.generationId,
          candidateRunId: args.candidateRunId,
          freeze: await registerGenerationModels(ctx, args.generationId),
        },
        slotCounts
      );
      const analysis = parseTranscriptAnalysis(payload.analysis);
      const styleOverrides = normalizeStyleOverrides(payload.styleOverrides);
      const productionOrder = drafts.sections.map((row) => row.section);
      const drafted = drafts.sections.flatMap((row) =>
        row.status === "drafted" && row.draftText !== null
          ? [{ section: row.section, text: row.draftText }]
          : []
      );
      if (drafted.length === 0) throw new Error("No section was drafted");
      const allDrafted = drafted.length === drafts.sections.length;
      const textOf = (section: SectionNumber) =>
        drafted.find((row) => row.section === section)?.text ?? null;

      // One assembled-draft consistency pass, before the last section in
      // production order is released to the writer (AD-24). A stopped chain
      // has no complete draft to check.
      if (allDrafted && drafts.consistencyCheckedAt === null) {
        const last = productionOrder[productionOrder.length - 1];
        let notes: ComplianceNoteDraft[];
        try {
          const pass = await runConsistencyPass(clientFor("generation:consistency"), {
            sections: drafted,
            claimExclusions: drafts.brief?.claimExclusions.map((entry) => entry.text) ?? [],
            glossaryTerms: drafts.brief?.glossaryTerms ?? [],
            model: clientFor.modelFor("generation:consistency"),
            writerPrecedence: drafts.writerPrecedence,
          });
          notes = [
            ...consistencyNoteDrafts(pass.findings),
            consistencySummaryNote(last, {
              ok: true,
              findings: pass.findings.length,
              unreadable: pass.unreadable,
            }),
          ];
        } catch (error) {
          // 2026-09-29 (second): the stored reason names what failed (the
          // validation path and code, or the failure kind), never model text.
          notes = [
            consistencySummaryNote(last, {
              ok: false,
              reason: consistencyFailureReason(normalizeProviderError(error).code, error),
            }),
          ];
        }
        await ctx.runMutation(internal.generations.insertConsistencyNotes, {
          generationId: args.generationId,
          candidateRunId: args.candidateRunId,
          notes,
        });
      }

      const s242 = textOf("242");
      const s244 = textOf("244");
      const s246 = textOf("246");
      const qaDigestIds =
        payload.qaCalibrationDigestId && payload.qaCalibration?.trim()
          ? [payload.qaCalibrationDigestId]
          : undefined;
      // CAP-18: a signed-off seed run never waits on QA. Its report is created
      // as soon as the Sections are drafted and checked; the background
      // post-QA job (ai/postQa:runReportQa, scheduled by settleCandidateRun)
      // runs the scorecard and chronology once, from the same frozen inputs.
      // A stopped seed run schedules no QA at all (FR-43).
      const seedRun = payload.summaryVersionId !== undefined;
      // QA scores a complete draft; a stopped draft skips it rather than be
      // scored on empty sections. Both stay advisory, as in the one-shot path.
      const [qaSettled, chronologySettled] = await Promise.allSettled([
        allDrafted && !seedRun
          ? runQAAgent(
              clientFor("generation:qa", qaDigestIds),
              analysis,
              s242 ?? "",
              s244 ?? "",
              s246 ?? "",
              clientFor.modelFor("generation:qa"),
              payload.qaCalibration,
              styleOverrides,
              detectFirstPersonPreference(payload.writerFlavor)
            )
          : Promise.resolve(null),
        seedRun
          ? Promise.resolve(null)
          : runChronologyAgent(
              clientFor("generation:chronology"),
              analysis,
              clientFor.modelFor("generation:chronology")
            ),
      ]);
      if (qaSettled.status === "rejected") {
        console.error("QA scorecard failed; continuing without it", qaSettled.reason);
      }
      if (chronologySettled.status === "rejected") {
        console.error("Chronology failed; continuing without it", chronologySettled.reason);
      }
      const qa = qaSettled.status === "fulfilled" ? qaSettled.value : null;
      const chronology =
        chronologySettled.status === "fulfilled" ? chronologySettled.value : null;

      const content = JSON.stringify(buildTiptapDocument(input.title, s242, s244, s246));
      const provenanceId = await recordCandidateProvenance(ctx, {
        projectId: input.projectId,
        generationId: args.generationId,
        input,
        content,
        claimDrafts: provenanceDrafts(drafted, input.transcript, analysis.useful_quotes, input.factQuotes),
      });
      const callBudget = summarizeSlotUsage(
        mergeSlotCounts(...drafts.sections.map((row) => parseCounts(row.slotCounts)), slotCounts),
        ORDERED_SLOT_ALLOWANCES
      );
      const stoppedAfterSection = allDrafted
        ? undefined
        : drafted[drafted.length - 1].section;
      const agentOutputs = JSON.stringify({
        analyzer: analysis,
        section242: s242 ?? "",
        section244: s244 ?? "",
        section246: s246 ?? "",
        qa,
        chronology,
        metrics: {
          s242: sectionMetrics(s242 ?? "", "s242"),
          s244: sectionMetrics(s244 ?? "", "s244"),
          s246: sectionMetrics(s246 ?? "", "s246"),
          lengthTarget: input.lengthTarget,
        },
        styleOverrides,
        selfCheck: Object.fromEntries(
          drafts.sections.map((row) => [row.section, parseJsonObject(row.selfCheck)])
        ),
        callBudget,
        productionOrder,
        ...(stoppedAfterSection ? { stoppedAfterSection } : {}),
      });
      await complete({
        content,
        agentOutputs,
        qaScore: qa?.overall_score ?? undefined,
        provenanceId,
        productionOrder,
        ...(stoppedAfterSection ? { stoppedAfterSection } : {}),
      });
    } catch (error) {
      await complete({ error: describeProviderFailure(error) });
    }
    return null;
  },
});

/**
 * "Draft the rest" after Stop (owner decision 20): draft one "Not drafted"
 * Section of a stopped signed-off seed run under exactly the chain's rules
 * (draftCheckedSection), from the same frozen payload. Every write goes
 * through the fenced redraft mutations; the report itself is only written by
 * applySeedRedraft once the attempt's Sections are drafted.
 */
export const redraftSeedSection = internalAction({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    attemptStartedAt: v.number(),
    section: sectionNumberValidator,
    payload: v.optional(orderedPayloadValidator),
    payloadId: v.optional(v.id("generationArtifacts")),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // The action's deadline bounds every provider request (actionDeadline.ts).
    startActionDeadline(ctx);
    // Model catalog: routing and output budgets read the frozen models.
    await registerGenerationModels(ctx, args.generationId).catch(() => null);
    const payloadRef = forwardOrderedPayload(args);
    const fail = async (error: unknown) => {
      await ctx.runMutation(internal.generations.failRedraftSection, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        attemptStartedAt: args.attemptStartedAt,
        section: args.section,
        error: describeProviderFailure(error),
      });
    };
    const payload = await loadChainPayload(ctx, args);
    if (!payload) {
      await fail(new Error("Frozen ordered payload is unavailable"));
      return null;
    }
    let claim: SectionClaim | null;
    try {
      claim = await ctx.runMutation(internal.generations.claimRedraftSection, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        attemptStartedAt: args.attemptStartedAt,
        section: args.section,
        promptVersion: await generationPromptVersion(ctx, args.generationId),
        ...payloadRef,
      });
    } catch (error) {
      await fail(error);
      return null;
    }
    if (!claim) return null;
    const slotCounts: Record<string, number> = {};
    try {
      const clientFor = chainClientFactory(
        ctx,
        {
          model: claim.model,
          projectId: claim.projectId,
          requestedBy: claim.requestedBy,
          generationId: args.generationId,
          candidateRunId: args.candidateRunId,
          freeze: await registerGenerationModels(ctx, args.generationId),
        },
        slotCounts
      );
      const completion = await draftCheckedSection({
        claim,
        payload,
        section: args.section,
        clientFor,
      });
      await ctx.runMutation(internal.generations.completeRedraftSection, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        attemptStartedAt: args.attemptStartedAt,
        section: args.section,
        ...completion,
        slotCounts: JSON.stringify(slotCounts),
        ...payloadRef,
      });
    } catch (error) {
      await fail(error);
    }
    return null;
  },
});

/** How many times the redraft finalizer reruns its consistency pass when the
 * report changed while the pass ran, before it stores no findings at all. */
const REDRAFT_CONSISTENCY_RERUNS = 2;

/**
 * After the redraft's last Section: when the report now has all three
 * Sections, one consistency pass over them (the writer's current text for
 * the Sections they kept, the redrafted text for the rest); then the fenced
 * write into the report. QA follows in the background (CAP-18).
 *
 * The write re-checks that the report still produces the text the pass read.
 * When the writer (or another client) saved in between, the findings would
 * describe prose that is gone, so the pass reruns on the new text, up to
 * REDRAFT_CONSISTENCY_RERUNS times. If the report is still changing after
 * that, no findings are stored: the Sections are written with one note that
 * the pass was skipped because the report changed.
 */
export const finalizeSeedRedraft = internalAction({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    attemptStartedAt: v.number(),
    /** Consistency passes already rerun because the report changed. */
    pass: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { pass = 0, ...args }): Promise<null> => {
    // The action's deadline bounds every provider request (actionDeadline.ts).
    startActionDeadline(ctx);
    // Model catalog: routing and output budgets read the frozen models.
    await registerGenerationModels(ctx, args.generationId).catch(() => null);
    // One consistency pass per action: a rerun is scheduled as a fresh
    // action, so reruns never add up past the action time limit.
    {
      const input = await ctx.runQuery(internal.generations.getSeedRedraftInput, args);
      if (!input) return null;
      const present = input.sections.flatMap((row) =>
        row.text !== null ? [{ section: row.section, text: row.text }] : []
      );
      if (present.length !== input.sections.length || present.length === 0) {
        // The report stays incomplete: no pass, just the write.
        await ctx.runMutation(internal.generations.applySeedRedraft, { ...args, notes: [] });
        return null;
      }
      const last = input.sections[input.sections.length - 1].section;
      if (pass > REDRAFT_CONSISTENCY_RERUNS) {
        await ctx.runMutation(internal.generations.applySeedRedraft, {
          ...args,
          notes: [consistencySummaryNote(last, { ok: false, reportChanged: true })],
        });
        return null;
      }
      // The seed request policy (no hidden transport retry, a short request
      // timeout) keeps one pass, including its structured repair, well
      // inside a single action's time limit.
      let notes: ComplianceNoteDraft[];
      try {
        // Owner decision 43: the frozen checking model runs the pass.
        const route = resolveGenerationStep({
          freeze: await registerGenerationModels(ctx, args.generationId),
          step: "consistency",
          writerModel: input.model,
        });
        const consistencyClient = clientForStep(
          ctx,
          route,
          {
            callSite: "generation:consistency",
            projectId: input.projectId,
            ...(input.requestedBy ? { userId: input.requestedBy } : {}),
            attribution: { generationId: args.generationId, candidateRunId: args.candidateRunId },
          },
          { seedPolicy: true }
        );
        const pass = await runConsistencyPass(consistencyClient, {
          sections: present,
          claimExclusions: input.brief?.claimExclusions.map((entry) => entry.text) ?? [],
          glossaryTerms: input.brief?.glossaryTerms ?? [],
          model: route.model,
          writerPrecedence: input.writerPrecedence,
        });
        notes = [
          ...consistencyNoteDrafts(pass.findings),
          consistencySummaryNote(last, {
            ok: true,
            findings: pass.findings.length,
            unreadable: pass.unreadable,
          }),
        ];
      } catch (error) {
        notes = [
          consistencySummaryNote(last, {
            ok: false,
            reason: consistencyFailureReason(normalizeProviderError(error).code, error),
          }),
        ];
      }
      const outcome = await ctx.runMutation(internal.generations.applySeedRedraft, {
        ...args,
        notes,
        checked: input.sections,
      });
      if (outcome === "report_changed") {
        await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeSeedRedraft, {
          ...args,
          pass: pass + 1,
        });
      }
      return null;
    }
  },
});
