/**
 * The generation Convex functions, registered under their public and internal
 * paths (api.generations.*, internal.generations.*). Each wrapper declares its
 * validators and delegates to a handler in convex/lib/generations/, split by
 * concern (2026-09-25, phase 4): projection, reservation, inputs, lifecycle,
 * candidates, iterative, brief, seedStage, draftingInputs, chain, redraft,
 * postQa, reapers, scoring and migrations. Status writes go through
 * transitionGeneration (convex/lib/generationTransitions.ts).
 */
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import {
  getLatestGenerationArgs,
  getLatestGenerationHandler,
  getGenerationSeedViewArgs,
  getGenerationSeedViewHandler,
  getGenerationArgs,
  getGenerationHandler,
  getGenerationRecoveryArgs,
  getGenerationRecoveryHandler,
  listGenerationsArgs,
  listGenerationsHandler,
} from "./lib/generations/projection";
import {
  requestGenerationArgs,
  requestGenerationHandler,
  retryGenerationArgs,
  retryGenerationHandler,
  retryFromSummaryArgs,
  retryFromSummaryHandler,
  retryFailedCandidatesArgs,
  retryFailedCandidatesHandler,
} from "./lib/generations/reservation";
import {
  beginGenerationArgs,
  beginGenerationHandler,
  unionLearningDigestIdsArgs,
  unionLearningDigestIdsHandler,
  failGenerationArgs,
  failGenerationHandler,
  setGenerationEstimateArgs,
  setGenerationEstimateHandler,
  setBrainProvenanceArgs,
  setBrainProvenanceHandler,
  appendProgressArgs,
  appendProgressHandler,
  recordWriterSettingsArgs,
  recordWriterSettingsHandler,
  updateGenerationStatusArgs,
  updateGenerationStatusHandler,
} from "./lib/generations/lifecycle";
import { v } from "convex/values";
import {
  getGenerationPlaceholdersArgs,
  getGenerationPlaceholdersHandler,
  getGenerationInputArgs,
  getGenerationInputHandler,
  recordContextBudgetArgs,
  recordContextBudgetHandler,
  getContextInclusionArgs,
  getContextInclusionHandler,
} from "./lib/generations/inputs";
import {
  createCandidateRunArgs,
  createCandidateRunHandler,
  setCandidateRunJobArgs,
  setCandidateRunJobHandler,
  claimCandidateRunArgs,
  claimCandidateRunHandler,
  completeCandidateRunArgs,
  completeCandidateRunHandler,
  getCandidatesArgs,
  getCandidatesHandler,
  selectReportCandidateArgs,
  selectReportCandidateHandler,
} from "./lib/generations/candidates";
import {
  saveIterativeArtifactsArgs,
  saveIterativeArtifactsHandler,
  createSectionRunsArgs,
  createSectionRunsHandler,
  claimSectionRunArgs,
  claimSectionRunHandler,
  completeSectionRunArgs,
  completeSectionRunHandler,
  failSectionRunArgs,
  failSectionRunHandler,
  getIterativeSectionInputArgs,
  getIterativeSectionInputHandler,
  getIterativeStateArgs,
  getIterativeStateHandler,
  approveSectionDraftArgs,
  approveSectionDraftHandler,
  regenerateSectionDraftArgs,
  regenerateSectionDraftHandler,
  cancelIterativeGenerationArgs,
  cancelIterativeGenerationHandler,
} from "./lib/generations/iterative";
import {
  getGenerationSourcesForBriefArgs,
  getGenerationSourcesForBriefHandler,
  getCitationSpeakersArgs,
  getCitationSpeakersHandler,
  citationSpeakerValidator,
  findReusableBriefArgs,
  findReusableBriefHandler,
  stampGenerationBriefIdArgs,
  stampGenerationBriefIdHandler,
  recordBriefOutcomeArgs,
  recordBriefOutcomeHandler,
  getBriefDiffBaselineIdArgs,
  getBriefDiffBaselineIdHandler,
  getBriefDiffBaselinePageArgs,
  briefCandidateEntryValidator,
  getBriefDiffBaselinePageHandler,
  persistDerivedBriefArgs,
  persistDerivedBriefHandler,
  renderBriefForGenerationArgs,
  renderBriefForGenerationHandler,
} from "./lib/generations/brief";
import {
  pinSeedBriefArgs,
  pinSeedBriefHandler,
  initializeSeedStageArgs,
  initializeSeedStageHandler,
  signOffSeedStageArgs,
  signOffSeedStageHandler,
  beginSummaryRecoveryArgs,
  beginSummaryRecoveryHandler,
  recordSeedInitializationFailureArgs,
  recordSeedInitializationFailureHandler,
  retryInitializeSeedStageArgs,
  retryInitializeSeedStageHandler,
} from "./lib/generations/seedStage";
import {
  saveWriterStyleArgs,
  saveWriterStyleHandler,
  startDraftingInputsArgs,
  startDraftingInputsHandler,
  draftingInputsStatusValidator,
  draftingInputsAttemptArgs,
  failDraftingInputsArgs,
  isDraftingInputsAttemptCurrentHandler,
  completeDraftingInputsArgs,
  completeDraftingInputsHandler,
  failDraftingInputsHandler,
  expireDraftingInputsHandler,
  retryDraftingInputsArgs,
  retryDraftingInputsHandler,
} from "./lib/generations/draftingInputs";
import {
  getPostQaAttemptArgs,
  getPostQaAttemptHandler,
  getPostQaInputArgs,
  getPostQaInputHandler,
  saveReportQaArgs,
  saveReportQaHandler,
  requestReportQaArgs,
  requestReportQaHandler,
  failStalePostQaArgs,
  failStalePostQaHandler,
  getGenerationQaResultArgs,
  getGenerationQaResultHandler,
} from "./lib/generations/postQa";
import {
  reapSeedBatchPageArgs,
  reapSeedBatchPageHandler,
  failStaleGenerationsArgs,
  staleScanResultValidator,
  failStaleGenerationsHandler,
  freeOrphanedGeneratingProjectsArgs,
  freeOrphanedGeneratingProjectsHandler,
} from "./lib/generations/reapers";
import {
  modelStatsArgs,
  modelStatsHandler,
  getModelCommentsArgs,
  getModelCommentsHandler,
  scoreCandidateArgs,
  scoreCandidateHandler,
  getMyCandidateScoresArgs,
  getMyCandidateScoresHandler,
  getCandidateScoreSummaryArgs,
  getCandidateScoreSummaryHandler,
} from "./lib/generations/scoring";
import {
  createOrderedSectionRunsArgs,
  createOrderedSectionRunsHandler,
  claimOrderedSectionRunArgs,
  claimOrderedSectionRunHandler,
  getOrderedPayloadArgs,
  getOrderedPayloadHandler,
  completeOrderedSectionRunArgs,
  completeOrderedSectionRunHandler,
  failOrderedSectionRunArgs,
  failOrderedSectionRunHandler,
  insertConsistencyNotesArgs,
  insertConsistencyNotesHandler,
  getOrderedCandidateDraftsArgs,
  getOrderedCandidateDraftsHandler,
  stopOrderedGenerationArgs,
  stopOrderedGenerationHandler,
  getOrderedSectionDraftsArgs,
  getOrderedSectionDraftsHandler,
} from "./lib/generations/chain";
import { orderedPayloadValidator, sectionNumberValidator } from "./lib/orderedChain";
import {
  getSeedDraftProgressArgs,
  getSeedDraftProgressHandler,
  redraftMissingSectionsArgs,
  redraftMissingSectionsHandler,
  claimRedraftSectionArgs,
  claimRedraftSectionHandler,
  completeRedraftSectionArgs,
  completeRedraftSectionHandler,
  failRedraftSectionArgs,
  failRedraftSectionHandler,
  expireStaleRedraftArgs,
  expireStaleRedraftHandler,
  getSeedRedraftInputArgs,
  getSeedRedraftInputHandler,
  applySeedRedraftArgs,
  applySeedRedraftHandler,
} from "./lib/generations/redraft";
import {
  backfillSectionRunDataArgs,
  backfillSectionRunDataHandler,
  backfillGenerationProgressArgs,
  backfillGenerationProgressHandler,
  backfillGenerationOutputsArgs,
  backfillGenerationOutputsHandler,
} from "./lib/generations/migrations";

// Helpers other modules import from "./generations".
export { decideInputMode } from "./lib/generations/reservation";
export {
  MAX_BRIEF_SOURCE_ROWS,
  MAX_BRIEF_ENTRY_ROWS,
  BRIEF_BASELINE_PAGE_BYTES,
  BRIEF_CONSUMER_READ_BYTES,
  briefDiffKey,
} from "./lib/generations/brief";
export {
  SEED_INITIALIZATION_ERROR,
  bumpSeedStageVersion,
  adjustSeedRequestsReserved,
} from "./lib/generations/seedStage";
export {
  STALE_GENERATION_SCAN_PAGE_SIZE,
  STALE_PROJECT_SWEEP_PAGE_SIZE,
} from "./lib/generations/reapers";
export {
  DEFAULT_SECTION_DRAFT_MS,
  DEFAULT_CONSISTENCY_PASS_MS,
  REDRAFT_STALE_MS,
  redraftUserError,
} from "./lib/generations/redraft";
export { PROGRESS_BACKFILL_MAX_LINES } from "./lib/generations/migrations";

/**
 * Requires internal project access. Strips internal agentOutputs.
 */
export const getLatestGeneration = query({
  args: getLatestGenerationArgs,
  handler: getLatestGenerationHandler,
});

/** Report-owned Seed metadata. A newer project generation must never replace
 * the frozen Summary that produced the report currently on screen. */
export const getGenerationSeedView = query({
  args: getGenerationSeedViewArgs,
  handler: getGenerationSeedViewHandler,
});

/** Public internal view of one exact generation. */
export const getGeneration = query({
  args: getGenerationArgs,
  handler: getGenerationHandler,
});

/** User-safe recovery state. Raw provider errors and progress-log strings do
 * not cross this boundary. */
export const getGenerationRecovery = query({
  args: getGenerationRecoveryArgs,
  handler: getGenerationRecoveryHandler,
});

/**
 * Requires internal project access. Strips internal agentOutputs.
 */
export const listGenerations = query({
  args: listGenerationsArgs,
  handler: listGenerationsHandler,
});

export const requestGeneration = mutation({
  args: requestGenerationArgs,
  handler: requestGenerationHandler,
});

export const retryGeneration = mutation({
  args: retryGenerationArgs,
  handler: retryGenerationHandler,
});

/** Recover prose drafting from the same immutable Summary and frozen inputs. */
export const retryFromSummary = mutation({
  args: retryFromSummaryArgs,
  handler: retryFromSummaryHandler,
});

/** Retry only failed compare-mode models. Successful candidates are copied
 * into a fresh linked generation before failed models are scheduled. */
export const retryFailedCandidates = mutation({
  args: retryFailedCandidatesArgs,
  handler: retryFailedCandidatesHandler,
});

// ─── Internal functions used by the pipeline action ──────────────────────────

export const beginGeneration = internalMutation({
  args: beginGenerationArgs,
  handler: beginGenerationHandler,
});

/**
 * Record the exact learning digests disclosed in one provider payload.
 * The read + union + patch is one Convex transaction, so concurrent candidate
 * handoffs converge through optimistic retry instead of overwriting each
 * other. Terminal generations remain writable here because post-assembly QA
 * is generation-owned and may legitimately disclose a newer calibration.
 */
export const unionLearningDigestIds = internalMutation({
  args: unionLearningDigestIdsArgs,
  returns: v.null(),
  handler: unionLearningDigestIdsHandler,
});

/**
 * The placeholder map frozen on a generation (owner decision 26); empty for
 * generations reserved before it or with the emergency switch off.
 */
export const getGenerationPlaceholders = internalQuery({
  args: getGenerationPlaceholdersArgs,
  returns: v.array(v.object({ token: v.string(), value: v.string() })),
  handler: getGenerationPlaceholdersHandler,
});

export const getGenerationInput = internalQuery({
  args: getGenerationInputArgs,
  handler: getGenerationInputHandler,
});

/**
 * Record what the analyzer's context budget did with each frozen source row
 * (convex/ai/trustedContext.ts). Additive: capture-time facts (`content`,
 * `contentHash`, `truncated`, `originalLength`) are never rewritten.
 */
export const recordContextBudget = internalMutation({
  args: recordContextBudgetArgs,
  handler: recordContextBudgetHandler,
});

/**
 * Story 4 (CAP-11, AD-30): the Brief's Inputs band — one inclusion row per
 * frozen Transcript and Supporting Document, plus the project documents the
 * reservation skipped (archived or unreadable at the time), with the cap.
 * The one inclusion read. Null for an outsider or a missing generation.
 */
export const getContextInclusion = query({
  args: getContextInclusionArgs,
  handler: getContextInclusionHandler,
});

export const createCandidateRun = internalMutation({
  args: createCandidateRunArgs,
  handler: createCandidateRunHandler,
});

export const setCandidateRunJob = internalMutation({
  args: setCandidateRunJobArgs,
  handler: setCandidateRunJobHandler,
});

export const claimCandidateRun = internalMutation({
  args: claimCandidateRunArgs,
  handler: claimCandidateRunHandler,
});

export const completeCandidateRun = internalMutation({
  args: completeCandidateRunArgs.fields,
  handler: completeCandidateRunHandler,
});

export const failGeneration = internalMutation({
  args: failGenerationArgs,
  handler: failGenerationHandler,
});

/** Freeze the one-time iterative artifacts (analyzer output; brain blocks +
 * style guidance). `brainBlocks` content shape (JSON):
 * `{ blocks: {analyzer,s242,s244,s246}, styleGuidance: string }`. */
export const saveIterativeArtifacts = internalMutation({
  args: saveIterativeArtifactsArgs,
  handler: saveIterativeArtifactsHandler,
});

/** The frozen `generationSources` rows a Brief derivation reads. */
export const getGenerationSourcesForBrief = internalQuery({
  args: getGenerationSourcesForBriefArgs,
  handler: getGenerationSourcesForBriefHandler,
});

/** Owner decision 25 for spans of this generation's frozen rows: whose
 * words each one cites (convex/lib/citationSpeakers.ts). */
export const getCitationSpeakers = internalQuery({
  args: getCitationSpeakersArgs,
  returns: v.array(citationSpeakerValidator),
  handler: getCitationSpeakersHandler,
});

/** MAX(version) Brief for (projectId, inputsHash), regardless of origin — a
 * writer-edited version is reused too (CAP-4: "the next generation with the
 * same inputsHash reuses that version"). */
export const findReusableBrief = internalQuery({
  args: findReusableBriefArgs,
  handler: findReusableBriefHandler,
});

export const pinSeedBrief = internalMutation({
  args: pinSeedBriefArgs,
  returns: v.union(v.id("generationBriefs"), v.null()),
  handler: pinSeedBriefHandler,
});

export const initializeSeedStage = internalMutation({
  args: initializeSeedStageArgs,
  returns: v.null(),
  handler: initializeSeedStageHandler,
});

/** AD-37: freeze ready decisions and enter the existing ordered chain. */
export const signOffSeedStage = mutation({
  args: signOffSeedStageArgs,
  handler: signOffSeedStageHandler,
});

export const beginSummaryRecovery = internalMutation({
  args: beginSummaryRecoveryArgs,
  returns: v.boolean(),
  handler: beginSummaryRecoveryHandler,
});

export const recordSeedInitializationFailure = internalMutation({
  args: recordSeedInitializationFailureArgs,
  returns: v.null(),
  handler: recordSeedInitializationFailureHandler,
});

export const retryInitializeSeedStage = mutation({
  args: retryInitializeSeedStageArgs,
  returns: v.null(),
  handler: retryInitializeSeedStageHandler,
});

// ─── Reordered start (owner decision 32, 2026-09-25) ─────────────────────────
// The Brief and the writer style open the seed stage; the analysis and Brain
// retrieval are prepared in the background and must be ready before sign-off.

/** Freeze the writer style Seeds read (`writer_style`), once, at startup. */
export const saveWriterStyle = internalMutation({
  args: saveWriterStyleArgs,
  returns: v.null(),
  handler: saveWriterStyleHandler,
});

/** Schedule attempt 1 of the background analysis and Brain retrieval. */
export const startDraftingInputs = internalMutation({
  args: startDraftingInputsArgs,
  returns: v.union(draftingInputsStatusValidator, v.null()),
  handler: startDraftingInputsHandler,
});

/** Whether a background attempt still counts (checked before paid calls). */
export const isDraftingInputsAttemptCurrent = internalQuery({
  args: draftingInputsAttemptArgs,
  returns: v.boolean(),
  handler: isDraftingInputsAttemptCurrentHandler,
});

/** Freeze the analysis and Brain blocks and mark the drafting inputs ready. */
export const completeDraftingInputs = internalMutation({
  args: completeDraftingInputsArgs,
  returns: v.union(v.literal("ready"), v.literal("ignored")),
  handler: completeDraftingInputsHandler,
});

/** The background attempt failed; the writer can retry it. */
export const failDraftingInputs = internalMutation({
  args: failDraftingInputsArgs,
  returns: v.null(),
  handler: failDraftingInputsHandler,
});

/** The background attempt's lease ran out without an answer. */
export const expireDraftingInputs = internalMutation({
  args: draftingInputsAttemptArgs,
  returns: v.null(),
  handler: expireDraftingInputsHandler,
});

/** The writer retries the transcript analysis (drafting inputs) after a failure. */
export const retryDraftingInputs = mutation({
  args: retryDraftingInputsArgs,
  returns: v.null(),
  handler: retryDraftingInputsHandler,
});

/** Reuse path: stamp the reused Brief onto this generation. No new version,
 * no model call. */
export const stampGenerationBriefId = internalMutation({
  args: stampGenerationBriefIdArgs,
  handler: stampGenerationBriefIdHandler,
});

/**
 * DW-109/DW-120: record what this generation's Brief stage attempt did. The
 * only writer of `generations.briefOutcome`; called once per stage by
 * `ai/brief.ts:runGenerationBriefStage`. The outcome and its authored progress
 * line commit in one patch, so telemetry and narration never disagree. Never
 * touches `briefId`.
 */
export const recordBriefOutcome = internalMutation({
  args: recordBriefOutcomeArgs,
  returns: v.null(),
  handler: recordBriefOutcomeHandler,
});

/** Pin step of the diff baseline: the project's newest Brief id, or `null`
 * when the project has no Brief yet. */
export const getBriefDiffBaselineId = internalQuery({
  args: getBriefDiffBaselineIdArgs,
  returns: v.union(v.id("generationBriefs"), v.null()),
  handler: getBriefDiffBaselineIdHandler,
});

/**
 * One page of a pinned Brief's diff baseline, in its own transaction: a
 * single `.paginate()` over `by_briefId`, at most `MAX_BRIEF_ENTRY_ROWS` rows
 * and `BRIEF_BASELINE_PAGE_BYTES` bytes read.
 *
 * Returns only live derived evidence (`liveBaselinePayload`), each row with
 * its `entryId` so the caller can send a compact reference instead of its
 * text when a candidate reuses its key.
 *
 * `readCount` is every row the page read before filtering. The caller must
 * discard a `SplitRequired` page (its rows may be incomplete) and re-read
 * from the same cursor with fewer rows; the baseline is complete only once
 * an accepted page reports `isDone`. Pages from separate transactions
 * enumerate one consistent live set because a published version's live rows
 * never change: both writers insert a whole version at once, nothing patches
 * or deletes entry rows, and the only later insert
 * (`completeOrderedSectionRun`'s `storylineQuestion`) is filtered out here.
 */
export const getBriefDiffBaselinePage = internalQuery({
  args: getBriefDiffBaselinePageArgs,
  returns: v.object({
    entries: v.array(
      v.object({
        entryId: v.id("generationBriefEntries"),
        ...briefCandidateEntryValidator.fields,
      })
    ),
    readCount: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
    pageStatus: v.union(
      v.literal("SplitRecommended"),
      v.literal("SplitRequired"),
      v.null()
    ),
  }),
  handler: getBriefDiffBaselinePageHandler,
});

/**
 * New-derivation path, and the only place a derived version is published —
 * atomically, in this one mutation. Called only through
 * `ai/brief.ts:publishDerivedBrief`, which read the complete diff baseline
 * page by page and already compared it with `entries` by `briefDiffKey`.
 *
 * 1. Reuse, before the project-wide fence or any candidate processing: if a
 *    same-key Brief now exists, stamp its latest stored version on this
 *    generation and return it. This transaction's indexed read serializes
 *    concurrent first publishers; only the first publishes version 1.
 * 2. Fence: `baselineBriefId` (or `null` for a project with no Brief) must
 *    still be the project's newest Brief. If a different-key version was
 *    published after the baseline was pinned, return `null` having written
 *    nothing; the caller re-reads and retries.
 * 3. Re-validate every candidate entry's citation against the live frozen
 *    source (defense in depth — the caller already validated against the
 *    same in-memory sources); drop failures and count them.
 * 4. Diff against that version's live rows, supplied in two parts so old text
 *    for a key the candidates reuse never travels: `baselineRetained` (a
 *    reference per live key some candidate shares) and `baselineRemoved` (the
 *    full payload of each live key no candidate shares). A validated entry
 *    whose key is in either part is `unchanged` (each baseline key matches
 *    once), otherwise `added`. Every unmatched `baselineRemoved` row becomes a
 *    "removed" marker. An unmatched retained reference — every candidate with
 *    its key failed re-validation — is read back and copied as a marker, but
 *    only if the row belongs to `baselineBriefId`, is live and has the
 *    referenced candidate's key; otherwise, like an out-of-range
 *    `candidateIndex`, the whole mutation aborts with INVALID_STATE.
 * 5. Insert the new `generationBriefs` version, its entries and markers, then
 *    stamp `briefId` on the generation.
 *
 * The argument therefore carries at most what this version writes, plus
 * candidates re-validation drops, plus one small reference per retained key.
 *
 * Never capped or truncated: a version whose entries plus markers exceed
 * `MAX_BRIEF_ENTRY_ROWS` is published in full, and generation consumers omit
 * it (`readBriefEntryRowsOrOmit`).
 */
export const persistDerivedBrief = internalMutation({
  args: persistDerivedBriefArgs,
  returns: v.union(v.id("generationBriefs"), v.null()),
  handler: persistDerivedBriefHandler,
});

/** The stored Brief rendered as an AD-11 delimited data block, ready to
 * append to a section prompt. "" when the generation has no Brief yet. */
export const renderBriefForGeneration = internalQuery({
  args: renderBriefForGenerationArgs,
  handler: renderBriefForGenerationHandler,
});

/** Create the three section-run slots: s242 queued, the rest pending. */
export const createSectionRuns = internalMutation({
  args: createSectionRunsArgs,
  handler: createSectionRunsHandler,
});

export const claimSectionRun = internalMutation({
  args: claimSectionRunArgs,
  handler: claimSectionRunHandler,
});

/** Persist a finished section draft: run → awaiting_review, generation →
 * awaiting_input (the writer's turn). */
export const completeSectionRun = internalMutation({
  args: completeSectionRunArgs,
  handler: completeSectionRunHandler,
});

export const failSectionRun = internalMutation({
  args: failSectionRunArgs,
  handler: failSectionRunHandler,
});

/** Frozen inputs for drafting one section: analyzer output, this section's
 * Brain block, the style guidance captured at start, and every approved
 * prior section (in order). Ghost drafts NEVER flow through here. */
export const getIterativeSectionInput = internalQuery({
  args: getIterativeSectionInputArgs,
  handler: getIterativeSectionInputHandler,
});

/** Capture the active attempt even when there is no report prose to evaluate. */
export const getPostQaAttempt = internalQuery({
  args: getPostQaAttemptArgs,
  handler: getPostQaAttemptHandler,
});

/** Input bundle for the post-assembly QA pass over the current report. */
export const getPostQaInput = internalQuery({
  args: getPostQaInputArgs,
  handler: getPostQaInputHandler,
});

/** Merge the post-assembly QA scorecard + chronology into agentOutputs. */
export const saveReportQa = internalMutation({
  args: saveReportQaArgs,
  handler: saveReportQaHandler,
});

/** Writer-facing retrigger: run (or re-run) the post-assembly QA pass. */
export const requestReportQa = mutation({
  args: requestReportQaArgs,
  handler: requestReportQaHandler,
});

/** Live state for the iterative stepper UI. */
export const getIterativeState = query({
  args: getIterativeStateArgs,
  handler: getIterativeStateHandler,
});

/**
 * Writer approves one section's (possibly edited) text. Over-limit text is
 * allowed — the CRA meters are advisory here; the writer is the QA. Approving
 * the last section assembles the final report.
 */
export const approveSectionDraft = mutation({
  args: approveSectionDraftArgs,
  handler: approveSectionDraftHandler,
});

/** Redraft one section, optionally steered by writer guidance. */
export const regenerateSectionDraft = mutation({
  args: regenerateSectionDraftArgs,
  handler: regenerateSectionDraftHandler,
});

/** Abandon an in-flight iterative generation and free the project. */
export const cancelIterativeGeneration = mutation({
  args: cancelIterativeGenerationArgs,
  handler: cancelIterativeGenerationHandler,
});

/** BNH-21: store the up-front time estimate + how many candidate drafts to expect. */
export const setGenerationEstimate = internalMutation({
  args: setGenerationEstimateArgs,
  handler: setGenerationEstimateHandler,
});

/** Drain lease-expired seed attempts in bounded pages under the existing cron owner. */
export const reapSeedBatchPage = internalMutation({
  args: reapSeedBatchPageArgs,
  returns: v.null(),
  handler: reapSeedBatchPageHandler,
});

/**
 * Ops utility: mark generations stranded in "running"/"pending" (e.g. by the
 * pre-fanout 10-minute action death) as failed and free their projects.
 * `npx convex run generations:failStaleGenerations '{"olderThanMinutes":30}'`
 *
 * The running scan is paged (DW-119 review): live ordered chains stay in the
 * `startedAt < cutoff` range while they progress, so a fixed first page could
 * hide a stalled generation behind them on every cron run. Each invocation
 * reads one bounded page and, when more remain, schedules itself with the
 * continuation cursor and the same cutoff — the same single recovery owner,
 * never a parallel reaper. Reserved rows, the orphaned-run sweep and the
 * project sweep run once, on the first page only.
 *
 * Single owner across cron ticks: the `staleGenerationScans` singleton names
 * the scan currently walking the range (a sequence number) and its pending
 * continuation job. A cursorless (cron or manual) invocation inspects that
 * job by id and, while it is pending or in progress, returns
 * `skipped: "scan_in_progress"` without starting a second chain; otherwise
 * (no job, or one that succeeded, failed or was canceled) it takes ownership
 * with the next sequence number. Every page stores the job it schedules in
 * the same transaction, and the last page clears it. A continuation page
 * whose sequence number the singleton no longer names is stale and returns
 * `skipped: "stale_continuation"` without reading or scheduling anything.
 */
export const failStaleGenerations = internalMutation({
  args: failStaleGenerationsArgs,
  returns: staleScanResultValidator,
  handler: failStaleGenerationsHandler,
});

/**
 * One page of the orphaned-project sweep (CAP-11): walk projects stuck in
 * "generating" through the by_status index, free every one that is older than
 * `cutoff` and has no live generation, then schedule the next page with the
 * continuation cursor. Each invocation reads at most one page, so the sweep
 * reaches every eligible project without a fixed cap or an unbounded
 * transaction. Scheduled by failStaleGenerations; also runnable directly:
 * `npx convex run generations:freeOrphanedGeneratingProjects '{"cutoff":<ms>}'`
 */
export const freeOrphanedGeneratingProjects = internalMutation({
  args: freeOrphanedGeneratingProjectsArgs,
  returns: v.object({
    freed: v.number(),
    scanned: v.number(),
    isDone: v.boolean(),
  }),
  handler: freeOrphanedGeneratingProjectsHandler,
});

/**
 * Cron reaper for the post-assembly QA pass (same failure mode as
 * failStaleGenerations): postQaStatus flips to "running" before runReportQa is
 * scheduled, and only saveReportQa ever moves it on — a hard action death
 * (deploy restart, timeout, OOM) leaves the QA panel spinning forever with the
 * Run button hidden, because requestReportQa refuses while a pass "is
 * running". Mark stale passes failed so the writer can re-run them. Rows from
 * before postQaStartedAt existed carry no timestamp and are treated as stale —
 * nothing can still be running them.
 * `npx convex run generations:failStalePostQa '{"olderThanMinutes":15}'`
 */
export const failStalePostQa = internalMutation({
  args: failStalePostQaArgs,
  returns: v.object({ failed: v.number() }),
  handler: failStalePostQaHandler,
});

/**
 * BNH-10 flywheel: record which Brain exemplars fed this generation — per
 * section, with raw first-stage/rerank scores and the sourceId behind each
 * entry (usefulness analytics + revocation forensics), plus the Haiku
 * retrieval brief that produced the queries (eval material).
 */
export const setBrainProvenance = internalMutation({
  args: setBrainProvenanceArgs,
  handler: setBrainProvenanceHandler,
});

/** Append a line to the live "thinking" log shown during generation. */
export const appendProgress = internalMutation({
  args: appendProgressArgs,
  handler: appendProgressHandler,
});

/**
 * Story 3 (CAP-8, AD-26): record the Writer Profile a generation ran under.
 * The only writer of `generations.writerSettings`; patches the generation
 * row only, never `projects` (AD-2).
 */
export const recordWriterSettings = internalMutation({
  args: recordWriterSettingsArgs,
  returns: v.null(),
  handler: recordWriterSettingsHandler,
});

// ─── Mutations called by the pipeline action ─────────────────────────────────

export const updateGenerationStatus = internalMutation({
  args: updateGenerationStatusArgs,
  handler: updateGenerationStatusHandler,
});

/** Candidate drafts for one explicitly named generation. Model identity
 * (model + label) is returned to every user with project access — the blind
 * A/B test is over. */
export const getCandidates = query({
  args: getCandidatesArgs,
  handler: getCandidatesHandler,
});

export const selectReportCandidate = mutation({
  args: selectReportCandidateArgs,
  handler: selectReportCandidateHandler,
});

/** Aggregate model-preference stats for the admin view. */
export const modelStats = query({
  args: modelStatsArgs,
  handler: modelStatsHandler,
});

export const getModelComments = internalQuery({
  args: getModelCommentsArgs,
  handler: getModelCommentsHandler,
});

// ─── BNH-48: writer's per-option scores on the selection screen ──────────────

/** Upsert the writer's 1–10 score for a candidate option. Model/label/QA score
 *  are copied onto the row because candidates are deleted after selection. */
export const scoreCandidate = mutation({
  args: scoreCandidateArgs,
  handler: scoreCandidateHandler,
});

/** The signed-in writer's scores for an explicitly named generation. */
export const getMyCandidateScores = query({
  args: getMyCandidateScoresArgs,
  handler: getMyCandidateScoresHandler,
});

export const getCandidateScoreSummary = query({
  args: getCandidateScoreSummaryArgs,
  handler: getCandidateScoreSummaryHandler,
});

/** One row per section in Build Order (first queued, rest pending), then the
 * first section's action, scheduled atomically with the rows. */
export const createOrderedSectionRuns = internalMutation({
  args: createOrderedSectionRunsArgs,
  returns: v.boolean(),
  handler: createOrderedSectionRunsHandler,
});

/** CAS claim of one queued section (row queued, candidate run running,
 * generation running, project pointer matching). Returns this candidate's
 * drafted prior sections in production order and the Brief it checks
 * against, or null when the claim is stale. */
export const claimOrderedSectionRun = internalMutation({
  args: claimOrderedSectionRunArgs,
  handler: claimOrderedSectionRunHandler,
});

/** The chain payload a scheduled action was handed by id (2026-09-25). */
export const getOrderedPayload = internalQuery({
  args: getOrderedPayloadArgs,
  returns: v.union(orderedPayloadValidator, v.null()),
  handler: getOrderedPayloadHandler,
});

/** Persist one finished section (draft, metrics, Self-check summary, slot
 * counts, its Compliance Note rows, at most one Storyline question) and
 * schedule the next section — or finalize when the order is exhausted or the
 * writer asked to stop. */
export const completeOrderedSectionRun = internalMutation({
  args: completeOrderedSectionRunArgs,
  returns: v.boolean(),
  handler: completeOrderedSectionRunHandler,
});

/** A section action failed outright: fail the section, mark the sections
 * after it undrafted, and fail the candidate through completeCandidateRun's
 * own body. */
export const failOrderedSectionRun = internalMutation({
  args: failOrderedSectionRunArgs,
  returns: v.null(),
  handler: failOrderedSectionRunHandler,
});

/** Store the consistency pass's rows once per candidate and stamp
 * consistencyCheckedAt, which releases the last section to the writer. */
export const insertConsistencyNotes = internalMutation({
  args: insertConsistencyNotesArgs,
  returns: v.boolean(),
  handler: insertConsistencyNotesHandler,
});

/** Finalize input: this candidate's section rows in production order. */
export const getOrderedCandidateDrafts = internalQuery({
  args: getOrderedCandidateDraftsArgs,
  handler: getOrderedCandidateDraftsHandler,
});

/**
 * The writer stops an ungated single/compare generation (AD-24), or a
 * signed-off seed run (FR-43, CAP-17). Same CAS on activeGenerationId as
 * cancelIterativeGeneration. The section in progress finishes and is kept, no
 * further section is scheduled, and the generation completes with
 * stoppedAfterSection and [NOT GENERATED] bodies. Idempotent.
 *
 * Seed runs need report edit access and record a "stop" seed event. Stop
 * takes effect at Section boundaries, so the outcome is deterministic:
 * - accepted while a Section is still queued or being written: that Section
 *   finishes and is kept; no later Section starts. If it was the last one,
 *   every Section is drafted, the consistency pass runs as usual and the
 *   complete draft gets its background QA (it is not a stopped draft);
 * - refused with INVALID_STATE reason DRAFT_COMPLETE once every Section is
 *   already drafted (the consistency pass or report creation is running):
 *   nothing is left to stop, and the complete draft finishes as usual.
 * Before sign-off a seed generation is cancelled, never stopped.
 */
export const stopOrderedGeneration = mutation({
  args: stopOrderedGenerationArgs,
  returns: v.null(),
  handler: stopOrderedGenerationHandler,
});

/**
 * Drafted sections of an ungated single/compare generation, in production
 * order, for rendering sections as they complete. The last section in a
 * candidate's order is withheld until that candidate's consistency pass is
 * recorded (AD-24). Iterative generations have no ordered rows.
 */
export const getOrderedSectionDrafts = query({
  args: getOrderedSectionDraftsArgs,
  handler: getOrderedSectionDraftsHandler,
});

/**
 * Honest writing progress for a signed-off seed generation (FR-42, CAP-17):
 * one row per Section in production order, driven by the per-Section run
 * rows, never by tokens. Rules:
 * - `done` means drafted AND checked. The last Section in production order
 *   stays `writing` (paragraphs withheld) until the consistency pass is
 *   recorded; during a redraft the last redrafted Section stays `writing`
 *   until the redraft is written into the report.
 * - `percent` counts done Sections, plus the elapsed share of the Section
 *   being written against the estimate, capped at 95% of that Section, so it
 *   only moves forward while a run is live; a completed draft reads 100.
 *   A new redraft run starts again from the Sections already done.
 * - The per-Section estimate is the mean duration of this run's finished
 *   Sections, or DEFAULT_SECTION_DRAFT_MS before any finished; the
 *   consistency pass adds DEFAULT_CONSISTENCY_PASS_MS.
 * - A completed run is judged by its report bodies: a Section the writer
 *   filled by hand counts as `done` (its paragraphs are the report text), a
 *   drafted Section whose body is still the placeholder counts as
 *   `not_drafted`, and the phase is `completed` once no body is the
 *   placeholder. `redraft` reports the latest "Draft the rest" attempt.
 * Bounded reads: the generation, access checks, at most 10 Section rows, one
 * candidate run and, for a completed run, its report. Returns null when this is not a signed-off seed
 * generation or the caller has no internal project access.
 */
export const getSeedDraftProgress = query({
  args: getSeedDraftProgressArgs,
  handler: getSeedDraftProgressHandler,
});

/**
 * "Draft the rest" after Stop (owner decision 20, PRD FR-43, CAP-17). Drafts
 * only the Sections the stop left "Not drafted", from the same frozen Summary
 * version and frozen inputs, and writes them into the SAME report without
 * touching any other Section. Requires report edit access.
 *
 * - Only a completed, signed-off seed generation with a report qualifies; a
 *   Section counts as missing when its report body is still exactly the
 *   `[NOT GENERATED]` placeholder. A missing Section whose run row was not
 *   drafted is drafted again; one an earlier attempt drafted but never wrote
 *   into the report (its action died) is carried into this attempt as it is
 *   and written with it. A Section the writer filled by hand is never
 *   redrafted.
 * - Each attempt schedules a fenced expiry (expireStaleRedraft), so an
 *   attempt whose action died settles as `failed` on its own and every
 *   subscribed page sees it.
 * - Idempotent and one at a time: while a redraft attempt is live the call
 *   returns `running` with its Sections; when nothing is missing it returns
 *   `nothing_to_draft`. A redraft with no progress for REDRAFT_STALE_MS is
 *   replaced by a fresh attempt; the old attempt's writes are fenced out.
 * - Refused while another generation is active for the project.
 */
export const redraftMissingSections = mutation({
  args: redraftMissingSectionsArgs,
  returns: v.object({
    status: v.union(
      v.literal("started"),
      v.literal("running"),
      v.literal("nothing_to_draft")
    ),
    sections: v.array(sectionNumberValidator),
  }),
  handler: redraftMissingSectionsHandler,
});

/** CAS claim of one queued redraft Section. Prior Sections are the report's
 * current text (the writer's edits included), or this attempt's own drafts
 * for Sections it has redrafted but not yet written. */
export const claimRedraftSection = internalMutation({
  args: claimRedraftSectionArgs,
  handler: claimRedraftSectionHandler,
});

/** Persist one redrafted Section, then schedule the next one or the redraft
 * finalizer. The report is not touched until every Section of the attempt is
 * drafted (or the attempt fails). */
export const completeRedraftSection = internalMutation({
  args: completeRedraftSectionArgs,
  returns: v.boolean(),
  handler: completeRedraftSectionHandler,
});

/** A redraft Section failed: it and the Sections after it stay Not drafted,
 * and any Section this attempt already drafted is written into the report. */
export const failRedraftSection = internalMutation({
  args: failRedraftSectionArgs,
  returns: v.null(),
  handler: failRedraftSectionHandler,
});

/**
 * Fenced expiry of one redraft attempt, scheduled when it starts. An attempt
 * that made progress within REDRAFT_STALE_MS is checked again when that
 * window ends; one that went quiet (its action died) settles as `failed`:
 * Sections it already drafted are written into the report, the rest stay Not
 * drafted, and every subscribed page sees the change. A settled or replaced
 * attempt is left alone.
 */
export const expireStaleRedraft = internalMutation({
  args: expireStaleRedraftArgs,
  returns: v.null(),
  handler: expireStaleRedraftHandler,
});

/** Finalizer input: the attempt's rows, the report's current Section text
 * and the frozen Brief the consistency pass checks against. */
export const getSeedRedraftInput = internalQuery({
  args: getSeedRedraftInputArgs,
  handler: getSeedRedraftInputHandler,
});

/** Store the redraft's consistency rows (when the report became complete)
 * and write the redrafted Sections into the report.
 *
 * `checked` is the Section text the consistency pass read. When the report
 * no longer produces that text (the writer or another client saved while the
 * provider call ran), the findings describe prose that is gone: nothing is
 * stored or written, the attempt's progress clock is refreshed, and the
 * result is `report_changed` so the finalizer reruns the pass on the new
 * text. */
export const applySeedRedraft = internalMutation({
  args: applySeedRedraftArgs,
  returns: v.union(v.literal("applied"), v.literal("fenced"), v.literal("report_changed")),
  handler: applySeedRedraftHandler,
});

/**
 * Fill the typed copies (`metricsData`, `qaData`, `selfCheckData`,
 * `slotCountsData`) of older `generationSectionRuns` rows from their JSON
 * strings. A string that does not convert strictly is left as the only form
 * and keeps being read through the string fallback.
 * `npx convex run generations:backfillSectionRunData '{}'`
 */
export const backfillSectionRunData = internalMutation({
  args: backfillSectionRunDataArgs,
  returns: v.object({
    scanned: v.number(),
    patched: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: backfillSectionRunDataHandler,
});

/**
 * Copy each older generation's `progressLog` array into `generationProgress`
 * rows (the newest PROGRESS_BACKFILL_MAX_LINES lines, in order, stamped at the
 * generation's request time so they sort before any line written since) and
 * stamp `progressLogCopiedAt`, after which readers use the child rows alone.
 * The array itself is kept. Rows already stamped, rows without an array and
 * projects in deletion are skipped, so a second run copies nothing.
 * `npx convex run generations:backfillGenerationProgress '{}'`
 */
export const backfillGenerationProgress = internalMutation({
  args: backfillGenerationProgressArgs,
  returns: v.object({
    scanned: v.number(),
    copiedGenerations: v.number(),
    copiedLines: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: backfillGenerationProgressHandler,
});

/**
 * 2026-09-25: move older generations' outputs (agent outputs, Brain
 * provenance, retrieval brief) into generationArtifacts rows.
 * `npx convex run generations:backfillGenerationOutputs '{}'`
 */
export const backfillGenerationOutputs = internalMutation({
  args: backfillGenerationOutputsArgs,
  returns: v.object({
    scanned: v.number(),
    moved: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: backfillGenerationOutputsHandler,
});

/** The newest recorded QA result of a generation and whether it still
 * describes the report (2026-09-25). */
export const getGenerationQaResult = query({
  args: getGenerationQaResultArgs,
  handler: getGenerationQaResultHandler,
});
