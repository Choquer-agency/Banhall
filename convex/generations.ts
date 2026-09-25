import { bypassSeedEpisodes } from "./lib/seedDecisionWrites";
import {
  extractReportSections,
  fillNotDraftedSections,
  notDraftedReportSections,
  NOT_GENERATED_PLACEHOLDER,
  sectionParagraphs,
} from "./lib/tiptapReport";
import { writePreEditSnapshot } from "./lib/snapshots";
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
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getCurrentUserOrNull,
  getInternalProjectAccessOrNull,
  requireCurrentUser,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
import {
  getReportEditAccessOrNull,
  requireReportEditAccess,
} from "./lib/roleCapabilities";
import { domainError, sha256 } from "./lib/contracts";
import {
  requireAnthropicConfigured,
  requireOpenRouterConfigured,
} from "./lib/providerConfig";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
import {
  MODEL,
  seedModelById,
  type ModelEntry,
} from "../shared/generationModels";
import { randomComparePair, resolveCompareModels } from "./ai/model";
import {
  catalogEntry,
  entryFromFrozen,
  freezeModelsForGeneration,
  generationModelFreeze,
  isSelectableModel,
  listSelectableModels,
} from "./lib/modelRoles";
import type { ModelFreeze } from "./lib/modelCatalogValidators";
import { findActiveGeneration } from "./lib/activeGeneration";
import { resolveGatedWorkflow, resolveSeedPhase } from "./lib/gatedWorkflow";
import {
  PD_SECTION_HEADINGS,
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../shared/pdSubsections";
import {
  assertFrozenSourceBijection,
  buildFrozenSummaryPlan,
  emptyContextRevision,
  emptySelectionRevision,
  materializeFinalWording,
  orderShownSet,
  resolveFrozenSourceId,
  sha256Text,
  stableSerialize,
  projectSummaryOrdinaryChecks,
  summarySelfCheckWorstCaseResponse,
  SeedContextLimitError,
} from "./lib/seedRevisions";
import { terminateSeedAttempts, reapSeedAttempts } from "./seedRuns";
import { readSeedReadiness } from "./lib/seedReadiness";
import {
  SEED_DECISION_COLLECTION_ROWS,
} from "./lib/seedDecisionState";
import { matchesSeedExclusion } from "./lib/seedApproval";
import { isProjectDeleting } from "./lib/projectDeletion";
import {
  analyzerContextBudget,
  defaultModelId,
  transcriptFactsMode,
  transcriptPlaceholdersEnabled,
} from "./appSettings";
import { projectPlaceholderMap } from "./lib/transcriptPlaceholders";
import { sourceInclusion } from "./ai/trustedContext";
import {
  assembleContextInclusion,
  type UnfrozenDocument,
} from "./lib/contextInclusion";
import { createReadBudget } from "./lib/readBudget";
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
  scheduleStructureRebuildIfStale,
  transcriptLabel,
  TRANSCRIPT_BUDGET_CHARS,
} from "./lib/transcripts";
import { validateCitation } from "./lib/citations";
import { factQuotePool } from "./lib/seedFacts";
import {
  briefOutcomeValidator,
  describeBriefOutcome,
  renderBriefBlock,
} from "./lib/briefRender";
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
  type OrderedPayload,
  type SectionNumber,
} from "./lib/orderedChain";
import { ORDERED_SECTION_TITLES } from "./ai/promptDefinitions";
import {
  ACTIVE_GENERATION_STATUSES,
  isTerminalGenerationStatus,
} from "../shared/generationTransitions";
import {
  transitionGeneration,
  transitionPostQa,
  transitionRedraft,
} from "./lib/generationTransitions";
import {
  appendGenerationProgress,
  readGenerationProgress,
} from "./lib/generationProgress";
import {
  forwardOrderedPayload,
  loadOrderedPayload,
  persistOrderedPayload,
  resolveOrderedPayload,
} from "./lib/orderedPayloadStore";
import {
  sectionRunJson,
  sectionRunMetrics,
  sectionRunQa,
  missingSectionRunTypedFields,
  sectionRunSelfCheck,
  sectionRunTypedFields,
} from "./lib/sectionRunData";

// ─── Generation status helpers ───────────────────────────────────────────────
// ACTIVE_GENERATION_STATUSES (the project stays fenced on the generation and
// the dashboard shows activity for it) and isTerminalGenerationStatus (nothing
// may resurrect the row; stranded candidate runs are settled by the reaper)
// come from the declared state machine in shared/generationTransitions.ts.
// Every status write goes through transitionGeneration.

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

const generateOrderedSectionRef = makeFunctionReference<
  "action",
  {
    generationId: Id<"generations">;
    candidateRunId: Id<"generationCandidateRuns">;
    section: SectionNumber;
    payload?: OrderedPayload;
    payloadId?: Id<"generationArtifacts">;
  },
  null
>("ai/orderedGeneration:generateOrderedSection");
const startSummaryRecoveryRef = makeFunctionReference<
  "action",
  { generationId: Id<"generations"> },
  null
>("ai/orderedGeneration:startSummaryRecovery");

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
    const gatedWorkflow = resolveGatedWorkflow(generation);
    const seedRow = gatedWorkflow === "seeds"
      ? await ctx.db
          .query("seedSubsections")
          .withIndex("by_generationId", (q) =>
            q.eq("generationId", generation._id)
          )
          .first()
      : null;
    const seedPhase = resolveSeedPhase(generation, seedRow !== null);
    return {
      selectedModelLabel,
      iterativeModelLabel,
      postQaStatus: generation.postQaStatus,
      // Step-by-step writing and QA (CAP-17, CAP-18): the writer's stop, the
      // last Section drafted before it when Sections remain Not drafted, and
      // when the latest QA pass settled.
      stopRequestedAt: generation.stopRequestedAt,
      stoppedAfterSection: generation.stoppedAfterSection,
      postQaCompletedAt: generation.postQaCompletedAt,
      _id: generation._id,
      projectId: generation.projectId,
      transcriptId: generation.transcriptId,
      status: generation.status,
      candidateMode: generation.candidateMode ?? "compare",
      gatedWorkflow,
      seedPhase,
      seedStageError: generation.seedStageError ? SEED_INITIALIZATION_ERROR : undefined,
      seedStageVersion: generation.seedStageVersion ?? 0,
      summaryVersionId: generation.summaryVersionId ?? null,
      briefVersionId: generation.briefVersionId ?? null,
      originGenerationId: generation.originGenerationId ?? null,
      lengthTarget: generation.lengthTarget ?? null,
      seedCanEdit:
        gatedWorkflow === "seeds" &&
        (await getReportEditAccessOrNull(ctx, generation.projectId)) !== null,
      currentStep: generation.currentStep,
      // Same boundary contract as getIterativeState: raw provider text stays
      // on the row for ops; only typed copy and authored narration cross.
      // The newest PROGRESS_READ_LIMIT lines (child rows, legacy array first
      // for rows from before 2026-09-25).
      progressLog: (await readGenerationProgress(ctx, generation)).map(userSafeNarration),
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

/** Report-owned Seed metadata. A newer project generation must never replace
 * the frozen Summary that produced the report currently on screen. */
export const getGenerationSeedView = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) return null;
    const gatedWorkflow = resolveGatedWorkflow(generation);
    const seedRow = gatedWorkflow === "seeds"
      ? await ctx.db
          .query("seedSubsections")
          .withIndex("by_generationId", (q) =>
            q.eq("generationId", generation._id)
          )
          .first()
      : null;
    return {
      _id: generation._id,
      gatedWorkflow,
      seedPhase: resolveSeedPhase(generation, seedRow !== null),
      summaryVersionId: generation.summaryVersionId ?? null,
      seedCanEdit:
        gatedWorkflow === "seeds" &&
        (await getReportEditAccessOrNull(ctx, generation.projectId)) !== null,
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
        label: seedModelById(run.model)?.label ?? run.label ?? "Draft model",
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

/**
 * Entries for `ids` as a mutation sees them: frozen on `freeze` when the
 * retried generation carried one, else the catalog's selectable set. Never
 * the runtime registry, which only actions write.
 */
async function modelEntriesFor(
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
async function validatedSingleModelId(
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
async function persistedSingleModelId(
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
async function validatedCompareModelIds(
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

async function reserveGeneration(
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
  // generation (and its cached prefixes) sees the same bytes. It is checked
  // against every text the calls will send, so a source that already holds
  // placeholder-style tokens never has them restored into names.
  const placeholders = (await transcriptPlaceholdersEnabled(ctx))
    ? [
        ...(await projectPlaceholderMap(
          ctx,
          project,
          transcripts.map((row) => row._id),
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
      await validatedSingleModelId(ctx, candidateMode, args.singleModelId),
      await validatedCompareModelIds(ctx, candidateMode, args.compareModelIds),
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
    if (resolveGatedWorkflow(failed) === "seeds" && failed.summaryVersionId) {
      domainError("INVALID_INPUT", "Use Summary recovery for a signed-off seed generation");
    }
    const { project, user } = await requireInternalProjectAccess(ctx, failed.projectId);
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
  },
});

/** Recover prose drafting from the same immutable Summary and frozen inputs. */
export const retryFromSummary = mutation({
  args: { failedGenerationId: v.id("generations") },
  handler: async (ctx, args) => {
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
    if (!project || project.deletionStartedAt !== undefined || project.activeGenerationId !== generation._id) return false;
    await transitionGeneration(ctx, generation, "running", {
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

/**
 * The placeholder map frozen on a generation (owner decision 26); empty for
 * generations reserved before it or with the emergency switch off.
 */
export const getGenerationPlaceholders = internalQuery({
  args: { generationId: v.id("generations") },
  returns: v.array(v.object({ token: v.string(), value: v.string() })),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    return generation?.placeholders ?? [];
  },
});

export const getGenerationInput = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    const project = await ctx.db.get(generation.projectId);
    if (!project || project.deletionStartedAt !== undefined || project.activeGenerationId !== generation._id) return null;
    let reportTitle = project.title;
    if (
      resolveGatedWorkflow(generation) === "seeds" &&
      generation.summaryVersionId !== undefined
    ) {
      const summary = await ctx.db.get(generation.summaryVersionId);
      if (
        !summary ||
        summary.projectId !== generation.projectId ||
        summary.originGenerationId !== (generation.originGenerationId ?? generation._id) ||
        summary.reportTitle === undefined
      ) {
        return null;
      }
      reportTitle = summary.reportTitle;
    }
    const sources = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      // One transcript row and one digest row per transcript, plus the 50
      // context documents. A tighter bound would drop the digest rows of a
      // many-transcript project — the case digest mode exists for — and hand
      // the model the over-budget full text instead.
      .take(3 * MAX_TRANSCRIPTS_PER_PROJECT + 51);
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
    // 2026-09-24 (transcript method): a generation that froze a fact pack for
    // every transcript reads the packs; with any pack missing it reads what
    // it read before (digests over the budget, full text under it).
    const factRows = sources.filter((source) => source.kind === "transcript_facts");
    const orderedFacts = (transcriptIds ?? []).flatMap((id) => {
      const row = factRows.find((source) => source.transcriptId === id);
      return row ? [row] : [];
    });
    const factParts =
      generation.transcriptFacts === true &&
      transcriptIds !== undefined &&
      transcriptIds.length > 0 &&
      orderedFacts.length === transcriptIds.length
        ? orderedFacts
        : undefined;
    const fullTranscriptRows = sources.filter((source) => source.kind === "transcript");
    // Insertion order is reservation order, which is the project's transcript
    // order; every offset the pipeline cites is relative to one of these rows.
    const transcriptParts = (factParts ?? digestParts ?? fullTranscriptRows).map(toPart);
    // Plan step 8: reading facts, report claims cite the packs' verified
    // client quotes on the frozen transcript rows, never the packs.
    const factQuotes = factParts
      ? factQuotePool(
          sources.map((source) => ({
            sourceId: source._id,
            kind: source.kind,
            content: source.content,
            contentHash: source.contentHash,
            transcriptId: source.transcriptId,
            factSpans: source.factSpans,
          }))
        )
      : undefined;
    return {
      inputMode,
      transcriptFacts: generation.transcriptFacts === true,
      // What `transcriptParts` holds: fact packs, digests or full text.
      transcriptReading: factParts ? ("facts" as const) : digestParts ? ("digest" as const) : ("full" as const),
      // Reading fact packs only: the frozen full-text transcript rows, which
      // claims read from a pack cite (decision 25 and the provenance
      // contract). Left out otherwise, so no other generation carries the
      // full text twice (review 2026-09-25, P3-3).
      ...(factParts ? { transcriptRows: fullTranscriptRows.map(toPart) } : {}),
      ...(factQuotes ? { factQuotes } : {}),
      // Owner decision 26: the frozen name map, for work that leaves the
      // app without a model call (the Brain query built from facts).
      placeholders: generation.placeholders ?? [],
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
      title: reportTitle,
      lengthTarget: generation.lengthTarget ?? "standard",
      candidateMode: generation.candidateMode ?? "compare",
      singleModelId: generation.singleModelId,
      gatedWorkflow: resolveGatedWorkflow(generation),
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
// carries its full extracted text (≤ 1 MiB). Every row read outside a list
// walk — the generation, the authorization rows and the four analyzer
// settings (whose `value` is an unrestricted string) — is read FIRST and
// charged at its actual size; each list then reserves a maximum-size
// document before every read. Whatever the budget could not read is reported
// as truncated, never thrown. Worst case actually read: the seven up-front
// rows (≤ 7 MiB, charged) plus list reads up to the 14 MiB total, 2 MiB
// under the limit.
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
    const reads = createReadBudget({ maxBytes: INCLUSION_READ_BYTES });
    reads.account(generation);
    reads.account(access.user);
    reads.account(access.project);
    // The four settings rows are read before any walk and charged as read,
    // so a large (still parseable) setting shrinks what the walks may read
    // instead of landing on top of them after the budget was spent.
    const budget = await analyzerContextBudget(ctx, (row) => reads.account(row));

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
    if (await isProjectDeleting(ctx, generation.projectId)) return null;
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
    // Story 0 (AD-19): a claim scheduled before the project entered deletion
    // must not repopulate it. Narrate and return without writing.
    if (await isProjectDeleting(ctx, run.projectId)) {
      console.log("claimCandidateRun: project is being deleted; run left unclaimed", {
        projectId: run.projectId,
        candidateRunId: run._id,
      });
      return null;
    }
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
      project.deletionStartedAt !== undefined ||
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
    if (await isProjectDeleting(ctx, run.projectId)) return;
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
      await appendGenerationProgress(ctx, generation, [
        succeeded
          ? `✓ One-shot comparison draft ready (${run.label}).`
          : `✗ One-shot comparison draft failed: ${args.error ?? "provider error"}.`,
      ]);
      return;
    }

    // Story 2 (AD-24): stamp the production order (shared by every compare
    // candidate, one Build Order per generation) and, for a stopped single
    // chain, the section it stopped after. Compare candidates stop
    // independently, so there the selected candidate's value is copied on
    // selectReportCandidate instead.
    // A signed-off seed run is one chain too (FR-43): its stop is stamped here.
    const isSeedOrdered =
      generation.candidateMode === "iterative" &&
      resolveGatedWorkflow(generation) === "seeds" &&
      generation.summaryVersionId !== undefined;
    const stampStop =
      args.stoppedAfterSection !== undefined &&
      (generation.candidateMode === "single" || isSeedOrdered);
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
    const runLine = succeeded
      ? `✓ ${run.label} draft ready (QA ${args.qaScore ?? "—"}/100).`
      : `✗ ${run.label} failed: ${args.error ?? "provider error"}.`;
    if (terminal.length < (generation.totalCandidates ?? runs.length)) {
      await appendGenerationProgress(ctx, generation, [runLine]);
      await ctx.db.patch(generation._id, {
        candidatesDone: done,
        candidatesFailed: failed,
      });
      return;
    }
    if (done > 0) {
      // CAP-18: the seed report exists before QA, which then runs in the
      // background. A stopped seed draft runs no QA (FR-43).
      const seedStopped = isSeedOrdered && args.stoppedAfterSection !== undefined;
      const scheduleSeedQa = isSeedOrdered && !seedStopped;
      if (generation.candidateMode !== "single" && !isSeedOrdered) {
        await appendGenerationProgress(ctx, generation, [runLine]);
        await transitionGeneration(ctx, generation, "awaiting_selection", {
          candidatesDone: done,
          candidatesFailed: failed,
          currentStep: "Choose your preferred draft",
        });
        await refreshProjectGenerationActivity(ctx, generation.projectId);
        return;
      }

      const candidate = candidateId ? await ctx.db.get(candidateId) : null;
      if (!candidate) return;
      await createGeneratedReportArtifacts(ctx, generation, candidate);
      if (seedStopped) {
        // FR-43: the Sections the stop left undrafted are explicitly "Not
        // drafted" rather than pending forever; redraftMissingSections
        // re-queues exactly these rows.
        await terminalizeSignedOffSeedSections(
          ctx,
          generation._id,
          NOT_DRAFTED_AFTER_STOP
        );
      }
      const now = Date.now();
      await ctx.db.patch(project._id, {
        activeGenerationId: undefined,
        status: "review",
        updatedAt: now,
      });
      await appendGenerationProgress(ctx, generation, [
        runLine,
        ...(scheduleSeedQa
          ? ["Running the QA scorecard and chronology in the background…"]
          : seedStopped
            ? [
                `Stopped after Line ${args.stoppedAfterSection}: the drafted Sections are in the report, the rest are marked Not drafted, and QA does not run on a stopped draft.`,
              ]
            : []),
      ]);
      await transitionGeneration(ctx, generation, "completed", {
        candidatesDone: done,
        candidatesFailed: failed,
        currentStep: "Complete",
        agentOutputs: candidate.agentOutputs,
        completedAt: now,
        ...(scheduleSeedQa
          ? { postQaStatus: "running" as const, postQaStartedAt: now }
          : {}),
      });
      await refreshProjectGenerationActivity(ctx, generation.projectId);
      const candidates = await ctx.db
        .query("reportCandidates")
        .withIndex("by_generationId", (q) =>
          q.eq("generationId", generation._id)
        )
        .take(10);
      for (const row of candidates) await ctx.db.delete(row._id);
      if (scheduleSeedQa) {
        await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
          generationId: generation._id,
          attemptStartedAt: now,
        });
      }
      return;
    }

    await appendGenerationProgress(ctx, generation, [runLine]);
    await transitionGeneration(ctx, generation, "failed", {
      candidatesDone: 0,
      candidatesFailed: failed,
      currentStep: "Failed",
      error: "All candidate models failed to generate.",
      completedAt: Date.now(),
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

/** Row error for a Section a writer's stop left undrafted (FR-43). */
const NOT_DRAFTED_AFTER_STOP = "Not drafted: the writer stopped before this Section.";

/** Terminalize only the ordered section rows owned by a signed-off seed
 * chain. Legacy iterative rows keep their existing per-section recovery
 * behavior and never call this helper. */
async function terminalizeSignedOffSeedSections(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  error: string
) {
  const rows = await ctx.db
    .query("generationSectionRuns")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(10);
  const now = Date.now();
  for (const row of rows) {
    if (
      row.status !== "pending" &&
      row.status !== "queued" &&
      row.status !== "running"
    ) {
      continue;
    }
    await ctx.db.patch(row._id, {
      status: "failed",
      error,
      completedAt: now,
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
    await transitionGeneration(ctx, generation, "failed", {
      currentStep: "Failed",
      error: args.error.slice(0, 500),
      completedAt: Date.now(),
    });
    await terminalizeOrphanedCandidateRuns(
      ctx,
      generation._id,
      "The generation failed before this draft completed."
    );
    if (
      resolveGatedWorkflow(generation) === "seeds" &&
      generation.summaryVersionId !== undefined
    ) {
      await terminalizeSignedOffSeedSections(
        ctx,
        generation._id,
        "The generation failed before this section draft completed."
      );
    }
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
    const generation = await ctx.db.get(args.generationId);
    if (!generation || await isProjectDeleting(ctx, generation.projectId)) return;
    if (resolveGatedWorkflow(generation) === "seeds") {
      const project = await ctx.db.get(generation.projectId);
      if (generation.status !== "running" || project?.activeGenerationId !== generation._id) return;
    }
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
        if (resolveGatedWorkflow(generation) === "seeds") continue;
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

/**
 * Frozen `generationSources` rows one Brief derivation may read. The
 * structural maximum is 112 (`3 * MAX_TRANSCRIPTS_PER_PROJECT + 52`, see
 * `convex/writerProfiles.ts:585-587`), so this is slack rather than a real
 * ceiling — it exists only so the read is bounded and provably complete.
 */
export const MAX_BRIEF_SOURCE_ROWS = 200;

/**
 * Entries per Brief version a generation consumer may read in one
 * transaction — the same bound `convex/briefs.ts` applies to the
 * writer-facing copy path, so no Brief that path can write is unreadable
 * here. Also the most rows one diff-baseline page may return
 * (`getBriefDiffBaselinePage`); the baseline itself has no ceiling.
 */
export const MAX_BRIEF_ENTRY_ROWS = 500;

/**
 * Bytes one diff-baseline page may read (`maximumBytesRead`), well inside
 * Convex's 16 MiB per-transaction read limit. A page that reaches it reports
 * `SplitRequired` and is re-read smaller by
 * `ai/brief.ts:readCompleteBriefDiffBaseline`.
 */
export const BRIEF_BASELINE_PAGE_BYTES = 4 * 1024 * 1024;

/**
 * Bytes a generation consumer's Brief read may take (`maximumBytesRead` in
 * `readBriefEntryRowsOrOmit`). DW-152: the row bound alone does not bound
 * bytes, because writer edits (`briefs.saveEntryEdit`) accept any non-empty
 * text, so `MAX_BRIEF_ENTRY_ROWS` rows can exceed Convex's 16 MiB
 * per-transaction read limit and throw.
 *
 * 4 MiB (the same size as a diff-baseline page) leaves real headroom in the
 * heaviest caller, `claimOrderedSectionRun`, where the read shares one
 * transaction with the claimed section row, the fence's candidate run,
 * generation and project, the claim's `ctx.db.patch` of the section row
 * (a patch reads the row it merges into, so it is counted as a read; convex-test
 * charges it the same way), the DW-119 `lastProgressAt` patch of the
 * generation (another merge read), the candidate's three section rows (prior
 * drafts) and the Brief parent: 10 other document reads of at most 1 MiB each.
 * Convex checks the byte budget after a row is read, so the Brief read can
 * overshoot by at most one row (1 MiB): 10 + 4 + 1 = 15 MiB worst case, under
 * 16 MiB. `getOrderedCandidateDrafts` (6 other documents, 6 + 4 + 1 = 11 MiB)
 * and `renderBriefForGeneration` (2) have more headroom. A realistic Brief (short
 * derived entries and excerpts) is a small fraction of this; one that exceeds
 * it is omitted whole, like an over-bound one.
 */
export const BRIEF_CONSUMER_READ_BYTES = 4 * 1024 * 1024;

/**
 * Every frozen source a Brief derivation reads, or a refusal. Reads one past
 * the bound rather than returning a silent prefix: a derivation treats what
 * it reads as the complete evidence set, so a prefix would quietly become
 * authoritative (the same rule `convex/briefs.ts:briefEntriesToCopy` applies
 * on the writer side).
 *
 * Write path only, so refusing is safe: its one caller
 * (`ai/brief.ts:deriveOrReuseBrief`) runs under the fail-open stage runner
 * `ai/brief.ts:runGenerationBriefStage`, which means "record a failed outcome
 * and continue with no Brief". The structural maximum is far below the bound
 * (see above), so unlike the diff baseline this read needs no paging.
 */
async function readBriefSourceRows(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
) {
  const rows = await ctx.db
    .query("generationSources")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(MAX_BRIEF_SOURCE_ROWS + 1);
  if (rows.length > MAX_BRIEF_SOURCE_ROWS) {
    return domainError(
      "INVALID_STATE",
      `This generation has more than ${MAX_BRIEF_SOURCE_ROWS} frozen sources and cannot be read completely for a Generation Brief`
    );
  }
  return rows;
}

/**
 * A generation consumer's read of a Brief's entry rows: every row, or `null`
 * — "omit the whole Brief, exactly as if this generation had no briefId" —
 * plus one `console.error` so the omission is diagnosable. The single
 * bounded probe (`bound + 1` rows, `BRIEF_CONSUMER_READ_BYTES` bytes);
 * nothing else reads a Brief's rows for a prompt.
 *
 * An over-bound Brief is reachable in production, not only from seeded data:
 * `ai/brief.ts:289-305` reuses a Brief by parent row alone (it never reads
 * children), and `persistDerivedBrief` publishes a derivation's validated
 * entries plus removal markers in full, however many that is. The diff
 * baseline does not use this read: it enumerates every row in pages
 * (`getBriefDiffBaselinePage`), so an over-bound newest Brief never blocks a
 * later derivation.
 *
 * Scope: this handles row-count and byte overflow (DW-152) — it never returns
 * a prefix and never raises for an over-bound or byte-heavy Brief. The read
 * is one `.paginate()` with `maximumBytesRead`, so a byte-heavy Brief stops
 * at the budget instead of reaching the transaction read limit. The Brief is
 * complete only when that single page holds at most `MAX_BRIEF_ENTRY_ROWS`
 * rows, reports `isDone` and is not `SplitRequired`; anything else (including
 * a short page Convex ends early) is omitted whole. Callers must not run
 * another `.paginate()` in the same function (Convex allows one). It is not
 * general exception safety; a database read failure or a transaction limit
 * reached by the caller's own other reads still propagates.
 *
 * Overflow must not raise because `claimOrderedSectionRun` is awaited at
 * `ai/orderedGeneration.ts:173-178` and `getOrderedCandidateDrafts` at
 * `:373-376`, both *outside* that action's own `try` (`:200`, `:410`), so a
 * throw here would roll the CAS claim back and strand the section `queued`
 * until stale-generation recovery — `failOrderedSectionRun:345` never sees
 * it. `iterative.ts:406-410` and `pipeline.ts:957-961` would fail the
 * section/candidate outright. Brief guidance is optional by contract, so its
 * unreadability must not fail or stall a generation.
 */
type CompleteBriefEntryRead = {
  kind: "complete";
  rows: Doc<"generationBriefEntries">[];
};

type IncompleteBriefEntryRead =
  | { kind: "row_limit" }
  | { kind: "byte_limit" };

type BriefEntryReadScope = "all" | "immutable_input";

/**
 * The one bounded complete-read criterion shared by legacy generation
 * consumers, Summary sign-off admission and every signed Summary consumer.
 */
async function readBriefEntryRowsBounded(
  ctx: { db: QueryCtx["db"] },
  briefId: Id<"generationBriefs">,
  scope: BriefEntryReadScope = "all"
): Promise<CompleteBriefEntryRead | IncompleteBriefEntryRead> {
  const pagination = {
    cursor: null,
    numItems: MAX_BRIEF_ENTRY_ROWS + 1,
    maximumBytesRead: BRIEF_CONSUMER_READ_BYTES,
  } as const;
  const result = scope === "immutable_input"
    ? await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId_and_generatedOutput", (q) =>
          q.eq("briefId", briefId).eq("generatedOutput", undefined))
        .paginate(pagination)
    : await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (q) => q.eq("briefId", briefId))
        .paginate(pagination);
  const rows = result.page;
  if (rows.length > MAX_BRIEF_ENTRY_ROWS) {
    return { kind: "row_limit" };
  }
  if (!result.isDone || result.pageStatus === "SplitRequired") {
    return { kind: "byte_limit" };
  }
  return { kind: "complete", rows };
}

/**
 * Generated questions belong to a Summary-authored Brief's visible/editable
 * history, not to its reusable prompt guidance. The author generation is the
 * persisted workflow discriminator: legacy-authored Briefs retain their
 * historical combined read, while Summary consumers and legacy consumers of
 * a Summary-authored edit read the complete immutable-input partition.
 */
async function briefEntryReadScope(
  ctx: { db: QueryCtx["db"] },
  consumer: Doc<"generations">,
  brief: Doc<"generationBriefs">
): Promise<BriefEntryReadScope> {
  if (resolveGatedWorkflow(consumer) === "seeds") return "immutable_input";
  const author = await ctx.db.get(brief.generationId);
  return author && resolveGatedWorkflow(author) === "seeds"
    ? "immutable_input"
    : "all";
}

async function readBriefEntryRowsOrOmit(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  brief: Doc<"generationBriefs">
) {
  const result = await readBriefEntryRowsBounded(
    ctx,
    brief._id,
    await briefEntryReadScope(ctx, generation, brief)
  );
  if (result.kind === "row_limit") {
    console.error(
      `Generation Brief omitted from generation ${generation._id}: Brief ${brief._id} has more than ${MAX_BRIEF_ENTRY_ROWS} entries and cannot be read completely`
    );
    return null;
  }
  if (result.kind === "byte_limit") {
    console.error(
      `Generation Brief omitted from generation ${generation._id}: Brief ${brief._id} cannot be read completely within ${BRIEF_CONSUMER_READ_BYTES} bytes`
    );
    return null;
  }
  return result.rows;
}

/** The frozen `generationSources` rows a Brief derivation reads. */
export const getGenerationSourcesForBrief = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    return await readBriefSourceRows(ctx, args.generationId);
  },
});

/** Latest stored Brief for one reusable input key, regardless of origin. */
async function latestBriefForInputs(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">,
  inputsHash: string
) {
  return await ctx.db
    .query("generationBriefs")
    .withIndex("by_projectId_and_inputsHash", (q) =>
      q.eq("projectId", projectId).eq("inputsHash", inputsHash)
    )
    .order("desc")
    .first();
}

async function reusableBriefForGeneration(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  inputsHash: string
) {
  const brief = await latestBriefForInputs(ctx, generation.projectId, inputsHash);
  if (!brief) return null;
  const scope = await briefEntryReadScope(ctx, generation, brief);
  // Preserve the historical legacy path: legacy-authored Briefs are reused by
  // parent row and an over-bound combined read remains optional/fail-open.
  if (scope === "all") return brief;
  const read = await readBriefEntryRowsBounded(ctx, brief._id, scope);
  return read.kind === "complete" ? brief : null;
}

/** MAX(version) Brief for (projectId, inputsHash), regardless of origin — a
 * writer-edited version is reused too (CAP-4: "the next generation with the
 * same inputsHash reuses that version"). */
export const findReusableBrief = internalQuery({
  args: { generationId: v.id("generations"), inputsHash: v.string() },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    return await reusableBriefForGeneration(ctx, generation, args.inputsHash);
  },
});

/** Seeds pin a reusable Brief (including explicit absence) before model work. */
async function requireSeedInitialization(ctx: MutationCtx, generationId: Id<"generations">) {
  const generation = await ctx.db.get(generationId);
  if (!generation || resolveGatedWorkflow(generation) !== "seeds") {
    domainError("INVALID_STATE", "Seed initialization is unavailable");
  }
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.activeGenerationId !== generationId ||
      await isProjectDeleting(ctx, generation.projectId) ||
      (generation.status !== "running" && generation.status !== "awaiting_input") ||
      generation.summaryVersionId) {
    domainError("INVALID_STATE", "Seed initialization is no longer active");
  }
  return generation;
}

export const pinSeedBrief = internalMutation({
  args: { generationId: v.id("generations"), inputsHash: v.string() },
  returns: v.union(v.id("generationBriefs"), v.null()),
  handler: async (ctx, args) => {
    const generation = await requireSeedInitialization(ctx, args.generationId);
    if (generation.seedBriefPin !== undefined) {
      if (generation.seedBriefInputsHash !== args.inputsHash) {
        domainError("INVALID_STATE", "Frozen Brief inputs changed");
      }
      return generation.briefId ?? generation.seedBriefPin;
    }
    const candidate = generation.briefId
      ? await ctx.db.get(generation.briefId)
      : await reusableBriefForGeneration(ctx, generation, args.inputsHash);
    if (candidate && (candidate.projectId !== generation.projectId || candidate.inputsHash !== args.inputsHash)) {
      domainError("INVALID_STATE", "Frozen Brief inputs do not match");
    }
    const pin = candidate?._id ?? null;
    await ctx.db.patch(generation._id, {
      seedBriefPin: pin,
      seedBriefInputsHash: args.inputsHash,
      ...(pin ? { briefId: pin } : {}),
    });
    return pin;
  },
});

export const SEED_INITIALIZATION_ERROR = "Seed preparation did not complete. Retry initialization.";

export async function bumpSeedStageVersion(ctx: MutationCtx, generationId: Id<"generations">): Promise<void> {
  const generation = await ctx.db.get(generationId);
  if (generation) await ctx.db.patch(generationId, { seedStageVersion: (generation.seedStageVersion ?? 0) + 1 });
}

export async function adjustSeedRequestsReserved(ctx: MutationCtx, generationId: Id<"generations">, delta: number): Promise<void> {
  const generation = await ctx.db.get(generationId);
  if (!generation) return;
  const next = (generation.seedRequestsReserved ?? 0) + delta;
  if (!Number.isInteger(next) || next < 0) domainError("INVALID_STATE", "Invalid seed request reservation");
  await ctx.db.patch(generationId, { seedRequestsReserved: next });
}

async function requireFrozenSeedArtifacts(ctx: MutationCtx, generation: Doc<"generations">) {
  if (!generation.writerSettings) domainError("INVALID_STATE", "Frozen writer settings are unavailable");
  for (const kind of ["analysis", "brain_blocks"] as const) {
    const artifact = await ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", q => q.eq("generationId", generation._id).eq("kind", kind)).unique();
    if (!artifact) domainError("INVALID_STATE", "Frozen initialization artifacts are unavailable");
  }
}

export const initializeSeedStage = internalMutation({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await requireSeedInitialization(ctx, args.generationId);
    const existing = await ctx.db.query("seedSubsections")
      .withIndex("by_generationId", q => q.eq("generationId", generation._id)).take(14);
    if (existing.length) {
      if (existing.length !== 13 || PD_SUBSECTIONS.some(role => !existing.some(row => row.roleId === role.roleId))) {
        domainError("INVALID_STATE", "Seed initialization is incomplete");
      }
      return null;
    }
    await requireFrozenSeedArtifacts(ctx, generation);
    if (!generation.briefId || generation.seedBriefPin === undefined) {
      domainError("INVALID_STATE", "Frozen Brief is unavailable");
    }
    const brief = await ctx.db.get(generation.briefId);
    if (!brief || brief.projectId !== generation.projectId || brief.inputsHash !== generation.seedBriefInputsHash) {
      domainError("INVALID_STATE", "Frozen Brief is unavailable");
    }
    const currentContextRevision = await emptyContextRevision();
    const selectionRevision = await emptySelectionRevision();
    for (const role of PD_SUBSECTIONS) {
      await ctx.db.insert("seedSubsections", {
        projectId: generation.projectId, generationId: generation._id,
        roleId: role.roleId, kind: role.kind, state: "untouched",
        currentContextRevision, selectionRevision, consecutiveFailures: 0,
      });
    }
    await transitionGeneration(ctx, generation, "awaiting_input", {
      briefVersionId: brief._id,
      seedStageVersion: 0, seedRequestsReserved: 0, seedStageError: undefined,
      lengthTarget: generation.lengthTarget ?? "standard", currentStep: "Seeds ready",
    });
    await ctx.db.insert("seedDecisionEvents", {
      projectId: generation.projectId, generationId: generation._id,
      kind: "initialized", at: Date.now(), actorSystem: true,
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    return null;
  },
});

type FrozenBrainArtifact = {
  blocks: OrderedPayload["brainExemplars"];
  styleGuidance: string;
  orderedContext: OrderedPayload["orderedContext"];
  qaCalibration?: string;
  draftStyle?: string;
  qaCalibrationDigestId?: Id<"learningDigests">;
  draftStyleDigestId?: Id<"learningDigests">;
  writerFlavor?: string;
  styleOverrides?: OrderedPayload["styleOverrides"];
};

function parseFrozenBrainArtifact(content: string): FrozenBrainArtifact {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    domainError("INVALID_STATE", "Frozen drafting artifacts are malformed");
  }
  if (!value || typeof value !== "object") {
    domainError("INVALID_STATE", "Frozen drafting artifacts are malformed");
  }
  const artifact = value as Partial<FrozenBrainArtifact>;
  const blocks = artifact.blocks;
  if (
    !blocks ||
    typeof blocks.analyzer !== "string" ||
    typeof blocks.s242 !== "string" ||
    typeof blocks.s244 !== "string" ||
    typeof blocks.s246 !== "string" ||
    typeof artifact.styleGuidance !== "string" ||
    !artifact.orderedContext
  ) {
    domainError("INVALID_STATE", "Frozen drafting artifacts are incomplete");
  }
  return artifact as FrozenBrainArtifact;
}

async function frozenOrderedPayload(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  summaryVersionId: Id<"summaryVersions">
): Promise<OrderedPayload> {
  const [analysis, brain] = await Promise.all([
    ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", generation._id).eq("kind", "analysis"))
      .unique(),
    ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", generation._id).eq("kind", "brain_blocks"))
      .unique(),
  ]);
  if (!analysis || !brain) {
    domainError("INVALID_STATE", "Frozen drafting artifacts are unavailable");
  }
  const artifact = parseFrozenBrainArtifact(brain.content);
  return {
    analysis: analysis.content,
    brainExemplars: artifact.blocks,
    ...(artifact.qaCalibration ? { qaCalibration: artifact.qaCalibration } : {}),
    ...(artifact.draftStyle ? { draftStyle: artifact.draftStyle } : {}),
    ...(artifact.qaCalibrationDigestId
      ? { qaCalibrationDigestId: artifact.qaCalibrationDigestId }
      : {}),
    ...(artifact.draftStyleDigestId
      ? { draftStyleDigestId: artifact.draftStyleDigestId }
      : {}),
    ...(artifact.writerFlavor ? { writerFlavor: artifact.writerFlavor } : {}),
    ...(artifact.styleOverrides ? { styleOverrides: artifact.styleOverrides } : {}),
    orderedContext: artifact.orderedContext,
    frozenStyleGuidance: artifact.styleGuidance,
    summaryVersionId,
  };
}

async function createFrozenOrderedChain(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  summaryVersionId: Id<"summaryVersions">,
  payload: OrderedPayload
): Promise<{
  candidateRunId: Id<"generationCandidateRuns">;
  scheduledJobId: Id<"_scheduled_functions">;
}> {
  const model = generation.singleModelId ?? MODEL;
  const frozen = generationModelFreeze(generation).entries.find((entry) => entry.id === model);
  const candidate = frozen ? entryFromFrozen(frozen) : seedModelById(model);
  if (!candidate) domainError("INVALID_STATE", "Frozen generation model is unavailable");
  const now = Date.now();
  const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
    generationId: generation._id,
    projectId: generation.projectId,
    model: candidate.id,
    label: candidate.label,
    status: "running",
    queuedAt: now,
    startedAt: now,
  });
  const order = payload.orderedContext.buildOrder;
  if (order.length !== 3) domainError("INVALID_STATE", "Frozen Build Order is invalid");
  for (const [index, section] of order.entries()) {
    await ctx.db.insert("generationSectionRuns", {
      generationId: generation._id,
      projectId: generation.projectId,
      section: sectionKeyOf(section),
      status: index === 0 ? "queued" : "pending",
      model: candidate.id,
      label: candidate.label,
      attempt: 1,
      candidateRunId,
      orderIndex: index,
      queuedAt: now,
    });
  }
  // Persisted once; the chain's actions receive its id (2026-09-25).
  const payloadId = await persistOrderedPayload(ctx, generation._id, candidateRunId, {
    ...payload,
    summaryVersionId,
  });
  const scheduledJobId = await ctx.scheduler.runAfter(
    0,
    generateOrderedSectionRef,
    {
      generationId: generation._id,
      candidateRunId,
      section: order[0],
      payloadId,
    }
  );
  await ctx.db.patch(candidateRunId, { scheduledJobId });
  return { candidateRunId, scheduledJobId };
}

function refuseSummaryCapacity(error: unknown): never {
  if (error instanceof SeedContextLimitError) {
    domainError("INVALID_INPUT", error.message, {
      reason: "SUMMARY_CAPACITY_EXCEEDED",
      limit: error.limit,
    });
  }
  throw error;
}

function summaryOrdinaryAdmission(args: {
  section: SectionNumber;
  storylineText: string;
  briefEntries: ReadonlyArray<{
    group: string;
    text: string;
    change?: string;
  }>;
  payload: OrderedPayload;
}) {
  const activeEntries = args.briefEntries.filter((entry) => entry.change !== "removed");
  return projectSummaryOrdinaryChecks({
    storylineText: args.storylineText,
    confidenceMap: activeEntries
      .filter((entry) => entry.group === "confidenceMap")
      .map((entry) => ({ text: entry.text })),
    glossaryTerms: activeEntries
      .filter((entry) => entry.group === "glossaryTerm")
      .map((entry) => entry.text),
    writerFlavor: args.payload.writerFlavor,
    rules: args.payload.orderedContext.selfCheckRules.filter(
      (rule) =>
        (rule.section === undefined || rule.section === args.section) &&
        rule.maxWords === undefined &&
        rule.maxLines === undefined
    ),
  });
}

/** AD-37: freeze ready decisions and enter the existing ordered chain. */
export const signOffSeedStage = mutation({
  args: {
    generationId: v.id("generations"),
    expectedSeedStageVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) domainError("NOT_FOUND", "Generation not found");
    const { user, project } = await requireReportEditAccess(ctx, generation.projectId);
    if (
      resolveGatedWorkflow(generation) !== "seeds" ||
      generation.status !== "awaiting_input" ||
      generation.summaryVersionId ||
      project.activeGenerationId !== generation._id
    ) {
      domainError("INVALID_STATE", "The seed stage is closed", {
        reason: "SEED_STAGE_CLOSED",
      });
    }
    if (
      !Number.isSafeInteger(args.expectedSeedStageVersion) ||
      args.expectedSeedStageVersion !== (generation.seedStageVersion ?? 0)
    ) {
      domainError("STALE_REVISION", "Seed decisions changed; refresh and retry");
    }
    const readiness = await readSeedReadiness(ctx, {
      generationId: generation._id,
      includeState: true,
    });
    if (!readiness.complete || !readiness.ready) {
      domainError("INVALID_STATE", "Every required seed decision must be ready before sign-off");
    }
    const state = readiness.state;
    if (!state) domainError("INVALID_STATE", "Seed readiness state is unavailable");
    if (!generation.briefVersionId || !generation.writerSettings) {
      domainError("INVALID_STATE", "Frozen Brief and settings are required for sign-off");
    }
    const activeSelectionRows = state.selectionRows.filter((row) => row.selected);
    const selectedIds = new Set(activeSelectionRows.map((row) => row.seedId));
    const selectedSeeds = orderShownSet({
      seeds: state.seeds,
      batches: state.batches,
    }).filter((seed) => selectedIds.has(seed._id));
    const skippedRoleIds = PD_SUBSECTIONS.filter((role) =>
      state.subsections.some(
        (row) => row.roleId === role.roleId && row.state === "skipped"
      )
    ).map((role) => role.roleId);
    const briefRead = await readBriefEntryRowsBounded(
      ctx,
      generation.briefVersionId,
      "immutable_input"
    );
    if (briefRead.kind === "row_limit") {
      domainError("INVALID_INPUT", "Frozen Brief exceeds the runtime row budget", {
        reason: "SUMMARY_BRIEF_ROWS_EXCEEDED",
        limit: String(MAX_BRIEF_ENTRY_ROWS),
      });
    }
    if (briefRead.kind === "byte_limit") {
      domainError("INVALID_INPUT", "Frozen Brief exceeds the runtime byte budget", {
        reason: "SUMMARY_BRIEF_BYTES_EXCEEDED",
        limit: String(BRIEF_CONSUMER_READ_BYTES),
      });
    }
    const briefEntries = briefRead.rows;
    const briefDoc = await ctx.db.get(generation.briefVersionId);
    if (!briefDoc || briefDoc.projectId !== generation.projectId) {
      domainError("INVALID_STATE", "Frozen Brief is unavailable");
    }
    const claimExclusions = briefEntries.filter(
      (entry) => entry.group === "claimExclusion" && entry.change !== "removed"
    );
    const settingsHash = await sha256Text(JSON.stringify({
      writerSettings: generation.writerSettings,
      lengthTarget: generation.lengthTarget,
    }));
    const now = Date.now();
    const summaryVersionId = await ctx.db.insert("summaryVersions", {
      projectId: generation.projectId,
      generationId: generation._id,
      version: 1,
      originGenerationId: generation._id,
      briefVersionId: generation.briefVersionId,
      reportTitle: project.title,
      settingsHash,
      skippedRoleIds,
      readiness: true,
      signedOffBy: user._id,
      signedOffAt: now,
    });
    const frozenItems: Array<{
      _id: Id<"summaryItems">;
      itemId: Id<"summaryItems">;
      roleId: (typeof PD_SUBSECTIONS)[number]["roleId"];
      kind: "standard" | "optional" | "multiple";
      bullets: string[];
      support: "source_supported" | "writer_asserted";
      uncertaintySeedId?: Id<"seeds">;
      experimentSeedIds?: Id<"seeds">[];
      confirmedExclusion?: boolean;
      seedId: Id<"seeds">;
    }> = [];
    for (const [order, seed] of selectedSeeds.entries()) {
      const selection = activeSelectionRows.find((row) => row.seedId === seed._id);
      if (!selection) domainError("INVALID_STATE", "Summary selection is unavailable");
      const subsection = state.subsections.find((row) => row.roleId === seed.roleId);
      const bullets = materializeFinalWording(seed, selection);
      const confirmedExclusion = Boolean(
        subsection?.exclusionAcknowledgedAt &&
        claimExclusions.some((entry) =>
          matchesSeedExclusion(bullets, entry.text, entry.exactExcerpt)
        )
      );
      const itemId = await ctx.db.insert("summaryItems", {
        projectId: generation.projectId,
        generationId: generation._id,
        summaryVersionId,
        roleId: seed.roleId,
        kind: subsection?.kind ?? "standard",
        order,
        seedId: seed._id,
        bullets,
        support: selection.editedBullets ? "writer_asserted" : seed.support,
        tags: seed.tags,
        edited: selection.editedBullets !== undefined,
        ...(seed.uncertaintySeedId ? { uncertaintySeedId: seed.uncertaintySeedId } : {}),
        ...(seed.experimentSeedIds ? { experimentSeedIds: seed.experimentSeedIds } : {}),
        ...(confirmedExclusion ? { confirmedExclusion: true } : {}),
      });
      frozenItems.push({
        _id: itemId,
        itemId,
        roleId: seed.roleId,
        kind: subsection?.kind ?? "standard",
        bullets,
        support: selection.editedBullets ? "writer_asserted" : seed.support,
        ...(seed.uncertaintySeedId ? { uncertaintySeedId: seed.uncertaintySeedId } : {}),
        ...(seed.experimentSeedIds ? { experimentSeedIds: seed.experimentSeedIds } : {}),
        ...(confirmedExclusion ? { confirmedExclusion: true } : {}),
        seedId: seed._id,
      });
    }
    const referencesBySeedId = new Map(
      frozenItems.map((item) => [item.seedId, item.bullets] as const)
    );
    const sourceRefsByItemId = await loadSummarySourceRefs(ctx, generation, frozenItems);
    const payload = await frozenOrderedPayload(ctx, generation, summaryVersionId);
    try {
      for (const section of ["242", "244", "246"] as const) {
        const plan = buildFrozenSummaryPlan({
          section: `s${section}`,
          items: frozenItems,
          skippedRoleIds,
          referencesBySeedId,
          sourceRefsByItemId,
        });
        const ordinaryChecks = summaryOrdinaryAdmission({
          section,
          storylineText: briefDoc.storylineText,
          briefEntries,
          payload,
        });
        summarySelfCheckWorstCaseResponse({
          ordinaryChecks,
          planChecks: plan.checks,
          includeStorylineQuestion:
            briefDoc.storylineText.trim().length > 0 &&
            briefEntries.some(
              (entry) => entry.group === "confidenceMap" && entry.change !== "removed"
            ),
        });
      }
    } catch (error) {
      refuseSummaryCapacity(error);
    }
    await terminateSeedAttempts(ctx, generation._id);
    await bypassSeedEpisodes(ctx, generation._id);
    await ctx.db.insert("seedDecisionEvents", {
      projectId: generation.projectId,
      generationId: generation._id,
      kind: "signOff",
      at: now,
      actorUserId: user._id,
      snapshot: {
        items: await Promise.all(frozenItems.map(async (item) => {
          const selection = activeSelectionRows.find((row) => row.seedId === item.seedId)!;
          return {
            seedId: item.seedId,
            wordingHash: await sha256Text(stableSerialize(item.bullets)),
            selectionVersion: selection.version,
          };
        })),
      },
    });
    await appendGenerationProgress(ctx, generation, [
      `Summary signed off. Drafting ${payload.orderedContext.buildOrder.join(" → ")} in Build Order.`,
    ]);
    await transitionGeneration(ctx, generation, "running", {
      summaryVersionId,
      currentStep: `Drafting ${payload.orderedContext.buildOrder[0]}…`,
      totalCandidates: 1,
      candidatesDone: 0,
      candidatesFailed: 0,
      productionOrder: payload.orderedContext.buildOrder,
      lastProgressAt: now,
    });
    const chain = await createFrozenOrderedChain(
      ctx,
      generation,
      summaryVersionId,
      payload
    );
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    return { summaryVersionId, candidateRunId: chain.candidateRunId };
  },
});

export const beginSummaryRecovery = internalMutation({
  args: {
    generationId: v.id("generations"),
    promptVersion: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      generation.status !== "reserved" ||
      resolveGatedWorkflow(generation) !== "seeds" ||
      !generation.summaryVersionId ||
      !generation.retryOfGenerationId
    ) return false;
    const project = await ctx.db.get(generation.projectId);
    if (!project || project.activeGenerationId !== generation._id) return false;
    if (!generation.sourceIdMap) {
      domainError("INVALID_STATE", "Frozen recovery source map is unavailable");
    }
    const payload = await frozenOrderedPayload(
      ctx,
      generation,
      generation.summaryVersionId
    );
    await assertFrozenSummaryRuntimeAdmission(ctx, generation, payload);
    const now = Date.now();
    await appendGenerationProgress(ctx, generation, [
      `Drafting frozen Summary in ${payload.orderedContext.buildOrder.join(" → ")} Build Order.`,
    ]);
    await transitionGeneration(ctx, generation, "running", {
      promptVersion: args.promptVersion,
      currentStep: `Drafting ${payload.orderedContext.buildOrder[0]}…`,
      productionOrder: payload.orderedContext.buildOrder,
      lastProgressAt: now,
    });
    await createFrozenOrderedChain(
      ctx,
      generation,
      generation.summaryVersionId,
      payload
    );
    await refreshProjectGenerationActivity(ctx, generation.projectId);
    return true;
  },
});

export const recordSeedInitializationFailure = internalMutation({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || resolveGatedWorkflow(generation) !== "seeds" ||
        generation.status !== "running" || generation.summaryVersionId ||
        await isProjectDeleting(ctx, generation.projectId)) return null;
    const project = await ctx.db.get(generation.projectId);
    if (project?.activeGenerationId !== generation._id) return null;
    await ctx.db.patch(generation._id, { seedStageError: SEED_INITIALIZATION_ERROR, currentStep: "Seed preparation needs a retry" });
    return null;
  },
});

export const retryInitializeSeedStage = mutation({
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.generationId);
    if (!existing) domainError("NOT_FOUND", "Generation not found");
    await requireReportEditAccess(ctx, existing.projectId);
    const generation = await requireSeedInitialization(ctx, args.generationId);
    if (generation.status !== "running" || !generation.seedStageError) {
      domainError("INVALID_STATE", "Seed initialization is not waiting for a retry");
    }
    await requireFrozenSeedArtifacts(ctx, generation);
    await ctx.db.patch(generation._id, { seedStageError: undefined, currentStep: "Preparing seeds" });
    await ctx.scheduler.runAfter(0, internal.ai.iterative.resumeSeedInitialization, args);
    return null;
  },
});

/** Reuse path: stamp the reused Brief onto this generation. No new version,
 * no model call. */
export const stampGenerationBriefId = internalMutation({
  args: { generationId: v.id("generations"), briefId: v.id("generationBriefs") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return;
    if (resolveGatedWorkflow(generation) === "seeds") {
      await requireSeedInitialization(ctx, generation._id);
      if (generation.briefId) return;
      if (generation.seedBriefPin !== args.briefId) domainError("INVALID_STATE", "Brief was not pinned at startup");
    }
    await ctx.db.patch(args.generationId, { briefId: args.briefId });
  },
});

/**
 * DW-109/DW-120: record what this generation's Brief stage attempt did. The
 * only writer of `generations.briefOutcome`; called once per stage by
 * `ai/brief.ts:runGenerationBriefStage`. The outcome and its authored progress
 * line commit in one patch, so telemetry and narration never disagree. Never
 * touches `briefId`.
 */
export const recordBriefOutcome = internalMutation({
  args: { generationId: v.id("generations"), outcome: briefOutcomeValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    await appendGenerationProgress(ctx, generation, [
      describeBriefOutcome(args.outcome),
    ]);
    await ctx.db.patch(args.generationId, {
      briefOutcome: args.outcome,
    });
    return null;
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
type BriefCandidateEntry = Infer<typeof briefCandidateEntryValidator>;

/**
 * The one diff key between a Brief version and the next derivation:
 * `(group, sourceContentHash, startOffset, endOffset)`. Shared by
 * `ai/brief.ts:readCompleteBriefDiffBaseline`, which partitions the baseline
 * against the candidates, and `persistDerivedBrief`, which stamps against that
 * partition, so the two can never disagree about which rows match.
 */
export function briefDiffKey(entry: {
  group: string;
  sourceContentHash: string;
  startOffset: number;
  endOffset: number;
}) {
  return `${entry.group}|${entry.sourceContentHash}|${entry.startOffset}|${entry.endOffset}`;
}

/**
 * A stored row as diff-baseline evidence: exactly the fields a removal marker
 * copies, or `null` for a row that is not live derived evidence. A
 * `change: "removed"` row is a version's own history — diffing against it
 * would re-insert the same marker on every later version, forever. A
 * `storylineQuestion` row is a Self-check artifact owned by
 * `briefs.saveEntryEdit`, not derived evidence: carrying it forward would
 * re-emit it as a bogus "removed" marker (DW-118).
 */
function liveBaselinePayload(
  row: Doc<"generationBriefEntries">
): BriefCandidateEntry | null {
  if (row.change === "removed" || row.group === "storylineQuestion") return null;
  return {
    group: row.group,
    text: row.text,
    ...(row.reason !== undefined ? { reason: row.reason } : {}),
    ...(row.confidence !== undefined ? { confidence: row.confidence } : {}),
    sourceId: row.sourceId,
    sourceContentHash: row.sourceContentHash,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    exactExcerpt: row.exactExcerpt,
  };
}

/** The project's newest Brief, whatever its inputsHash or origin: the one
 * version a new derivation diffs against and fences on. A single-row select,
 * so it cannot return a prefix. */
async function newestProjectBrief(
  ctx: { db: QueryCtx["db"] },
  projectId: Id<"projects">
) {
  return await ctx.db
    .query("generationBriefs")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first();
}

/** Pin step of the diff baseline: the project's newest Brief id, or `null`
 * when the project has no Brief yet. */
export const getBriefDiffBaselineId = internalQuery({
  args: { projectId: v.id("projects") },
  returns: v.union(v.id("generationBriefs"), v.null()),
  handler: async (ctx, args) => {
    return (await newestProjectBrief(ctx, args.projectId))?._id ?? null;
  },
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
  args: {
    briefId: v.id("generationBriefs"),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
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
  handler: async (ctx, args) => {
    const numItems = Number.isFinite(args.numItems)
      ? Math.min(MAX_BRIEF_ENTRY_ROWS, Math.max(1, Math.floor(args.numItems)))
      : MAX_BRIEF_ENTRY_ROWS;
    const result = await ctx.db
      .query("generationBriefEntries")
      .withIndex("by_briefId", (q) => q.eq("briefId", args.briefId))
      .paginate({
        cursor: args.cursor,
        numItems,
        maximumBytesRead: BRIEF_BASELINE_PAGE_BYTES,
      });
    const entries: Array<BriefCandidateEntry & { entryId: Id<"generationBriefEntries"> }> = [];
    for (const row of result.page) {
      const payload = liveBaselinePayload(row);
      if (payload !== null) entries.push({ entryId: row._id, ...payload });
    }
    return {
      entries,
      readCount: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      pageStatus: result.pageStatus ?? null,
    };
  },
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
  args: {
    projectId: v.id("projects"),
    generationId: v.id("generations"),
    inputsHash: v.string(),
    origin: v.union(v.literal("writer"), v.literal("derived")),
    seedStartup: v.optional(v.boolean()),
    storylineText: v.string(),
    entries: v.array(briefCandidateEntryValidator),
    // Entries the caller already dropped before reaching here (its own
    // citeQuote pass never found a byte-match — see `brief.ts`). Added to
    // whatever this mutation's own re-validation additionally drops, so
    // `droppedEntryCount` reflects every entry the model proposed that never
    // made it into the Brief.
    upstreamDroppedEntryCount: v.optional(v.number()),
    // The project's newest Brief when the baseline was pinned (`null`: none).
    baselineBriefId: v.union(v.id("generationBriefs"), v.null()),
    // One reference per live key of that Brief that `entries[candidateIndex]`
    // shares — no text.
    baselineRetained: v.array(
      v.object({
        entryId: v.id("generationBriefEntries"),
        candidateIndex: v.number(),
      })
    ),
    // The full payload of each live key of that Brief no candidate shares.
    baselineRemoved: v.array(briefCandidateEntryValidator),
  },
  returns: v.union(v.id("generationBriefs"), v.null()),
  handler: async (ctx, args) => {
    if (await isProjectDeleting(ctx, args.projectId)) {
      domainError("INVALID_STATE", "Project is being deleted");
    }
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.projectId !== args.projectId) {
      domainError("NOT_FOUND", "Generation not found");
    }
    const seedStartup = resolveGatedWorkflow(generation) === "seeds";
    if (seedStartup) {
      await requireSeedInitialization(ctx, generation._id);
      if (!args.seedStartup || generation.seedBriefPin === undefined ||
          generation.seedBriefInputsHash !== args.inputsHash ||
          args.baselineBriefId !== null || args.baselineRetained.length || args.baselineRemoved.length) {
        domainError("INVALID_STATE", "Seed Brief publication must use frozen startup inputs");
      }
      if (generation.briefId) return generation.briefId;
      if (generation.seedBriefPin !== null) domainError("INVALID_STATE", "Pinned Brief cannot be replaced");
    }
    const reusable = await latestBriefForInputs(
      ctx,
      args.projectId,
      args.inputsHash
    );
    let compatibleReusable = false;
    if (reusable) {
      const reusableScope = await briefEntryReadScope(ctx, generation, reusable);
      compatibleReusable = reusableScope === "all" ||
        (await readBriefEntryRowsBounded(ctx, reusable._id, reusableScope)).kind ===
          "complete";
    }
    if (reusable && compatibleReusable && !seedStartup) {
      await ctx.db.patch(args.generationId, { briefId: reusable._id });
      return reusable._id;
    }

    if (!seedStartup) {
      const newest = await newestProjectBrief(ctx, args.projectId);
      if ((newest?._id ?? null) !== args.baselineBriefId) return null;
    }

    let droppedEntryCount = args.upstreamDroppedEntryCount ?? 0;
    const validatedEntries: Array<
      (typeof args.entries)[number]
    > = [];
    // One read per distinct cited source, however many entries cite it.
    const sources = new Map<Id<"generationSources">, Doc<"generationSources"> | null>();
    for (const entry of args.entries) {
      let source = sources.get(entry.sourceId);
      if (source === undefined) {
        source = await ctx.db.get(entry.sourceId);
        sources.set(entry.sourceId, source);
      }
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

    const hasPreviousBrief = args.baselineBriefId !== null;
    type BaselineKey =
      | { retained: (typeof args.baselineRetained)[number] }
      | { removed: BriefCandidateEntry };
    const baselineByKey = new Map<string, BaselineKey>();
    for (const reference of args.baselineRetained) {
      const candidate = Number.isInteger(reference.candidateIndex)
        ? args.entries[reference.candidateIndex]
        : undefined;
      if (candidate === undefined) {
        return domainError(
          "INVALID_STATE",
          `Generation Brief diff baseline reference ${reference.entryId} names candidate ${reference.candidateIndex} of ${args.entries.length}`
        );
      }
      baselineByKey.set(briefDiffKey(candidate), { retained: reference });
    }
    for (const row of args.baselineRemoved) {
      baselineByKey.set(briefDiffKey(row), { removed: row });
    }

    // Stamp every validated entry; each baseline key matches at most once.
    const stampedEntries = validatedEntries.map((entry) => {
      const matched = baselineByKey.delete(briefDiffKey(entry));
      const change = !hasPreviousBrief
        ? undefined
        : matched
          ? ("unchanged" as const)
          : ("added" as const);
      return { entry, change };
    });

    // Whatever's left existed before and doesn't now.
    const markers: BriefCandidateEntry[] = [];
    for (const [key, unmatched] of baselineByKey) {
      if ("removed" in unmatched) {
        markers.push(unmatched.removed);
        continue;
      }
      // Every candidate sharing this key failed re-validation: the old row is
      // a truthful marker, but only if it is what the reference claims.
      const row = await ctx.db.get(unmatched.retained.entryId);
      const payload =
        row && row.briefId === args.baselineBriefId ? liveBaselinePayload(row) : null;
      if (payload === null || briefDiffKey(payload) !== key) {
        return domainError(
          "INVALID_STATE",
          `Generation Brief diff baseline reference ${unmatched.retained.entryId} is not a live row of Brief ${args.baselineBriefId} with its candidate's key`
        );
      }
      markers.push(payload);
    }

    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: args.projectId,
      generationId: args.generationId,
      inputsHash: args.inputsHash,
      version: (reusable?.version ?? 0) + 1,
      origin: args.origin,
      storylineText: args.storylineText,
      droppedEntryCount,
      createdAt: Date.now(),
    });

    for (const { entry, change } of stampedEntries) {
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
    for (const removed of markers) {
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
    const entries = await readBriefEntryRowsOrOmit(ctx, generation, brief);
    // Fail open: an unreadable Brief is omitted whole, exactly as a
    // generation with no briefId renders "" above. Never a prefix.
    if (entries === null) return "";
    return renderBriefBlock(
      brief.storylineText,
      // The same filter `loadBriefCheck` applies, so both prompt readers
      // render exactly the same rows: a re-derivation's change: "removed"
      // markers are history for the diff UI, not guidance in force.
      entries.filter(
        (e) => e.group !== "storylineQuestion" && e.change !== "removed"
      )
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
    if (await isProjectDeleting(ctx, generation.projectId)) return false;
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
    // Story 0 (AD-19): see claimCandidateRun.
    if (await isProjectDeleting(ctx, run.projectId)) {
      console.log("claimSectionRun: project is being deleted; run left unclaimed", {
        projectId: run.projectId,
        generationId: run.generationId,
        section: run.section,
      });
      return null;
    }
    const generation = await ctx.db.get(run.generationId);
    const project = await ctx.db.get(run.projectId);
    if (
      !generation ||
      generation.status !== "running" ||
      !project ||
      project.deletionStartedAt !== undefined ||
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
      project.deletionStartedAt !== undefined ||
      project.activeGenerationId !== generation._id
    ) {
      return;
    }
    await ctx.db.patch(run._id, {
      status: "awaiting_review",
      draftText: args.draftText,
      metrics: args.metrics,
      qa: args.qa,
      // Dual write (2026-09-25): typed copies next to the JSON strings. A
      // redraft replaces both, so a stale typed value never outlives them.
      metricsData: undefined,
      qaData: undefined,
      ...sectionRunTypedFields({ metrics: args.metrics, qa: args.qa }),
      error: undefined,
      completedAt: Date.now(),
    });
    await appendGenerationProgress(ctx, generation, [
      `✓ ${SECTION_TITLES[args.section]} draft ready for review.`,
    ]);
    await transitionGeneration(ctx, generation, "awaiting_input", {
      currentStep: `Review the ${SECTION_TITLES[args.section]} draft`,
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
    if (await isProjectDeleting(ctx, generation.projectId)) return;
    await ctx.db.patch(run._id, {
      status: "failed",
      error: args.error.slice(0, 500),
      completedAt: Date.now(),
    });
    // The generation stays alive in awaiting_input: the writer regenerates
    // the failed section (or cancels) from the stepper.
    if (generation.status === "running") {
      await appendGenerationProgress(ctx, generation, [
        `✗ ${SECTION_TITLES[args.section]} draft failed: ${args.error.slice(0, 200)}.`,
      ]);
      await transitionGeneration(ctx, generation, "awaiting_input", {
        currentStep: `${SECTION_TITLES[args.section]} draft failed`,
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
    if (!project || project.deletionStartedAt !== undefined || project.activeGenerationId !== generation._id) return null;
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
    if (generation?.postQaStatus !== "running") return null;
    return {
      startedAt: generation.postQaStartedAt ?? null,
      // Story 0 (AD-19): the post-QA action's entry reads this and returns
      // without writing when the project entered deletion.
      projectDeleting: await isProjectDeleting(ctx, generation.projectId),
    };
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
      // CAP-18: a signed-off seed run scores in the background under the
      // same frozen calibration and first-person intent its inline QA used
      // to read from the ordered payload (both frozen into brain_blocks at
      // generation start). Other iterative runs keep the live calibration.
      let frozenQaInputs:
        | {
            qaCalibration: string | null;
            qaCalibrationDigestId: Id<"learningDigests"> | null;
            writerFlavor: string | null;
          }
        | undefined;
      const seedOrdered =
        resolveGatedWorkflow(generation) === "seeds" &&
        generation.summaryVersionId !== undefined;
      if (seedOrdered) {
        frozenQaInputs = { qaCalibration: null, qaCalibrationDigestId: null, writerFlavor: null };
      }
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
          if (seedOrdered && parsed && typeof parsed === "object") {
            const artifact = parsed as Partial<FrozenBrainArtifact>;
            frozenQaInputs = {
              qaCalibration:
                typeof artifact.qaCalibration === "string" ? artifact.qaCalibration : null,
              qaCalibrationDigestId:
                typeof artifact.qaCalibrationDigestId === "string"
                  ? artifact.qaCalibrationDigestId
                  : null,
              writerFlavor:
                typeof artifact.writerFlavor === "string" ? artifact.writerFlavor : null,
            };
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
        ...(frozenQaInputs ? { frozenQaInputs } : {}),
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
    // Story 0 (AD-19): a pass that started before the project entered
    // deletion persists nothing — no findings, no status flip. The barrier
    // fences the persistence side as well as the action's entry.
    if (await isProjectDeleting(ctx, generation.projectId)) {
      console.log("saveReportQa: project is being deleted; results discarded", {
        projectId: generation.projectId,
        generationId: generation._id,
      });
      return;
    }
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
          await transitionPostQa(ctx, generation, "failed", {
            postQaCompletedAt: Date.now(),
          });
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
      await appendGenerationProgress(ctx, generation, [
        "Post-assembly QA pass failed — the report is unaffected.",
      ]);
      await transitionPostQa(ctx, generation, "failed", {
        agentOutputs: JSON.stringify(outputs),
        postQaCompletedAt: Date.now(),
      });
      return;
    }
    await appendGenerationProgress(ctx, generation, [
      `✓ QA scorecard ready${args.qaScore !== undefined ? ` (${args.qaScore}/100)` : ""}.`,
    ]);
    await transitionPostQa(ctx, generation, "done", {
      agentOutputs: JSON.stringify(outputs),
      postQaCompletedAt: Date.now(),
      ...(args.qaScore !== undefined ? { qaScore: args.qaScore } : {}),
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
    await transitionPostQa(ctx, generation, "running", {
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
      // Typed fields first, the JSON strings for rows without them;
      // legacy or malformed values stay null.
      const metrics = parseSectionMeter(sectionRunMetrics(run));
      const qa = sectionRunQa(run);
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

    const seedRow = resolveGatedWorkflow(generation) === "seeds"
      ? await ctx.db.query("seedSubsections").withIndex("by_generationId", q => q.eq("generationId", generation._id)).first()
      : null;
    const modelLabel = runs[0]?.label ?? null;
    return {
      status: generation.status,
      candidateMode: "iterative" as const,
      gatedWorkflow: resolveGatedWorkflow(generation),
      seedPhase: resolveSeedPhase(generation, seedRow !== null),
      seedStageError: generation.seedStageError ? SEED_INITIALIZATION_ERROR : undefined,
      modelLabel,
      error: userSafeStoredError(
        generation.error,
        "The generation did not complete. Try again."
      ),
      // Narrates the pre-fan-out wait (analyzer + Brain) in the stepper.
      progressLog: (await readGenerationProgress(ctx, generation)).map(userSafeNarration),
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

    if (resolveGatedWorkflow(generation) !== "sections") {
      domainError("INVALID_STATE", "Section operations are unavailable during seed preparation");
    }
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
      await appendGenerationProgress(ctx, generation, [
        `✓ ${SECTION_TITLES[args.section]} approved by the writer.`,
        `Drafting ${SECTION_TITLES[nextSection]}…`,
      ]);
      await transitionGeneration(ctx, generation, "running", {
        // startedAt marks the start of THIS drafting phase so the stale-run
        // reaper measures drafting time, not total writer review time.
        startedAt: now,
        currentStep: `Drafting ${SECTION_TITLES[nextSection]}…`,
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
    // Every mode ends with a scorecard: run QA + chronology over the
    // assembled sections in the background (feeds the learning loops). The
    // pass starts in the same write that completes the generation.
    await appendGenerationProgress(ctx, generation, [
      `✓ ${SECTION_TITLES.s246} approved by the writer.`,
      "✓ Report assembled from the approved sections.",
      "Running the QA scorecard and chronology in the background…",
    ]);
    await transitionGeneration(ctx, generation, "completed", {
      currentStep: "Complete",
      agentOutputs,
      completedAt: doneAt,
      postQaStatus: "running",
      postQaStartedAt: doneAt,
    });
    await refreshProjectGenerationActivity(ctx, generation.projectId);
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

    if (resolveGatedWorkflow(generation) !== "sections") {
      domainError("INVALID_STATE", "Section operations are unavailable during seed preparation");
    }
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
    await appendGenerationProgress(ctx, generation, [
      `Redrafting ${SECTION_TITLES[args.section]}${guidance ? " with writer guidance" : ""}…`,
    ]);
    await transitionGeneration(ctx, generation, "running", {
      startedAt: now,
      currentStep: `Redrafting ${SECTION_TITLES[args.section]}…`,
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
    if (resolveGatedWorkflow(generation) === "seeds") {
      await requireReportEditAccess(ctx, generation.projectId);
      await terminateSeedAttempts(ctx, generation._id);
      await bypassSeedEpisodes(ctx, generation._id);
      await ctx.db.insert("seedDecisionEvents", {
        projectId: generation.projectId, generationId: generation._id,
        kind: "cancel", at: Date.now(), actorUserId: (await requireCurrentUser(ctx))._id,
      });
    }
    const now = Date.now();
    await transitionGeneration(ctx, generation, "failed", {
      currentStep: "Cancelled",
      error: "Cancelled by writer",
      completedAt: now,
    });
    const signedOffSeedDraft =
      resolveGatedWorkflow(generation) === "seeds" &&
      generation.summaryVersionId !== undefined;
    if (signedOffSeedDraft) {
      await terminalizeOrphanedCandidateRuns(
        ctx,
        generation._id,
        "The generation was cancelled before this draft completed."
      );
      await terminalizeSignedOffSeedSections(
        ctx,
        generation._id,
        "The generation was cancelled before this section draft completed."
      );
    }
    // Ghost/section jobs still scheduled become no-ops: their claim fences
    // require an active generation + project pointer. Candidate artifacts are
    // still removed by the existing cancellation contract.
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


/** Drain lease-expired seed attempts in bounded pages under the existing cron owner. */
export const reapSeedBatchPage = internalMutation({
  args: { status: v.union(v.literal("queued"), v.literal("running")), cutoff: v.number(), pageSize: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const pageSize = Math.min(50, Math.max(1, Math.floor(args.pageSize ?? 50)));
    const page = await reapSeedAttempts(ctx, { ...args, cursor: null, pageSize });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.generations.reapSeedBatchPage, { status: args.status, cutoff: args.cutoff, pageSize });
    return null;
  },
});

/** Page size for the running-generation scan: one page of `generations` in
 * "running" older than the cutoff per transaction. Tests override it through
 * `pageSize`. */
export const STALE_GENERATION_SCAN_PAGE_SIZE = 100;

/** The one `staleGenerationScans` row: the scan owner record. */
const STALE_SCAN_KEY = "stale_generations";

async function staleScanRecord(ctx: MutationCtx) {
  return await ctx.db
    .query("staleGenerationScans")
    .withIndex("by_key", (q) => q.eq("key", STALE_SCAN_KEY))
    .unique();
}

const staleScanResultValidator = v.object({
  failed: v.number(),
  orphanedRuns: v.number(),
  scanned: v.number(),
  isDone: v.boolean(),
  projectSweepJobId: v.optional(v.id("_scheduled_functions")),
  skipped: v.optional(
    v.union(v.literal("scan_in_progress"), v.literal("stale_continuation"))
  ),
});
type StaleScanResult = Infer<typeof staleScanResultValidator>;

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
  args: {
    olderThanMinutes: v.optional(v.number()),
    // Continuation pages only: the first page's cutoff (kept stable so the
    // cursor stays valid for the same index range), where to resume, and the
    // scan sequence number this page belongs to.
    cutoff: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    scan: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  // Declared so the function's type never depends on handler inference: the
  // handler schedules a sibling function from this module (and itself), and
  // inferring the return type through that reference would be circular.
  returns: staleScanResultValidator,
  handler: async (ctx, args): Promise<StaleScanResult> => {
    const cutoff =
      args.cutoff ?? Date.now() - (args.olderThanMinutes ?? 30) * 60 * 1000;
    const firstPage = args.cursor === undefined;
    const skipped = (reason: "scan_in_progress" | "stale_continuation") => ({
      failed: 0,
      orphanedRuns: 0,
      scanned: 0,
      isDone: false,
      skipped: reason,
    });
    const owner = await staleScanRecord(ctx);
    let scan: number;
    let ownerId: Id<"staleGenerationScans">;
    if (firstPage) {
      const continuation = owner?.continuationJobId
        ? await ctx.db.system.get("_scheduled_functions", owner.continuationJobId)
        : null;
      if (
        continuation &&
        (continuation.state.kind === "pending" || continuation.state.kind === "inProgress")
      ) {
        return skipped("scan_in_progress");
      }
      // Take ownership: the next sequence number, no pending page yet.
      scan = (owner?.scan ?? 0) + 1;
      const now = Date.now();
      if (owner) {
        ownerId = owner._id;
        await ctx.db.patch(owner._id, {
          scan,
          cutoff,
          continuationJobId: undefined,
          startedAt: now,
          updatedAt: now,
        });
      } else {
        ownerId = await ctx.db.insert("staleGenerationScans", {
          key: STALE_SCAN_KEY,
          scan,
          cutoff,
          startedAt: now,
          updatedAt: now,
        });
      }
    } else {
      if (!owner || args.scan === undefined || owner.scan !== args.scan) {
        return skipped("stale_continuation");
      }
      scan = args.scan;
      ownerId = owner._id;
    }
    if (firstPage) {
      for (const status of ["queued", "running"] as const) {
        await ctx.scheduler.runAfter(0, internal.generations.reapSeedBatchPage, { status, cutoff: Date.now() });
      }
    }
    // A caller may shrink the page (tests) but never grow it past the bound.
    const pageSize = Math.min(
      Math.max(1, Math.floor(args.pageSize ?? STALE_GENERATION_SCAN_PAGE_SIZE)),
      STALE_GENERATION_SCAN_PAGE_SIZE
    );
    // Reserved rows never stamp progress, so every one selected here is
    // failed below and leaves the range: one page per cron run drains them.
    const reserved = firstPage
      ? await ctx.db
          .query("generations")
          .withIndex("by_status_and_startedAt", (q) =>
            q.eq("status", "reserved").lt("startedAt", cutoff)
          )
          .take(100)
      : [];
    const runningPage = await ctx.db
      .query("generations")
      .withIndex("by_status_and_startedAt", (q) =>
        q.eq("status", "running").lt("startedAt", cutoff)
      )
      .paginate({ numItems: pageSize, cursor: args.cursor ?? null });
    const stale = [...reserved, ...runningPage.page];
    let failed = 0;
    for (const generation of stale) {
      const signedOffSeedDrafting =
        generation.status === "running" &&
        resolveGatedWorkflow(generation) === "seeds" &&
        generation.summaryVersionId !== undefined;
      if (generation.status === "running" && resolveGatedWorkflow(generation) === "seeds" && !generation.summaryVersionId) {
        if (!await isProjectDeleting(ctx, generation.projectId)) {
          const project = await ctx.db.get(generation.projectId);
          if (project?.activeGenerationId === generation._id) {
            await ctx.db.patch(generation._id, { seedStageError: SEED_INITIALIZATION_ERROR, currentStep: "Seed preparation needs a retry" });
          }
        }
        continue;
      }
      // Iterative generations in "running" mean ONE section is drafting; a
      // stale section run fails alone and hands control back to the writer
      // (awaiting_input → regenerate), never killing the whole run. Note the
      // reaper deliberately skips awaiting_input generations entirely —
      // writer thinking time is unbounded.
      if (
        generation.status === "running" &&
        (generation.candidateMode ?? "compare") === "iterative" &&
        !signedOffSeedDrafting
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
          await appendGenerationProgress(ctx, generation, [
            "✗ Section draft timed out. Use Regenerate to retry.",
          ]);
          await transitionGeneration(ctx, generation, "awaiting_input", {
            currentStep: "Section draft timed out — regenerate to retry",
          });
          await refreshProjectGenerationActivity(ctx, generation.projectId);
          failed += 1;
          continue;
        }
      }
      // DW-119 (progress-aware recovery): an ordered single/compare chain
      // stamps lastProgressAt when a section run is created, claimed or
      // drafted, so a slow but live chain is aged from its last progress,
      // not from startedAt. A chain whose current action died (timeout,
      // deploy restart) stops stamping and is failed here once the same
      // window elapses from that last stamp — a single stuck action is still
      // reaped. Iterative never stamps and keeps its per-section path above.
      if (
        generation.status === "running" &&
        ((generation.candidateMode ?? "compare") !== "iterative" ||
          signedOffSeedDrafting) &&
        generation.lastProgressAt !== undefined &&
        generation.lastProgressAt >= cutoff
      ) {
        continue;
      }
      failed += 1;
      await transitionGeneration(ctx, generation, "failed", {
        currentStep: "Failed",
        error: "Timed out before generation completed.",
        completedAt: Date.now(),
      });
      // In-flight candidate runs die with the generation — otherwise they
      // read "running" forever (skewed stats, invisible to retry).
      if (signedOffSeedDrafting) {
        await terminalizeSignedOffSeedSections(
          ctx,
          generation._id,
          "Timed out before the section draft completed."
        );
      }
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

    if (!runningPage.isDone) {
      // Failed rows have left the "running" range and live rows stay in it,
      // but the cursor is an index position rather than an offset, so the
      // next page resumes exactly after the last row read here. The owner
      // record names the new page in the same transaction that schedules it.
      const continuationJobId = await ctx.scheduler.runAfter(
        0,
        internal.generations.failStaleGenerations,
        {
          cutoff,
          cursor: runningPage.continueCursor,
          scan,
          ...(args.pageSize !== undefined ? { pageSize } : {}),
        }
      );
      await ctx.db.patch(ownerId, { continuationJobId, updatedAt: Date.now() });
    } else {
      // The scan's last page: release ownership.
      await ctx.db.patch(ownerId, { continuationJobId: undefined, updatedAt: Date.now() });
    }
    const scanned = runningPage.page.length;
    if (!firstPage) {
      return { failed, orphanedRuns: 0, scanned, isDone: runningPage.isDone };
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
    return { failed, orphanedRuns, scanned, isDone: runningPage.isDone, projectSweepJobId };
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
      await appendGenerationProgress(ctx, generation, [
        "Post-assembly QA pass timed out — the report is unaffected. Run it again from the QA panel.",
      ]);
      await transitionPostQa(ctx, generation, "failed", {
        postQaCompletedAt: Date.now(),
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
    // A child row, not a rewrite of the live generation row (2026-09-25).
    await appendGenerationProgress(ctx, gen, [args.line]);
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
    if (await isProjectDeleting(ctx, generation.projectId)) return null;
    if (resolveGatedWorkflow(generation) === "seeds") {
      const project = await ctx.db.get(generation.projectId);
      if (generation.status !== "running" || project?.activeGenerationId !== generation._id) return null;
    }
    if (resolveGatedWorkflow(generation) === "seeds" && generation.writerSettings) return null;
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
    if (await isProjectDeleting(ctx, generation.projectId)) return;
    // Any other move the transition table does not declare for this row's
    // flow is refused (INVALID_TRANSITION) rather than written.
    await transitionGeneration(ctx, generation, args.status, {
      ...(args.currentStep !== undefined ? { currentStep: args.currentStep } : {}),
      ...(args.agentOutputs !== undefined ? { agentOutputs: args.agentOutputs } : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
      ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
    });
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
    await transitionGeneration(ctx, generation, "completed", {
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

/** The most comments getModelComments returns, newest first. */
const MODEL_COMMENT_LIMIT = 50;
/** The most score rows getModelComments reads for one model. */
const MODEL_COMMENT_SCAN_LIMIT = 2_000;

export const getModelComments = internalQuery({
  args: { model: v.string() },
  handler: async (ctx, args) => {
    // Newest first through the model's own index range, stopping at 50
    // comments; rows without a comment are skipped, and the scan is bounded
    // so a model with many uncommented scores cannot read without limit.
    const comments: Array<{ comment: string; score: number }> = [];
    let scanned = 0;
    for await (const score of ctx.db
      .query("candidateScores")
      .withIndex("by_model_and_updatedAt", (q) => q.eq("model", args.model))
      .order("desc")) {
      scanned += 1;
      if (score.comment) comments.push({ comment: score.comment, score: score.score });
      if (comments.length >= MODEL_COMMENT_LIMIT || scanned >= MODEL_COMMENT_SCAN_LIMIT) break;
    }
    return comments;
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
// sections is recovered by the existing failStaleGenerations reaper, which
// ages the generation from lastProgressAt (DW-119) — stamped by the three
// chain mutations below — rather than from startedAt.

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

/** A Self-check summary's status and plan coverage, from the typed value or
 * its JSON string; null when neither carries a status. */
function selfCheckResultOf(selfCheck: unknown): {
  status: string;
  planCoverage?: "complete" | "incomplete" | "unavailable";
} | null {
  let parsed: unknown = selfCheck;
  if (typeof selfCheck === "string") {
    try {
      parsed = JSON.parse(selfCheck);
    } catch {
      return null;
    }
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("status" in parsed) ||
    typeof parsed.status !== "string"
  ) {
    return null;
  }
  if (
    "planCoverage" in parsed &&
    parsed.planCoverage &&
    typeof parsed.planCoverage === "object" &&
    "status" in parsed.planCoverage &&
    (parsed.planCoverage.status === "complete" ||
      parsed.planCoverage.status === "incomplete" ||
      parsed.planCoverage.status === "unavailable")
  ) {
    return {
      status: parsed.status,
      planCoverage: parsed.planCoverage.status,
    };
  }
  return { status: parsed.status };
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
  if (!project || project.deletionStartedAt !== undefined || project.activeGenerationId !== generation._id) return null;
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
    if ((fence.generation.candidateMode ?? "compare") === "iterative") {
      if (
        resolveGatedWorkflow(fence.generation) !== "seeds" ||
        !fence.generation.summaryVersionId ||
        args.payload.summaryVersionId !== fence.generation.summaryVersionId
      ) return false;
    }
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
    await appendGenerationProgress(ctx, fence.generation, [
      `${fence.run.label}: drafting ${order.join(" → ")} in order; each section is Self-checked before it is shown.`,
    ]);
    await ctx.db.patch(fence.generation._id, {
      lastProgressAt: now,
    });
    // The payload travels once, into this row; every scheduled step of the
    // chain receives its id (2026-09-25).
    const payloadId = await persistOrderedPayload(
      ctx,
      fence.generation._id,
      fence.run._id,
      args.payload
    );
    await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.generateOrderedSection, {
      generationId: args.generationId,
      candidateRunId: args.candidateRunId,
      section: order[0],
      payloadId,
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
  const summary = generation.summaryVersionId
    ? await ctx.db.get(generation.summaryVersionId)
    : null;
  const isSummaryConsumer =
    resolveGatedWorkflow(generation) === "seeds" &&
    generation.summaryVersionId !== undefined;
  if (
    isSummaryConsumer &&
    (!summary ||
      summary.projectId !== generation.projectId ||
      summary.originGenerationId !== (generation.originGenerationId ?? generation._id))
  ) {
    domainError("INVALID_STATE", "Frozen Summary Brief lineage is unavailable", {
      reason: "SUMMARY_BRIEF_UNREADABLE",
    });
  }
  const briefId = isSummaryConsumer ? summary?.briefVersionId : generation.briefId;
  const briefDoc = briefId ? await ctx.db.get(briefId) : null;
  if (!briefDoc || briefDoc.projectId !== generation.projectId) {
    if (isSummaryConsumer) {
      domainError("INVALID_STATE", "Frozen Summary Brief is unavailable", {
        reason: "SUMMARY_BRIEF_UNREADABLE",
      });
    }
    return { briefBlock: "", brief: null, briefDoc: null, briefEntries: [] };
  }
  const read = await readBriefEntryRowsBounded(
    ctx,
    briefDoc._id,
    await briefEntryReadScope(ctx, generation, briefDoc)
  );
  if (read.kind !== "complete") {
    if (isSummaryConsumer) {
      domainError("INVALID_STATE", "Frozen Summary Brief cannot be read completely", {
        reason:
          read.kind === "row_limit"
            ? "SUMMARY_BRIEF_ROWS_EXCEEDED"
            : "SUMMARY_BRIEF_BYTES_EXCEEDED",
      });
    }
    // Legacy Brief guidance remains optional and fail-open.
    console.error(
      read.kind === "row_limit"
        ? `Generation Brief omitted from generation ${generation._id}: Brief ${briefDoc._id} has more than ${MAX_BRIEF_ENTRY_ROWS} entries and cannot be read completely`
        : `Generation Brief omitted from generation ${generation._id}: Brief ${briefDoc._id} cannot be read completely within ${BRIEF_CONSUMER_READ_BYTES} bytes`
    );
    return { briefBlock: "", brief: null, briefDoc: null, briefEntries: [] };
  }
  const rows = read.rows;
  const entries = rows.filter(
    // A re-derivation carries the previous version's dropped entries as
    // change: "removed" markers for the diff; they are no longer in force.
    (entry) => entry.group !== "storylineQuestion" && entry.change !== "removed"
  );
  // Brief and Seed citations share the same immutable origin-to-current
  // resolver. Recovery never substitutes equal hashes for source identity.
  for (const sourceId of new Set(entries.map((entry) => entry.sourceId as string))) {
    resolveFrozenSourceId(sourceId, generation.sourceIdMap);
  }
  return {
    briefBlock: renderBriefBlock(briefDoc.storylineText, entries),
    briefDoc,
    briefEntries: rows,
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

async function loadFrozenSectionPlan(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  section: SectionNumber
): Promise<{
  planBlock: string;
  planChecksBlock: string;
  planChecks: Array<{
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
  }>;
}> {
  if (!generation.summaryVersionId) {
    return { planBlock: "", planChecksBlock: "", planChecks: [] };
  }
  const summary = await ctx.db.get(generation.summaryVersionId);
  if (!summary || summary.projectId !== generation.projectId) {
    domainError("INVALID_STATE", "Frozen Summary is unavailable");
  }
  const originGenerationId = generation.originGenerationId ?? generation._id;
  if (summary.originGenerationId !== originGenerationId) {
    domainError("INVALID_STATE", "Frozen Summary lineage does not match the generation");
  }
  const items = await ctx.db.query("summaryItems")
    .withIndex("by_summaryVersionId_and_order", (q) =>
      q.eq("summaryVersionId", summary._id))
    .take(SEED_DECISION_COLLECTION_ROWS + 1);
  if (items.length > SEED_DECISION_COLLECTION_ROWS) {
    domainError("INVALID_INPUT", "Frozen Summary exceeds the drafting budget");
  }
  const referencesBySeedId = new Map(
    items.map((item) => [item.seedId, item.bullets] as const)
  );
  const sourceRefsByItemId = await loadSummarySourceRefs(ctx, generation, items);
  const pdSection = section === "242" ? "s242" : section === "244" ? "s244" : "s246";
  const plan = buildFrozenSummaryPlan({
    section: pdSection,
    items: items.map((item) => ({
      itemId: item._id,
      roleId: item.roleId,
      kind: item.kind,
      bullets: item.bullets,
      support: item.support,
      ...(item.uncertaintySeedId
        ? { uncertaintySeedId: item.uncertaintySeedId }
        : {}),
      ...(item.experimentSeedIds
        ? { experimentSeedIds: item.experimentSeedIds }
        : {}),
      ...(item.confirmedExclusion ? { confirmedExclusion: true } : {}),
    })),
    skippedRoleIds: summary.skippedRoleIds,
    referencesBySeedId,
    sourceRefsByItemId,
  });
  return {
    planBlock: `\n\n${plan.block}`,
    planChecksBlock: plan.checksBlock,
    planChecks: plan.checks.map((check) => ({
      ...(check.itemId ? { itemId: check.itemId } : {}),
      ...(check.skippedRoleId ? { skippedRoleId: check.skippedRoleId } : {}),
      roleId: check.roleId,
      mergedItemIds: check.mergedItemIds,
      instruction: check.instruction,
      confirmedExclusion: check.confirmedExclusion,
      ...(check.support ? { support: check.support } : {}),
      wording: check.wording,
      relationshipReferences: check.relationshipReferences,
      sourceReferences: check.sourceReferences,
    })),
  };
}

/**
 * Recovery admission for the deployment that will execute the frozen
 * Summary. Both provider-input and complete-output capacity are checked for
 * every Section before the chain is created or any provider can run.
 */
async function assertFrozenSummaryRuntimeAdmission(
  ctx: MutationCtx,
  generation: Doc<"generations">,
  payload: OrderedPayload
): Promise<Awaited<ReturnType<typeof loadBriefCheck>>> {
  const loadedBrief = await loadBriefCheck(ctx, generation);
  if (!loadedBrief.briefDoc || !loadedBrief.brief) {
    domainError("INVALID_STATE", "Frozen Summary Brief is unavailable", {
      reason: "SUMMARY_BRIEF_UNREADABLE",
    });
  }
  try {
    for (const section of ["242", "244", "246"] as const) {
      const plan = await loadFrozenSectionPlan(ctx, generation, section);
      const ordinaryChecks = summaryOrdinaryAdmission({
        section,
        storylineText: loadedBrief.briefDoc.storylineText,
        briefEntries: loadedBrief.briefEntries,
        payload,
      });
      summarySelfCheckWorstCaseResponse({
        ordinaryChecks,
        planChecks: plan.planChecks,
        includeStorylineQuestion:
          loadedBrief.briefDoc.storylineText.trim().length > 0 &&
          loadedBrief.briefEntries.some(
            (entry) =>
              entry.group === "confidenceMap" && entry.change !== "removed"
          ),
      });
    }
  } catch (error) {
    refuseSummaryCapacity(error);
  }
  return loadedBrief;
}

async function loadSummarySourceRefs(
  ctx: { db: QueryCtx["db"] },
  generation: Doc<"generations">,
  items: ReadonlyArray<{
    _id: Id<"summaryItems">;
    seedId: Id<"seeds">;
  }>
) {
  const result = new Map<
    Id<"summaryItems">,
    Array<{ sourceId: string; exactExcerpt: string }>
  >();
  for (const item of items) {
    const rows = await ctx.db.query("seedProvenance")
      .withIndex("by_seedId", (q) => q.eq("seedId", item.seedId))
      .take(129);
    if (rows.length > 128) {
      domainError("INVALID_INPUT", "Seed provenance exceeds the drafting budget");
    }
    result.set(item._id, rows.map((row) => {
      if (row.projectId !== generation.projectId) {
        domainError("INVALID_STATE", "Seed provenance belongs to another project");
      }
      resolveFrozenSourceId(row.sourceId, generation.sourceIdMap);
      return {
        // Keep the immutable origin id in provider bytes. The resolver above
        // validates its current attempt row without making retries differ.
        sourceId: row.sourceId,
        exactExcerpt: row.exactExcerpt,
      };
    }));
  }
  return result;
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
    promptVersion: v.optional(v.string()),
    payload: v.optional(orderedPayloadValidator),
    payloadId: v.optional(v.id("generationArtifacts")),
  },
  handler: async (ctx, args) => {
    const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
    if (!row || row.status !== "queued" || row.generationId !== args.generationId) {
      return null;
    }
    const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
    if (!fence) return null;
    let executionBrief:
      | Awaited<ReturnType<typeof loadBriefCheck>>
      | undefined;
    if (
      resolveGatedWorkflow(fence.generation) === "seeds" &&
      fence.generation.summaryVersionId !== undefined &&
      args.promptVersion &&
      fence.generation.promptVersion !== args.promptVersion
    ) {
      // Capacity belongs to the program that will execute the request. A
      // prior sign-off or recovery-start admission cannot authorize a newer
      // deployment. Any rejection rolls this claim back atomically.
      const payload = await resolveOrderedPayload(ctx, args.generationId, args);
      if (!payload) {
        domainError("INVALID_STATE", "Frozen Summary execution payload is unavailable");
      }
      executionBrief = await assertFrozenSummaryRuntimeAdmission(
        ctx,
        fence.generation,
        payload
      );
    }
    const orderIndex = row.orderIndex ?? 0;
    // Stopped between sections (AD-24): this section is never drafted and
    // the action finalizes what was. The first section is always drafted, so
    // a stopped generation still has something to assemble.
    if (fence.generation.stopRequestedAt !== undefined && orderIndex > 0) {
      await ctx.db.patch(row._id, { status: "pending" });
      return { stopped: true as const };
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "running", startedAt: now });
    // DW-119: the claim is chain progress — the reaper's window restarts here.
    await ctx.db.patch(fence.generation._id, {
      lastProgressAt: now,
      ...(resolveGatedWorkflow(fence.generation) === "seeds" &&
      fence.generation.summaryVersionId !== undefined &&
      args.promptVersion
        ? { promptVersion: args.promptVersion }
        : {}),
    });
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

    return await orderedSectionClaim(ctx, {
      generation: fence.generation,
      row,
      section: args.section,
      priorSections,
      executionBrief,
    });
  },
});

/** The drafting input one claimed Section receives: shared by the ordered
 * chain's claim and the seed redraft's claim so both draft the same way. */
async function orderedSectionClaim(
  ctx: MutationCtx,
  args: {
    generation: Doc<"generations">;
    row: Doc<"generationSectionRuns">;
    section: SectionNumber;
    priorSections: Array<{ section: SectionNumber; text: string }>;
    executionBrief?: Awaited<ReturnType<typeof loadBriefCheck>>;
  }
) {
  const orderIndex = args.row.orderIndex ?? 0;
  const [{ briefBlock, brief }, plan] = await Promise.all([
    args.executionBrief ?? loadBriefCheck(ctx, args.generation),
    loadFrozenSectionPlan(ctx, args.generation, args.section),
  ]);
  return {
    projectId: args.generation.projectId,
    model: args.row.model,
    label: args.row.label,
    requestedBy: args.generation.requestedBy,
    lengthTarget: args.generation.lengthTarget ?? "standard",
    orderIndex,
    isFirstInOrder: orderIndex === 0,
    priorSections: args.priorSections,
    briefBlock,
    brief,
    ...plan,
  };
}

const storylineQuestionValidator = v.object({
  question: v.string(),
  sectionClaim: v.string(),
  storylineAlternative: v.string(),
  evidenceEntryId: v.id("generationBriefEntries"),
});

/** A drafted Section's Compliance Note rows and at most one Storyline
 * question, written for the chain and the seed redraft alike. */
async function persistSectionNotes(
  ctx: MutationCtx,
  args: {
    generation: Doc<"generations">;
    run: Doc<"generationCandidateRuns">;
    section: SectionNumber;
    notes: Array<Infer<typeof complianceNoteDraftValidator>>;
    storylineQuestion?: Infer<typeof storylineQuestionValidator>;
    now: number;
  }
) {
  const owner = {
    projectId: args.generation.projectId,
    generationId: args.generation._id,
    candidateRunId: args.run._id,
  };
  for (const note of args.notes) {
    // A section's rows belong to that section only.
    if (note.section !== args.section) continue;
    await ctx.db.insert("complianceNotes", complianceNoteRow(note, owner));
  }
  // AD-23/AD-25: the chain's one write outside complianceNotes. The
  // question cites the Confidence Map entry the section's stronger evidence
  // rests on, so it carries a byte-validated citation like every entry.
  if (args.storylineQuestion && args.generation.briefId) {
    const evidence = await ctx.db.get(args.storylineQuestion.evidenceEntryId);
    if (
      evidence &&
      evidence.briefId === args.generation.briefId &&
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
        generatedOutput: true,
        createdAt: args.now,
      });
    }
  }
}

/** A chain step must name its payload in one of the two forms. */
function requireOrderedPayloadRef(args: {
  payload?: OrderedPayload;
  payloadId?: Id<"generationArtifacts">;
}): void {
  if (!args.payload && !args.payloadId) {
    domainError("INVALID_INPUT", "The ordered chain step names no payload");
  }
}

/** The chain payload a scheduled action was handed by id (2026-09-25). */
export const getOrderedPayload = internalQuery({
  args: {
    generationId: v.id("generations"),
    payloadId: v.id("generationArtifacts"),
  },
  returns: v.union(orderedPayloadValidator, v.null()),
  handler: async (ctx, args) => {
    return await loadOrderedPayload(ctx, args.generationId, args.payloadId);
  },
});

/** A drafted Section's result columns: the JSON strings as the action sent
 * them, and their typed copies (dual write, 2026-09-25). Every typed field is
 * reset first so a redraft never keeps an earlier attempt's typed value. */
function orderedSectionResultFields(args: {
  metrics: string;
  selfCheck: string;
  slotCounts: string;
}) {
  return {
    metrics: args.metrics,
    selfCheck: args.selfCheck,
    slotCounts: args.slotCounts,
    metricsData: undefined,
    selfCheckData: undefined,
    slotCountsData: undefined,
    ...sectionRunTypedFields(args),
  };
}

/** The progress-log label of a drafted Section's Self-check outcome. */
function sectionCheckNarration(selfCheck: string): string {
  const result = selfCheckResultOf(selfCheck);
  const status = result?.status;
  // The intent's flag wording for a repair that did not clear the check.
  const checkLabel =
    status === "repair_failed"
      ? "Self-check repair failed"
      : `Self-check: ${status?.replace(/_/g, " ") ?? "recorded"}`;
  const coverageLabel = result?.planCoverage
    ? `; plan coverage ${result.planCoverage}`
    : "";
  return `${checkLabel}${coverageLabel}`;
}

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
    storylineQuestion: v.optional(storylineQuestionValidator),
    // The chain's payload row (2026-09-25); `payload` for chains scheduled
    // before it was stored. One of the two is required.
    payload: v.optional(orderedPayloadValidator),
    payloadId: v.optional(v.id("generationArtifacts")),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    requireOrderedPayloadRef(args);
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
      ...orderedSectionResultFields(args),
      error: undefined,
      completedAt: now,
    });
    await persistSectionNotes(ctx, {
      generation: fence.generation,
      run: fence.run,
      section: args.section,
      notes: args.notes,
      storylineQuestion: args.storylineQuestion,
      now,
    });
    await appendGenerationProgress(ctx, fence.generation, [
      `✓ ${fence.run.label}: ${ORDERED_SECTION_TITLES[args.section]} drafted (${sectionCheckNarration(args.selfCheck)}).`,
    ]);
    await ctx.db.patch(fence.generation._id, {
      // DW-119: a drafted section (and the next one scheduled below) is
      // chain progress; the reaper's window restarts here.
      lastProgressAt: now,
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
        ...forwardOrderedPayload(args),
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeOrderedCandidate, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        ...forwardOrderedPayload(args),
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
    // Present when the chain action can finalize: a stopped seed run then
    // keeps its drafted Sections instead of failing (FR-43). `payloadId` is
    // the chain's stored payload (2026-09-25); `payload` the older form.
    payload: v.optional(orderedPayloadValidator),
    payloadId: v.optional(v.id("generationArtifacts")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Fenced like every other chain write: a stale call (the candidate run,
    // generation or project pointer already moved on) must not overwrite
    // rows a newer owner may be writing; the reaper covers recovery instead.
    const fence = await orderedChainFence(ctx, args.generationId, args.candidateRunId);
    if (!fence) return null;
    const now = Date.now();
    const rows = await orderedRunsForCandidate(ctx, fence.run._id);
    // A Section that fails after the writer stopped a signed-off seed run
    // does not throw away the Sections already drafted: it is marked not
    // drafted and the stopped draft is assembled from what exists.
    if (
      (args.payload || args.payloadId) &&
      fence.generation.stopRequestedAt !== undefined &&
      resolveGatedWorkflow(fence.generation) === "seeds" &&
      fence.generation.summaryVersionId !== undefined &&
      rows.some((row) => row.status === "drafted")
    ) {
      for (const row of rows) {
        if (row.generationId !== args.generationId) continue;
        if (row.section === sectionKeyOf(args.section) && row.status === "running") {
          await ctx.db.patch(row._id, {
            status: "failed",
            error: args.error.slice(0, 500),
            completedAt: now,
          });
        } else if (row.status === "queued") {
          await ctx.db.patch(row._id, { status: "pending" });
        }
      }
      await appendGenerationProgress(ctx, fence.generation, [
        `✗ ${fence.run.label}: ${ORDERED_SECTION_TITLES[args.section]} failed after the stop; the drafted Sections are kept.`,
      ]);
      await ctx.db.patch(fence.generation._id, {
        lastProgressAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeOrderedCandidate, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        ...forwardOrderedPayload(args),
      });
      return null;
    }
    for (const row of rows) {
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
    await appendGenerationProgress(ctx, fence.generation, [
      `✓ ${fence.run.label}: consistency pass over the assembled draft (${findings} finding(s)).`,
    ]);
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
        // The finalizer still takes JSON strings: the stored string, or the
        // typed value serialized for a row that only has that.
        metrics: sectionRunJson(row, "metrics"),
        selfCheck: sectionRunJson(row, "selfCheck"),
        slotCounts: sectionRunJson(row, "slotCounts"),
      })),
    };
  },
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
  args: { generationId: v.id("generations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) domainError("NOT_FOUND", "Generation not found");
    const signedOffSeedDraft =
      resolveGatedWorkflow(generation) === "seeds" &&
      generation.summaryVersionId !== undefined;
    let project: Doc<"projects">;
    let actorUserId: Id<"users"> | undefined;
    if (signedOffSeedDraft) {
      const access = await requireReportEditAccess(ctx, generation.projectId);
      project = access.project;
      actorUserId = access.user._id;
    } else {
      project = (await requireInternalProjectAccess(ctx, generation.projectId)).project;
      if ((generation.candidateMode ?? "compare") === "iterative") {
        domainError(
          "INVALID_STATE",
          "Section-by-section generations are cancelled, not stopped"
        );
      }
    }
    if (project.activeGenerationId !== generation._id) {
      domainError("STALE_REVISION", "This generation is no longer active");
    }
    if (generation.stopRequestedAt !== undefined) return null;
    if (generation.status !== "reserved" && generation.status !== "running") {
      domainError("INVALID_STATE", "This generation is no longer drafting");
    }
    const now = Date.now();
    if (signedOffSeedDraft) {
      const rows = (
        await ctx.db
          .query("generationSectionRuns")
          .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
          .take(10)
      ).filter((row) => row.candidateRunId !== undefined);
      if (rows.length > 0 && rows.every((row) => row.status === "drafted")) {
        domainError(
          "INVALID_STATE",
          "Every Section is already drafted; the report is being finished",
          { reason: "DRAFT_COMPLETE" }
        );
      }
      if (actorUserId) {
        await ctx.db.insert("seedDecisionEvents", {
          projectId: generation.projectId,
          generationId: generation._id,
          kind: "stop",
          at: now,
          actorUserId,
        });
      }
    }
    await appendGenerationProgress(ctx, generation, [
      "Stop requested: the section in progress finishes, then the draft is assembled.",
    ]);
    await ctx.db.patch(generation._id, {
      stopRequestedAt: now,
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
    const candidateRunId = args.candidateRunId;
    let explicitCandidateRun: Doc<"generationCandidateRuns"> | undefined;
    if (candidateRunId !== undefined) {
      const candidateRun = await ctx.db.get(candidateRunId);
      if (!candidateRun || candidateRun.generationId !== generation._id) return [];
      explicitCandidateRun = candidateRun;
    }
    const rows = (
      candidateRunId === undefined
        ? await ctx.db
            .query("generationSectionRuns")
            .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
            .take(30)
        : await ctx.db
            .query("generationSectionRuns")
            .withIndex("by_candidateRunId_and_section", (q) =>
              q.eq("candidateRunId", candidateRunId)
            )
            .take(30)
    ).filter(
      (row) =>
        row.generationId === generation._id &&
        row.candidateRunId !== undefined &&
        (candidateRunId === undefined || row.candidateRunId === candidateRunId)
    );
    const lastIndex = new Map<string, number>();
    for (const row of rows) {
      const key = row.candidateRunId as string;
      lastIndex.set(key, Math.max(lastIndex.get(key) ?? -1, row.orderIndex ?? 0));
    }
    const checkedAt = new Map<string, number | undefined>();
    const runStatus = new Map<string, string | undefined>();
    for (const key of lastIndex.keys()) {
      const run =
        explicitCandidateRun?._id === key
          ? explicitCandidateRun
          : await ctx.db.get(key as Id<"generationCandidateRuns">);
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
        selfCheckStatus: selfCheckResultOf(sectionRunSelfCheck(row))?.status ?? null,
      }));
  },
});

// ─── Step-by-step writing progress, Stop and redraft (CAP-17, CAP-18) ───────
//
// A signed-off seed generation drafts its three Sections through the ordered
// chain above. The writing view reads getSeedDraftProgress; Stop is
// stopOrderedGeneration; "Draft the rest" is redraftMissingSections, which
// drafts only the Sections a stop left "Not drafted" and writes them into the
// SAME report (owner decision 20).
//
// Redraft write rule (AGENTS.md "agents propose, humans apply"): the redraft
// is not an AI tool editing prose. It is the writer's own "Draft the rest"
// action finishing the report-creation path their Stop interrupted, and it
// may only replace a Section body that is still exactly the untouched
// `[NOT GENERATED]` placeholder. The merge runs inside one mutation against
// the report's latest saved content and bumps its revision, so no saved edit
// can be overwritten: every other node is carried over byte for byte, a
// Section the writer has started typing in is left alone, and a pre-edit
// snapshot makes the write restorable.

/** A finished Section with no measured duration yet: a draft, compression,
 * Self-check and possible repair. */
export const DEFAULT_SECTION_DRAFT_MS = 90_000;
/** The assembled-draft consistency pass before the last Section is shown. */
export const DEFAULT_CONSISTENCY_PASS_MS = 20_000;
/** Floor for a measured estimate, so an implausibly fast Section never
 * makes the next one's share jump straight to the cap. */
const MIN_SECTION_ESTIMATE_MS = 10_000;
/** The share of a Section the pill may show before it is done. */
const SECTION_PROGRESS_CAP = 0.95;
/** A redraft that made no progress for this long is treated as dead: the
 * writing view shows the draft as stopped again and a new "Draft the rest"
 * starts a fresh attempt (older actions are fenced by attemptStartedAt). */
export const REDRAFT_STALE_MS = 15 * 60 * 1000;
/** Error code the scheduled expiry records on a redraft that went quiet. */
const REDRAFT_TIMEOUT_CODE = "timeout";

function isSignedOffSeedGeneration(generation: Doc<"generations">): boolean {
  return (
    resolveGatedWorkflow(generation) === "seeds" &&
    generation.summaryVersionId !== undefined
  );
}

/** The seed chain's candidate run and its Section rows in production order.
 * A signed-off seed generation owns one chain (recovery is a new
 * generation); the newest run wins if an older row ever remains. */
async function seedChainRows(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
): Promise<{
  run: Doc<"generationCandidateRuns"> | null;
  rows: Doc<"generationSectionRuns">[];
}> {
  const all = (
    await ctx.db
      .query("generationSectionRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .take(10)
  ).filter((row) => row.candidateRunId !== undefined);
  if (all.length === 0) return { run: null, rows: [] };
  const newest = all.reduce((latest, row) =>
    row._creationTime > latest._creationTime ? row : latest
  );
  const runId = newest.candidateRunId as Id<"generationCandidateRuns">;
  const run = await ctx.db.get(runId);
  const rows = all
    .filter((row) => row.candidateRunId === runId)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  return { run, rows };
}

/** Whether a redraft attempt still counts as running when a writer asks to
 * start one. The scheduled expiry (expireStaleRedraft) settles a dead
 * attempt; this time check is only the fallback for an expiry that never
 * ran, so a request after the stale window always starts a fresh attempt. */
function isRedraftLive(
  redraft: Doc<"generations">["redraft"],
  now: number
): boolean {
  return (
    redraft !== undefined &&
    redraft.status === "running" &&
    now - redraft.lastProgressAt < REDRAFT_STALE_MS
  );
}

type SeedRedraftSummary = {
  status: "running" | "failed" | "done";
  /** Plain words for the writer; never the provider's raw message. */
  error: string | null;
  /** The attempt's `attemptStartedAt`: a new "Draft the rest" is a new id. */
  attemptId: number;
  /** Section numbers this attempt drafts or writes into the report. */
  sections: SectionNumber[];
  /** Section numbers this attempt wrote into the report (settled only). */
  filledSections: SectionNumber[];
};

/** The stored redraft error is `<code>: <provider message>`; the page gets
 * a fixed sentence for its code instead, so no provider detail leaks. */
export function redraftUserError(stored: string | undefined): string {
  const code = stored?.split(":", 1)[0]?.trim() ?? "";
  switch (code) {
    case REDRAFT_TIMEOUT_CODE:
      return "Drafting stopped responding, so the missing sections were not drafted. Try again.";
    case "rate_limited":
      return "The AI service is busy right now. Try again in a few minutes.";
    case "network":
      return "The AI service could not be reached. Try again.";
    case "output_limit":
      return "A section ran past its length limit and was not drafted. Try again.";
    case "billing":
    case "authentication":
    case "model_access":
      return "The AI service refused the request. Ask an administrator to check the AI settings.";
    default:
      return "The missing sections could not be drafted. Try again.";
  }
}

function seedRedraftSummary(
  redraft: Doc<"generations">["redraft"]
): SeedRedraftSummary | null {
  if (!redraft) return null;
  return {
    status:
      redraft.status === "running" ? "running" : redraft.status === "failed" ? "failed" : "done",
    error: redraft.status === "failed" ? redraftUserError(redraft.error) : null,
    attemptId: redraft.attemptStartedAt,
    sections: [...redraft.sections],
    filledSections: [...(redraft.filledSections ?? [])],
  };
}

/** The attempt's drafted Sections as the report would take them: a draft
 * fills only a body that is still the untouched placeholder, so wherever
 * the writer typed, their text wins over the draft. Returns the resulting
 * Section text, or null without a report. */
function prospectiveRedraftSections(
  reportContent: string | null,
  rows: Doc<"generationSectionRuns">[],
  redrafting: Set<string>
): ReturnType<typeof extractReportSections> | null {
  if (reportContent === null) return null;
  const drafts: Partial<Record<"s242" | "s244" | "s246", string>> = {};
  for (const row of rows) {
    if (redrafting.has(row.section) && row.status === "drafted" && row.draftText) {
      drafts[row.section] = row.draftText;
    }
  }
  return extractReportSections(fillNotDraftedSections(reportContent, drafts).content);
}

type SeedProgressPhase = "drafting" | "stopping" | "completed" | "stopped" | "failed";
type SeedProgressStatus = "queued" | "writing" | "done" | "not_drafted";

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
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || !isSignedOffSeedGeneration(generation)) return null;
    if (!(await getInternalProjectAccessOrNull(ctx, generation.projectId))) return null;
    const now = Date.now();
    const { run, rows } = await seedChainRows(ctx, generation._id);
    const redraft = generation.redraft;
    // Live means running. The scheduled expiry (expireStaleRedraft) moves a
    // dead attempt to `failed`, so this read sees it end without the clock.
    const redraftLive = generation.status === "completed" && redraft?.status === "running";
    const redraftSections = new Set<string>(
      redraftLive && redraft ? redraft.sections.map((section) => sectionKeyOf(section)) : []
    );
    // A completed run is judged by the report the writer sees: a Section they
    // filled by hand is present, and a draft the report never took is not.
    const report =
      generation.status === "completed" ? await reportForGeneration(ctx, generation._id) : null;
    const reportSections = report ? extractReportSections(report.content) : null;
    const placeholderSections = new Set<string>(
      report ? notDraftedReportSections(report.content) : []
    );
    const handText = (row: Doc<"generationSectionRuns">): string | null =>
      report && row.status !== "drafted"
        ? presentReportSection(reportSections, sectionNumberOfRow(row))
        : null;

    let phase: SeedProgressPhase;
    if (generation.status === "reserved" || generation.status === "running") {
      phase = generation.stopRequestedAt !== undefined ? "stopping" : "drafting";
    } else if (generation.status === "completed") {
      phase = redraftLive
        ? "drafting"
        : (report
              ? placeholderSections.size > 0
              : rows.some((row) => row.status !== "drafted"))
          ? "stopped"
          : "completed";
    } else {
      phase = "failed";
    }

    const lastIndex = rows.reduce((max, row) => Math.max(max, row.orderIndex ?? 0), -1);
    const lastRedraftIndex = rows
      .filter((row) => redraftSections.has(row.section))
      .reduce((max, row) => Math.max(max, row.orderIndex ?? 0), -1);
    const chainLive = phase === "drafting" || phase === "stopping";
    const awaitingCheck = (row: Doc<"generationSectionRuns">): boolean => {
      if (row.status !== "drafted") return false;
      if (redraftLive) {
        return redraftSections.has(row.section) && (row.orderIndex ?? 0) === lastRedraftIndex;
      }
      return (
        chainLive &&
        (row.orderIndex ?? 0) === lastIndex &&
        run?.consistencyCheckedAt === undefined
      );
    };
    const statusOf = (row: Doc<"generationSectionRuns">): SeedProgressStatus => {
      if (row.status === "drafted") {
        if (!redraftLive && placeholderSections.has(row.section)) return "not_drafted";
        return awaitingCheck(row) ? "writing" : "done";
      }
      // Filled by hand: the Section has text, so it is not missing.
      if (handText(row) !== null) return "done";
      if (redraftLive) {
        if (!redraftSections.has(row.section)) return "not_drafted";
        return row.status === "running" ? "writing" : "queued";
      }
      if (phase === "drafting") {
        if (row.status === "running") return "writing";
        return row.status === "failed" ? "not_drafted" : "queued";
      }
      if (phase === "stopping") {
        if (row.status === "running") return "writing";
        // After a stop only a first Section that has not started is still
        // drafted; every later one will not be.
        return row.status === "queued" && (row.orderIndex ?? 0) === 0
          ? "queued"
          : "not_drafted";
      }
      return "not_drafted";
    };

    const durations = rows
      .filter(
        (row) =>
          row.status === "drafted" &&
          row.startedAt !== undefined &&
          row.completedAt !== undefined &&
          row.completedAt >= row.startedAt &&
          !(redraftLive && redraftSections.has(row.section) && awaitingCheck(row))
      )
      .map((row) => (row.completedAt as number) - (row.startedAt as number));
    const sectionEstimate = durations.length
      ? Math.max(
          MIN_SECTION_ESTIMATE_MS,
          durations.reduce((sum, value) => sum + value, 0) / durations.length
        )
      : DEFAULT_SECTION_DRAFT_MS;

    const order: SectionNumber[] = rows.length
      ? rows.map(sectionNumberOfRow)
      : (generation.productionOrder ?? ["242", "244", "246"]);
    const sections = order.map((section, index) => {
      const row = rows.find((candidate) => candidate.section === sectionKeyOf(section));
      const status: SeedProgressStatus = row
        ? statusOf(row)
        : phase === "drafting"
          ? "queued"
          : "not_drafted";
      const heading = PD_SECTION_HEADINGS[sectionKeyOf(section)];
      const drafted = row?.status === "drafted";
      const handFilled = row && status === "done" && !drafted ? handText(row) : null;
      const doneAt =
        row && status === "done" && drafted
          ? !redraftLive &&
            (row.orderIndex ?? 0) === lastIndex &&
            run?.consistencyCheckedAt !== undefined
            ? Math.max(row.completedAt ?? 0, run.consistencyCheckedAt)
            : (row.completedAt ?? null)
          : null;
      return {
        key: section as string,
        number: heading.number as string,
        title: heading.title as string,
        question: heading.question as string,
        orderIndex: row?.orderIndex ?? index,
        status,
        paragraphs:
          status !== "done"
            ? []
            : drafted && row?.draftText
              ? sectionParagraphs(row.draftText)
              : handFilled
                ? sectionParagraphs(handFilled)
                : [],
        startedAt:
          row && (status === "writing" || (status === "done" && drafted))
            ? (row.startedAt ?? null)
            : null,
        completedAt: doneAt,
        row,
      };
    });

    const total = Math.max(sections.length, 1);
    const doneCount = sections.filter((section) => section.status === "done").length;
    let partial = 0;
    let remaining = 0;
    let consistencyPending = false;
    for (const section of sections) {
      const row = section.row;
      if (section.status === "writing" && row) {
        if (row.status === "drafted") {
          // Drafted, waiting for the consistency check.
          partial += SECTION_PROGRESS_CAP;
          consistencyPending = true;
          const waited = now - (row.completedAt ?? now);
          remaining += Math.max(0, DEFAULT_CONSISTENCY_PASS_MS - waited);
        } else {
          const elapsed = Math.max(0, now - (row.startedAt ?? now));
          partial += Math.min(SECTION_PROGRESS_CAP, elapsed / sectionEstimate);
          remaining += Math.max(0, sectionEstimate - elapsed);
        }
      } else if (section.status === "queued") {
        remaining += sectionEstimate;
      } else if (
        phase === "stopped" &&
        section.status === "not_drafted" &&
        row?.status === "failed" &&
        row.startedAt !== undefined &&
        row.completedAt !== undefined &&
        row.error !== NOT_DRAFTED_AFTER_STOP
      ) {
        // A Section that failed after the stop keeps the share the pill
        // already showed, so the stopped reading never goes backwards.
        partial += Math.min(
          SECTION_PROGRESS_CAP,
          Math.max(0, row.completedAt - row.startedAt) / sectionEstimate
        );
      }
    }
    // The consistency pass runs once every Section is drafted: still ahead
    // while the chain is drafting (not stopping) or a redraft will complete
    // the report.
    const willCheck =
      !consistencyPending &&
      ((phase === "drafting" && !redraftLive && run?.consistencyCheckedAt === undefined) ||
        (redraftLive && sections.every((section) => section.status !== "not_drafted")));
    if (willCheck) remaining += DEFAULT_CONSISTENCY_PASS_MS;

    const percent =
      phase === "completed"
        ? 100
        : Math.min(99, Math.floor(((doneCount + partial) / total) * 100));
    const current = sections.find((section) => section.status === "writing") ?? null;
    const lastDone = [...sections].reverse().find((section) => section.status === "done") ?? null;
    return {
      phase,
      percent,
      estimatedRemainingMs: chainLive ? Math.round(remaining) : null,
      currentSectionKey: current?.key ?? null,
      stoppedAfterSectionKey:
        generation.stoppedAfterSection ??
        (phase === "stopping" ? (current?.key ?? lastDone?.key ?? null) : null),
      sections: sections.map(({ row: _row, ...section }) => section),
      // The latest "Draft the rest" attempt, so the page can show an
      // attempt-scoped failure with a retry; null before the first one.
      redraft: seedRedraftSummary(redraft),
    };
  },
});

/** The fence every redraft write re-checks: the generation is still the
 * completed signed-off seed run, the redraft attempt is the live one, and the
 * project is not being deleted. */
async function redraftFence(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  candidateRunId: Id<"generationCandidateRuns">,
  attemptStartedAt: number
) {
  const generation = await ctx.db.get(generationId);
  if (
    !generation ||
    generation.status !== "completed" ||
    !isSignedOffSeedGeneration(generation)
  ) {
    return null;
  }
  const redraft = generation.redraft;
  if (
    !redraft ||
    redraft.status !== "running" ||
    redraft.attemptStartedAt !== attemptStartedAt
  ) {
    return null;
  }
  if (await isProjectDeleting(ctx, generation.projectId)) return null;
  const run = await ctx.db.get(candidateRunId);
  if (!run || run.generationId !== generation._id || run.ghost) return null;
  return { generation, redraft, run };
}

async function reportForGeneration(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">
) {
  return await ctx.db
    .query("reports")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .unique();
}

/** Current report text of a Section, or null when it is empty or still the
 * untouched "Not drafted" placeholder. */
function presentReportSection(
  sections: ReturnType<typeof extractReportSections> | null,
  section: SectionNumber
): string | null {
  const text = sections?.[sectionKeyOf(section)]?.trim() ?? "";
  return text && text !== NOT_GENERATED_PLACEHOLDER ? text : null;
}

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
  args: { generationId: v.id("generations") },
  returns: v.object({
    status: v.union(
      v.literal("started"),
      v.literal("running"),
      v.literal("nothing_to_draft")
    ),
    sections: v.array(sectionNumberValidator),
  }),
  handler: async (
    ctx,
    args
  ): Promise<{
    status: "started" | "running" | "nothing_to_draft";
    sections: SectionNumber[];
  }> => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) domainError("NOT_FOUND", "Generation not found");
    const { user, project } = await requireReportEditAccess(ctx, generation.projectId);
    if (!isSignedOffSeedGeneration(generation) || generation.status !== "completed") {
      domainError("INVALID_STATE", "Only a stopped Step-by-step draft can be redrafted", {
        reason: "NOT_STOPPED",
      });
    }
    if (await isProjectDeleting(ctx, project._id)) {
      domainError("INVALID_STATE", "This project is being deleted");
    }
    const now = Date.now();
    const previous = generation.redraft;
    if (previous && isRedraftLive(previous, now)) {
      return { status: "running", sections: previous.sections };
    }
    if (await findActiveGeneration(ctx, project, ACTIVE_GENERATION_STATUSES)) {
      domainError("GENERATION_ACTIVE", "A generation is already active for this project");
    }
    const report = await reportForGeneration(ctx, generation._id);
    if (!report) domainError("INVALID_STATE", "This generation has no report to fill");
    const { run, rows } = await seedChainRows(ctx, generation._id);
    if (!run || rows.length === 0) {
      domainError("INVALID_STATE", "This generation has no Section runs to redraft");
    }
    const placeholders = new Set<string>(notDraftedReportSections(report.content));
    const missing = rows.filter(
      (row) => row.status !== "drafted" && placeholders.has(row.section)
    );
    // Drafted by an earlier attempt that died before writing them: carried
    // into this attempt unchanged, still only into a placeholder body.
    const carried = rows.filter(
      (row) =>
        row.status === "drafted" &&
        (row.draftText ?? "").trim().length > 0 &&
        placeholders.has(row.section)
    );
    if (missing.length === 0 && carried.length === 0) {
      return { status: "nothing_to_draft", sections: [] };
    }
    const summaryVersionId = generation.summaryVersionId as Id<"summaryVersions">;
    const payload = await frozenOrderedPayload(ctx, generation, summaryVersionId);
    const carriedKeys = new Set<string>(carried.map((row) => row.section));
    const sections = rows
      .filter((row) => carriedKeys.has(row.section) || missing.includes(row))
      .map(sectionNumberOfRow);
    const attemptStartedAt = Math.max(now, (previous?.attemptStartedAt ?? 0) + 1);
    for (const [index, row] of missing.entries()) {
      await ctx.db.patch(row._id, {
        status: index === 0 ? "queued" : "pending",
        attempt: row.attempt + 1,
        queuedAt: now,
        draftText: undefined,
        metrics: undefined,
        selfCheck: undefined,
        slotCounts: undefined,
        metricsData: undefined,
        selfCheckData: undefined,
        slotCountsData: undefined,
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
      });
    }
    await appendGenerationProgress(ctx, generation, [
      `Drafting the Not drafted Sections (${sections.join(", ")}) from the signed-off Summary into the same report.`,
    ]);
    await transitionRedraft(ctx, generation, {
      status: "running",
      attemptStartedAt,
      requestedBy: user._id,
      sections,
      lastProgressAt: now,
    });
    const attempt = { generationId: generation._id, candidateRunId: run._id, attemptStartedAt };
    if (missing.length > 0) {
      // The chain's stored payload (the same frozen inputs), or stored now
      // for a chain signed off before payloads were stored (2026-09-25).
      const payloadId = await persistOrderedPayload(ctx, generation._id, run._id, {
        ...payload,
        summaryVersionId,
      });
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.redraftSeedSection, {
        ...attempt,
        section: sectionNumberOfRow(missing[0]),
        payloadId,
      });
    } else {
      // Every missing Section is already drafted: only the write is left.
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeSeedRedraft, attempt);
    }
    await ctx.scheduler.runAfter(REDRAFT_STALE_MS, internal.generations.expireStaleRedraft, attempt);
    return { status: "started", sections };
  },
});

/** CAS claim of one queued redraft Section. Prior Sections are the report's
 * current text (the writer's edits included), or this attempt's own drafts
 * for Sections it has redrafted but not yet written. */
export const claimRedraftSection = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    attemptStartedAt: v.number(),
    section: sectionNumberValidator,
    promptVersion: v.optional(v.string()),
    payload: v.optional(orderedPayloadValidator),
    payloadId: v.optional(v.id("generationArtifacts")),
  },
  handler: async (ctx, args) => {
    const fence = await redraftFence(
      ctx,
      args.generationId,
      args.candidateRunId,
      args.attemptStartedAt
    );
    if (!fence) return null;
    const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
    if (!row || row.status !== "queued" || row.generationId !== args.generationId) {
      return null;
    }
    let executionBrief: Awaited<ReturnType<typeof loadBriefCheck>> | undefined;
    if (args.promptVersion && fence.generation.promptVersion !== args.promptVersion) {
      // Capacity belongs to the program that executes the request, exactly as
      // for the chain's own claim. A rejection rolls this claim back.
      const payload = await resolveOrderedPayload(ctx, args.generationId, args);
      if (!payload) {
        domainError("INVALID_STATE", "Frozen Summary execution payload is unavailable");
      }
      executionBrief = await assertFrozenSummaryRuntimeAdmission(
        ctx,
        fence.generation,
        payload
      );
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "running", startedAt: now });
    await transitionRedraft(ctx, fence.generation, { ...fence.redraft, lastProgressAt: now });
    const report = await reportForGeneration(ctx, fence.generation._id);
    const redrafting = new Set<string>(fence.redraft.sections.map(sectionKeyOf));
    const orderIndex = row.orderIndex ?? 0;
    const chainRows = await orderedRunsForCandidate(ctx, fence.run._id);
    // The report as this attempt would leave it, so a Section the writer
    // typed into mid-redraft is read as their text, not the discarded draft.
    const current = prospectiveRedraftSections(report?.content ?? null, chainRows, redrafting);
    const priorSections = chainRows
      .filter((prior) => (prior.orderIndex ?? 0) < orderIndex)
      .flatMap((prior) => {
        const section = sectionNumberOfRow(prior);
        const text =
          presentReportSection(current, section) ??
          (prior.status === "drafted" ? (prior.draftText ?? null) : null);
        return text ? [{ section, text }] : [];
      });
    return await orderedSectionClaim(ctx, {
      generation: fence.generation,
      row,
      section: args.section,
      priorSections,
      executionBrief,
    });
  },
});

/** Persist one redrafted Section, then schedule the next one or the redraft
 * finalizer. The report is not touched until every Section of the attempt is
 * drafted (or the attempt fails). */
export const completeRedraftSection = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    attemptStartedAt: v.number(),
    section: sectionNumberValidator,
    draftText: v.string(),
    metrics: v.string(),
    selfCheck: v.string(),
    slotCounts: v.string(),
    notes: v.array(complianceNoteDraftValidator),
    storylineQuestion: v.optional(storylineQuestionValidator),
    // The chain's payload row (2026-09-25); `payload` for chains scheduled
    // before it was stored. One of the two is required.
    payload: v.optional(orderedPayloadValidator),
    payloadId: v.optional(v.id("generationArtifacts")),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    requireOrderedPayloadRef(args);
    const fence = await redraftFence(
      ctx,
      args.generationId,
      args.candidateRunId,
      args.attemptStartedAt
    );
    if (!fence) return false;
    const row = await orderedRunForSection(ctx, args.candidateRunId, args.section);
    if (!row || row.status !== "running" || row.generationId !== args.generationId) {
      return false;
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "drafted",
      draftText: args.draftText,
      ...orderedSectionResultFields(args),
      error: undefined,
      completedAt: now,
    });
    await persistSectionNotes(ctx, {
      generation: fence.generation,
      run: fence.run,
      section: args.section,
      notes: args.notes,
      storylineQuestion: args.storylineQuestion,
      now,
    });
    await appendGenerationProgress(ctx, fence.generation, [
      `✓ ${fence.run.label}: ${ORDERED_SECTION_TITLES[args.section]} redrafted (${sectionCheckNarration(args.selfCheck)}).`,
    ]);
    await transitionRedraft(ctx, fence.generation, { ...fence.redraft, lastProgressAt: now });
    // The next Section still to draft; a carried Section is already drafted.
    const position = fence.redraft.sections.indexOf(args.section);
    let nextSection: SectionNumber | undefined;
    let next: Doc<"generationSectionRuns"> | null = null;
    for (const candidate of fence.redraft.sections.slice(position + 1)) {
      const candidateRow = await orderedRunForSection(ctx, args.candidateRunId, candidate);
      if (candidateRow?.status === "pending") {
        nextSection = candidate;
        next = candidateRow;
        break;
      }
    }
    if (nextSection && next) {
      await ctx.db.patch(next._id, { status: "queued", queuedAt: now });
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.redraftSeedSection, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        attemptStartedAt: args.attemptStartedAt,
        section: nextSection,
        ...forwardOrderedPayload(args),
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.ai.orderedGeneration.finalizeSeedRedraft, {
        generationId: args.generationId,
        candidateRunId: args.candidateRunId,
        attemptStartedAt: args.attemptStartedAt,
      });
    }
    return true;
  },
});

/**
 * Write this attempt's redrafted Sections into the report and settle the
 * attempt. The merge reads the report's latest saved content in this same
 * transaction and replaces only bodies that are still the untouched
 * placeholder, so a writer's saved edits are never overwritten.
 */
async function settleSeedRedraft(
  ctx: MutationCtx,
  fence: NonNullable<Awaited<ReturnType<typeof redraftFence>>>,
  outcome: { failed: false } | { failed: true; error: string }
) {
  const now = Date.now();
  const { generation, redraft, run } = fence;
  const rows = await orderedRunsForCandidate(ctx, run._id);
  const drafts: Partial<Record<"s242" | "s244" | "s246", string>> = {};
  for (const row of rows) {
    if (
      redraft.sections.includes(sectionNumberOfRow(row)) &&
      row.status === "drafted" &&
      row.draftText
    ) {
      drafts[row.section] = row.draftText;
    }
  }
  const report = await reportForGeneration(ctx, generation._id);
  let filled: SectionNumber[] = [];
  let skipped: SectionNumber[] = [];
  let resultingContent = report?.content ?? null;
  if (report && Object.keys(drafts).length > 0) {
    const merged = fillNotDraftedSections(report.content, drafts);
    resultingContent = merged.content;
    filled = merged.filled.map((key) => key.slice(1) as SectionNumber);
    skipped = merged.skipped.map((key) => key.slice(1) as SectionNumber);
    if (merged.filled.length > 0) {
      await writePreEditSnapshot(ctx, report, "pre_chat_edit", { createdAt: now });
      await ctx.db.patch(report._id, {
        content: merged.content,
        contentHash: await sha256(merged.content),
        revisionNumber: (report.revisionNumber ?? 0) + 1,
        // Like any change to the prose, the new revision needs its own
        // provenance review.
        provenanceId: undefined,
        updatedAt: now,
      });
      await persistDeterministicFindings(ctx, report._id);
    }
  }
  // Completion is the report's, not the run rows': a Section the writer
  // filled by hand counts as present, and the rows stay generation history.
  const lastDrafted = [...rows].reverse().find((row) => row.status === "drafted");
  const complete =
    resultingContent !== null
      ? notDraftedReportSections(resultingContent).length === 0
      : rows.every((row) => row.status === "drafted");
  let outputs: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(generation.agentOutputs ?? "{}");
    if (parsed && typeof parsed === "object") outputs = parsed as Record<string, unknown>;
  } catch {
    /* Rebuild from the Section keys below. */
  }
  for (const section of filled) outputs[`section${section}`] = drafts[sectionKeyOf(section)];
  if (complete) delete outputs.stoppedAfterSection;
  else if (lastDrafted) outputs.stoppedAfterSection = sectionNumberOfRow(lastDrafted);
  // CAP-18: once no Section is Not drafted, QA runs once in the background.
  const scheduleQa = complete && generation.postQaStatus !== "running";
  const postQaStartedAt = Math.max(now, (generation.postQaStartedAt ?? 0) + 1);
  const lines = (sections: SectionNumber[]) =>
    `${sections.length === 1 ? "Line" : "Lines"} ${sections.join(", ")}`;
  const narration = outcome.failed
    ? `✗ The redraft did not finish. ${filled.length ? `${lines(filled)} went into the report; ` : ""}the other Sections stay Not drafted.`
    : `✓ Redrafted ${filled.length ? lines(filled) : "no Section"} into the report${skipped.length ? `. ${lines(skipped)} kept the writer's own text` : ""}.`;
  await appendGenerationProgress(ctx, generation, [
    narration,
    ...(scheduleQa ? ["Running the QA scorecard and chronology in the background…"] : []),
  ]);
  await transitionRedraft(ctx, generation, {
    ...redraft,
    status: outcome.failed ? "failed" : "completed",
    lastProgressAt: now,
    completedAt: now,
    filledSections: filled,
    ...(outcome.failed ? { error: outcome.error.slice(0, 500) } : {}),
  }, {
    // stoppedAfterSection is present only while Sections remain Not drafted.
    stoppedAfterSection: complete
      ? undefined
      : lastDrafted
        ? sectionNumberOfRow(lastDrafted)
        : generation.stoppedAfterSection,
    agentOutputs: JSON.stringify(outputs),
    ...(scheduleQa ? { postQaStatus: "running" as const, postQaStartedAt } : {}),
  });
  if (scheduleQa) {
    // CAP-18: the report is complete now, so QA follows in the background.
    await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
      generationId: generation._id,
      attemptStartedAt: postQaStartedAt,
    });
  }
  return { filled, skipped };
}

/** A redraft Section failed: it and the Sections after it stay Not drafted,
 * and any Section this attempt already drafted is written into the report. */
export const failRedraftSection = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    attemptStartedAt: v.number(),
    section: sectionNumberValidator,
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const fence = await redraftFence(
      ctx,
      args.generationId,
      args.candidateRunId,
      args.attemptStartedAt
    );
    if (!fence) return null;
    await failOpenRedraftRows(ctx, fence, (row) =>
      row.section === sectionKeyOf(args.section)
        ? args.error.slice(0, 500)
        : "Not drafted: an earlier Section failed during the redraft."
    );
    await settleSeedRedraft(ctx, fence, { failed: true, error: args.error });
    return null;
  },
});

/** Mark the attempt's Sections that are not drafted yet as failed. */
async function failOpenRedraftRows(
  ctx: MutationCtx,
  fence: NonNullable<Awaited<ReturnType<typeof redraftFence>>>,
  errorFor: (row: Doc<"generationSectionRuns">) => string
) {
  const now = Date.now();
  for (const row of await orderedRunsForCandidate(ctx, fence.run._id)) {
    if (!fence.redraft.sections.includes(sectionNumberOfRow(row))) continue;
    if (row.status === "running" || row.status === "queued" || row.status === "pending") {
      await ctx.db.patch(row._id, { status: "failed", error: errorFor(row), completedAt: now });
    }
  }
}

/**
 * Fenced expiry of one redraft attempt, scheduled when it starts. An attempt
 * that made progress within REDRAFT_STALE_MS is checked again when that
 * window ends; one that went quiet (its action died) settles as `failed`:
 * Sections it already drafted are written into the report, the rest stay Not
 * drafted, and every subscribed page sees the change. A settled or replaced
 * attempt is left alone.
 */
export const expireStaleRedraft = internalMutation({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    attemptStartedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const fence = await redraftFence(
      ctx,
      args.generationId,
      args.candidateRunId,
      args.attemptStartedAt
    );
    if (!fence) return null;
    const idle = Date.now() - fence.redraft.lastProgressAt;
    if (idle < REDRAFT_STALE_MS) {
      await ctx.scheduler.runAfter(
        REDRAFT_STALE_MS - idle,
        internal.generations.expireStaleRedraft,
        args
      );
      return null;
    }
    const error = `${REDRAFT_TIMEOUT_CODE}: the redraft made no progress for ${REDRAFT_STALE_MS / 60_000} minutes.`;
    await failOpenRedraftRows(ctx, fence, () =>
      "Not drafted: the redraft stopped responding."
    );
    await settleSeedRedraft(ctx, fence, { failed: true, error });
    return null;
  },
});

/** The Section text a redraft's consistency pass checks: the document the
 * write will produce, that is the writer's text wherever they typed and this
 * attempt's drafts only where a placeholder remains. applySeedRedraft
 * recomputes it to tell whether the report changed while the pass ran. */
async function redraftCheckedSections(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  redraft: NonNullable<Doc<"generations">["redraft"]>,
  candidateRunId: Id<"generationCandidateRuns">
): Promise<Array<{ section: SectionNumber; text: string | null }>> {
  const rows = await orderedRunsForCandidate(ctx, candidateRunId);
  const report = await reportForGeneration(ctx, generationId);
  const redrafting = new Set<string>(redraft.sections.map(sectionKeyOf));
  const current = prospectiveRedraftSections(report?.content ?? null, rows, redrafting);
  return rows.map((row) => {
    const section = sectionNumberOfRow(row);
    return {
      section,
      text: current
        ? presentReportSection(current, section)
        : redrafting.has(row.section) && row.status === "drafted"
          ? (row.draftText ?? null)
          : null,
    };
  });
}

/** Finalizer input: the attempt's rows, the report's current Section text
 * and the frozen Brief the consistency pass checks against. */
export const getSeedRedraftInput = internalQuery({
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    attemptStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    const run = await ctx.db.get(args.candidateRunId);
    if (
      !generation ||
      !run ||
      run.generationId !== generation._id ||
      generation.redraft?.status !== "running" ||
      generation.redraft.attemptStartedAt !== args.attemptStartedAt
    ) {
      return null;
    }
    const { brief } = await loadBriefCheck(ctx, generation);
    return {
      model: run.model,
      projectId: generation.projectId,
      requestedBy: generation.requestedBy,
      brief,
      sections: await redraftCheckedSections(ctx, generation._id, generation.redraft, run._id),
    };
  },
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
  args: {
    generationId: v.id("generations"),
    candidateRunId: v.id("generationCandidateRuns"),
    attemptStartedAt: v.number(),
    notes: v.array(complianceNoteDraftValidator),
    checked: v.optional(
      v.array(
        v.object({ section: sectionNumberValidator, text: v.union(v.string(), v.null()) })
      )
    ),
  },
  returns: v.union(v.literal("applied"), v.literal("fenced"), v.literal("report_changed")),
  handler: async (ctx, args): Promise<"applied" | "fenced" | "report_changed"> => {
    const fence = await redraftFence(
      ctx,
      args.generationId,
      args.candidateRunId,
      args.attemptStartedAt
    );
    if (!fence) return "fenced";
    const checked = args.checked;
    if (checked) {
      const latest = await redraftCheckedSections(
        ctx,
        fence.generation._id,
        fence.redraft,
        fence.run._id
      );
      const unchanged =
        latest.length === checked.length &&
        latest.every(
          (row, index) =>
            row.section === checked[index].section && row.text === checked[index].text
        );
      if (!unchanged) {
        await transitionRedraft(ctx, fence.generation, {
          ...fence.redraft,
          lastProgressAt: Date.now(),
        });
        return "report_changed";
      }
    }
    const owner = {
      projectId: fence.generation.projectId,
      generationId: fence.generation._id,
      candidateRunId: fence.run._id,
    };
    for (const note of args.notes) {
      await ctx.db.insert("complianceNotes", complianceNoteRow(note, owner));
    }
    if (args.notes.length > 0) {
      await ctx.db.patch(fence.run._id, { consistencyCheckedAt: Date.now() });
    }
    await settleSeedRedraft(ctx, fence, { failed: false });
    return "applied";
  },
});

// ─── 2026-09-25 migrations (phase 4 generation structure) ───────────────────
// Batched, self-rescheduling backfills in the repo's pattern (see
// transcripts.backfillTranscriptStructure). Each is idempotent: a second run
// patches nothing. Start each once with `{}`; `dryRun: true` reports one page
// without writing or scheduling.

const SECTION_RUN_BACKFILL_PAGE_SIZE = 100;
const SECTION_RUN_BACKFILL_MAX_BYTES_READ = 8 * 1024 * 1024;

/**
 * Fill the typed copies (`metricsData`, `qaData`, `selfCheckData`,
 * `slotCountsData`) of older `generationSectionRuns` rows from their JSON
 * strings. A string that does not convert strictly is left as the only form
 * and keeps being read through the string fallback.
 * `npx convex run generations:backfillSectionRunData '{}'`
 */
export const backfillSectionRunData = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    patched: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.min(
      Math.max(1, Math.floor(args.pageSize ?? SECTION_RUN_BACKFILL_PAGE_SIZE)),
      SECTION_RUN_BACKFILL_PAGE_SIZE
    );
    const page = await ctx.db.query("generationSectionRuns").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
      maximumBytesRead: SECTION_RUN_BACKFILL_MAX_BYTES_READ,
    });
    let patched = 0;
    for (const row of page.page) {
      const fields = missingSectionRunTypedFields(row);
      if (Object.keys(fields).length === 0) continue;
      if (!args.dryRun) await ctx.db.patch(row._id, fields);
      patched += 1;
    }
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, internal.generations.backfillSectionRunData, {
        cursor: page.continueCursor,
        ...(args.pageSize !== undefined ? { pageSize } : {}),
      });
    }
    return {
      scanned: page.page.length,
      patched,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** Generations per page of the progress backfill. With at most
 * PROGRESS_BACKFILL_MAX_LINES lines each, one page writes at most 4 000 rows. */
const PROGRESS_BACKFILL_PAGE_SIZE = 8;
/** Lines copied per generation: the newest ones. Readers return at most
 * PROGRESS_READ_LIMIT (50) lines; the full array stays on the row. */
export const PROGRESS_BACKFILL_MAX_LINES = 500;
const PROGRESS_BACKFILL_MAX_BYTES_READ = 8 * 1024 * 1024;

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
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    pageSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    copiedGenerations: v.number(),
    copiedLines: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const pageSize = Math.min(
      Math.max(1, Math.floor(args.pageSize ?? PROGRESS_BACKFILL_PAGE_SIZE)),
      PROGRESS_BACKFILL_PAGE_SIZE
    );
    const page = await ctx.db.query("generations").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
      maximumBytesRead: PROGRESS_BACKFILL_MAX_BYTES_READ,
    });
    const now = Date.now();
    let copiedGenerations = 0;
    let copiedLines = 0;
    for (const generation of page.page) {
      if (generation.progressLogCopiedAt !== undefined) continue;
      const lines = generation.progressLog ?? [];
      if (lines.length === 0) continue;
      if (await isProjectDeleting(ctx, generation.projectId)) continue;
      const copied = lines.slice(-PROGRESS_BACKFILL_MAX_LINES);
      if (!args.dryRun) {
        await appendGenerationProgress(
          ctx,
          generation,
          copied,
          generation.requestedAt ?? generation._creationTime
        );
        await ctx.db.patch(generation._id, { progressLogCopiedAt: now });
      }
      copiedGenerations += 1;
      copiedLines += copied.length;
    }
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, internal.generations.backfillGenerationProgress, {
        cursor: page.continueCursor,
        ...(args.pageSize !== undefined ? { pageSize } : {}),
      });
    }
    return {
      scanned: page.page.length,
      copiedGenerations,
      copiedLines,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
