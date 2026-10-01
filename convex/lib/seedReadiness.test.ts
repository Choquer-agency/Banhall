/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../../shared/pdSubsections";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { loadSeedDecisionState } from "./seedDecisionState";
import { DOCUMENT_HEADROOM } from "./readBudget";
import {
  emptyContextRevision,
  emptySelectionRevision,
} from "./seedRevisions";
import { computeSeedReadiness, readSeedReadiness } from "./seedReadiness";

const modules = import.meta.glob("../**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "seed-readiness-writer",
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Seed readiness",
      clientName: "Client",
      ownerId: userId,
      createdBy: userId,
      shareToken: "seed-readiness",
      status: "generating",
      createdAt: 1,
      updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedStageVersion: 0,
      startedAt: 1,
    });
    const briefVersionId = await ctx.db.insert("generationBriefs", {
      projectId,
      generationId,
      inputsHash: "inputs",
      version: 1,
      origin: "derived",
      storylineText: "Storyline",
      createdAt: 1,
    });
    const contextRevision = await emptyContextRevision();
    const selectionRevision = await emptySelectionRevision();
    const subsectionIds: Partial<
      Record<PdSubsectionRoleId, Id<"seedSubsections">>
    > = {};
    for (const role of PD_SUBSECTIONS) {
      const subsectionId = await ctx.db.insert("seedSubsections", {
        projectId,
        generationId,
        roleId: role.roleId,
        kind: role.kind,
        state: role.kind === "optional" ? "skipped" : "approved",
        currentContextRevision: contextRevision,
        selectionRevision,
        consecutiveFailures: 0,
        ...(role.kind === "optional"
          ? {}
          : {
              approvedContextRevision: contextRevision,
              approvedSelectionRevision: selectionRevision,
            }),
      });
      subsectionIds[role.roleId] = subsectionId;
    }
    const batchId = await ctx.db.insert("seedBatches", {
      projectId,
      generationId,
      roleId: "specific_advancements",
      operation: "open",
      dedupeKey: "readiness",
      commandId: "readiness",
      attemptId: "readiness",
      consumedContextRevision: contextRevision,
      briefVersionId,
      settingsHash: "settings",
      status: "shown",
      queuedAt: 1,
      leaseExpiresAt: 2,
      completedAt: 2,
      model: "model",
      slot: "generation:seeds:specific_advancements",
      promptVersion: "prompt",
      requestsReserved: 2,
    });
    const uncertaintySeedId = await ctx.db.insert("seeds", {
      projectId,
      generationId,
      batchId,
      roleId: "active_uncertainties",
      order: 0,
      bullets: ["The uncertainty remained unresolved."],
      tags: ["technical"],
      support: "source_supported",
      originalSupport: "source_supported",
    });
    const experimentSeedId = await ctx.db.insert("seeds", {
      projectId,
      generationId,
      batchId,
      roleId: "experimentation",
      order: 1,
      bullets: ["The team tested the competing configurations."],
      tags: ["detailed"],
      support: "source_supported",
      originalSupport: "source_supported",
    });
    const advancementSeedId = await ctx.db.insert("seeds", {
      projectId,
      generationId,
      batchId,
      roleId: "specific_advancements",
      order: 2,
      bullets: ["The tests established the governing constraint."],
      tags: ["technical"],
      support: "source_supported",
      originalSupport: "source_supported",
      uncertaintySeedId,
      experimentSeedIds: [experimentSeedId],
    });
    for (const selection of [
      { seedId: uncertaintySeedId, roleId: "active_uncertainties" },
      { seedId: experimentSeedId, roleId: "experimentation" },
      { seedId: advancementSeedId, roleId: "specific_advancements" },
    ] as const) {
      await ctx.db.insert("seedSelections", {
        projectId,
        generationId,
        seedId: selection.seedId,
        roleId: selection.roleId,
        selected: true,
        selectedAt: 1,
        version: 1,
      });
    }
    return {
      projectId,
      generationId,
      subsectionIds,
      advancementSeedId,
      experimentSeedId,
      uncertaintySeedId,
      batchId,
    };
  });
  return { t, ...ids };
}

describe("seed readiness", () => {
  it("uses one rule for pure and transaction-local reads", async () => {
    const s = await fixture();
    const results = await s.t.run(async (ctx) => {
      const state = await loadSeedDecisionState(ctx, {
        generationId: s.generationId,
        requireComplete: true,
      });
      return {
        pure: computeSeedReadiness(state),
        loaded: await readSeedReadiness(ctx, s.generationId),
      };
    });
    expect(results.pure.ready).toBe(true);
    expect(results.loaded).toMatchObject(results.pure);
  });

  it("names undecided required and optional roles and accepts an optional skip", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      const required = s.subsectionIds.company_context;
      const optional = s.subsectionIds.prior_year_status;
      if (!required || !optional) throw new Error("Missing fixture subsection");
      await ctx.db.patch(required, {
        state: "in_progress",
        approvedContextRevision: undefined,
        approvedSelectionRevision: undefined,
      });
      await ctx.db.patch(optional, { state: "untouched" });
    });
    const result = await s.t.run((ctx) =>
      readSeedReadiness(ctx, s.generationId)
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REQUIRED_ROLE_UNDECIDED",
          roleId: "company_context",
        }),
        expect.objectContaining({
          code: "OPTIONAL_ROLE_UNDECIDED",
          roleId: "prior_year_status",
        }),
      ])
    );
    expect(result.blockingRoleIds).toEqual([
      "company_context",
      "prior_year_status",
    ]);
  });

  it("blocks stale approval and a missing or inactive advancement link", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      const stale = s.subsectionIds.goal_problem;
      if (!stale) throw new Error("Missing fixture subsection");
      await ctx.db.patch(stale, { currentContextRevision: "changed-context" });
      await ctx.db.patch(s.advancementSeedId, { experimentSeedIds: [] });
    });
    const result = await s.t.run((ctx) =>
      readSeedReadiness(ctx, s.generationId)
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ROLE_STALE", roleId: "goal_problem" }),
        expect.objectContaining({
          code: "UNLINKED_ADVANCEMENT",
          roleId: "specific_advancements",
        }),
      ])
    );

    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.advancementSeedId, {
        experimentSeedIds: [s.experimentSeedId],
      });
      const experimentSelection = await ctx.db
        .query("seedSelections")
        .withIndex("by_seedId", (q) => q.eq("seedId", s.experimentSeedId))
        .unique();
      if (!experimentSelection) throw new Error("Missing experiment selection");
      await ctx.db.patch(experimentSelection._id, { selected: false });
    });
    const inactive = await s.t.run((ctx) =>
      readSeedReadiness(ctx, s.generationId)
    );
    expect(inactive.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "UNLINKED_ADVANCEMENT" }),
      ])
    );
  });

  it("blocks an advancement whose experiments tested another uncertainty, and experiments for a dropped uncertainty (2026-09-29, first)", async () => {
    const s = await fixture();
    const seedOf = (
      roleId: "active_uncertainties" | "experimentation",
      order: number,
      bullets: string[],
      extra: { uncertaintySeedId?: Id<"seeds"> } = {}
    ) =>
      s.t.run(async (ctx) => {
        const seedId = await ctx.db.insert("seeds", {
          projectId: s.projectId,
          generationId: s.generationId,
          batchId: s.batchId,
          roleId,
          order,
          bullets,
          tags: ["technical"],
          support: "source_supported",
          originalSupport: "source_supported",
          ...extra,
        });
        return seedId;
      });
    const select = (seedId: Id<"seeds">, roleId: PdSubsectionRoleId, selected: boolean) =>
      s.t.run(async (ctx) => {
        await ctx.db.insert("seedSelections", {
          projectId: s.projectId,
          generationId: s.generationId,
          seedId,
          roleId,
          selected,
          selectedAt: 1,
          version: 1,
        });
      });
    // The picked experiment tested the picked uncertainty: ready.
    await s.t.run((ctx) => ctx.db.patch(s.experimentSeedId, { uncertaintySeedId: s.uncertaintySeedId }));
    expect((await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId))).ready).toBe(true);

    // A second uncertainty and an experiment that tested it; the
    // advancement now also links that experiment.
    const sensors = await seedOf("active_uncertainties", 3, ["Sensor accuracy under biofilm was unknown."]);
    await select(sensors, "active_uncertainties", true);
    const bypass = await seedOf("experimentation", 4, ["Trial five compared direct sensors with a bypass loop."], {
      uncertaintySeedId: sensors,
    });
    await select(bypass, "experimentation", true);
    await s.t.run((ctx) =>
      ctx.db.patch(s.advancementSeedId, { experimentSeedIds: [s.experimentSeedId, bypass] })
    );
    const crossed = await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId));
    expect(crossed.ready).toBe(false);
    expect(crossed.blockers).toEqual([
      expect.objectContaining({ code: "UNLINKED_ADVANCEMENT", roleId: "specific_advancements" }),
    ]);

    // The writer drops the sensor uncertainty: its trial is still picked.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.advancementSeedId, { experimentSeedIds: [s.experimentSeedId] });
      const row = await ctx.db
        .query("seedSelections")
        .withIndex("by_seedId", (q) => q.eq("seedId", sensors))
        .unique();
      await ctx.db.patch(row!._id, { selected: false });
    });
    const dropped = await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId));
    expect(dropped.ready).toBe(false);
    expect(dropped.blockers).toEqual([
      expect.objectContaining({
        code: "EXPERIMENT_FOR_DROPPED_UNCERTAINTY",
        roleId: "experimentation",
        message:
          "Experimentation / Iterations has picked experiments that tested an uncertainty you no longer have picked",
      }),
    ]);
    expect(dropped.blockingRoleIds).toEqual(["experimentation"]);

    // An experiment recording no uncertainty keeps the old rule.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(bypass, { uncertaintySeedId: undefined });
      await ctx.db.patch(s.advancementSeedId, { experimentSeedIds: [s.experimentSeedId, bypass] });
    });
    expect((await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId))).ready).toBe(true);
  });

  it("counts an uncertainty revised through Feedback as the one its experiments tested (review P2-2)", async () => {
    const s = await fixture();
    // The experiment and the advancement name the original uncertainty; the
    // writer picks its Feedback revision and unticks the original.
    const revised = await s.t.run(async (ctx) => {
      await ctx.db.patch(s.experimentSeedId, { uncertaintySeedId: s.uncertaintySeedId });
      const revisedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: s.batchId,
        roleId: "active_uncertainties",
        order: 5,
        bullets: ["The reworded uncertainty remained unresolved."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
        revisionOfSeedId: s.uncertaintySeedId,
      });
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        seedId: revisedId,
        roleId: "active_uncertainties",
        selected: true,
        selectedAt: 2,
        version: 1,
      });
      const original = await ctx.db
        .query("seedSelections")
        .withIndex("by_seedId", (q) => q.eq("seedId", s.uncertaintySeedId))
        .unique();
      await ctx.db.patch(original!._id, { selected: false });
      return revisedId;
    });
    expect((await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId))).ready).toBe(true);

    // Unpicking the revision too drops the uncertainty for good.
    await s.t.run(async (ctx) => {
      const row = await ctx.db
        .query("seedSelections")
        .withIndex("by_seedId", (q) => q.eq("seedId", revised))
        .unique();
      await ctx.db.patch(row!._id, { selected: false });
    });
    const dropped = await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId));
    expect(dropped.blockers.map((blocker) => blocker.code)).toEqual([
      "EXPERIMENT_FOR_DROPPED_UNCERTAINTY",
      "UNLINKED_ADVANCEMENT",
    ]);
  });

  it("blocks Advancement to science and goal improvements picks that answer a dropped uncertainty, never a goal restatement (2026-09-30, fourth)", async () => {
    const s = await fixture();
    const result = async (roleId: "overall_advancement" | "goal_improvements", answeredUncertaintySeedIds?: Id<"seeds">[]) =>
      await s.t.run(async (ctx) => {
        const seedId = await ctx.db.insert("seeds", {
          projectId: s.projectId,
          generationId: s.generationId,
          batchId: s.batchId,
          roleId,
          order: 9,
          bullets: ["Stepwise acclimation cut cold-water start-up roughly in half."],
          tags: ["technical"],
          support: "source_supported",
          originalSupport: "source_supported",
          ...(answeredUncertaintySeedIds ? { answeredUncertaintySeedIds } : {}),
        });
        await ctx.db.insert("seedSelections", {
          projectId: s.projectId,
          generationId: s.generationId,
          seedId,
          roleId,
          selected: true,
          selectedAt: 1,
          version: 1,
        });
        return seedId;
      });
    const dropped = await s.t.run(async (ctx) => {
      const seedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: s.batchId,
        roleId: "active_uncertainties",
        order: 8,
        bullets: ["Whether stepwise acclimation would actually work was unknown."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        seedId,
        roleId: "active_uncertainties",
        selected: false,
        selectedAt: 1,
        version: 1,
      });
      return seedId;
    });
    // Answers a kept uncertainty, restates the goal, or predates the rule: ready.
    await result("overall_advancement", [s.uncertaintySeedId]);
    await result("goal_improvements", []);
    await result("goal_improvements");
    expect((await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId))).ready).toBe(true);

    await result("overall_advancement", [s.uncertaintySeedId, dropped]);
    const one = await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId));
    expect(one.ready).toBe(false);
    expect(one.blockers).toEqual([
      expect.objectContaining({
        code: "RESULT_FOR_DROPPED_UNCERTAINTY",
        roleId: "overall_advancement",
        message: "Advancement to science / technology has a picked idea that answers an uncertainty you no longer have picked",
      }),
    ]);
    await result("goal_improvements", [dropped]);
    const both = await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId));
    expect(both.blockingRoleIds).toEqual(["overall_advancement", "goal_improvements"]);
    expect(both.blockers.map((blocker) => blocker.code)).toEqual([
      "RESULT_FOR_DROPPED_UNCERTAINTY",
      "RESULT_FOR_DROPPED_UNCERTAINTY",
    ]);

    // 2026-09-30 (fifth): a hypothesis or work plan for the dropped
    // uncertainty is its own blocker, listed in step order before results.
    await result("hypothesis" as never, [dropped]);
    const plans = await s.t.run((ctx) => readSeedReadiness(ctx, s.generationId));
    expect(plans.blockingRoleIds).toEqual(["hypothesis", "overall_advancement", "goal_improvements"]);
    expect(plans.blockers.find((blocker) => blocker.roleId === "hypothesis")).toEqual({
      code: "PLAN_FOR_DROPPED_UNCERTAINTY",
      roleId: "hypothesis",
      message: "Hypothesis has a picked hypothesis that tests an uncertainty you no longer have picked",
    });
  });

  it("never reports ready from an incomplete read and performs no writes", async () => {
    const s = await fixture();
    const before = await s.t.run(async (ctx) => ({
      generation: await ctx.db.get(s.generationId),
      summaryCount: (
        await ctx.db
          .query("summaryVersions")
          .withIndex("by_generationId", (q) =>
            q.eq("generationId", s.generationId)
          )
          .take(2)
      ).length,
    }));
    const result = await s.t.run((ctx) =>
      readSeedReadiness(ctx, s.generationId, {
        maxBytes: DOCUMENT_HEADROOM + 1,
      })
    );
    expect(result).toMatchObject({
      ready: false,
      complete: false,
      blockers: [expect.objectContaining({ code: "INCOMPLETE_INPUT" })],
    });
    const after = await s.t.run(async (ctx) => ({
      generation: await ctx.db.get(s.generationId),
      summaryCount: (
        await ctx.db
          .query("summaryVersions")
          .withIndex("by_generationId", (q) =>
            q.eq("generationId", s.generationId)
          )
          .take(2)
      ).length,
    }));
    expect(after).toEqual(before);
  });
});
