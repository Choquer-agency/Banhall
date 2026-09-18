/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { PD_SUBSECTIONS } from "../../shared/pdSubsections";
import schema from "../schema";
import { DOCUMENT_HEADROOM } from "./readBudget";
import {
  loadSeedDecisionState,
  materializeActiveSelections,
  materializeCompleteDecisionSnapshot,
} from "./seedDecisionState";
import {
  emptyContextRevision,
  emptySelectionRevision,
  orderShownSet,
} from "./seedRevisions";

const modules = import.meta.glob("../**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "seed-decision-state-writer",
      role: "writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Seed decision state",
      clientName: "Client",
      ownerId: userId,
      createdBy: userId,
      shareToken: "seed-decision-state",
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
    const currentContextRevision = await emptyContextRevision();
    const selectionRevision = await emptySelectionRevision();
    for (const role of PD_SUBSECTIONS) {
      await ctx.db.insert("seedSubsections", {
        projectId,
        generationId,
        roleId: role.roleId,
        kind: role.kind,
        state: "in_progress",
        currentContextRevision,
        selectionRevision,
        consecutiveFailures: 0,
      });
    }
    const batchId = await ctx.db.insert("seedBatches", {
      projectId,
      generationId,
      roleId: "company_context",
      operation: "open",
      dedupeKey: "decision-state-current",
      commandId: "decision-state-current",
      attemptId: "decision-state-current",
      consumedContextRevision: currentContextRevision,
      briefVersionId,
      settingsHash: "settings",
      status: "shown",
      queuedAt: 1,
      leaseExpiresAt: 2,
      completedAt: 2,
      model: "model",
      slot: "generation:seeds:company_context",
      promptVersion: "prompt",
      requestsReserved: 2,
    });
    return { projectId, generationId, briefVersionId, batchId };
  });
  return { t, ...ids };
}

function errorPayload(error: unknown): unknown {
  if (error && typeof error === "object" && "data" in error) return error.data;
  return null;
}

describe("seed decision state loader", () => {
  it("loads every selection beyond the dispatch-only 128-row ceiling", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      for (let index = 0; index < 129; index += 1) {
        const seedId = await ctx.db.insert("seeds", {
          projectId: s.projectId,
          generationId: s.generationId,
          batchId: s.batchId,
          roleId: "company_context",
          order: index,
          bullets: [`Decision ${index}.`],
          tags: ["technical"],
          support: "writer_asserted",
          originalSupport: "writer_asserted",
        });
        await ctx.db.insert("seedSelections", {
          projectId: s.projectId,
          generationId: s.generationId,
          seedId,
          roleId: "company_context",
          selected: true,
          selectedAt: index,
          version: 1,
        });
      }
    });

    const loaded = await s.t.run(async (ctx) => {
      const state = await loadSeedDecisionState(ctx, {
        generationId: s.generationId,
        requireComplete: true,
      });
      return {
        complete: state.complete,
        subsectionCount: state.subsections.length,
        selectionCount: state.selectionRows.length,
        seedCount: state.seeds.length,
        activeCount: materializeActiveSelections(state).length,
        snapshotCount: materializeCompleteDecisionSnapshot(state, {
          targetRoleId: "goal_problem",
        }).items.length,
      };
    });
    expect(loaded.complete).toBe(true);
    expect(loaded.subsectionCount).toBe(13);
    expect(loaded.selectionCount).toBe(129);
    expect(loaded.seedCount).toBe(129);
    expect(loaded.activeCount).toBe(129);
    expect(loaded.snapshotCount).toBe(129);
  });

  it("loads unselected edits and all feedback while excluding unrelated history", async () => {
    const s = await fixture();
    const ids = await s.t.run(async (ctx) => {
      const selectedSeedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: s.batchId,
        roleId: "company_context",
        order: 0,
        bullets: ["Original selection."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      const editedSeedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: s.batchId,
        roleId: "company_context",
        order: 1,
        bullets: ["Original unselected."],
        tags: ["detailed"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      const historicalSeedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: s.batchId,
        roleId: "company_context",
        order: 2,
        bullets: ["Unreferenced history."],
        tags: ["conservative"],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        seedId: selectedSeedId,
        roleId: "company_context",
        selected: true,
        editedBullets: ["Final selection."],
        selectedAt: 1,
        version: 2,
      });
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        seedId: editedSeedId,
        roleId: "company_context",
        selected: false,
        editedBullets: ["Edited while unselected."],
        selectedAt: 2,
        version: 2,
      });
      await ctx.db.insert("seedFeedbackRequests", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId: "company_context",
        targetSeedId: editedSeedId,
        targetWording: ["Edited while unselected."],
        instruction: "Keep it withdrawn.",
        status: "withdrawn",
        withdrawnAt: 3,
        batchId: s.batchId,
      });
      return { selectedSeedId, editedSeedId, historicalSeedId };
    });

    const loaded = await s.t.run(async (ctx) => {
      const state = await loadSeedDecisionState(ctx, {
        generationId: s.generationId,
        requireComplete: true,
      });
      return {
        selectionCount: state.selectionRows.length,
        feedbackStatuses: state.feedbackRows.map((row) => row.status),
        seedIds: state.seeds.map((seed) => seed._id),
        active: materializeActiveSelections(state),
      };
    });
    expect(loaded.selectionCount).toBe(2);
    expect(loaded.feedbackStatuses).toEqual(["withdrawn"]);
    expect(loaded.seedIds).toEqual(
      expect.arrayContaining([ids.selectedSeedId, ids.editedSeedId])
    );
    expect(loaded.seedIds).not.toContain(ids.historicalSeedId);
    expect(loaded.active).toMatchObject([
      { seedId: ids.selectedSeedId, bullets: ["Final selection."] },
    ]);
  });

  it("loads an unselected original and its Batch for a selected revision", async () => {
    const s = await fixture();
    const ids = await s.t.run(async (ctx) => {
      const originalSeedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: s.batchId,
        roleId: "company_context",
        order: 2,
        bullets: ["Original ancestor."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      const revisionSeedId = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: s.batchId,
        roleId: "company_context",
        order: 0,
        bullets: ["Selected revision."],
        tags: ["detailed"],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
        revisionOfSeedId: originalSeedId,
      });
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        seedId: revisionSeedId,
        roleId: "company_context",
        selected: true,
        selectedAt: 1,
        version: 1,
      });
      return { originalSeedId, revisionSeedId };
    });

    const result = await s.t.run(async (ctx) => {
      const state = await loadSeedDecisionState(ctx, {
        generationId: s.generationId,
        requireComplete: true,
      });
      return {
        seedIds: state.seeds.map((seed) => seed._id),
        batchIds: state.batches.map((batch) => batch._id),
        ordered: orderShownSet({
          seeds: state.seeds,
          batches: state.batches,
        }).map((seed) => seed._id),
      };
    });
    expect(result.seedIds).toEqual(
      expect.arrayContaining([ids.originalSeedId, ids.revisionSeedId])
    );
    expect(result.batchIds).toContain(s.batchId);
    expect(result.ordered).toEqual([
      ids.originalSeedId,
      ids.revisionSeedId,
    ]);
  });

  it("returns explicit incompleteness and raises the typed processing reason when required", async () => {
    const s = await fixture();
    const partial = await s.t.run(async (ctx) => {
      const state = await loadSeedDecisionState(ctx, {
        generationId: s.generationId,
        maxBytes: DOCUMENT_HEADROOM + 1,
      });
      return { complete: state.complete, readBudget: state.readBudget };
    });
    expect(partial.complete).toBe(false);
    expect(partial.readBudget.exhausted).toBe(true);

    let thrown: unknown;
    try {
      await s.t.run((ctx) =>
        loadSeedDecisionState(ctx, {
          generationId: s.generationId,
          roleId: "company_context",
          maxBytes: DOCUMENT_HEADROOM + 1,
          requireComplete: true,
        })
      );
    } catch (error) {
      thrown = error;
    }
    const payload = errorPayload(thrown);
    expect(payload).toMatchObject({
      code: "INVALID_INPUT",
      reason: "SEED_PROCESSING_LIMIT",
      roleId: "company_context",
    });
  });
});
