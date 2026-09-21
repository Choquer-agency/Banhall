/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { sha256Text, stableSerialize } from "./lib/seedRevisions";

const modules = import.meta.glob("./**/*.ts");
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
// 09:00 PDT. The query reports the canonical America/Vancouver firm zone.
const P1 = Date.UTC(2026, 8, 18, 16);
const P2 = P1 + 60 * MINUTE;
const P3 = P2 + 60 * MINUTE;

type Fixture = Awaited<ReturnType<typeof insertWorkedTrace>>;
type BatchSpec = {
  key: string;
  roleId: "company_context" | "goal_problem" | "experimentation" | "hypothesis";
  operation: "open" | "prefetch" | "feedback" | "regenerate";
  queuedAt: number;
  completedAt: number;
  roleOpen: boolean;
};

async function insertProject(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  key: string,
  usedInDevelopment = false,
) {
  return await t.run((ctx) =>
    ctx.db.insert("projects", {
      title: `Project ${key}`,
      clientName: "Metrics client",
      status: "draft",
      createdBy: userId,
      shareToken: `share-${key}`,
      createdAt: P1 - MINUTE,
      updatedAt: P1 - MINUTE,
      usedInDevelopment,
    }),
  );
}

async function insertGeneration(
  t: ReturnType<typeof convexTest>,
  projectId: Id<"projects">,
  options: {
    workflow?: "seeds" | "sections";
    candidateMode?: "iterative" | "single";
    status?: "awaiting_input" | "completed";
    startedAt?: number;
    requestedAt?: number;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("generations", {
      projectId,
      status: options.status ?? "awaiting_input",
      candidateMode: options.candidateMode ?? "iterative",
      gatedWorkflow: options.workflow ?? "seeds",
      singleModelId: "model-a",
      startedAt: options.startedAt ?? P1,
      requestedAt: options.requestedAt,
    }),
  );
}

async function insertWorkedTrace() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      authId: "seed-health-admin",
      role: "admin",
    });
    const writerId = await ctx.db.insert("users", {
      authId: "seed-health-writer",
      role: "writer",
    });
    return { adminId, writerId };
  });
  const projectId = await insertProject(t, ids.writerId, "worked");
  const generationId = await insertGeneration(t, projectId);
  const briefId = await t.run((ctx) =>
    ctx.db.insert("generationBriefs", {
      projectId,
      generationId,
      inputsHash: "inputs",
      version: 1,
      origin: "writer",
      storylineText: "",
      createdAt: P1,
    }),
  );

  const batchSpecs: BatchSpec[] = [
    {
      key: "b1",
      roleId: "company_context",
      operation: "open",
      queuedAt: P1 + SECOND,
      completedAt: P1 + 9 * SECOND,
      roleOpen: true,
    },
    {
      key: "b2",
      roleId: "goal_problem",
      operation: "prefetch",
      queuedAt: P1 + MINUTE + 31 * SECOND,
      completedAt: P1 + MINUTE + 38 * SECOND,
      roleOpen: false,
    },
    {
      key: "b3",
      roleId: "experimentation",
      operation: "open",
      queuedAt: P1 + 4 * MINUTE + 50 * SECOND,
      completedAt: P1 + 4 * MINUTE + 58 * SECOND,
      roleOpen: true,
    },
    {
      key: "b4",
      roleId: "experimentation",
      operation: "feedback",
      queuedAt: P1 + 5 * MINUTE + 31 * SECOND,
      completedAt: P1 + 5 * MINUTE + 41 * SECOND,
      roleOpen: false,
    },
    {
      key: "b5",
      roleId: "hypothesis",
      operation: "regenerate",
      queuedAt: P1 + 23 * MINUTE,
      completedAt: P1 + 23 * MINUTE + 9 * SECOND,
      roleOpen: false,
    },
  ];
  const batches = new Map<string, Id<"seedBatches">>();
  for (const spec of batchSpecs) {
    const id = await t.run((ctx) =>
      ctx.db.insert("seedBatches", {
        projectId,
        generationId,
        roleId: spec.roleId,
        operation: spec.operation,
        dedupeKey: spec.key,
        commandId: spec.key,
        attemptId: `${spec.key}-attempt`,
        consumedContextRevision: "context",
        briefVersionId: briefId,
        settingsHash: "settings",
        status: "shown",
        queuedAt: spec.queuedAt,
        leaseExpiresAt: spec.queuedAt + 10 * MINUTE,
        // The event is the AD-39 attribution clock. b1 deliberately carries a
        // divergent mutable batch timestamp so the reader cannot substitute it.
        completedAt:
          spec.key === "b1" ? spec.completedAt + MINUTE : spec.completedAt,
        model: "model-a",
        slot:
          spec.operation === "feedback"
            ? `generation:seedFeedback:${spec.roleId}`
            : `generation:seeds:${spec.roleId}`,
        promptVersion: "prompt",
        roleOpen: spec.roleOpen,
        requestsReserved: 2,
        requestsMade: 1,
        settledAt: spec.completedAt,
      }),
    );
    batches.set(spec.key, id);
  }
  const batch = (key: string) => {
    const id = batches.get(key);
    if (!id) throw new Error(`Missing fixture batch ${key}`);
    return id;
  };

  async function seed(
    batchId: Id<"seedBatches">,
    roleId: "company_context" | "goal_problem" | "experimentation" | "hypothesis",
    order: number,
    bullets: string[],
    revisionOfSeedId?: Id<"seeds">,
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("seeds", {
        projectId,
        generationId,
        batchId,
        roleId,
        order,
        bullets,
        tags: [],
        support: "source_supported",
        originalSupport: "source_supported",
        revisionOfSeedId,
      }),
    );
  }

  const b1Seeds: Id<"seeds">[] = [];
  for (let index = 0; index < 5; index += 1) {
    b1Seeds.push(
      await seed(batch("b1"), "company_context", index, [`Company ${index}`]),
    );
  }
  for (let index = 0; index < 5; index += 1) {
    await seed(batch("b2"), "goal_problem", index, [`Goal ${index}`]);
  }
  const b3Seeds: Id<"seeds">[] = [];
  for (let index = 0; index < 5; index += 1) {
    b3Seeds.push(
      await seed(batch("b3"), "experimentation", index, [
        `Experiment ${index}`,
      ]),
    );
  }
  const s9 = b3Seeds[0];
  const s9a = await seed(
    batch("b4"),
    "experimentation",
    0,
    ["Revised experiment A"],
    s9,
  );
  await seed(
    batch("b4"),
    "experimentation",
    1,
    ["Revised experiment B"],
    s9,
  );
  for (let index = 0; index < 5; index += 1) {
    await seed(batch("b5"), "hypothesis", index, [`Hypothesis ${index}`]);
  }

  const feedbackRequestId = await t.run((ctx) =>
    ctx.db.insert("seedFeedbackRequests", {
      projectId,
      generationId,
      roleId: "experimentation",
      targetSeedId: s9,
      targetWording: ["Experiment 0"],
      instruction: "Offer alternatives",
      status: "active",
      batchId: batch("b4"),
    }),
  );
  const episodes = await t.run(async (ctx) => ({
    e1: await ctx.db.insert("seedStaleEpisodes", {
      projectId,
      generationId,
      roleId: "hypothesis",
      openedAt: P1 + 20 * MINUTE,
      reasons: ["active_uncertainties"],
      disposedAt: P1 + 24 * MINUTE,
      disposition: "resolved",
      freshAttemptCompleted: true,
      freshSeedsInSnapshot: true,
      olderSelectionsConfirmed: false,
    }),
    e2: await ctx.db.insert("seedStaleEpisodes", {
      projectId,
      generationId,
      roleId: "experimentation",
      openedAt: P1 + 20 * MINUTE,
      reasons: ["active_uncertainties"],
      disposedAt: P1 + 26 * MINUTE,
      disposition: "resolved",
      freshAttemptCompleted: false,
      freshSeedsInSnapshot: false,
      olderSelectionsConfirmed: true,
    }),
  }));

  async function systemRoleEvent(
    kind:
      | "batchDispatched"
      | "batchCompleted"
      | "batchViewed"
      | "staleOpened"
      | "staleDisposed",
    roleId:
      | "company_context"
      | "goal_problem"
      | "experimentation"
      | "hypothesis",
    at: number,
    refs: {
      batchId?: Id<"seedBatches">;
      staleEpisodeId?: Id<"seedStaleEpisodes">;
    } = {},
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("seedDecisionEvents", {
        projectId,
        generationId,
        kind,
        roleId,
        at,
        actorSystem: true,
        ...refs,
      }),
    );
  }
  async function userRoleEvent(
    kind:
      | "batchViewed"
      | "select"
      | "deselect"
      | "edit"
      | "approve"
      | "feedbackRequested"
      | "feedbackWithdrawn"
      | "regenerate",
    roleId:
      | "company_context"
      | "goal_problem"
      | "experimentation"
      | "active_uncertainties"
      | "hypothesis",
    at: number,
    refs: {
      batchId?: Id<"seedBatches">;
      seedId?: Id<"seeds">;
      feedbackRequestId?: Id<"seedFeedbackRequests">;
      editRatio?: number;
      confirmed?: boolean;
      snapshot?: {
        items: Array<{
          seedId: Id<"seeds">;
          wordingHash: string;
          selectionVersion: number;
        }>;
      };
    } = {},
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("seedDecisionEvents", {
        projectId,
        generationId,
        kind,
        roleId,
        at,
        actorUserId: ids.writerId,
        ...refs,
      }),
    );
  }

  await t.run((ctx) =>
    ctx.db.insert("seedDecisionEvents", {
      projectId,
      generationId,
      kind: "initialized",
      at: P1,
      actorSystem: true,
    }),
  );
  await systemRoleEvent("batchDispatched", "company_context", P1 + SECOND, {
    batchId: batch("b1"),
  });
  await systemRoleEvent("batchCompleted", "company_context", P1 + 9 * SECOND, {
    batchId: batch("b1"),
  });
  await userRoleEvent("batchViewed", "company_context", P1 + 12 * SECOND, {
    batchId: batch("b1"),
  });
  await userRoleEvent("select", "company_context", P1 + 40 * SECOND, {
    seedId: b1Seeds[0],
  });
  await userRoleEvent("select", "company_context", P1 + 50 * SECOND, {
    seedId: b1Seeds[1],
  });
  await userRoleEvent("edit", "company_context", P1 + 80 * SECOND, {
    seedId: b1Seeds[1],
    editRatio: 0.3,
  });
  await userRoleEvent("approve", "company_context", P1 + 90 * SECOND, {
    confirmed: false,
  });
  await systemRoleEvent("batchDispatched", "goal_problem", P1 + 91 * SECOND, {
    batchId: batch("b2"),
  });
  await systemRoleEvent("batchCompleted", "goal_problem", P1 + 98 * SECOND, {
    batchId: batch("b2"),
  });

  // Explicit fixture additions omitted from the prose table for brevity.
  await systemRoleEvent(
    "batchDispatched",
    "experimentation",
    P1 + 4 * MINUTE + 50 * SECOND,
    { batchId: batch("b3") },
  );
  await systemRoleEvent(
    "batchCompleted",
    "experimentation",
    P1 + 4 * MINUTE + 58 * SECOND,
    { batchId: batch("b3") },
  );
  await userRoleEvent("batchViewed", "experimentation", P1 + 5 * MINUTE, {
    batchId: batch("b3"),
  });
  await userRoleEvent(
    "feedbackRequested",
    "experimentation",
    P1 + 5 * MINUTE + 30 * SECOND,
    { feedbackRequestId },
  );
  await systemRoleEvent(
    "batchDispatched",
    "experimentation",
    P1 + 5 * MINUTE + 31 * SECOND,
    { batchId: batch("b4") },
  );
  const firstExposureId = await userRoleEvent(
    "approve",
    "experimentation",
    P1 + 5 * MINUTE + 35 * SECOND,
  );
  await systemRoleEvent(
    "batchCompleted",
    "experimentation",
    P1 + 5 * MINUTE + 41 * SECOND,
    { batchId: batch("b4") },
  );
  await userRoleEvent(
    "batchViewed",
    "experimentation",
    P1 + 5 * MINUTE + 42 * SECOND,
    { batchId: batch("b4") },
  );
  await userRoleEvent("select", "experimentation", P1 + 6 * MINUTE, {
    seedId: s9a,
  });
  await userRoleEvent("deselect", "experimentation", P1 + 6 * MINUTE + 5 * SECOND, {
    seedId: s9,
  });
  const eligibleApproveId = await userRoleEvent(
    "approve",
    "experimentation",
    P1 + 6 * MINUTE + 10 * SECOND,
  );
  await userRoleEvent("deselect", "active_uncertainties", P1 + 20 * MINUTE);
  await systemRoleEvent("staleOpened", "hypothesis", P1 + 20 * MINUTE, {
    staleEpisodeId: episodes.e1,
  });
  await systemRoleEvent("staleOpened", "experimentation", P1 + 20 * MINUTE, {
    staleEpisodeId: episodes.e2,
  });
  await userRoleEvent("approve", "active_uncertainties", P1 + 22 * MINUTE);
  await userRoleEvent("regenerate", "hypothesis", P1 + 23 * MINUTE, {
    batchId: batch("b5"),
  });
  await systemRoleEvent("batchDispatched", "hypothesis", P1 + 23 * MINUTE, {
    batchId: batch("b5"),
  });
  await systemRoleEvent(
    "batchCompleted",
    "hypothesis",
    P1 + 23 * MINUTE + 9 * SECOND,
    { batchId: batch("b5") },
  );
  await userRoleEvent("approve", "hypothesis", P1 + 24 * MINUTE);
  await systemRoleEvent("staleDisposed", "hypothesis", P1 + 24 * MINUTE, {
    staleEpisodeId: episodes.e1,
  });
  await userRoleEvent("approve", "experimentation", P1 + 26 * MINUTE, {
    confirmed: true,
  });
  await systemRoleEvent("staleDisposed", "experimentation", P1 + 26 * MINUTE, {
    staleEpisodeId: episodes.e2,
  });
  await userRoleEvent(
    "feedbackWithdrawn",
    "experimentation",
    P2 + 5 * MINUTE,
    { feedbackRequestId },
  );

  const s1Hash = await sha256Text(stableSerialize(["Company 0"]));
  const s9aHash = await sha256Text(stableSerialize(["Revised experiment A"]));
  await t.run(async (ctx) => {
    await ctx.db.patch("seedFeedbackRequests", feedbackRequestId, {
      status: "withdrawn",
      withdrawnAt: P2 + 5 * MINUTE,
      firstApproveExposure: {
        approveEventId: firstExposureId,
        outcome: "response_not_available",
      },
      eligibleScore: { approveEventId: eligibleApproveId, selected: true },
    });
    await ctx.db.insert("seedDecisionEvents", {
      projectId,
      generationId,
      kind: "signOff",
      at: P2 + 30 * MINUTE,
      actorUserId: ids.writerId,
      snapshot: {
        items: [
          { seedId: b1Seeds[0], wordingHash: s1Hash, selectionVersion: 1 },
          {
            seedId: b1Seeds[1],
            wordingHash: "edited-wording-hash",
            selectionVersion: 2,
          },
          { seedId: s9a, wordingHash: s9aHash, selectionVersion: 1 },
        ],
      },
    });
    for (const [index, spec] of batchSpecs.entries()) {
      await ctx.db.insert("aiUsage", {
        projectId,
        generationId,
        callSite:
          spec.operation === "feedback"
            ? `generation:seedFeedback:${spec.roleId}`
            : `generation:seeds:${spec.roleId}`,
        model: "model-a",
        inputTokens: 10,
        outputTokens: 10,
        costUsd: (index + 1) / 10,
        createdAt: spec.completedAt,
      });
    }
    await ctx.db.insert("reports", {
      projectId,
      generationId,
      content: "seed report",
      version: 1,
      // Cross-window join: attributed to the P2 sign-off even though report
      // creation lands after the queried half-open period.
      generatedAt: P3 + MINUTE,
      updatedAt: P3 + MINUTE,
    });
  });

  const singleGenerationId = await insertGeneration(t, projectId, {
    workflow: "sections",
    candidateMode: "single",
    status: "completed",
    startedAt: P2 + 9 * MINUTE,
    requestedAt: P2 + 10 * MINUTE,
  });
  await t.run((ctx) =>
    ctx.db.insert("reports", {
      projectId,
      generationId: singleGenerationId,
      content: "single report",
      version: 1,
      generatedAt: P2 + 11 * MINUTE,
      updatedAt: P2 + 11 * MINUTE,
    }),
  );

  // A cancelled seed run contributes requests only. Its selection is excluded.
  const cancelledProjectId = await insertProject(t, ids.writerId, "cancelled");
  const cancelledGenerationId = await insertGeneration(t, cancelledProjectId);
  await t.run(async (ctx) => {
    await ctx.db.insert("seedDecisionEvents", {
      projectId: cancelledProjectId,
      generationId: cancelledGenerationId,
      kind: "select",
      roleId: "company_context",
      at: P1 + 10 * MINUTE,
      actorUserId: ids.writerId,
    });
    await ctx.db.insert("seedDecisionEvents", {
      projectId: cancelledProjectId,
      generationId: cancelledGenerationId,
      kind: "cancel",
      at: P2 + MINUTE,
      actorUserId: ids.writerId,
    });
    await ctx.db.insert("aiUsage", {
      projectId: cancelledProjectId,
      generationId: cancelledGenerationId,
      callSite: "generation:seeds:company_context",
      model: "model-a",
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 9,
      createdAt: P1 + 10 * MINUTE,
    });
  });

  // A development project contributes nothing, including request counts.
  const developmentProjectId = await insertProject(
    t,
    ids.writerId,
    "development",
    true,
  );
  const developmentGenerationId = await insertGeneration(t, developmentProjectId);
  await t.run(async (ctx) => {
    await ctx.db.insert("seedDecisionEvents", {
      projectId: developmentProjectId,
      generationId: developmentGenerationId,
      kind: "select",
      roleId: "company_context",
      at: P1 + 10 * MINUTE,
      actorUserId: ids.writerId,
    });
    await ctx.db.insert("aiUsage", {
      projectId: developmentProjectId,
      generationId: developmentGenerationId,
      callSite: "generation:seeds:company_context",
      model: "model-a",
      inputTokens: 10,
      outputTokens: 10,
      costUsd: 9,
      createdAt: P1 + 10 * MINUTE,
    });
  });

  return {
    t,
    admin: t.withIdentity({ subject: "seed-health-admin" }),
    projectId,
    generationId,
    ids,
  };
}

describe("AD-39 seed learning health", () => {
  test("reproduces worked trace v1 with the explicitly omitted events", async () => {
    const { admin } = await insertWorkedTrace();
    const p1 = await admin.query(api.learningHealth.getSeedHealth, {
      start: P1,
      end: P2,
      gatedWorkflow: "seeds",
    });

    expect(p1.incomplete).toBe(false);
    expect(p1.window).toEqual({
      start: P1,
      end: P2,
      interval: "[start,end)",
      timeZone: "America/Vancouver",
    });
    expect(p1.usage).toMatchObject({
      requests: 6,
      cancelledRequests: 1,
      costUsd: 1.5,
      perGeneration: { samples: 2, median: 3, p95: 5 },
    });
    expect(p1.batches).toEqual({ completed: 5, viewed: 3 });
    expect(p1.seeds).toEqual({ viewed: 12, selected: 3, edited: 1 });
    expect(p1.feedback).toEqual({
      requests: 1,
      withdrawals: 0,
      unresolved: 0,
      firstApproveExposure: {
        selected: 0,
        notSelected: 0,
        responseNotAvailable: 1,
      },
      eligible: {
        selected: 1,
        notSelected: 0,
        denominator: 1,
        selectedRate: 1,
      },
    });
    expect(p1.regenerates).toBe(1);
    expect(p1.stale).toMatchObject({
      opened: 2,
      open: 0,
      resolved: 2,
      bypassed: 0,
      freshAttemptUsed: 1,
      confirmedOnly: 1,
      resolvedDurationMs: { samples: 2, median: 5 * MINUTE, p95: 6 * MINUTE },
    });
    expect(p1.signOff.count).toBe(0);
    expect(p1.latency).toMatchObject({
      dispatchToValidatedResultMs: {
        samples: 5,
        median: 8 * SECOND,
        p95: 10 * SECOND,
      },
      foregroundDispatchToFirstRenderMs: {
        samples: 2,
        median: 10.5 * SECOND,
        p95: 11 * SECOND,
      },
    });

    const p2 = await admin.query(api.learningHealth.getSeedHealth, {
      start: P2,
      end: P3,
      gatedWorkflow: "seeds",
    });
    expect(p2.incomplete).toBe(false);
    expect(p2.feedback.withdrawals).toBe(1);
    expect(p2.feedback.eligible).toMatchObject({ denominator: 0, selectedRate: null });
    expect(p2.signOff).toMatchObject({
      count: 1,
      activeTimeMs: { samples: 1, median: 730 * SECOND },
      elapsedTimeMs: { samples: 1, median: 90 * MINUTE },
      seedsLand: {
        approvedSubsections: 2,
        withUneditedOriginal: 1,
        rate: 0.5,
      },
    });
    expect(p2.latency).toMatchObject({
      signOffToReportCreatedMs: { samples: 1, median: 31 * MINUTE },
      singleModeRequestToReportCreatedMs: { samples: 1, median: MINUTE },
      comparison: "same project and model",
    });
  });

  test("is admin-only, validates the period and discloses missing joins", async () => {
    const fixture: Fixture = await insertWorkedTrace();
    await expect(
      fixture.t.query(api.learningHealth.getSeedHealth, {
        start: P1,
        end: P2,
        gatedWorkflow: "seeds",
      }),
    ).rejects.toThrow();
    await expect(
      fixture.admin.query(api.learningHealth.getSeedHealth, {
        start: P1,
        end: P1,
        gatedWorkflow: "seeds",
      }),
    ).rejects.toThrow(/half-open/i);

    await fixture.t.run(async (ctx) => {
      await ctx.db.insert("seedDecisionEvents", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        kind: "batchCompleted",
        roleId: "company_context",
        at: P1 + 59 * MINUTE,
        actorSystem: true,
      });
      const openEpisodeId = await ctx.db.insert("seedStaleEpisodes", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        roleId: "hypothesis",
        openedAt: P1 + 58 * MINUTE,
        reasons: ["active_uncertainties"],
      });
      await ctx.db.insert("seedDecisionEvents", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        kind: "staleOpened",
        roleId: "hypothesis",
        at: P1 + 58 * MINUTE,
        actorSystem: true,
        staleEpisodeId: openEpisodeId,
      });
    });
    const partial = await fixture.admin.query(api.learningHealth.getSeedHealth, {
      start: P1,
      end: P2,
      gatedWorkflow: "seeds",
    });
    expect(partial.incomplete).toBe(true);
    expect(partial.coverage.missingJoins).toBe(1);
    expect(partial.stale.open).toBe(1);
  });

  test("attributes a feedback score by an in-period approve across a request boundary", async () => {
    const fixture = await insertWorkedTrace();
    await fixture.t.run(async (ctx) => {
      const events = await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (query) =>
          query.eq("generationId", fixture.generationId),
        )
        .take(100);
      const approve = events.find(
        (event) =>
          event.kind === "approve" && event.roleId === "company_context",
      );
      const target = await ctx.db
        .query("seeds")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "company_context"),
        )
        .first();
      if (!approve || !target) throw new Error("Worked trace fixture is incomplete");
      const requestId = await ctx.db.insert("seedFeedbackRequests", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        roleId: "company_context",
        targetSeedId: target._id,
        targetWording: target.bullets,
        instruction: "Cross-window request",
        status: "active",
        firstApproveExposure: {
          approveEventId: approve._id,
          outcome: "selected",
        },
      });
      await ctx.db.insert("seedDecisionEvents", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        kind: "feedbackRequested",
        roleId: "company_context",
        at: P1 - SECOND,
        actorUserId: fixture.ids.writerId,
        feedbackRequestId: requestId,
      });
    });

    const result = await fixture.admin.query(api.learningHealth.getSeedHealth, {
      start: P1,
      end: P2,
      gatedWorkflow: "seeds",
    });
    expect(result.feedback.requests).toBe(1);
    expect(result.feedback.firstApproveExposure).toEqual({
      selected: 1,
      notSelected: 0,
      responseNotAvailable: 1,
    });
  });
});
