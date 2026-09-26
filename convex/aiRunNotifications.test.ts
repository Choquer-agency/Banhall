/// <reference types="vite/client" />
/**
 * Round 2 (WS3 spec section 6, F6): the three AI-run notifications a
 * generation raises for the writer who started it. Each is written once with
 * the writer as recipient, never for a prefetch Batch, never twice for a
 * retried mutation, and never when the writer switched that kind off.
 */
import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
} from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { claimAttempt, completeAttempt, dispatch } from "./seedRuns";
import { transitionGeneration } from "./lib/generationTransitions";
import { notifyIdeasReady } from "./lib/generations/notifications";
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../shared/pdSubsections";
import { emptyContextRevision, emptySelectionRevision } from "./lib/seedRevisions";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

type FunctionReferenceFromExport<Export> =
  Export extends RegisteredMutation<infer Visibility, infer Args, infer ReturnValue>
    ? FunctionReference<"mutation", Visibility, Args, Awaited<ReturnValue>>
    : never;

function mutationRef<Export>(name: string) {
  type Ref = FunctionReferenceFromExport<Export>;
  return makeFunctionReference<"mutation", FunctionArgs<Ref>, FunctionReturnType<Ref>>(name);
}

const dispatchRef = mutationRef<typeof dispatch>("seedRuns:dispatch");
const claimRef = mutationRef<typeof claimAttempt>("seedRuns:claimAttempt");
const completeRef = mutationRef<typeof completeAttempt>("seedRuns:completeAttempt");

const newTest = () => convexTest(schema, modules);
type T = ReturnType<typeof newTest>;
type GenerationFixture = Partial<Omit<Doc<"generations">, "_id" | "_creationTime">>;

const PROJECT_TITLE = "Helios pump retrofit";

async function insertBase(t: T) {
  return await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: "notify-writer",
      role: "writer",
      firstName: "Wren",
    });
    const otherId = await ctx.db.insert("users", {
      authId: "notify-other",
      role: "manager",
      firstName: "Omar",
    });
    const projectId = await ctx.db.insert("projects", {
      title: PROJECT_TITLE,
      clientName: "Client",
      status: "generating",
      createdBy: otherId,
      ownerId: otherId,
      shareToken: crypto.randomUUID(),
      createdAt: 1,
      updatedAt: 1,
    });
    return { writerId, otherId, projectId };
  });
}

async function switchOff(
  t: T,
  userId: Id<"users">,
  key: "ideasReady" | "draftReady" | "qaFinished"
) {
  await t.run((ctx) =>
    ctx.db.insert("notificationSettings", {
      userId,
      ...(key === "ideasReady" ? { ideasReady: false } : {}),
      ...(key === "draftReady" ? { draftReady: false } : {}),
      ...(key === "qaFinished" ? { qaFinished: false } : {}),
    })
  );
}

const notificationsFor = (t: T, userId: Id<"users">) =>
  t.run((ctx) =>
    ctx.db
      .query("notifications")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .take(50)
  );

const allNotifications = (t: T) => t.run((ctx) => ctx.db.query("notifications").take(50));

// ---------------------------------------------------------------- ideas_ready

async function seedFixture() {
  const t = convexTest(schema, modules);
  const base = await insertBase(t);
  const generationId = await t.run(async (ctx) => {
    const generationId = await ctx.db.insert("generations", {
      projectId: base.projectId,
      status: "awaiting_input",
      requestedBy: base.writerId,
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      startedAt: 1,
      previousProjectStatus: "draft",
      seedStageVersion: 0,
      seedRequestsReserved: 0,
      promptVersion: `sha256:${"a".repeat(64)}`,
      writerSettings: {
        profileState: "missing",
        source: "none",
        matchesProfile: false,
        savedProfileSuperseded: false,
        waiverAnalysis: "none",
        truncated: false,
      },
    });
    await ctx.db.patch(base.projectId, { activeGenerationId: generationId });
    await ctx.db.insert("generationArtifacts", { generationId, kind: "analysis", content: "{}" });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "brain_blocks",
      content: JSON.stringify({ blocks: {}, styleGuidance: "Use direct language.", styleOverrides: {} }),
    });
    const sourceContent = "Evidence alpha supports the work.";
    await ctx.db.insert("generationSources", {
      generationId,
      projectId: base.projectId,
      kind: "transcript",
      label: "Interview",
      content: sourceContent,
      contentHash: "source-hash",
      truncated: false,
      originalLength: sourceContent.length,
      capturedAt: 1,
    });
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: base.projectId,
      generationId,
      inputsHash: "brief-inputs",
      version: 1,
      origin: "derived",
      storylineText: "The team investigated a technical uncertainty.",
      createdAt: 1,
    });
    await ctx.db.patch(generationId, { briefId, briefVersionId: briefId });
    const currentContextRevision = await emptyContextRevision();
    const selectionRevision = await emptySelectionRevision();
    for (const role of PD_SUBSECTIONS) {
      await ctx.db.insert("seedSubsections", {
        projectId: base.projectId,
        generationId,
        roleId: role.roleId,
        kind: role.kind,
        state: "untouched",
        currentContextRevision,
        selectionRevision,
        consecutiveFailures: 0,
      });
    }
    return generationId;
  });
  return { t, ...base, generationId };
}

const validBatch = [
  { bullets: ["The team can test one conservative implementation."], tags: ["conservative" as const], provenance: [] },
  { bullets: ["A technical alternative can expose the governing constraint."], tags: ["technical" as const], provenance: [] },
  { bullets: ["A detailed trial can compare the competing configurations."], tags: ["detailed" as const], provenance: [] },
];

async function runBatch(
  s: Awaited<ReturnType<typeof seedFixture>>,
  roleId: PdSubsectionRoleId,
  operation: "open" | "prefetch"
) {
  const dispatched = await s.t.mutation(dispatchRef, {
    generationId: s.generationId,
    roleId,
    operation,
    commandId: crypto.randomUUID(),
    ...(operation === "open" ? { actorUserId: s.writerId } : {}),
  });
  if (dispatched.kind !== "dispatched") throw new Error(`${operation} was not dispatched`);
  const claim = await s.t.mutation(claimRef, { batchId: dispatched.batchId });
  if (claim.kind !== "claimed") throw new Error("attempt was not claimed");
  const complete = () =>
    s.t.mutation(completeRef, {
      batchId: dispatched.batchId,
      attemptId: claim.batch.attemptId,
      requestsMade: 1,
      seeds: validBatch,
      seedsDropped: 0,
    });
  expect(await complete()).toMatchObject({ kind: "completed" });
  return { batchId: dispatched.batchId, complete };
}

describe("ideas_ready", () => {
  it("tells the requester once when the first open Batch of a step is shown", async () => {
    const s = await seedFixture();
    const { complete } = await runBatch(s, "company_context", "open");

    const rows = await notificationsFor(s.t, s.writerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: s.writerId,
      kind: "ideas_ready",
      projectId: s.projectId,
      generationId: s.generationId,
      title: "Ideas are ready for Company / Context",
      body: `${PROJECT_TITLE}. Opens the Plan tab on that step.`,
      href: `/project/${s.projectId}?step=company_context`,
      dedupeKey: `ideas_ready:${s.generationId}:company_context`,
    });
    // Only the requester hears about it.
    expect(await notificationsFor(s.t, s.otherId)).toHaveLength(0);

    // A redelivered completion is late and writes nothing more; a second
    // emit for the same step is refused by the dedupe key.
    expect(await complete()).toMatchObject({ kind: "late" });
    await s.t.run(async (ctx) => {
      const generation = await ctx.db.get(s.generationId);
      expect(await notifyIdeasReady(ctx, generation!, "company_context")).toBeNull();
    });
    expect(await allNotifications(s.t)).toHaveLength(1);
  });

  it("stays quiet for a prefetch Batch", async () => {
    const s = await seedFixture();
    const { batchId } = await runBatch(s, "company_context", "prefetch");
    expect((await s.t.run((ctx) => ctx.db.get(batchId)))?.status).toBe("shown");
    expect(await allNotifications(s.t)).toHaveLength(0);
  });

  it("respects the requester's switch", async () => {
    const s = await seedFixture();
    await switchOff(s.t, s.writerId, "ideasReady");
    await runBatch(s, "company_context", "open");
    expect(await allNotifications(s.t)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- draft_ready

async function singleRunFixture() {
  const t = convexTest(schema, modules);
  const base = await insertBase(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId: base.projectId,
      label: "Interview",
      position: 0,
      content: "Alpha body",
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId: base.projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "running",
      requestedBy: base.writerId,
      candidateMode: "single",
      totalCandidates: 1,
      startedAt: now,
    });
    await ctx.db.patch(base.projectId, { activeGenerationId: generationId });
    const candidateId = await ctx.db.insert("reportCandidates", {
      projectId: base.projectId,
      generationId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      content: "Chosen draft",
      agentOutputs: "{}",
      createdAt: now,
    });
    const runId = await ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId: base.projectId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      status: "running",
      candidateId,
      queuedAt: now,
      startedAt: now,
    });
    return { generationId, runId };
  });
  const complete = () =>
    t.mutation(internal.generations.completeCandidateRun, {
      candidateRunId: ids.runId,
      content: "Chosen draft",
      agentOutputs: "{}",
    });
  return { t, ...base, ...ids, complete };
}

async function insertGeneration(t: T, projectId: Id<"projects">, fields: GenerationFixture) {
  return await t.run(async (ctx) => {
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "running",
      previousProjectStatus: "draft",
      startedAt: 1,
      ...fields,
    });
    return generationId;
  });
}

async function signOff(t: T, projectId: Id<"projects">, generationId: Id<"generations">, userId: Id<"users">) {
  await t.run(async (ctx) => {
    const briefVersionId = await ctx.db.insert("generationBriefs", {
      projectId,
      generationId,
      inputsHash: "hash",
      version: 1,
      origin: "derived",
      storylineText: "",
      droppedEntryCount: 0,
      createdAt: 1,
    });
    const summaryVersionId = await ctx.db.insert("summaryVersions", {
      projectId,
      generationId,
      version: 1,
      originGenerationId: generationId,
      briefVersionId,
      reportTitle: PROJECT_TITLE,
      settingsHash: "settings",
      skippedRoleIds: [],
      readiness: true,
      signedOffBy: userId,
      signedOffAt: 1,
    });
    await ctx.db.patch(generationId, { summaryVersionId });
  });
}

async function complete(t: T, generationId: Id<"generations">) {
  await t.run(async (ctx) => {
    const generation = await ctx.db.get(generationId);
    await transitionGeneration(ctx, generation!, "completed", { completedAt: Date.now() });
  });
}

describe("draft_ready", () => {
  it("tells the requester once when a Single draft completes, and not again on a retried completion", async () => {
    const s = await singleRunFixture();
    await s.complete();
    expect((await s.t.run((ctx) => ctx.db.get(s.generationId)))?.status).toBe("completed");

    const rows = await notificationsFor(s.t, s.writerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: s.writerId,
      kind: "draft_ready",
      projectId: s.projectId,
      generationId: s.generationId,
      title: "Your draft is ready",
      // A Single draft is scored during its run: no QA pass to wait for.
      body: `${PROJECT_TITLE}. Open it to read the draft.`,
      href: `/project/${s.projectId}`,
      dedupeKey: `draft_ready:${s.generationId}`,
    });

    await s.complete();
    expect(await allNotifications(s.t)).toHaveLength(1);
  });

  it("tells the requester when a signed-off Step-by-step draft completes", async () => {
    const t = convexTest(schema, modules);
    const base = await insertBase(t);
    const generationId = await insertGeneration(t, base.projectId, {
      requestedBy: base.writerId,
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
    });
    await signOff(t, base.projectId, generationId, base.writerId);
    await t.run(async (ctx) => {
      const generation = await ctx.db.get(generationId);
      await transitionGeneration(ctx, generation!, "completed", {
        completedAt: Date.now(),
        postQaStatus: "running",
      });
    });
    const rows = await notificationsFor(t, base.writerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "draft_ready",
      body: `${PROJECT_TITLE}. QA is checking it.`,
      dedupeKey: `draft_ready:${generationId}`,
      href: `/project/${base.projectId}`,
    });
  });

  it("stays quiet for flows that do not complete on their own", async () => {
    const t = convexTest(schema, modules);
    const base = await insertBase(t);
    // A compare run completes when the writer picks a candidate.
    const compareId = await insertGeneration(t, base.projectId, {
      requestedBy: base.writerId,
      candidateMode: "compare",
      status: "awaiting_selection",
    });
    await complete(t, compareId);
    // A section-approval run completes when the writer approves the last one.
    const sectionsId = await insertGeneration(t, base.projectId, {
      requestedBy: base.writerId,
      candidateMode: "iterative",
      gatedWorkflow: "sections",
      status: "awaiting_input",
    });
    await complete(t, sectionsId);
    expect(await allNotifications(t)).toHaveLength(0);
  });

  it("respects the requester's switch", async () => {
    const s = await singleRunFixture();
    await switchOff(s.t, s.writerId, "draftReady");
    await s.complete();
    expect((await s.t.run((ctx) => ctx.db.get(s.generationId)))?.status).toBe("completed");
    expect(await allNotifications(s.t)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- qa_finished

async function qaFixture(startedAt = 7) {
  const t = convexTest(schema, modules);
  const base = await insertBase(t);
  const generationId = await insertGeneration(t, base.projectId, {
    requestedBy: base.writerId,
    candidateMode: "single",
    status: "completed",
    postQaStatus: "running",
    postQaStartedAt: startedAt,
  });
  const save = (attemptStartedAt: number, extra: { qaScore?: number; failed?: boolean } = {}) =>
    t.mutation(internal.generations.saveReportQa, {
      generationId,
      attemptStartedAt,
      ...(extra.failed
        ? { failed: true }
        : { qa: JSON.stringify({ overall_score: extra.qaScore }), ...extra }),
    });
  return { t, ...base, generationId, save };
}

describe("qa_finished", () => {
  it("tells the requester once per finished pass", async () => {
    const s = await qaFixture(7);
    await s.save(7, { qaScore: 82 });
    const generation = await s.t.run((ctx) => ctx.db.get(s.generationId));
    expect(generation?.postQaStatus).toBe("done");
    const completedAt = generation!.postQaCompletedAt!;

    const rows = await notificationsFor(s.t, s.writerId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: s.writerId,
      kind: "qa_finished",
      projectId: s.projectId,
      generationId: s.generationId,
      title: "QA finished",
      body: `${PROJECT_TITLE}, score 82.`,
      href: `/project/${s.projectId}`,
      dedupeKey: `qa_finished:${s.generationId}:${completedAt}`,
    });
    expect(await notificationsFor(s.t, s.otherId)).toHaveLength(0);

    // A retried save of the same pass is refused by the attempt fence.
    await s.save(7, { qaScore: 82 });
    expect(await allNotifications(s.t)).toHaveLength(1);

    // A rerun from the QA panel is a new pass and notifies again.
    vi.setSystemTime(new Date("2026-09-26T12:05:00Z"));
    await s.t.run((ctx) =>
      ctx.db.patch(s.generationId, { postQaStatus: "running", postQaStartedAt: 9 })
    );
    await s.save(9, { qaScore: 90 });
    const after = await notificationsFor(s.t, s.writerId);
    expect(after).toHaveLength(2);
    expect(after.map((row) => row.body)).toContain(`${PROJECT_TITLE}, score 90.`);
  });

  it("stays quiet for a failed pass", async () => {
    const s = await qaFixture(7);
    await s.save(7, { failed: true });
    expect((await s.t.run((ctx) => ctx.db.get(s.generationId)))?.postQaStatus).toBe("failed");
    expect(await allNotifications(s.t)).toHaveLength(0);
  });

  it("respects the requester's switch", async () => {
    const s = await qaFixture(7);
    await switchOff(s.t, s.writerId, "qaFinished");
    await s.save(7, { qaScore: 82 });
    expect((await s.t.run((ctx) => ctx.db.get(s.generationId)))?.postQaStatus).toBe("done");
    expect(await allNotifications(s.t)).toHaveLength(0);
  });
});
