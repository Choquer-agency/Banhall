/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { refreshProjectGenerationActivity } from "./lib/dashboardProjection";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const authId = "recovery-user";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

afterEach(() => {
  vi.useRealTimers();
});

/** Post-QA jobs scheduled for one generation (requestReportQa's only write
 * besides the status flip). */
async function qaJobsFor(
  t: ReturnType<typeof convexTest>,
  generationId: string
) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) =>
        job.name.includes("runReportQa") &&
        job.args[0]?.generationId === generationId
    )
  );
}

async function setupPartial() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Recovery project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "recovery-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "awaiting_selection",
      requestedBy: userId,
      candidateMode: "compare",
      compareModelIds: ["claude-sonnet-5", "google/gemini-3.1-pro-preview"],
      previousProjectStatus: "draft",
      candidatesDone: 1,
      candidatesFailed: 1,
      startedAt: now,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const candidateId = await ctx.db.insert("reportCandidates", {
      projectId,
      generationId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      content: "Ready candidate",
      agentOutputs: "{}",
      createdAt: now,
    });
    await ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      status: "succeeded",
      candidateId,
      queuedAt: now,
      completedAt: now,
    });
    await ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId,
      model: "google/gemini-3.1-pro-preview",
      label: "Gemini 3.1 Pro",
      status: "failed",
      error: "unknown: provider rejected request",
      queuedAt: now,
      completedAt: now,
    });
    return { projectId, generationId, candidateId };
  });
  return { t, ...ids };
}

describe("generation recovery", () => {
  it("projects per-model state without raw provider errors", async () => {
    const { t, generationId } = await setupPartial();
    const recovery = await t.withIdentity({ subject: authId }).query(
      api.generations.getGenerationRecovery,
      { generationId }
    );
    expect(recovery?.models).toEqual([
      { model: "claude-sonnet-5", label: "Sonnet 5", status: "succeeded" },
      { model: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", status: "failed" },
    ]);
    expect(JSON.stringify(recovery)).not.toContain("provider rejected");
  });

  it("creates one linked retry, preserves ready content, and queues only failed models", async () => {
    const { t, projectId, generationId, candidateId } = await setupPartial();
    const authed = t.withIdentity({ subject: authId });
    const retryId = await authed.mutation(api.generations.retryFailedCandidates, {
      generationId,
    });
    const state = await t.run(async (ctx) => {
      const original = await ctx.db.get(generationId);
      const retry = await ctx.db.get(retryId);
      const project = await ctx.db.get(projectId);
      const retryCandidates = await ctx.db
        .query("reportCandidates")
        .withIndex("by_generationId", (q) => q.eq("generationId", retryId))
        .take(10);
      const originalCandidate = await ctx.db.get(candidateId);
      return { original, retry, project, retryCandidates, originalCandidate };
    });
    // CAP-7: the original is superseded (terminal, no report) and the linked
    // recovery generation is the one the project continues on.
    expect(state.original?.status).toBe("superseded");
    expect(state.original?.currentStep).toBe("Recovery started");
    expect(state.original?.completedAt).toEqual(expect.any(Number));
    expect(state.retry?.status).toBe("reserved");
    expect(state.project?.activeGenerationId).toBe(retryId);
    expect(state.project?.status).toBe("generating");
    expect(state.project?.generationActivity).toBe("generating");
    expect(state.retry?.retryOfGenerationId).toBe(generationId);
    expect(state.retry?.retryModelIds).toEqual(["google/gemini-3.1-pro-preview"]);
    expect(state.retry?.seededCandidates).toBe(1);
    expect(state.retryCandidates.map((candidate) => candidate.content)).toEqual(["Ready candidate"]);
    expect(state.originalCandidate?.content).toBe("Ready candidate");
    // A superseded generation cannot be retried again — the recovery owns it.
    await expect(
      authed.mutation(api.generations.retryFailedCandidates, { generationId })
    ).rejects.toMatchObject({
      data: {
        code: "INVALID_STATE",
        message: expect.stringMatching(/superseded/i),
      },
    });
  });

  it("keeps the superseded original out of history, latest, and dashboard activity", async () => {
    vi.useFakeTimers();
    const { t, projectId, generationId } = await setupPartial();
    const authed = t.withIdentity({ subject: authId });
    const retryId = await authed.mutation(api.generations.retryFailedCandidates, {
      generationId,
    });

    const history = await authed.query(api.generations.listGenerations, { projectId });
    expect(history.map((row) => row._id)).toEqual([retryId]);
    const latest = await authed.query(api.generations.getLatestGeneration, { projectId });
    expect(latest?._id).toBe(retryId);
    expect(latest?.status).toBe("reserved");

    // Even with nothing newer left on the project, the superseded row is never
    // surfaced as latest, listed as history, or counted as activity.
    await t.run(async (ctx) => {
      await ctx.db.delete(retryId);
      await ctx.db.patch(projectId, { activeGenerationId: undefined });
      await refreshProjectGenerationActivity(ctx, projectId);
    });
    expect(await authed.query(api.generations.listGenerations, { projectId })).toEqual([]);
    expect(await authed.query(api.generations.getLatestGeneration, { projectId })).toBeNull();
    const project = await t.run(async (ctx) => await ctx.db.get(projectId));
    expect(project?.generationActivity).toBeUndefined();
    // Exact-id reads still show the row as attempt history.
    const recovery = await authed.query(api.generations.getGenerationRecovery, {
      generationId,
    });
    expect(recovery?.status).toBe("superseded");
  });

  it("refuses QA on the superseded original with a typed error and writes nothing", async () => {
    vi.useFakeTimers();
    const { t, generationId } = await setupPartial();
    const authed = t.withIdentity({ subject: authId });
    await authed.mutation(api.generations.retryFailedCandidates, { generationId });

    await expect(
      authed.mutation(api.generations.requestReportQa, { generationId })
    ).rejects.toMatchObject({ data: { code: "INVALID_STATE" } });

    const original = await t.run(async (ctx) => await ctx.db.get(generationId));
    expect(original?.status).toBe("superseded");
    expect(original?.postQaStatus).toBeUndefined();
    expect(original?.postQaStartedAt).toBeUndefined();
    expect(await qaJobsFor(t, generationId)).toHaveLength(0);
  });

  it("rejects legacy partial retries whose original model pair cannot be proven", async () => {
    const { t, generationId } = await setupPartial();
    await t.run(async (ctx) => {
      await ctx.db.patch(generationId, { compareModelIds: undefined });
      const failed = (
        await ctx.db
          .query("generationCandidateRuns")
          .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
          .take(10)
      ).find((run) => run.status === "failed");
      if (failed) {
        await ctx.db.patch(failed._id, { model: "legacy-unknown-model" });
      }
    });
    await expect(
      t.withIdentity({ subject: authId }).mutation(
        api.generations.retryFailedCandidates,
        { generationId }
      )
    ).rejects.toThrow(/older comparison/i);
    const original = await t.run(async (ctx) => await ctx.db.get(generationId));
    expect(original?.status).toBe("awaiting_selection");
  });

  it("terminalizes a seeded recovery after the retried model succeeds", async () => {
    const { t, generationId } = await setupPartial();
    const retryId = await t.withIdentity({ subject: authId }).mutation(
      api.generations.retryFailedCandidates,
      { generationId }
    );
    const retryRunId = await t.run(async (ctx) => {
      await ctx.db.patch(retryId, { status: "running" });
      const project = await ctx.db
        .query("projects")
        .withIndex("by_shareToken", (q) => q.eq("shareToken", "recovery-token"))
        .unique();
      if (!project) throw new Error("project missing");
      await ctx.db.patch(project._id, { activeGenerationId: retryId });
      return await ctx.db.insert("generationCandidateRuns", {
        generationId: retryId,
        projectId: project._id,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "running",
        queuedAt: Date.now(),
        startedAt: Date.now(),
      });
    });
    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: retryRunId,
      content: "Recovered candidate",
      agentOutputs: "{}",
    });
    const retry = await t.run(async (ctx) => await ctx.db.get(retryId));
    expect(retry?.status).toBe("awaiting_selection");
    expect(retry?.candidatesDone).toBe(2);
    expect(retry?.candidatesFailed).toBe(0);
  });

  it("keeps seeded drafts selectable when the retried model fails again", async () => {
    const { t, generationId } = await setupPartial();
    const retryId = await t.withIdentity({ subject: authId }).mutation(
      api.generations.retryFailedCandidates,
      { generationId }
    );
    const retryRunId = await t.run(async (ctx) => {
      await ctx.db.patch(retryId, { status: "running" });
      const retry = await ctx.db.get(retryId);
      if (!retry) throw new Error("retry missing");
      const project = await ctx.db.get(retry.projectId);
      if (!project) throw new Error("project missing");
      await ctx.db.patch(project._id, { activeGenerationId: retryId });
      return await ctx.db.insert("generationCandidateRuns", {
        generationId: retryId,
        projectId: project._id,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "running",
        queuedAt: Date.now(),
        startedAt: Date.now(),
      });
    });
    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: retryRunId,
      error: "unknown: provider unavailable",
    });
    const retry = await t.run(async (ctx) => await ctx.db.get(retryId));
    expect(retry?.status).toBe("awaiting_selection");
    expect(retry?.candidatesDone).toBe(1);
    expect(retry?.candidatesFailed).toBe(1);
  });

  it("requires an authenticated internal user", async () => {
    const { t, generationId } = await setupPartial();
    await expect(
      t.mutation(api.generations.retryFailedCandidates, { generationId })
    ).rejects.toThrow(/Authentication required/);
    expect(
      await t.query(api.generations.getGenerationRecovery, { generationId })
    ).toBeNull();
  });
});

const MINUTES = 60 * 1000;

async function seedProject(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Reaper project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "reaper-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    return { userId, projectId, transcriptId };
  });
}

describe("failStaleGenerations candidate-run terminalization", () => {
  it("whole-fail also fails in-flight candidate runs so they can't spin forever", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const ids = await t.run(async (ctx) => {
      const old = Date.now() - 60 * MINUTES;
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "running",
        candidateMode: "compare",
        previousProjectStatus: "draft",
        startedAt: old,
      });
      await ctx.db.patch(projectId, { activeGenerationId: generationId });
      const runningRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "running",
        queuedAt: old,
        startedAt: old,
      });
      const queuedRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "queued",
        queuedAt: old,
      });
      return { generationId, runningRunId, queuedRunId };
    });

    await t.mutation(internal.generations.failStaleGenerations, {
      olderThanMinutes: 30,
    });

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(ids.generationId),
      runningRun: await ctx.db.get(ids.runningRunId),
      queuedRun: await ctx.db.get(ids.queuedRunId),
      project: await ctx.db.get(projectId),
    }));
    expect(state.generation?.status).toBe("failed");
    expect(state.runningRun?.status).toBe("failed");
    expect(state.runningRun?.error).toBe("Timed out before the draft completed.");
    expect(state.queuedRun?.status).toBe("failed");
    expect(state.project?.activeGenerationId).toBeUndefined();
    expect(state.project?.status).toBe("draft");
  });

  it("settles runs orphaned under an already-terminal generation, not runs under live ones", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const old = now - 60 * MINUTES;
      // Terminal generation (e.g. writer cancel) whose ghost died hard.
      const failedGenerationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "failed",
        candidateMode: "iterative",
        error: "Cancelled by writer",
        startedAt: old,
        completedAt: old,
      });
      const orphanRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId: failedGenerationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "running",
        ghost: true,
        queuedAt: old,
        startedAt: old,
      });
      // Superseded (CAP-7) is terminal too: a run stranded under it settles.
      const supersededGenerationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "superseded",
        candidateMode: "compare",
        startedAt: old,
        completedAt: old,
      });
      const supersededRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId: supersededGenerationId,
        projectId,
        model: "openai/gpt-5.1",
        label: "GPT-5.1",
        status: "queued",
        queuedAt: old,
      });
      // Live generation with a slow-but-alive run: whole-fail owns that case;
      // the orphan sweep must not reach past a non-terminal generation. Fresh
      // startedAt keeps it out of the whole-fail scan.
      const liveGenerationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "awaiting_input",
        candidateMode: "iterative",
        startedAt: now,
      });
      await ctx.db.patch(projectId, { activeGenerationId: liveGenerationId });
      const liveRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId: liveGenerationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "running",
        ghost: true,
        queuedAt: old,
        startedAt: old,
      });
      return { orphanRunId, supersededRunId, liveRunId };
    });

    const result = await t.mutation(internal.generations.failStaleGenerations, {
      olderThanMinutes: 30,
    });
    expect(result.orphanedRuns).toBe(2);

    const state = await t.run(async (ctx) => ({
      orphan: await ctx.db.get(ids.orphanRunId),
      superseded: await ctx.db.get(ids.supersededRunId),
      live: await ctx.db.get(ids.liveRunId),
    }));
    expect(state.orphan?.status).toBe("failed");
    expect(state.superseded?.status).toBe("failed");
    expect(state.orphan?.error).toBe(
      "The generation ended before this draft completed."
    );
    expect(state.live?.status).toBe("running");
  });

  it("failGeneration terminalizes in-flight runs alongside the generation", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "running",
        candidateMode: "compare",
        previousProjectStatus: "draft",
        startedAt: now,
      });
      await ctx.db.patch(projectId, { activeGenerationId: generationId });
      const runId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "running",
        queuedAt: now,
        startedAt: now,
      });
      const doneRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "succeeded",
        queuedAt: now,
        completedAt: now,
      });
      return { generationId, runId, doneRunId };
    });

    await t.mutation(internal.generations.failGeneration, {
      generationId: ids.generationId,
      error: "unknown: provider exploded with raw text",
    });

    const state = await t.run(async (ctx) => ({
      run: await ctx.db.get(ids.runId),
      doneRun: await ctx.db.get(ids.doneRunId),
    }));
    expect(state.run?.status).toBe("failed");
    expect(state.run?.error).toBe(
      "The generation failed before this draft completed."
    );
    // Terminal rows are never rewritten (status-CAS).
    expect(state.doneRun?.status).toBe("succeeded");
  });
});

describe("failStalePostQa", () => {
  it("fails stale passes (including legacy rows with no timestamp) and leaves fresh/terminal ones", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const base = {
        projectId,
        transcriptId,
        status: "completed" as const,
        candidateMode: "iterative" as const,
        startedAt: now - 120 * MINUTES,
        completedAt: now - 90 * MINUTES,
      };
      const staleId = await ctx.db.insert("generations", {
        ...base,
        postQaStatus: "running",
        postQaStartedAt: now - 20 * MINUTES,
        progressLog: ["Running the QA scorecard and chronology in the background…"],
      });
      const legacyId = await ctx.db.insert("generations", {
        ...base,
        postQaStatus: "running",
      });
      const freshId = await ctx.db.insert("generations", {
        ...base,
        postQaStatus: "running",
        postQaStartedAt: now - 2 * MINUTES,
      });
      const doneId = await ctx.db.insert("generations", {
        ...base,
        postQaStatus: "done",
        postQaStartedAt: now - 40 * MINUTES,
      });
      return { staleId, legacyId, freshId, doneId };
    });

    const result = await t.mutation(internal.generations.failStalePostQa, {
      olderThanMinutes: 15,
    });
    expect(result).toEqual({ failed: 2 });

    const state = await t.run(async (ctx) => ({
      stale: await ctx.db.get(ids.staleId),
      legacy: await ctx.db.get(ids.legacyId),
      fresh: await ctx.db.get(ids.freshId),
      done: await ctx.db.get(ids.doneId),
    }));
    expect(state.stale?.postQaStatus).toBe("failed");
    expect(state.stale?.progressLog?.at(-1)).toBe(
      "Post-assembly QA pass timed out — the report is unaffected. Run it again from the QA panel."
    );
    expect(state.legacy?.postQaStatus).toBe("failed");
    expect(state.fresh?.postQaStatus).toBe("running");
    expect(state.done?.postQaStatus).toBe("done");
  });

  it("unblocks requestReportQa after clearing a stale pass", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const staleStartedAt = Date.now() - 20 * MINUTES;
    const generationId = await t.run(async (ctx) => {
      const now = Date.now();
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        candidateMode: "iterative",
        postQaStatus: "running",
        postQaStartedAt: staleStartedAt,
        startedAt: now - 120 * MINUTES,
        completedAt: now - 90 * MINUTES,
      });
      // CAP-7: QA is gated on the report's existence, not just on status.
      await ctx.db.insert("reports", {
        projectId,
        generationId,
        content: "{}",
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
      return generationId;
    });
    const actor = t.withIdentity({ subject: authId });

    // Stuck: the idempotency guard refuses to restart while "running".
    await actor.mutation(api.generations.requestReportQa, { generationId });
    const before = await t.run(async (ctx) => await ctx.db.get(generationId));
    expect(before?.postQaStartedAt).toBe(staleStartedAt);

    await t.mutation(internal.generations.failStalePostQa, {
      olderThanMinutes: 15,
    });
    const reaped = await t.run(async (ctx) => await ctx.db.get(generationId));
    expect(reaped?.postQaStatus).toBe("failed");

    const requestedAt = Date.now();
    await actor.mutation(api.generations.requestReportQa, { generationId });
    const after = await t.run(async (ctx) => await ctx.db.get(generationId));
    expect(after?.postQaStatus).toBe("running");
    expect(after?.postQaStartedAt).toBeGreaterThanOrEqual(requestedAt);
  });
});

describe("getIterativeState user-safe error projection", () => {
  it("never ships raw provider text in errors or narration", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const generationId = await t.run(async (ctx) => {
      const now = Date.now();
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "awaiting_input",
        candidateMode: "iterative",
        error: "unknown: The AI provider rejected the request: RAWSECRET gpt text",
        progressLog: [
          "Section-by-section drafting with Sonnet 5.",
          "✗ Line 244 — Work performed draft failed: unknown: RAWSECRET gpt text.",
        ],
        startedAt: now,
      });
      await ctx.db.insert("generationSectionRuns", {
        generationId,
        projectId,
        section: "s242",
        status: "failed",
        error: "billing: RAWSECRET credit balance is too low",
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        attempt: 1,
        queuedAt: now,
      });
      await ctx.db.insert("generationSectionRuns", {
        generationId,
        projectId,
        section: "s244",
        status: "failed",
        error: "Timed out before the section draft completed.",
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        attempt: 1,
        queuedAt: now,
      });
      return generationId;
    });

    const state = await t
      .withIdentity({ subject: authId })
      .query(api.generations.getIterativeState, { generationId });

    expect(state?.error).toBe("The generation did not complete. Try again.");
    const bySection = new Map(
      (state?.sectionRuns ?? []).map((run) => [run.section, run])
    );
    // Known provider code → its typed copy.
    expect(bySection.get("s242")?.error).toBe(
      "The AI provider account cannot accept this request because billing or credits need attention."
    );
    // Our own copy (no code prefix) passes through unchanged.
    expect(bySection.get("s244")?.error).toBe(
      "Timed out before the section draft completed."
    );
    // Narration keeps the failure marker but drops the appended detail.
    expect(state?.progressLog).toEqual([
      "Section-by-section drafting with Sonnet 5.",
      "✗ Line 244 — Work performed draft failed.",
    ]);
    expect(JSON.stringify(state)).not.toContain("RAWSECRET");
  });
});

describe("requestReportQa report gate (CAP-7)", () => {
  it("rejects a completed generation without a report and runs when one exists", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const actor = t.withIdentity({ subject: authId });
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const base = {
        projectId,
        transcriptId,
        status: "completed" as const,
        candidateMode: "compare" as const,
        startedAt: now - 10 * MINUTES,
        completedAt: now - 5 * MINUTES,
      };
      const withoutReport = await ctx.db.insert("generations", base);
      const withReport = await ctx.db.insert("generations", base);
      await ctx.db.insert("reports", {
        projectId,
        generationId: withReport,
        content: "{}",
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
      return { withoutReport, withReport };
    });

    // Status alone is not enough: the report row must exist. Nothing is
    // written or scheduled on rejection.
    await expect(
      actor.mutation(api.generations.requestReportQa, { generationId: ids.withoutReport })
    ).rejects.toMatchObject({
      data: {
        code: "INVALID_STATE",
        message: expect.stringMatching(/no report/i),
      },
    });
    const bare = await t.run(async (ctx) => await ctx.db.get(ids.withoutReport));
    expect(bare?.postQaStatus).toBeUndefined();
    expect(bare?.postQaStartedAt).toBeUndefined();
    expect(await qaJobsFor(t, ids.withoutReport)).toHaveLength(0);

    // Positive control: the same shape with a report starts the pass.
    await actor.mutation(api.generations.requestReportQa, { generationId: ids.withReport });
    const reviewed = await t.run(async (ctx) => await ctx.db.get(ids.withReport));
    expect(reviewed?.postQaStatus).toBe("running");
    expect(await qaJobsFor(t, ids.withReport)).toHaveLength(1);
  });
});

describe("superseded is terminal (CAP-7)", () => {
  it("settles a late ghost run without a snapshot and refuses to be resurrected", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "superseded",
        candidateMode: "compare",
        startedAt: now - 10 * MINUTES,
        completedAt: now,
      });
      const ghostRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "running",
        ghost: true,
        queuedAt: now,
        startedAt: now,
      });
      return { generationId, ghostRunId };
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: ids.ghostRunId,
      content: "Late ghost draft",
      agentOutputs: "{}",
    });
    await t.mutation(internal.generations.updateGenerationStatus, {
      generationId: ids.generationId,
      status: "running",
      currentStep: "Zombie",
    });

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(ids.generationId),
      ghostRun: await ctx.db.get(ids.ghostRunId),
      snapshots: await ctx.db.query("reportSnapshots").collect(),
    }));
    // The run row terminalizes (no skewed stats), but a superseded generation
    // has no report, so no version-history snapshot is minted for it.
    expect(state.ghostRun?.status).toBe("succeeded");
    expect(state.snapshots).toHaveLength(0);
    expect(state.generation?.status).toBe("superseded");
    expect(state.generation?.currentStep).toBeUndefined();
  });
});
