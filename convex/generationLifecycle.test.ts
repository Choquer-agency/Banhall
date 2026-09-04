/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DomainErrorCode } from "./lib/contracts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const AUTH_ID = "lifecycle-writer";
/** A writer who owns nothing on the fixture project and holds no work item. */
const OUTSIDER_AUTH_ID = "lifecycle-outsider";

/**
 * Assert a mutation rejected with a specific `domainError` code. Several
 * guards share a code (INVALID_STATE especially), so `messagePattern` pins the
 * rejection to the intended guard.
 */
async function expectDomainError(
  run: () => Promise<unknown>,
  code: DomainErrorCode,
  messagePattern?: RegExp
) {
  let thrown: unknown;
  let threw = false;
  try {
    await run();
  } catch (error) {
    thrown = error;
    threw = true;
  }
  expect(threw, `expected a ${code} rejection but the call resolved`).toBe(true);
  const data = (thrown as { data?: unknown } | null)?.data;
  expect(
    data !== null && typeof data === "object",
    `expected a ConvexError carrying domain-error data, got: ${String(thrown)}`
  ).toBe(true);
  const payload = data as { code?: unknown; message?: unknown };
  expect(payload.code).toBe(code);
  if (messagePattern) expect(String(payload.message)).toMatch(messagePattern);
}

/** Scheduled jobs whose function name contains `needle`. */
async function scheduledJobs(t: ReturnType<typeof convexTest>, needle: string) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
      job.name.includes(needle)
    )
  );
}

type RunSpec = {
  model: string;
  label: string;
  status: "queued" | "running" | "succeeded" | "failed";
  ghost?: boolean;
  /** When set, a `reportCandidates` row is seeded and linked to the run. */
  candidateContent?: string;
  candidateAgentOutputs?: string;
};

/**
 * Candidate-mode fixture: writer-owned project with one active generation and
 * a candidate run per spec. `activePointsElsewhere` seeds a second generation
 * as the project's active one so the fan-in CAS fence can be exercised.
 */
async function setupCompare(options: {
  candidateMode?: "compare" | "single" | "iterative";
  generationStatus?:
    | "running"
    | "awaiting_selection"
    | "awaiting_input"
    | "completed";
  totalCandidates?: number;
  /** What the project's status is restored to when the generation fails. */
  previousProjectStatus?:
    | "draft"
    | "generating"
    | "review"
    | "client_review"
    | "final";
  runs: RunSpec[];
  activePointsElsewhere?: boolean;
}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: AUTH_ID,
      role: "writer",
      name: "Lifecycle Writer",
    });
    const outsiderId = await ctx.db.insert("users", {
      authId: OUTSIDER_AUTH_ID,
      role: "writer",
      name: "Outsider Writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Lifecycle project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      ownerId: userId,
      shareToken: "lifecycle-token",
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
      status: options.generationStatus ?? "running",
      requestedBy: userId,
      candidateMode: options.candidateMode ?? "compare",
      previousProjectStatus: options.previousProjectStatus ?? "draft",
      totalCandidates: options.totalCandidates,
      candidatesDone: 0,
      candidatesFailed: 0,
      progressLog: ["Generation started."],
      startedAt: now,
    });
    let otherGenerationId: Id<"generations"> | undefined;
    if (options.activePointsElsewhere) {
      otherGenerationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "running",
        requestedBy: userId,
        candidateMode: "compare",
        startedAt: now,
      });
    }
    await ctx.db.patch(projectId, {
      activeGenerationId: otherGenerationId ?? generationId,
    });
    const runIds: Id<"generationCandidateRuns">[] = [];
    const candidateIds: Id<"reportCandidates">[] = [];
    for (const spec of options.runs) {
      let candidateId: Id<"reportCandidates"> | undefined;
      if (spec.candidateContent !== undefined) {
        candidateId = await ctx.db.insert("reportCandidates", {
          projectId,
          generationId,
          model: spec.model,
          label: spec.label,
          content: spec.candidateContent,
          agentOutputs: spec.candidateAgentOutputs ?? "{}",
          createdAt: now,
        });
        candidateIds.push(candidateId);
      }
      runIds.push(
        await ctx.db.insert("generationCandidateRuns", {
          generationId,
          projectId,
          model: spec.model,
          label: spec.label,
          status: spec.status,
          ...(spec.ghost ? { ghost: true } : {}),
          ...(candidateId ? { candidateId } : {}),
          queuedAt: now,
          startedAt: now,
          ...(spec.status === "succeeded" || spec.status === "failed"
            ? { completedAt: now }
            : {}),
        })
      );
    }
    return {
      userId,
      outsiderId,
      projectId,
      transcriptId,
      generationId,
      otherGenerationId,
      runIds,
      candidateIds,
    };
  });
  return {
    t,
    authed: t.withIdentity({ subject: AUTH_ID }),
    outsider: t.withIdentity({ subject: OUTSIDER_AUTH_ID }),
    ...ids,
  };
}

type SectionStatus =
  | "pending"
  | "queued"
  | "running"
  | "awaiting_review"
  | "approved"
  | "failed";

type SectionSpec = {
  status: SectionStatus;
  draftText?: string;
  approvedText?: string;
  attempt?: number;
};

/** Iterative fixture: three section runs plus an optional finished ghost. */
async function setupIterative(options: {
  sections: Record<"s242" | "s244" | "s246", SectionSpec>;
  /**
   * Seed a ghost run. An object or `"unparseable"` seeds a succeeded run plus
   * its candidate (carrying those section texts, or non-JSON); `"running"`
   * seeds a ghost that has not finished yet and therefore has no candidate.
   * Section keys may be omitted to leave that section ghost-less.
   */
  ghost?:
    | { section242?: string; section244?: string; section246?: string }
    | "unparseable"
    | "running";
  /** Pre-existing edit events (from earlier approvals in the same chain). */
  editEvents?: ("s242" | "s244")[];
}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: AUTH_ID,
      role: "writer",
      name: "Lifecycle Writer",
    });
    const outsiderId = await ctx.db.insert("users", {
      authId: OUTSIDER_AUTH_ID,
      role: "writer",
      name: "Outsider Writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Iterative project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      ownerId: userId,
      shareToken: "iterative-token",
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
      status: "awaiting_input",
      requestedBy: userId,
      candidateMode: "iterative",
      previousProjectStatus: "draft",
      progressLog: ["Generation started."],
      startedAt: now,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const sectionRunIds: Record<string, Id<"generationSectionRuns">> = {};
    for (const section of ["s242", "s244", "s246"] as const) {
      const spec = options.sections[section];
      sectionRunIds[section] = await ctx.db.insert("generationSectionRuns", {
        generationId,
        projectId,
        section,
        status: spec.status,
        ...(spec.draftText !== undefined ? { draftText: spec.draftText } : {}),
        ...(spec.approvedText !== undefined
          ? { approvedText: spec.approvedText }
          : {}),
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        attempt: spec.attempt ?? 1,
        queuedAt: now,
      });
    }
    for (const section of options.editEvents ?? []) {
      const approvedText = options.sections[section].approvedText;
      if (approvedText === undefined) {
        throw new Error(`editEvents requires ${section}.approvedText`);
      }
      await ctx.db.insert("sectionEditEvents", {
        projectId,
        generationId,
        section,
        draftText: `${section} draft`,
        approvedText,
        editRatio: 0.1,
        userId,
        createdAt: now,
      });
    }
    let ghostRunId: Id<"generationCandidateRuns"> | undefined;
    let ghostCandidateId: Id<"reportCandidates"> | undefined;
    if (options.ghost === "running") {
      ghostRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "running",
        ghost: true,
        queuedAt: now,
        startedAt: now,
      });
    } else if (options.ghost) {
      ghostCandidateId = await ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        content: "One-shot ghost draft content",
        agentOutputs:
          options.ghost === "unparseable"
            ? "not json"
            : JSON.stringify(options.ghost),
        createdAt: now,
      });
      ghostRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "succeeded",
        ghost: true,
        candidateId: ghostCandidateId,
        queuedAt: now,
        completedAt: now,
      });
    }
    return {
      userId,
      outsiderId,
      projectId,
      generationId,
      sectionRunIds: sectionRunIds as Record<
        "s242" | "s244" | "s246",
        Id<"generationSectionRuns">
      >,
      ghostRunId,
      ghostCandidateId,
    };
  });
  return {
    t,
    authed: t.withIdentity({ subject: AUTH_ID }),
    outsider: t.withIdentity({ subject: OUTSIDER_AUTH_ID }),
    ...ids,
  };
}

describe("completeCandidateRun fan-in", () => {
  it("keeps the generation running while a sibling candidate is still in flight", async () => {
    const { t, generationId, projectId, runIds } = await setupCompare({
      totalCandidates: 2,
      runs: [
        { model: "claude-sonnet-5", label: "Sonnet 5", status: "running" },
        {
          model: "google/gemini-3.1-pro-preview",
          label: "Gemini 3.1 Pro",
          status: "running",
        },
      ],
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[0],
      content: "First draft",
      agentOutputs: "{}",
      qaScore: 91,
    });

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      candidates: await ctx.db.query("reportCandidates").collect(),
      reports: await ctx.db.query("reports").collect(),
    }));
    expect(state.generation?.status).toBe("running");
    expect(state.generation?.candidatesDone).toBe(1);
    expect(state.generation?.candidatesFailed).toBe(0);
    expect(state.generation?.progressLog).toEqual([
      "Generation started.",
      "✓ Sonnet 5 draft ready (QA 91/100).",
    ]);
    expect(state.candidates).toHaveLength(1);
    expect(state.reports).toHaveLength(0);
    expect(state.project?.activeGenerationId).toBe(generationId);
  });

  it("moves to awaiting_selection when the last candidate lands", async () => {
    const { t, generationId, runIds } = await setupCompare({
      totalCandidates: 2,
      runs: [
        {
          model: "claude-sonnet-5",
          label: "Sonnet 5",
          status: "succeeded",
          candidateContent: "Sonnet draft",
        },
        {
          model: "google/gemini-3.1-pro-preview",
          label: "Gemini 3.1 Pro",
          status: "running",
        },
      ],
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[1],
      content: "Gemini draft",
      agentOutputs: "{}",
    });

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      candidates: await ctx.db.query("reportCandidates").collect(),
      reports: await ctx.db.query("reports").collect(),
    }));
    expect(state.generation?.status).toBe("awaiting_selection");
    expect(state.generation?.currentStep).toBe("Choose your preferred draft");
    expect(state.generation?.candidatesDone).toBe(2);
    expect(state.generation?.candidatesFailed).toBe(0);
    expect(state.candidates).toHaveLength(2);
    expect(state.reports).toHaveLength(0);
  });

  it("tallies a mixed fan-in when the last candidate succeeds after a failure", async () => {
    const { t, generationId, runIds } = await setupCompare({
      totalCandidates: 2,
      runs: [
        { model: "claude-sonnet-5", label: "Sonnet 5", status: "failed" },
        {
          model: "google/gemini-3.1-pro-preview",
          label: "Gemini 3.1 Pro",
          status: "running",
        },
      ],
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[1],
      content: "Gemini draft",
      agentOutputs: "{}",
    });

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      candidates: await ctx.db.query("reportCandidates").collect(),
      reports: await ctx.db.query("reports").collect(),
    }));
    expect(state.generation?.status).toBe("awaiting_selection");
    expect(state.generation?.candidatesDone).toBe(1);
    expect(state.generation?.candidatesFailed).toBe(1);
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]?.model).toBe("google/gemini-3.1-pro-preview");
    expect(state.reports).toHaveLength(0);
  });

  it("keeps the surviving candidate when the last run fails after a sibling succeeded", async () => {
    const { t, generationId, projectId, runIds } = await setupCompare({
      totalCandidates: 2,
      runs: [
        {
          model: "claude-sonnet-5",
          label: "Sonnet 5",
          status: "succeeded",
          candidateContent: "Sonnet draft",
        },
        {
          model: "google/gemini-3.1-pro-preview",
          label: "Gemini 3.1 Pro",
          status: "running",
        },
      ],
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[1],
      error: "provider rejected request",
    });

    const state = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[1]),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(state.run?.status).toBe("failed");
    expect(state.run?.error).toBe("provider rejected request");
    expect(state.generation?.status).toBe("awaiting_selection");
    expect(state.generation?.candidatesDone).toBe(1);
    expect(state.generation?.candidatesFailed).toBe(1);
    expect(state.generation?.progressLog).toEqual([
      "Generation started.",
      "✗ Gemini 3.1 Pro failed: provider rejected request.",
    ]);
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]?.model).toBe("claude-sonnet-5");
    expect(state.project?.activeGenerationId).toBe(generationId);
  });

  it("fails the generation and releases the project when every candidate failed", async () => {
    const { t, generationId, projectId, runIds } = await setupCompare({
      totalCandidates: 2,
      // Distinct from the `?? "draft"` fallback, so the assertion proves the
      // stored status is what gets restored.
      previousProjectStatus: "client_review",
      runs: [
        { model: "claude-sonnet-5", label: "Sonnet 5", status: "failed" },
        {
          model: "google/gemini-3.1-pro-preview",
          label: "Gemini 3.1 Pro",
          status: "running",
        },
      ],
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[1],
      error: "provider rejected request",
    });

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(state.generation?.status).toBe("failed");
    expect(state.generation?.error).toBe(
      "All candidate models failed to generate."
    );
    expect(state.generation?.candidatesDone).toBe(0);
    expect(state.generation?.candidatesFailed).toBe(2);
    expect(state.project?.activeGenerationId).toBeUndefined();
    expect(state.project?.status).toBe("client_review");
    expect(state.candidates).toHaveLength(0);
  });

  it("completes single mode straight through to a report", async () => {
    const { t, generationId, projectId, runIds } = await setupCompare({
      candidateMode: "single",
      totalCandidates: 1,
      runs: [{ model: "claude-sonnet-5", label: "Sonnet 5", status: "running" }],
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[0],
      content: "Only draft",
      agentOutputs: '{"section242":"a"}',
    });

    const state = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      reports: await ctx.db.query("reports").collect(),
      snapshots: await ctx.db.query("reportSnapshots").collect(),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(state.run?.status).toBe("succeeded");
    expect(state.run?.error).toBeUndefined();
    expect(typeof state.run?.completedAt).toBe("number");
    expect(state.generation?.status).toBe("completed");
    expect(state.generation?.currentStep).toBe("Complete");
    expect(state.generation?.candidatesDone).toBe(1);
    expect(state.generation?.candidatesFailed).toBe(0);
    expect(typeof state.generation?.completedAt).toBe("number");
    expect(state.generation?.agentOutputs).toBe('{"section242":"a"}');
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]).toMatchObject({
      content: "Only draft",
      generationId,
      revisionNumber: 0,
    });
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]).toMatchObject({ reason: "generated" });
    expect(state.project?.status).toBe("review");
    expect(state.project?.activeGenerationId).toBeUndefined();
    expect(state.candidates).toHaveLength(0);
  });

  it("is a silent no-op when the run already went terminal", async () => {
    const { t, generationId, runIds } = await setupCompare({
      totalCandidates: 2,
      runs: [
        {
          model: "claude-sonnet-5",
          label: "Sonnet 5",
          status: "succeeded",
          candidateContent: "Sonnet draft",
        },
        {
          model: "google/gemini-3.1-pro-preview",
          label: "Gemini 3.1 Pro",
          status: "running",
        },
      ],
    });
    const before = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
    }));

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[0],
      content: "A second, later draft",
      agentOutputs: "{}",
    });

    const after = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(after.run).toEqual(before.run);
    expect(after.generation).toEqual(before.generation);
    expect(after.candidates).toHaveLength(1);
  });

  it("is a silent no-op for a run that never started", async () => {
    const { t, generationId, runIds } = await setupCompare({
      totalCandidates: 1,
      runs: [{ model: "claude-sonnet-5", label: "Sonnet 5", status: "queued" }],
    });
    const before = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
    }));

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[0],
      content: "Draft from a run that was never marked running",
      agentOutputs: "{}",
    });

    const after = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
      candidates: await ctx.db.query("reportCandidates").collect(),
      reports: await ctx.db.query("reports").collect(),
    }));
    expect(after.run).toEqual(before.run);
    expect(after.generation).toEqual(before.generation);
    expect(after.candidates).toHaveLength(0);
    expect(after.reports).toHaveLength(0);
  });

  it("ignores a non-ghost run under an iterative generation awaiting input", async () => {
    const { t, generationId, projectId, runIds } = await setupCompare({
      candidateMode: "iterative",
      generationStatus: "awaiting_input",
      totalCandidates: 1,
      runs: [{ model: "claude-sonnet-5", label: "Sonnet 5", status: "running" }],
    });
    const before = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
    }));

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[0],
      content: "Not a ghost",
      agentOutputs: "{}",
    });

    // Only ghost runs may land while the generation waits on the writer.
    const after = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(after.run).toEqual(before.run);
    expect(after.generation).toEqual(before.generation);
    expect(after.project).toEqual(before.project);
    expect(after.candidates).toHaveLength(0);
  });

  it("is a silent no-op when the project's active generation moved on", async () => {
    const { t, generationId, projectId, runIds } = await setupCompare({
      totalCandidates: 1,
      activePointsElsewhere: true,
      runs: [{ model: "claude-sonnet-5", label: "Sonnet 5", status: "running" }],
    });
    const before = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
    }));

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[0],
      content: "Orphaned draft",
      agentOutputs: "{}",
    });

    const after = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      candidates: await ctx.db.query("reportCandidates").collect(),
      reports: await ctx.db.query("reports").collect(),
    }));
    expect(after.run).toEqual(before.run);
    expect(after.generation).toEqual(before.generation);
    expect(after.project).toEqual(before.project);
    expect(after.candidates).toHaveLength(0);
    expect(after.reports).toHaveLength(0);
  });

  it("records a ghost draft without advancing a live iterative generation", async () => {
    const { t, generationId, projectId, runIds } = await setupCompare({
      candidateMode: "iterative",
      generationStatus: "awaiting_input",
      totalCandidates: 1,
      runs: [
        {
          model: "google/gemini-3.1-pro-preview",
          label: "Gemini 3.1 Pro",
          status: "running",
          ghost: true,
        },
      ],
    });

    await t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: runIds[0],
      content: "Ghost draft",
      agentOutputs: "{}",
    });

    const state = await t.run(async (ctx) => ({
      run: await ctx.db.get(runIds[0]),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      candidates: await ctx.db.query("reportCandidates").collect(),
      reports: await ctx.db.query("reports").collect(),
    }));
    expect(state.run?.status).toBe("succeeded");
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]?.content).toBe("Ghost draft");
    expect(state.run?.candidateId).toBe(state.candidates[0]?._id);
    expect(state.generation?.status).toBe("awaiting_input");
    expect(state.generation?.progressLog).toEqual([
      "Generation started.",
      "✓ One-shot comparison draft ready (Gemini 3.1 Pro).",
    ]);
    expect(state.project?.status).toBe("generating");
    expect(state.project?.activeGenerationId).toBe(generationId);
    expect(state.reports).toHaveLength(0);
  });
});

describe("approveSectionDraft", () => {
  it("queues the next section and records the writer's edit", async () => {
    const { t, authed, generationId, projectId, sectionRunIds } =
      await setupIterative({
        sections: {
          s242: { status: "awaiting_review", draftText: "alpha beta gamma" },
          s244: { status: "pending" },
          s246: { status: "pending" },
        },
      });

    const result = await authed.mutation(api.generations.approveSectionDraft, {
      generationId,
      section: "s242",
      text: "alpha beta delta",
      // Matches the seeded run.attempt, so the fence must accept it.
      attempt: 1,
    });

    expect(result).toBeNull();
    const state = await t.run(async (ctx) => ({
      s242: await ctx.db.get(sectionRunIds.s242),
      s244: await ctx.db.get(sectionRunIds.s244),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      events: await ctx.db.query("sectionEditEvents").collect(),
      reports: await ctx.db.query("reports").collect(),
    }));
    expect(state.s242?.status).toBe("approved");
    expect(state.s242?.approvedText).toBe("alpha beta delta");
    expect(typeof state.s242?.completedAt).toBe("number");
    expect(state.s244?.status).toBe("queued");
    expect(state.generation?.status).toBe("running");
    expect(state.generation?.currentStep).toBe(
      "Drafting Line 244 — Work performed…"
    );
    expect(state.generation?.progressLog).toEqual([
      "Generation started.",
      "✓ Line 242 — Uncertainty approved by the writer.",
      "Drafting Line 244 — Work performed…",
    ]);
    expect(state.project?.status).toBe("generating");
    expect(state.reports).toHaveLength(0);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      section: "s242",
      draftText: "alpha beta gamma",
      approvedText: "alpha beta delta",
    });
    // "alpha beta gamma" → "alpha beta delta": 2 of the draft's 3 words survive.
    expect(state.events[0]!.editRatio).toBeCloseTo(1 / 3, 10);

    const jobs = await scheduledJobs(t, "generateSection");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.args[0]).toMatchObject({ generationId, section: "s244" });
  });

  it("assembles the report and hands off to post-QA on the final approval", async () => {
    const { t, authed, generationId, projectId } = await setupIterative({
      sections: {
        s242: { status: "approved", approvedText: "Uncertainty text" },
        s244: { status: "approved", approvedText: "Work performed text" },
        s246: { status: "awaiting_review", draftText: "Advancement draft" },
      },
    });

    const reportId = await authed.mutation(
      api.generations.approveSectionDraft,
      { generationId, section: "s246", text: "Advancement approved" }
    );

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      reports: await ctx.db.query("reports").collect(),
      snapshots: await ctx.db.query("reportSnapshots").collect(),
    }));
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]?._id).toBe(reportId);
    expect(state.reports[0]?.generationId).toBe(generationId);
    const content = state.reports[0]?.content ?? "";
    const offsets = [
      content.indexOf("Uncertainty text"),
      content.indexOf("Work performed text"),
      content.indexOf("Advancement approved"),
    ];
    // Every approved section survives, in SECTION_ORDER.
    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(JSON.parse(state.generation?.agentOutputs ?? "{}")).toMatchObject({
      section242: "Uncertainty text",
      section244: "Work performed text",
      section246: "Advancement approved",
      iterative: true,
    });
    expect(state.generation?.status).toBe("completed");
    expect(state.generation?.currentStep).toBe("Complete");
    expect(state.generation?.postQaStatus).toBe("running");
    expect(state.project?.status).toBe("review");
    expect(state.project?.activeGenerationId).toBeUndefined();
    // Only the report's own generated baseline — no ghost comparison row.
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]?.reason).toBe("generated");

    const jobs = await scheduledJobs(t, "runReportQa");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.args[0]).toMatchObject({ generationId });
  });

  it("preserves a finished ghost draft as a comparison snapshot on final approval", async () => {
    const { t, authed, generationId, ghostRunId, ghostCandidateId } =
      await setupIterative({
        sections: {
          s242: { status: "approved", approvedText: "Uncertainty text" },
          s244: { status: "approved", approvedText: "Work performed text" },
          s246: { status: "awaiting_review", draftText: "Advancement draft" },
        },
        editEvents: ["s242", "s244"],
        ghost: {
          section242: "Ghost 242",
          section244: "Ghost 244",
          section246: "Ghost 246",
        },
      });

    await authed.mutation(api.generations.approveSectionDraft, {
      generationId,
      section: "s246",
      text: "Advancement approved",
    });

    const state = await t.run(async (ctx) => ({
      snapshots: await ctx.db.query("reportSnapshots").collect(),
      ghostRun: await ctx.db.get(ghostRunId!),
      ghostCandidate: await ctx.db.get(ghostCandidateId!),
      candidates: await ctx.db.query("reportCandidates").collect(),
      events: await ctx.db.query("sectionEditEvents").collect(),
    }));
    expect(state.snapshots).toHaveLength(2);
    const baseline = state.snapshots.find(
      (snapshot) => snapshot.label === "AI draft (Iterative — Sonnet 5)"
    );
    const ghost = state.snapshots.find(
      (snapshot) =>
        snapshot.label === "One-shot ghost draft (comparison — Gemini 3.1 Pro)"
    );
    expect(baseline).toBeDefined();
    expect(ghost).toMatchObject({
      reason: "generated",
      content: "One-shot ghost draft content",
      reportId: baseline!.reportId,
    });
    // The report's own baseline must be written before the ghost snapshot so
    // postEditDistance's `.first()` keeps finding the real baseline.
    expect(baseline!._creationTime).toBeLessThanOrEqual(ghost!._creationTime);
    expect(state.snapshots[0]?._id).toBe(baseline!._id);
    expect(state.ghostRun?.status).toBe("succeeded");
    expect(state.ghostRun?.candidateId).toBeUndefined();
    expect(state.ghostCandidate).toBeNull();
    expect(state.candidates).toHaveLength(0);
    expect(state.events).toHaveLength(3);
    expect(
      Object.fromEntries(
        state.events.map((event) => [event.section, event.ghostText])
      )
    ).toEqual({
      s242: "Ghost 242",
      s244: "Ghost 244",
      s246: "Ghost 246",
    });
  });

  it("leaves a section ghost-less when the ghost outputs omit it", async () => {
    const { t, authed, generationId, ghostRunId } = await setupIterative({
      sections: {
        s242: { status: "approved", approvedText: "Uncertainty text" },
        s244: { status: "approved", approvedText: "Work performed text" },
        s246: { status: "awaiting_review", draftText: "Advancement draft" },
      },
      editEvents: ["s242", "s244"],
      // section244 is whitespace-only and section246 is missing: neither may
      // land as ghostText, while section242 still does.
      ghost: { section242: "Ghost 242", section244: "   " },
    });

    await authed.mutation(api.generations.approveSectionDraft, {
      generationId,
      section: "s246",
      text: "Advancement approved",
    });

    const state = await t.run(async (ctx) => ({
      snapshots: await ctx.db.query("reportSnapshots").collect(),
      ghostRun: await ctx.db.get(ghostRunId!),
      events: await ctx.db.query("sectionEditEvents").collect(),
    }));
    expect(state.snapshots).toHaveLength(2);
    expect(state.ghostRun?.candidateId).toBeUndefined();
    expect(state.events).toHaveLength(3);
    expect(
      Object.fromEntries(
        state.events.map((event) => [event.section, event.ghostText])
      )
    ).toEqual({ s242: "Ghost 242", s244: undefined, s246: undefined });
  });

  it("finishes without a comparison snapshot when the ghost is still running", async () => {
    const { t, authed, generationId, projectId, ghostRunId } =
      await setupIterative({
        sections: {
          s242: { status: "approved", approvedText: "Uncertainty text" },
          s244: { status: "approved", approvedText: "Work performed text" },
          s246: { status: "awaiting_review", draftText: "Advancement draft" },
        },
        editEvents: ["s242", "s244"],
        ghost: "running",
      });

    await authed.mutation(api.generations.approveSectionDraft, {
      generationId,
      section: "s246",
      text: "Advancement approved",
    });

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      ghostRun: await ctx.db.get(ghostRunId!),
      reports: await ctx.db.query("reports").collect(),
      snapshots: await ctx.db.query("reportSnapshots").collect(),
      events: await ctx.db.query("sectionEditEvents").collect(),
    }));
    // The generation still completes normally; only the ghost extras are
    // skipped. The late ghost is left to completeCandidateRun's terminal path.
    expect(state.generation?.status).toBe("completed");
    expect(state.project?.status).toBe("review");
    expect(state.reports).toHaveLength(1);
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0]?.label).toBe("AI draft (Iterative — Sonnet 5)");
    expect(state.ghostRun?.status).toBe("running");
    expect(state.events).toHaveLength(3);
    expect(state.events.every((event) => event.ghostText === undefined)).toBe(
      true
    );
    expect(await scheduledJobs(t, "runReportQa")).toHaveLength(1);
  });

  it("still snapshots a ghost whose agent outputs cannot be parsed", async () => {
    const { t, authed, generationId, ghostRunId } = await setupIterative({
      sections: {
        s242: { status: "approved", approvedText: "Uncertainty text" },
        s244: { status: "approved", approvedText: "Work performed text" },
        s246: { status: "awaiting_review", draftText: "Advancement draft" },
      },
      editEvents: ["s242", "s244"],
      ghost: "unparseable",
    });

    await authed.mutation(api.generations.approveSectionDraft, {
      generationId,
      section: "s246",
      text: "Advancement approved",
    });

    const state = await t.run(async (ctx) => ({
      snapshots: await ctx.db.query("reportSnapshots").collect(),
      ghostRun: await ctx.db.get(ghostRunId!),
      candidates: await ctx.db.query("reportCandidates").collect(),
      events: await ctx.db.query("sectionEditEvents").collect(),
    }));
    // The comparison snapshot and the candidate cleanup are unaffected by the
    // unparseable outputs; only the ghostText enrichment is skipped.
    expect(state.snapshots).toHaveLength(2);
    expect(state.snapshots[1]?.label).toBe(
      "One-shot ghost draft (comparison — Gemini 3.1 Pro)"
    );
    expect(state.ghostRun?.candidateId).toBeUndefined();
    expect(state.candidates).toHaveLength(0);
    expect(state.events).toHaveLength(3);
    expect(state.events.every((event) => event.ghostText === undefined)).toBe(
      true
    );
  });

  it("refuses an approval from a writer with no edit access to the project", async () => {
    const { t, outsider, generationId, projectId, sectionRunIds } =
      await setupIterative({
        sections: {
          s242: { status: "awaiting_review", draftText: "alpha" },
          s244: { status: "pending" },
          s246: { status: "pending" },
        },
      });

    await expectDomainError(
      () =>
        outsider.mutation(api.generations.approveSectionDraft, {
          generationId,
          section: "s242",
          text: "alpha approved",
        }),
      "NOT_AUTHORIZED"
    );

    const state = await t.run(async (ctx) => ({
      s242: await ctx.db.get(sectionRunIds.s242),
      s244: await ctx.db.get(sectionRunIds.s244),
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      events: await ctx.db.query("sectionEditEvents").collect(),
      reports: await ctx.db.query("reports").collect(),
    }));
    expect(state.s242?.status).toBe("awaiting_review");
    expect(state.s242?.approvedText).toBeUndefined();
    expect(state.s244?.status).toBe("pending");
    expect(state.generation?.status).toBe("awaiting_input");
    expect(state.project?.status).toBe("generating");
    expect(state.events).toHaveLength(0);
    expect(state.reports).toHaveLength(0);
    expect(await scheduledJobs(t, "generateSection")).toHaveLength(0);
  });

  it("rejects an approval carrying a stale attempt number", async () => {
    const { t, authed, generationId, sectionRunIds } = await setupIterative({
      sections: {
        s242: { status: "awaiting_review", draftText: "alpha", attempt: 2 },
        s244: { status: "pending" },
        s246: { status: "pending" },
      },
    });

    await expectDomainError(
      () =>
        authed.mutation(api.generations.approveSectionDraft, {
          generationId,
          section: "s242",
          text: "alpha edited",
          attempt: 1,
        }),
      "STALE_REVISION"
    );

    const state = await t.run(async (ctx) => ({
      s242: await ctx.db.get(sectionRunIds.s242),
      events: await ctx.db.query("sectionEditEvents").collect(),
    }));
    expect(state.s242?.status).toBe("awaiting_review");
    expect(state.s242?.approvedText).toBeUndefined();
    expect(state.events).toHaveLength(0);
    expect(await scheduledJobs(t, "generateSection")).toHaveLength(0);
  });

  it("refuses to approve a section before its predecessors", async () => {
    const { t, authed, generationId, sectionRunIds } = await setupIterative({
      sections: {
        s242: { status: "awaiting_review", draftText: "alpha" },
        s244: { status: "awaiting_review", draftText: "beta" },
        s246: { status: "pending" },
      },
    });

    await expectDomainError(
      () =>
        authed.mutation(api.generations.approveSectionDraft, {
          generationId,
          section: "s244",
          text: "beta approved",
        }),
      "INVALID_STATE",
      /Earlier sections must be approved first/
    );

    const state = await t.run(async (ctx) => ({
      s244: await ctx.db.get(sectionRunIds.s244),
      events: await ctx.db.query("sectionEditEvents").collect(),
    }));
    expect(state.s244?.status).toBe("awaiting_review");
    expect(state.s244?.approvedText).toBeUndefined();
    expect(state.events).toHaveLength(0);
    expect(await scheduledJobs(t, "generateSection")).toHaveLength(0);
  });

  it("refuses an empty approved text", async () => {
    const { t, authed, generationId, sectionRunIds } = await setupIterative({
      sections: {
        s242: { status: "awaiting_review", draftText: "alpha" },
        s244: { status: "pending" },
        s246: { status: "pending" },
      },
    });

    await expectDomainError(
      () =>
        authed.mutation(api.generations.approveSectionDraft, {
          generationId,
          section: "s242",
          text: "   ",
        }),
      "INVALID_INPUT"
    );

    const state = await t.run(async (ctx) => ({
      s242: await ctx.db.get(sectionRunIds.s242),
      s244: await ctx.db.get(sectionRunIds.s244),
      events: await ctx.db.query("sectionEditEvents").collect(),
    }));
    expect(state.s242?.status).toBe("awaiting_review");
    expect(state.s244?.status).toBe("pending");
    expect(state.events).toHaveLength(0);
    expect(await scheduledJobs(t, "generateSection")).toHaveLength(0);
  });
});

describe("selectReportCandidate", () => {
  it("creates the report, records the selection, and clears the candidates", async () => {
    const { t, authed, generationId, projectId, userId, candidateIds } =
      await setupCompare({
        generationStatus: "awaiting_selection",
        totalCandidates: 2,
        runs: [
          {
            model: "claude-sonnet-5",
            label: "Sonnet 5",
            status: "succeeded",
            candidateContent: "Sonnet draft",
            candidateAgentOutputs: '{"section242":"chosen"}',
          },
          {
            model: "google/gemini-3.1-pro-preview",
            label: "Gemini 3.1 Pro",
            status: "succeeded",
            candidateContent: "Gemini draft",
          },
        ],
      });

    const reportId = await authed.mutation(
      api.generations.selectReportCandidate,
      { generationId, candidateId: candidateIds[0] }
    );

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      reports: await ctx.db.query("reports").collect(),
      selections: await ctx.db.query("modelSelections").collect(),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]?._id).toBe(reportId);
    expect(state.reports[0]?.content).toBe("Sonnet draft");
    expect(state.generation?.status).toBe("completed");
    expect(state.generation?.currentStep).toBe("Complete");
    expect(typeof state.generation?.completedAt).toBe("number");
    expect(state.generation?.agentOutputs).toBe('{"section242":"chosen"}');
    expect(state.project?.status).toBe("review");
    expect(state.project?.activeGenerationId).toBeUndefined();
    expect(state.selections).toHaveLength(1);
    expect(state.selections[0]).toMatchObject({
      projectId,
      generationId,
      candidateId: candidateIds[0],
      userId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
    });
    expect(state.candidates).toHaveLength(0);
  });

  it("refuses a candidate that belongs to another generation", async () => {
    const { t, authed, generationId, projectId, otherGenerationId } =
      await setupCompare({
        generationStatus: "awaiting_selection",
        totalCandidates: 1,
        activePointsElsewhere: true,
        runs: [],
      });
    // Re-point the project at the generation under test so only the candidate
    // ownership check can fail.
    const foreignCandidateId = await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { activeGenerationId: generationId });
      return await ctx.db.insert("reportCandidates", {
        projectId,
        generationId: otherGenerationId!,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        content: "Foreign draft",
        agentOutputs: "{}",
        createdAt: Date.now(),
      });
    });

    await expectDomainError(
      () =>
        authed.mutation(api.generations.selectReportCandidate, {
          generationId,
          candidateId: foreignCandidateId,
        }),
      "NOT_AUTHORIZED",
      /does not belong to this generation/
    );

    const state = await t.run(async (ctx) => ({
      reports: await ctx.db.query("reports").collect(),
      selections: await ctx.db.query("modelSelections").collect(),
      generation: await ctx.db.get(generationId),
    }));
    expect(state.reports).toHaveLength(0);
    expect(state.selections).toHaveLength(0);
    expect(state.generation?.status).toBe("awaiting_selection");
  });

  it("refuses selection on a section-by-section generation", async () => {
    const { t, authed, generationId, candidateIds } = await setupCompare({
      candidateMode: "iterative",
      generationStatus: "awaiting_selection",
      totalCandidates: 1,
      runs: [
        {
          model: "claude-sonnet-5",
          label: "Sonnet 5",
          status: "succeeded",
          candidateContent: "Ghost draft",
        },
      ],
    });

    await expectDomainError(
      () =>
        authed.mutation(api.generations.selectReportCandidate, {
          generationId,
          candidateId: candidateIds[0],
        }),
      "INVALID_STATE",
      /approved per section, not selected/
    );

    const state = await t.run(async (ctx) => ({
      reports: await ctx.db.query("reports").collect(),
      selections: await ctx.db.query("modelSelections").collect(),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(state.reports).toHaveLength(0);
    expect(state.selections).toHaveLength(0);
    expect(state.candidates).toHaveLength(1);
  });

  it("refuses selection while the generation is not awaiting selection", async () => {
    const { t, authed, generationId, candidateIds } = await setupCompare({
      generationStatus: "running",
      totalCandidates: 2,
      runs: [
        {
          model: "claude-sonnet-5",
          label: "Sonnet 5",
          status: "succeeded",
          candidateContent: "Sonnet draft",
        },
      ],
    });

    await expectDomainError(
      () =>
        authed.mutation(api.generations.selectReportCandidate, {
          generationId,
          candidateId: candidateIds[0],
        }),
      "STALE_REVISION"
    );

    const state = await t.run(async (ctx) => ({
      reports: await ctx.db.query("reports").collect(),
      selections: await ctx.db.query("modelSelections").collect(),
      generation: await ctx.db.get(generationId),
    }));
    expect(state.reports).toHaveLength(0);
    expect(state.selections).toHaveLength(0);
    expect(state.generation?.status).toBe("running");
  });

  it("refuses selection when the project moved on to another generation", async () => {
    const { t, authed, generationId, candidateIds } = await setupCompare({
      generationStatus: "awaiting_selection",
      totalCandidates: 1,
      activePointsElsewhere: true,
      runs: [
        {
          model: "claude-sonnet-5",
          label: "Sonnet 5",
          status: "succeeded",
          candidateContent: "Sonnet draft",
        },
      ],
    });

    await expectDomainError(
      () =>
        authed.mutation(api.generations.selectReportCandidate, {
          generationId,
          candidateId: candidateIds[0],
        }),
      "STALE_REVISION"
    );

    const state = await t.run(async (ctx) => ({
      reports: await ctx.db.query("reports").collect(),
      selections: await ctx.db.query("modelSelections").collect(),
    }));
    expect(state.reports).toHaveLength(0);
    expect(state.selections).toHaveLength(0);
  });

  // selectReportCandidate's awaiting_selection fence (see its "run-guard
  // deploy" comment in convex/generations.ts) deliberately accepts an unset
  // activeGenerationId so generations that predate the run guard stay
  // selectable. Tightening it to strict equality would leave every other case
  // green.
  it("still selects when the project carries no active generation pointer", async () => {
    const { t, authed, generationId, projectId, candidateIds } =
      await setupCompare({
        generationStatus: "awaiting_selection",
        totalCandidates: 1,
        runs: [
          {
            model: "claude-sonnet-5",
            label: "Sonnet 5",
            status: "succeeded",
            candidateContent: "Sonnet draft",
          },
        ],
      });
    await t.run((ctx) =>
      ctx.db.patch(projectId, { activeGenerationId: undefined })
    );

    const reportId = await authed.mutation(
      api.generations.selectReportCandidate,
      { generationId, candidateId: candidateIds[0] }
    );

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      reports: await ctx.db.query("reports").collect(),
      selections: await ctx.db.query("modelSelections").collect(),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]?._id).toBe(reportId);
    expect(state.generation?.status).toBe("completed");
    expect(state.project?.status).toBe("review");
    expect(state.project?.activeGenerationId).toBeUndefined();
    expect(state.selections).toHaveLength(1);
    expect(state.candidates).toHaveLength(0);
  });

  it("refuses a selection from a writer with no edit access to the project", async () => {
    const { t, outsider, generationId, projectId, candidateIds } =
      await setupCompare({
        generationStatus: "awaiting_selection",
        totalCandidates: 1,
        runs: [
          {
            model: "claude-sonnet-5",
            label: "Sonnet 5",
            status: "succeeded",
            candidateContent: "Sonnet draft",
          },
        ],
      });

    await expectDomainError(
      () =>
        outsider.mutation(api.generations.selectReportCandidate, {
          generationId,
          candidateId: candidateIds[0],
        }),
      "NOT_AUTHORIZED"
    );

    const state = await t.run(async (ctx) => ({
      generation: await ctx.db.get(generationId),
      project: await ctx.db.get(projectId),
      reports: await ctx.db.query("reports").collect(),
      selections: await ctx.db.query("modelSelections").collect(),
      candidates: await ctx.db.query("reportCandidates").collect(),
    }));
    expect(state.reports).toHaveLength(0);
    expect(state.selections).toHaveLength(0);
    expect(state.candidates).toHaveLength(1);
    expect(state.generation?.status).toBe("awaiting_selection");
    expect(state.project?.activeGenerationId).toBe(generationId);
  });
});
