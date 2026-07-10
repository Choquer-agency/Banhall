import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  requireCurrentUser,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";
import { domainError, sha256 } from "./lib/contracts";
import { requireAnthropicConfigured } from "./lib/providerConfig";
import { normalizeCraScienceCode } from "../shared/craScienceCodes";
/**
 * Requires internal project access. Strips internal agentOutputs.
 */
export const getLatestGeneration = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;

    const generation = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (!generation) return null;
    return {
      _id: generation._id,
      projectId: generation.projectId,
      transcriptId: generation.transcriptId,
      status: generation.status,
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
  v.literal("single")
);

type CandidateMode = "compare" | "single";

async function reserveGeneration(
  ctx: MutationCtx,
  project: Doc<"projects">,
  transcript: Doc<"transcripts">,
  requestedBy: Id<"users">,
  lengthTarget: "concise" | "standard" | "full",
  candidateMode: CandidateMode,
  retryOfGenerationId?: Id<"generations">
) {
  if (transcript.projectId !== project._id) {
    domainError("TRANSCRIPT_PROJECT_MISMATCH", "Transcript does not belong to this project");
  }
  if (!transcript.content.trim()) {
    domainError("INVALID_INPUT", "A non-empty project transcript is required");
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
  requireAnthropicConfigured("generation");

  if (project.activeGenerationId) {
    const active = await ctx.db.get(project.activeGenerationId);
    if (
      active &&
      (active.status === "reserved" ||
        active.status === "running" ||
        active.status === "awaiting_selection")
    ) {
      domainError("GENERATION_ACTIVE", "A generation is already active for this project");
    }
  }
  for (const status of ["reserved", "running", "awaiting_selection"] as const) {
    const legacyActive = await ctx.db
      .query("generations")
      .withIndex("by_projectId_and_status", (q) =>
        q.eq("projectId", project._id).eq("status", status)
      )
      .first();
    if (legacyActive) {
      domainError("GENERATION_ACTIVE", "A generation is already active for this project");
    }
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
    internal.ai.pipeline.generateReport,
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
    return await reserveGeneration(
      ctx,
      project,
      transcript,
      user._id,
      args.lengthTarget ?? "standard",
      args.candidateMode ?? "compare"
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
    if (
      !generation ||
      generation.status !== "running" ||
      !project ||
      project._id !== generation.projectId ||
      project.activeGenerationId !== generation._id
    ) {
      return;
    }

    const succeeded = Boolean(args.content && args.agentOutputs && !args.error);
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
    for (const generation of stale) {
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
    return { failed: stale.length };
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
      v.literal("completed"),
      v.literal("failed")
    ),
    currentStep: v.optional(v.string()),
    agentOutputs: v.optional(v.string()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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

/** Candidate drafts for one explicitly named generation. Model identity stays
 * server-side until selection so the comparison is actually blind. */
export const getCandidates = query({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return [];
    if (!(await getInternalProjectAccessOrNull(ctx, generation.projectId))) return [];
    const candidates = await ctx.db
      .query("reportCandidates")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(10);
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

    return { total, overall, mine, recommendation };
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
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    if (!Number.isInteger(args.score) || args.score < 1 || args.score > 10) {
      throw new Error("Score must be a whole number from 1 to 10");
    }

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
      .map((score) => ({ candidateId: score.candidateId, score: score.score }));
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
          qaScore: score.qaScore ?? null,
          chosen: score.model === chosenModel,
        })),
    };
  },
});
