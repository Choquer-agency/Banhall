/**
 * Reserving a generation: model choice, frozen sources, the reservation row,
 * and the retry, Summary recovery and failed-candidate recovery entry
 * points.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import { v, type ObjectType } from "convex/values";
import type { MutationCtx } from "../../_generated/server";
import type { ModelFreeze } from "../modelCatalogValidators";
import { type ModelEntry, MODEL } from "../../../shared/generationModels";
import {
  entryFromFrozen,
  isSelectableModel,
  catalogEntry,
  listSelectableModels,
  freezeModelsForGeneration,
  generationModelFreeze,
} from "../modelRoles";
import { domainError, sha256 } from "../contracts";
import { resolveCompareModels, randomComparePair } from "../../ai/model";
import {
  TRANSCRIPT_BUDGET_CHARS,
  listProjectTranscripts,
  FROZEN_TRANSCRIPT_CHARS,
  scheduleStructureRebuildIfStale,
  transcriptLabel,
  MAX_TRANSCRIPTS_PER_PROJECT,
} from "../transcripts";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  defaultModelId,
  transcriptPlaceholdersEnabled,
  transcriptFactsMode,
} from "../../appSettings";
import { normalizeCraScienceCode } from "../../../shared/craScienceCodes";
import {
  isPreviousYearDocument,
  PREVIOUS_YEAR_ONLY_MESSAGE,
  PREVIOUS_YEAR_ONLY_REASON,
} from "../../../shared/previousYear";
import {
  requireAnthropicConfigured,
  requireOpenRouterConfigured,
} from "../providerConfig";
import { findActiveGeneration } from "../activeGeneration";
import { ACTIVE_GENERATION_STATUSES } from "../../../shared/generationTransitions";
import { projectPlaceholderMap } from "../transcriptPlaceholders";
import { appendGenerationProgress } from "../generationProgress";
import { refreshProjectGenerationActivity } from "../dashboardProjection";
import { internal } from "../../_generated/api";
import { requireInternalActor } from "../auth";
import { resolveGatedWorkflow } from "../gatedWorkflow";
import { requireReportEditAccess } from "../roleCapabilities";
import { assertFrozenSourceBijection, resolveFrozenSourceId } from "../seedRevisions";
import { startSummaryRecoveryRef } from "./seedStage";
import { transitionGeneration } from "../generationTransitions";

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

/**
 * Entries for `ids` as a mutation sees them: frozen on `freeze` when the
 * retried generation carried one, else the catalog's selectable set. Never
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
    if (!(await isSelectableModel(ctx, id))) continue;
    const entry = await catalogEntry(ctx, id);
    if (entry) entries.set(id, entry);
  }
  return entries;
}

/** Single and iterative modes both run exactly one explicitly chosen model
 * (defaulting to the writing role's model when unset). */
export async function validatedSingleModelId(
  ctx: MutationCtx,
  candidateMode: CandidateMode,
  singleModelId: string | undefined
): Promise<string | undefined> {
  if (candidateMode === "compare" || !singleModelId) return undefined;
  if (!(await isSelectableModel(ctx, singleModelId))) {
    domainError("INVALID_INPUT", "Select a supported generation model");
  }
  return singleModelId;
}

/** A retry keeps its model when it is still selectable or was frozen on the
 * generation being retried; otherwise the retry takes today's default. */
export async function persistedSingleModelId(
  ctx: MutationCtx,
  candidateMode: CandidateMode,
  singleModelId: string | undefined,
  freeze: ModelFreeze | undefined
): Promise<string | undefined> {
  if (candidateMode === "compare" || !singleModelId) return undefined;
  return (await modelEntriesFor(ctx, [singleModelId], freeze)).has(singleModelId)
    ? singleModelId
    : undefined;
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
 * character count, so the boundary is one testable line rather than a
 * condition spread across the reserve mutation and the pipeline.
 */
export function decideInputMode(totalChars: number): "full" | "digest" {
  return totalChars > TRANSCRIPT_BUDGET_CHARS ? "digest" : "full";
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
  initialProgress: readonly string[] = ["Generation request reserved."]
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
  const transcripts = await listProjectTranscripts(ctx, project._id);
  // Jul 17 meeting: some engagements have no interview at all (spreadsheet
  // only, drawings, a single email). A transcript-less generation is allowed
  // as long as there's at least one readable context document to work from.
  if (transcripts.length === 0) {
    const docs = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .collect();
    const usable = docs.filter((d) => !d.archived && d.content.trim());
    if (usable.length === 0) {
      domainError(
        "INVALID_INPUT",
        "Add an interview transcript or at least one context document with readable text"
      );
    }
    // Decision 42 (2026-09-25): last year's report alone is not a source
    // for this year's report. Checked before any paid call is scheduled.
    if (usable.every(isPreviousYearDocument)) {
      domainError("INVALID_INPUT", PREVIOUS_YEAR_ONLY_MESSAGE, {
        reason: PREVIOUS_YEAR_ONLY_REASON,
      });
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
  if (active) {
    domainError("GENERATION_ACTIVE", "A generation is already active for this project");
  }

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
  // a retry inherits its original's freeze when it runs the same models.
  const modelFreeze =
    retriedFreeze &&
    requestedModelIds.every((id) => retriedFreeze.entries.some((entry) => entry.id === id))
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

  const frozenTranscripts = transcripts.map((row) => ({
    row,
    content: row.content.slice(0, FROZEN_TRANSCRIPT_CHARS),
  }));
  const documents = await ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .take(50);
  const frozenDocuments = documents.flatMap((document) =>
    document.archived || !document.content.trim()
      ? []
      : [{ document, content: document.content.slice(0, 200_000) }]
  );
  // Owner decision 26: every generation-owned provider call reads
  // placeholders, never names; the map is frozen here so every call of this
  // generation (and its cached prefixes) sees the same bytes. The speakers'
  // names are parsed from the transcripts' text here, so a draft started
  // before the scheduled turn build has written the speaker rows still hides
  // them (review 2026-09-25: three demo drafts started 28 to 53 ms after
  // their transcript was saved sent the speakers' names). It is checked
  // against every text the calls will send, so a source that already holds
  // placeholder-style tokens never has them restored into names.
  const placeholders = (await transcriptPlaceholdersEnabled(ctx))
    ? [
        ...(await projectPlaceholderMap(
          ctx,
          project,
          transcripts,
          [
            ...frozenTranscripts.map((item) => item.content),
            ...frozenDocuments.map((item) => item.content),
            ...(writerSuppliedStoryline ? [writerSuppliedStoryline] : []),
          ]
        )),
      ]
    : [];
  const inputMode = decideInputMode(
    frozenTranscripts.reduce((total, item) => total + item.content.length, 0)
  );
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
    for (const row of transcripts) await scheduleStructureRebuildIfStale(ctx, row);
  }
  const generationId = await ctx.db.insert("generations", {
    projectId: project._id,
    transcriptId: transcripts[0]?._id,
    transcriptIds: transcripts.map((row) => row._id),
    inputMode,
    ...(transcriptFacts ? { transcriptFacts: true } : {}),
    ...(placeholders.length > 0 ? { placeholders } : {}),
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
    previousProjectStatus: project.status,
    currentStep: "Queued",
    candidatesDone: seededCandidates,
    candidatesFailed: 0,
    startedAt: now,
  });
  await appendGenerationProgress(ctx, { _id: generationId, projectId: project._id }, initialProgress, now);
  for (const { row, content } of frozenTranscripts) {
    await ctx.db.insert("generationSources", {
      generationId,
      projectId: project._id,
      kind: "transcript",
      transcriptId: row._id,
      label: transcriptLabel(row),
      content,
      contentHash: await sha256(content),
      truncated: content.length !== row.content.length,
      originalLength: row.content.length,
      capturedAt: now,
    });
  }
  for (const { document, content } of frozenDocuments) {
    await ctx.db.insert("generationSources", {
      generationId,
      projectId: project._id,
      kind: "project_document",
      projectDocumentId: document._id,
      label: `${document.category ?? "other"}:${document.fileName}`,
      content,
      contentHash: await sha256(content),
      truncated: content.length !== document.content.length,
      originalLength: document.content.length,
      // CAP-3: trust is pinned to the reservation, never re-read live.
      // Absent (legacy document rows) means client trust downstream.
      ...(document.uploaderRole ? { uploaderRole: document.uploaderRole } : {}),
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
  return await reserveGeneration(
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
    args.writerSuppliedStoryline
  );
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
  return await reserveGeneration(
    ctx,
    project,
    user._id,
    failed.lengthTarget ?? "standard",
    failed.candidateMode ?? "compare",
    await persistedSingleModelId(
      ctx,
      failed.candidateMode ?? "compare",
      failed.singleModelId,
      failed.modelFreeze
    ),
    failed.compareModelIds,
    failed._id,
    undefined,
    0,
    undefined,
    resolveGatedWorkflow(failed)
  );
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
  if (active) {
    domainError("GENERATION_ACTIVE", "A generation is already active for this project");
  }
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
  const maxFrozenSources = 3 * MAX_TRANSCRIPTS_PER_PROJECT + 51;
  const [originSources, currentSources, analysisArtifacts, brainArtifacts] = await Promise.all([
    ctx.db.query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", originGenerationId))
      .take(maxFrozenSources + 1),
    ctx.db.query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", failed._id))
      .take(maxFrozenSources + 1),
    // Only the two frozen drafting inputs are copied: the chain's stored
    // payload (kind ordered_payload, 2026-09-25) belongs to the failed
    // chain and is rebuilt for the recovery chain from these two.
    ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", failed._id).eq("kind", "analysis"))
      .take(2),
    ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", failed._id).eq("kind", "brain_blocks"))
      .take(2),
  ]);
  const artifacts = [...analysisArtifacts, ...brainArtifacts];
  if (
    originSources.length === 0 ||
    currentSources.length === 0 ||
    originSources.length > maxFrozenSources ||
    currentSources.length > maxFrozenSources ||
    artifacts.length !== 2
  ) {
    domainError("INVALID_STATE", "Frozen recovery inputs are incomplete");
  }
  const priorMap = failed.sourceIdMap ?? originSources.map((source) => ({
    originSourceId: source._id,
    recoverySourceId: source._id,
  }));
  try {
    assertFrozenSourceBijection({
      originSourceIds: originSources.map((source) => source._id),
      recoverySourceIds: currentSources.map((source) => source._id),
      sourceIdMap: priorMap,
    });
  } catch {
    domainError("INVALID_STATE", "Frozen recovery source map is incomplete");
  }
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
    singleModelId: failed.singleModelId,
    // Summary recovery drafts on exactly the models the original froze.
    ...(failed.modelFreeze ? { modelFreeze: failed.modelFreeze } : {}),
    retryOfGenerationId: failed._id,
    previousProjectStatus: project.status,
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
    ["Summary recovery reserved from frozen inputs."],
    now
  );
  const nextMap: Array<{
    originSourceId: Id<"generationSources">;
    recoverySourceId: Id<"generationSources">;
  }> = [];
  for (const origin of originSources) {
    const currentId = resolveFrozenSourceId(origin._id, priorMap);
    const current = currentById.get(currentId as Id<"generationSources">);
    if (!current) domainError("INVALID_STATE", "Frozen recovery source map is incomplete");
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
      label: current.label,
      content: current.content,
      contentHash: current.contentHash,
      truncated: current.truncated,
      originalLength: current.originalLength,
      capturedAt: current.capturedAt,
      uploaderRole: current.uploaderRole,
      contextBudget: current.contextBudget,
    });
    nextMap.push({ originSourceId: origin._id, recoverySourceId });
  }
  assertFrozenSourceBijection({
    originSourceIds: originSources.map((source) => source._id),
    recoverySourceIds: nextMap.map((entry) => entry.recoverySourceId),
    sourceIdMap: nextMap,
  });
  for (const artifact of artifacts) {
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: artifact.kind,
      content: artifact.content,
    });
  }
  await ctx.db.patch(generationId, { sourceIdMap: nextMap });
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
    status: generation.previousProjectStatus ?? "draft",
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
    compareModelIds,
    generation._id,
    failedModelIds,
    successfulCandidates.length,
    undefined,
    undefined,
    [
      "Generation recovery reserved.",
      successfulCandidates.length > 0
        ? `Kept ${successfulCandidates.length} completed draft${successfulCandidates.length === 1 ? "" : "s"}.`
        : "Retrying all failed drafts.",
    ]
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
