/**
 * Reserving a generation: model choice, frozen sources, the reservation row,
 * and the retry, Summary recovery and failed-candidate recovery entry
 * points.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { storedSourceTextVersion, type SourceTextOwner } from "../sourceText";
import { TransactionGuard, countedRows } from "../readMeter";
import { PROJECT_STILL_COPYING_MESSAGE, projectCopyInProgress } from "../projectCopy";
import { getDocumentSize, v, type ObjectType, type Value } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import type { ModelFreeze } from "../modelCatalogValidators";
import { type ModelEntry, MODEL } from "../../../shared/generationModels";
import {
  entryFromFrozen,
  selectableModelIdFor,
  catalogEntry,
  listSelectableModels,
  freezeModelsForGeneration,
  generationModelFreeze,
  movedBackModels,
  movedBackProgress,
  movedBackReplacement,
  retryComparePair,
  compareRetryProgress,
} from "../modelRoles";
import { domainError, sha256 } from "../contracts";
import { resolveCompareModels, randomComparePair } from "../../ai/model";
import { structureRebuildDue } from "../transcripts";
import type { Doc, Id } from "../../_generated/dataModel";
import { defaultModelId, transcriptFactsMode, transcriptPlaceholdersEnabled } from "../../appSettings";
import { normalizeCraScienceCode } from "../../../shared/craScienceCodes";
import {
  isPreviousYearDocument,
  PREVIOUS_YEAR_ONLY_MESSAGE,
  PREVIOUS_YEAR_ONLY_REASON,
  PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE,
} from "../../../shared/previousYear";
import {
  requireAnthropicConfigured,
  requireOpenRouterConfigured,
} from "../providerConfig";
import { findActiveGeneration } from "../activeGeneration";
import { ACTIVE_GENERATION_STATUSES } from "../../../shared/generationTransitions";
import {
  currentYearTranscripts,
  decideInputMode,
  frozenPlaceholders,
  frozenSourceFields,
  frozenTranscriptChars,
  MAX_FROZEN_SOURCE_ROWS,
  selectFrozenEvidence,
  refuseWhenCompanyLeft,
  type FrozenEvidence,
} from "../briefEvidence";
import { appendGenerationProgress } from "../generationProgress";
import { refreshProjectGenerationActivity } from "../dashboardProjection";
import { internal } from "../../_generated/api";
import { requireInternalActor } from "../auth";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { requireReportEditAccess } from "../roleCapabilities";
import { requireProjectSetUp } from "../intakeDrafts";
import { limitGenerationStart } from "../aiRateLimits";
import { assertFrozenSourceBijection, resolveFrozenSourceId } from "../seedRevisions";
import { startSummaryRecoveryRef } from "./seedStage";
import { transitionGeneration } from "../generationTransitions";
import { restorableProjectStatus } from "./restoreStatus";
import { userDisplayLabel } from "../teamRoster";
import type { QueryCtx } from "../../_generated/server";
import { copyRecoverySourceUses } from "./sourceUse";
import { frozenClaimantName } from "../transcriptPlaceholders";

/**
 * The user-safe summary of a project's active run (F6): who started it, which
 * mode and when. No model, source or error detail.
 */

/**
 * B1, second part, after its review (2026-10-27): freezing a draft's
 * evidence (every transcript row, file row and text piece read, and the new
 * stored text written) stays within a transaction's 16 MiB of reads and of
 * writes. Before each read and each stored text, the transaction's real
 * usage is checked: once what remains could not take one more largest
 * document and this margin for the rest of the work, the draft is refused by
 * name, before the platform's limit, and nothing is written. Where the
 * runtime cannot report its usage, reads and writes are counted instead and
 * refused past the estimate limit.
 */
export const FROZEN_MARGIN_BYTES = 256 * 1024;
export const FROZEN_ESTIMATE_LIMIT_BYTES = 15 * 1024 * 1024;
/**
 * Every current transcript and file row is read whether it is left out or
 * not, so the way out is removing what the project no longer needs (round 2
 * of the review).
 */
export const FROZEN_TEXT_TOO_LARGE_MESSAGE =
  "This project's files are too large to read at once. Remove files or transcripts you no longer need, then start again.";
/**
 * B1 review, round 3: a Summary recovery copies the failed draft's frozen
 * rows, and older rows hold their own copies, so removing project files
 * cannot make it smaller.
 */
export const RECOVERY_TOO_LARGE_MESSAGE =
  "This draft's frozen files are too large to recover at once. Start a new draft instead; you will sign off its Summary again.";
export async function activeRunSummary(
  ctx: QueryCtx,
  active: Doc<"generations">
): Promise<{
  generationId: Id<"generations">;
  requestedBy: Id<"users"> | null;
  requestedByName: string;
  candidateMode: CandidateMode;
  startedAt: number;
}> {
  const requester = active.requestedBy ? await ctx.db.get(active.requestedBy) : null;
  return {
    generationId: active._id,
    requestedBy: active.requestedBy ?? null,
    requestedByName: requester ? userDisplayLabel(requester) : "Someone",
    candidateMode: active.candidateMode ?? "compare",
    startedAt: active.startedAt,
  };
}

/** Refuses a start while a run is active, naming it in user-safe details. */
async function refuseActiveGeneration(ctx: MutationCtx, active: Doc<"generations">): Promise<never> {
  const summary = await activeRunSummary(ctx, active);
  domainError("GENERATION_ACTIVE", "A generation is already active for this project", {
    generationId: summary.generationId,
    requestedByName: summary.requestedByName,
    candidateMode: summary.candidateMode,
    startedAt: String(summary.startedAt),
  });
}

export const lengthTargetValidator = v.union(
  v.literal("concise"),
  v.literal("standard"),
  v.literal("full")
);

export const candidateModeValidator = v.union(
  v.literal("compare"),
  v.literal("single"),
  v.literal("iterative")
);

export const singleModelIdValidator = v.string();

export type CandidateMode = "compare" | "single" | "iterative";

/** At most this many ids per leave-out list (conflict 14). */
export const MAX_EXCLUDED_SOURCES = 250;

export const excludedIdsArgs = {
  excludeDocumentIds: v.optional(v.array(v.id("projectDocuments"))),
  excludeTranscriptIds: v.optional(v.array(v.id("transcripts"))),
  // 2026-10-26 (Phase C): the project's company's files left out.
  excludeCompanyFileIds: v.optional(v.array(v.id("companyFiles"))),
};

export type ExcludedSources = {
  documentIds: Id<"projectDocuments">[];
  transcriptIds: Id<"transcripts">[];
  /** Present only when a company file is left out. */
  companyFileIds?: Id<"companyFiles">[];
};

/**
 * The files a writer unticked in the start dialog (decision 56). Ids from
 * another project are refused and nothing is written; a deleted or archived
 * row is ignored (it is not a source anyway). Returns undefined when nothing
 * is left out, so an ordinary start stores no field.
 */
export async function validatedExcludedSources(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  args: {
    excludeDocumentIds?: Id<"projectDocuments">[];
    excludeTranscriptIds?: Id<"transcripts">[];
    excludeCompanyFileIds?: Id<"companyFiles">[];
  },
  /**
   * False for a draft's start: reservation checks the file and transcript
   * ids against the rows it reads anyway (`confirmedExcludedRows`), so no
   * left-out row is read twice (B1 review, round 2).
   */
  options: { checkProjectRows?: boolean } = {}
): Promise<ExcludedSources | undefined> {
  const checkProjectRows = options.checkProjectRows ?? true;
  const documentIds = [...new Set(args.excludeDocumentIds ?? [])];
  const transcriptIds = [...new Set(args.excludeTranscriptIds ?? [])];
  const companyFileIds = [...new Set(args.excludeCompanyFileIds ?? [])];
  if (
    documentIds.length > MAX_EXCLUDED_SOURCES ||
    transcriptIds.length > MAX_EXCLUDED_SOURCES ||
    companyFileIds.length > MAX_EXCLUDED_SOURCES
  ) {
    domainError("INVALID_INPUT", `Leave out at most ${MAX_EXCLUDED_SOURCES} files of each kind`);
  }
  const keptDocuments: Id<"projectDocuments">[] = [];
  for (const id of documentIds) {
    if (!checkProjectRows) {
      keptDocuments.push(id);
      continue;
    }
    const row = await ctx.db.get(id);
    if (!row) continue;
    if (row.projectId !== projectId) domainError("INVALID_INPUT", "A left-out file belongs to another project");
    keptDocuments.push(id);
  }
  const keptTranscripts: Id<"transcripts">[] = [];
  for (const id of transcriptIds) {
    if (!checkProjectRows) {
      keptTranscripts.push(id);
      continue;
    }
    const row = await ctx.db.get(id);
    if (!row) continue;
    if (row.projectId !== projectId) domainError("INVALID_INPUT", "A left-out transcript belongs to another project");
    keptTranscripts.push(id);
  }
  // A company file must be the project's company's (Phase C).
  const keptCompanyFiles: Id<"companyFiles">[] = [];
  if (companyFileIds.length > 0) {
    const project = await ctx.db.get(projectId);
    for (const id of companyFileIds) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      if (!project?.clientId || row.clientId !== project.clientId) {
        domainError("INVALID_INPUT", "A left-out file belongs to another company");
      }
      keptCompanyFiles.push(id);
    }
  }
  if (keptDocuments.length === 0 && keptTranscripts.length === 0 && keptCompanyFiles.length === 0) return undefined;
  return {
    documentIds: keptDocuments,
    transcriptIds: keptTranscripts,
    ...(keptCompanyFiles.length > 0 ? { companyFileIds: keptCompanyFiles } : {}),
  };
}

/**
 * Entries for `ids` as a mutation sees them: frozen on `freeze` when the
 * retried generation carried one, else the catalog's selectable set. A
 * superseded id a stale client sends (2026-10-22 decision) resolves to its
 * track's current model, so the entry's id can differ from the key. Never
 * the runtime registry, which only actions write.
 */
export async function modelEntriesFor(
  ctx: MutationCtx,
  ids: readonly string[],
  freeze?: ModelFreeze
): Promise<Map<string, ModelEntry>> {
  const entries = new Map<string, ModelEntry>();
  for (const id of new Set(ids)) {
    const frozen = freeze?.entries.find((entry) => entry.id === id);
    if (frozen) {
      entries.set(id, entryFromFrozen(frozen));
      continue;
    }
    const selectable = await selectableModelIdFor(ctx, id);
    if (!selectable) continue;
    const entry = await catalogEntry(ctx, selectable);
    if (entry) entries.set(id, entry);
  }
  return entries;
}

/** Single and iterative modes both run exactly one explicitly chosen model
 * (defaulting to the writing role's model when unset). A superseded id is
 * mapped to its track's current model rather than refused. */
export async function validatedSingleModelId(
  ctx: MutationCtx,
  candidateMode: CandidateMode,
  singleModelId: string | undefined
): Promise<string | undefined> {
  if (candidateMode === "compare" || !singleModelId) return undefined;
  const selectable = await selectableModelIdFor(ctx, singleModelId);
  if (!selectable) domainError("INVALID_INPUT", "Select a supported generation model");
  return selectable;
}

/** A retry keeps its model when it was frozen on the generation being
 * retried, else takes the model's track's current version; otherwise the
 * retry takes today's default. */
export async function persistedSingleModelId(
  ctx: MutationCtx,
  candidateMode: CandidateMode,
  singleModelId: string | undefined,
  freeze: ModelFreeze | undefined
): Promise<string | undefined> {
  if (candidateMode === "compare" || !singleModelId) return undefined;
  return (await modelEntriesFor(ctx, [singleModelId], freeze)).get(singleModelId)?.id;
}

/** Mirrors validatedSingleModelId: only meaningful in compare mode; when the
 *  writer picks explicitly it must be exactly 2 distinct known model ids. */
export async function validatedCompareModelIds(
  ctx: MutationCtx,
  candidateMode: CandidateMode,
  compareModelIds: string[] | undefined
): Promise<string[] | undefined> {
  if (candidateMode !== "compare" || !compareModelIds) return undefined;
  const entries = await modelEntriesFor(ctx, compareModelIds);
  const resolved = resolveCompareModels(compareModelIds, (id) => entries.get(id));
  if (!resolved) {
    domainError("INVALID_INPUT", "Pick exactly two models to compare");
  }
  return resolved.map((model) => model.id);
}

/**
 * Whether a generation feeds the model the full frozen transcript text or a
 * stored digest per transcript. Pure and total over the combined frozen
 * character count (convex/lib/briefEvidence.ts, shared with the Brief
 * preparation since 2026-09-26).
 */
export { decideInputMode } from "../briefEvidence";

/**
 * A draft's leave-out list, checked as `validatedExcludedSources` checks it,
 * against the file and transcript rows reservation already read under its
 * guard: an id among them is the project's; any other id is read under the
 * guard, refused when it is another project's and dropped when it is gone.
 */
async function confirmedExcludedRows(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  excluded: ExcludedSources,
  evidence: FrozenEvidence,
  guard: TransactionGuard
): Promise<ExcludedSources | undefined> {
  const documentsRead = new Set<string>(evidence.documentIdsRead ?? []);
  const transcriptsRead = new Set<string>(evidence.transcriptIdsRead ?? []);
  const documentIds: Id<"projectDocuments">[] = [];
  for (const id of excluded.documentIds) {
    if (!documentsRead.has(id)) {
      await guard.beforeRead();
      const row = await ctx.db.get(id);
      guard.read(row);
      if (!row) continue;
      if (row.projectId !== projectId) domainError("INVALID_INPUT", "A left-out file belongs to another project");
    }
    documentIds.push(id);
  }
  const transcriptIds: Id<"transcripts">[] = [];
  for (const id of excluded.transcriptIds) {
    if (!transcriptsRead.has(id)) {
      await guard.beforeRead();
      const row = await ctx.db.get(id);
      guard.read(row);
      if (!row) continue;
      if (row.projectId !== projectId) domainError("INVALID_INPUT", "A left-out transcript belongs to another project");
    }
    transcriptIds.push(id);
  }
  const companyFileIds = excluded.companyFileIds ?? [];
  if (documentIds.length === 0 && transcriptIds.length === 0 && companyFileIds.length === 0) return undefined;
  return { documentIds, transcriptIds, ...(companyFileIds.length > 0 ? { companyFileIds } : {}) };
}

export async function reserveGeneration(
  ctx: MutationCtx,
  project: Doc<"projects">,
  requestedBy: Id<"users">,
  lengthTarget: "concise" | "standard" | "full",
  candidateMode: CandidateMode,
  explicitSingleModelId?: string,
  compareModelIds?: string[],
  retryOfGenerationId?: Id<"generations">,
  retryModelIds?: string[],
  seededCandidates = 0,
  // Story 1 (CAP-1/2/4): frozen verbatim as a `writer_storyline`
  // generationSources row — never validated, parsed, or rejected — and used
  // as-is by the Brief stage (origin "writer"). Excluded from `inputsHash`.
  writerSuppliedStoryline?: string,
  preservedGatedWorkflow?: "sections" | "seeds",
  // The generation's first progress lines (a recovery names what it kept).
  initialProgress: readonly string[] = ["Generation request reserved."],
  // Files the writer left out of this run (decision 56). Stored on the
  // generation so a retry freezes the same selection.
  excludedSources?: ExcludedSources,
  // Audit wave 2: spend the caller's generation-start tokens once every
  // refusal below has had its say, just before the first write. False when
  // the caller already spent them before writes of its own.
  spendRateLimit = true,
  // B1 review, round 3: true only for a leave-out list the writer just
  // sent (a draft's start), whose file and transcript ids are checked here
  // against the rows read anyway. A retry's stored list was checked when it
  // was made and is kept as it is.
  confirmExcludedRows = false
) {
  // "Default" in single/iterative modes resolves to the writing role's model
  // (model catalog), persisted here so retries reuse the same model even if
  // the role switches later.
  const singleModelId =
    candidateMode === "compare"
      ? undefined
      : (explicitSingleModelId ?? (await defaultModelId(ctx)));
  const retried = retryOfGenerationId ? await ctx.db.get(retryOfGenerationId) : null;
  const retriedFreeze = retried?.modelFreeze;
  // F2 (2026-10-27, owner question 3 pending): a draft never reads a
  // project whose files are still being copied into it.
  if (await projectCopyInProgress(ctx, project._id)) {
    domainError("INVALID_STATE", PROJECT_STILL_COPYING_MESSAGE, { reason: "PROJECT_STILL_COPYING" });
  }
  // The source rules below and the frozen sources run on what remains after
  // the leave-out list (decision 56). Shared with the Brief preparation
  // (decision 65), so both freeze the same bytes in the same order.
  const frozenLimits = new TransactionGuard(
    ctx,
    { marginBytes: FROZEN_MARGIN_BYTES, estimateLimitBytes: FROZEN_ESTIMATE_LIMIT_BYTES },
    () => domainError("INVALID_INPUT", FROZEN_TEXT_TOO_LARGE_MESSAGE)
  );
  const evidence = await selectFrozenEvidence(ctx, project._id, excludedSources, frozenLimits);
  const { transcripts } = evidence;
  const confirmedExcluded =
    excludedSources && confirmExcludedRows
      ? await confirmedExcludedRows(ctx, project._id, excludedSources, evidence, frozenLimits)
      : excludedSources;
  // Jul 17 meeting: some engagements have no interview at all (spreadsheet
  // only, drawings, a single email). A transcript-less generation is allowed
  // as long as there's at least one readable context document to work from.
  const thisYearTranscripts = await currentYearTranscripts(ctx, project, transcripts, frozenLimits);
  // 2026-10-27 (twelfth, owner): Previous-year status is skipped when the
  // draft reads nothing from a previous year (the project's first year, or
  // no previous-year files): no previous-year report or note, project or
  // company, and no transcript copied from an earlier fiscal year.
  const previousYearMaterial =
    evidence.frozenDocuments.some((item) => isPreviousYearDocument(item.document)) ||
    evidence.frozenCompanyFiles.some((item) => isPreviousYearDocument(item.file)) ||
    thisYearTranscripts.length < transcripts.length;
  if (thisYearTranscripts.length === 0) {
    // The files this draft reads (not archived, with text, not left out),
    // already loaded: reading every row again could pass a transaction's
    // reads (B1 review, 2026-10-27).
    const usable = evidence.frozenDocuments.map((item) => item.document);
    if (usable.length === 0 && transcripts.length === 0) {
      domainError(
        "INVALID_INPUT",
        "Add an interview transcript or at least one context document with readable text"
      );
    }
    // Decision 42 (2026-09-25): last year's report alone is not a source
    // for this year's report, and neither are last year's transcripts a
    // duplicate copied (lead note, 2026-09-25). Checked before any paid call
    // is scheduled.
    if (usable.every(isPreviousYearDocument)) {
      domainError(
        "INVALID_INPUT",
        transcripts.length > 0 ? PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE : PREVIOUS_YEAR_ONLY_MESSAGE,
        { reason: PREVIOUS_YEAR_ONLY_REASON }
      );
    }
  }
  if (
    project.scienceCode?.trim() &&
    !normalizeCraScienceCode(project.scienceCode)
  ) {
    domainError(
      "INVALID_INPUT",
      "Project science code is not a valid CRA T4088 line 206 code"
    );
  }
  // Anthropic is always required (retrieval brief + ghost draft run on it).
  requireAnthropicConfigured("generation");

  const active = await findActiveGeneration(ctx, project, ACTIVE_GENERATION_STATUSES);
  if (active) await refuseActiveGeneration(ctx, active);

  // Compare mode always persists its model pair so a retry reuses the exact
  // same pair (Math.random in a mutation is fine — the result is durable).
  const compareEntries = await modelEntriesFor(ctx, compareModelIds ?? [], retriedFreeze);
  const persistedCompareModelIds =
    candidateMode === "compare"
      ? (
          resolveCompareModels(compareModelIds, (id) => compareEntries.get(id)) ??
          randomComparePair(await listSelectableModels(ctx))
        ).map((model) => model.id)
      : undefined;
  const persistedRetryModelIds = retryModelIds?.filter((id) =>
    persistedCompareModelIds?.some((modelId) => modelId === id)
  );
  if (retryModelIds && (!persistedRetryModelIds || persistedRetryModelIds.length === 0)) {
    domainError("INVALID_INPUT", "No failed models are available to retry");
  }

  // OpenRouter key is only required when a selected model routes through it —
  // fail here with a clear error instead of mid-generation.
  const requestedModelIds =
    candidateMode === "compare"
      ? (persistedCompareModelIds ?? [])
      : [singleModelId ?? MODEL]; // singleModelId is always resolved here; ?? is a type guard
  const now = Date.now();
  // Every model this generation will call, frozen now (owner decision 21):
  // a retry inherits its original's freeze when it runs the same models,
  // unless the freeze holds a model its tier was moved back from
  // (2026-10-23): then the retry freezes today's models.
  const modelFreeze =
    retriedFreeze &&
    requestedModelIds.every((id) => retriedFreeze.entries.some((entry) => entry.id === id)) &&
    (await movedBackModels(ctx, retried)).length === 0
      ? retriedFreeze
      : await freezeModelsForGeneration(ctx, requestedModelIds, now);
  if (
    modelFreeze.entries.some(
      (entry) =>
        entry.gateway === "openrouter" &&
        (requestedModelIds.includes(entry.id) ||
          Object.values(modelFreeze.roles).includes(entry.id))
    )
  ) {
    requireOpenRouterConfigured();
  }
  // Audit wave 2: 12 an hour and 40 a firm day per user, 6 an hour per project.
  if (spendRateLimit) await limitGenerationStart(ctx, requestedBy, project._id);

  // Owner decision 26: every generation-owned provider call reads
  // placeholders, never names; the map is frozen here so every call of this
  // generation (and its cached prefixes) sees the same bytes. The speakers'
  // names are parsed from the transcripts' text here, so a draft started
  // before the scheduled turn build has written the speaker rows still hides
  // them (review 2026-09-25: three demo drafts started 28 to 53 ms after
  // their transcript was saved sent the speakers' names). It is checked
  // against every text the calls will send, so a source that already holds
  // placeholder-style tokens never has them restored into names.
  const placeholders = await frozenPlaceholders(
    ctx,
    project,
    evidence,
    writerSuppliedStoryline ? [writerSuppliedStoryline] : []
  );
  const inputMode = decideInputMode(frozenTranscriptChars(evidence));
  // Owner decision 27: fact packs for long transcripts (`long`), small
  // projects too only once the offline evaluation passes (`all`). Frozen
  // here; with facts missing or failed the generation falls back to today's
  // digest or full-text path.
  const factsMode = await transcriptFactsMode(ctx);
  const transcriptFacts =
    transcripts.length > 0 &&
    (factsMode === "all" || (factsMode === "long" && inputMode === "digest"));
  if (transcriptFacts) {
    // Turns an older parser built are not read as facts: this draft falls
    // back for them, and their rebuild starts now for the next one.
    // Started in their own transactions (B1 review, round 2): marking a row
    // here would read each whole transcript a second time.
    for (const row of transcripts) {
      if (structureRebuildDue(row)) {
        await ctx.scheduler.runAfter(0, internal.transcripts.rebuildStructureIfStale, { transcriptId: row._id });
      }
    }
  }
  const generationId = await ctx.db.insert("generations", {
    projectId: project._id,
    transcriptId: transcripts[0]?._id,
    transcriptIds: transcripts.map((row) => row._id),
    inputMode,
    ...(transcriptFacts ? { transcriptFacts: true } : {}),
    ...(placeholders.length > 0 ? { placeholders } : {}),
    // 2026-10-30 (owner, item 2): the claimant's name, frozen with the map
    // and, review round 1 (P1-a), with the placeholder switch.
    ...(frozenClaimantName(project.clientName) ? { claimantName: frozenClaimantName(project.clientName) } : {}),
    ...((await transcriptPlaceholdersEnabled(ctx)) ? {} : { placeholdersOff: true }),
    status: "reserved",
    // 2026-09-25: this generation's outputs live in generationArtifacts rows.
    outputsInArtifactsAt: now,
    requestedAt: now,
    requestedBy,
    learningDigestIds: [],
    lengthTarget,
    candidateMode,
    // Stories 5-6 connect the shipped seed pipeline for every new gated run.
    // Older rows keep their stored/absent section-approval workflow.
    gatedWorkflow:
      candidateMode === "iterative"
        ? (preservedGatedWorkflow ?? "seeds")
        : undefined,
    singleModelId,
    modelFreeze,
    compareModelIds: persistedCompareModelIds,
    retryOfGenerationId,
    retryModelIds: persistedRetryModelIds,
    seededCandidates: seededCandidates || undefined,
    ...(confirmedExcluded ? { excludedSources: confirmedExcluded } : {}),
    ...(evidence.frozenCompanyFiles[0] ? { companyFilesFrom: evidence.frozenCompanyFiles[0].file.clientId } : {}),
    ...(evidence.companyFilesLeftOut?.length ? { companyFilesLeftOut: evidence.companyFilesLeftOut } : {}),
    previousYearMaterial,
    previousProjectStatus: restorableProjectStatus(project.status),
    currentStep: "Queued",
    candidatesDone: seededCandidates,
    candidatesFailed: 0,
    startedAt: now,
  });
  await appendGenerationProgress(ctx, { _id: generationId, projectId: project._id }, initialProgress, now);
  // B1, second part (2026-10-27): a project file or company file row refers
  // to the stored version of the text it read (written once, reused by
  // every later draft with the same text), and a transcript row to its
  // transcript, instead of holding its own copy. What this draft writes is
  // counted, and refused by name before the transaction's limit.
  let writtenBytes = 0;
  for (const fields of await frozenSourceFields(evidence)) {
    const { content, ...rest } = fields;
    let reference: { textVersionId?: Id<"sourceTextVersions">; textLength: number } = { textLength: content.length };
    if (fields.kind === "project_document" || fields.kind === "company_file") {
      const owner: SourceTextOwner =
        fields.kind === "company_file" && fields.companyFileId
          ? { companyFileId: fields.companyFileId, ...(fields.clientId ? { clientId: fields.clientId } : {}) }
          : { projectId: project._id };
      // At most 3 UTF-8 bytes a UTF-16 unit, and the rows' own fields.
      await frozenLimits.beforeWrite(writtenBytes, content.length * 3 + 64 * 1024);
      const stored = await storedSourceTextVersion(ctx, owner, content, fields.contentHash);
      writtenBytes += stored.writtenBytes;
      reference = { textVersionId: stored.versionId, textLength: content.length };
    }
    await ctx.db.insert("generationSources", {
      generationId,
      projectId: project._id,
      ...rest,
      ...reference,
      capturedAt: now,
    });
  }
  if (writerSuppliedStoryline?.trim()) {
    const content = writerSuppliedStoryline.trim();
    await ctx.db.insert("generationSources", {
      generationId,
      projectId: project._id,
      kind: "writer_storyline",
      label: "Writer-supplied Storyline",
      content,
      contentHash: await sha256(content),
      truncated: false,
      originalLength: content.length,
      capturedAt: now,
    });
  }
  await ctx.db.patch(project._id, {
    activeGenerationId: generationId,
    status: "generating",
    updatedAt: now,
  });
  await refreshProjectGenerationActivity(ctx, project._id);
  const scheduledJobId = await ctx.scheduler.runAfter(
    0,
    candidateMode === "iterative"
      ? internal.ai.iterative.startIterativeGeneration
      : internal.ai.pipeline.generateReport,
    { generationId }
  );
  await ctx.db.patch(generationId, { scheduledJobId });
  return generationId;
}

/** Argument validators of generations.requestGeneration. */
export const requestGenerationArgs = {
  projectId: v.id("projects"),
  lengthTarget: v.optional(lengthTargetValidator),
  candidateMode: v.optional(candidateModeValidator),
  singleModelId: v.optional(singleModelIdValidator),
  compareModelIds: v.optional(v.array(v.string())),
  confirmRegeneration: v.optional(v.boolean()),
  // Story 1 (CAP-1/2/4): optional writer-supplied Storyline, frozen
  // verbatim as a `writer_storyline` source and never validated.
  writerSuppliedStoryline: v.optional(v.string()),
  // Decision 56: files unticked in the start dialog are left out of this run.
  ...excludedIdsArgs,
  // 2026-11-02 (proposed): "Look up public background" in the start
  // dialog. Absent means on (an older browser), as the tick defaults to on;
  // the deployment setting still decides whether anything is searched.
  webBackground: v.optional(v.boolean()),
};

/** Handler of generations.requestGeneration. */
export async function requestGenerationHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof requestGenerationArgs>
) {
  // A new draft can replace the report everyone reads (single mode writes a
  // new latest report with no selection step), so starting one is a
  // report.editProse act, not just internal access (audit 2026-09-25, a2 P1-1).
  const { project, user } = await requireReportEditAccess(ctx, args.projectId);
  // Decision 65, stage 2: not while the project is still being set up from
  // its intake draft (its sources and speaker evidence are still arriving).
  await requireProjectSetUp(ctx, project._id);
  const latestReport = await ctx.db
    .query("reports")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .order("desc")
    .first();
  if (latestReport && !args.confirmRegeneration) {
    domainError(
      "INVALID_INPUT",
      "Regenerating a project with an existing report requires explicit confirmation"
    );
  }
  const candidateMode = args.candidateMode ?? "compare";
  const excludedSources = await validatedExcludedSources(ctx, project._id, args, { checkProjectRows: false });
  const generationId = await reserveGeneration(
    ctx,
    project,
    user._id,
    args.lengthTarget ?? "standard",
    candidateMode,
    await validatedSingleModelId(ctx, candidateMode, args.singleModelId),
    await validatedCompareModelIds(ctx, candidateMode, args.compareModelIds),
    undefined,
    undefined,
    0,
    args.writerSuppliedStoryline,
    undefined,
    undefined,
    excludedSources,
    true,
    true
  );
  // Same transaction as the reservation, so the scheduled run reads it.
  await ctx.db.patch(generationId, { webBackgroundRequested: args.webBackground !== false });
  return generationId;
}

/** Argument validators of generations.retryGeneration. */
export const retryGenerationArgs = { generationId: v.id("generations") };

/** Handler of generations.retryGeneration. */
export async function retryGenerationHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof retryGenerationArgs>
) {
  await requireInternalActor(ctx);
  const failed = await ctx.db.get(args.generationId);
  if (!failed) domainError("NOT_FOUND", "Generation not found");
  if (failed.status !== "failed") {
    domainError("INVALID_INPUT", "Only a failed generation can be retried");
  }
  if (resolveGatedWorkflow(failed) === "seeds" && failed.summaryVersionId) {
    domainError("INVALID_INPUT", "Use Summary recovery for a signed-off seed generation");
  }
  const { project, user } = await requireReportEditAccess(ctx, failed.projectId);
  // 2026-10-23 (owner): a model its tier was moved back from is replaced by
  // the tier's current model, so the retry can finish instead of the writer
  // starting over. Every other model runs as frozen.
  const replaced = async (id: string | undefined) =>
    id === undefined ? undefined : ((await movedBackReplacement(ctx, id)) ?? id);
  const comparePair = failed.compareModelIds
    ? await retryComparePair(ctx, failed.compareModelIds)
    : undefined;
  const moved = await movedBackModels(ctx, failed);
  const movedLines = comparePair
    ? compareRetryProgress(moved, comparePair.pair, new Set(comparePair.pair))
    : movedBackProgress(moved);
  const retryId = await reserveGeneration(
    ctx,
    project,
    user._id,
    failed.lengthTarget ?? "standard",
    failed.candidateMode ?? "compare",
    await persistedSingleModelId(
      ctx,
      failed.candidateMode ?? "compare",
      await replaced(failed.singleModelId),
      failed.modelFreeze
    ),
    comparePair?.pair,
    failed._id,
    undefined,
    0,
    undefined,
    resolveGatedWorkflow(failed),
    ["Generation request reserved.", ...movedLines],
    failed.excludedSources
  );
  // A retry keeps the writer's public background choice.
  if (failed.webBackgroundRequested !== undefined) {
    await ctx.db.patch(retryId, { webBackgroundRequested: failed.webBackgroundRequested });
  }
  return retryId;
}

/** Argument validators of generations.retryFromSummary. */
export const retryFromSummaryArgs = { failedGenerationId: v.id("generations") };

/** Handler of generations.retryFromSummary. */
export async function retryFromSummaryHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof retryFromSummaryArgs>
) {
  const failed = await ctx.db.get(args.failedGenerationId);
  if (!failed) domainError("NOT_FOUND", "Generation not found");
  if (
    failed.status !== "failed" ||
    resolveGatedWorkflow(failed) !== "seeds" ||
    !failed.summaryVersionId
  ) {
    domainError("INVALID_STATE", "Only failed signed-off seed drafting can be recovered");
  }
  const { project, user } = await requireReportEditAccess(ctx, failed.projectId);
  const active = await findActiveGeneration(ctx, project, ACTIVE_GENERATION_STATUSES);
  if (active) await refuseActiveGeneration(ctx, active);
  const duplicate = await ctx.db.query("generations")
    .withIndex("by_retryOfGenerationId", (q) =>
      q.eq("retryOfGenerationId", failed._id))
    .first();
  if (duplicate) {
    domainError("INVALID_STATE", "This failed generation already has a recovery attempt");
  }
  const originGenerationId = failed.originGenerationId ?? failed._id;
  const summary = await ctx.db.get(failed.summaryVersionId);
  if (!summary || summary.originGenerationId !== originGenerationId) {
    domainError("INVALID_STATE", "Frozen Summary lineage is unavailable");
  }
  // One transcript, digest and fact pack row per transcript (2026-09-24).
  const maxFrozenSources = MAX_FROZEN_SOURCE_ROWS;
  // B1 review, round 3: older rows hold their own copies, so the rows are
  // read one at a time under a guard, once when the failed draft is its own
  // origin, and every copy written is checked first.
  const recoveryLimits = new TransactionGuard(
    ctx,
    { marginBytes: FROZEN_MARGIN_BYTES, estimateLimitBytes: FROZEN_ESTIMATE_LIMIT_BYTES },
    () => domainError("INVALID_STATE", RECOVERY_TOO_LARGE_MESSAGE)
  );
  const frozenRowsOf = async (generationId: Id<"generations">) => {
    const rows: Doc<"generationSources">[] = [];
    for await (const row of countedRows(
      ctx.db.query("generationSources").withIndex("by_generationId", (q) => q.eq("generationId", generationId)),
      recoveryLimits
    )) {
      rows.push(row);
      if (rows.length > maxFrozenSources) break;
    }
    return rows;
  };
  const currentSources = await frozenRowsOf(failed._id);
  // Round 4: a recovery of a recovery needs only the origin's row ids, which
  // its stored map holds (written with the copies it maps), so the origin's
  // rows are not read again. Every map since recovery shipped (2026-09-22)
  // holds the original draft's row ids, written only here.
  const originIds: Id<"generationSources">[] =
    originGenerationId === failed._id
      ? currentSources.map((source) => source._id)
      : (failed.sourceIdMap ?? []).map((entry) => entry.originSourceId);
  // Only the two frozen drafting inputs are copied: the chain's stored
  // payload (kind ordered_payload, 2026-09-25) belongs to the failed chain
  // and is rebuilt for the recovery chain from these two.
  const artifactsOf = async (kind: "analysis" | "brain_blocks") => {
    const rows: Doc<"generationArtifacts">[] = [];
    for await (const row of countedRows(
      ctx.db.query("generationArtifacts").withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", failed._id).eq("kind", kind)),
      recoveryLimits
    )) {
      rows.push(row);
      if (rows.length >= 2) break;
    }
    return rows;
  };
  const artifacts = [...(await artifactsOf("analysis")), ...(await artifactsOf("brain_blocks"))];
  if (originGenerationId !== failed._id && originIds.length === 0) {
    domainError("INVALID_STATE", "Frozen recovery source map is incomplete");
  }
  if (
    originIds.length === 0 ||
    currentSources.length === 0 ||
    originIds.length > maxFrozenSources ||
    currentSources.length > maxFrozenSources ||
    artifacts.length !== 2
  ) {
    domainError("INVALID_STATE", "Frozen recovery inputs are incomplete");
  }
  const priorMap = failed.sourceIdMap ?? originIds.map((id) => ({
    originSourceId: id,
    recoverySourceId: id,
  }));
  try {
    assertFrozenSourceBijection({
      originSourceIds: originIds,
      recoverySourceIds: currentSources.map((source) => source._id),
      sourceIdMap: priorMap,
    });
  } catch {
    domainError("INVALID_STATE", "Frozen recovery source map is incomplete");
  }
  // Summary recovery drafts on exactly the models the original froze, except
  // a model its tier was moved back from (2026-10-23, owner): then it
  // freezes today's models, the single model replaced by its tier's current
  // one, so the recovery can finish instead of the writer starting over.
  const freezeAt = Date.now();
  const moved = await movedBackModels(ctx, failed);
  const singleModelId =
    moved.length === 0
      ? failed.singleModelId
      : failed.singleModelId === undefined
        ? await defaultModelId(ctx)
        : ((await movedBackReplacement(ctx, failed.singleModelId)) ?? failed.singleModelId);
  const modelFreeze =
    moved.length > 0 && singleModelId !== undefined
      ? await freezeModelsForGeneration(ctx, [singleModelId], freezeAt)
      : failed.modelFreeze;
  if (moved.length > 0 && modelFreeze?.entries.some((entry) => entry.gateway === "openrouter")) {
    requireOpenRouterConfigured();
  }
  // Audit wave 2: spent once every refusal above has had its say.
  await limitGenerationStart(ctx, user._id, project._id);
  const currentById = new Map(currentSources.map((source) => [source._id, source]));
  const now = Date.now();
  const generationId = await ctx.db.insert("generations", {
    projectId: failed.projectId,
    transcriptId: failed.transcriptId,
    transcriptIds: failed.transcriptIds,
    inputMode: failed.inputMode,
    digestIds: failed.digestIds,
    // Summary recovery reads the same fact packs and placeholders.
    ...(failed.transcriptFacts !== undefined ? { transcriptFacts: failed.transcriptFacts } : {}),
    ...(failed.placeholders ? { placeholders: failed.placeholders } : {}),
    // 2026-10-30: and the same claimant name, so recovery sends the same requests.
    ...(failed.claimantName !== undefined ? { claimantName: failed.claimantName } : {}),
    ...(failed.placeholdersOff !== undefined ? { placeholdersOff: failed.placeholdersOff } : {}),
    ...(failed.companyFilesFrom ? { companyFilesFrom: failed.companyFilesFrom } : {}),
    ...(failed.companyFilesLeftOut ? { companyFilesLeftOut: failed.companyFilesLeftOut } : {}),
    status: "reserved",
    // 2026-09-25: this generation's outputs live in generationArtifacts rows.
    outputsInArtifactsAt: now,
    requestedAt: now,
    requestedBy: user._id,
    learningDigestIds: failed.learningDigestIds ?? [],
    lengthTarget: failed.lengthTarget,
    candidateMode: "iterative",
    gatedWorkflow: "seeds",
    briefId: failed.briefId,
    briefVersionId: failed.briefVersionId,
    summaryVersionId: failed.summaryVersionId,
    originGenerationId,
    singleModelId,
    ...(modelFreeze ? { modelFreeze } : {}),
    retryOfGenerationId: failed._id,
    previousProjectStatus: restorableProjectStatus(project.status),
    currentStep: "Preparing Summary recovery",
    candidatesDone: 0,
    candidatesFailed: 0,
    totalCandidates: 1,
    writerSettings: failed.writerSettings,
    startedAt: now,
  });
  await appendGenerationProgress(
    ctx,
    { _id: generationId, projectId: failed.projectId },
    ["Summary recovery reserved from frozen inputs.", ...movedBackProgress(moved)],
    now
  );
  const nextMap: Array<{
    originSourceId: Id<"generationSources">;
    recoverySourceId: Id<"generationSources">;
  }> = [];
  const recoveryCopyOf = new Map<Id<"generationSources">, Id<"generationSources">>();
  // Phase C: a draft that read another company's files is not recovered
  // once the project has left that company; a new draft reads its own.
  // The failed draft's rows carry the origin's kinds and companies.
  await refuseWhenCompanyLeft(ctx, failed.projectId, currentSources);
  let recoveryWritten = 0;
  for (const originId of originIds) {
    const currentId = resolveFrozenSourceId(originId, priorMap);
    const current = currentById.get(currentId as Id<"generationSources">);
    if (!current) domainError("INVALID_STATE", "Frozen recovery source map is incomplete");
    // The copy is the same document under the new draft.
    const rowBytes = getDocumentSize(current as unknown as Record<string, Value>);
    await recoveryLimits.beforeWrite(recoveryWritten, rowBytes);
    recoveryWritten += rowBytes;
    const recoverySourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId: current.projectId,
      kind: current.kind,
      transcriptId: current.transcriptId,
      digestId: current.digestId,
      factsVersion: current.factsVersion,
      // The spans index the transcript row copied next to it, whose text
      // is identical, so every fact id still resolves.
      ...(current.factSpans ? { factSpans: current.factSpans } : {}),
      projectDocumentId: current.projectDocumentId,
      companyFileId: current.companyFileId,
      clientId: current.clientId,
      label: current.label,
      // B1, second part: an old row's own copy, or a new row's reference.
      ...(current.content !== undefined ? { content: current.content } : {}),
      ...(current.textVersionId ? { textVersionId: current.textVersionId } : {}),
      ...(current.textLength !== undefined ? { textLength: current.textLength } : {}),
      contentHash: current.contentHash,
      truncated: current.truncated,
      originalLength: current.originalLength,
      capturedAt: current.capturedAt,
      uploaderRole: current.uploaderRole,
      contextBudget: current.contextBudget,
    });
    nextMap.push({ originSourceId: originId, recoverySourceId });
    recoveryCopyOf.set(current._id, recoverySourceId);
  }
  assertFrozenSourceBijection({
    originSourceIds: originIds,
    recoverySourceIds: nextMap.map((entry) => entry.recoverySourceId),
    sourceIdMap: nextMap,
  });
  for (const artifact of artifacts) {
    const artifactBytes = getDocumentSize(artifact as unknown as Record<string, Value>);
    await recoveryLimits.beforeWrite(recoveryWritten, artifactBytes);
    recoveryWritten += artifactBytes;
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: artifact.kind,
      content: artifact.content,
    });
  }
  await ctx.db.patch(generationId, { sourceIdMap: nextMap });
  // Phase D (step 2): the steps it reuses keep their record on its rows,
  // and the band says so when some could not be copied (re-check).
  const copied = await copyRecoverySourceUses(
    ctx,
    failed._id,
    { _id: generationId, projectId: failed.projectId },
    recoveryCopyOf,
    {
      hasRoom: (kind, bytes, written = 0) => recoveryLimits.hasRoom(kind, bytes, recoveryWritten + written),
      read: (doc) => recoveryLimits.read(doc),
    }
  );
  if (copied.truncated || failed.sourceUseTruncated) await ctx.db.patch(generationId, { sourceUseTruncated: true });
  await ctx.db.patch(project._id, {
    activeGenerationId: generationId,
    status: "generating",
    updatedAt: now,
  });
  const scheduledJobId = await ctx.scheduler.runAfter(
    0,
    startSummaryRecoveryRef,
    { generationId }
  );
  await ctx.db.patch(generationId, { scheduledJobId });
  await refreshProjectGenerationActivity(ctx, project._id);
  return generationId;
}

/** Argument validators of generations.retryFailedCandidates. */
export const retryFailedCandidatesArgs = { generationId: v.id("generations") };

/** Handler of generations.retryFailedCandidates. */
export async function retryFailedCandidatesHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof retryFailedCandidatesArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  if ((generation.candidateMode ?? "compare") !== "compare") {
    domainError("INVALID_INPUT", "Only comparison drafts support model-specific retry");
  }
  if (generation.status === "superseded") {
    domainError(
      "INVALID_STATE",
      "This generation was already superseded by a recovery run"
    );
  }
  if (generation.status !== "awaiting_selection") {
    domainError("INVALID_STATE", "Only a partial generation can retry failed drafts");
  }
  const { project, user } = await requireReportEditAccess(ctx, generation.projectId);
  const runs = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  const failedModelIds = runs
    .filter((run) => !run.ghost && run.status === "failed")
    .map((run) => run.model);
  if (failedModelIds.length === 0) {
    domainError("INVALID_STATE", "There are no failed drafts to retry");
  }
  const compareModelIds =
    generation.compareModelIds ?? [
      ...new Set(runs.filter((run) => !run.ghost).map((run) => run.model)),
    ];
  const recoveryEntries = await modelEntriesFor(
    ctx,
    compareModelIds,
    generationModelFreeze(generation)
  );
  if (!resolveCompareModels(compareModelIds, (id) => recoveryEntries.get(id))) {
    domainError(
      "INVALID_STATE",
      "This older comparison cannot retry individual drafts. Start a fresh generation instead"
    );
  }
  // 2026-10-23 (owner): a failed draft whose model its tier was moved back
  // from is retried on the tier's current model, unless both drafts would
  // then share one model (it keeps its frozen model). Completed drafts and
  // their models are kept as they are.
  const retryPair = await retryComparePair(ctx, compareModelIds, new Set(failedModelIds));
  const retryModelIds = failedModelIds.map((id) => retryPair.replaced.get(id) ?? id);
  const movedLines = compareRetryProgress(
    await movedBackModels(ctx, generation, generationModelFreeze(generation)),
    retryPair.pair,
    new Set(retryModelIds)
  );
  const sourceCandidates = await ctx.db
    .query("reportCandidates")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(10);
  const successfulCandidates = sourceCandidates.filter((candidate) =>
    runs.some(
      (run) =>
        !run.ghost &&
        run.status === "succeeded" &&
        run.candidateId === candidate._id
    )
  );
  // Audit wave 2: spent before the supersede below, the first write; the
  // reservation then does not spend again.
  await limitGenerationStart(ctx, user._id, project._id);
  const now = Date.now();
  // Supersede the partial selection state inside the same transaction so the
  // normal active-generation guard can reserve its linked recovery. The
  // original candidates and run rows stay intact as attempt history, but the
  // row itself is terminal without a report (CAP-7): history, stats, and the
  // project page skip it, and QA can never be requested on it. The link runs
  // the other way — the recovery row's retryOfGenerationId — so no
  // supersededBy pointer is stored.
  await transitionGeneration(ctx, generation, "superseded", {
    currentStep: "Recovery started",
    completedAt: now,
  });
  await ctx.db.patch(project._id, {
    activeGenerationId: undefined,
    status: restorableProjectStatus(generation.previousProjectStatus),
    updatedAt: now,
  });
  const resetProject = await ctx.db.get(project._id);
  if (!resetProject) domainError("NOT_FOUND", "Project not found");
  // A reservation failure throws out of this mutation, and Convex discards
  // every write of a mutation that throws: the supersede above, the project
  // reset and anything reserveGeneration wrote. The partial generation stays
  // awaiting_selection with the project fenced on it. No restore patch is
  // written (superseded is terminal in the transition table).
  const retryId = await reserveGeneration(
    ctx,
    resetProject,
    user._id,
    generation.lengthTarget ?? "standard",
    "compare",
    undefined,
    retryPair.pair,
    generation._id,
    retryModelIds,
    successfulCandidates.length,
    undefined,
    undefined,
    [
      "Generation recovery reserved.",
      successfulCandidates.length > 0
        ? `Kept ${successfulCandidates.length} completed draft${successfulCandidates.length === 1 ? "" : "s"}.`
        : "Retrying all failed drafts.",
      ...movedLines,
    ],
    generation.excludedSources,
    false
  );
  for (const candidate of successfulCandidates) {
    const candidateId = await ctx.db.insert("reportCandidates", {
      projectId: candidate.projectId,
      generationId: retryId,
      model: candidate.model,
      label: candidate.label,
      content: candidate.content,
      agentOutputs: candidate.agentOutputs,
      provenanceId: candidate.provenanceId,
      createdAt: now,
    });
    await ctx.db.insert("generationCandidateRuns", {
      generationId: retryId,
      projectId: candidate.projectId,
      model: candidate.model,
      label: candidate.label,
      status: "succeeded",
      candidateId,
      queuedAt: now,
      completedAt: now,
    });
  }
  return retryId;
}
