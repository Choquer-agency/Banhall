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
  closerToLimits,
  compressWithinLimit,
  meetsWriterCap,
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
  runModelSelfCheck,
  selfCheckFailureDiagnostic,
  sourceFactsFor,
  type ModelSelfCheckResult,
  type SelfCheckModelInput,
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
import { detectFirstPersonPreference, sourceTalkSubject } from "../../shared/humanProse";
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
  lineDraftWordTarget,
  writerCapText,
  writerLineCap,
  type WriterLineCap,
} from "../lib/writerLineCap";
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
  glossaryTermOf,
  REPAIR_LEFT_CHECKED_TEXT,
  repairIssues,
  runDeterministicSelfCheck,
  SOURCE_TALK_KEY,
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
import {
  FACTS_MATCH_SOURCES_RULE_ID,
  type FactsSourceDocuments,
  MAX_DROPPED_UNCERTAINTY_CHECKS,
  sameSummaryPlanRef,
  type FrozenSummaryPlanInstruction,
  type SummaryPlanRuleId,
} from "../lib/seedRevisions";
import { sectionParagraphs } from "../lib/tiptapReport";
import { neutralizeMarkers } from "./trustedContext";
import { droppedUncertaintyFigures, figuresOf, LEAVE_OUT_FIGURE_NOTE_PREFIX } from "../../shared/planFigures";
import { isNearCopy } from "../lib/droppedUncertainties";
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
  writerDecisions = false,
  /**
   * 2026-09-30 (second): a Glossary Term the writer's Feedback governs is
   * used by an unedited signed-off idea of the Line.
   */
  governedInIdea = false
): string {
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.repairGuidance;
  const terms =
    editedTerms.length > 0
      ? `${scaffold.exactTermsPrefix}${quotedTerms(editedTerms)}${scaffold.exactTermsSuffix}`
      : "";
  // Round 2 re-check (P2): an issue can carry model-written words (a facts
  // finding's quotes and correction, a check's guidance), so none can open
  // or close a block. Bytes are unchanged unless an issue holds a marker.
  return `${scaffold.prefix}${issues
    .map((issue) => `${scaffold.issuePrefix}${neutralizeMarkers(issue)}`)
    .join(scaffold.issueSeparator)}${terms}${writerDecisions ? scaffold.writerDecisions : ""}${
    governedInIdea ? scaffold.governedRename : ""
  }${scaffold.draftPrefix}${draft}`;
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
  // 2026-09-30 (second): a governed term an unedited signed-off idea uses is
  // renamed there as the Feedback asks; the intro says renaming is not
  // rewording. Every other Line keeps its bytes.
  const renaming = governedTerms.some((entry) => entry.inSignedOffIdea === true);
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
    ? `${renaming ? scaffold.feedbackIntroRenaming : scaffold.feedbackIntro}${scaffold.feedbackBegin}${args.feedback
        .map((entry) =>
          `${scaffold.feedbackPrefix}${stepTitle(entry.roleId)}${scaffold.feedbackMiddle}${quoteForPrompt(entry.instruction)}`)
        .join("")}${scaffold.feedbackEnd}`
    : "";
  const governed = governedTerms.length > 0
    ? `${scaffold.governedIntro}${governedTerms
        .map((entry) =>
          `${scaffold.governedPrefix}${quoteForPrompt(entry.term)}${scaffold.governedMiddle}${governingFeedbackPhrase(entry.feedback)}${
            entry.inSignedOffIdea ? scaffold.governedInIdea : ""
          }`)
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

/**
 * 2026-09-30 (first, review P2-2): why a repair made for a LEAVE OUT or Line
 * 246's advancement check was not used: its final text no longer covers a
 * signed-off item the checked draft covered.
 */
export function repairDroppedCoverItemReason(item: Pick<PlanCheck, "wording">): string {
  // 2026-10-04 (first and second): neutral, since a targets, facts or
  // writer's cap fix is set aside the same way as a leave-out fix.
  return `the repaired text no longer covers the signed-off item "${ideaWords(item.wording, 120)}", and a repair must keep what a COVER item holds, so the checked draft was kept`;
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
export function planLengthBudgetBlock(
  section: SectionKey,
  target: LengthTarget,
  /**
   * 2026-10-04 (first): the writer's whole-Line cap below the Locked cap.
   * The block then states the Locked cap, the writer's cap as the writer's
   * settings, and the target under it. Null or absent: as before.
   */
  writerCap: WriterLineCap | null = null
): string {
  if (writerCap) {
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.planLengthBudgetWriterCap;
    return `${scaffold.prefix}${WORD_CAPS[section]}${scaffold.wordCapToLines}${LINE_LIMITS[section]}${scaffold.linesToWriterCap}${writerCapText(writerCap)}${scaffold.writerCapToBudget}${lineDraftWordTarget(section, target, writerCap)}${scaffold.suffix}`;
  }
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.planLengthBudget;
  return `${scaffold.prefix}${WORD_CAPS[section]}${scaffold.wordCapToLines}${LINE_LIMITS[section]}${scaffold.linesToBudget}${draftWordTarget(section, target)}${scaffold.suffix}`;
}

/**
 * 2026-10-04 (first, review P3-1): why a repair made only to shorten was not
 * used (Compliance Note wording).
 */
export function repairOverWriterCapReason(words: number, lines: number, writerCap: WriterLineCap): string {
  return `the repaired text came out at ${words} words, ${lines} lines, further over the writer's cap of ${writerCapText(writerCap)} than the checked draft, so the checked draft was kept`;
}

/** Why a repair that broke a Locked limit was not used (Compliance Note wording). */
export function repairOverLimitReason(section: SectionNumber, words: number, lines: number): string {
  const key = sectionKeyOf(section);
  return `the repaired text came out at ${words}/${WORD_CAPS[key]} words, ${lines}/${LINE_LIMITS[key]} lines, further from the Line ${section} limit than the checked draft, so the checked draft was kept`;
}

type PlanCheck = {
  itemId?: Id<"summaryItems">;
  skippedRoleId?: PdSubsectionRoleId;
  /** 2026-09-30 (first): a dropped uncertainty this Line leaves out. */
  droppedSeedId?: Id<"seeds">;
  /** 2026-09-30 (first): Line 246's advancement check. */
  ruleId?: SummaryPlanRuleId;
  roleId: PdSubsectionRoleId;
  mergedItemIds: Id<"summaryItems">[];
  instruction: FrozenSummaryPlanInstruction;
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
  check: Pick<PlanCheck, "itemId" | "skippedRoleId" | "droppedSeedId" | "ruleId">
): PlanVerdicts[number] | undefined {
  return verdicts.find((verdict) => sameSummaryPlanRef(check, verdict));
}

/**
 * 2026-09-30 (third): the report-text rules of shared/humanProse.ts (results
 * against targets, no talk about sources) and how they bear on the Brief,
 * read right after the Brief in a signed-off plan run's drafting request and
 * its repair. Single draft and Compare requests never carry it.
 */
export function reportFactsBlock(): string {
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.reportFacts;
  return `${scaffold.prefix}${scaffold.rules}${scaffold.brief}`;
}

/**
 * 2026-09-30 (third): the fixed start of a signed-off plan run's repair fix
 * for a Confidence Map or Storyline verdict (hedge without naming a source)
 * and for a Glossary verdict (replace the other name, never force the term
 * in). Every other verdict's fix is sent as before.
 */
export function reportFactsIssuePrefix(verdict: ModelVerdict, glossaryCandidates: string[]): string {
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.repairGuidance;
  if (verdict.check === "confidence" || verdict.check === "storyline") return scaffold.hedgeIssue;
  if (verdict.check === "glossary") {
    return `${scaffold.glossaryIssuePrefix}${quoteForPrompt(glossaryTermOf(verdict, glossaryCandidates))}${scaffold.glossaryIssueSuffix}`;
  }
  return "";
}

/** 2026-09-30 (third): the Compliance Note instruction for the targets check. */
export const TARGETS_INSTRUCTION =
  "State each result against its target as the numbers show";

/**
 * 2026-10-04 (second, round 2): how a facts row says the source documents
 * were over the check's budget, so it read the quotes and the analysis.
 */
export function factsDocumentsLeftOutNote(documents: FactsSourceDocuments): string {
  if (documents.leftOut.length === 0) {
    return "(No source document was frozen for this check, so it read the signed-off items' quotes and the analysis.)";
  }
  // Round 2 review, P2-4: each document left out is named.
  return `(Over this check's ${documents.budget}-byte budget it did not read ${documents.leftOut
    .map((document) => `${document.label} (${document.bytes} bytes)`)
    .join(", ")}, so it let the signed-off items, their quotes and the analysis stand for them.)`;
}

/** 2026-10-04 (second): the Compliance Note instruction for the facts check. */
export const FACTS_INSTRUCTION =
  "State figures and details as the sources give them";

/**
 * 2026-10-04 (second): how a facts row that a used repair fixed says what was
 * wrong: the final text's verdict, then what the first check found.
 */
export function factsRepairedReason(finalReason: string, firstReason: string): string {
  const found = firstReason.trim();
  return found ? `${finalReason.trim()} Fixed by the repair: ${found}` : finalReason.trim();
}

/**
 * 2026-09-30 (first): the Compliance Note instruction for a LEAVE OUT row,
 * naming the dropped uncertainty by its first words, never an id.
 */
export function leaveOutInstruction(wording: readonly string[]): string {
  return `Leave out the uncertainty the writer dropped: "${ideaWords(wording, 100)}"`;
}

/** 2026-09-30 (first): the Compliance Note instruction for Line 246's advancement check. */
export const ANSWERS_242_INSTRUCTION =
  "Claim an advancement only for an uncertainty Line 242 states";

/** 2026-09-30 (second, Rule C): the Compliance Note instruction for Line 244's work check. */
export const WORK_ANSWERS_242_INSTRUCTION =
  "Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs";

/** How a plan check reads as a Compliance Note instruction. */
function planInstruction(expected: PlanCheck): string {
  switch (expected.instruction) {
    case "skip":
      return `Omit signed-off role ${expected.skippedRoleId}`;
    case "leave_out":
      return leaveOutInstruction(expected.wording);
    case "answer_242":
      return ANSWERS_242_INSTRUCTION;
    case "work_answer_242":
      return WORK_ANSWERS_242_INSTRUCTION;
    case "match_targets":
      return TARGETS_INSTRUCTION;
    case "match_sources":
      return FACTS_INSTRUCTION;
    default:
      return `Cover signed-off Summary item ${expected.itemId}`;
  }
}

/**
 * 2026-09-30 (first): the Compliance Note rows for the dropped uncertainties
 * beyond the cap, which no Line checks. Each counts as a plan row that is
 * not applied, so plan coverage never reads complete while one is unchecked.
 */
export function droppedNotCheckedNoteDrafts(args: {
  section: SectionNumber;
  summaryVersionId: Id<"summaryVersions">;
  dropped: ReadonlyArray<{ seedId: Id<"seeds">; wording: readonly string[] }>;
}): ComplianceNoteDraft[] {
  return args.dropped.map((entry) => noteDraft({
    section: args.section,
    source: "deterministic",
    instruction: leaveOutInstruction(entry.wording),
    outcome: "not_applied",
    tier: "none",
    reason: `Not checked: the writer dropped more than ${MAX_DROPPED_UNCERTAINTY_CHECKS} uncertainties, and only the first ${MAX_DROPPED_UNCERTAINTY_CHECKS} are left out and checked. Confirm this Line does not state this one, describe work that tested it or claim its results.`,
    planRef: {
      summaryVersionId: args.summaryVersionId,
      droppedSeedId: entry.seedId,
      mergedItemIds: [],
    },
  }));
}

/**
 * 2026-09-30 (first): the repair issue for a LEAVE OUT check or Line 246's
 * advancement check the Self-check found broken: a fixed start naming what
 * to leave out, then the check's own guidance. Since (second) Line 244's
 * work check too (Rule C).
 */
export function leaveOutRepairIssue(
  check: Pick<PlanCheck, "instruction" | "wording">,
  verdict: { paragraphIndex?: number },
  guidance: string
): string {
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.repairGuidance;
  // 2026-10-04 (second): a facts fix is for the whole section, since its
  // guidance names every figure and detail to correct, in any paragraph.
  const where = verdict.paragraphIndex === undefined || check.instruction === "match_sources"
    ? scaffold.wholeSection
    : `${scaffold.paragraphPrefix}${verdict.paragraphIndex + 1}${scaffold.paragraphSuffix}`;
  const fix = check.instruction === "match_sources"
    ? scaffold.factsIssue
    : check.instruction === "leave_out"
    ? `${scaffold.leaveOutPrefix}${quoteForPrompt(ideaWords(check.wording, 200))}${scaffold.leaveOutSuffix}`
    : check.instruction === "work_answer_242"
      ? scaffold.workAnswers242Issue
      : check.instruction === "match_targets"
        ? scaffold.targetsIssue
        : scaffold.answers242Issue;
  return `${where}${fix}${guidance}`;
}

/** The plan checks whose fix leaves content out, repaired with a fixed start. */
function leavesContentOut(instruction: FrozenSummaryPlanInstruction | undefined): boolean {
  return instruction === "leave_out" || instruction === "answer_242" || instruction === "work_answer_242";
}

/** How many of the dropped uncertainty's own figures a figure note names. */
const MAX_NOTE_FIGURES_NAMED = 6;

/** The sentences of a text, split after a full stop, question or exclamation mark. */
function sentencesOf(text: string): string[] {
  return sectionParagraphs(text).flatMap((paragraph) =>
    paragraph.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean));
}

/** How a LEAVE OUT row's figure note begins, so a reviewer and the release suite find it. */
export { LEAVE_OUT_FIGURE_NOTE_PREFIX };

/**
 * 2026-09-30 (second): the figure note for LEAVE OUT verdicts. Release suite
 * run 11 recorded Line 244's LEAVE OUT row not applied ("P3 states stall
 * durations (19 vs 6 days), close to dropped...") for signed-off experiment
 * item 9. Greptile round (lead decision): the note never changes a verdict.
 * A Line can restate a dropped uncertainty in other words without its
 * figures, so a not applied verdict stays not applied and goes to the repair
 * as before; the COVER rollback protects signed-off content. When all of
 * these hold, its row says the cited figures belong to a signed-off item,
 * naming it, so a reviewer can check quickly: the verdict names a valid
 * paragraph; the dropped uncertainty has figures of its own
 * (droppedUncertaintyFigures, the release suite's rule too); no paragraph of
 * the Line holds one of them; no sentence of the Line is a near copy of the
 * dropped wording; and the verdict's reason, guidance and unclipped text
 * together cite at least one figure, every one in a signed-off item's
 * wording. Returns the note, or null.
 */
export function leaveOutFigureNote(args: {
  check: {
    instruction: FrozenSummaryPlanInstruction;
    droppedSeedId?: string;
    wording: readonly string[];
    relationshipReferences: ReadonlyArray<{ wording: readonly string[] }>;
  };
  verdict: PlanVerdicts[number];
  text: string;
  /** The wording of every signed-off item of the plan, skipped steps aside. */
  planWording: ReadonlyArray<readonly string[]>;
}): string | null {
  const { check, verdict } = args;
  if (check.instruction !== "leave_out" || check.droppedSeedId === undefined) return null;
  if (verdict.outcome !== "not_applied" || verdict.actionableRepair === false) return null;
  if (verdict.paragraphIndex === undefined) return null;
  const paragraphs = sectionParagraphs(args.text);
  if (paragraphs[verdict.paragraphIndex] === undefined) return null;
  const dropped = droppedUncertaintyFigures({
    wording: check.wording,
    references: check.relationshipReferences,
    planWording: args.planWording,
  });
  if (dropped.length === 0) return null;
  // Review P2-5 (a): no paragraph of the Line, not only the flagged one.
  const inLine = new Set(paragraphs.flatMap(figuresOf));
  if (dropped.some((figure) => inLine.has(figure))) return null;
  // Review P2-5 (d): a sentence restating the dropped uncertainty.
  const sentences = sentencesOf(args.text);
  const nearCopy = [check.wording, ...check.wording.map((bullet) => [bullet])].some((wording) =>
    sentences.some((sentence) => isNearCopy(wording, [sentence])));
  if (nearCopy) return null;
  // Review P2-5 (b): what the verdict cites, not only its clipped reason.
  const cited = [...new Set(
    [verdict.reason, verdict.repairGuidance ?? "", verdict.repairText ?? ""].flatMap(figuresOf)
  )];
  if (cited.length === 0) return null;
  const itemFigures = args.planWording.map((wording) => new Set(figuresOf(wording.join(" "))));
  if (!cited.every((figure) => itemFigures.some((figures) => figures.has(figure)))) return null;
  const named = dropped.slice(0, MAX_NOTE_FIGURES_NAMED).join(", ");
  const rest = `no paragraph of this Line holds one of the dropped uncertainty's own figures (${named}${dropped.length > MAX_NOTE_FIGURES_NAMED ? ", ..." : ""}) or restates it`;
  // One signed-off item that holds every cited figure is named alone.
  const whole = itemFigures.findIndex((figures) => cited.every((figure) => figures.has(figure)));
  if (whole >= 0) {
    return `${LEAVE_OUT_FIGURE_NOTE_PREFIX}every figure it cites (${cited.join(", ")}) is in the signed-off item "${ideaWords(args.planWording[whole]!, 120)}", and ${rest}: check whether the flagged content is that item]`;
  }
  // Greptile round 2: otherwise each item that holds a cited figure is named
  // with the cited figures it holds, in the order first cited.
  const holders: Array<{ index: number; figures: string[] }> = [];
  for (const figure of cited) {
    const index = itemFigures.findIndex((figures) => figures.has(figure));
    const known = holders.find((holder) => holder.index === index);
    if (known) known.figures.push(figure);
    else holders.push({ index, figures: [figure] });
  }
  const listed = holders
    .map((holder) => `${holder.figures.join(", ")} in "${ideaWords(args.planWording[holder.index]!, 120)}"`)
    .join("; ");
  return `${LEAVE_OUT_FIGURE_NOTE_PREFIX}every figure it cites is in a signed-off item (${listed}), and ${rest}: check whether the flagged content is one of those items]`;
}

/**
 * Review P2-1: the first figure of a signed-off item (any Line) that the
 * checked draft holds and the repaired text does not, or undefined. A Rule C
 * repair that loses one may have cut the work a signed-off item needs as its
 * evidence. Greptile round (lead decision): presence, not count, so a repair
 * that rightly cuts a Brief-only experiment repeating a plan figure that
 * stays elsewhere is used, and so is one that only merges paragraphs.
 */
export function lostPlanFigure(
  checked: string,
  repaired: string,
  planWording: ReadonlyArray<readonly string[]>
): { figure: string } | undefined {
  const planFigures = new Set(planWording.flatMap((wording) => figuresOf(wording.join(" "))));
  const kept = new Set(figuresOf(repaired));
  const figure = figuresOf(checked).find((candidate) => planFigures.has(candidate) && !kept.has(candidate));
  return figure === undefined ? undefined : { figure };
}

/** Review P2-1: why a Rule C repair that lost a signed-off figure was not used. */
export function repairLostPlanFigureReason(lost: { figure: string }): string {
  // 2026-10-04 (second, review round 1, P3-2): neutral, since a facts fix is
  // set aside the same way as a Rule C fix.
  return `the repaired text no longer holds the signed-off figure "${lost.figure}", which the checked draft held, and a repair must keep every figure a signed-off item gives, so the checked draft was kept`;
}

/** Every LEAVE OUT verdict with its figure note, where one applies; no verdict changes. */
function withLeaveOutFigureNotes(
  verdicts: PlanVerdicts,
  checks: readonly PlanCheck[],
  text: string,
  planWording: ReadonlyArray<readonly string[]>,
  label: string
): PlanVerdicts {
  let noted = 0;
  const out = verdicts.map((verdict) => {
    const check = checks.find((candidate) => sameSummaryPlanRef(verdict, candidate));
    const note = check ? leaveOutFigureNote({ check, verdict, text, planWording }) : null;
    if (!note) return verdict;
    noted += 1;
    return { ...verdict, figureNote: note };
  });
  if (noted > 0) {
    console.warn(`${label}: ${noted} LEAVE OUT verdict(s) cite only signed-off figures; noted on the row and still sent to the repair`);
  }
  return out;
}

/** A plan verdict's reason as its row records it, with its figure note. */
function rowReason(verdict: { reason: string; figureNote?: string }): string {
  return verdict.figureNote ? `${verdict.reason} ${verdict.figureNote}` : verdict.reason;
}

/**
 * 2026-09-30 (first, Rule B): Line 246's drafting instruction in a signed-off
 * plan run, read after the WRITER'S DECISIONS. Empty for every other Line and
 * every run without a signed-off plan, so those requests are unchanged.
 */
export function advancementsAnswer242Block(
  answers242:
    | null
    | undefined
    | { line242Drafted: true }
    | { line242Drafted: false; items: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }> }
): string {
  if (!answers242) return "";
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.advancementsAnswer242;
  if (answers242.line242Drafted) return `${scaffold.heading}${scaffold.drafted}${scaffold.rest}`;
  // Review P3-1: every signed-off Line 242 item, by step, quoted on one line.
  const listed = answers242.items.length > 0
    ? answers242.items
        .map((item) => `${scaffold.itemPrefix}${stepTitle(item.roleId)}${scaffold.itemMiddle}${quoteForPrompt(item.wording.join(" "))}`)
        .join("")
    : scaffold.none;
  return `${scaffold.heading}${scaffold.planned}${scaffold.rest}${listed}`;
}

/**
 * 2026-09-30 (second, Rule C): Line 244's drafting instruction in a
 * signed-off plan run, read after the WRITER'S DECISIONS: its work is for an
 * uncertainty Line 242 states, or is the evidence a signed-off item needs
 * (review P2-2: an area the work plan names keeps no Brief experiment). The
 * signed-off Line 246 items follow it by step (and, before Line
 * 242 is drafted, Line 242's). Empty for every other Line and every run
 * without a signed-off plan.
 */
export function workAnswers242Block(
  workAnswers242:
    | null
    | undefined
    | {
        line242Drafted: true;
        line246Items: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }>;
      }
    | {
        line242Drafted: false;
        items: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }>;
        line246Items: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }>;
      }
): string {
  if (!workAnswers242) return "";
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.workAnswers242;
  const listed = (items: ReadonlyArray<{ roleId: PdSubsectionRoleId; wording: readonly string[] }>) =>
    items.length > 0
      ? items
          .map((item) => `${scaffold.itemPrefix}${stepTitle(item.roleId)}${scaffold.itemMiddle}${quoteForPrompt(item.wording.join(" "))}`)
          .join("")
      : scaffold.none;
  const line246 = `${scaffold.line246Heading}${listed(workAnswers242.line246Items)}`;
  if (workAnswers242.line242Drafted) return `${scaffold.heading}${scaffold.drafted}${scaffold.rest}${line246}`;
  return `${scaffold.heading}${scaffold.planned}${scaffold.rest}${scaffold.line242Heading}${listed(workAnswers242.items)}${line246}`;
}

/**
 * Convert the Self-check response into one AD-37 row per item/Skip. When an
 * accepted repair changed the checked text, `finalCoverage` carries the
 * plan verdicts of the Self-check of the final text (2026-09-28, third; the
 * full Self-check since 2026-10-05, Round 2, follow-up), and the
 * rows record its verdicts: a row is marked repaired only when the first
 * check sent it to the repair and the final check found it applied.
 */
export function planComplianceNoteDrafts(args: {
  section: SectionNumber;
  summaryVersionId: Id<"summaryVersions">;
  checks: PlanCheck[];
  verdicts: PlanVerdicts;
  repairSucceeded?: boolean;
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
    const expected = args.checks.find((check) => sameSummaryPlanRef(verdict, check));
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
      ...(expected.droppedSeedId ? { droppedSeedId: expected.droppedSeedId } : {}),
      ...(expected.ruleId ? { ruleId: expected.ruleId } : {}),
      mergedItemIds: expected.mergedItemIds,
    };
    const instruction = planInstruction(expected);
    if (conflict) {
      // CAP-13 rule 4 (2026-09-29, second): the idea is drafted and kept,
      // and its row says so from the verdict that describes the final text
      // (the check of the final text after a used repair, else the first
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
      const repaired = sentToRepair && final?.outcome === "applied";
      return [noteDraft({
        section: args.section,
        ...(final?.paragraphIndex === undefined ? {} : { paragraphIndex: final.paragraphIndex }),
        source: "model",
        instruction,
        outcome: final?.outcome ?? "not_applied",
        tier: "none",
        // 2026-10-04 (second): a facts row a repair fixed still says what was
        // wrong, so a reviewer can check the correction.
        reason: final
          ? repaired && expected.instruction === "match_sources"
            ? factsRepairedReason(rowReason(final), verdict.reason)
            : rowReason(final)
          : FINAL_COVERAGE_NOT_CHECKED_REASON,
        repaired,
        planRef,
      })];
    }
    // 2026-10-05 (Round 2 follow-up, review P2): every used repair that
    // changed the checked text has a check of the final text above, so a
    // used repair without one left the checked text byte for byte (it came
    // back unchanged, or shortening turned it back): the first verdict
    // describes the final text and nothing was repaired.
    const unchanged = sentToRepair;
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
      reason: unchanged
        ? `${rowReason(verdict)}${REPAIR_LEFT_CHECKED_TEXT}`
        : `${rowReason(verdict)}${repairNotUsed}`,
      repaired: false,
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
 * Self-check of the final text 2 (its answer and one more request: when a
 * used repair changed the text, the full check with its labels, and in
 * Summary mode its plan checks, and its follow-up or structured retry;
 * 2026-09-28 third, 2026-10-04 first, round 2, and its 2026-10-05
 * follow-up) = 12 sequential calls (providers.ts
 * ORDERED_SECTION_ACTION_SLOTS);
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
  // 2026-09-30 (first, Rule B): Line 246 of a signed-off plan run claims an
  // advancement only for an uncertainty Line 242 states. (second, Rule C):
  // Line 244 describes work only for one, or for a signed-off item. Empty
  // otherwise.
  const answers242 = section === "246"
    ? advancementsAnswer242Block(claim.answers242)
    : section === "244"
      ? workAnswers242Block(claim.workAnswers242)
      : "";
  // 2026-09-30 (second): the wording of every signed-off item, for the LEAVE
  // OUT figure backstop. Claims loaded before carry none: the Line's own
  // COVER items stand in.
  const planWording: ReadonlyArray<readonly string[]> = claim.planWording ??
    claim.planChecks.filter((planCheck) => planCheck.instruction === "cover").map((planCheck) => planCheck.wording);
  // 2026-09-30 (third): a signed-off plan run's report-text rules, right
  // after the Brief. Single draft and Compare requests are unchanged.
  const planRun = Boolean(claim.planBlock);
  const reportFacts = planRun ? reportFactsBlock() : "";
  // Review P3-6: the checked text is over a Locked limit and further over
  // it than the other text, which must never be traded back for it.
  const overLimitMore = (checked: string, other: string) =>
    sectionMetrics(checked, key).overLimit && limitOverage(checked, key) > limitOverage(other, key);
  // 2026-10-04 (first): the writer's whole-Line cap below the Locked cap
  // (null without one). The draft, its repair and every shortening pass aim
  // under it; the Self-check measures the same rules (writerLineCap.ts).
  const writerCap = writerLineCap(section, payload.orderedContext.selfCheckRules);
  const draftWith = async (callSite: string, extraGuidance = "") =>
    scrubBannedWordsUnlessWaived(
      await agent(
        clientFor(callSite, styleDigestIds),
        analysis,
        claim.model,
        payload.brainExemplars[key],
        // 2026-09-28 (second, full suite): drafts and repairs aim well under
        // the cap; since 2026-10-04 (first), under the writer's cap too.
        lengthBudgetBlock(key, lengthTarget, lineDraftWordTarget(key, lengthTarget, writerCap), writerCap),
        styleGuidance + extraGuidance,
        styleOverrides,
        // A signed-off plan run restates the Locked length last, after the
        // plan and the Brief (review P3-5).
        claim.planBlock
          ? claim.briefBlock + reportFacts + decisions + answers242 + editedTermsBlock(claim.editedTerms) + planLengthBudgetBlock(key, lengthTarget, writerCap)
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
    { finalCut: true, writerCap, coverItems }
  );
  if (firstFit.error !== undefined) {
    // 2026-10-04 (first, review P2-3): only a draft over a Locked limit
    // fails the Section when no pass was kept. A draft within the Locked
    // caps, shortened only for the writer's cap, is kept as drafted and the
    // failure is recorded on the cap row (compression.failure).
    if (firstFit.text === text && sectionMetrics(text, key).overLimit) throw firstFit.error;
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
      // 2026-09-30 (third): no talk about sources, signed-off plan runs only.
      // The project's subject is every signed-off item's wording across all
      // Lines (review P2-4), the Glossary Terms and the edited terms.
      ...(planRun
        ? {
            sourceTalk: {
              subjectText: sourceTalkSubject({
                planWording,
                glossaryTerms: brief?.glossaryTerms ?? [],
                editedTerms: claim.editedTerms,
              }),
            },
          }
        : {}),
    });
  const before = check(text);
  // 2026-10-04 (first): every cap rule of the writer's code measures on this
  // Line (whole-Line or paragraph, clipped to the Locked cap or not).
  const writerCapRules = before.entries.flatMap((entry) =>
    entry.measuredCap?.kind === "writer" && entry.measuredCap.instruction ? [entry.measuredCap.instruction] : []
  );
  // 2026-10-04 (second): the sources the draft is written from (the analysis,
  // the Brief's Storyline and Confidence Map, and since review round 1, P2-1,
  // every Line's signed-off items and the writer's instructions), for the
  // facts check of a signed-off plan. Only a Line whose plan holds that check
  // sends them, to the first Self-check and the check of the final text alike.
  // Round 2 (owner approved 2026-10-05): the source documents first, when
  // they fit their budget, and each signed-off item marked as the writer's or
  // the product's wording, with its own quotes. Claims loaded before carry
  // neither: the plan's wording stands in, with no documents.
  const sourceFacts = claim.planChecks.some((planCheck) => planCheck.instruction === "match_sources")
    ? sourceFactsFor({
        analysis,
        storylineText: brief?.storylineText ?? "",
        // Round 2 review, P2-3: the writer's Storyline is the writer's wording.
        ...(brief?.storylineByWriter ? { storylineByWriter: true } : {}),
        confidenceMap: brief?.confidenceMap ?? [],
        planItems: claim.planItemSources ?? planWording.map((wording) => ({ wording })),
        ...(claim.factsSourceDocuments ? { documents: claim.factsSourceDocuments } : {}),
        writerInstructions: [
          ...(payload.writerFlavor?.trim() ? [payload.writerFlavor] : []),
          ...before.modelRules.map((rule) => rule.instruction),
        ],
      })
    : undefined;

  let verdicts: ModelVerdict[] = [];
  let storylineQuestion: ModelSelfCheckResult["storylineQuestion"] = null;
  let storylineQuestionWithheld: string | undefined;
  let planVerdicts: ModelSelfCheckResult["planVerdicts"] = [];
  let modelCheck: { ok: true } | { ok: false; reason: string; detail?: string } = { ok: true };
  // The first Self-check's input; round 2 (2026-10-05) checks the final
  // text with the same input when shortening changed a used repair.
  const selfCheckInput: SelfCheckModelInput = {
    section,
    text,
    storylineText: brief?.storylineText ?? "",
    confidenceMap: brief?.confidenceMap ?? [],
    glossaryCandidates: before.glossaryCandidates,
    writerInstructions: payload.writerFlavor,
    rules: before.modelRules,
    // 2026-10-04 (first): the writer's caps code measures, quoted, which
    // the writer-instruction verdicts are told not to judge.
    ...(writerCapRules.length > 0 ? { measuredCaps: writerCapRules } : {}),
    model: clientFor.modelFor(`generation:selfCheck:${section}`),
    planChecks: claim.planChecks,
    planChecksBlock: claim.planChecksBlock,
    editedTerms: claim.editedTerms,
    ...(writerFeedback.length > 0 ? { writerFeedback } : {}),
    ...(feedbackTerms.length > 0 ? { feedbackTerms } : {}),
    ...(sourceFacts !== undefined ? { sourceFacts } : {}),
  };
  try {
    const result = await runModelSelfCheck(clientFor(`generation:selfCheck:${section}`), selfCheckInput);
    verdicts = result.verdicts;
    storylineQuestion = result.storylineQuestion;
    storylineQuestionWithheld = result.storylineQuestionWithheld;
    planVerdicts = withLeaveOutFigureNotes(
      result.planVerdicts,
      claim.planChecks,
      text,
      planWording,
      `generation:selfCheck:${section}`
    );
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
      ...(check.droppedSeedId ? { droppedSeedId: check.droppedSeedId } : {}),
      ...(check.ruleId ? { ruleId: check.ruleId } : {}),
      mergedItemIds: [...check.mergedItemIds],
      outcome: "not_applied" as const,
      reason: "The plan coverage Self-check did not complete.",
    }));
  }

  // 2026-09-30 (first): fixes that ask to leave content out. They are never
  // Must keep lines for the repair's compression, whose number and negation
  // guard would otherwise protect the very words they remove.
  const leaveOutIssues = new Set<string>();
  // Review P2-1: Rule C fixes, whose repair must keep every signed-off
  // figure the checked draft mentions. Re-check: a targets fix restates
  // rather than removes work, so it is not figure-guarded; the COVER
  // rollback below protects it (targetsIssues).
  const evidenceIssues = new Set<string>();
  const targetsIssues = new Set<string>();
  // 2026-10-04 (second): facts fixes correct a figure or take a detail out,
  // so, like a leave-out fix, they are never Must keep lines of the repair's
  // compression (its number guard would keep the wrong figure); the check of
  // the final text judges them again, and the COVER rollback protects the
  // signed-off items.
  const factsIssues = new Set<string>();
  const planIssues = modelCheck.ok
    ? planVerdicts.flatMap((verdict) => {
        const expected = claim.planChecks.find((check) => sameSummaryPlanRef(verdict, check));
        if (verdict.outcome !== "not_applied" || verdict.actionableRepair === false) return [];
        // CAP-13 rule 4: an idea the writer kept despite a Claim Exclusion
        // that the check found not covered (left out, or disclaimed) goes
        // to the repair with a fixed fix that names its words, never the
        // model's guidance.
        if (expected?.confirmedExclusion) {
          const kept = confirmed.find((conflict) => conflict.itemId === expected.itemId);
          return kept ? [keptIdeaRepairIssue(kept)] : [];
        }
        // 2026-09-30 (first): content of an uncertainty the writer dropped,
        // or a Line 246 advancement that answers no Line 242 uncertainty,
        // goes to the repair with a fixed start and the check's guidance;
        // since (second) Line 244 work for one too (Rule C).
        if (leavesContentOut(expected?.instruction) && expected) {
          const issue = leaveOutRepairIssue(expected, verdict, verdict.repairText ?? verdict.repairGuidance ?? verdict.reason);
          leaveOutIssues.add(issue);
          if (expected.instruction === "work_answer_242") evidenceIssues.add(issue);
          return [issue];
        }
        // 2026-10-04 (second): a figure or detail that does not match the
        // sources goes to the repair with a fixed start for the whole
        // section and the check's guidance.
        if (expected?.instruction === "match_sources") {
          const issue = leaveOutRepairIssue(expected, verdict, verdict.repairText ?? verdict.repairGuidance ?? verdict.reason);
          factsIssues.add(issue);
          return [issue];
        }
        // 2026-09-30 (third): a result misstated against its target goes
        // to the repair with a fixed start and the check's guidance. It asks
        // to state something, so it stays a Must keep line.
        if (expected?.instruction === "match_targets") {
          const issue = leaveOutRepairIssue(expected, verdict, verdict.repairText ?? verdict.repairGuidance ?? verdict.reason);
          targetsIssues.add(issue);
          return [issue];
        }
        return [verdict.repairText ?? verdict.repairGuidance ?? verdict.reason];
      })
    : [];
  // 2026-09-30 (third): in a signed-off plan run a Confidence Map or
  // Storyline fix says how to hedge, and a Glossary fix how to use the term.
  const issues = [
    ...repairIssues(before, verdicts, feedbackTerms, planRun
      ? { verdictPrefix: (verdict) => reportFactsIssuePrefix(verdict, before.glossaryCandidates) }
      : {}),
    ...planIssues,
  ];
  // 2026-09-30 (third): the source-talk fix asks to take words out, so, like
  // a leave-out fix, it is never a Must keep line of the repair's
  // compression, whose guard would otherwise protect the words it removes.
  // 2026-10-04 (first): the repair carries a fix for a writer's whole-Line
  // cap; signed-off items outrank it (the COVER rollback below).
  const writerCapIssue = before.entries.some(
    (entry) =>
      entry.measuredCap?.kind === "writer" &&
      entry.measuredCap.wholeLine &&
      entry.repairable &&
      entry.row.outcome === "not_applied"
  );
  const sourceTalkIssue = before.entries.find(
    (entry) => entry.key === SOURCE_TALK_KEY && entry.repairable && entry.row.outcome === "not_applied"
  )?.guidance;
  const repair: {
    attempted: boolean;
    succeeded: boolean;
    failureReason?: string;
    notUsedReason?: string;
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
        repairGuidanceBlock(
          issues,
          text,
          claim.editedTerms,
          decisions !== "",
          feedbackTerms.some((entry) => entry.inSignedOffIdea === true)
        )
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
            !leaveOutIssues.has(issue) &&
            !factsIssues.has(issue) &&
            issue !== sourceTalkIssue &&
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
          { finalCut: true, writerCap, coverItems }
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
        // Review P2-1: a repair that carried Line 244's work fix must keep
        // the evidence signed-off items need. It is set aside when a figure
        // of a signed-off item that the checked draft held is gone from it
        // (Greptile round: presence, not count), unless the checked draft is
        // further over a Locked limit (Locked Rules first).
        // 2026-10-04 (second, review round 1, P2-3): so must a facts fix,
        // whose verdict may be wrong about a figure a signed-off item gives.
        // Greptile round 1 on PR #26: only this Line's own signed-off items
        // (its COVER items), so a Line that put another Line's figure on the
        // wrong subject can drop it; the figure stays in the Line whose item
        // holds it. Rule C keeps its guard over every Line's items.
        const lostFigure =
          (evidenceIssues.size > 0 ? lostPlanFigure(text, fit.text, planWording) : undefined) ??
          (factsIssues.size > 0
            ? lostPlanFigure(
                text,
                fit.text,
                claim.planChecks.filter((planCheck) => planCheck.instruction === "cover").map((planCheck) => planCheck.wording)
              )
            : undefined);
        const figureOverLimit = lostFigure !== undefined && overLimitMore(text, fit.text);
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
        } else if (
          writerCap &&
          issues.every((issue) => issue.startsWith("Shorten ")) &&
          !meetsWriterCap(fit.text, key, writerCap) &&
          closerToLimits(text, fit.text, key, writerCap)
        ) {
          // 2026-10-04 (first, review P3-1): a repair made only to shorten
          // is not used when it is further over the writer's cap than the
          // checked draft (ties go to the repair).
          const metrics = sectionMetrics(fit.text, key);
          repair.notUsedReason = `${repairOverWriterCapReason(metrics.words, metrics.lines, writerCap)}${
            failure ? `; ${failure}` : ""
          }`;
        } else if (droppedTerm !== undefined) {
          repair.notUsedReason = `${repairDroppedTermReason(droppedTerm)}${failure ? `; ${failure}` : ""}`;
        } else if (droppedKept.length > 0 && !keptOverLimit) {
          repair.notUsedReason = `${repairDroppedKeptIdeaReason(droppedKept[0]!)}${failure ? `; ${failure}` : ""}`;
        } else if (lostFigure !== undefined && !figureOverLimit) {
          console.warn(`generation:repair:${section}: the repair holds a signed-off figure in fewer paragraphs; the checked draft is kept`);
          repair.notUsedReason = `${repairLostPlanFigureReason(lostFigure)}${failure ? `; ${failure}` : ""}`;
        } else {
          if (keptOverLimit) for (const conflict of droppedKept) droppedForLimit.add(conflict.itemId);
          finalText = fit.text;
          repair.succeeded = true;
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

  // 2026-09-28 (third): the coverage record describes the final text;
  // nothing changes the text after its check. Unchanged text makes no call,
  // and a first check that failed as a whole stays unavailable.
  let finalCoverage:
    | { ok: true; verdicts: PlanVerdicts }
    | { ok: false; reason: string; detail: string }
    | undefined;
  // Greptile round 4, P2: the same request judges the labels of the Glossary
  // Terms the writer's Feedback governs on the final text, so their rows
  // describe it.
  let governedFinal: { ok: true; verdicts: ModelVerdict[] } | { ok: false } | undefined;
  // Round 2 (2026-10-05, owner decision; follow-up "Small fix + Opus trial"):
  // after every used repair that changed the text, shortened or not, the
  // full Self-check judges the final text with the first check's input (its
  // Glossary candidates and rules from the final text's own deterministic
  // check), so every row describes the text that ships. In Summary mode it
  // is the check of the final text that already ran (coverage-only before
  // the follow-up), so no request is added. In Single draft and Compare it
  // is one more Self-check request, within the slots the check of the final
  // text has in every mode. A check that fails, or runs out of time, leaves
  // those rows "not checked on the final text", never a verdict on the text
  // before the repair.
  let finalOrdinary:
    | { ok: true; verdicts: ModelVerdict[]; sameAsChecked?: true }
    | { ok: false; reason: string }
    | undefined;
  const finalCheckInput: SelfCheckModelInput | null =
    repair.succeeded && modelCheck.ok && after !== null && !sameUtf8Bytes(text, finalText)
      ? { ...selfCheckInput, text: finalText, glossaryCandidates: after.glossaryCandidates, rules: after.modelRules }
      : null;
  if (finalCheckInput) {
    // The plan rows read this check's plan verdicts (Summary mode with plan checks).
    const recordsPlanCoverage = Boolean(payload.summaryVersionId) && claim.planChecks.length > 0;
    try {
      const final = await runModelSelfCheck(clientFor(`generation:selfCheck:${section}`), finalCheckInput);
      if (recordsPlanCoverage) {
        finalCoverage = {
          ok: true,
          verdicts: withLeaveOutFigureNotes(
            final.planVerdicts,
            claim.planChecks,
            finalText,
            planWording,
            `generation:selfCheck:${section}: final coverage`
          ),
        };
      }
      finalOrdinary = { ok: true, verdicts: final.verdicts };
      // Review P3-2: the governed terms' rows follow the same check.
      if (feedbackTerms.length > 0) governedFinal = { ok: true, verdicts: final.verdicts };
    } catch (error) {
      // Stored beside modelCheckDetail with the same diagnostic: the clause,
      // positions, byte counts and app-supplied ids, never model text.
      const reason = normalizeProviderError(error).code;
      const detail = selfCheckFailureDiagnostic(error);
      console.warn(`generation:selfCheck:${section}: Self-check of the final text failed (${reason}): ${detail}`);
      if (recordsPlanCoverage) finalCoverage = { ok: false, reason, detail };
      finalOrdinary = { ok: false, reason };
      if (feedbackTerms.length > 0) governedFinal = { ok: false };
    }
  } else if (repair.succeeded && modelCheck.ok && sameUtf8Bytes(text, finalText)) {
    // Review P3-4: the repair (shortened or not) left the checked text, which
    // the first check judged: its verdicts describe the final text, no request.
    finalOrdinary = { ok: true, verdicts, sameAsChecked: true };
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
      repair.notUsedReason = repairDroppedKeptIdeaReason(dropped[0]!);
      keptFit = firstFit;
      after = null;
      finalCoverage = undefined;
      governedFinal = undefined;
      finalOrdinary = undefined;
    }
  }

  // 2026-09-30 (first, review P2-2): a repair made for a LEAVE OUT or Line
  // 246's advancement check must keep what the signed-off plan holds. When
  // it carried such a fix and the coverage check of its final text finds a
  // COVER item not covered that the first check found covered, the checked
  // draft is kept, as for a kept idea, unless the checked draft is further
  // over a Locked limit (Locked Rules first). With no final verdict to read,
  // nothing shows a loss, and the repair stays.
  // Review P3 (targets): a targets fix must keep what the plan holds too.
  // 2026-10-04 (first, owner decision): signed-off items outrank the
  // writer's cap, so a repair asked to shorten for it must keep them too.
  // 2026-10-04 (second): and so must a facts fix.
  let heldByRepair = false;
  if (
    repair.succeeded &&
    finalCoverage?.ok &&
    (leaveOutIssues.size > 0 || targetsIssues.size > 0 || factsIssues.size > 0 || writerCapIssue)
  ) {
    const coverage = finalCoverage;
    const lost = claim.planChecks.filter((planCheck) => {
      if (planCheck.instruction !== "cover" || planCheck.confirmedExclusion) return false;
      const before = planVerdictFor(planVerdicts, planCheck);
      if (before?.outcome !== "applied" || before.actionableRepair === false) return false;
      const later = planVerdictFor(coverage.verdicts, planCheck);
      return later !== undefined && later.actionableRepair !== false && later.outcome !== "applied";
    });
    if (lost.length > 0 && !overLimitMore(text, finalText)) {
      // The Line stays over the writer's cap to keep a signed-off item only
      // when the repair itself met the cap (review re-check P2-a).
      heldByRepair = writerCapIssue && writerCap !== null && meetsWriterCap(finalText, key, writerCap);
      console.warn(`generation:repair:${section}: a repair no longer covers a signed-off item; the checked draft is kept`);
      finalText = text;
      repair.succeeded = false;
      repair.notUsedReason = repairDroppedCoverItemReason(lost[0]!);
      keptFit = firstFit;
      after = null;
      finalCoverage = undefined;
      governedFinal = undefined;
      finalOrdinary = undefined;
    }
  }

  // Greptile rounds 1 to 4 (lead decision): a used repair whose final text
  // still breaks Rule C is kept. Each set-aside variant discarded or
  // mislabelled valid fixes, so every row reports its own final-text
  // verdict, and a Rule C row that still fails reads not applied with the
  // checker's reason. The figure guard and the COVER rollback stay.

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
      ...(keptFit.heldBack ? { heldBack: keptFit.heldBack } : {}),
    },
    ...(keptFit.heldForPlan ? { heldForPlan: "pass" as const } : heldByRepair ? { heldForPlan: "repair" as const } : {}),
    ...(feedbackTerms.length > 0 ? { governed: feedbackTerms } : {}),
    ...(governedFinal ? { governedFinal } : {}),
    ...(payload.writerFlavor ? { writerInstructions: payload.writerFlavor } : {}),
    ...(finalOrdinary ? { finalVerdicts: finalOrdinary } : {}),
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
      coverageCheckSucceeded: modelCheck.ok,
      ...(finalCoverage ? { finalCoverage } : {}),
      confirmed: new Map(confirmed.map((conflict) => [conflict.itemId, {
        exclusions: conflict.exclusions.map((entry) => entry.text),
        words: ideaWords(conflict.wording, 120),
        paragraphIndex: confirmedConflictParagraph(finalText, conflict),
        ...(droppedForLimit.has(conflict.itemId) ? { droppedForLimit: true } : {}),
      }])),
    });
    // 2026-09-30 (first): dropped uncertainties beyond the cap are named as
    // not checked, and count as plan rows that are not applied.
    planRows.push(...droppedNotCheckedNoteDrafts({
      section,
      summaryVersionId: payload.summaryVersionId,
      dropped: claim.droppedNotChecked ?? [],
    }));
    // 2026-10-04 (second, round 2): when not every source document was
    // read, the facts check's row says which and what stood for them.
    const documents = claim.factsSourceDocuments;
    if (sourceFacts && documents && !sourceFacts.documentsComplete) {
      planRows = planRows.map((row) =>
        row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID
          ? { ...row, reason: `${row.reason} ${factsDocumentsLeftOutNote(documents)}` }
          : row);
    }
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
            // 2026-09-30 (second): Rules A, B and C, ranges and times.
            ...(payload.summaryVersionId !== undefined ? { signedOffPlan: true } : {}),
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
          // 2026-09-30 (second): Rules A, B and C, ranges and times.
          ...(input.signedOffPlan ? { signedOffPlan: true } : {}),
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
