import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getCurrentUserOrNull,
  getInternalProjectAccessOrNull,
  requireCurrentUser,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
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
  type CandidateModelId,
} from "../shared/generationModels";
import { randomComparePair, resolveCompareModels } from "./ai/model";
import { findActiveGeneration } from "./lib/activeGeneration";
import { buildTiptapDocument } from "./lib/tiptapReport";
import { sectionMetrics } from "./lib/lineLimits";
/**
 * Requires internal project access. Strips internal agentOutputs.
 */
export const getLatestGeneration = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;

    const generation = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
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
      progressLog: generation.progressLog,
      estimatedMs: generation.estimatedMs,
      totalCandidates: generation.totalCandidates,
      candidatesDone: generation.candidatesDone,
      candidatesFailed: generation.candidatesFailed,
      requestedAt: generation.requestedAt,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
      error: generation.error,
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
    return {
      _id: generation._id,
      projectId: generation.projectId,
      transcriptId: generation.transcriptId,
      status: generation.status,
      candidateMode: generation.candidateMode ?? "compare",
      currentStep: generation.currentStep,
      progressLog: generation.progressLog,
      estimatedMs: generation.estimatedMs,
      totalCandidates: generation.totalCandidates,
      candidatesDone: generation.candidatesDone,
      candidatesFailed: generation.candidatesFailed,
      requestedAt: generation.requestedAt,
      startedAt: generation.startedAt,
      completedAt: generation.completedAt,
      error: generation.error,
      agentOutputs: generation.agentOutputs,
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

    const generations = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
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
async function reserveGeneration(
  ctx: MutationCtx,
  project: Doc<"projects">,
  transcript: Doc<"transcripts">,
  requestedBy: Id<"users">,
  lengthTarget: "concise" | "standard" | "full",
  candidateMode: CandidateMode,
  singleModelId?: CandidateModelId,
  compareModelIds?: string[],
  retryOfGenerationId?: Id<"generations">
) {
  if (transcript.projectId !== project._id) {
    domainError("TRANSCRIPT_PROJECT_MISMATCH", "Transcript does not belong to this project");
  }
  // Jul 17 meeting: some engagements have no interview at all (spreadsheet
  // only, drawings, a single email). A transcript-less generation is allowed
  // as long as there's at least one readable context document to work from.
  if (!transcript.content.trim()) {
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

  const active = await findActiveGeneration(ctx, project, [
    "reserved",
    "running",
    "awaiting_selection",
    "awaiting_input",
  ]);
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

  // OpenRouter key is only required when a selected model routes through it —
  // fail here with a clear error instead of mid-generation.
  const requestedModelIds =
    candidateMode === "compare"
      ? (persistedCompareModelIds ?? [])
      : [singleModelId ?? MODEL];
  if (requestedModelIds.some((id) => gatewayForModel(id) === "openrouter")) {
    requireOpenRouterConfigured();
  }

  const now = Date.now();
  const generationId = await ctx.db.insert("generations", {
    projectId: project._id,
    transcriptId: transcript._id,
    status: "reserved",
    requestedAt: now,
    requestedBy,
    lengthTarget,
    candidateMode,
    singleModelId,
    compareModelIds: persistedCompareModelIds,
    retryOfGenerationId,
    previousProjectStatus: project.status,
    currentStep: "Queued",
    progressLog: ["Generation request reserved."],
    candidatesDone: 0,
    candidatesFailed: 0,
    startedAt: now,
  });
  const transcriptContent = transcript.content.slice(0, 500_000);
  await ctx.db.insert("generationSources", {
    generationId,
    projectId: project._id,
    kind: "transcript",
    transcriptId: transcript._id,
    label: "Interview transcript",
    content: transcriptContent,
    contentHash: await sha256(transcriptContent),
    truncated: transcriptContent.length !== transcript.content.length,
    originalLength: transcript.content.length,
    capturedAt: now,
  });
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
      capturedAt: now,
    });
  }
  await ctx.db.patch(project._id, {
    activeGenerationId: generationId,
    status: "generating",
    updatedAt: now,
  });
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
    transcriptId: v.id("transcripts"),
    lengthTarget: v.optional(lengthTargetValidator),
    candidateMode: v.optional(candidateModeValidator),
    singleModelId: v.optional(singleModelIdValidator),
    compareModelIds: v.optional(v.array(v.string())),
    confirmRegeneration: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { project, user } = await requireInternalProjectAccess(ctx, args.projectId);
    const transcript = await ctx.db.get(args.transcriptId);
    if (!transcript) domainError("NOT_FOUND", "Transcript not found");
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
      transcript,
      user._id,
      args.lengthTarget ?? "standard",
      candidateMode,
      validatedSingleModelId(candidateMode, args.singleModelId),
      validatedCompareModelIds(candidateMode, args.compareModelIds)
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
    const transcript = await ctx.db.get(failed.transcriptId);
    if (!transcript) domainError("NOT_FOUND", "Transcript not found");
    return await reserveGeneration(
      ctx,
      project,
      transcript,
      user._id,
      failed.lengthTarget ?? "standard",
      failed.candidateMode ?? "compare",
      persistedSingleModelId(failed.candidateMode ?? "compare", failed.singleModelId),
      failed.compareModelIds,
      failed._id
    );
  },
});

// ─── Internal functions used by the pipeline action ──────────────────────────

export const beginGeneration = internalMutation({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation || generation.status !== "reserved") return false;
    const project = await ctx.db.get(generation.projectId);
    if (!project || project.activeGenerationId !== generation._id) return false;
    await ctx.db.patch(generation._id, {
      status: "running",
      currentStep: "Preparing frozen project sources...",
      startedAt: Date.now(),
    });
    return true;
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
      .take(51);
    const transcript = sources.find((source) => source.kind === "transcript");
    if (!transcript) return null;
    return {
      generationId: generation._id,
      projectId: project._id,
      // Usage attribution: the user who requested this generation (may differ
      // from the project creator, e.g. an admin retry).
      requestedBy: generation.requestedBy,
      transcriptId: generation.transcriptId,
      transcript: transcript.content,
      transcriptSourceId: transcript._id,
      transcriptContentHash: transcript.contentHash,
      title: project.title,
      lengthTarget: generation.lengthTarget ?? "standard",
      candidateMode: generation.candidateMode ?? "compare",
      singleModelId: generation.singleModelId as CandidateModelId | undefined,
      compareModelIds: generation.compareModelIds,
      industry: project.industry,
      scienceCode: project.scienceCode,
      contextDocs: sources
        .filter((source) => source.kind === "project_document")
        .map((source) => {
          const separator = source.label.indexOf(":");
          const category = separator >= 0 ? source.label.slice(0, separator) : "other";
          return {
            category,
            fileName: separator >= 0 ? source.label.slice(separator + 1) : source.label,
            content: source.content,
          };
        }),
    };
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
    provenanceId: candidate.provenanceId,
    content: candidate.content,
    contentHash,
    revisionNumber: 0,
    version: (latest?.version ?? 0) + 1,
    generatedAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("reportSnapshots", {
    projectId: candidate.projectId,
    reportId,
    generationId: generation._id,
    sourceTranscriptId: generation.transcriptId,
    provenanceId: candidate.provenanceId,
    sourceRevisionNumber: 0,
    contentHash,
    content: candidate.content,
    reason: "generated",
    label: `AI draft (${candidate.label})`,
    createdByRole: "system",
    createdAt: now,
  });
  return reportId;
}

export const completeCandidateRun = internalMutation({
  args: {
    candidateRunId: v.id("generationCandidateRuns"),
    content: v.optional(v.string()),
    agentOutputs: v.optional(v.string()),
    qaScore: v.optional(v.number()),
    provenanceId: v.optional(v.id("reportProvenance")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
    if (
      run.ghost &&
      generation &&
      (generation.status === "completed" || generation.status === "failed")
    ) {
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
  },
});

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
    const project = await ctx.db.get(generation.projectId);
    if (project?.activeGenerationId === generation._id) {
      await ctx.db.patch(project._id, {
        activeGenerationId: undefined,
        status: generation.previousProjectStatus ?? "draft",
        updatedAt: Date.now(),
      });
    }
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
      priorSections,
      lengthTarget: generation.lengthTarget ?? "standard",
      projectId: generation.projectId,
      requestedBy: generation.requestedBy,
    };
  },
});

/** Input bundle for the post-assembly QA pass (iterative reports). */
export const getPostQaInput = internalQuery({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return null;
    if ((generation.candidateMode ?? "compare") === "iterative") {
      const analysisRow = await ctx.db
        .query("generationArtifacts")
        .withIndex("by_generationId_and_kind", (q) =>
          q.eq("generationId", args.generationId).eq("kind", "analysis")
        )
        .unique();
      if (!analysisRow) return null;
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
      if (!sections.s242.text && !sections.s244.text && !sections.s246.text) {
        return null;
      }
      return {
        projectId: generation.projectId,
        requestedBy: generation.requestedBy,
        analysis: analysisRow.content,
        section242: sections.s242.text,
        section244: sections.s244.text,
        section246: sections.s246.text,
        model: sections.s242.model || undefined,
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
      };
      if (
        !outputs.analyzer ||
        (!outputs.section242 && !outputs.section244 && !outputs.section246)
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
        section242: outputs.section242 ?? "",
        section244: outputs.section244 ?? "",
        section246: outputs.section246 ?? "",
        model: selection?.model ?? undefined,
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
    qa: v.optional(v.string()),
    chronology: v.optional(v.string()),
    qaScore: v.optional(v.number()),
    failed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return;
    if (args.failed) {
      await ctx.db.patch(generation._id, {
        postQaStatus: "failed",
        progressLog: [
          ...(generation.progressLog ?? []),
          "Post-assembly QA pass failed — the report is unaffected.",
        ],
      });
      return;
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
    // Jul 17 meeting: any completed generation can (re)run its QA scorecard —
    // some projects lost the panel to an error or predate the feature.
    if (generation.status !== "completed") {
      domainError("INVALID_INPUT", "The report must be completed before QA can run");
    }
    // Idempotent: a pass already in flight keeps running across panel
    // close/reopen — never double-spend the API call.
    if (generation.postQaStatus === "running") return null;
    await ctx.db.patch(generation._id, { postQaStatus: "running" });
    await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
      generationId: generation._id,
    });
    return null;
  },
});

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
          error: run.error ?? null,
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
      error: generation.error ?? null,
      // Narrates the pre-fan-out wait (analyzer + Brain) in the stepper.
      progressLog: generation.progressLog ?? [],
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
      await ctx.db.insert("sectionEditEvents", {
        projectId: generation.projectId,
        generationId: generation._id,
        section: args.section,
        draftText: cap(run.draftText),
        approvedText: cap(text),
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
                await ctx.db.patch(event._id, { ghostText: ghostText.slice(0, 6000) });
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
    // Every mode ends with a scorecard: run QA + chronology over the
    // assembled sections in the background (feeds the learning loops).
    await ctx.db.patch(generation._id, { postQaStatus: "running" });
    await ctx.scheduler.runAfter(0, internal.ai.postQa.runReportQa, {
      generationId: generation._id,
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
    }

    // Also free projects orphaned in "generating" with no live generation —
    // e.g. the client dies between createProject and requestGeneration, or a
    // legacy failure predates the activeGenerationId cleanup. Without this the
    // project stays locked on a generation that never existed.
    const projects = await ctx.db.query("projects").take(500);
    let freed = 0;
    for (const project of projects) {
      if (project.status !== "generating") continue;
      if (project.updatedAt > cutoff) continue;
      const active = await findActiveGeneration(ctx, project, [
        "reserved",
        "running",
        "awaiting_selection",
        "awaiting_input",
      ]);
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
      freed += 1;
    }
    return { failed, freed };
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
    if (
      !generation ||
      generation.status === "failed" ||
      generation.status === "completed"
    ) {
      return;
    }
    const updates: Record<string, unknown> = { status: args.status };
    if (args.currentStep !== undefined) updates.currentStep = args.currentStep;
    if (args.agentOutputs !== undefined)
      updates.agentOutputs = args.agentOutputs;
    if (args.error !== undefined) updates.error = args.error;
    if (args.completedAt !== undefined) updates.completedAt = args.completedAt;
    await ctx.db.patch(args.generationId, updates);
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
    const { project, user } = await requireInternalProjectAccess(
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
      completedAt: now,
    });
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
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) {
      return null;
    }
    const scores = await ctx.db
      .query("candidateScores")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(20);
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
