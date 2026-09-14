import { extractReportSections } from "./lib/tiptapReport";
import { persistDeterministicFindings, persistMethodologyFindings, reportQaRef } from "./lib/qaFindings";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getCurrentUserOrNull,
  getInternalProjectAccessOrNull,
  requireCurrentUser,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
import { requireReportEditAccess } from "./lib/roleCapabilities";
import { domainError, sha256 } from "./lib/contracts";
import {
  requireAnthropicConfigured,
  requireOpenRouterConfigured,
} from "./lib/providerConfig";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import {
  CANDIDATE_MODELS,
  MODEL,
  gatewayForModel,
  modelById,
  type CandidateModelId,
} from "../shared/generationModels";
import { randomComparePair, resolveCompareModels } from "./ai/model";
import { findActiveGeneration } from "./lib/activeGeneration";
import { analyzerContextBudget, defaultModelId } from "./appSettings";
import { sourceInclusion } from "./ai/trustedContext";
import {
  assembleContextInclusion,
  type UnfrozenDocument,
} from "./lib/contextInclusion";
import { createReadBudget, DOCUMENT_HEADROOM } from "./lib/readBudget";
import { buildTiptapDocument } from "./lib/tiptapReport";
import { sectionMetrics } from "./lib/lineLimits";
import { deidentify } from "./lib/deidentify";
import { recordReportEditDistance } from "./lib/editDistance";
import { refreshProjectGenerationActivity } from "./lib/dashboardProjection";
import {
  buildTranscriptPromptText,
  FROZEN_TRANSCRIPT_CHARS,
  generationTranscriptIds,
  listProjectTranscripts,
  MAX_TRANSCRIPTS_PER_PROJECT,
  transcriptLabel,
  TRANSCRIPT_BUDGET_CHARS,
} from "./lib/transcripts";
import { validateCitation } from "./lib/citations";
import { renderBriefBlock } from "./lib/briefRender";
import {
  complianceNoteDraftValidator,
  complianceNoteRow,
} from "./lib/complianceNote";
import {
  isSectionNumber,
  orderedPayloadValidator,
  sectionKeyOf,
  sectionNumberValidator,
  writerSettingsValidator,
  type SectionNumber,
} from "./lib/orderedChain";
import { ORDERED_SECTION_TITLES } from "./ai/promptDefinitions";

// ─── Generation status helpers ───────────────────────────────────────────────

/** Statuses `findActiveGeneration` treats as live: the project stays fenced on
 * the generation and the dashboard shows activity for it. */
const ACTIVE_GENERATION_STATUSES = [
  "reserved",
  "running",
  "awaiting_selection",
  "awaiting_input",
] as const;

/** Terminal statuses: nothing may resurrect the row, and candidate runs left
 * stranded under it are settled by the reaper. `superseded` (CAP-7) is
 * terminal without a report: a partial compare generation whose failed drafts
 * were retried into a linked recovery generation. */
function isTerminalGenerationStatus(status: Doc<"generations">["status"]) {
  return status === "completed" || status === "failed" || status === "superseded";
}

/** A generation the project page, history list, and dashboard may surface.
 * `superseded` rows are attempt history only — the recovery generation that
 * replaced them (its `retryOfGenerationId` points back here) is the one that
 * continues, so they are never the latest, active, completed, or failed run. */
type VisibleGeneration = Doc<"generations"> & {
  status: Exclude<Doc<"generations">["status"], "superseded">;
};
function isVisibleGeneration(
  generation: Doc<"generations">
): generation is VisibleGeneration {
  return generation.status !== "superseded";
}

const GENERATION_HISTORY_LIMIT = 50;

/** Newest-first visible generations for a project. The scan stops at `limit`
 * visible rows; every superseded row it skips is paired with a newer recovery
 * row, so the extra reads are bounded by the project's retry count. */
async function visibleGenerations(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  limit: number
): Promise<VisibleGeneration[]> {
  const visible: VisibleGeneration[] = [];
  for await (const generation of ctx.db
    .query("generations")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .order("desc")) {
    if (!isVisibleGeneration(generation)) continue;
    visible.push(generation);
    if (visible.length >= limit) break;
  }
  return visible;
}

/**
 * Requires internal project access. Strips internal agentOutputs.
 */
export const getLatestGeneration = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;

    // Newest non-superseded row: after a partial retry the linked recovery
    // generation is the latest, never the superseded original (CAP-7).
    const [generation] = await visibleGenerations(ctx, args.projectId, 1);
    if (!generation) return null;
    // Which model's draft the writer chose — visible to everyone (the blind
    // A/B test is over; model identity is shown to all users).
    const selection = await ctx.db
      .query("modelSelections")
      .withIndex("by_projectId_and_generationId", (q) =>
        q.eq("projectId", args.projectId).eq("generationId", generation._id)
      )
      .first();
    const selectedModelLabel: string | null = selection?.label ?? null;
    // Iterative runs draft with one model — surface its label for the page bar.
    let iterativeModelLabel: string | null = null;
    if ((generation.candidateMode ?? "compare") === "iterative") {
      const firstRun = await ctx.db
        .query("generationSectionRuns")
        .withIndex("by_generationId_and_section", (q) =>
          q.eq("generationId", generation._id).eq("section", "s242")
        )
        .unique();
      iterativeModelLabel = firstRun?.label ?? null;
    }
    return {
      selectedModelLabel,
      iterativeModelLabel,
      postQaStatus: generation.postQaStatus,
      _id: generation._id,
      projectId: generation.projectId,
      transcriptId: generation.transcriptId,
      status: generation.status,
      candidateMode: generation.candidateMode ?? "compare",
      currentStep: generation.currentStep,
      // Same boundary contract as getIterativeState: raw provider text stays
      // on the row for ops; only typed copy and authored narration cross.
      progressLog: (generation.progressLog ?? []).map(userSafeNarration),
      estimatedMs: generation.estimatedMs,
      totalCandidates: generation.totalCandidates,
      candidatesDone: generation.candidatesDone,
      candidatesFailed: generation.candidatesFailed,
      requestedAt: generation.requestedAt,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
      error: userSafeStoredError(
        generation.error,
        "The generation did not complete. Try again."
      ),
      agentOutputs: generation.agentOutputs,
    };
  },
});
/** Public internal view of one exact generation. */
export const getGeneration = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) {
      return null;
    }
    // D-4: a non-empty promptVersion is the sole "tracked" marker. Legacy rows
    // and reservations not yet stamped by beginGeneration read as untracked and
    // return null for all three provenance fields — never 0, which would be
    // indistinguishable from a tracked generation that has cost nothing yet.
    // promptVersion is hoisted so the check narrows it to `string`, keeping the
    // returned type `string | null` with no impossible `undefined` for callers.
    const promptVersion = generation.promptVersion;
    const tracked = typeof promptVersion === "string" && promptVersion.length > 0;
    // Every aiUsage row keyed to this generation, un-truncated: rows from calls
    // that later failed, timed out, or were retried all count, and rows keep
    // landing while the generation is in flight. Bounded by the pipeline's
    // generation-owned provider calls (low hundreds at worst), so a single
    // collect() stays well inside query read limits; truncating would
    // silently under-report.
    const usage = tracked
      ? await ctx.db
          .query("aiUsage")
          .withIndex("by_generationId", (q) =>
            q.eq("generationId", generation._id)
          )
          .collect()
      : null;
    return {
      _id: generation._id,
      projectId: generation.projectId,
      transcriptId: generation.transcriptId,
      status: generation.status,
      candidateMode: generation.candidateMode ?? "compare",
      currentStep: generation.currentStep,
      estimatedMs: generation.estimatedMs,
      totalCandidates: generation.totalCandidates,
      candidatesDone: generation.candidatesDone,
      candidatesFailed: generation.candidatesFailed,
      requestedAt: generation.requestedAt,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
      agentOutputs: generation.agentOutputs,
      /** Deployment-level prompt program hash, or null for untracked rows. */
      promptVersion: tracked ? promptVersion : null,
      /** Learned-guidance ids recorded so far, or null for untracked rows. */
      learningDigestIds: tracked ? (generation.learningDigestIds ?? []) : null,
      /** Recorded attributable cost in US dollars: the sum of `costUsd` over
       * the `aiUsage` rows recorded against this generation. Individual rows
       * may themselves be estimated from token counts (`logUsage` falls back to
       * `estimateCostUsd` when the provider reports no cost), so this is
       * recorded attributable cost, not exact total provider spend, and makes
       * no claim of invoice completeness — unrecorded or unattributed calls are
       * simply absent. `null` means the generation is untracked, not that it
       * cost nothing. The tracked marker, not the emptiness of the usage read,
       * is what decides null-vs-0. */
      cost: tracked
        ? (usage ?? []).reduce((total, row) => total + row.costUsd, 0)
        : null,
    };
  },
});

/** User-safe recovery state. Raw provider errors and progress-log strings do
 * not cross this boundary. */
export const getGenerationRecovery = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    if (!(await getInternalProjectAccessOrNull(ctx, generation.projectId))) return null;
    const runs = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    // Recovery retries insert carried-over run rows directly (bypassing the
    // per-model uniqueness guard in createCandidateRun), so the same
    // model+status pair can appear twice — the UI keys its list on that pair
    // (each_key_duplicate class, Aug 18 audit).
    const seenModelStatus = new Set<string>();
    const models = runs
      .filter((run) => !run.ghost)
      .filter((run) => {
        const key = `${run.model}-${run.status}`;
        if (seenModelStatus.has(key)) return false;
        seenModelStatus.add(key);
        return true;
      })
      .map((run) => ({
        model: run.model,
        label: modelById(run.model)?.label ?? run.label ?? "Draft model",
        status: run.status,
      }));
    return {
      generationId: generation._id,
      status: generation.status,
      retryOfGenerationId: generation.retryOfGenerationId ?? null,
      candidatesDone:
        generation.candidatesDone ?? models.filter((run) => run.status === "succeeded").length,
      candidatesFailed:
        generation.candidatesFailed ?? models.filter((run) => run.status === "failed").length,
      models,
    };
  },
});


/**
 * Requires internal project access. Strips internal agentOutputs.
 */
export const listGenerations = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];

    // History excludes superseded rows (CAP-7): they are neither completed
    // nor failed attempts, just the pre-retry half of a recovery generation.
    const generations = await visibleGenerations(
      ctx,
      args.projectId,
      GENERATION_HISTORY_LIMIT
    );
    return generations.map((generation) => ({
      _id: generation._id,
      status: generation.status,
      currentStep: generation.currentStep,
      requestedAt: generation.requestedAt,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
      error: generation.error,
    }));
  },
});

const lengthTargetValidator = v.union(
  v.literal("concise"),
  v.literal("standard"),
  v.literal("full")
);

const candidateModeValidator = v.union(
  v.literal("compare"),
  v.literal("single"),
  v.literal("iterative")
);
const singleModelIdValidator = v.string();

type CandidateMode = "compare" | "single" | "iterative";
/** Single and iterative modes both run exactly one explicitly chosen model
 * (defaulting to Sonnet when unset). */
function validatedSingleModelId(
  candidateMode: CandidateMode,
  singleModelId: string | undefined
): CandidateModelId | undefined {
  if (candidateMode === "compare" || !singleModelId) return undefined;
  const selected = CANDIDATE_MODELS.find((model) => model.id === singleModelId);
  if (!selected) {
    domainError("INVALID_INPUT", "Select a supported generation model");
  }
  return selected.id;
}
function persistedSingleModelId(
  candidateMode: CandidateMode,
  singleModelId: string | undefined
): CandidateModelId | undefined {
  if (candidateMode === "compare") return undefined;
  return CANDIDATE_MODELS.find((model) => model.id === singleModelId)?.id;
}
/** Mirrors validatedSingleModelId: only meaningful in compare mode; when the
 *  writer picks explicitly it must be exactly 2 distinct known model ids. */
function validatedCompareModelIds(
  candidateMode: CandidateMode,
  compareModelIds: string[] | undefined
): string[] | undefined {
  if (candidateMode !== "compare" || !compareModelIds) return undefined;
  const resolved = resolveCompareModels(compareModelIds);
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

async function reserveGeneration(
  ctx: MutationCtx,
  project: Doc<"projects">,
  requestedBy: Id<"users">,
  lengthTarget: "concise" | "standard" | "full",
  candidateMode: CandidateMode,
  explicitSingleModelId?: CandidateModelId,
  compareModelIds?: string[],
  retryOfGenerationId?: Id<"generations">,
  retryModelIds?: string[],
  seededCandidates = 0,
  // Story 1 (CAP-1/2/4): frozen verbatim as a `writer_storyline`
  // generationSources row — never validated, parsed, or rejected — and used
  // as-is by the Brief stage (origin "writer"). Excluded from `inputsHash`.
  writerSuppliedStoryline?: string
) {
  // "Default" in single/iterative modes resolves to the admin-set default
  // model (appSettings), persisted here so retries reuse the same model even
  // if the admin changes the setting later.
  const singleModelId =
    candidateMode === "compare"
      ? undefined
      : (explicitSingleModelId ??
        ((await defaultModelId(ctx)) as CandidateModelId));
  const transcripts = await listProjectTranscripts(ctx, project._id);
  // Jul 17 meeting: some engagements have no interview at all (spreadsheet
  // only, drawings, a single email). A transcript-less generation is allowed
  // as long as there's at least one readable context document to work from.
  if (transcripts.length === 0) {
    const docs = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .collect();
    const usable = docs.some((d) => !d.archived && d.content.trim());
    if (!usable) {
      domainError(
        "INVALID_INPUT",
        "Add an interview transcript or at least one context document with readable text"
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
  if (active) {
    domainError("GENERATION_ACTIVE", "A generation is already active for this project");
  }

  // Compare mode always persists its model pair so a retry reuses the exact
  // same pair (Math.random in a mutation is fine — the result is durable).
  const persistedCompareModelIds =
    candidateMode === "compare"
      ? (resolveCompareModels(compareModelIds) ?? randomComparePair()).map(
          (model) => model.id
        )
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
  if (requestedModelIds.some((id) => gatewayForModel(id) === "openrouter")) {
    requireOpenRouterConfigured();
  }

  const now = Date.now();
  const frozenTranscripts = transcripts.map((row) => ({
    row,
    content: row.content.slice(0, FROZEN_TRANSCRIPT_CHARS),
  }));
  const generationId = await ctx.db.insert("generations", {
    projectId: project._id,
    transcriptId: transcripts[0]?._id,
    transcriptIds: transcripts.map((row) => row._id),
    inputMode: decideInputMode(
      frozenTranscripts.reduce((total, item) => total + item.content.length, 0)
    ),
    status: "reserved",
    requestedAt: now,
    requestedBy,
    learningDigestIds: [],
    lengthTarget,
    candidateMode,
    singleModelId,
    compareModelIds: persistedCompareModelIds,
    retryOfGenerationId,
    retryModelIds: persistedRetryModelIds,
    seededCandidates: seededCandidates || undefined,
    previousProjectStatus: project.status,
    currentStep: "Queued",
    progressLog: ["Generation request reserved."],
    candidatesDone: seededCandidates,
    candidatesFailed: 0,
    startedAt: now,
  });
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
  const documents = await ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .take(50);
  for (const document of documents) {
    if (document.archived || !document.content.trim()) continue;
    const content = document.content.slice(0, 200_000);
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

export const requestGeneration = mutation({
  args: {
    projectId: v.id("projects"),
    lengthTarget: v.optional(lengthTargetValidator),
    candidateMode: v.optional(candidateModeValidator),
    singleModelId: v.optional(singleModelIdValidator),
    compareModelIds: v.optional(v.array(v.string())),
    confirmRegeneration: v.optional(v.boolean()),
    // Story 1 (CAP-1/2/4): optional writer-supplied Storyline, frozen
    // verbatim as a `writer_storyline` source and never validated.
    writerSuppliedStoryline: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { project, user } = await requireInternalProjectAccess(ctx, args.projectId);
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
      validatedSingleModelId(candidateMode, args.singleModelId),
      validatedCompareModelIds(candidateMode, args.compareModelIds),
      undefined,
      undefined,
      0,
      args.writerSuppliedStoryline
    );
  },
});

export const retryGeneration = mutation({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const failed = await ctx.db.get(args.generationId);
    if (!failed) domainError("NOT_FOUND", "Generation not found");
    if (failed.status !== "failed") {
      domainError("INVALID_INPUT", "Only a failed generation can be retried");
    }
    const { project, user } = await requireInternalProjectAccess(ctx, failed.projectId);
    return await reserveGeneration(
      ctx,
      project,
      user._id,
      failed.lengthTarget ?? "standard",
      failed.candidateMode ?? "compare",
      persistedSingleModelId(failed.candidateMode ?? "compare", failed.singleModelId),
      failed.compareModelIds,
      failed._id
    );
  },
});

/** Retry only failed compare-mode models. Successful candidates are copied
 * into a fresh linked generation before failed models are scheduled. */
export const retryFailedCandidates = mutation({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
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
    const { project, user } = await requireInternalProjectAccess(ctx, generation.projectId);
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
    if (!resolveCompareModels(compareModelIds)) {
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
    await ctx.db.patch(generation._id, {
      status: "superseded",
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
    let retryId: Id<"generations">;
    try {
      retryId = await reserveGeneration(
        ctx,
        resetProject,
        user._id,
        generation.lengthTarget ?? "standard",
        "compare",
        undefined,
        compareModelIds,
        generation._id,
        failedModelIds,
        successfulCandidates.length
      );
    } catch (error) {
      // The whole mutation is transactional, so this restoration mainly
      // documents the intended invariant and protects future refactors that
      // move reservation work behind a non-throwing boundary.
      await ctx.db.patch(generation._id, {
        status: "awaiting_selection",
        currentStep: "Choose your preferred draft",
        completedAt: undefined,
      });
      await ctx.db.patch(project._id, {
        activeGenerationId: generation._id,
        status: "generating",
        updatedAt: Date.now(),
      });
      await refreshProjectGenerationActivity(ctx, generation.projectId);
      throw error;
    }
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
    await ctx.db.patch(retryId, {
      progressLog: [
        "Generation recovery reserved.",
        successfulCandidates.length > 0
          ? `Kept ${successfulCandidates.length} completed draft${successfulCandidates.length === 1 ? "" : "s"}.`
          : "Retrying all failed drafts.",
      ],
    });
    return retryId;
  },
});

// ─── Internal functions used by the pipeline action ──────────────────────────

export const beginGeneration = internalMutation({
  args: {
    generationId: v.id("generations"),
    promptVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "reserved") return false;
    if (
      generation.learningDigestIds !== undefined &&
      !/^sha256:[0-9a-f]{64}$/.test(args.promptVersion)
    ) {
      throw new Error("Invalid promptVersion hash");
    }
    const project = await ctx.db.get(generation.projectId);
    if (!project || project.activeGenerationId !== generation._id) return false;
    await ctx.db.patch(generation._id, {
      status: "running",
      // A present digest array is the new-reservation marker. Legacy reserved
      // rows remain valid and are deliberately not retroactively attributed.
      ...(generation.learningDigestIds !== undefined
        ? { promptVersion: args.promptVersion }
        : {}),
      currentStep: "Preparing frozen project sources...",
      startedAt: Date.now(),
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    return true;
  },
});

/**
 * Record the exact learning digests disclosed in one provider payload.
 * The read + union + patch is one Convex transaction, so concurrent candidate
 * handoffs converge through optimistic retry instead of overwriting each
 * other. Terminal generations remain writable here because post-assembly QA
 * is generation-owned and may legitimately disclose a newer calibration.
 */
export const unionLearningDigestIds = internalMutation({
  args: {
    generationId: v.id("generations"),
    digestIds: v.array(v.id("learningDigests")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) {
      throw new Error("Generation not found for learning digest handoff");
    }
    if (
      generation.promptVersion === undefined ||
      generation.learningDigestIds === undefined
    ) {
      // A legacy row (neither field) is a deliberate no-op. Either field
      // present without the other is a provenance state the entry actions
      // never produce, so say so rather than dropping the ids silently.
      if (generation.learningDigestIds !== undefined) {
        console.warn(
          `Learning digest handoff for generation ${generation._id} arrived before its prompt version was stamped; ids were not recorded.`
        );
      } else if (generation.promptVersion !== undefined) {
        console.warn(
          `Learning digest handoff for generation ${generation._id} found a prompt version without a digest union array; ids were not recorded.`
        );
      }
      return null;
    }
    const next = [
      ...new Set([...generation.learningDigestIds, ...args.digestIds]),
    ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (
      next.length !== generation.learningDigestIds.length ||
      next.some((id, index) => id !== generation.learningDigestIds?.[index])
    ) {
      await ctx.db.patch(generation._id, { learningDigestIds: next });
    }
    return null;
  },
});

export const getGenerationInput = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const project = await ctx.db.get(generation.projectId);
    if (!project || project.activeGenerationId !== generation._id) return null;
    const sources = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      // One transcript row and one digest row per transcript, plus the 50
      // context documents. A tighter bound would drop the digest rows of a
      // many-transcript project — the case digest mode exists for — and hand
      // the model the over-budget full text instead.
      .take(2 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
    const transcriptIds = generationTranscriptIds(generation);
    const inputMode = generation.inputMode ?? "full";
    const toPart = (source: Doc<"generationSources">) => ({
      sourceId: source._id,
      contentHash: source.contentHash,
      content: source.content,
      label: source.label,
    });
    // Digest rows are written concurrently, so the frozen transcript set — not
    // insertion order — decides which digest is part 1. A generation in digest
    // mode that has not been condensed yet reads its transcript rows; the
    // pipeline condenses and reads again.
    const digestRows = sources.filter(
      (source) => source.kind === "transcript_digest"
    );
    const orderedDigests = (transcriptIds ?? []).flatMap((id) => {
      const row = digestRows.find((source) => source.transcriptId === id);
      return row ? [row] : [];
    });
    const digestParts =
      inputMode === "digest" &&
      transcriptIds !== undefined &&
      orderedDigests.length === transcriptIds.length
        ? orderedDigests
        : undefined;
    // Insertion order is reservation order, which is the project's transcript
    // order; every offset the pipeline cites is relative to one of these rows.
    const transcriptParts = (
      digestParts ?? sources.filter((source) => source.kind === "transcript")
    ).map(toPart);
    return {
      inputMode,
      digestIds: generation.digestIds,
      generationId: generation._id,
      projectId: project._id,
      // Usage attribution: the user who requested this generation (may differ
      // from the project creator, e.g. an admin retry).
      requestedBy: generation.requestedBy,
      transcriptId: generation.transcriptId,
      transcriptIds,
      transcript: buildTranscriptPromptText(transcriptParts),
      transcriptParts,
      title: project.title,
      lengthTarget: generation.lengthTarget ?? "standard",
      candidateMode: generation.candidateMode ?? "compare",
      singleModelId: generation.singleModelId as CandidateModelId | undefined,
      compareModelIds: generation.compareModelIds,
      retryModelIds: generation.retryModelIds,
      seededCandidates: generation.seededCandidates ?? 0,
      industry: project.industry,
      scienceCode: project.scienceCode,
      contextDocs: sources
        .filter((source) => source.kind === "project_document")
        .map((source) => {
          const separator = source.label.indexOf(":");
          const category = separator >= 0 ? source.label.slice(0, separator) : "other";
          return {
            sourceId: source._id,
            category,
            fileName: separator >= 0 ? source.label.slice(separator + 1) : source.label,
            content: source.content,
            // CAP-3: frozen at reservation. Absent = client trust.
            ...(source.uploaderRole ? { uploaderRole: source.uploaderRole } : {}),
          };
        }),
      // Analyzer context budget as configured right now. Each candidate
      // re-reads this query, so an admin retune mid-generation does reach
      // later candidates and can disagree with the budget already recorded on
      // the source rows — the recorded report describes the run that wrote it.
      contextBudget: await analyzerContextBudget(ctx),
    };
  },
});

/**
 * Record what the analyzer's context budget did with each frozen source row
 * (convex/ai/trustedContext.ts). Additive: capture-time facts (`content`,
 * `contentHash`, `truncated`, `originalLength`) are never rewritten.
 */
export const recordContextBudget = internalMutation({
  args: {
    generationId: v.id("generations"),
    budgetTokens: v.number(),
    // Story 4: the document cap the report ran under ("cap N" in the Brief).
    maxDocuments: v.optional(v.number()),
    applied: v.array(
      v.object({
        sourceId: v.id("generationSources"),
        included: v.boolean(),
        includedLength: v.number(),
        truncated: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const entry of args.applied) {
      const row = await ctx.db.get(entry.sourceId);
      // A row deleted mid-generation, or an id from another generation, is
      // skipped rather than thrown: the budget report is telemetry, and
      // failing here would kill an otherwise-good generation.
      if (!row || row.generationId !== args.generationId) continue;
      await ctx.db.patch(entry.sourceId, {
        contextBudget: {
          budgetTokens: args.budgetTokens,
          included: entry.included,
          includedLength: entry.includedLength,
          truncated: entry.truncated,
          ...(args.maxDocuments !== undefined
            ? { maxDocuments: args.maxDocuments }
            : {}),
        },
        // Story 4 (AD-30): the only writer of `inclusion`.
        inclusion: sourceInclusion(entry),
      });
    }
    return null;
  },
});

// DW-133: getContextInclusion runs every read under ONE budget, because no
// single population is small enough to ignore. Frozen generationSources hold
// transcripts of up to FROZEN_TRANSCRIPT_CHARS (500k) and documents of up to
// 200k characters — up to 20 transcripts and 50 documents can exceed Convex's
// 16 MiB transaction read limit on their own — and each projectDocuments row
// carries its full extracted text (≤ 1 MiB). The budget charges the rows
// authorization already read, reserves a maximum-size document before each
// further read, and holds `DOCUMENT_HEADROOM` up front for the four small
// appSettings reads at the end; whatever it could not read is reported as
// truncated, never thrown. Worst case actually read: 14 MiB − 1 MiB reserved
// + a few KB of settings, ~3 MiB under the limit.
const INCLUSION_READ_BYTES = 14 * (1 << 20);
// The reservation freezes at most 2×20 transcript rows + 51 documents; 200
// keeps a wide margin, so bytes are the real bound.
const INCLUSION_SOURCE_ROWS = 200;
const INCLUSION_DOCUMENT_ROWS = 1000;

/**
 * Story 4 (CAP-11, AD-30): the Brief's Inputs band — one inclusion row per
 * frozen Transcript and Supporting Document, plus the project documents the
 * reservation skipped (archived or unreadable at the time), with the cap.
 * The one inclusion read. Null for an outsider or a missing generation.
 */
export const getContextInclusion = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const access = await getInternalProjectAccessOrNull(ctx, generation.projectId);
    if (!access) return null;
    const reads = createReadBudget({
      maxBytes: INCLUSION_READ_BYTES,
      reservedBytes: DOCUMENT_HEADROOM,
    });
    reads.account(generation);
    reads.account(access.user);
    reads.account(access.project);

    const sourceRead = await reads.list(
      ctx.db
        .query("generationSources")
        .withIndex("by_generationId", (q) => q.eq("generationId", generation._id)),
      INCLUSION_SOURCE_ROWS
    );
    const sources = sourceRead.rows;
    const sourcesTruncated = !sourceRead.complete;
    const frozenDocumentIds = new Set(
      sources.flatMap((row) => (row.projectDocumentId ? [row.projectDocumentId] : []))
    );
    // DW-133: a project's lifetime document count is unbounded (uploadDocument
    // has no cap), so the listing walks the whole index range under the
    // shared budget instead of a flat take(100), and reports when it had to
    // stop rather than letting the totals silently undercount. With a partial
    // source set an unread frozen row is indistinguishable from an unfrozen
    // document, so the walk is skipped and reported as truncated instead of
    // mislabelling frozen documents as never captured.
    let unfrozenDocuments: UnfrozenDocument[] = [];
    let documentsTruncated = true;
    if (!sourcesTruncated) {
      const documentRead = await reads.list(
        ctx.db
          .query("projectDocuments")
          .withIndex("by_projectId", (q) => q.eq("projectId", generation.projectId)),
        INCLUSION_DOCUMENT_ROWS
      );
      documentsTruncated = !documentRead.complete;
      // CAP-17: every document attached before the reservation is listed. The
      // reasons mirror reserveGeneration's skip rule (archived, no readable
      // text); a readable one it never captured — the reservation freezes a
      // bounded number of documents — is listed as not captured rather than
      // silently dropped from the band and its counts.
      unfrozenDocuments = documentRead.rows.flatMap((document): UnfrozenDocument[] => {
        if (document.createdAt > generation.startedAt) return [];
        if (frozenDocumentIds.has(document._id)) return [];
        const reason = document.archived
          ? ("archived" as const)
          : !document.content.trim()
            ? ("unreadable" as const)
            : ("not_captured" as const);
        return [{ _id: document._id, fileName: document.fileName, reason }];
      });
    }
    // Four small appSettings rows, covered by the budget's up-front reservation.
    const budget = await analyzerContextBudget(ctx);
    return assembleContextInclusion({
      sources: sources.map((row) => ({
        _id: row._id,
        kind: row.kind,
        label: row.label,
        ...(row.transcriptId ? { transcriptId: row.transcriptId } : {}),
        ...(row.inclusion ? { inclusion: row.inclusion } : {}),
        ...(row.contextBudget ? { contextBudget: row.contextBudget } : {}),
      })),
      unfrozenDocuments,
      fallbackCap: budget.maxDocuments,
      documentsTruncated,
      sourcesTruncated,
    });
  },
});

export const createCandidateRun = internalMutation({
  args: {
    generationId: v.id("generations"),
    model: v.string(),
    label: v.string(),
    // Iterative mode's background one-shot comparison draft (peek-only).
    ghost: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "running") return null;
    const existing = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_generationId_and_model", (q) =>
        q.eq("generationId", args.generationId).eq("model", args.model)
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("generationCandidateRuns", {
      generationId: generation._id,
      projectId: generation.projectId,
      model: args.model,
      label: args.label,
      status: "queued",
      ...(args.ghost ? { ghost: true } : {}),
      queuedAt: Date.now(),
    });
  },
});

export const setCandidateRunJob = internalMutation({
  args: {
    candidateRunId: v.id("generationCandidateRuns"),
    scheduledJobId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.candidateRunId);
    if (run?.status === "queued") {
      await ctx.db.patch(run._id, { scheduledJobId: args.scheduledJobId });
    }
  },
});

export const claimCandidateRun = internalMutation({
  args: { candidateRunId: v.id("generationCandidateRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.status !== "queued") return null;
    const generation = await ctx.db.get(run.generationId);
    const project = await ctx.db.get(run.projectId);
    // Ghost runs draft in parallel with the iterative section flow, whose
    // generation oscillates running ↔ awaiting_input while the writer reviews.
    const activeStatuses: string[] = run.ghost
      ? ["running", "awaiting_input"]
      : ["running"];
    if (
      !generation ||
      !activeStatuses.includes(generation.status) ||
      !project ||
      project.activeGenerationId !== generation._id
    ) {
      return null;
    }
    await ctx.db.patch(run._id, { status: "running", startedAt: Date.now() });
    return {
      generationId: generation._id,
      projectId: run.projectId,
      model: run.model,
      label: run.label,
      // Story 2: non-ghost runs start the ordered chain; ghosts stay one-shot.
      ghost: run.ghost ?? false,
    };
  },
});

async function createGeneratedReportArtifacts(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  candidate: Pick<
    Doc<"reportCandidates">,
    "projectId" | "content" | "agentOutputs" | "provenanceId" | "label"
  >
) {
  const existingReport = await ctx.db
    .query("reports")
    .withIndex("by_generationId", (q) =>
      q.eq("generationId", generation._id)
    )
    .unique();
  if (existingReport) return existingReport._id;

  const now = Date.now();
  const latest = await ctx.db
    .query("reports")
    .withIndex("by_projectId", (q) => q.eq("projectId", candidate.projectId))
    .order("desc")
    .first();
  const contentHash = await sha256(candidate.content);
  const reportId = await ctx.db.insert("reports", {
    projectId: candidate.projectId,
    generationId: generation._id,
    sourceTranscriptId: generation.transcriptId,
    sourceTranscriptIds: generationTranscriptIds(generation),
    provenanceId: candidate.provenanceId,
    content: candidate.content,
    contentHash,
    revisionNumber: 0,
    version: (latest?.version ?? 0) + 1,
    generatedAt: now,
    updatedAt: now,
  });
  await persistDeterministicFindings(ctx, reportId, candidate.agentOutputs);
  const createdReport = await ctx.db.get(reportId);
  if (createdReport) {
    let outputs: unknown;
    try { outputs = JSON.parse(candidate.agentOutputs ?? "{}"); }
    catch { /* Malformed initial QA is not compliance evidence. */ }
    if (outputs && typeof outputs === "object" && "qa" in outputs) {
      await persistMethodologyFindings(ctx, createdReport, outputs.qa);
    }
  }
  await ctx.db.insert("reportSnapshots", {
    projectId: candidate.projectId,
    reportId,
    generationId: generation._id,
    sourceTranscriptId: generation.transcriptId,
    sourceTranscriptIds: generationTranscriptIds(generation),
    provenanceId: candidate.provenanceId,
    sourceRevisionNumber: 0,
    contentHash,
    content: candidate.content,
    reason: "generated",
    label: `AI draft (${candidate.label})`,
    createdByRole: "system",
    createdAt: now,
  });
  // BNH-10 / CAP-2: freeze the (zero) post-edit distance at candidate
  // selection. This is the single choke point for every "generated" baseline
  // that belongs to a report, so all three candidate paths are covered here.
  const report = await ctx.db.get(reportId);
  if (report) await recordReportEditDistance(ctx, report, "candidate_selection");
  return reportId;
}

const completeCandidateRunArgs = v.object({
  candidateRunId: v.id("generationCandidateRuns"),
  content: v.optional(v.string()),
  agentOutputs: v.optional(v.string()),
  qaScore: v.optional(v.number()),
  provenanceId: v.optional(v.id("reportProvenance")),
  error: v.optional(v.string()),
  // Story 2 (AD-24): the Build Order the ordered chain ran, and the section
  // it stopped after when the writer stopped before the last section.
  productionOrder: v.optional(v.array(sectionNumberValidator)),
  stoppedAfterSection: v.optional(sectionNumberValidator),
});

export const completeCandidateRun = internalMutation({
  args: completeCandidateRunArgs.fields,
  handler: async (ctx, args) => {
    await settleCandidateRun(ctx, args);
  },
});

/** completeCandidateRun's body, shared with the ordered chain's failure path
 * (failOrderedSectionRun) so a failed section fails its candidate the same
 * way a failed one-shot run does. */
async function settleCandidateRun(
  ctx: MutationCtx,
  args: Infer<typeof completeCandidateRunArgs>
) {
    const run = await ctx.db.get(args.candidateRunId);
    if (!run || run.status !== "running") return;
    const generation = await ctx.db.get(run.generationId);
    const project = await ctx.db.get(run.projectId);
    const succeeded = Boolean(args.content && args.agentOutputs && !args.error);

    // A ghost finishing AFTER its iterative generation went terminal (writer
    // approved the last section, or cancelled) must still terminalize its own
    // run row — otherwise it reads "running" forever and skews run stats. If
    // the generation completed, the comparison draft still becomes the
    // promised version-history snapshot; on cancel/failure it is discarded.
    if (run.ghost && generation && isTerminalGenerationStatus(generation.status)) {
      await ctx.db.patch(run._id, {
        status: succeeded ? "succeeded" : "failed",
        qaScore: args.qaScore,
        error: args.error?.slice(0, 500),
        completedAt: Date.now(),
      });
      if (succeeded && args.content && generation.status === "completed") {
        const report = await ctx.db
          .query("reports")
          .withIndex("by_generationId", (q) =>
            q.eq("generationId", generation._id)
          )
          .first();
        if (report) {
          await ctx.db.insert("reportSnapshots", {
            projectId: generation.projectId,
            reportId: report._id,
            generationId: generation._id,
            sourceTranscriptId: generation.transcriptId,
            sourceTranscriptIds: generationTranscriptIds(generation),
            provenanceId: args.provenanceId,
            sourceRevisionNumber: 0,
            contentHash: await sha256(args.content),
            content: args.content,
            reason: "generated",
            label: `One-shot ghost draft (comparison — ${run.label})`,
            createdByRole: "system",
            createdAt: Date.now(),
          });
        }
      }
      return;
    }

    const activeStatuses: string[] = run.ghost
      ? ["running", "awaiting_input"]
      : ["running"];
    if (
      !generation ||
      !activeStatuses.includes(generation.status) ||
      !project ||
      project._id !== generation.projectId ||
      project.activeGenerationId !== generation._id
    ) {
      return;
    }
    let candidateId: Id<"reportCandidates"> | undefined;
    if (succeeded && args.content && args.agentOutputs) {
      candidateId = await ctx.db.insert("reportCandidates", {
        generationId: run.generationId,
        projectId: run.projectId,
        model: run.model,
        label: run.label,
        content: args.content,
        agentOutputs: args.agentOutputs,
        provenanceId: args.provenanceId,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(run._id, {
      status: succeeded ? "succeeded" : "failed",
      candidateId,
      qaScore: args.qaScore,
      error: args.error?.slice(0, 500),
      completedAt: Date.now(),
    });

    // Ghost run (iterative mode): the candidate row is a peek-only comparison
    // draft. It never advances the generation lifecycle — section approvals
    // drive that — so log and stop here.
    if (run.ghost) {
      await ctx.db.patch(generation._id, {
        progressLog: [
          ...(generation.progressLog ?? []),
          succeeded
            ? `✓ One-shot comparison draft ready (${run.label}).`
            : `✗ One-shot comparison draft failed: ${args.error ?? "provider error"}.`,
        ],
      });
      return;
    }

    // Story 2 (AD-24): stamp the production order (shared by every compare
    // candidate, one Build Order per generation) and, for a stopped single
    // chain, the section it stopped after. Compare candidates stop
    // independently, so there the selected candidate's value is copied on
    // selectReportCandidate instead.
    const stampStop =
      args.stoppedAfterSection !== undefined && generation.candidateMode === "single";
    if (args.productionOrder || stampStop) {
      await ctx.db.patch(generation._id, {
        ...(args.productionOrder ? { productionOrder: args.productionOrder } : {}),
        ...(stampStop ? { stoppedAfterSection: args.stoppedAfterSection } : {}),
      });
    }

    const runs = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", run.generationId))
      .take(10);
    const terminal = runs.filter(
      (candidateRun) =>
        candidateRun._id === run._id ||
        candidateRun.status === "succeeded" ||
        candidateRun.status === "failed"
    );
    const done = terminal.filter(
      (candidateRun) =>
        candidateRun._id === run._id ? succeeded : candidateRun.status === "succeeded"
    ).length;
    const failed = terminal.length - done;
    const progressLog = [
      ...(generation.progressLog ?? []),
      succeeded
        ? `✓ ${run.label} draft ready (QA ${args.qaScore ?? "—"}/100).`
        : `✗ ${run.label} failed: ${args.error ?? "provider error"}.`,
    ];
    if (terminal.length < (generation.totalCandidates ?? runs.length)) {
      await ctx.db.patch(generation._id, {
        candidatesDone: done,
        candidatesFailed: failed,
        progressLog,
      });
      return;
    }
    if (done > 0) {
      if (generation.candidateMode !== "single") {
        await ctx.db.patch(generation._id, {
          status: "awaiting_selection",
          candidatesDone: done,
          candidatesFailed: failed,
          currentStep: "Choose your preferred draft",
          progressLog,
        });
        await refreshProjectGenerationActivity(ctx, generation.projectId);
        return;
      }

      const candidate = candidateId ? await ctx.db.get(candidateId) : null;
      if (!candidate) return;
      await createGeneratedReportArtifacts(ctx, generation, candidate);
      const now = Date.now();
      await ctx.db.patch(project._id, {
        activeGenerationId: undefined,
        status: "review",
        updatedAt: now,
      });
      await ctx.db.patch(generation._id, {
        status: "completed",
        candidatesDone: done,
        candidatesFailed: failed,
        currentStep: "Complete",
        agentOutputs: candidate.agentOutputs,
        completedAt: now,
        progressLog,
      });
      await refreshProjectGenerationActivity(ctx, generation.projectId);
      const candidates = await ctx.db
        .query("reportCandidates")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", generation._id)
        )
        .take(10);
      for (const row of candidates) await ctx.db.delete(row._id);
      return;
    }

    await ctx.db.patch(generation._id, {
      status: "failed",
      candidatesDone: 0,
      candidatesFailed: failed,
      currentStep: "Failed",
      error: "All candidate models failed to generate.",
      completedAt: Date.now(),
      progressLog,
    });
    await ctx.db.patch(project._id, {
      activeGenerationId: undefined,
      status: generation.previousProjectStatus ?? "draft",
      updatedAt: Date.now(),
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
}

/**
 * A generation going terminal must settle its in-flight candidate runs too:
 * a run left "running" after a whole-generation failure never gets another
 * completeCandidateRun (the action is dead or its CAS fence refuses), so it
 * skews run stats forever and hides from retryFailedCandidates, which only
 * counts status "failed". Mirrors the ghost-run treatment in
 * completeCandidateRun. Status-CAS: only queued/running rows are touched.
 */
async function terminalizeOrphanedCandidateRuns(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  error: string
) {
  const runs = await ctx.db
    .query("generationCandidateRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(10);
  for (const run of runs) {
    if (run.status !== "queued" && run.status !== "running") continue;
    await ctx.db.patch(run._id, {
      status: "failed",
      error,
      completedAt: Date.now(),
    });
  }
}

export const failGeneration = internalMutation({
  args: {
    generationId: v.id("generations"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      (generation.status !== "reserved" && generation.status !== "running")
    ) {
      return;
    }
    await ctx.db.patch(generation._id, {
      status: "failed",
      currentStep: "Failed",
      error: args.error.slice(0, 500),
      completedAt: Date.now(),
    });
    await terminalizeOrphanedCandidateRuns(
      ctx,
      generation._id,
      "The generation failed before this draft completed."
    );
    const project = await ctx.db.get(generation.projectId);
    if (project?.activeGenerationId === generation._id) {
      await ctx.db.patch(project._id, {
        activeGenerationId: undefined,
        status: generation.previousProjectStatus ?? "draft",
        updatedAt: Date.now(),
      });
    }
    await refreshProjectGenerationActivity(ctx, generation.projectId);
  },
});


// ─── Iterative (section-by-section) generation lifecycle ─────────────────────
//
// One generationSectionRuns row per T661 section. The writer reviews, edits,
// and approves each drafted section before the next is generated with the
// approved text as canonical context. The generation row oscillates
// running (a section is drafting) ↔ awaiting_input (writer reviewing); a
// background "ghost" one-shot draft runs through the normal candidate
// pipeline for comparison only.

const SECTION_ORDER = ["s242", "s244", "s246"] as const;
type IterativeSection = (typeof SECTION_ORDER)[number];
const sectionValidator = v.union(
  v.literal("s242"),
  v.literal("s244"),
  v.literal("s246")
);
const SECTION_TITLES: Record<IterativeSection, string> = {
  s242: "Line 242 — Uncertainty",
  s244: "Line 244 — Work performed",
  s246: "Line 246 — Advancement",
};

async function getSectionRun(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  section: IterativeSection
) {
  return await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_generationId_and_section", (q) =>
      q.eq("generationId", generationId).eq("section", section)
    )
    .unique();
}

/** Freeze the one-time iterative artifacts (analyzer output; brain blocks +
 * style guidance). `brainBlocks` content shape (JSON):
 * `{ blocks: {analyzer,s242,s244,s246}, styleGuidance: string }`. */
export const saveIterativeArtifacts = internalMutation({
  args: {
    generationId: v.id("generations"),
    analysis: v.string(),
    brainBlocks: v.string(),
  },
  handler: async (ctx, args) => {
    for (const [kind, content] of [
      ["analysis", args.analysis],
      ["brain_blocks", args.brainBlocks],
    ] as const) {
      const existing = await ctx.db
        .query("generationArtifacts")
        .withIndex("by_generationId_and_kind", (q) =>
          q.eq("generationId", args.generationId).eq("kind", kind)
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { content });
      } else {
        await ctx.db.insert("generationArtifacts", {
          generationId: args.generationId,
          kind,
          content,
        });
      }
    }
  },
});

// ─── Story 1 (CAP-1/2/4): Generation Brief internal helpers ────────────────
// The stage itself (`convex/ai/brief.ts:deriveOrReuseBrief`) is a plain
// "use node" helper called directly from `pipeline.ts`/`iterative.ts` (same
// pattern as `runAnalyzerAgent`) — not a registered Convex function, so it
// never needs an `internal.ai.brief.*` reference. These are its only reads
// and writes; they live here (an already-registered, non-node module) so a
// stale `_generated/api.d.ts` never has to learn a brand-new file to
// typecheck. `deriveOrReuseBrief` and `briefs.saveEntryEdit` are the only two
// writers of `generationBriefs`/`generationBriefEntries` (AD-23).

/** The frozen `generationSources` rows a Brief derivation reads. */
export const getGenerationSourcesForBrief = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", args.generationId))
      .take(200);
  },
});

/** MAX(version) Brief for (projectId, inputsHash), regardless of origin — a
 * writer-edited version is reused too (CAP-4: "the next generation with the
 * same inputsHash reuses that version"). */
export const findReusableBrief = internalQuery({
  args: { projectId: v.id("projects"), inputsHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("generationBriefs")
      .withIndex("by_projectId_and_inputsHash", (q) =>
        q.eq("projectId", args.projectId).eq("inputsHash", args.inputsHash)
      )
      .order("desc")
      .first();
  },
});

/** Reuse path: stamp the reused Brief onto this generation. No new version,
 * no model call. */
export const stampGenerationBriefId = internalMutation({
  args: { generationId: v.id("generations"), briefId: v.id("generationBriefs") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.generationId, { briefId: args.briefId });
  },
});

const briefEntryGroupValidator = v.union(
  v.literal("storyline"),
  v.literal("claimExclusion"),
  v.literal("confidenceMap"),
  v.literal("glossaryTerm")
);
const briefEntryReasonValidator = v.union(
  v.literal("business_risk"),
  v.literal("routine_engineering"),
  v.literal("outside_claim_period"),
  v.literal("not_technological")
);
const briefEntryConfidenceValidator = v.union(
  v.literal("established"),
  v.literal("partial"),
  v.literal("unresolved"),
  v.literal("unreliable")
);
const briefCandidateEntryValidator = v.object({
  group: briefEntryGroupValidator,
  text: v.string(),
  reason: v.optional(briefEntryReasonValidator),
  confidence: v.optional(briefEntryConfidenceValidator),
  sourceId: v.id("generationSources"),
  sourceContentHash: v.string(),
  startOffset: v.number(),
  endOffset: v.number(),
  exactExcerpt: v.string(),
});

/**
 * New-derivation path: re-validates every candidate entry's citation against
 * the live frozen source (defense in depth — the caller already validated
 * against the same in-memory sources), drops failures and counts them,
 * inserts the new `generationBriefs` version, diffs against the project's
 * previous Brief (any inputsHash) by `(group, sourceContentHash,
 * startOffset, endOffset)` and stamps `change` on every entry — including a
 * "removed" marker row for anything the previous version had that this one
 * doesn't — then stamps `briefId` on the generation.
 */
export const persistDerivedBrief = internalMutation({
  args: {
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    inputsHash: v.string(),
    origin: v.union(v.literal("writer"), v.literal("derived")),
    storylineText: v.string(),
    entries: v.array(briefCandidateEntryValidator),
    // Entries the caller already dropped before reaching here (its own
    // citeQuote pass never found a byte-match — see `brief.ts`). Added to
    // whatever this mutation's own re-validation additionally drops, so
    // `droppedEntryCount` reflects every entry the model proposed that never
    // made it into the Brief.
    upstreamDroppedEntryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let droppedEntryCount = args.upstreamDroppedEntryCount ?? 0;
    const validatedEntries: Array<
      (typeof args.entries)[number]
    > = [];
    for (const entry of args.entries) {
      const source = await ctx.db.get(entry.sourceId);
      // Tenant-scoping parity with reports.createProvenance (convex/reports.ts:108-118):
      // a citation must resolve to a source belonging to this project and generation,
      // not just pass the byte-match check.
      if (
        !source ||
        source.projectId !== args.projectId ||
        source.generationId !== args.generationId ||
        !validateCitation(source, entry)
      ) {
        droppedEntryCount += 1;
        continue;
      }
      validatedEntries.push(entry);
    }

    // The project's previous Brief (any inputsHash) — the diff baseline.
    const previousBrief = await ctx.db
      .query("generationBriefs")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    const previousEntries = previousBrief
      ? await ctx.db
          .query("generationBriefEntries")
          .withIndex("by_briefId", (q) => q.eq("briefId", previousBrief._id))
          .take(500)
      : [];
    const diffKey = (e: {
      group: string;
      sourceContentHash: string;
      startOffset: number;
      endOffset: number;
    }) => `${e.group}|${e.sourceContentHash}|${e.startOffset}|${e.endOffset}`;
    const previousByKey = new Map(previousEntries.map((e) => [diffKey(e), e]));

    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: args.projectId,
      generationId: args.generationId,
      inputsHash: args.inputsHash,
      version: 1,
      origin: args.origin,
      storylineText: args.storylineText,
      droppedEntryCount,
      createdAt: Date.now(),
    });

    for (const entry of validatedEntries) {
      const key = diffKey(entry);
      const change = !previousBrief
        ? undefined
        : previousByKey.has(key)
          ? ("unchanged" as const)
          : ("added" as const);
      previousByKey.delete(key);
      await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId: args.projectId,
        group: entry.group,
        text: entry.text,
        reason: entry.reason,
        confidence: entry.confidence,
        sourceId: entry.sourceId,
        sourceContentHash: entry.sourceContentHash,
        startOffset: entry.startOffset,
        endOffset: entry.endOffset,
        exactExcerpt: entry.exactExcerpt,
        change,
        createdAt: Date.now(),
      });
    }
    // Whatever's left in previousByKey existed before and doesn't now.
    for (const removed of previousByKey.values()) {
      await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId: args.projectId,
        group: removed.group,
        text: removed.text,
        reason: removed.reason,
        confidence: removed.confidence,
        sourceId: removed.sourceId,
        sourceContentHash: removed.sourceContentHash,
        startOffset: removed.startOffset,
        endOffset: removed.endOffset,
        exactExcerpt: removed.exactExcerpt,
        change: "removed",
        createdAt: Date.now(),
      });
    }

    await ctx.db.patch(args.generationId, { briefId });
    return briefId;
  },
});

/** The stored Brief rendered as an AD-11 delimited data block, ready to
 * append to a section prompt. "" when the generation has no Brief yet. */
export const renderBriefForGeneration = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation?.briefId) return "";
    const brief = await ctx.db.get(generation.briefId);
    if (!brief) return "";
    const entries = await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", brief._id))
      .take(500);
    return renderBriefBlock(
      brief.storylineText,
      entries.filter((e) => e.group !== "storylineQuestion")
    );
  },
});

/** Create the three section-run slots: s242 queued, the rest pending. */
export const createSectionRuns = internalMutation({
  args: {
    generationId: v.id("generations"),
    model: v.string(),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "running") return false;
    const now = Date.now();
    for (const section of SECTION_ORDER) {
      const existing = await getSectionRun(ctx, args.generationId, section);
      if (existing) continue;
      await ctx.db.insert("generationSectionRuns", {
        generationId: generation._id,
        projectId: generation.projectId,
        section,
        status: section === "s242" ? "queued" : "pending",
        model: args.model,
        label: args.label,
        attempt: 1,
        queuedAt: now,
      });
    }
    return true;
  },
});

export const claimSectionRun = internalMutation({
  args: { generationId: v.id("generations"), section: sectionValidator },
  handler: async (ctx, args) => {
    const run = await getSectionRun(ctx, args.generationId, args.section);
    if (!run || run.status !== "queued") return null;
    const generation = await ctx.db.get(run.generationId);
    const project = await ctx.db.get(run.projectId);
    if (
      !generation ||
      generation.status !== "running" ||
      !project ||
      project.activeGenerationId !== generation._id
    ) {
      return null;
    }
    await ctx.db.patch(run._id, { status: "running", startedAt: Date.now() });
    return {
      generationId: generation._id,
      projectId: run.projectId,
      model: run.model,
      label: run.label,
      attempt: run.attempt,
      guidance: run.guidance ?? null,
    };
  },
});

/** Persist a finished section draft: run → awaiting_review, generation →
 * awaiting_input (the writer's turn). */
export const completeSectionRun = internalMutation({
  args: {
    generationId: v.id("generations"),
    section: sectionValidator,
    draftText: v.string(),
    metrics: v.string(),
    qa: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await getSectionRun(ctx, args.generationId, args.section);
    if (!run || run.status !== "running") return;
    const generation = await ctx.db.get(run.generationId);
    const project = await ctx.db.get(run.projectId);
    if (
      !generation ||
      generation.status !== "running" ||
      !project ||
      project.activeGenerationId !== generation._id
    ) {
      return;
    }
    await ctx.db.patch(run._id, {
      status: "awaiting_review",
      draftText: args.draftText,
      metrics: args.metrics,
      qa: args.qa,
      error: undefined,
      completedAt: Date.now(),
    });
    await ctx.db.patch(generation._id, {
      status: "awaiting_input",
      currentStep: `Review the ${SECTION_TITLES[args.section]} draft`,
      progressLog: [
        ...(generation.progressLog ?? []),
        `✓ ${SECTION_TITLES[args.section]} draft ready for review.`,
      ],
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
  },
});

export const failSectionRun = internalMutation({
  args: {
    generationId: v.id("generations"),
    section: sectionValidator,
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await getSectionRun(ctx, args.generationId, args.section);
    if (!run || (run.status !== "running" && run.status !== "queued")) return;
    const generation = await ctx.db.get(run.generationId);
    if (!generation) return;
    await ctx.db.patch(run._id, {
      status: "failed",
      error: args.error.slice(0, 500),
      completedAt: Date.now(),
    });
    // The generation stays alive in awaiting_input: the writer regenerates
    // the failed section (or cancels) from the stepper.
    if (generation.status === "running") {
      await ctx.db.patch(generation._id, {
        status: "awaiting_input",
        currentStep: `${SECTION_TITLES[args.section]} draft failed`,
        progressLog: [
          ...(generation.progressLog ?? []),
          `✗ ${SECTION_TITLES[args.section]} draft failed: ${args.error.slice(0, 200)}.`,
        ],
      });
      await refreshProjectGenerationActivity(ctx, generation.projectId);
    }
  },
});

/** Frozen inputs for drafting one section: analyzer output, this section's
 * Brain block, the style guidance captured at start, and every approved
 * prior section (in order). Ghost drafts NEVER flow through here. */
export const getIterativeSectionInput = internalQuery({
  args: { generationId: v.id("generations"), section: sectionValidator },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const project = await ctx.db.get(generation.projectId);
    if (!project || project.activeGenerationId !== generation._id) return null;
    const [analysisRow, brainRow] = await Promise.all([
      ctx.db
        .query("generationArtifacts")
        .withIndex("by_generationId_and_kind", (q) =>
          q.eq("generationId", generation._id).eq("kind", "analysis")
        )
        .unique(),
      ctx.db
        .query("generationArtifacts")
        .withIndex("by_generationId_and_kind", (q) =>
          q.eq("generationId", generation._id).eq("kind", "brain_blocks")
        )
        .unique(),
    ]);
    if (!analysisRow) return null;
    let brainBlock = "";
    let styleGuidance = "";
    let draftStyleDigestId: Id<"learningDigests"> | undefined;
    let styleOverrides: Record<string, boolean> | undefined;
    if (brainRow) {
      try {
        const parsed: unknown = JSON.parse(brainRow.content);
        if (parsed && typeof parsed === "object") {
          if (
            "blocks" in parsed &&
            parsed.blocks &&
            typeof parsed.blocks === "object" &&
            args.section in parsed.blocks
          ) {
            const block = (parsed.blocks as Record<string, unknown>)[args.section];
            if (typeof block === "string") brainBlock = block;
          }
          if (
            "styleGuidance" in parsed &&
            typeof parsed.styleGuidance === "string"
          ) {
            styleGuidance = parsed.styleGuidance;
          }
          if (
            "draftStyleDigestId" in parsed &&
            typeof parsed.draftStyleDigestId === "string"
          ) {
            draftStyleDigestId =
              ctx.db.normalizeId("learningDigests", parsed.draftStyleDigestId) ??
              undefined;
          }
          // PSOS-49: house-style waivers frozen at generation start (absent on
          // legacy artifacts → default enforcement).
          if (
            "styleOverrides" in parsed &&
            parsed.styleOverrides &&
            typeof parsed.styleOverrides === "object"
          ) {
            styleOverrides = parsed.styleOverrides as Record<string, boolean>;
          }
        }
      } catch {
        // Malformed artifact: draft without brain/style context.
      }
    }
    const priorSections: Array<{ section: IterativeSection; text: string }> = [];
    for (const section of SECTION_ORDER) {
      if (section === args.section) break;
      const run = await getSectionRun(ctx, generation._id, section);
      if (run?.status !== "approved" || !run.approvedText) return null;
      priorSections.push({ section, text: run.approvedText });
    }
    return {
      analysis: analysisRow.content,
      brainBlock,
      styleGuidance,
      draftStyleDigestId,
      styleOverrides,
      priorSections,
      lengthTarget: generation.lengthTarget ?? "standard",
      projectId: generation.projectId,
      requestedBy: generation.requestedBy,
    };
  },
});

/** Capture the active attempt even when there is no report prose to evaluate. */
export const getPostQaAttempt = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    return generation?.postQaStatus === "running"
      ? { startedAt: generation.postQaStartedAt ?? null }
      : null;
  },
});

/** Input bundle for the post-assembly QA pass over the current report. */
export const getPostQaInput = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const report = await ctx.db.query("reports")
      .withIndex("by_generationId", q => q.eq("generationId", generation._id)).first();
    if (!report) return null;
    const capturedRef = await reportQaRef(report);
    const currentSections = extractReportSections(report.content);
    if (!Object.values(currentSections).some(text => text.trim())) return null;
    if ((generation.candidateMode ?? "compare") === "iterative") {
      const [analysisRow, brainRow] = await Promise.all([
        ctx.db
          .query("generationArtifacts")
          .withIndex("by_generationId_and_kind", (q) =>
            q.eq("generationId", args.generationId).eq("kind", "analysis")
          )
          .unique(),
        ctx.db
          .query("generationArtifacts")
          .withIndex("by_generationId_and_kind", (q) =>
            q.eq("generationId", args.generationId).eq("kind", "brain_blocks")
          )
          .unique(),
      ]);
      if (!analysisRow) return null;
      // PSOS-49: QA must score under the SAME waivers the sections were
      // drafted with — the ones frozen into the brain_blocks artifact at
      // generation start, not the writer's live profile.
      let styleOverrides: Record<string, boolean> | undefined;
      if (brainRow) {
        try {
          const parsed: unknown = JSON.parse(brainRow.content);
          if (
            parsed &&
            typeof parsed === "object" &&
            "styleOverrides" in parsed &&
            parsed.styleOverrides &&
            typeof parsed.styleOverrides === "object"
          ) {
            styleOverrides = parsed.styleOverrides as Record<string, boolean>;
          }
        } catch {
          // Malformed artifact: score under default enforcement.
        }
      }
      const sections: Record<IterativeSection, { text: string; model: string }> = {
        s242: { text: "", model: "" },
        s244: { text: "", model: "" },
        s246: { text: "", model: "" },
      };
      for (const section of SECTION_ORDER) {
        const run = await getSectionRun(ctx, args.generationId, section);
        sections[section] = {
          text: run?.approvedText ?? "",
          model: run?.model ?? "",
        };
      }
      if (!currentSections.s242.trim() && !currentSections.s244.trim() && !currentSections.s246.trim()) {
        return null;
      }
      return {
        projectId: generation.projectId,
        requestedBy: generation.requestedBy,
        analysis: analysisRow.content,
        section242: currentSections.s242,
        capturedRef,
        section244: currentSections.s244,
        section246: currentSections.s246,
        model: sections.s242.model || undefined,
        styleOverrides,
      };
    }
    // One-shot / compare generations (Jul 17: "regenerate QA panel"): the
    // analyzer output and section texts were persisted inside agentOutputs at
    // generation time — rebuild the QA input from there.
    if (!generation.agentOutputs) return null;
    try {
      const outputs = JSON.parse(generation.agentOutputs) as {
        analyzer?: unknown;
        section242?: string;
        section244?: string;
        section246?: string;
        styleOverrides?: Record<string, boolean>;
      };
      if (
        !outputs.analyzer
      ) {
        return null;
      }
      const selection = await ctx.db
        .query("modelSelections")
        .withIndex("by_projectId_and_generationId", (q) =>
          q.eq("projectId", generation.projectId).eq("generationId", generation._id)
        )
        .first();
      return {
        projectId: generation.projectId,
        requestedBy: generation.requestedBy,
        analysis: JSON.stringify(outputs.analyzer),
        section242: currentSections.s242,
        capturedRef,
        section244: currentSections.s244,
        section246: currentSections.s246,
        model: selection?.model ?? undefined,
        // PSOS-50: waivers frozen into agentOutputs at generation time.
        // Absent only on legacy generations, where postQa falls back to the
        // writer's live profile.
        styleOverrides:
          outputs.styleOverrides && typeof outputs.styleOverrides === "object"
            ? outputs.styleOverrides
            : undefined,
      };
    } catch {
      return null;
    }
  },
});

/** Merge the post-assembly QA scorecard + chronology into agentOutputs. */
export const saveReportQa = internalMutation({
  args: {
    generationId: v.id("generations"),
    attemptStartedAt: v.optional(v.union(v.number(), v.null())),
    capturedRef: v.optional(v.object({ reportId: v.id("reports"), revisionNumber: v.number(), contentHash: v.string() })),
    qa: v.optional(v.string()),
    chronology: v.optional(v.string()),
    qaScore: v.optional(v.number()),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return;
    // A delayed completion must not settle a replacement attempt or overwrite
    // results that have already completed, even when the report is unchanged.
    if (args.attemptStartedAt !== undefined &&
      (generation.postQaStatus !== "running" ||
        (generation.postQaStartedAt ?? null) !== args.attemptStartedAt)) return;
    const report = await ctx.db.query("reports")
      .withIndex("by_generationId", q => q.eq("generationId", generation._id)).first();
    if (args.capturedRef) {
      const current = report ? await reportQaRef(report) : null;
      if (!current || current.reportId !== args.capturedRef.reportId || current.revisionNumber !== args.capturedRef.revisionNumber || current.contentHash !== args.capturedRef.contentHash) {
        // Only an identified active attempt may release the retry lock. Its
        // stale scorecard and chronology never become current evidence.
        if (args.attemptStartedAt !== undefined) {
          await ctx.db.patch(generation._id, { postQaStatus: "failed" });
        }
        return;
      }
    }
    if (report) {
      await persistDeterministicFindings(ctx, report._id);
      // Legacy calls have no proof of what content the model evaluated.
      if (args.capturedRef && args.qa) {
        let qa: unknown;
        try { qa = JSON.parse(args.qa); }
        catch { /* Malformed QA cannot establish a methodology failure. */ }
        await persistMethodologyFindings(ctx, report, qa);
      }
    }
    let outputs: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(generation.agentOutputs ?? "{}");
      if (parsed && typeof parsed === "object") {
        outputs = parsed as Record<string, unknown>;
      }
    } catch {
      // Corrupt/missing agentOutputs — rebuild with just the QA keys.
    }
    if (args.qa) {
      try {
        outputs.qa = JSON.parse(args.qa);
      } catch {
        /* skip unparseable */
      }
    }
    if (args.chronology) {
      try {
        outputs.chronology = JSON.parse(args.chronology);
      } catch {
        /* skip unparseable */
      }
    }
    // A failed pass still persists whatever DID succeed (e.g. the chronology
    // when only the scorecard was malformed) instead of discarding it.
    if (args.failed) {
      await ctx.db.patch(generation._id, {
        agentOutputs: JSON.stringify(outputs),
        postQaStatus: "failed",
        progressLog: [
          ...(generation.progressLog ?? []),
          "Post-assembly QA pass failed — the report is unaffected.",
        ],
      });
      return;
    }
    await ctx.db.patch(generation._id, {
      agentOutputs: JSON.stringify(outputs),
      postQaStatus: "done",
      ...(args.qaScore !== undefined ? { qaScore: args.qaScore } : {}),
      progressLog: [
        ...(generation.progressLog ?? []),
        `✓ QA scorecard ready${args.qaScore !== undefined ? ` (${args.qaScore}/100)` : ""}.`,
      ],
    });
  },
});

/** Writer-facing retrigger: run (or re-run) the post-assembly QA pass. */
export const requestReportQa = mutation({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) domainError("NOT_FOUND", "Generation not found");
    await requireInternalProjectAccess(ctx, generation.projectId);
    // CAP-7: QA scores a report. A generation without one — a superseded
    // partial, a failed run, or a legacy row whose report was deleted — has
    // nothing to review, so refuse before any write or schedule.
    const report = await ctx.db
      .query("reports")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .first();
    if (!report) {
      domainError("INVALID_STATE", "This generation has no report to review");
    }
    // Jul 17 meeting: any completed generation can (re)run its QA scorecard —
    // some projects lost the panel to an error or predate the feature.
    if (generation.status !== "completed") {
      domainError("INVALID_INPUT", "The report must be completed before QA can run");
    }
    // Idempotent: a pass already in flight keeps running across panel
    // close/reopen — never double-spend the API call.
    if (generation.postQaStatus === "running") return null;
    const attemptStartedAt = Math.max(Date.now(), (generation.postQaStartedAt ?? 0) + 1);
    await ctx.db.patch(generation._id, {
      postQaStatus: "running",
      postQaStartedAt: attemptStartedAt,
    });
    await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
      generationId: generation._id,
      attemptStartedAt,
    });
    return null;
  },
});

// ─── User-safe error projection for the iterative stepper ────────────────────
// Stored run/generation errors are "<code>: <message>" from
// normalizeProviderError; the "unknown" branch embeds raw provider text, which
// is ops material, not end-user copy (docs/product-domain.md: failure states
// use typed, user-safe errors). Raw strings stay on the rows for ops — they
// are mapped at this query boundary only. Strings without a known code prefix
// were written by our own mutations (timeouts, cancels, frozen-input) and are
// already safe copy, except that unrecognized colon-prefixed strings fall back
// to the generic line to be safe.
const STORED_ERROR_COPY: Record<string, string> = {
  billing:
    "The AI provider account cannot accept this request because billing or credits need attention.",
  rate_limited:
    "The AI provider is rate-limiting requests. Try again after the limit resets.",
  authentication: "The AI provider credentials were rejected by the provider.",
  model_access:
    "The configured account does not have access to a required model.",
  output_limit:
    "The model ran out of output budget before finishing this step. Retry, or use a different model for this draft.",
  network: "The AI provider could not be reached from this deployment.",
} as const;

function userSafeStoredError(
  error: string | undefined,
  fallback: string
): string | null {
  if (!error) return null;
  const separator = error.indexOf(":");
  if (separator <= 0) return error; // our own copy — no provider code prefix
  const code = error.slice(0, separator);
  return STORED_ERROR_COPY[code] ?? fallback;
}

/** Progress narration appends failure details verbatim ("… failed: <error>.").
 * Strip everything after the failure marker so raw provider text never rides
 * along; every other narration line is authored copy and passes through. */
function userSafeNarration(line: string): string {
  return line.replace(/ failed: .*$/s, " failed.");
}

/** Live state for the iterative stepper UI. */
export const getIterativeState = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) {
      return null;
    }
    if ((generation.candidateMode ?? "compare") !== "iterative") return null;

    const runs = await ctx.db
      .query("generationSectionRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    const sectionRuns = SECTION_ORDER.flatMap((section) => {
      const run = runs.find((row) => row.section === section);
      if (!run) return [];
      let metrics: ReturnType<typeof parseSectionMeter> = null;
      let qa: unknown = null;
      try {
        if (run.metrics) metrics = parseSectionMeter(JSON.parse(run.metrics));
      } catch {
        // Legacy/malformed metrics stay null.
      }
      try {
        if (run.qa) qa = JSON.parse(run.qa);
      } catch {
        // Malformed QA stays null.
      }
      return [
        {
          section,
          status: run.status,
          draftText: run.draftText ?? null,
          approvedText: run.approvedText ?? null,
          metrics,
          qa,
          attempt: run.attempt,
          guidance: run.guidance ?? null,
          error: userSafeStoredError(
            run.error,
            "The section draft did not complete. Regenerate to retry."
          ),
        },
      ];
    });

    // Background one-shot comparison draft (peek-only).
    const candidateRuns = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    const ghostRun = candidateRuns.find((run) => run.ghost);
    let ghost: {
      status: "queued" | "running" | "succeeded" | "failed";
      label: string;
      content: string | null;
    } | null = null;
    if (ghostRun) {
      let content: string | null = null;
      if (ghostRun.status === "succeeded" && ghostRun.candidateId) {
        content = (await ctx.db.get(ghostRun.candidateId))?.content ?? null;
      }
      ghost = { status: ghostRun.status, label: ghostRun.label, content };
    }

    const modelLabel = runs[0]?.label ?? null;
    return {
      status: generation.status,
      candidateMode: "iterative" as const,
      modelLabel,
      error: userSafeStoredError(
        generation.error,
        "The generation did not complete. Try again."
      ),
      // Narrates the pre-fan-out wait (analyzer + Brain) in the stepper.
      progressLog: (generation.progressLog ?? []).map(userSafeNarration),
      currentStep: generation.currentStep ?? null,
      sectionRuns,
      ghost,
    };
  },
});

/** Shared guards for the writer-facing iterative mutations. */
async function requireIterativeGeneration(
  ctx: MutationCtx,
  generationId: Id<"generations">
) {
  const generation = await ctx.db.get(generationId);
  if (!generation) domainError("NOT_FOUND", "Generation not found");
  const { project, user } = await requireInternalProjectAccess(
    ctx,
    generation.projectId
  );
  if ((generation.candidateMode ?? "compare") !== "iterative") {
    domainError("INVALID_STATE", "This generation is not section-by-section");
  }
  if (project.activeGenerationId !== generation._id) {
    domainError("STALE_REVISION", "This generation is no longer active");
  }
  return { generation, project, user };
}

/**
 * Writer approves one section's (possibly edited) text. Over-limit text is
 * allowed — the CRA meters are advisory here; the writer is the QA. Approving
 * the last section assembles the final report.
 */
export const approveSectionDraft = mutation({
  args: {
    generationId: v.id("generations"),
    section: sectionValidator,
    text: v.string(),
    // Fences the approval to the draft the writer was actually looking at: a
    // concurrent guided regeneration (other tab/user) bumps `attempt`, and an
    // approve carrying stale attempt-N text must not land on attempt N+1.
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { generation, project } = await requireIterativeGeneration(
      ctx,
      args.generationId
    );
    // report.editProse: approving a section writes report prose (and the
    // final approval assembles the report).
    await requireReportEditAccess(ctx, generation.projectId);
    if (generation.status !== "awaiting_input") {
      domainError("INVALID_STATE", "No section is awaiting review right now");
    }
    const run = await getSectionRun(ctx, generation._id, args.section);
    if (!run || run.status !== "awaiting_review") {
      domainError("INVALID_STATE", "This section is not awaiting review");
    }
    if (args.attempt !== undefined && run.attempt !== args.attempt) {
      domainError(
        "STALE_REVISION",
        "This section was redrafted since you loaded it — review the new draft"
      );
    }
    for (const section of SECTION_ORDER) {
      if (section === args.section) break;
      const prior = await getSectionRun(ctx, generation._id, section);
      if (prior?.status !== "approved") {
        domainError("INVALID_STATE", "Earlier sections must be approved first");
      }
    }
    const text = args.text.trim();
    if (!text) {
      domainError("INVALID_INPUT", "The approved section text cannot be empty");
    }

    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "approved",
      approvedText: text,
      completedAt: now,
    });

    // Edit-mining: record draft vs approved (learning loop input). Capped so
    // one section can't bloat the digest prompt; never blocks approval.
    if (run.draftText) {
      const cap = (s: string) => s.slice(0, 6000);
      const draftWords = run.draftText.split(/\s+/).filter(Boolean);
      const approvedWords = new Set(text.split(/\s+/).filter(Boolean));
      const kept = draftWords.filter((w) => approvedWords.has(w)).length;
      const editRatio =
        draftWords.length === 0
          ? 0
          : Math.min(1, Math.max(0, 1 - kept / draftWords.length));
      const caller = await getCurrentUserOrNull(ctx);
      // CAP-1: these rows feed the firm-wide draft-style distiller, so the
      // stored prose is de-identified. editRatio above is deliberately
      // computed on the raw text — scrubbing must not move the number.
      await ctx.db.insert("sectionEditEvents", {
        projectId: generation.projectId,
        generationId: generation._id,
        section: args.section,
        draftText: cap(deidentify(run.draftText, project)),
        approvedText: cap(deidentify(text, project)),
        editRatio,
        ...(caller ? { userId: caller._id } : {}),
        createdAt: now,
      });
    }

    const nextSection =
      SECTION_ORDER[SECTION_ORDER.indexOf(args.section) + 1] ?? null;
    if (nextSection) {
      const next = await getSectionRun(ctx, generation._id, nextSection);
      if (!next || next.status !== "pending") {
        domainError("INVALID_STATE", "The next section is not ready to draft");
      }
      await ctx.db.patch(next._id, { status: "queued", queuedAt: now });
      await ctx.db.patch(generation._id, {
        status: "running",
        // startedAt marks the start of THIS drafting phase so the stale-run
        // reaper measures drafting time, not total writer review time.
        startedAt: now,
        currentStep: `Drafting ${SECTION_TITLES[nextSection]}…`,
        progressLog: [
          ...(generation.progressLog ?? []),
          `✓ ${SECTION_TITLES[args.section]} approved by the writer.`,
          `Drafting ${SECTION_TITLES[nextSection]}…`,
        ],
      });
      await refreshProjectGenerationActivity(ctx, generation.projectId);
      await ctx.scheduler.runAfter(0, internal.ai.iterative.generateSection, {
        generationId: generation._id,
        section: nextSection,
      });
      return null;
    }

    // Final section approved → assemble the report from the approved texts.
    const approved: Record<IterativeSection, string> = {
      s242: "",
      s244: "",
      s246: text,
    };
    for (const section of ["s242", "s244"] as const) {
      const priorRun = await getSectionRun(ctx, generation._id, section);
      approved[section] = priorRun?.approvedText ?? "";
    }
    const content = JSON.stringify(
      buildTiptapDocument(
        project.title || "Untitled Report",
        approved.s242,
        approved.s244,
        approved.s246
      )
    );
    const agentOutputs = JSON.stringify({
      section242: approved.s242,
      section244: approved.s244,
      section246: approved.s246,
      metrics: {
        s242: sectionMetrics(approved.s242, "s242"),
        s244: sectionMetrics(approved.s244, "s244"),
        s246: sectionMetrics(approved.s246, "s246"),
        lengthTarget: generation.lengthTarget ?? "standard",
      },
      iterative: true,
    });
    const reportId = await createGeneratedReportArtifacts(ctx, generation, {
      projectId: generation.projectId,
      content,
      agentOutputs,
      provenanceId: undefined,
      label: `Iterative — ${run.label}`,
    });

    // The finished ghost draft is preserved as a version-history snapshot for
    // comparison (never the report). Inserted AFTER the report's own
    // "generated" baseline above so postEditDistance's `.first()` still finds
    // the real baseline.
    const candidateRuns = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    const ghostRun = candidateRuns.find((row) => row.ghost);
    if (ghostRun?.status === "succeeded" && ghostRun.candidateId) {
      const ghostCandidate = await ctx.db.get(ghostRun.candidateId);
      if (ghostCandidate) {
        await ctx.db.insert("reportSnapshots", {
          projectId: generation.projectId,
          reportId,
          generationId: generation._id,
          sourceTranscriptId: generation.transcriptId,
          sourceTranscriptIds: generationTranscriptIds(generation),
          provenanceId: ghostCandidate.provenanceId,
          sourceRevisionNumber: 0,
          contentHash: await sha256(ghostCandidate.content),
          content: ghostCandidate.content,
          reason: "generated",
          label: `One-shot ghost draft (comparison — ${ghostRun.label})`,
          createdByRole: "system",
          createdAt: Date.now(),
        });
      }
      // The run row stays for stats; drop the dangling candidate pointer.
      await ctx.db.patch(ghostRun._id, { candidateId: undefined });
      // Edit-mining: attach the ghost's take on each section to the edit
      // events, so the digest can contrast writer-approved vs one-shot text.
      if (ghostCandidate) {
        try {
          const outputs: unknown = JSON.parse(ghostCandidate.agentOutputs);
          if (outputs && typeof outputs === "object") {
            const ghostSections: Record<IterativeSection, string | undefined> = {
              s242: (outputs as Record<string, unknown>).section242 as string | undefined,
              s244: (outputs as Record<string, unknown>).section244 as string | undefined,
              s246: (outputs as Record<string, unknown>).section246 as string | undefined,
            };
            const events = await ctx.db
              .query("sectionEditEvents")
              .withIndex("by_generationId", (q) =>
                q.eq("generationId", generation._id)
              )
              .collect();
            for (const event of events) {
              const ghostText = ghostSections[event.section];
              if (typeof ghostText === "string" && ghostText.trim()) {
                // CAP-1: same firm-wide digest input as draftText/approvedText.
                await ctx.db.patch(event._id, {
                  ghostText: deidentify(ghostText, project).slice(0, 6000),
                });
              }
            }
          }
        } catch {
          // Ghost outputs unparseable — events simply stay ghost-less.
        }
      }
    }
    // Candidate rows (the ghost's included) never outlive the generation.
    const candidates = await ctx.db
      .query("reportCandidates")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    for (const row of candidates) await ctx.db.delete(row._id);

    // Mirror completeCandidateRun's single-mode bookkeeping exactly.
    const doneAt = Date.now();
    await ctx.db.patch(project._id, {
      activeGenerationId: undefined,
      status: "review",
      updatedAt: doneAt,
    });
    await ctx.db.patch(generation._id, {
      status: "completed",
      currentStep: "Complete",
      agentOutputs,
      completedAt: doneAt,
      progressLog: [
        ...(generation.progressLog ?? []),
        `✓ ${SECTION_TITLES.s246} approved by the writer.`,
        "✓ Report assembled from the approved sections.",
        "Running the QA scorecard and chronology in the background…",
      ],
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    // Every mode ends with a scorecard: run QA + chronology over the
    // assembled sections in the background (feeds the learning loops).
    await ctx.db.patch(generation._id, {
      postQaStatus: "running",
      postQaStartedAt: doneAt,
    });
    await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
      generationId: generation._id,
      attemptStartedAt: doneAt,
    });
    return reportId;
  },
});

/** Redraft one section, optionally steered by writer guidance. */
export const regenerateSectionDraft = mutation({
  args: {
    generationId: v.id("generations"),
    section: sectionValidator,
    guidance: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { generation } = await requireIterativeGeneration(
      ctx,
      args.generationId
    );
    if (generation.status !== "awaiting_input") {
      domainError("INVALID_STATE", "No section is awaiting review right now");
    }
    const run = await getSectionRun(ctx, generation._id, args.section);
    if (!run || (run.status !== "awaiting_review" && run.status !== "failed")) {
      domainError("INVALID_STATE", "This section cannot be regenerated right now");
    }
    const guidance = args.guidance?.trim();
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "queued",
      attempt: run.attempt + 1,
      guidance: guidance || undefined,
      error: undefined,
      queuedAt: now,
      startedAt: undefined,
      completedAt: undefined,
    });
    await ctx.db.patch(generation._id, {
      status: "running",
      startedAt: now,
      currentStep: `Redrafting ${SECTION_TITLES[args.section]}…`,
      progressLog: [
        ...(generation.progressLog ?? []),
        `Redrafting ${SECTION_TITLES[args.section]}${guidance ? " with writer guidance" : ""}…`,
      ],
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    await ctx.scheduler.runAfter(0, internal.ai.iterative.generateSection, {
      generationId: generation._id,
      section: args.section,
    });
    return null;
  },
});

/** Abandon an in-flight iterative generation and free the project. */
export const cancelIterativeGeneration = mutation({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const { generation, project } = await requireIterativeGeneration(
      ctx,
      args.generationId
    );
    if (
      generation.status !== "reserved" &&
      generation.status !== "running" &&
      generation.status !== "awaiting_input"
    ) {
      domainError("INVALID_STATE", "This generation is no longer active");
    }
    const now = Date.now();
    await ctx.db.patch(generation._id, {
      status: "failed",
      currentStep: "Cancelled",
      error: "Cancelled by writer",
      completedAt: now,
    });
    // Ghost/section jobs still scheduled become no-ops: their claim fences
    // require an active generation + project pointer. Their rows stay
    // (harmless) except candidate content, which never outlives a generation.
    const candidates = await ctx.db
      .query("reportCandidates")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    for (const row of candidates) await ctx.db.delete(row._id);
    await ctx.db.patch(project._id, {
      activeGenerationId: undefined,
      status: generation.previousProjectStatus ?? "draft",
      updatedAt: now,
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    return null;
  },
});

/** BNH-21: store the up-front time estimate + how many candidate drafts to expect. */
export const setGenerationEstimate = internalMutation({
  args: {
    generationId: v.id("generations"),
    estimatedMs: v.number(),
    totalCandidates: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.generationId, {
      estimatedMs: args.estimatedMs,
      totalCandidates: args.totalCandidates,
    });
  },
});


/**
 * Ops utility: mark generations stranded in "running"/"pending" (e.g. by the
 * pre-fanout 10-minute action death) as failed and free their projects.
 * `npx convex run generations:failStaleGenerations '{"olderThanMinutes":30}'`
 */
export const failStaleGenerations = internalMutation({
  args: { olderThanMinutes: v.optional(v.number()) },
  // Declared so the function's type never depends on handler inference: the
  // handler schedules a sibling function from this module, and inferring the
  // return type through that reference would be circular.
  returns: v.object({
    failed: v.number(),
    orphanedRuns: v.number(),
    projectSweepJobId: v.id("_scheduled_functions"),
  }),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.olderThanMinutes ?? 30) * 60 * 1000;
    const reserved = await ctx.db
      .query("generations")
      .withIndex("by_status_and_startedAt", (q) =>
        q.eq("status", "reserved").lt("startedAt", cutoff)
      )
      .take(100);
    const running = await ctx.db
      .query("generations")
      .withIndex("by_status_and_startedAt", (q) =>
        q.eq("status", "running").lt("startedAt", cutoff)
      )
      .take(100);
    const stale = [...reserved, ...running];
    let failed = 0;
    for (const generation of stale) {
      // Iterative generations in "running" mean ONE section is drafting; a
      // stale section run fails alone and hands control back to the writer
      // (awaiting_input → regenerate), never killing the whole run. Note the
      // reaper deliberately skips awaiting_input generations entirely —
      // writer thinking time is unbounded.
      if (
        generation.status === "running" &&
        (generation.candidateMode ?? "compare") === "iterative"
      ) {
        const sectionRuns = await ctx.db
          .query("generationSectionRuns")
          .withIndex("by_generationId", (q) =>
            q.eq("generationId", generation._id)
          )
          .take(10);
        // No section runs at all = the startup action died before fan-out
        // (analyzer/brain phase); fall through to the whole-generation fail.
        if (sectionRuns.length > 0) {
          const staleRuns = sectionRuns.filter(
            (run) =>
              (run.status === "queued" || run.status === "running") &&
              (run.startedAt ?? run.queuedAt) < cutoff
          );
          if (staleRuns.length === 0) continue;
          for (const run of staleRuns) {
            await ctx.db.patch(run._id, {
              status: "failed",
              error: "Timed out before the section draft completed.",
              completedAt: Date.now(),
            });
          }
          await ctx.db.patch(generation._id, {
            status: "awaiting_input",
            currentStep: "Section draft timed out — regenerate to retry",
            progressLog: [
              ...(generation.progressLog ?? []),
              "✗ Section draft timed out. Use Regenerate to retry.",
            ],
          });
          await refreshProjectGenerationActivity(ctx, generation.projectId);
          failed += 1;
          continue;
        }
      }
      failed += 1;
      await ctx.db.patch(generation._id, {
        status: "failed",
        currentStep: "Failed",
        error: "Timed out before generation completed.",
        completedAt: Date.now(),
      });
      // In-flight candidate runs die with the generation — otherwise they
      // read "running" forever (skewed stats, invisible to retry).
      await terminalizeOrphanedCandidateRuns(
        ctx,
        generation._id,
        "Timed out before the draft completed."
      );
      const project = await ctx.db.get(generation.projectId);
      if (project?.activeGenerationId === generation._id) {
        await ctx.db.patch(project._id, {
          activeGenerationId: undefined,
          status: generation.previousProjectStatus ?? "draft",
          updatedAt: Date.now(),
        });
      } else if (project?.status === "generating" && !project.activeGenerationId) {
        const [reservedActive, runningActive] = await Promise.all([
          ctx.db
            .query("generations")
            .withIndex("by_projectId_and_status", (q) =>
              q.eq("projectId", project._id).eq("status", "reserved")
            )
            .first(),
          ctx.db
            .query("generations")
            .withIndex("by_projectId_and_status", (q) =>
              q.eq("projectId", project._id).eq("status", "running")
            )
            .first(),
        ]);
        if (!reservedActive && !runningActive) {
          await ctx.db.patch(project._id, {
            status: generation.previousProjectStatus ?? "draft",
            updatedAt: Date.now(),
          });
        }
      }
      await refreshProjectGenerationActivity(ctx, generation.projectId);
    }

    // Also free projects orphaned in "generating" with no live generation —
    // e.g. the client dies between createProject and requestGeneration, or a
    // legacy failure predates the activeGenerationId cleanup. Without this the
    // project stays locked on a generation that never existed. The sweep walks
    // the projects.by_status index one bounded page per transaction (CAP-11),
    // so it runs as its own self-continuing job rather than inline here.
    const projectSweepJobId: Id<"_scheduled_functions"> = await ctx.scheduler.runAfter(
      0,
      internal.generations.freeOrphanedGeneratingProjects,
      { cutoff }
    );

    // Candidate runs stranded queued/running after their generation already
    // went terminal (e.g. a hard ghost-draft death after a writer cancel, or
    // whole-fails from before runs were terminalized in the same mutation).
    // A run under a live generation is left alone — it may still report back.
    let orphanedRuns = 0;
    const queuedRuns = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_status_and_startedAt", (q) => q.eq("status", "queued"))
      .take(100);
    const runningRuns = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_status_and_startedAt", (q) =>
        q.eq("status", "running").lt("startedAt", cutoff)
      )
      .take(100);
    for (const run of [...queuedRuns, ...runningRuns]) {
      // Queued rows carry no startedAt; age them from queuedAt instead.
      if ((run.startedAt ?? run.queuedAt) >= cutoff) continue;
      const generation = await ctx.db.get(run.generationId);
      if (generation && !isTerminalGenerationStatus(generation.status)) continue;
      await ctx.db.patch(run._id, {
        status: "failed",
        error: "The generation ended before this draft completed.",
        completedAt: Date.now(),
      });
      orphanedRuns += 1;
    }
    return { failed, orphanedRuns, projectSweepJobId };
  },
});

/** Page size for the orphaned-project sweep: one page of `projects` in
 * "generating" per transaction. Tests override it through `pageSize`. */
export const STALE_PROJECT_SWEEP_PAGE_SIZE = 100;

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
  args: {
    cutoff: v.number(),
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
  },
  returns: v.object({
    freed: v.number(),
    scanned: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.max(
      1,
      Math.floor(args.pageSize ?? STALE_PROJECT_SWEEP_PAGE_SIZE)
    );
    const { page, isDone, continueCursor } = await ctx.db
      .query("projects")
      .withIndex("by_status", (q) => q.eq("status", "generating"))
      .paginate({ numItems: pageSize, cursor: args.cursor ?? null });
    let freed = 0;
    for (const project of page) {
      if (project.updatedAt > args.cutoff) continue;
      const active = await findActiveGeneration(
        ctx,
        project,
        ACTIVE_GENERATION_STATUSES
      );
      if (active) continue;
      const lastGeneration = await ctx.db
        .query("generations")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .order("desc")
        .first();
      await ctx.db.patch(project._id, {
        activeGenerationId: undefined,
        status: lastGeneration?.previousProjectStatus ?? "draft",
        updatedAt: Date.now(),
      });
      await refreshProjectGenerationActivity(ctx, project._id);
      freed += 1;
    }
    if (!isDone) {
      // Freed rows have left the "generating" index range, but the cursor is
      // an index position rather than an offset, so the next page resumes
      // exactly after the last row read here.
      await ctx.scheduler.runAfter(
        0,
        internal.generations.freeOrphanedGeneratingProjects,
        {
          cutoff: args.cutoff,
          cursor: continueCursor,
          ...(args.pageSize !== undefined ? { pageSize: args.pageSize } : {}),
        }
      );
    }
    return { freed, scanned: page.length, isDone };
  },
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
  args: { olderThanMinutes: v.optional(v.number()) },
  returns: v.object({ failed: v.number() }),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.olderThanMinutes ?? 15) * 60 * 1000;
    const running = await ctx.db
      .query("generations")
      .withIndex("by_postQaStatus", (q) => q.eq("postQaStatus", "running"))
      .take(100);
    let failed = 0;
    for (const generation of running) {
      if ((generation.postQaStartedAt ?? 0) >= cutoff) continue;
      await ctx.db.patch(generation._id, {
        postQaStatus: "failed",
        progressLog: [
          ...(generation.progressLog ?? []),
          "Post-assembly QA pass timed out — the report is unaffected. Run it again from the QA panel.",
        ],
      });
      failed += 1;
    }
    return { failed };
  },
});

/**
 * BNH-10 flywheel: record which Brain exemplars fed this generation — per
 * section, with raw first-stage/rerank scores and the sourceId behind each
 * entry (usefulness analytics + revocation forensics), plus the Haiku
 * retrieval brief that produced the queries (eval material).
 */
export const setBrainProvenance = internalMutation({
  args: {
    generationId: v.id("generations"),
    exemplars: v.array(
      v.object({
        entryId: v.string(),
        score: v.number(),
        title: v.optional(v.string()),
        writerName: v.optional(v.string()),
        section: v.optional(v.string()),
        sourceId: v.optional(v.string()),
        searchScore: v.optional(v.number()),
        rerankScore: v.optional(v.number()),
      })
    ),
    brief: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.generationId, {
      brainProvenance: args.exemplars,
      brainRetrievalBrief: args.brief,
    });
  },
});

/** Append a line to the live "thinking" log shown during generation. */
export const appendProgress = internalMutation({
  args: { generationId: v.id("generations"), line: v.string() },
  handler: async (ctx, args) => {
    const gen = await ctx.db.get(args.generationId);
    if (!gen) return;
    await ctx.db.patch(args.generationId, {
      progressLog: [...(gen.progressLog ?? []), args.line],
    });
  },
});

/**
 * Story 3 (CAP-8, AD-26): record the Writer Profile a generation ran under.
 * The only writer of `generations.writerSettings`; patches the generation
 * row only, never `projects` (AD-2).
 */
export const recordWriterSettings = internalMutation({
  args: {
    generationId: v.id("generations"),
    writerSettings: writerSettingsValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    // The validator admits only the six categories; dedupe bounds the list.
    const { addressedCategories, ...record } = args.writerSettings;
    await ctx.db.patch(args.generationId, {
      writerSettings: {
        ...record,
        ...(addressedCategories
          ? { addressedCategories: [...new Set(addressedCategories)] }
          : {}),
      },
    });
    return null;
  },
});


// ─── Mutations called by the pipeline action ─────────────────────────────────

export const updateGenerationStatus = internalMutation({
  args: {
    generationId: v.id("generations"),
    status: v.union(
      v.literal("running"),
      v.literal("awaiting_selection"),
      v.literal("awaiting_input"),
      v.literal("completed"),
      v.literal("failed")
    ),
    currentStep: v.optional(v.string()),
    agentOutputs: v.optional(v.string()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    // Never resurrect a terminal generation: a writer cancel (→ failed) can
    // land inside the pipeline's multi-mutation setup window, after which the
    // action's own "running" patch would zombie the row while the project
    // pointer is already cleared.
    if (!generation || isTerminalGenerationStatus(generation.status)) return;
    const updates: Record<string, unknown> = { status: args.status };
    if (args.currentStep !== undefined) updates.currentStep = args.currentStep;
    if (args.agentOutputs !== undefined)
      updates.agentOutputs = args.agentOutputs;
    if (args.error !== undefined) updates.error = args.error;
    if (args.completedAt !== undefined) updates.completedAt = args.completedAt;
    await ctx.db.patch(args.generationId, updates);
    await refreshProjectGenerationActivity(ctx, generation.projectId);
  },
});


type CandidateSectionMeter = {
  lines: number;
  words: number;
  limit: number;
  wordCap: number;
  overLimit: boolean;
  // Gap-aware fields (convex/lib/lineLimits.ts). Optional: legacy persisted
  // candidate metrics predate them and must still parse.
  rawLines?: number;
  rawWords?: number;
  overLimitWithGaps?: boolean;
};

function parseSectionMeter(value: unknown): CandidateSectionMeter | null {
  if (typeof value !== "object" || value === null) return null;
  if (
    !("lines" in value) || typeof value.lines !== "number" ||
    !("words" in value) || typeof value.words !== "number" ||
    !("limit" in value) || typeof value.limit !== "number" ||
    !("wordCap" in value) || typeof value.wordCap !== "number" ||
    !("overLimit" in value) || typeof value.overLimit !== "boolean"
  ) return null;
  return {
    lines: value.lines,
    words: value.words,
    limit: value.limit,
    wordCap: value.wordCap,
    overLimit: value.overLimit,
    ...("rawLines" in value && typeof value.rawLines === "number"
      ? { rawLines: value.rawLines }
      : {}),
    ...("rawWords" in value && typeof value.rawWords === "number"
      ? { rawWords: value.rawWords }
      : {}),
    ...("overLimitWithGaps" in value && typeof value.overLimitWithGaps === "boolean"
      ? { overLimitWithGaps: value.overLimitWithGaps }
      : {}),
  };
}

function parseCandidateMetrics(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const s242 = "s242" in value ? parseSectionMeter(value.s242) : null;
  const s244 = "s244" in value ? parseSectionMeter(value.s244) : null;
  const s246 = "s246" in value ? parseSectionMeter(value.s246) : null;
  if (!s242 || !s244 || !s246) return null;
  return {
    s242,
    s244,
    s246,
    ...("lengthTarget" in value && typeof value.lengthTarget === "string"
      ? { lengthTarget: value.lengthTarget }
      : {}),
  };
}

/** Candidate drafts for one explicitly named generation. Model identity
 * (model + label) is returned to every user with project access — the blind
 * A/B test is over. */
export const getCandidates = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return [];
    const access = await getInternalProjectAccessOrNull(ctx, generation.projectId);
    if (!access) return [];
    // Ghost candidates (iterative mode's background comparison draft) are
    // peek-only — never listed for selection.
    const runs = await ctx.db
      .query("generationCandidateRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    const ghostCandidateIds = new Set(
      runs
        .filter((run) => run.ghost && run.candidateId)
        .map((run) => run.candidateId)
    );
    const candidates = (
      await ctx.db
        .query("reportCandidates")
        .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
        .take(10)
    ).filter((candidate) => !ghostCandidateIds.has(candidate._id));
    return candidates.map((candidate) => {
      let qaScore: number | null = null;
      let metrics: ReturnType<typeof parseCandidateMetrics> = null;
      let qa: unknown = null;
      try {
        const parsed: unknown = JSON.parse(candidate.agentOutputs);
        if (parsed && typeof parsed === "object") {
          if ("metrics" in parsed) metrics = parseCandidateMetrics(parsed.metrics);
          if ("qa" in parsed) {
            qa = parsed.qa;
            if (
              parsed.qa &&
              typeof parsed.qa === "object" &&
              "overall_score" in parsed.qa &&
              typeof parsed.qa.overall_score === "number"
            ) {
              qaScore = parsed.qa.overall_score;
            }
          }
        }
      } catch {
        // A legacy candidate may not have structured agent outputs.
      }
      return {
        _id: candidate._id,
        content: candidate.content,
        qaScore,
        metrics,
        qa,
        model: candidate.model,
        label: candidate.label,
      };
    });
  },
});

/** The section an ordered candidate stopped after, from its agentOutputs. */
function stoppedAfterSectionOf(agentOutputs: string): SectionNumber | undefined {
  try {
    const value = (JSON.parse(agentOutputs) as { stoppedAfterSection?: unknown })
      ?.stoppedAfterSection;
    return typeof value === "string" && isSectionNumber(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export const selectReportCandidate = mutation({
  args: {
    generationId: v.id("generations"),
    candidateId: v.id("reportCandidates"),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const candidate = await ctx.db.get(args.candidateId);
    const generation = await ctx.db.get(args.generationId);
    if (
      !candidate ||
      !generation ||
      candidate.generationId !== generation._id ||
      candidate.projectId !== generation.projectId
    ) {
      domainError("NOT_AUTHORIZED", "Candidate does not belong to this generation");
    }
    // report.editProse: selecting a candidate creates the project's report.
    const { project, user } = await requireReportEditAccess(
      ctx,
      candidate.projectId
    );
    if ((generation.candidateMode ?? "compare") === "iterative") {
      domainError(
        "INVALID_STATE",
        "Section-by-section drafts are approved per section, not selected"
      );
    }
    // Generations created before the run-guard deploy never had
    // activeGenerationId stamped on the project; an unset pointer is safe to
    // accept because the run guard forbids a second active generation while
    // any awaiting_selection row exists.
    if (
      generation.status !== "awaiting_selection" ||
      (project.activeGenerationId !== undefined &&
        project.activeGenerationId !== generation._id)
    ) {
      domainError("STALE_REVISION", "This generation is no longer awaiting selection");
    }

    const reportId = await createGeneratedReportArtifacts(
      ctx,
      generation,
      candidate
    );
    const now = Date.now();
    await ctx.db.patch(project._id, {
      activeGenerationId: undefined,
      status: "review",
      updatedAt: now,
    });
    await ctx.db.patch(generation._id, {
      status: "completed",
      currentStep: "Complete",
      agentOutputs: candidate.agentOutputs,
      // Story 2 (AD-24): the selected candidate's own stop, if it stopped.
      stoppedAfterSection: stoppedAfterSectionOf(candidate.agentOutputs),
      completedAt: now,
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    await ctx.db.insert("modelSelections", {
      projectId: candidate.projectId,
      generationId: generation._id,
      userId: user._id,
      candidateId: candidate._id,
      model: candidate.model,
      label: candidate.label,
      createdAt: now,
    });
    const all = await ctx.db
      .query("reportCandidates")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
    for (const row of all) await ctx.db.delete(row._id);
    return reportId;
  },
});

/** Aggregate model-preference stats for the admin view. */
export const modelStats = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["admin"]);

    const all = await ctx.db.query("modelSelections").collect();
    const total = all.length;

    const tally = (rows: typeof all) => {
      const counts = new Map<string, { label: string; count: number }>();
      for (const r of rows) {
        const cur = counts.get(r.model) ?? { label: r.label, count: 0 };
        cur.count += 1;
        counts.set(r.model, cur);
      }
      return [...counts.entries()]
        .map(([model, { label, count }]) => ({
          model,
          label,
          count,
          pct: rows.length ? Math.round((count / rows.length) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);
    };

    const overall = tally(all);
    const mine = tally(all.filter((r) => r.userId === user._id));

    const top = overall[0];
    const recommendation =
      total >= 5 && top
        ? `Across ${total} selections, ${top.label} is preferred ${top.pct}% of the time.`
        : `Not enough data yet — ${total} selection(s) logged. Keep choosing to surface a recommendation.`;

    // Jul 17 meeting: per-model score stats + writer comments so the team can
    // converge on a model (avg 1–10 score, and the raw one-liners feeding the
    // AI feedback summary below).
    const scores = await ctx.db.query("candidateScores").collect();
    const byModel = new Map<
      string,
      { label: string; scores: number[]; comments: Array<{ comment: string; score: number; at: number }> }
    >();
    for (const s of scores) {
      const cur =
        byModel.get(s.model) ?? { label: s.label, scores: [], comments: [] };
      cur.scores.push(s.score);
      if (s.comment) {
        cur.comments.push({ comment: s.comment, score: s.score, at: s.updatedAt });
      }
      byModel.set(s.model, cur);
    }
    const scoreStats = [...byModel.entries()]
      .map(([model, { label, scores: ss, comments }]) => ({
        model,
        label,
        scoreCount: ss.length,
        avgScore: ss.length
          ? Math.round((ss.reduce((a, b) => a + b, 0) / ss.length) * 10) / 10
          : null,
        comments: comments.sort((a, b) => b.at - a.at).slice(0, 10),
      }))
      .sort((a, b) => b.scoreCount - a.scoreCount);

    return { total, overall, mine, recommendation, scoreStats };
  },
});

export const getModelComments = internalQuery({
  args: { model: v.string() },
  handler: async (ctx, args) => {
    const scores = await ctx.db.query("candidateScores").collect();
    return scores
      .filter((s) => s.model === args.model && s.comment)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
      .map((s) => ({ comment: s.comment as string, score: s.score }));
  },
});

// ─── BNH-48: writer's per-option scores on the selection screen ──────────────

/** Upsert the writer's 1–10 score for a candidate option. Model/label/QA score
 *  are copied onto the row because candidates are deleted after selection. */
export const scoreCandidate = mutation({
  args: {
    candidateId: v.id("reportCandidates"),
    score: v.number(),
    optionPosition: v.number(),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    if (!Number.isInteger(args.score) || args.score < 1 || args.score > 10) {
      throw new Error("Score must be a whole number from 1 to 10");
    }
    const comment = args.comment?.trim();

    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) throw new Error("Candidate not found");
    const { user } = await requireInternalProjectAccess(ctx, candidate.projectId);
    const userId = user._id;

    let qaScore: number | undefined;
    try {
      const parsed: unknown = JSON.parse(candidate.agentOutputs);
      if (
        parsed &&
        typeof parsed === "object" &&
        "qa" in parsed &&
        parsed.qa &&
        typeof parsed.qa === "object" &&
        "overall_score" in parsed.qa &&
        typeof parsed.qa.overall_score === "number"
      ) {
        qaScore = parsed.qa.overall_score;
      }
    } catch {
      // A legacy candidate may not have structured QA output.
    }

    const now = Date.now();
    // Learning loop: refresh the draft style digest after scoring settles. The
    // delay coalesces a selection session's worth of scores; the action no-ops
    // when the active digest already covers the newest feedback.
    if (comment) {
      await ctx.scheduler.runAfter(
        10 * 60 * 1000,
        internal.ai.learning.generateDraftStyleDigest,
        {}
      );
    }
    const existing = await ctx.db
      .query("candidateScores")
      .withIndex("by_user_and_candidateId", (q) =>
        q.eq("userId", userId).eq("candidateId", args.candidateId)
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        score: args.score,
        optionPosition: args.optionPosition,
        comment: comment || undefined,
        updatedAt: now,
      });
      return;
    }
    await ctx.db.insert("candidateScores", {
      projectId: candidate.projectId,
      generationId: candidate.generationId,
      candidateId: args.candidateId,
      optionPosition: args.optionPosition,
      model: candidate.model,
      label: candidate.label,
      ...(qaScore !== undefined ? { qaScore } : {}),
      userId,
      score: args.score,
      ...(comment ? { comment } : {}),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** The signed-in writer's scores for an explicitly named generation. */
export const getMyCandidateScores = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return [];
    const access = await getInternalProjectAccessOrNull(ctx, generation.projectId);
    if (!access) return [];
    const scores = await ctx.db
      .query("candidateScores")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(20);
    return scores
      .filter((score) => score.userId === access.user._id)
      .map((score) => ({
        candidateId: score.candidateId,
        score: score.score,
        comment: score.comment ?? "",
      }));
  },
});

export const getCandidateScoreSummary = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const access = await getInternalProjectAccessOrNull(ctx, generation.projectId);
    if (!access) return null;
    // Only the caller's own scores: the panel is titled "Your score", and two
    // teammates scoring the same blind option would otherwise produce rows
    // sharing an optionPosition — the UI keys its table on optionPosition
    // (each_key_duplicate class, Aug 18 audit).
    const scores = (
      await ctx.db
        .query("candidateScores")
        .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
        .take(100)
    ).filter((score) => score.userId === access.user._id);
    if (scores.length === 0) return null;
    const selections = await ctx.db
      .query("modelSelections")
      .withIndex("by_projectId", (q) => q.eq("projectId", generation.projectId))
      .take(1_000);
    const chosenModel =
      selections.find((selection) => selection.generationId === generation._id)
        ?.model ?? null;
    return {
      chosenModel,
      rows: scores
        .sort((a, b) => a.optionPosition - b.optionPosition)
        .map((score) => ({
          optionPosition: score.optionPosition,
          model: score.model,
          label: score.label,
          score: score.score,
          comment: score.comment ?? "",
          qaScore: score.qaScore ?? null,
          chosen: score.model === chosenModel,
        })),
    };
  },
});


// ─── Story 2: ordered, ungated section chain (single/compare, AD-24) ─────────
//
// generateCandidate (non-ghost) → createOrderedSectionRuns → one scheduled
// ai/orderedGeneration.generateOrderedSection per section, fenced by
// claimOrderedSectionRun's CAS → completeOrderedSectionRun schedules the next
// section (or finalizeOrderedCandidate) atomically with its writes. No
// approval gate: iterative's approveSectionDraft is never in this path, and
// iterative generations never create these rows. A chain stalled between
// sections is recovered by the existing failStaleGenerations reaper.

async function orderedRunsForCandidate(
  ctx: { db: QueryCtx["db"] },
  candidateRunId: Id<"generationCandidateRuns">
) {
  const rows = await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_candidateRunId_and_section", (q) =>
      q.eq("candidateRunId", candidateRunId)
    )
    .take(3);
  return rows.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

async function orderedRunForSection(
  ctx: { db: QueryCtx["db"] },
  candidateRunId: Id<"generationCandidateRuns">,
  section: SectionNumber
) {
  return await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_candidateRunId_and_section", (q) =>
      q.eq("candidateRunId", candidateRunId).eq("section", sectionKeyOf(section))
    )
    .unique();
}

function sectionNumberOfRow(row: Doc<"generationSectionRuns">): SectionNumber {
  return row.section.slice(1) as SectionNumber;
}

function selfCheckStatusOf(selfCheck: string | undefined): string | null {
  if (!selfCheck) return null;
  try {
    const parsed: unknown = JSON.parse(selfCheck);
    return parsed && typeof parsed === "object" && "status" in parsed &&
      typeof parsed.status === "string"
      ? parsed.status
      : null;
  } catch {
    return null;
  }
}

/** The CAS every chain write re-checks: a live non-ghost candidate run of a
 * running generation that still owns its project's active pointer. */
async function orderedChainFence(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  candidateRunId: Id<"generationCandidateRuns">
) {
  const run = await ctx.db.get(candidateRunId);
  if (!run || run.ghost || run.status !== "running" || run.generationId !== generationId) {
    return null;
  }
  const generation = await ctx.db.get(generationId);
  if (!generation || generation.status !== "running") return null;
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.activeGenerationId !== generation._id) return null;
  return { run, generation, project };
}

/** One row per section in Build Order (first queued, rest pending), then the
 * first section's action, scheduled atomically with the rows. */
export const createOrderedSectionRuns = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    payload: orderedPayloadValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
    if (!fence) return false;
    if ((fence.generation.candidateMode ?? "compare") === "iterative") return false;
    const order = args.payload.orderedContext.buildOrder;
    if (order.length === 0) return false;
    if ((await orderedRunsForCandidate(ctx, fence.run._id)).length > 0) return false;
    const now = Date.now();
    for (const [index, section] of order.entries()) {
      await ctx.db.insert("generationSectionRuns", {
        generationId: fence.generation._id,
        projectId: fence.generation.projectId,
        section: sectionKeyOf(section),
        status: index === 0 ? "queued" : "pending",
        model: fence.run.model,
        label: fence.run.label,
        attempt: 1,
        candidateRunId: fence.run._id,
        orderIndex: index,
        queuedAt: now,
      });
    }
    await ctx.db.patch(fence.generation._id, {
      progressLog: [
        ...(fence.generation.progressLog ?? []),
        `${fence.run.label}: drafting ${order.join(" → ")} in order; each section is Self-checked before it is shown.`,
      ],
    });
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.generateOrderedSection, {
      generationId: args.generationId,
      candidateRunId: args.candidateRunId,
      section: order[0],
      payload: args.payload,
    });
    return true;
  },
});

/** The Brief a section is drafted with and checked against: the same rows
 * renderBriefForGeneration renders into the prompt. */
async function loadBriefCheck(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">
) {
  const briefDoc = generation.briefId ? await ctx.db.get(generation.briefId) : null;
  if (!briefDoc) return { briefBlock: "", brief: null };
  const entries = (
    await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", briefDoc._id))
      .take(500)
  ).filter(
    // A re-derivation carries the previous version's dropped entries as
    // change: "removed" markers for the diff; they are no longer in force.
    (entry) => entry.group !== "storylineQuestion" && entry.change !== "removed"
  );
  return {
    briefBlock: renderBriefBlock(briefDoc.storylineText, entries),
    brief: {
      storylineText: briefDoc.storylineText,
      claimExclusions: entries
        .filter((entry) => entry.group === "claimExclusion")
        .map((entry) => ({
          text: entry.text,
          exactExcerpt: entry.exactExcerpt,
          ...(entry.reason ? { reason: entry.reason } : {}),
        })),
      confidenceMap: entries
        .filter((entry) => entry.group === "confidenceMap")
        .map((entry) => ({
          entryId: entry._id,
          text: entry.text,
          ...(entry.confidence ? { confidence: entry.confidence } : {}),
        })),
      glossaryTerms: entries
        .filter((entry) => entry.group === "glossaryTerm")
        .map((entry) => entry.text),
    },
  };
}

/** CAS claim of one queued section (row queued, candidate run running,
 * generation running, project pointer matching). Returns this candidate's
 * drafted prior sections in production order and the Brief it checks
 * against, or null when the claim is stale. */
export const claimOrderedSectionRun = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    section: sectionNumberValidator,
  },
  handler: async (ctx, args) => {
    const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
    if (!row || row.status !== "queued" || row.generationId !== args.generationId) {
      return null;
    }
    const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
    if (!fence) return null;
    const orderIndex = row.orderIndex ?? 0;
    // Stopped between sections (AD-24): this section is never drafted and
    // the action finalizes what was. The first section is always drafted, so
    // a stopped generation still has something to assemble.
    if (fence.generation.stopRequestedAt !== undefined && orderIndex > 0) {
      await ctx.db.patch(row._id, { status: "pending" });
      return { stopped: true as const };
    }
    await ctx.db.patch(row._id, { status: "running", startedAt: Date.now() });
    const priorSections = (await orderedRunsForCandidate(ctx, fence.run._id))
      .filter(
        (prior) =>
          prior.status === "drafted" &&
          (prior.orderIndex ?? 0) < orderIndex &&
          prior.draftText !== undefined
      )
      .map((prior) => ({
        section: sectionNumberOfRow(prior),
        text: prior.draftText ?? "",
      }));

    const { briefBlock, brief } = await loadBriefCheck(ctx, fence.generation);
    return {
      projectId: fence.generation.projectId,
      model: row.model,
      label: row.label,
      requestedBy: fence.generation.requestedBy,
      lengthTarget: fence.generation.lengthTarget ?? "standard",
      orderIndex,
      isFirstInOrder: orderIndex === 0,
      priorSections,
      briefBlock,
      brief,
    };
  },
});

/** Persist one finished section (draft, metrics, Self-check summary, slot
 * counts, its Compliance Note rows, at most one Storyline question) and
 * schedule the next section — or finalize when the order is exhausted or the
 * writer asked to stop. */
export const completeOrderedSectionRun = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    section: sectionNumberValidator,
    draftText: v.string(),
    metrics: v.string(),
    selfCheck: v.string(),
    slotCounts: v.string(),
    notes: v.array(complianceNoteDraftValidator),
    storylineQuestion: v.optional(
      v.object({
        question: v.string(),
        sectionClaim: v.string(),
        storylineAlternative: v.string(),
        evidenceEntryId: v.id("generationBriefEntries"),
      })
    ),
    payload: orderedPayloadValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
    if (!row || row.status !== "running" || row.generationId !== args.generationId) {
      return false;
    }
    const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
    if (!fence) return false;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "drafted",
      draftText: args.draftText,
      metrics: args.metrics,
      selfCheck: args.selfCheck,
      slotCounts: args.slotCounts,
      error: undefined,
      completedAt: now,
    });
    const owner = {
      projectId: fence.generation.projectId,
      generationId: fence.generation._id,
      candidateRunId: fence.run._id,
    };
    for (const note of args.notes) {
      // A section's rows belong to that section only.
      if (note.section !== args.section) continue;
      await ctx.db.insert("complianceNotes", complianceNoteRow(note, owner));
    }
    // AD-23/AD-25: the chain's one write outside complianceNotes. The
    // question cites the Confidence Map entry the section's stronger evidence
    // rests on, so it carries a byte-validated citation like every entry.
    if (args.storylineQuestion && fence.generation.briefId) {
      const evidence = await ctx.db.get(args.storylineQuestion.evidenceEntryId);
      if (
        evidence &&
        evidence.briefId === fence.generation.briefId &&
        evidence.group === "confidenceMap"
      ) {
        await ctx.db.insert("generationBriefEntries", {
          briefId: evidence.briefId,
          projectId: evidence.projectId,
          group: "storylineQuestion",
          text: args.storylineQuestion.sectionClaim,
          sourceId: evidence.sourceId,
          sourceContentHash: evidence.sourceContentHash,
          startOffset: evidence.startOffset,
          endOffset: evidence.endOffset,
          exactExcerpt: evidence.exactExcerpt,
          question: {
            questionText: args.storylineQuestion.question,
            alternativeText: args.storylineQuestion.storylineAlternative,
          },
          createdAt: now,
        });
      }
    }
    const status = selfCheckStatusOf(args.selfCheck);
    // The intent's flag wording for a repair that did not clear the check.
    const checkLabel =
      status === "repair_failed"
        ? "Self-check repair failed"
        : `Self-check: ${status?.replace(/_/g, " ") ?? "recorded"}`;
    await ctx.db.patch(fence.generation._id, {
      progressLog: [
        ...(fence.generation.progressLog ?? []),
        `✓ ${fence.run.label}: ${ORDERED_SECTION_TITLES[args.section]} drafted (${checkLabel}).`,
      ],
    });
    const next = (await orderedRunsForCandidate(ctx, fence.run._id)).find(
      (candidate) => (candidate.orderIndex ?? 0) === (row.orderIndex ?? 0) + 1
    );
    if (next && next.status === "pending" && fence.generation.stopRequestedAt === undefined) {
      await ctx.db.patch(next._id, { status: "queued", queuedAt: now });
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.generateOrderedSection, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        section: sectionNumberOfRow(next),
        payload: args.payload,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeOrderedCandidate, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        payload: args.payload,
      });
    }
    return true;
  },
});

/** A section action failed outright: fail the section, mark the sections
 * after it undrafted, and fail the candidate through completeCandidateRun's
 * own body. */
export const failOrderedSectionRun = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    section: sectionNumberValidator,
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Fenced like every other chain write: a stale call (the candidate run,
    // generation or project pointer already moved on) must not overwrite
    // rows a newer owner may be writing; the reaper covers recovery instead.
    const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
    if (!fence) return null;
    const now = Date.now();
    for (const row of await orderedRunsForCandidate(ctx, fence.run._id)) {
      if (row.generationId !== args.generationId) continue;
      if (
        row.section === sectionKeyOf(args.section) &&
        (row.status === "running" || row.status === "queued")
      ) {
        await ctx.db.patch(row._id, {
          status: "failed",
          error: args.error.slice(0, 500),
          completedAt: now,
        });
      } else if (row.status === "pending" || row.status === "queued") {
        await ctx.db.patch(row._id, {
          status: "failed",
          error: "Not drafted: an earlier section failed.",
          completedAt: now,
        });
      }
    }
    await settleCandidateRun(ctx, {
      candidateRunId: args.candidateRunId,
      error: `Line ${args.section} draft failed: ${args.error}`,
    });
    return null;
  },
});

/** Store the consistency pass's rows once per candidate and stamp
 * consistencyCheckedAt, which releases the last section to the writer. */
export const insertConsistencyNotes = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    notes: v.array(complianceNoteDraftValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
    if (!fence || fence.run.consistencyCheckedAt !== undefined) return false;
    const owner = {
      projectId: fence.generation.projectId,
      generationId: fence.generation._id,
      candidateRunId: fence.run._id,
    };
    for (const note of args.notes) {
      await ctx.db.insert("complianceNotes", complianceNoteRow(note, owner));
    }
    const now = Date.now();
    await ctx.db.patch(fence.run._id, { consistencyCheckedAt: now });
    const findings = args.notes.filter((note) => note.source === "model").length;
    await ctx.db.patch(fence.generation._id, {
      progressLog: [
        ...(fence.generation.progressLog ?? []),
        `✓ ${fence.run.label}: consistency pass over the assembled draft (${findings} finding(s)).`,
      ],
    });
    return true;
  },
});

/** Finalize input: this candidate's section rows in production order. */
export const getOrderedCandidateDrafts = internalQuery({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    const run = await ctx.db.get(args.candidateRunId);
    if (!generation || !run || run.generationId !== generation._id) return null;
    const rows = await orderedRunsForCandidate(ctx, run._id);
    const { brief } = await loadBriefCheck(ctx, generation);
    return {
      model: run.model,
      label: run.label,
      runStatus: run.status,
      brief,
      stopRequested: generation.stopRequestedAt !== undefined,
      consistencyCheckedAt: run.consistencyCheckedAt ?? null,
      sections: rows.map((row) => ({
        section: sectionNumberOfRow(row),
        orderIndex: row.orderIndex ?? 0,
        status: row.status,
        draftText: row.draftText ?? null,
        metrics: row.metrics ?? null,
        selfCheck: row.selfCheck ?? null,
        slotCounts: row.slotCounts ?? null,
      })),
    };
  },
});

/**
 * The writer stops an ungated single/compare generation (AD-24). Same auth
 * and CAS on activeGenerationId as cancelIterativeGeneration. The section in
 * progress finishes, no further section is scheduled, and the generation
 * completes with stoppedAfterSection and [NOT GENERATED] bodies. Idempotent.
 */
export const stopOrderedGeneration = mutation({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) domainError("NOT_FOUND", "Generation not found");
    const { project } = await requireInternalProjectAccess(ctx, generation.projectId);
    if ((generation.candidateMode ?? "compare") === "iterative") {
      domainError(
        "INVALID_STATE",
        "Section-by-section generations are cancelled, not stopped"
      );
    }
    if (project.activeGenerationId !== generation._id) {
      domainError("STALE_REVISION", "This generation is no longer active");
    }
    if (generation.stopRequestedAt !== undefined) return null;
    if (generation.status !== "reserved" && generation.status !== "running") {
      domainError("INVALID_STATE", "This generation is no longer drafting");
    }
    await ctx.db.patch(generation._id, {
      stopRequestedAt: Date.now(),
      progressLog: [
        ...(generation.progressLog ?? []),
        "Stop requested: the section in progress finishes, then the draft is assembled.",
      ],
    });
    return null;
  },
});

/**
 * Drafted sections of an ungated single/compare generation, in production
 * order, for rendering sections as they complete. The last section in a
 * candidate's order is withheld until that candidate's consistency pass is
 * recorded (AD-24). Iterative generations have no ordered rows.
 */
export const getOrderedSectionDrafts = query({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.optional(v.id("generationCandidateRuns")),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) {
      return null;
    }
    if ((generation.candidateMode ?? "compare") === "iterative") return [];
    const rows = (
      await ctx.db
        .query("generationSectionRuns")
        .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
        .take(30)
    ).filter(
      (row) =>
        row.candidateRunId !== undefined &&
        (args.candidateRunId === undefined || row.candidateRunId === args.candidateRunId)
    );
    const lastIndex = new Map<string, number>();
    for (const row of rows) {
      const key = row.candidateRunId as string;
      lastIndex.set(key, Math.max(lastIndex.get(key) ?? -1, row.orderIndex ?? 0));
    }
    const checkedAt = new Map<string, number | undefined>();
    const runStatus = new Map<string, string | undefined>();
    for (const key of lastIndex.keys()) {
      const run = await ctx.db.get(key as Id<"generationCandidateRuns">);
      checkedAt.set(key, run?.consistencyCheckedAt);
      runStatus.set(key, run?.status);
    }
    return rows
      .filter((row) => row.status === "drafted" && row.draftText !== undefined)
      .filter((row) => {
        const key = row.candidateRunId as string;
        // A failed candidate's earlier drafted sections are not a valid
        // draft to show: the run never reached completion.
        return runStatus.get(key) !== "failed";
      })
      .filter((row) => {
        const key = row.candidateRunId as string;
        return (
          (row.orderIndex ?? 0) !== lastIndex.get(key) ||
          checkedAt.get(key) !== undefined
        );
      })
      .sort((a, b) =>
        a.candidateRunId === b.candidateRunId
          ? (a.orderIndex ?? 0) - (b.orderIndex ?? 0)
          : String(a.candidateRunId) < String(b.candidateRunId)
            ? -1
            : 1
      )
      .map((row) => ({
        candidateRunId: row.candidateRunId as Id<"generationCandidateRuns">,
        section: sectionNumberOfRow(row),
        orderIndex: row.orderIndex ?? 0,
        text: row.draftText ?? "",
        selfCheckStatus: selfCheckStatusOf(row.selfCheck),
      }));
  },
});
