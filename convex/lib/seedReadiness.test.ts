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
