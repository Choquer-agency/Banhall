/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { OrderedPayload } from "./lib/orderedChain";
import { persistOrderedPayload } from "./lib/orderedPayloadStore";

const modules = import.meta.glob("./**/*.ts");

const PAYLOAD: OrderedPayload = {
  analysis: JSON.stringify({ project_goal: "Stabilize the control loop" }),
  brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
  orderedContext: {
    profileState: "applied",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: [],
  },
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "payload-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Payload",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      ownerId: userId,
      shareToken: "payload-token",
      createdAt: 1,
      updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "running",
      candidateMode: "single",
      requestedBy: userId,
      startedAt: Date.now(),
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      status: "running",
      queuedAt: 1,
      startedAt: 1,
    });
    return { userId, projectId, generationId, candidateRunId };
  });
  return { t, ...ids };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function scheduled(f: Fixture, name: string) {
  return await f.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name === name
    )
  );
}

async function payloadRows(f: Fixture) {
  return await f.t.run((ctx) =>
    ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) =>
        q.eq("generationId", f.generationId).eq("kind", "ordered_payload")
      )
      .collect()
  );
}

describe("ordered chain payload stored once", () => {
  it("createOrderedSectionRuns stores the payload and schedules the first section by id", async () => {
    const f = await setup();
    expect(
      await f.t.mutation(internal.generations.createOrderedSectionRuns, {
        generationId: f.generationId,
        candidateRunId: f.candidateRunId,
        payload: PAYLOAD,
      })
    ).toBe(true);
    const rows = await payloadRows(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      candidateRunId: f.candidateRunId,
      orderedPayload: PAYLOAD,
      content: "",
    });
    const [job] = await scheduled(f, "ai/orderedGeneration:generateOrderedSection");
    expect(job.args[0]).toEqual({
      generationId: f.generationId,
      candidateRunId: f.candidateRunId,
      section: "242",
      payloadId: rows[0]._id,
    });
    expect(job.args[0]).not.toHaveProperty("payload");
    expect(
      await f.t.query(internal.generations.getOrderedPayload, {
        generationId: f.generationId,
        payloadId: rows[0]._id,
      })
    ).toEqual(PAYLOAD);
  });

  it("stores one row per candidate chain and refuses another generation's id", async () => {
    const f = await setup();
    const { first, again, second } = await f.t.run(async (ctx) => {
      const secondRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId: f.generationId,
        projectId: f.projectId,
        model: "gemini-3.1-pro",
        label: "Gemini 3.1 Pro",
        status: "running",
        queuedAt: 1,
      });
      return {
        first: await persistOrderedPayload(ctx, f.generationId, f.candidateRunId, PAYLOAD),
        again: await persistOrderedPayload(ctx, f.generationId, f.candidateRunId, PAYLOAD),
        second: await persistOrderedPayload(ctx, f.generationId, secondRunId, PAYLOAD),
      };
    });
    expect(again).toBe(first);
    expect(second).not.toBe(first);
    expect(await payloadRows(f)).toHaveLength(2);
    // An id from another generation never loads.
    const foreignId: Id<"generationArtifacts"> = await f.t.run(async (ctx) => {
      const otherGenerationId = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "running",
        candidateMode: "single",
        startedAt: 1,
      });
      const otherRunId = await ctx.db.insert("generationCandidateRuns", {
        generationId: otherGenerationId,
        projectId: f.projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "running",
        queuedAt: 1,
      });
      return await persistOrderedPayload(ctx, otherGenerationId, otherRunId, PAYLOAD);
    });
    expect(
      await f.t.query(internal.generations.getOrderedPayload, {
        generationId: f.generationId,
        payloadId: foreignId,
      })
    ).toBeNull();
  });

  it("completeOrderedSectionRun forwards the id, or a legacy chain's payload, to the next step", async () => {
    for (const form of ["id", "legacy"] as const) {
      const f = await setup();
      const payloadId = await f.t.run(async (ctx) => {
        for (const [index, section] of (["s242", "s244"] as const).entries()) {
          await ctx.db.insert("generationSectionRuns", {
            generationId: f.generationId,
            projectId: f.projectId,
            section,
            status: index === 0 ? "running" : "pending",
            model: "claude-sonnet-5",
            label: "Sonnet 5",
            attempt: 1,
            candidateRunId: f.candidateRunId,
            orderIndex: index,
            queuedAt: 1,
          });
        }
        return await persistOrderedPayload(ctx, f.generationId, f.candidateRunId, PAYLOAD);
      });
      await f.t.mutation(internal.generations.completeOrderedSectionRun, {
        generationId: f.generationId,
        candidateRunId: f.candidateRunId,
        section: "242",
        draftText: "Draft",
        metrics: "{}",
        selfCheck: "{}",
        slotCounts: "{}",
        notes: [],
        ...(form === "id" ? { payloadId } : { payload: PAYLOAD }),
      });
      const [job] = await scheduled(f, "ai/orderedGeneration:generateOrderedSection");
      expect(job.args[0].section, form).toBe("244");
      if (form === "id") {
        expect(job.args[0].payloadId).toBe(payloadId);
        expect(job.args[0]).not.toHaveProperty("payload");
      } else {
        expect(job.args[0].payload).toEqual(PAYLOAD);
      }
    }
  });

  it("refuses a chain step that names no payload", async () => {
    const f = await setup();
    await expect(
      f.t.mutation(internal.generations.completeOrderedSectionRun, {
        generationId: f.generationId,
        candidateRunId: f.candidateRunId,
        section: "242",
        draftText: "Draft",
        metrics: "{}",
        selfCheck: "{}",
        slotCounts: "{}",
        notes: [],
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
  });

  it("a section action whose payload cannot be loaded fails its candidate without drafting", async () => {
    const f = await setup();
    const stray = await f.t.run(async (ctx) => {
      await ctx.db.insert("generationSectionRuns", {
        generationId: f.generationId,
        projectId: f.projectId,
        section: "s242",
        status: "queued",
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        attempt: 1,
        candidateRunId: f.candidateRunId,
        orderIndex: 0,
        queuedAt: 1,
      });
      // An artifact that is not an ordered payload.
      return await ctx.db.insert("generationArtifacts", {
        generationId: f.generationId,
        kind: "analysis",
        content: "{}",
      });
    });
    await f.t.action(internal.ai.orderedGeneration.generateOrderedSection, {
      generationId: f.generationId,
      candidateRunId: f.candidateRunId,
      section: "242",
      payloadId: stray,
    });
    const state = await f.t.run(async (ctx) => ({
      run: await ctx.db.get(f.candidateRunId),
      generation: await ctx.db.get(f.generationId),
      sections: await ctx.db.query("generationSectionRuns").collect(),
    }));
    expect(state.run?.status).toBe("failed");
    expect(state.generation?.status).toBe("failed");
    expect(state.sections.every((row) => row.status === "failed")).toBe(true);
  });
});
