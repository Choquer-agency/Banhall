import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { assertProjectOwner } from "./lib/auth";

/**
 * Public query: get the latest generation for a project (for progress UI).
 * Requires authenticated owner. Strips internal agentOutputs.
 */
export const getLatestGeneration = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await assertProjectOwner(ctx, args.projectId);
    if (!project) return null;

    return await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

/**
 * Public query: list all generations for a project.
 * Requires authenticated owner. Strips internal agentOutputs.
 */
export const listGenerations = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await assertProjectOwner(ctx, args.projectId);
    if (!project) return [];

    return await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
  },
});

// ─── Internal functions used by the pipeline action ──────────────────────────

export const createGeneration = internalMutation({
  args: {
    projectId: v.id("projects"),
    transcriptId: v.id("transcripts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("generations", {
      projectId: args.projectId,
      transcriptId: args.transcriptId,
      status: "running",
      currentStep: "Starting...",
      progressLog: [],
      candidatesDone: 0,
      startedAt: Date.now(),
    });
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

/** BNH-21: bump the completed-draft counter for milestone progress. */
export const incrementCandidatesDone = internalMutation({
  args: { generationId: v.id("generations") },
  handler: async (ctx, args) => {
    const gen = await ctx.db.get(args.generationId);
    if (!gen) return;
    await ctx.db.patch(args.generationId, {
      candidatesDone: (gen.candidatesDone ?? 0) + 1,
    });
  },
});

/**
 * Land one candidate's outcome (from ai/pipeline.generateCandidate) and, when
 * the last one arrives, finalize the generation: any success →
 * awaiting_selection; all failed → failed + project back to draft. Mutations
 * serialize, so the done/failed counters can't race.
 */
export const finalizeCandidate = internalMutation({
  args: {
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    label: v.string(),
    succeeded: v.boolean(),
    qaScore: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const gen = await ctx.db.get(args.generationId);
    if (!gen) return;

    const done = (gen.candidatesDone ?? 0) + (args.succeeded ? 1 : 0);
    const failed = (gen.candidatesFailed ?? 0) + (args.succeeded ? 0 : 1);
    const line = args.succeeded
      ? `✓ ${args.label} draft ready (QA ${args.qaScore ?? "—"}/100).`
      : `✗ ${args.label} failed: ${args.error ?? "error"} — skipping.`;
    const progressLog = [...(gen.progressLog ?? []), line];
    const total = gen.totalCandidates ?? 3;

    if (done + failed < total) {
      await ctx.db.patch(args.generationId, {
        candidatesDone: done,
        candidatesFailed: failed,
        progressLog,
      });
      return;
    }

    // Last candidate landed — finalize.
    if (done > 0) {
      await ctx.db.patch(args.generationId, {
        candidatesDone: done,
        candidatesFailed: failed,
        status: "awaiting_selection",
        currentStep: "Choose your preferred draft",
        progressLog: [
          ...progressLog,
          `All ${done} candidate(s) ready — choose your preferred draft.`,
        ],
      });
    } else {
      await ctx.db.patch(args.generationId, {
        candidatesDone: done,
        candidatesFailed: failed,
        status: "failed",
        currentStep: "Failed",
        error: "All candidate models failed to generate.",
        completedAt: Date.now(),
        progressLog,
      });
      const project = await ctx.db.get(args.projectId);
      if (project?.status === "generating") {
        await ctx.db.patch(args.projectId, {
          status: "draft",
          updatedAt: Date.now(),
        });
      }
    }
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
    const stale = (
      await ctx.db.query("generations").order("desc").take(100)
    ).filter(
      (g) =>
        g.status === "running" && (g.startedAt ?? g._creationTime) < cutoff
    );
    for (const g of stale) {
      await ctx.db.patch(g._id, {
        status: "failed",
        currentStep: "Failed",
        error: "Timed out (stranded run cleaned up by failStaleGenerations).",
        completedAt: Date.now(),
      });
      const project = await ctx.db.get(g.projectId);
      if (project?.status === "generating") {
        await ctx.db.patch(g.projectId, {
          status: "draft",
          updatedAt: Date.now(),
        });
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

export const getTranscriptContent = internalQuery({
  args: { transcriptId: v.id("transcripts") },
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    return transcript?.content ?? null;
  },
});

export const getProjectTitle = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    return project?.title ?? null;
  },
});

// BNH-10: industry drives which Brain namespace report generation retrieves from.
export const getProjectIndustry = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    return project?.industry ?? null;
  },
});

export const getNextReportVersion = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    return (latest?.version ?? 0) + 1;
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

export const saveReport = internalMutation({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("reports", {
      projectId: args.projectId,
      content: args.content,
      version: args.version,
      generatedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.projectId, {
      status: "review",
      updatedAt: now,
    });
  },
});

export const setProjectGenerating = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      status: "generating",
      updatedAt: Date.now(),
    });
  },
});

export const resetProjectToDraft = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      status: "draft",
      updatedAt: Date.now(),
    });
  },
});

// ─── BNH-15: candidate reports + model selection ─────────────────────────────

export const addCandidate = internalMutation({
  args: {
    generationId: v.id("generations"),
    projectId: v.id("projects"),
    model: v.string(),
    label: v.string(),
    content: v.string(),
    agentOutputs: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reportCandidates", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** The candidate drafts for the latest generation, for the selection UI. */
export const getCandidates = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await assertProjectOwner(ctx, args.projectId);
    if (!project) return [];
    const gen = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (!gen) return [];
    const candidates = await ctx.db
      .query("reportCandidates")
      .withIndex("by_generationId", (q) => q.eq("generationId", gen._id))
      .collect();
    return candidates.map((c) => {
      let qaScore: number | null = null;
      let metrics: unknown = null;
      let qa: unknown = null;
      try {
        const parsed = JSON.parse(c.agentOutputs);
        qaScore = parsed?.qa?.overall_score ?? null;
        metrics = parsed?.metrics ?? null; // BNH-45 line/word meters
        qa = parsed?.qa ?? null; // BNH-47 QA panel on option selection
      } catch {
        /* ignore */
      }
      return {
        _id: c._id,
        model: c.model,
        label: c.label,
        content: c.content,
        qaScore,
        metrics,
        qa,
      };
    });
  },
});

/** Promote a chosen candidate to the report and log the model selection. */
export const selectReportCandidate = mutation({
  args: { candidateId: v.id("reportCandidates") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) throw new Error("Candidate not found");

    const project = await ctx.db.get(candidate.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }

    const now = Date.now();

    // Promote to the report (next version).
    const latest = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", candidate.projectId))
      .order("desc")
      .first();
    const reportId = await ctx.db.insert("reports", {
      projectId: candidate.projectId,
      content: candidate.content,
      version: (latest?.version ?? 0) + 1,
      generatedAt: now,
      updatedAt: now,
    });
    // BNH-10 flywheel: freeze the untouched AI draft as a baseline snapshot.
    // Writer edits mutate the report row in place, so without this the draft
    // is unrecoverable — and post-edit distance (the "is the system actually
    // improving" metric) has nothing to diff against.
    await ctx.db.insert("reportSnapshots", {
      projectId: candidate.projectId,
      reportId,
      content: candidate.content,
      reason: "generated",
      label: `AI draft (${candidate.label})`,
      createdByRole: "system",
      createdAt: now,
    });
    await ctx.db.patch(candidate.projectId, { status: "review", updatedAt: now });

    // Mark the generation complete with the chosen model's outputs.
    await ctx.db.patch(candidate.generationId, {
      status: "completed",
      currentStep: "Complete",
      agentOutputs: candidate.agentOutputs,
      completedAt: now,
    });

    // Log the choice for preference stats.
    await ctx.db.insert("modelSelections", {
      projectId: candidate.projectId,
      generationId: candidate.generationId,
      userId,
      model: candidate.model,
      label: candidate.label,
      createdAt: now,
    });

    // Clean up all candidates for this generation (the winner is now the report).
    const all = await ctx.db
      .query("reportCandidates")
      .withIndex("by_generationId", (q) =>
        q.eq("generationId", candidate.generationId)
      )
      .collect();
    for (const c of all) await ctx.db.delete(c._id);
  },
});

/** Aggregate model-preference stats for the admin view. */
export const modelStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

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
    const mine = tally(all.filter((r) => r.userId === userId));

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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (!Number.isInteger(args.score) || args.score < 1 || args.score > 10) {
      throw new Error("Score must be a whole number from 1 to 10");
    }

    const candidate = await ctx.db.get(args.candidateId);
    if (!candidate) throw new Error("Candidate not found");
    const project = await ctx.db.get(candidate.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }

    let qaScore: number | undefined;
    try {
      qaScore = JSON.parse(candidate.agentOutputs)?.qa?.overall_score ?? undefined;
    } catch {
      /* no QA score available */
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

/** The signed-in writer's scores for the latest generation (selection UI). */
export const getMyCandidateScores = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await assertProjectOwner(ctx, args.projectId);
    if (!project) return [];
    const gen = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (!gen) return [];
    const scores = await ctx.db
      .query("candidateScores")
      .withIndex("by_generationId", (q) => q.eq("generationId", gen._id))
      .collect();
    return scores
      .filter((s) => s.userId === userId)
      .map((s) => ({ candidateId: s.candidateId, score: s.score }));
  },
});

/** Post-selection comparison view: every scored option of the latest
 *  generation with the model revealed, plus which one was chosen. */
export const getCandidateScoreSummary = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await assertProjectOwner(ctx, args.projectId);
    if (!project) return null;
    const gen = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (!gen) return null;

    const scores = await ctx.db
      .query("candidateScores")
      .withIndex("by_generationId", (q) => q.eq("generationId", gen._id))
      .collect();
    if (scores.length === 0) return null;

    const selections = await ctx.db
      .query("modelSelections")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    const chosenModel = selections.find((s) => s.generationId === gen._id)?.model ?? null;

    return {
      chosenModel,
      rows: scores
        .sort((a, b) => a.optionPosition - b.optionPosition)
        .map((s) => ({
          optionPosition: s.optionPosition,
          model: s.model,
          label: s.label,
          score: s.score,
          qaScore: s.qaScore ?? null,
          chosen: s.model === chosenModel,
        })),
    };
  },
});
