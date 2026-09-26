/// <reference types="vite/client" />
/**
 * Round 2 (F3 to F5): the seed-step progress reads. getSubsection names the
 * pending batch (queued or running, with its times); getOutline adds when
 * each pending row's batch started and one pace for the run: the median time
 * of its finished batches, 20 seconds before any. An estimate, not measured
 * progress (open question 13).
 */
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { decisionFixture } from "./seedDecision.fixture";
import { DEFAULT_SEED_BATCH_MS } from "./seeds";

type Fixture = Awaited<ReturnType<typeof decisionFixture>>;

async function batch(
  s: Fixture,
  fields: { status: "queued" | "running" | "shown" | "superseded" | "failed"; queuedAt: number; startedAt?: number; completedAt?: number },
  roleId: "company_context" | "goal_problem" = "company_context"
): Promise<Id<"seedBatches">> {
  return await s.t.run(async (ctx) =>
    ctx.db.insert("seedBatches", {
      projectId: s.projectId,
      generationId: s.generationId,
      roleId,
      operation: "open",
      dedupeKey: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      consumedContextRevision: "context",
      briefVersionId: s.briefId,
      settingsHash: "settings",
      leaseExpiresAt: fields.queuedAt + 600_000,
      model: "model",
      slot: `generation:seeds:${roleId}`,
      promptVersion: "prompt",
      requestsReserved: 2,
      requestsMade: 0,
      ...fields,
    })
  );
}

async function pending(s: Fixture, batchId: Id<"seedBatches">, roleId: "company_context" | "goal_problem" = "company_context") {
  await s.t.run((ctx) => ctx.db.patch(s.subsectionIds[roleId]!, { pendingBatchId: batchId, state: "generating" }));
}

describe("seed-step progress reads", () => {
  it("names the running batch of a step and when it started", async () => {
    const s = await decisionFixture();
    const running = await batch(s, { status: "running", queuedAt: 1_000, startedAt: 1_500 });
    await pending(s, running);
    const step = await s.writer.query(api.seeds.getSubsection, { generationId: s.generationId, roleId: "company_context" });
    expect(step.pendingBatch).toEqual({ status: "running", queuedAt: 1_000, startedAt: 1_500 });

    const outline = await s.writer.query(api.seeds.getOutline, { generationId: s.generationId });
    const row = outline.rows.find((candidate) => candidate.roleId === "company_context");
    expect(row?.pendingStartedAt).toBe(1_500);
    expect(outline.rows.find((candidate) => candidate.roleId === "goal_problem")?.pendingStartedAt).toBeNull();
  });

  it("says a queued batch has not started, and nothing once it is shown", async () => {
    const s = await decisionFixture();
    const queued = await batch(s, { status: "queued", queuedAt: 2_000 });
    await pending(s, queued);
    const step = await s.writer.query(api.seeds.getSubsection, { generationId: s.generationId, roleId: "company_context" });
    expect(step.pendingBatch).toEqual({ status: "queued", queuedAt: 2_000 });
    const outline = await s.writer.query(api.seeds.getOutline, { generationId: s.generationId });
    expect(outline.rows.find((row) => row.roleId === "company_context")?.pendingStartedAt).toBe(2_000);

    await s.t.run((ctx) => ctx.db.patch(queued, { status: "shown", startedAt: 2_100, completedAt: 9_000 }));
    const after = await s.writer.query(api.seeds.getSubsection, { generationId: s.generationId, roleId: "company_context" });
    expect(after.pendingBatch).toBeNull();
  });

  it("paces by the median of this run's finished batches, 20 seconds before any", async () => {
    const s = await decisionFixture();
    expect((await s.writer.query(api.seeds.getOutline, { generationId: s.generationId })).expectedMs).toBe(
      DEFAULT_SEED_BATCH_MS
    );
    await batch(s, { status: "shown", queuedAt: 0, startedAt: 0, completedAt: 10_000 });
    await batch(s, { status: "superseded", queuedAt: 0, startedAt: 0, completedAt: 30_000 });
    await batch(s, { status: "shown", queuedAt: 0, startedAt: 0, completedAt: 14_000 }, "goal_problem");
    // Failed and unfinished batches do not count.
    await batch(s, { status: "failed", queuedAt: 0, startedAt: 0, completedAt: 1_000 });
    await batch(s, { status: "running", queuedAt: 0, startedAt: 0 });
    expect((await s.writer.query(api.seeds.getOutline, { generationId: s.generationId })).expectedMs).toBe(14_000);
  });
});
