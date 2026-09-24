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
import { clientForModel, normalizeProviderError, seedClientForModel } from "./providers";
import type { GenerationClient, GenerationMessageParams } from "./openrouterCore";
import { parseTranscriptAnalysis } from "./analyzerAgent";
import { runSection242Agent } from "./section242Agent";
import { runSection244Agent } from "./section244Agent";
import { runSection246Agent } from "./section246Agent";
import { runQAAgent } from "./qaAgent";
import { runChronologyAgent } from "./chronologyAgent";
import {
  buildStyleGuidance,
  compressToFit,
  lengthBudgetBlock,
  provenanceDrafts,
  recordCandidateProvenance,
} from "./pipeline";
import { runConsistencyPass, runModelSelfCheck, type ModelSelfCheckResult } from "./selfCheck";
import {
  generationSlotOf,
  mergeSlotCounts,
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
import { sectionMetrics, type LengthTarget } from "../lib/lineLimits";
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
import { currentPromptVersion } from "./promptProgram";
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
        promptVersion: await currentPromptVersion(),
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

/** The repair instruction appended to the section agent's prompt. */
export function repairGuidanceBlock(issues: string[], draft: string): string {
  const scaffold = ORDERED_PROMPT_SCAFFOLDS.repairGuidance;
  return `${scaffold.prefix}${issues
    .map((issue) => `${scaffold.issuePrefix}${issue}`)
    .join(scaffold.issueSeparator)}${scaffold.draftPrefix}${draft}`;
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
};

function sameUtf8Bytes(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  return leftBytes.byteLength === rightBytes.byteLength &&
    leftBytes.every((byte, index) => byte === rightBytes[index]);
}

/** Convert the one Self-check response into one AD-37 row per item/Skip. */
export function planComplianceNoteDrafts(args: {
  section: SectionNumber;
  summaryVersionId: Id<"summaryVersions">;
  checks: PlanCheck[];
  verdicts: ModelSelfCheckResult["planVerdicts"];
  repairSucceeded?: boolean;
  coverageCheckSucceeded?: boolean;
  finalCoverageNotReverified?: boolean;
}): ComplianceNoteDraft[] {
  return args.verdicts.flatMap((verdict) => {
    const expected = args.checks.find((check) =>
      verdict.itemId
        ? check.itemId === verdict.itemId
        : check.skippedRoleId === verdict.skippedRoleId
    );
    if (!expected) return [];
    const conflict = expected.confirmedExclusion;
    const invalidated =
      !conflict &&
      args.finalCoverageNotReverified === true &&
      verdict.outcome === "applied";
    return [noteDraft({
      section: args.section,
      ...(conflict || invalidated || verdict.paragraphIndex === undefined
        ? {}
        : { paragraphIndex: verdict.paragraphIndex }),
      source: "model",
      instruction: expected.instruction === "skip"
        ? `Omit signed-off role ${expected.skippedRoleId}`
        : `Cover signed-off Summary item ${expected.itemId}`,
      outcome: conflict || invalidated ? "not_applied" : verdict.outcome,
      tier: conflict ? "conflict" : "none",
      reason: conflict
        ? "The writer confirmed a Brief Claim Exclusion conflict at sign-off."
        : invalidated
          ? "Final coverage was not reverified after an accepted repair changed the exact checked Section text."
          : verdict.reason,
      repaired:
        !conflict &&
        !invalidated &&
        verdict.outcome === "not_applied" &&
        verdict.actionableRepair !== false &&
        args.coverageCheckSucceeded !== false &&
        (args.repairSucceeded ?? false),
      planRef: {
        summaryVersionId: args.summaryVersionId,
        ...(expected.itemId ? { itemId: expected.itemId } : {}),
        ...(expected.skippedRoleId ? { skippedRoleId: expected.skippedRoleId } : {}),
        mergedItemIds: expected.mergedItemIds,
      },
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

function chainClientFactory(
  ctx: ActionCtx,
  meta: {
    model: string;
    projectId: Id<"projects">;
    requestedBy?: Id<"users">;
    generationId: Id<"generations">;
    candidateRunId: Id<"generationCandidateRuns">;
  },
  counts: Record<string, number>
) {
  return (callSite: string, learningDigestIds?: Id<"learningDigests">[]) =>
    countingClient(
      clientForModel(ctx, meta.model, {
        callSite,
        projectId: meta.projectId,
        ...(meta.requestedBy ? { userId: meta.requestedBy } : {}),
        attribution: {
          generationId: meta.generationId,
          candidateRunId: meta.candidateRunId,
          ...(learningDigestIds?.length ? { learningDigestIds } : {}),
        },
      }),
      callSite,
      counts
    );
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

/** The claim both the ordered chain and the seed redraft draft from. */
type SectionClaim = Exclude<
  NonNullable<FunctionReturnType<typeof internal.generations.claimOrderedSectionRun>>,
  { stopped: true }
>;

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
 * draft 1 + compression 2 + Self-check 1 + repair 1 = 5 sequential calls
 * (providers.ts ORDERED_SECTION_ACTION_SLOTS). Shared by the ordered chain
 * and the seed redraft so both draft under the same rules. Throws on a
 * failed draft; the caller records the failure.
 */
async function draftCheckedSection(input: {
  claim: SectionClaim;
  payload: OrderedPayload;
  section: SectionNumber;
  clientFor: ReturnType<typeof chainClientFactory>;
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
  const draftWith = async (callSite: string, extraGuidance = "") =>
    scrubBannedWordsUnlessWaived(
      await agent(
        clientFor(callSite, styleDigestIds),
        analysis,
        claim.model,
        payload.brainExemplars[key],
        lengthBudgetBlock(key, lengthTarget),
        styleGuidance + extraGuidance,
        styleOverrides,
        claim.briefBlock,
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
  text = await compressToFit(clientFor, claim.model, key, text, lengthTarget, styleOverrides);
  if (!text.trim()) {
    // Same guard as the initial draft above: only the banned-word scrub
    // inside compressToFit's re-scrub step can empty an already-non-empty
    // compressed draft. There is no repair fallback for this stage.
    throw new Error("Section draft empty after compression");
  }

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
    });
  const before = check(text);

  let verdicts: ModelVerdict[] = [];
  let storylineQuestion: ModelSelfCheckResult["storylineQuestion"] = null;
  let planVerdicts: ModelSelfCheckResult["planVerdicts"] = [];
  let modelCheck: { ok: true } | { ok: false; reason: string } = { ok: true };
  try {
    const result = await runModelSelfCheck(clientFor(`generation:selfCheck:${section}`), {
      section,
      text,
      storylineText: brief?.storylineText ?? "",
      confidenceMap: brief?.confidenceMap ?? [],
      glossaryCandidates: before.glossaryCandidates,
      writerInstructions: payload.writerFlavor,
      rules: before.modelRules,
      model: claim.model,
      planChecks: claim.planChecks,
      planChecksBlock: claim.planChecksBlock,
    });
    verdicts = result.verdicts;
    storylineQuestion = result.storylineQuestion;
    planVerdicts = result.planVerdicts;
  } catch (error) {
    // An unrepaired or unrun check never blocks the section (Never-rule);
    // the failure is recorded in the Compliance Note instead.
    modelCheck = { ok: false, reason: normalizeProviderError(error).code };
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
        return verdict.outcome === "not_applied" &&
          verdict.actionableRepair !== false &&
          !expected?.confirmedExclusion
          ? [verdict.repairGuidance ?? verdict.reason]
          : [];
      })
    : [];
  const issues = [...repairIssues(before, verdicts), ...planIssues];
  const repair: { attempted: boolean; succeeded: boolean; failureReason?: string } = {
    attempted: issues.length > 0,
    succeeded: false,
  };
  let finalText = text;
  let after: DeterministicSelfCheck | null = null;
  if (repair.attempted) {
    try {
      // The same section agent that drafted it, with the repair guidance
      // appended: a separate model interaction, never an inline edit.
      const repaired = await draftWith(
        `generation:repair:${section}`,
        repairGuidanceBlock(issues, text)
      );
      if (repaired.trim()) {
        finalText = repaired;
        repair.succeeded = true;
        after = check(finalText);
      } else {
        // An empty repair never replaces the draft it was meant to fix.
        repair.failureReason = "EMPTY_OUTPUT";
      }
    } catch (error) {
      repair.failureReason = normalizeProviderError(error).code;
    }
  }

  const finalCoverageNotReverified =
    repair.succeeded && !sameUtf8Bytes(text, finalText);

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
    repair,
    finalText,
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
      coverageCheckSucceeded: modelCheck.ok,
      finalCoverageNotReverified,
    });
    rows.push(...planRows);
  }
  const initialPlanFailures = planVerdicts.filter((verdict) => {
    const expected = claim.planChecks.find((check) =>
      verdict.itemId
        ? check.itemId === verdict.itemId
        : check.skippedRoleId === verdict.skippedRoleId
    );
    return verdict.outcome !== "applied" || expected?.confirmedExclusion === true;
  }).length;
  const finalPlanFailures = planRows.filter(
    (row) => row.outcome !== "applied"
  ).length;
  const summary = {
    ...baseSummary,
    failedChecks: baseSummary.failedChecks + initialPlanFailures,
    remainingFailures: baseSummary.remainingFailures + finalPlanFailures,
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
    payload: orderedPayloadValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    let claim: FunctionReturnType<
      typeof internal.generations.claimOrderedSectionRun
    >;
    try {
      claim = await ctx.runMutation(internal.generations.claimOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        promptVersion: await currentPromptVersion(),
        payload: args.payload,
      });
    } catch (error) {
      // The failed claim mutation rolls back atomically. The owning action is
      // still responsible for terminalizing its live signed-off chain so the
      // immutable Summary can be retried.
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.generations.failOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        error: `${normalized.code}: ${normalized.message}`,
      });
      return null;
    }
    if (!claim) return null;
    if ("stopped" in claim) {
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeOrderedCandidate, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        payload: args.payload,
      });
      return null;
    }
    const slotCounts: Record<string, number> = {};
    const clientFor = chainClientFactory(
      ctx,
      {
        model: claim.model,
        projectId: claim.projectId,
        requestedBy: claim.requestedBy,
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
      },
      slotCounts
    );
    try {
      const completion = await draftCheckedSection({
        claim,
        payload: args.payload,
        section: args.section,
        clientFor,
      });
      await ctx.runMutation(internal.generations.completeOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        ...completion,
        slotCounts: JSON.stringify(slotCounts),
        payload: args.payload,
      });
    } catch (error) {
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.generations.failOrderedSectionRun, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: args.section,
        error: `${normalized.code}: ${normalized.message}`,
        payload: args.payload,
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
    payload: orderedPayloadValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
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
      const [drafts, input] = await Promise.all([
        ctx.runQuery(internal.generations.getOrderedCandidateDrafts, {
          generationId: args.generationId,
          candidateRunId: args.candidateRunId,
        }),
        ctx.runQuery(internal.generations.getGenerationInput, {
          generationId: args.generationId,
        }),
      ]);
      if (!drafts || !input || drafts.runStatus !== "running") {
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
        },
        slotCounts
      );
      const { payload } = args;
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
          const findings = await runConsistencyPass(clientFor("generation:consistency"), {
            sections: drafted,
            claimExclusions: drafts.brief?.claimExclusions.map((entry) => entry.text) ?? [],
            glossaryTerms: drafts.brief?.glossaryTerms ?? [],
            model: drafts.model,
          });
          notes = [
            ...consistencyNoteDrafts(findings),
            consistencySummaryNote(last, { ok: true, findings: findings.length }),
          ];
        } catch (error) {
          notes = [
            consistencySummaryNote(last, {
              ok: false,
              reason: normalizeProviderError(error).code,
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
              drafts.model,
              payload.qaCalibration,
              styleOverrides,
              detectFirstPersonPreference(payload.writerFlavor)
            )
          : Promise.resolve(null),
        seedRun
          ? Promise.resolve(null)
          : runChronologyAgent(clientFor("generation:chronology"), analysis, drafts.model),
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
        claimDrafts: provenanceDrafts(drafted, input.transcript, analysis.useful_quotes),
      });
      const callBudget = summarizeSlotUsage(
        mergeSlotCounts(...drafts.sections.map((row) => parseCounts(row.slotCounts)), slotCounts)
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
      const normalized = normalizeProviderError(error);
      await complete({ error: `${normalized.code}: ${normalized.message}` });
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
    payload: orderedPayloadValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const fail = async (error: unknown) => {
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.generations.failRedraftSection, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        attemptStartedAt: args.attemptStartedAt,
        section: args.section,
        error: `${normalized.code}: ${normalized.message}`,
      });
    };
    let claim: SectionClaim | null;
    try {
      claim = await ctx.runMutation(internal.generations.claimRedraftSection, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        attemptStartedAt: args.attemptStartedAt,
        section: args.section,
        promptVersion: await currentPromptVersion(),
        payload: args.payload,
      });
    } catch (error) {
      await fail(error);
      return null;
    }
    if (!claim) return null;
    const slotCounts: Record<string, number> = {};
    const clientFor = chainClientFactory(
      ctx,
      {
        model: claim.model,
        projectId: claim.projectId,
        requestedBy: claim.requestedBy,
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
      },
      slotCounts
    );
    try {
      const completion = await draftCheckedSection({
        claim,
        payload: args.payload,
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
        payload: args.payload,
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
      const consistencyClient = seedClientForModel(ctx, input.model, {
        callSite: "generation:consistency",
        projectId: input.projectId,
        ...(input.requestedBy ? { userId: input.requestedBy } : {}),
        attribution: { generationId: args.generationId, candidateRunId: args.candidateRunId },
      });
      let notes: ComplianceNoteDraft[];
      try {
        const findings = await runConsistencyPass(consistencyClient, {
          sections: present,
          claimExclusions: input.brief?.claimExclusions.map((entry) => entry.text) ?? [],
          glossaryTerms: input.brief?.glossaryTerms ?? [],
          model: input.model,
        });
        notes = [
          ...consistencyNoteDrafts(findings),
          consistencySummaryNote(last, { ok: true, findings: findings.length }),
        ];
      } catch (error) {
        notes = [
          consistencySummaryNote(last, {
            ok: false,
            reason: normalizeProviderError(error).code,
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
