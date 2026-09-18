/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "seed-schema-writer",
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Seed schema project",
      clientName: "Seed schema client",
      status: "draft",
      createdBy: userId,
      shareToken: "seed-schema-project",
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId, projectId };
  });
  return { t, ...ids };
}

describe("step-by-step seed schema", () => {
  it("keeps legacy generations valid and accepts every optional seed field", async () => {
    const s = await setup();
    const ids = await s.t.run(async (ctx) => {
      const legacyGenerationId = await ctx.db.insert("generations", {
        projectId: s.projectId,
        status: "completed",
        candidateMode: "iterative",
        startedAt: 1,
      });
      const widenedGenerationId = await ctx.db.insert("generations", {
        projectId: s.projectId,
        status: "reserved",
        candidateMode: "iterative",
        startedAt: 2,
      });
      const briefVersionId = await ctx.db.insert("generationBriefs", {
        projectId: s.projectId,
        generationId: widenedGenerationId,
        inputsHash: "seed-schema-inputs",
        version: 1,
        origin: "derived",
        storylineText: "Storyline",
        createdAt: 2,
      });
      const originSourceId = await ctx.db.insert("generationSources", {
        generationId: legacyGenerationId,
        projectId: s.projectId,
        kind: "transcript",
        label: "Origin source",
        content: "Origin",
        contentHash: "origin-hash",
        truncated: false,
        originalLength: 6,
        capturedAt: 1,
      });
      const recoverySourceId = await ctx.db.insert("generationSources", {
        generationId: widenedGenerationId,
        projectId: s.projectId,
        kind: "transcript",
        label: "Recovery source",
        content: "Origin",
        contentHash: "origin-hash",
        truncated: false,
        originalLength: 6,
        capturedAt: 2,
      });
      const summaryVersionId = await ctx.db.insert("summaryVersions", {
        projectId: s.projectId,
        generationId: legacyGenerationId,
        version: 1,
        originGenerationId: legacyGenerationId,
        briefVersionId,
        settingsHash: "settings-hash",
        skippedRoleIds: [],
        readiness: true,
        signedOffBy: s.userId,
        signedOffAt: 2,
      });
      await ctx.db.patch(widenedGenerationId, {
        gatedWorkflow: "seeds",
        seedStageError: "bounded initialization error",
        seedStageVersion: 3,
        briefVersionId,
        summaryVersionId,
        originGenerationId: legacyGenerationId,
        sourceIdMap: [{ originSourceId, recoverySourceId }],
        seedRequestsReserved: 8,
      });
      return { legacyGenerationId, widenedGenerationId, briefVersionId, summaryVersionId };
    });

    const rows = await s.t.run(async (ctx) => ({
      legacy: await ctx.db.get(ids.legacyGenerationId),
      widened: await ctx.db.get(ids.widenedGenerationId),
    }));
    expect(rows.legacy).toMatchObject({
      candidateMode: "iterative",
      status: "completed",
    });
    expect(rows.legacy?.gatedWorkflow).toBeUndefined();
    expect(rows.legacy?.seedStageVersion).toBeUndefined();
    expect(rows.legacy?.summaryVersionId).toBeUndefined();
    expect(rows.widened).toMatchObject({
      gatedWorkflow: "seeds",
      seedStageError: "bounded initialization error",
      seedStageVersion: 3,
      briefVersionId: ids.briefVersionId,
      summaryVersionId: ids.summaryVersionId,
      originGenerationId: ids.legacyGenerationId,
      seedRequestsReserved: 8,
    });
    expect(rows.widened?.sourceIdMap).toHaveLength(1);
  });

  it("enforces event scope, exclusive actor identity, and text-free payloads", async () => {
    const s = await setup();
    const generationId = await s.t.run((ctx) =>
      ctx.db.insert("generations", {
        projectId: s.projectId,
        status: "awaiting_input",
        candidateMode: "iterative",
        startedAt: 1,
      })
    );

    await expect(
      s.t.run((ctx) =>
        ctx.db.insert("seedDecisionEvents", {
          projectId: s.projectId,
          generationId,
          kind: "initialized",
          at: 1,
          actorSystem: true,
        })
      )
    ).resolves.toBeDefined();
    await expect(
      s.t.run((ctx) =>
        ctx.db.insert("seedDecisionEvents", {
          projectId: s.projectId,
          generationId,
          kind: "select",
          roleId: "company_context",
          at: 2,
          actorUserId: s.userId,
        })
      )
    ).resolves.toBeDefined();

    const invalidEvents = [
      {
        projectId: s.projectId,
        generationId,
        kind: "select",
        at: 3,
        actorUserId: s.userId,
      },
      {
        projectId: s.projectId,
        generationId,
        kind: "initialized",
        roleId: "company_context",
        at: 4,
        actorSystem: true,
      },
      {
        projectId: s.projectId,
        generationId,
        kind: "select",
        roleId: "company_context",
        at: 5,
        actorUserId: s.userId,
        actorSystem: true,
      },
      {
        projectId: s.projectId,
        generationId,
        kind: "select",
        roleId: "company_context",
        at: 6,
      },
      {
        projectId: s.projectId,
        generationId,
        kind: "select",
        roleId: "company_context",
        at: 7,
        actorSystem: false,
      },
      {
        projectId: s.projectId,
        generationId,
        kind: "select",
        roleId: "company_context",
        at: 8,
        actorUserId: s.userId,
        bullets: ["Client text must not enter this event stream."],
      },
    ];
    for (const event of invalidEvents) {
      await expect(
        s.t.run((ctx) => ctx.db.insert("seedDecisionEvents", event as never))
      ).rejects.toThrow();
    }

    const stored = await s.t.run((ctx) =>
      ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (q) => q.eq("generationId", generationId))
        .collect()
    );
    expect(stored).toHaveLength(2);
  });
});
