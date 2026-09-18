/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
} from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { completeAttempt } from "./seedRuns";
import schema from "./schema";
import { PD_SUBSECTIONS } from "../shared/pdSubsections";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const MINUTE = 60 * 1_000;
const GENERATION_COUNT = 8;
const ATTEMPTS_PER_GENERATION = PD_SUBSECTIONS.length;
const ATTEMPT_COUNT = GENERATION_COUNT * ATTEMPTS_PER_GENERATION;
const ATTEMPTS_PER_STATUS = ATTEMPT_COUNT / 2;

type FunctionReferenceFromExport<Export> =
  Export extends RegisteredMutation<infer Visibility, infer Args, infer ReturnValue>
    ? FunctionReference<"mutation", Visibility, Args, Awaited<ReturnValue>>
    : never;

type CompleteAttemptRef = FunctionReferenceFromExport<typeof completeAttempt>;
const completeAttemptRef = makeFunctionReference<
  "mutation",
  FunctionArgs<CompleteAttemptRef>,
  FunctionReturnType<CompleteAttemptRef>
>("seedRuns:completeAttempt");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

type SeededRecovery = {
  batchIds: Id<"seedBatches">[];
  generationIds: Id<"generations">[];
  projectIds: Id<"projects">[];
  controlBatchIds: Id<"seedBatches">[];
  controlSubsectionIds: Id<"seedSubsections">[];
  controlGenerationId: Id<"generations">;
};

async function seedExpiredAttempts(
  t: ReturnType<typeof convexTest>
): Promise<SeededRecovery> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "seed-recovery-writer",
      role: "writer",
    });
    const batchIds: Id<"seedBatches">[] = [];
    const generationIds: Id<"generations">[] = [];
    const projectIds: Id<"projects">[] = [];
    let ordinal = 0;

    for (let generationIndex = 0; generationIndex < GENERATION_COUNT; generationIndex += 1) {
      const projectId = await ctx.db.insert("projects", {
        title: `Seed recovery ${generationIndex}`,
        clientName: "Client",
        status: "generating",
        createdBy: userId,
        shareToken: `seed-recovery-${generationIndex}`,
        createdAt: NOW - 5 * MINUTE,
        updatedAt: NOW,
      });
      const generationId = await ctx.db.insert("generations", {
        projectId,
        status: "awaiting_input",
        candidateMode: "iterative",
        gatedWorkflow: "seeds",
        startedAt: NOW - 5 * MINUTE,
        previousProjectStatus: "draft",
        seedStageVersion: 0,
        seedRequestsReserved: ATTEMPTS_PER_GENERATION * 2,
      });
      await ctx.db.patch(projectId, { activeGenerationId: generationId });
      const briefVersionId = await ctx.db.insert("generationBriefs", {
        projectId,
        generationId,
        inputsHash: `inputs-${generationIndex}`,
        version: 1,
        origin: "derived",
        storylineText: "Frozen recovery fixture Brief.",
        createdAt: NOW - 5 * MINUTE,
      });
      await ctx.db.patch(generationId, { briefId: briefVersionId, briefVersionId });

      projectIds.push(projectId);
      generationIds.push(generationId);
      for (const role of PD_SUBSECTIONS) {
        const status = ordinal < ATTEMPTS_PER_STATUS ? "queued" : "running";
        const batchId = await ctx.db.insert("seedBatches", {
          projectId,
          generationId,
          roleId: role.roleId,
          operation: "open",
          dedupeKey: `dedupe-${ordinal}`,
          commandId: `command-${ordinal}`,
          attemptId: `attempt-${ordinal}`,
          consumedContextRevision: `context-${ordinal}`,
          briefVersionId,
          settingsHash: "settings",
          status,
          queuedAt: NOW - 2 * MINUTE,
          leaseExpiresAt: NOW - 1,
          ...(status === "running" ? { startedAt: NOW - MINUTE } : {}),
          model: "claude-sonnet-5",
          slot: `generation:seeds:${role.roleId}`,
          promptVersion: `sha256:${"a".repeat(64)}`,
          requestsReserved: 2,
        });
        await ctx.db.insert("seedSubsections", {
          projectId,
          generationId,
          roleId: role.roleId,
          kind: role.kind,
          state: "generating",
          currentContextRevision: `context-${ordinal}`,
          selectionRevision: "selection",
          pendingBatchId: batchId,
          priorState: "untouched",
          consecutiveFailures: 0,
        });
        batchIds.push(batchId);
        ordinal += 1;
      }
    }
    const controlProjectId = await ctx.db.insert("projects", {
      title: "Future lease controls",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "seed-recovery-controls",
      createdAt: NOW - 5 * MINUTE,
      updatedAt: NOW,
    });
    const controlGenerationId = await ctx.db.insert("generations", {
      projectId: controlProjectId,
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      startedAt: NOW - 5 * MINUTE,
      previousProjectStatus: "draft",
      seedStageVersion: 0,
      seedRequestsReserved: 4,
    });
    await ctx.db.patch(controlProjectId, {
      activeGenerationId: controlGenerationId,
    });
    const controlBriefId = await ctx.db.insert("generationBriefs", {
      projectId: controlProjectId,
      generationId: controlGenerationId,
      inputsHash: "control-inputs",
      version: 1,
      origin: "derived",
      storylineText: "Future lease controls.",
      createdAt: NOW - 5 * MINUTE,
    });
    await ctx.db.patch(controlGenerationId, {
      briefId: controlBriefId,
      briefVersionId: controlBriefId,
    });
    const controlBatchIds: Id<"seedBatches">[] = [];
    const controlSubsectionIds: Id<"seedSubsections">[] = [];
    for (const [controlIndex, role] of PD_SUBSECTIONS.slice(0, 2).entries()) {
      const status = controlIndex === 0 ? "queued" : "running";
      const batchId = await ctx.db.insert("seedBatches", {
        projectId: controlProjectId,
        generationId: controlGenerationId,
        roleId: role.roleId,
        operation: "open",
        dedupeKey: `control-dedupe-${controlIndex}`,
        commandId: `control-command-${controlIndex}`,
        attemptId: `control-attempt-${controlIndex}`,
        consumedContextRevision: `control-context-${controlIndex}`,
        briefVersionId: controlBriefId,
        settingsHash: "settings",
        status,
        queuedAt: NOW - MINUTE,
        leaseExpiresAt: NOW + MINUTE,
        ...(status === "running" ? { startedAt: NOW - 30_000 } : {}),
        model: "claude-sonnet-5",
        slot: `generation:seeds:${role.roleId}`,
        promptVersion: `sha256:${"b".repeat(64)}`,
        requestsReserved: 2,
      });
      controlBatchIds.push(batchId);
      controlSubsectionIds.push(
        await ctx.db.insert("seedSubsections", {
          projectId: controlProjectId,
          generationId: controlGenerationId,
          roleId: role.roleId,
          kind: role.kind,
          state: "generating",
          currentContextRevision: `control-context-${controlIndex}`,
          selectionRevision: "selection",
          pendingBatchId: batchId,
          priorState: "untouched",
          consecutiveFailures: 0,
        })
      );
    }
    return {
      batchIds,
      generationIds,
      projectIds,
      controlBatchIds,
      controlSubsectionIds,
      controlGenerationId,
    };
  });
}

async function recoveryState(
  t: ReturnType<typeof convexTest>,
  seeded: SeededRecovery
) {
  return await t.run(async (ctx) => {
    const allSubsections = await ctx.db
      .query("seedSubsections")
      .take(ATTEMPT_COUNT + seeded.controlSubsectionIds.length + 1);
    return {
      batches: await Promise.all(seeded.batchIds.map((id) => ctx.db.get(id))),
      generations: await Promise.all(
        seeded.generationIds.map((id) => ctx.db.get(id))
      ),
      subsections: allSubsections.filter((row) =>
        seeded.generationIds.includes(row.generationId)
      ),
      events: await ctx.db.query("seedDecisionEvents").take(ATTEMPT_COUNT * 2 + 1),
      seeds: await ctx.db.query("seeds").take(1),
      controlBatches: await Promise.all(
        seeded.controlBatchIds.map((id) => ctx.db.get(id))
      ),
      controlSubsections: await Promise.all(
        seeded.controlSubsectionIds.map((id) => ctx.db.get(id))
      ),
      controlGeneration: await ctx.db.get(seeded.controlGenerationId),
    };
  });
}

describe("seed lease recovery through the existing generation cron", () => {
  it("drains multiple default pages of queued and running attempts without aging out generations", async () => {
    expect(ATTEMPTS_PER_STATUS).toBeGreaterThan(50);
    const t = convexTest(schema, modules);
    const seeded = await seedExpiredAttempts(t);

    await t.mutation(internal.generations.failStaleGenerations, {
      olderThanMinutes: 30,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const recovered = await recoveryState(t, seeded);
    expect(recovered.batches).toHaveLength(ATTEMPT_COUNT);
    expect(recovered.batches.every((batch) => batch?.status === "failed")).toBe(true);
    expect(
      recovered.batches.every(
        (batch) =>
          batch?.error === "LEASE_EXPIRED" &&
          batch.requestsMade === 2 &&
          batch.settledAt !== undefined
      )
    ).toBe(true);
    expect(recovered.subsections).toHaveLength(ATTEMPT_COUNT);
    expect(
      recovered.subsections.every(
        (row) =>
          row.pendingBatchId === undefined &&
          row.state === "untouched" &&
          row.consecutiveFailures === 1
      )
    ).toBe(true);
    expect(
      recovered.generations.every(
        (generation) =>
          generation?.status === "awaiting_input" &&
          generation.seedRequestsReserved === ATTEMPTS_PER_GENERATION * 2
      )
    ).toBe(true);
    expect(
      recovered.events.filter((event) => event.kind === "batchFailed")
    ).toHaveLength(ATTEMPT_COUNT);
    expect(recovered.controlBatches.map((batch) => batch?.status)).toEqual([
      "queued",
      "running",
    ]);
    expect(
      recovered.controlBatches.every(
        (batch) => batch?.settledAt === undefined && batch.requestsMade === undefined
      )
    ).toBe(true);
    expect(
      recovered.controlSubsections.every(
        (row, index) =>
          row?.state === "generating" &&
          row.pendingBatchId === seeded.controlBatchIds[index] &&
          row.consecutiveFailures === 0
      )
    ).toBe(true);
    expect(recovered.controlGeneration).toMatchObject({
      status: "awaiting_input",
      seedRequestsReserved: 4,
    });

    const firstSettledAt = recovered.batches.map((batch) => batch?.settledAt);
    await t.mutation(internal.generations.failStaleGenerations, {
      olderThanMinutes: 30,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const repeated = await recoveryState(t, seeded);
    expect(repeated.batches.map((batch) => batch?.settledAt)).toEqual(firstSettledAt);
    expect(
      repeated.events.filter((event) => event.kind === "batchFailed")
    ).toHaveLength(ATTEMPT_COUNT);

    const lateBatch = repeated.batches.find((batch) => batch !== null);
    if (!lateBatch) throw new Error("expected a recovered seed Batch");
    await t.mutation(completeAttemptRef, {
      batchId: lateBatch._id,
      attemptId: lateBatch.attemptId,
      requestsMade: 1,
      seeds: [],
    });
    const afterLate = await recoveryState(t, seeded);
    const sameBatch = afterLate.batches.find(
      (batch) => batch?._id === lateBatch._id
    );
    expect(sameBatch).toMatchObject({
      status: "failed",
      requestsMade: 2,
      settledAt: lateBatch.settledAt,
    });
    expect(afterLate.seeds).toEqual([]);
    const generation = afterLate.generations.find(
      (row) => row?._id === lateBatch.generationId
    );
    expect(generation).toMatchObject({
      status: "awaiting_input",
      seedRequestsReserved: ATTEMPTS_PER_GENERATION * 2,
    });
  });
});
