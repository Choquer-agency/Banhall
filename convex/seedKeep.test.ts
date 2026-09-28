/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as endpoints from "./seeds";
import {
  addDecisionSeed,
  decisionFixture,
  decisionMutation,
} from "./seedDecision.fixture";
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../shared/pdSubsections";
import type { Id } from "./_generated/dataModel";
import { isSeedSubsectionStale } from "./lib/seedRevisions";
import { readCompleteFixture } from "./testFixtureRows";
import { makeFunctionReference } from "convex/server";
import type { readSeedReadiness } from "./lib/seedReadiness";

// 2026-09-28 (seventh, owner): "Keep all" and "Keep as is" approve steps an
// earlier change marked for review, with the same approval that confirming
// carried selections records, and never regenerate or change selections.
const select = decisionMutation<typeof endpoints.select>("seeds:select");
const keep = decisionMutation<typeof endpoints.keep>("seeds:keep");
const approve = decisionMutation<typeof endpoints.approve>("seeds:approve");
const getSubsection = makeFunctionReference<"query", { generationId: Id<"generations">; roleId: PdSubsectionRoleId }, { approvalChallenge: { approvalChallenge: string; carriedSeedIds: Id<"seeds">[]; exclusionEntryIds: Id<"generationBriefEntries">[] } | null }>("seeds:getSubsection");
const readiness = makeFunctionReference<"query", { generationId: Id<"generations"> }, Awaited<ReturnType<typeof readSeedReadiness>>>("seeds:getReadiness");
type Setup = Awaited<ReturnType<typeof decisionFixture>>;

function args(s: Setup, expectedSeedStageVersion: number, roleId: PdSubsectionRoleId = "company_context") {
  return { generationId: s.generationId, roleId, expectedSeedStageVersion };
}
async function version(s: Setup) {
  return (await s.t.run((ctx) => ctx.db.get(s.generationId)))?.seedStageVersion ?? 0;
}
async function rows(s: Setup) {
  return await s.t.run(async (ctx) => ({
    roles: await readCompleteFixture({ label: "seedSubsections", maxRows: PD_SUBSECTIONS.length, query: ctx.db.query("seedSubsections") }),
    selections: await readCompleteFixture({ label: "seedSelections", maxRows: 100, query: ctx.db.query("seedSelections") }),
    batches: await readCompleteFixture({ label: "seedBatches", maxRows: 100, query: ctx.db.query("seedBatches") }),
    events: await readCompleteFixture({ label: "seedDecisionEvents", maxRows: 100, query: ctx.db.query("seedDecisionEvents") }),
    episodes: await readCompleteFixture({ label: "seedStaleEpisodes", maxRows: 100, query: ctx.db.query("seedStaleEpisodes") }),
    scheduled: await readCompleteFixture({ label: "_scheduled_functions", maxRows: 100, query: ctx.db.system.query("_scheduled_functions") }),
  }));
}
/** Selects a later step's seed and approves that step as it stands. */
async function approvedLaterStep(s: Setup, roleId: PdSubsectionRoleId) {
  const later = await addDecisionSeed(s, roleId);
  await s.writer.mutation(select, { ...args(s, await version(s), roleId), seedId: later.seedId, selected: true });
  await s.t.run(async (ctx) => {
    const row = await ctx.db.get(later.rowId);
    if (!row) throw Error();
    await ctx.db.patch(row._id, {
      state: "approved",
      approvedAt: 1,
      approvedContextRevision: row.currentContextRevision,
      approvedSelectionRevision: row.selectionRevision,
    });
  });
  return later;
}
async function staleOf(s: Setup, rowId: Id<"seedSubsections">) {
  const row = await s.t.run((ctx) => ctx.db.get(rowId));
  if (!row) throw Error();
  return isSeedSubsectionStale(row);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("keep later steps after an earlier change", () => {
  it("keeps every later step marked for review, as a confirmed approval, without regenerating or changing selections", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    const goal = await approvedLaterStep(s, "goal_problem");
    const limits = await approvedLaterStep(s, "passive_limitations");
    // The earlier step changes: both later steps are marked for review.
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    expect(await staleOf(s, goal.rowId)).toBe(true);
    expect(await staleOf(s, limits.rowId)).toBe(true);
    const before = await rows(s);
    const at = await version(s);

    const result = await s.writer.mutation(keep, { ...args(s, at), scope: "later" });
    expect(result).toEqual({ seedStageVersion: at + 1, kept: ["goal_problem", "passive_limitations"], needsAttention: [] });
    expect(await staleOf(s, goal.rowId)).toBe(false);
    expect(await staleOf(s, limits.rowId)).toBe(false);

    const after = await rows(s);
    // Selections and batches are untouched; nothing is scheduled.
    expect(after.selections).toEqual(before.selections);
    expect(after.batches).toEqual(before.batches);
    expect(after.scheduled).toEqual(before.scheduled);
    // Each kept step records the approval confirming its carried selection.
    const approvals = after.events.filter((event) => event.kind === "approve");
    expect(approvals.map((event) => {
      const fields = event as { roleId?: string; confirmed?: boolean; actorUserId?: string };
      return [fields.roleId, fields.confirmed, fields.actorUserId];
    })).toEqual([
      ["goal_problem", true, s.userId],
      ["passive_limitations", true, s.userId],
    ]);
    expect(after.episodes.every((episode) => episode.disposition === "resolved")).toBe(true);
    // The earlier step itself is not approved by Keep all.
    expect(after.roles.find((row) => row.roleId === "company_context")?.state).toBe("in_progress");
  });

  it("answers a retry after its first answer without writing, and fences a request against older decisions", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    await approvedLaterStep(s, "goal_problem");
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    const at = await version(s);
    // Older decisions with a step still to keep: refused.
    await expect(s.writer.mutation(keep, { ...args(s, at - 1), scope: "later" })).rejects.toThrow(/STALE_REVISION/);
    await s.writer.mutation(keep, { ...args(s, at), scope: "later" });
    const kept = await rows(s);
    expect(await s.writer.mutation(keep, { ...args(s, at), scope: "later" })).toEqual({
      seedStageVersion: at + 1,
      kept: [],
      needsAttention: [],
    });
    expect(await rows(s)).toEqual(kept);
  });

  it("keeps one step as is", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    const goal = await approvedLaterStep(s, "goal_problem");
    const limits = await approvedLaterStep(s, "passive_limitations");
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    const result = await s.writer.mutation(keep, { ...args(s, await version(s), "goal_problem"), scope: "step" });
    expect(result.kept).toEqual(["goal_problem"]);
    expect(await staleOf(s, goal.rowId)).toBe(false);
    expect(await staleOf(s, limits.rowId)).toBe(true);
  });

  it("leaves advancements that no longer link selected work for the writer, and names the step", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    const goal = await approvedLaterStep(s, "goal_problem");
    // An advancement with no link to a selected uncertainty or experiment.
    const advancement = await approvedLaterStep(s, "specific_advancements");
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    const result = await s.writer.mutation(keep, { ...args(s, await version(s)), scope: "later" });
    expect(result.kept).toEqual(["goal_problem"]);
    expect(result.needsAttention).toEqual([{ roleId: "specific_advancements", reason: "UNLINKED_ADVANCEMENT" }]);
    expect(await staleOf(s, goal.rowId)).toBe(false);
    expect(await staleOf(s, advancement.rowId)).toBe(true);
  });

  it("writes nothing when no later step is marked for review", async () => {
    const s = await decisionFixture();
    await addDecisionSeed(s);
    const before = await rows(s);
    const at = await version(s);
    expect(await s.writer.mutation(keep, { ...args(s, at), scope: "later" })).toEqual({ seedStageVersion: at, kept: [], needsAttention: [] });
    expect(await rows(s)).toEqual(before);
  });

  it("requires edit access", async () => {
    const s = await decisionFixture();
    const stranger = s.t.withIdentity({ subject: "someone-else" });
    await expect(stranger.mutation(keep, { ...args(s, await version(s)), scope: "later" })).rejects.toThrow();
  });

  it("records how each approval came about: Keep all, Keep as is", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    await approvedLaterStep(s, "goal_problem");
    await approvedLaterStep(s, "passive_limitations");
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    await s.writer.mutation(keep, { ...args(s, await version(s), "goal_problem"), scope: "step" });
    await s.writer.mutation(keep, { ...args(s, await version(s)), scope: "later" });
    const approvals = (await rows(s)).events
      .filter((event) => event.kind === "approve")
      .map((event) => [(event as { roleId?: string }).roleId, event.approvalSource]);
    expect(approvals).toEqual([
      ["goal_problem", "keepStep"],
      ["passive_limitations", "keepAll"],
    ]);
  });

  it("resolves the stale episode with its facts and records its disposal", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    const goal = await approvedLaterStep(s, "goal_problem");
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    const episodeId = (await s.t.run((ctx) => ctx.db.get(goal.rowId)))?.activeStaleEpisodeId;
    expect(episodeId).toBeDefined();
    await s.writer.mutation(keep, { ...args(s, await version(s)), scope: "later" });
    const after = await rows(s);
    expect(after.episodes.find((episode) => episode._id === episodeId)).toMatchObject({
      disposition: "resolved",
      freshAttemptCompleted: false,
      freshSeedsInSnapshot: false,
      olderSelectionsConfirmed: true,
    });
    expect(after.events.filter((event) => event.kind === "staleDisposed")).toEqual([
      expect.objectContaining({ roleId: "goal_problem", staleEpisodeId: episodeId, outcome: "resolved" }),
    ]);
    expect((await s.t.run((ctx) => ctx.db.get(goal.rowId)))?.activeStaleEpisodeId).toBeUndefined();
  });

  it("leaves a step with no pick, and one whose pick matches a Claim Exclusion, and names both", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    // Approved with no pick (as an older run could leave it).
    const bare = await addDecisionSeed(s, "goal_problem");
    await s.t.run(async (ctx) => {
      const row = await ctx.db.get(bare.rowId);
      if (!row) throw Error();
      await ctx.db.patch(row._id, { state: "approved", approvedAt: 1, approvedContextRevision: row.currentContextRevision, approvedSelectionRevision: row.selectionRevision });
    });
    const excluded = await approvedLaterStep(s, "passive_limitations");
    await s.t.run(async (ctx) => {
      await ctx.db.insert("generationBriefEntries", {
        briefId: s.briefId,
        projectId: s.projectId,
        group: "claimExclusion",
        text: "original frozen wording",
        reason: "routine_engineering",
        sourceId: s.sourceId,
        sourceContentHash: "source-hash",
        startOffset: 0,
        endOffset: 10,
        exactExcerpt: "Original frozen wording",
        createdAt: 1,
      });
    });
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    const before = await rows(s);
    const at = await version(s);
    expect(await s.writer.mutation(keep, { ...args(s, at), scope: "later" })).toEqual({
      seedStageVersion: at,
      kept: [],
      needsAttention: [
        { roleId: "goal_problem", reason: "NO_SELECTION" },
        { roleId: "passive_limitations", reason: "CLAIM_EXCLUSION" },
      ],
    });
    expect(await rows(s)).toEqual(before);
    expect(await staleOf(s, excluded.rowId)).toBe(true);
  });

  it("answers a retry after a partial Keep all without refusing when nothing left could be kept", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    await approvedLaterStep(s, "goal_problem");
    await approvedLaterStep(s, "specific_advancements");
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    const at = await version(s);
    const first = await s.writer.mutation(keep, { ...args(s, at), scope: "later" });
    expect(first.kept).toEqual(["goal_problem"]);
    const kept = await rows(s);
    // The same request again, on the version it was made against.
    expect(await s.writer.mutation(keep, { ...args(s, at), scope: "later" })).toEqual({
      seedStageVersion: at + 1,
      kept: [],
      needsAttention: [{ roleId: "specific_advancements", reason: "UNLINKED_ADVANCEMENT" }],
    });
    expect(await rows(s)).toEqual(kept);
  });

  it("refuses a writer without edit rights and a closed seed stage", async () => {
    const s = await decisionFixture();
    const earlier = await addDecisionSeed(s);
    await approvedLaterStep(s, "goal_problem");
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: earlier.seedId, selected: true });
    await s.t.run((ctx) => ctx.db.insert("users", { authId: "seed-keep-outsider", role: "writer" }));
    const before = await rows(s);
    await expect(
      s.t.withIdentity({ subject: "seed-keep-outsider" }).mutation(keep, { ...args(s, await version(s)), scope: "later" })
    ).rejects.toThrow(/report\.editProse/);
    expect(await rows(s)).toEqual(before);
    await s.t.run((ctx) => ctx.db.patch(s.generationId, { status: "running" }));
    await expect(
      s.writer.mutation(keep, { ...args(s, await version(s)), scope: "later" })
    ).rejects.toThrow(/seed stage is closed/);
    expect(await rows(s)).toEqual(before);
  });

  it("makes the plan ready once the changed step is confirmed and Keep all keeps the rest", async () => {
    const s = await decisionFixture();
    const seeds: Partial<Record<PdSubsectionRoleId, Awaited<ReturnType<typeof addDecisionSeed>>>> = {};
    for (const role of PD_SUBSECTIONS) {
      seeds[role.roleId] = await addDecisionSeed(s, role.roleId);
    }
    // The advancement links the picked uncertainty and experiment.
    await s.t.run((ctx) =>
      ctx.db.patch(seeds.specific_advancements!.seedId, {
        uncertaintySeedId: seeds.active_uncertainties!.seedId,
        experimentSeedIds: [seeds.experimentation!.seedId],
      })
    );
    for (const role of PD_SUBSECTIONS) {
      await s.writer.mutation(select, { ...args(s, await version(s), role.roleId), seedId: seeds[role.roleId]!.seedId, selected: true });
    }
    await s.t.run(async (ctx) => {
      for (const role of PD_SUBSECTIONS) {
        const row = await ctx.db.get(seeds[role.roleId]!.rowId);
        if (!row) throw Error();
        await ctx.db.patch(row._id, { state: "approved", approvedAt: 1, approvedContextRevision: row.currentContextRevision, approvedSelectionRevision: row.selectionRevision });
      }
    });
    expect((await s.writer.query(readiness, { generationId: s.generationId })).ready).toBe(true);

    // The writer changes the first step: it reopens and every later step is marked.
    const another = await addDecisionSeed(s);
    await s.writer.mutation(select, { ...args(s, await version(s)), seedId: another.seedId, selected: true });
    expect((await s.writer.query(readiness, { generationId: s.generationId })).ready).toBe(false);

    // Confirm the changed step, then keep the rest.
    const view = await s.writer.query(getSubsection, { generationId: s.generationId, roleId: "company_context" });
    const challenge = view.approvalChallenge!;
    await s.writer.mutation(approve, {
      ...args(s, await version(s)),
      approvalChallenge: challenge.approvalChallenge,
      acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
      acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
    });
    const result = await s.writer.mutation(keep, { ...args(s, await version(s)), scope: "later" });
    expect(result.needsAttention).toEqual([]);
    expect(result.kept).toHaveLength(PD_SUBSECTIONS.length - 1);
    expect(await s.writer.query(readiness, { generationId: s.generationId })).toMatchObject({ ready: true, blockingRoleIds: [] });
  });
});
