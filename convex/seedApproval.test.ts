/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
  type RegisteredQuery,
} from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type {
  approve,
  deselect,
  edit,
  giveFeedback,
  getSubsection,
  getApprovalReview,
  restoreWording,
  select,
  withdrawFeedback,
} from "./seeds";
import type { claimAttempt, completeAttempt } from "./seedRuns";
import type { getSeedHealth } from "./learningHealth";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../shared/pdSubsections";
import {
  emptyContextRevision,
  emptySelectionRevision,
} from "./lib/seedRevisions";
import { loadSeedDispatchSnapshot } from "./lib/seedSnapshotLoader";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.parse("2026-09-18T12:00:00Z");

type MutationReferenceFromExport<Export> =
  Export extends RegisteredMutation<infer Visibility, infer Args, infer ReturnValue>
    ? FunctionReference<"mutation", Visibility, Args, Awaited<ReturnValue>>
    : never;
type QueryReferenceFromExport<Export> =
  Export extends RegisteredQuery<infer Visibility, infer Args, infer ReturnValue>
    ? FunctionReference<"query", Visibility, Args, Awaited<ReturnValue>>
    : never;

function mutationRef<Export>(name: string) {
  type Ref = MutationReferenceFromExport<Export>;
  return makeFunctionReference<
    "mutation",
    FunctionArgs<Ref>,
    FunctionReturnType<Ref>
  >(name);
}

function queryRef<Export>(name: string) {
  type Ref = QueryReferenceFromExport<Export>;
  return makeFunctionReference<
    "query",
    FunctionArgs<Ref>,
    FunctionReturnType<Ref>
  >(name);
}

const getSubsectionRef = queryRef<typeof getSubsection>("seeds:getSubsection");
const getApprovalReviewRef = queryRef<typeof getApprovalReview>("seeds:getApprovalReview");
const approveRef = mutationRef<typeof approve>("seeds:approve");
const selectRef = mutationRef<typeof select>("seeds:select");
const deselectRef = mutationRef<typeof deselect>("seeds:deselect");
const editRef = mutationRef<typeof edit>("seeds:edit");
const giveFeedbackRef = mutationRef<typeof giveFeedback>("seeds:giveFeedback");
const restoreWordingRef = mutationRef<typeof restoreWording>(
  "seeds:restoreWording",
);
const withdrawFeedbackRef = mutationRef<typeof withdrawFeedback>(
  "seeds:withdrawFeedback",
);
const claimAttemptRef = mutationRef<typeof claimAttempt>("seedRuns:claimAttempt");
const completeAttemptRef = mutationRef<typeof completeAttempt>(
  "seedRuns:completeAttempt",
);
const getSeedHealthRef = queryRef<typeof getSeedHealth>(
  "learningHealth:getSeedHealth",
);

function mutationHandler(registered: object) {
  if (
    !("_handler" in registered) ||
    typeof registered._handler !== "function"
  ) {
    throw new Error("Expected registered Convex mutation handler");
  }
  return registered._handler;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

type ApprovalFixtureOptions = {
  roleId?: PdSubsectionRoleId;
  bullet?: string;
  outdated?: boolean;
  exclusion?: string;
};

async function approvalFixture(options: ApprovalFixtureOptions = {}) {
  const roleId = options.roleId ?? "goal_improvements";
  const bullet = options.bullet ?? "Measured trials isolated the limiting mechanism.";
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "seed-approval-writer",
      role: "writer",
    });
    await ctx.db.insert("users", {
      authId: "seed-approval-admin",
      role: "admin",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Approval project",
      clientName: "Client",
      ownerId: userId,
      createdBy: userId,
      shareToken: "seed-approval-share",
      status: "generating",
      createdAt: 1,
      updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      startedAt: 1,
      previousProjectStatus: "draft",
      seedStageVersion: 0,
      seedRequestsReserved: 0,
      singleModelId: "model-a",
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
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "analysis",
      content: "{}",
    });
    await ctx.db.insert("generationArtifacts", {
      generationId,
      kind: "brain_blocks",
      content: JSON.stringify({
        blocks: {},
        styleGuidance: "Use direct language.",
        styleOverrides: {},
      }),
    });
    const sourceContent = "Routine maintenance evidence and technical trial notes.";
    const sourceId = await ctx.db.insert("generationSources", {
      generationId,
      projectId,
      kind: "transcript",
      label: "Interview",
      content: sourceContent,
      contentHash: "source-hash",
      truncated: false,
      originalLength: sourceContent.length,
      capturedAt: 1,
    });
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId,
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
    const subsectionIds: Partial<
      Record<PdSubsectionRoleId, Id<"seedSubsections">>
    > = {};
    for (const role of PD_SUBSECTIONS) {
      subsectionIds[role.roleId] = await ctx.db.insert("seedSubsections", {
        projectId,
        generationId,
        roleId: role.roleId,
        kind: role.kind,
        state: "untouched",
        currentContextRevision,
        selectionRevision,
        consecutiveFailures: 0,
      });
    }
    const batchId = await ctx.db.insert("seedBatches", {
      projectId,
      generationId,
      roleId,
      operation: "open",
      dedupeKey: "approval-batch",
      commandId: "approval-batch",
      attemptId: "approval-attempt",
      consumedContextRevision: options.outdated
        ? "outdated-context"
        : currentContextRevision,
      briefVersionId: briefId,
      settingsHash: "settings",
      status: "shown",
      queuedAt: 2,
      leaseExpiresAt: 3,
      completedAt: 3,
      model: "model-a",
      slot: `generation:seeds:${roleId}`,
      promptVersion: "prompt",
      roleOpen: true,
      requestsReserved: 2,
      requestsMade: 1,
      settledAt: 3,
    });
    const seedId = await ctx.db.insert("seeds", {
      projectId,
      generationId,
      batchId,
      roleId,
      order: 0,
      bullets: [bullet],
      tags: ["technical"],
      support: "source_supported",
      originalSupport: "source_supported",
    });
    await ctx.db.insert("seedSelections", {
      projectId,
      generationId,
      seedId,
      roleId,
      selected: true,
      selectedAt: 3,
      version: 1,
    });
    const subsectionId = subsectionIds[roleId];
    if (!subsectionId) throw new Error("Approval subsection fixture is missing");
    await ctx.db.patch(subsectionId, {
      state: "in_progress",
      shownBatchId: batchId,
    });
    let exclusionEntryId: Id<"generationBriefEntries"> | undefined;
    if (options.exclusion) {
      exclusionEntryId = await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId,
        group: "claimExclusion",
        text: options.exclusion,
        reason: "routine_engineering",
        sourceId,
        sourceContentHash: "source-hash",
        startOffset: 0,
        endOffset: sourceContent.length,
        exactExcerpt: "Routine maintenance",
        createdAt: 1,
      });
    }
    return {
      userId,
      projectId,
      generationId,
      briefId,
      sourceId,
      subsectionIds,
      subsectionId,
      batchId,
      seedId,
      exclusionEntryId,
    };
  });
  return {
    t,
    ...ids,
    roleId,
    writer: t.withIdentity({ subject: "seed-approval-writer" }),
    admin: t.withIdentity({ subject: "seed-approval-admin" }),
  };
}

type Fixture = Awaited<ReturnType<typeof approvalFixture>>;

async function subsection(fixture: Fixture, roleId = fixture.roleId) {
  return await fixture.writer.query(getSubsectionRef, {
    generationId: fixture.generationId,
    roleId,
  });
}

async function approveExact(fixture: Fixture, roleId = fixture.roleId) {
  const view = await subsection(fixture, roleId);
  const challenge = view.approvalChallenge;
  if (!challenge) throw new Error("Expected a complete approval challenge");
  const result = await fixture.writer.mutation(approveRef, {
    generationId: fixture.generationId,
    roleId,
    expectedSeedStageVersion: view.seedStageVersion,
    approvalChallenge: challenge.approvalChallenge,
    acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
    acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
  });
  return { view, challenge, result };
}

async function seedBatch(
  fixture: Fixture,
  args: {
    roleId: PdSubsectionRoleId;
    operation?: "open" | "prefetch" | "feedback";
    status?: "queued" | "running" | "shown" | "failed";
    completedAt?: number;
    consumedContextRevision?: string;
    feedbackRequestId?: Id<"seedFeedbackRequests">;
    key: string;
  },
) {
  return await fixture.t.run((ctx) =>
    ctx.db.insert("seedBatches", {
      projectId: fixture.projectId,
      generationId: fixture.generationId,
      roleId: args.roleId,
      operation: args.operation ?? "open",
      dedupeKey: args.key,
      commandId: args.key,
      attemptId: `${args.key}-attempt`,
      feedbackRequestId: args.feedbackRequestId,
      consumedContextRevision: args.consumedContextRevision ?? "context",
      briefVersionId: fixture.briefId,
      settingsHash: "settings",
      status: args.status ?? "shown",
      queuedAt: 10,
      leaseExpiresAt: NOW + 10_000,
      completedAt: args.completedAt,
      model: "model-a",
      slot: `generation:seeds:${args.roleId}`,
      promptVersion: "prompt",
      requestsReserved: 2,
      requestsMade: args.completedAt === undefined ? undefined : 1,
      settledAt: args.completedAt,
      error: args.status === "failed" ? "PROVIDER_FAILED" : undefined,
    }),
  );
}

describe("public seed approval", () => {
  test("provides a fenced server challenge when card projection is truncated", async () => {
    const fixture = await approvalFixture();
    await fixture.t.run(async (ctx) => {
      const largeExcerpt = "y".repeat(600_000);
      for (let index = 0; index < 7; index += 1) {
        await ctx.db.insert("seedProvenance", {
          seedId: fixture.seedId,
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          sourceId: fixture.sourceId,
          sourceContentHash: "source-hash",
          startOffset: 0,
          endOffset: 1,
          exactExcerpt: largeExcerpt,
        });
      }
    });

    const projected = await subsection(fixture);
    expect(projected.truncated).toBe(true);
    expect(projected.approvalChallenge).toBeNull();
    const review = await fixture.writer.query(getApprovalReviewRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: projected.seedStageVersion,
    });
    expect(review.selectedCount).toBe(1);
    await fixture.writer.mutation(approveRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: review.seedStageVersion,
      approvalChallenge: review.approvalChallenge.approvalChallenge,
      acknowledgedCarriedSeedIds: review.approvalChallenge.carriedSeedIds,
      acknowledgedExclusionEntryIds: review.approvalChallenge.exclusionEntryIds,
    });
    const approved = await fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId));
    expect(approved?.state).toBe("approved");
  });

  test("refuses an approval review that exceeds the server decision budget", async () => {
    const fixture = await approvalFixture();
    await fixture.t.run(async (ctx) => {
      const largeExcerpt = "y".repeat(600_000);
      for (let index = 0; index < 7; index += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId: fixture.briefId,
          projectId: fixture.projectId,
          group: "claimExclusion",
          text: `Excluded ${index}`,
          reason: "routine_engineering",
          sourceId: fixture.sourceId,
          sourceContentHash: "source-hash",
          startOffset: 0,
          endOffset: 1,
          exactExcerpt: largeExcerpt,
          createdAt: index,
        });
      }
    });

    await expect(fixture.writer.query(getApprovalReviewRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: 0,
    })).rejects.toMatchObject({
      data: {
        code: "INVALID_INPUT",
        reason: "SEED_PROCESSING_LIMIT",
        roleId: fixture.roleId,
      },
    });
  });

  test("requires the exact carried and exclusion lists and writes no prose", async () => {
    const fixture = await approvalFixture({
      bullet: "Routine maintenance constrained the measured trial.",
      outdated: true,
      exclusion: "routine maintenance",
    });
    const view = await subsection(fixture);
    const challenge = view.approvalChallenge;
    if (!challenge || !fixture.exclusionEntryId) {
      throw new Error("Expected carried and exclusion challenges");
    }
    expect(challenge.carriedSeedIds).toEqual([fixture.seedId]);
    expect(challenge.exclusionEntryIds).toEqual([fixture.exclusionEntryId]);
    expect(challenge.exclusions).toEqual([
      {
        entryId: fixture.exclusionEntryId,
        text: "routine maintenance",
        seedIds: [fixture.seedId],
      },
    ]);

    await expect(
      fixture.writer.mutation(approveRef, {
        generationId: fixture.generationId,
        roleId: fixture.roleId,
        expectedSeedStageVersion: view.seedStageVersion,
        approvalChallenge: "stale-client-challenge",
        acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
        acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
      }),
    ).rejects.toThrow(/challenge.*changed/i);
    await expect(
      fixture.writer.mutation(approveRef, {
        generationId: fixture.generationId,
        roleId: fixture.roleId,
        expectedSeedStageVersion: view.seedStageVersion,
        approvalChallenge: challenge.approvalChallenge,
        acknowledgedCarriedSeedIds: [],
        acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
      }),
    ).rejects.toThrow(/acknowledgments changed/i);

    const afterRefusals = await fixture.t.run(async (ctx) => ({
      generation: await ctx.db.get(fixture.generationId),
      subsection: await ctx.db.get(fixture.subsectionId),
      events: await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (query) =>
          query.eq("generationId", fixture.generationId),
        )
        .take(2),
    }));
    expect(afterRefusals.generation?.seedStageVersion).toBe(0);
    expect(afterRefusals.subsection).toMatchObject({ state: "in_progress" });
    expect(afterRefusals.events).toEqual([]);
    await expect(
      fixture.writer.mutation(approveRef, {
        generationId: fixture.generationId,
        roleId: fixture.roleId,
        expectedSeedStageVersion: view.seedStageVersion,
        approvalChallenge: challenge.approvalChallenge,
        acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
        acknowledgedExclusionEntryIds: [
          fixture.exclusionEntryId,
          fixture.exclusionEntryId,
        ],
      }),
    ).rejects.toThrow(/acknowledgments changed/i);

    const before = await fixture.t.run(async (ctx) => ({
      reports: await ctx.db.query("reports").take(1),
      proposals: await ctx.db.query("chatProposals").take(1),
      summaries: await ctx.db.query("summaryVersions").take(1),
      entries: await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (query) => query.eq("briefId", fixture.briefId))
        .take(5),
    }));
    await approveExact(fixture);
    const after = await fixture.t.run(async (ctx) => ({
      subsection: await ctx.db.get(fixture.subsectionId),
      reports: await ctx.db.query("reports").take(1),
      proposals: await ctx.db.query("chatProposals").take(1),
      summaries: await ctx.db.query("summaryVersions").take(1),
      entries: await ctx.db
        .query("generationBriefEntries")
        .withIndex("by_briefId", (query) => query.eq("briefId", fixture.briefId))
        .take(5),
      events: await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (query) =>
          query.eq("generationId", fixture.generationId),
        )
        .take(10),
    }));
    expect(after.subsection).toMatchObject({
      state: "approved",
      approvedWithConfirmation: true,
      exclusionAcknowledgedAt: NOW,
    });
    expect(after.reports).toEqual(before.reports);
    expect(after.proposals).toEqual(before.proposals);
    expect(after.summaries).toEqual(before.summaries);
    expect(after.entries).toEqual(before.entries);
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({
      kind: "approve",
      confirmed: true,
      snapshot: { items: [{ seedId: fixture.seedId, selectionVersion: 1 }] },
    });
    expect(JSON.stringify(after.events)).not.toMatch(
      /Routine maintenance|constrained|claimExclusion|bullets|instruction/i,
    );
  });

  test("freezes first exposure and eligible score across later approval and withdrawal", async () => {
    const fixture = await approvalFixture();
    const responseBatchId = await seedBatch(fixture, {
      roleId: fixture.roleId,
      operation: "feedback",
      status: "queued",
      key: "feedback-response",
    });
    const requestId = await fixture.t.run(async (ctx) => {
      const id = await ctx.db.insert("seedFeedbackRequests", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        roleId: fixture.roleId,
        targetSeedId: fixture.seedId,
        targetWording: ["Measured trials isolated the limiting mechanism."],
        instruction: "Offer a more precise alternative.",
        status: "active",
        batchId: responseBatchId,
      });
      await ctx.db.patch(responseBatchId, { feedbackRequestId: id });
      return id;
    });

    await approveExact(fixture);
    const first = await fixture.t.run((ctx) => ctx.db.get(requestId));
    expect(first?.firstApproveExposure).toMatchObject({
      outcome: "response_not_available",
    });
    expect(first?.eligibleScore).toBeUndefined();
    const firstApproveEventId = first?.firstApproveExposure?.approveEventId;

    const revisedSeedId = await fixture.t.run(async (ctx) => {
      await ctx.db.patch(responseBatchId, {
        status: "shown",
        completedAt: NOW + 1,
        requestsMade: 1,
        settledAt: NOW + 1,
      });
      return await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: responseBatchId,
        roleId: fixture.roleId,
        order: 0,
        bullets: ["A revised seed isolates the measurable constraint."],
        tags: ["detailed"],
        support: "source_supported",
        originalSupport: "source_supported",
        revisionOfSeedId: fixture.seedId,
        feedbackRequestId: requestId,
      });
    });
    const afterFirst = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.generationId),
    );
    const selected = await fixture.writer.mutation(selectRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: afterFirst?.seedStageVersion ?? -1,
      seedId: revisedSeedId,
      selected: true,
    });
    const deselected = await fixture.writer.mutation(deselectRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: selected.seedStageVersion,
      seedId: fixture.seedId,
    });
    const secondView = await subsection(fixture);
    expect(secondView.seedStageVersion).toBe(deselected.seedStageVersion);
    await approveExact(fixture);

    const scored = await fixture.t.run((ctx) => ctx.db.get(requestId));
    expect(scored?.firstApproveExposure).toEqual({
      approveEventId: firstApproveEventId,
      outcome: "response_not_available",
    });
    expect(scored?.eligibleScore).toMatchObject({ selected: true });
    expect(scored?.eligibleScore?.approveEventId).not.toBe(firstApproveEventId);

    const afterScore = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.generationId),
    );
    const reselectedOriginal = await fixture.writer.mutation(selectRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: afterScore?.seedStageVersion ?? -1,
      seedId: fixture.seedId,
      selected: true,
    });
    await fixture.writer.mutation(deselectRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: reselectedOriginal.seedStageVersion,
      seedId: revisedSeedId,
    });
    await approveExact(fixture);
    const rescored = await fixture.t.run((ctx) => ctx.db.get(requestId));
    expect(rescored?.firstApproveExposure).toEqual(scored?.firstApproveExposure);
    expect(rescored?.eligibleScore).toEqual(scored?.eligibleScore);

    const repeatView = await subsection(fixture);
    const repeatChallenge = repeatView.approvalChallenge;
    if (!repeatChallenge) throw new Error("Expected a complete approval challenge");
    const registered = await import("./seeds");
    const repeatedOutcomePatches = await fixture.writer.run(async (ctx) => {
      const patch = vi.spyOn(ctx.db, "patch");
      try {
        await mutationHandler(registered.approve)(ctx, {
          generationId: fixture.generationId,
          roleId: fixture.roleId,
          expectedSeedStageVersion: repeatView.seedStageVersion,
          approvalChallenge: repeatChallenge.approvalChallenge,
          acknowledgedCarriedSeedIds: repeatChallenge.carriedSeedIds,
          acknowledgedExclusionEntryIds: repeatChallenge.exclusionEntryIds,
        });
        return patch.mock.calls.filter(([id]) => id === requestId);
      } finally {
        patch.mockRestore();
      }
    });
    expect(repeatedOutcomePatches).toEqual([]);
    expect(await fixture.t.run((ctx) => ctx.db.get(requestId))).toMatchObject({
      firstApproveExposure: scored?.firstApproveExposure,
      eligibleScore: scored?.eligibleScore,
    });

    const generation = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.generationId),
    );
    await fixture.writer.mutation(withdrawFeedbackRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: generation?.seedStageVersion ?? -1,
      feedbackRequestId: requestId,
    });
    const withdrawn = await fixture.t.run((ctx) => ctx.db.get(requestId));
    expect(withdrawn).toMatchObject({
      status: "withdrawn",
      targetSeedId: fixture.seedId,
      targetWording: ["Measured trials isolated the limiting mechanism."],
      instruction: "Offer a more precise alternative.",
      firstApproveExposure: scored?.firstApproveExposure,
      eligibleScore: scored?.eligibleScore,
    });
  });

  test("approve owns only the two immutable feedback outcome fields", async () => {
    const fixture = await approvalFixture();
    const responseBatchId = await seedBatch(fixture, {
      roleId: fixture.roleId,
      operation: "feedback",
      status: "shown",
      completedAt: NOW - 1,
      key: "completed-feedback-response",
    });
    const response = await fixture.t.run(async (ctx) => {
      const requestId = await ctx.db.insert("seedFeedbackRequests", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        roleId: fixture.roleId,
        targetSeedId: fixture.seedId,
        targetWording: ["Measured trials isolated the limiting mechanism."],
        instruction: "Keep the measurable result explicit.",
        status: "active",
        batchId: responseBatchId,
      });
      await ctx.db.patch(responseBatchId, { feedbackRequestId: requestId });
      const seedId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: responseBatchId,
        roleId: fixture.roleId,
        order: 0,
        bullets: ["The revised trial isolated the measurable constraint."],
        tags: ["detailed"],
        support: "source_supported",
        originalSupport: "source_supported",
        revisionOfSeedId: fixture.seedId,
        feedbackRequestId: requestId,
      });
      await ctx.db.insert("seedSelections", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        seedId,
        roleId: fixture.roleId,
        selected: true,
        selectedAt: NOW - 1,
        version: 1,
      });
      return { requestId, seedId };
    });
    const view = await subsection(fixture);
    const challenge = view.approvalChallenge;
    if (!challenge) throw new Error("Expected a complete approval challenge");
    const registered = await import("./seeds");
    const feedbackPatches = await fixture.writer.run(async (ctx) => {
      const patch = vi.spyOn(ctx.db, "patch");
      try {
        await mutationHandler(registered.approve)(ctx, {
          generationId: fixture.generationId,
          roleId: fixture.roleId,
          expectedSeedStageVersion: view.seedStageVersion,
          approvalChallenge: challenge.approvalChallenge,
          acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
          acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
        });
        return patch.mock.calls
          .filter(([id]) => id === response.requestId)
          .map(([, fields]) => fields);
      } finally {
        patch.mockRestore();
      }
    });

    expect(feedbackPatches).toHaveLength(2);
    expect(feedbackPatches.map((fields) => Object.keys(fields))).toEqual([
      ["firstApproveExposure"],
      ["eligibleScore"],
    ]);
    expect(feedbackPatches[0]).toMatchObject({
      firstApproveExposure: { outcome: "selected" },
    });
    expect(feedbackPatches[1]).toMatchObject({
      eligibleScore: { selected: true },
    });
    await expect(
      fixture.t.run((ctx) => ctx.db.get(response.requestId)),
    ).resolves.toMatchObject({
      targetSeedId: fixture.seedId,
      targetWording: ["Measured trials isolated the limiting mechanism."],
      instruction: "Keep the measurable result explicit.",
      status: "active",
      firstApproveExposure: { outcome: "selected" },
      eligibleScore: { selected: true },
    });
  });

  const staleApprovalCases = [
    {
      name: "fresh selected response",
      freshAttemptCompleted: true,
      selectFreshSeed: true,
      contextReturn: false,
      olderSelectionsConfirmed: false,
      freshAttemptUsedMetric: 1,
      confirmedOnlyMetric: 0,
    },
    {
      name: "fresh unused response with confirmed older selection",
      freshAttemptCompleted: true,
      selectFreshSeed: false,
      contextReturn: false,
      olderSelectionsConfirmed: true,
      freshAttemptUsedMetric: 1,
      confirmedOnlyMetric: 0,
    },
    {
      name: "older-only confirmation after a context return",
      freshAttemptCompleted: false,
      selectFreshSeed: false,
      contextReturn: true,
      olderSelectionsConfirmed: true,
      freshAttemptUsedMetric: 0,
      confirmedOnlyMetric: 1,
    },
  ];

  test.each(staleApprovalCases)(
    "disposes a real stale episode with precise facts for $name",
    async (scenario) => {
      const fixture = await approvalFixture();
      await approveExact(fixture);

      const upstreamBatchId = await seedBatch(fixture, {
        roleId: "company_context",
        status: "shown",
        completedAt: NOW - 1,
        consumedContextRevision: await emptyContextRevision(),
        key: `upstream-${scenario.name}`,
      });
      const upstreamSeedId = await fixture.t.run(async (ctx) => {
        const seedId = await ctx.db.insert("seeds", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          batchId: upstreamBatchId,
          roleId: "company_context",
          order: 0,
          bullets: ["The project operated under a measured constraint."],
          tags: ["technical"],
          support: "source_supported",
          originalSupport: "source_supported",
        });
        const rowId = fixture.subsectionIds.company_context;
        if (!rowId) throw new Error("Missing company context subsection");
        await ctx.db.patch(rowId, {
          state: "in_progress",
          shownBatchId: upstreamBatchId,
        });
        return seedId;
      });
      const beforeUpstream = await fixture.t.run((ctx) =>
        ctx.db.get(fixture.generationId),
      );
      const selectedUpstream = await fixture.writer.mutation(selectRef, {
        generationId: fixture.generationId,
        roleId: "company_context",
        expectedSeedStageVersion: beforeUpstream?.seedStageVersion ?? -1,
        seedId: upstreamSeedId,
        selected: true,
      });
      let activeVersion = selectedUpstream.seedStageVersion;
      if (scenario.contextReturn) {
        const returned = await fixture.writer.mutation(deselectRef, {
          generationId: fixture.generationId,
          roleId: "company_context",
          expectedSeedStageVersion: activeVersion,
          seedId: upstreamSeedId,
        });
        const changedAgain = await fixture.writer.mutation(selectRef, {
          generationId: fixture.generationId,
          roleId: "company_context",
          expectedSeedStageVersion: returned.seedStageVersion,
          seedId: upstreamSeedId,
          selected: true,
        });
        activeVersion = changedAgain.seedStageVersion;
      }

      const opened = await fixture.t.run(async (ctx) => {
        const row = await ctx.db.get(fixture.subsectionId);
        const episodes = await ctx.db
          .query("seedStaleEpisodes")
          .withIndex("by_generationId_and_roleId", (query) =>
            query
              .eq("generationId", fixture.generationId)
              .eq("roleId", fixture.roleId),
          )
          .take(3);
        return { row, episodes };
      });
      expect(opened.episodes).toHaveLength(1);
      expect(opened.row?.activeStaleEpisodeId).toBe(opened.episodes[0]._id);
      expect(opened.episodes[0].disposedAt).toBeUndefined();

      let freshSeedId: Id<"seeds"> | undefined;
      if (scenario.freshAttemptCompleted) {
        vi.setSystemTime(NOW + 1);
        const currentContextRevision = opened.row?.currentContextRevision;
        if (!currentContextRevision) throw new Error("Missing current context");
        const freshBatchId = await seedBatch(fixture, {
          roleId: fixture.roleId,
          status: "shown",
          completedAt: NOW + 1,
          consumedContextRevision: currentContextRevision,
          key: `fresh-${scenario.name}`,
        });
        freshSeedId = await fixture.t.run((ctx) =>
          ctx.db.insert("seeds", {
            projectId: fixture.projectId,
            generationId: fixture.generationId,
            batchId: freshBatchId,
            roleId: fixture.roleId,
            order: 0,
            bullets: ["Fresh evidence resolves the changed project context."],
            tags: ["detailed"],
            support: "source_supported",
            originalSupport: "source_supported",
          }),
        );
      }
      if (scenario.selectFreshSeed) {
        if (!freshSeedId) throw new Error("Missing fresh Seed");
        const selectedFresh = await fixture.writer.mutation(selectRef, {
          generationId: fixture.generationId,
          roleId: fixture.roleId,
          expectedSeedStageVersion: activeVersion,
          seedId: freshSeedId,
          selected: true,
        });
        const deselectedOlder = await fixture.writer.mutation(deselectRef, {
          generationId: fixture.generationId,
          roleId: fixture.roleId,
          expectedSeedStageVersion: selectedFresh.seedStageVersion,
          seedId: fixture.seedId,
        });
        activeVersion = deselectedOlder.seedStageVersion;
      }

      const beforeApproval = await subsection(fixture);
      expect(beforeApproval.seedStageVersion).toBe(activeVersion);
      expect(beforeApproval.approvalChallenge?.carriedSeedIds).toEqual(
        scenario.olderSelectionsConfirmed ? [fixture.seedId] : [],
      );
      vi.setSystemTime(NOW + 2);
      await approveExact(fixture);

      const disposed = await fixture.t.run(async (ctx) => ({
        row: await ctx.db.get(fixture.subsectionId),
        episodes: await ctx.db
          .query("seedStaleEpisodes")
          .withIndex("by_generationId_and_roleId", (query) =>
            query
              .eq("generationId", fixture.generationId)
              .eq("roleId", fixture.roleId),
          )
          .take(3),
        events: await ctx.db
          .query("seedDecisionEvents")
          .withIndex("by_generationId_and_at", (query) =>
            query.eq("generationId", fixture.generationId),
          )
          .take(30),
      }));
      expect(disposed.episodes).toHaveLength(1);
      expect(disposed.row?.activeStaleEpisodeId).toBeUndefined();
      expect(disposed.episodes[0]).toMatchObject({
        disposition: "resolved",
        freshAttemptCompleted: scenario.freshAttemptCompleted,
        freshSeedsInSnapshot: scenario.selectFreshSeed,
        olderSelectionsConfirmed: scenario.olderSelectionsConfirmed,
      });
      expect(disposed.episodes[0].disposedAt).toBe(NOW + 2);
      expect(
        disposed.events
          .filter(
            (event) =>
              event.kind === "staleOpened" || event.kind === "staleDisposed",
          )
          .map((event) => ({
            kind: event.kind,
            staleEpisodeId: event.staleEpisodeId,
          })),
      ).toEqual([
        { kind: "staleOpened", staleEpisodeId: disposed.episodes[0]._id },
        { kind: "staleDisposed", staleEpisodeId: disposed.episodes[0]._id },
      ]);

      const health = await fixture.admin.query(getSeedHealthRef, {
        start: NOW - 1,
        end: NOW + 3,
        gatedWorkflow: "seeds",
      });
      expect(health.incomplete).toBe(false);
      expect(health.stale).toMatchObject({
        open: 0,
        resolved: 1,
        bypassed: 0,
        freshAttemptUsed: scenario.freshAttemptUsedMetric,
        confirmedOnly: scenario.confirmedOnlyMetric,
      });
    },
  );

  test("requires confirmation when only an unselected feedback target wording changed", async () => {
    const fixture = await approvalFixture();
    const dispatched = await fixture.writer.mutation(giveFeedbackRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: 0,
      seedId: fixture.seedId,
      instruction: "State the measurable constraint more precisely.",
      commandId: "target-wording-only",
    });
    const claimed = await fixture.t.mutation(claimAttemptRef, {
      batchId: dispatched.batchId,
    });
    if (claimed.kind !== "claimed") throw new Error("Expected claimed feedback attempt");
    await fixture.t.mutation(completeAttemptRef, {
      batchId: dispatched.batchId,
      attemptId: claimed.batch.attemptId,
      requestsMade: 1,
      seeds: [
        {
          bullets: ["The revised trial isolated a measurable constraint."],
          tags: ["detailed"],
          provenance: [
            {
              sourceId: fixture.sourceId,
              startOffset: 0,
              endOffset: 19,
              exactExcerpt: "Routine maintenance",
            },
          ],
        },
      ],
    });
    const response = await fixture.t.run(async (ctx) => {
      const seeds = await ctx.db
        .query("seeds")
        .withIndex("by_batchId", (query) => query.eq("batchId", dispatched.batchId))
        .take(3);
      const batch = await ctx.db.get(dispatched.batchId);
      const row = await ctx.db.get(fixture.subsectionId);
      const generation = await ctx.db.get(fixture.generationId);
      return { seeds, batch, row, generation };
    });
    expect(response.seeds).toHaveLength(1);
    const revisedSeedId = response.seeds[0]._id;
    expect(response.seeds[0]).toMatchObject({
      revisionOfSeedId: fixture.seedId,
      feedbackRequestId: dispatched.feedbackRequestId,
    });
    expect(response.batch?.consumedContextRevision).toBe(
      response.row?.currentContextRevision,
    );
    const currentContextRevision = response.row?.currentContextRevision;
    if (!currentContextRevision) throw new Error("Missing feedback context revision");
    const currentShownBatchId = await seedBatch(fixture, {
      roleId: fixture.roleId,
      status: "shown",
      completedAt: NOW,
      consumedContextRevision: currentContextRevision,
      key: "current-shown-after-feedback",
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.batchId, { status: "superseded" });
      await ctx.db.patch(fixture.subsectionId, { shownBatchId: currentShownBatchId });
      await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: currentShownBatchId,
        roleId: fixture.roleId,
        order: 0,
        bullets: ["A current ordinary alternative remains unselected."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
    });

    const selectedRevision = await fixture.writer.mutation(selectRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: response.generation?.seedStageVersion ?? -1,
      seedId: revisedSeedId,
      selected: true,
    });
    const deselectedTarget = await fixture.writer.mutation(deselectRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: selectedRevision.seedStageVersion,
      seedId: fixture.seedId,
    });
    const beforeEdit = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.subsectionId),
    );
    await fixture.writer.mutation(editRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: deselectedTarget.seedStageVersion,
      seedId: fixture.seedId,
      bullets: ["The unselected target now uses different wording."],
    });

    const changed = await subsection(fixture);
    const changedRow = await fixture.t.run((ctx) =>
      ctx.db.get(fixture.subsectionId),
    );
    expect(changedRow?.currentContextRevision).toBe(
      beforeEdit?.currentContextRevision,
    );
    expect(changedRow?.currentContextRevision).toBe(
      response.batch?.consumedContextRevision,
    );
    expect(changed.items.find((item) => item.seedId === revisedSeedId)?.outdated).toEqual({
      changedRoleIds: [],
      targetWordingChanged: true,
      incomplete: false,
    });
    expect(changed.approvalChallenge).toMatchObject({
      carriedSeedIds: [revisedSeedId],
      changedRoleIds: [fixture.roleId],
      shownBatchOutdated: false,
    });
    const challenge = changed.approvalChallenge;
    if (!challenge) throw new Error("Expected target-wording approval challenge");
    await expect(
      fixture.writer.mutation(approveRef, {
        generationId: fixture.generationId,
        roleId: fixture.roleId,
        expectedSeedStageVersion: changed.seedStageVersion,
        approvalChallenge: challenge.approvalChallenge,
        acknowledgedCarriedSeedIds: [],
        acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
      }),
    ).rejects.toThrow(/acknowledgments changed|INVALID_INPUT/i);

    const restoredVersion = await fixture.writer.mutation(restoreWordingRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: changed.seedStageVersion,
      seedId: fixture.seedId,
    });
    const restored = await subsection(fixture);
    expect(restored.seedStageVersion).toBe(restoredVersion.seedStageVersion);
    expect(restored.state).toBe("in_progress");
    expect(
      restored.items.find((item) => item.seedId === revisedSeedId)?.outdated,
    ).toBeNull();
    expect(restored.approvalChallenge).toMatchObject({
      carriedSeedIds: [],
      changedRoleIds: [],
      shownBatchOutdated: false,
    });
    const afterRestore = await fixture.t.run(async (ctx) => ({
      row: await ctx.db.get(fixture.subsectionId),
      batch: await ctx.db.get(dispatched.batchId),
      approveEvents: await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_roleId_and_kind_and_at", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", fixture.roleId)
            .eq("kind", "approve"),
        )
        .take(2),
    }));
    expect(afterRestore.row?.currentContextRevision).toBe(
      afterRestore.batch?.consumedContextRevision,
    );
    expect(afterRestore.approveEvents).toEqual([]);
  });

  test("refuses an advancement until every selected reference is active", async () => {
    const fixture = await approvalFixture({ roleId: "specific_advancements" });
    const uncertaintyBatchId = await seedBatch(fixture, {
      roleId: "active_uncertainties",
      key: "uncertainty-reference",
    });
    const experimentBatchId = await seedBatch(fixture, {
      roleId: "experimentation",
      key: "experiment-reference",
    });
    const references = await fixture.t.run(async (ctx) => {
      const uncertaintySeedId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: uncertaintyBatchId,
        roleId: "active_uncertainties",
        order: 0,
        bullets: ["The uncertainty remained measurable."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      const experimentSeedId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId: experimentBatchId,
        roleId: "experimentation",
        order: 0,
        bullets: ["The experiment varied the constrained parameter."],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
      });
      await ctx.db.patch(fixture.seedId, {
        uncertaintySeedId,
        experimentSeedIds: [experimentSeedId],
      });
      return { uncertaintySeedId, experimentSeedId };
    });
    const initial = await subsection(fixture);
    const initialChallenge = initial.approvalChallenge;
    if (!initialChallenge) throw new Error("Expected advancement challenge");
    await expect(
      fixture.writer.mutation(approveRef, {
        generationId: fixture.generationId,
        roleId: fixture.roleId,
        expectedSeedStageVersion: initial.seedStageVersion,
        approvalChallenge: initialChallenge.approvalChallenge,
        acknowledgedCarriedSeedIds: initialChallenge.carriedSeedIds,
        acknowledgedExclusionEntryIds: initialChallenge.exclusionEntryIds,
      }),
    ).rejects.toThrow(/UNLINKED_ADVANCEMENT|references must be active/i);

    await fixture.t.run(async (ctx) => {
      const selectedReferences: Array<
        ["active_uncertainties" | "experimentation", Id<"seeds">]
      > = [
        ["active_uncertainties", references.uncertaintySeedId],
        ["experimentation", references.experimentSeedId],
      ];
      for (const [roleId, seedId] of selectedReferences) {
        await ctx.db.insert("seedSelections", {
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          seedId,
          roleId,
          selected: true,
          selectedAt: NOW,
          version: 1,
        });
      }
      const skippedSuccessors: Array<"project_status" | "goal_improvements"> = [
        "project_status",
        "goal_improvements",
      ];
      for (const roleId of skippedSuccessors) {
        const subsectionId = fixture.subsectionIds[roleId];
        if (!subsectionId) throw new Error(`Missing ${roleId} subsection`);
        await ctx.db.patch(subsectionId, { state: "skipped" });
      }
    });
    await approveExact(fixture);
    await expect(
      fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId)),
    ).resolves.toMatchObject({ state: "approved" });
  });

  test("approves out of order and prefetches only its first untouched successor", async () => {
    const fixture = await approvalFixture({ roleId: "passive_limitations" });
    await fixture.t.run(async (ctx) => {
      const successorId = fixture.subsectionIds.technological_objective;
      if (!successorId) {
        throw new Error("Missing technological_objective subsection");
      }
      const successorSnapshot = await loadSeedDispatchSnapshot(ctx, {
        generationId: fixture.generationId,
        roleId: "technological_objective",
      });
      await ctx.db.patch(successorId, {
        currentContextRevision: successorSnapshot.contextRevision,
      });
    });

    await approveExact(fixture);
    const state = await fixture.t.run(async (ctx) => ({
      earlier: await Promise.all(
        ["company_context", "goal_problem"].map((roleId) =>
          ctx.db
            .query("seedBatches")
            .withIndex("by_generationId_and_roleId", (query) =>
              query
                .eq("generationId", fixture.generationId)
                .eq(
                  "roleId",
                  roleId === "company_context" ? "company_context" : "goal_problem",
                ),
            )
            .take(2),
        ),
      ),
      successor: await ctx.db
        .query("seedSubsections")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "technological_objective"),
        )
        .unique(),
      successorBatches: await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "technological_objective"),
        )
        .take(2),
      fartherBatches: await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "active_uncertainties"),
        )
        .take(2),
    }));
    expect(state.earlier).toEqual([[], []]);
    expect(state.successor).toMatchObject({
      state: "generating",
      priorState: "untouched",
      pendingBatchId: state.successorBatches[0]?._id,
    });
    expect(state.successorBatches).toHaveLength(1);
    expect(state.successorBatches[0]).toMatchObject({
      operation: "prefetch",
      status: "queued",
    });
    expect(state.fartherBatches).toEqual([]);
  });

  test("does not prefetch when approval exhausts the successor chain", async () => {
    const fixture = await approvalFixture({ roleId: "goal_improvements" });
    await approveExact(fixture);
    const state = await fixture.t.run(async (ctx) => ({
      batches: await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "goal_improvements"),
        )
        .take(2),
      events: await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (query) =>
          query.eq("generationId", fixture.generationId),
        )
        .take(3),
    }));
    expect(state.batches.map((batch) => batch._id)).toEqual([fixture.batchId]);
    expect(state.events.map((event) => event.kind)).toEqual(["approve"]);
  });

  const pendingPrefetchStatuses: Array<"queued" | "running"> = [
    "queued",
    "running",
  ];
  test.each(pendingPrefetchStatuses)(
    "does not start another prefetch while one is %s",
    async (status) => {
      const fixture = await approvalFixture({ roleId: "company_context" });
      const existingBatchId = await seedBatch(fixture, {
        roleId: "passive_limitations",
        operation: "prefetch",
        status,
        key: `existing-${status}-prefetch`,
      });
      await fixture.t.run(async (ctx) => {
        const subsectionId = fixture.subsectionIds.passive_limitations;
        if (!subsectionId) {
          throw new Error("Missing passive_limitations subsection");
        }
        await ctx.db.patch(subsectionId, {
          state: "generating",
          priorState: "untouched",
          pendingBatchId: existingBatchId,
        });
      });

      await approveExact(fixture);
      const batches = await fixture.t.run(async (ctx) => ({
        candidate: await ctx.db
          .query("seedBatches")
          .withIndex("by_generationId_and_roleId", (query) =>
            query
              .eq("generationId", fixture.generationId)
              .eq("roleId", "goal_problem"),
          )
          .take(2),
        existing: await ctx.db.get(existingBatchId),
        farther: await ctx.db
          .query("seedBatches")
          .withIndex("by_generationId_and_roleId", (query) =>
            query
              .eq("generationId", fixture.generationId)
              .eq("roleId", "technological_objective"),
          )
          .take(2),
      }));
      expect(batches.candidate).toEqual([]);
      expect(batches.existing).toMatchObject({
        operation: "prefetch",
        status,
      });
      expect(batches.farther).toEqual([]);
    },
  );

  test("keeps approval when optional prefetch exceeds the source input limit", async () => {
    const fixture = await approvalFixture({ roleId: "company_context" });
    await fixture.t.run(async (ctx) => {
      const successorId = fixture.subsectionIds.goal_problem;
      if (!successorId) throw new Error("Missing goal_problem subsection");
      const successorSnapshot = await loadSeedDispatchSnapshot(ctx, {
        generationId: fixture.generationId,
        roleId: "goal_problem",
      });
      await ctx.db.patch(successorId, {
        currentContextRevision: successorSnapshot.contextRevision,
      });
      for (let index = 0; index < 129; index += 1) {
        await ctx.db.insert("generationSources", {
          generationId: fixture.generationId,
          projectId: fixture.projectId,
          kind: "transcript",
          label: `Source ${index}`,
          content: `Evidence ${index}`,
          contentHash: `hash-${index}`,
          truncated: false,
          originalLength: 20,
          capturedAt: index + 2,
        });
      }
    });
    const result = await approveExact(fixture);
    const state = await fixture.t.run(async (ctx) => ({
      subsection: await ctx.db.get(fixture.subsectionId),
      generation: await ctx.db.get(fixture.generationId),
      successor: await ctx.db
        .query("seedSubsections")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "goal_problem"),
        )
        .unique(),
      successorBatches: await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "goal_problem"),
        )
        .take(2),
      events: await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (query) =>
          query.eq("generationId", fixture.generationId),
        )
        .take(5),
    }));
    expect(result.result.seedStageVersion).toBe(1);
    expect(state.subsection).toMatchObject({ state: "approved" });
    expect(state.generation?.seedStageVersion).toBe(1);
    expect(state.successor).toMatchObject({ state: "untouched" });
    expect(state.successorBatches).toEqual([]);
    expect(state.events.map((event) => event.kind)).toEqual(["approve"]);
  });

  test("keeps approval when optional prefetch exceeds the Brief entry limit", async () => {
    const fixture = await approvalFixture({ roleId: "company_context" });
    await fixture.t.run(async (ctx) => {
      const successorId = fixture.subsectionIds.goal_problem;
      if (!successorId) throw new Error("Missing goal_problem subsection");
      const successorSnapshot = await loadSeedDispatchSnapshot(ctx, {
        generationId: fixture.generationId,
        roleId: "goal_problem",
      });
      await ctx.db.patch(successorId, {
        currentContextRevision: successorSnapshot.contextRevision,
      });
      for (let index = 0; index < 501; index += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId: fixture.briefId,
          projectId: fixture.projectId,
          group: "glossaryTerm",
          text: `Term ${index}`,
          sourceId: fixture.sourceId,
          sourceContentHash: "source-hash",
          startOffset: 0,
          endOffset: 1,
          exactExcerpt: "R",
          createdAt: index + 2,
        });
      }
    });

    const result = await approveExact(fixture);
    const state = await fixture.t.run(async (ctx) => ({
      subsection: await ctx.db.get(fixture.subsectionId),
      generation: await ctx.db.get(fixture.generationId),
      successorBatches: await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "goal_problem"),
        )
        .take(2),
      events: await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (query) =>
          query.eq("generationId", fixture.generationId),
        )
        .take(5),
    }));
    expect(result.result.seedStageVersion).toBe(1);
    expect(state.subsection).toMatchObject({ state: "approved" });
    expect(state.generation?.seedStageVersion).toBe(1);
    expect(state.successorBatches).toEqual([]);
    expect(state.events.map((event) => event.kind)).toEqual(["approve"]);
  });

  test("does not fan prefetch past the first untouched successor with history", async () => {
    const fixture = await approvalFixture({ roleId: "company_context" });
    await seedBatch(fixture, {
      roleId: "goal_problem",
      status: "failed",
      key: "historical-goal-batch",
    });
    await approveExact(fixture);
    const batches = await fixture.t.run(async (ctx) => ({
      goal: await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "goal_problem"),
        )
        .take(3),
      farther: await ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query
            .eq("generationId", fixture.generationId)
            .eq("roleId", "passive_limitations"),
        )
        .take(3),
    }));
    expect(batches.goal).toHaveLength(1);
    expect(batches.goal[0]).toMatchObject({
      status: "failed",
      commandId: "historical-goal-batch",
    });
    expect(batches.farther).toEqual([]);
  });
});
