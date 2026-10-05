/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredMutation,
  type RegisteredQuery,
} from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
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
import { readSeedReadiness } from "./lib/seedReadiness";

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
  rateLimiterTest.register(t);
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

describe("Use it anyway (2026-09-27, third amendment, review P3-9)", () => {
  async function markedFixture() {
    const fixture = await approvalFixture({ roleId: "company_context" });
    const rowIds = await fixture.t.run(async (ctx) => {
      const insert = (exactExcerpt: string, needsQuoteCheck: boolean) =>
        ctx.db.insert("seedProvenance", {
          seedId: fixture.seedId,
          projectId: fixture.projectId,
          generationId: fixture.generationId,
          sourceId: fixture.sourceId,
          sourceContentHash: "hash",
          startOffset: 0,
          endOffset: exactExcerpt.length,
          exactExcerpt,
          ...(needsQuoteCheck ? { needsQuoteCheck: true } : {}),
        });
      return [await insert("Marked line one.", true), await insert("Marked line two.", true), await insert("Clean line.", false)];
    });
    const version = (await fixture.t.run((ctx) => ctx.db.get(fixture.generationId)))?.seedStageVersion ?? 0;
    return { fixture, rowIds, version };
  }

  test("keeps the Seed's marked quotes as evidence and records the decision", async () => {
    const { fixture, rowIds, version } = await markedFixture();
    const result = await fixture.writer.mutation(api.seeds.useQuotesAnyway, {
      generationId: fixture.generationId,
      roleId: "company_context",
      expectedSeedStageVersion: version,
      seedId: fixture.seedId,
    });
    expect(result.seedStageVersion).toBe(version + 1);
    const state = await fixture.t.run(async (ctx) => ({
      rows: await Promise.all(rowIds.map((id) => ctx.db.get(id))),
      events: await ctx.db
        .query("seedDecisionEvents")
        .withIndex("by_generationId_and_at", (q) => q.eq("generationId", fixture.generationId))
        .collect(),
    }));
    expect(state.rows.map((row) => row?.needsQuoteCheck)).toEqual([undefined, undefined, undefined]);
    expect(state.events.filter((event) => event.kind === "quotesConfirmed")).toEqual([
      expect.objectContaining({ roleId: "company_context", seedId: fixture.seedId, actorUserId: expect.any(String) }),
    ]);
    // Nothing left to keep: a second click writes nothing.
    const again = await fixture.writer.mutation(api.seeds.useQuotesAnyway, {
      generationId: fixture.generationId,
      roleId: "company_context",
      expectedSeedStageVersion: version + 1,
      seedId: fixture.seedId,
    });
    expect(again.seedStageVersion).toBe(version + 1);
  });

  test("2026-10-04 (second, round 3): a Seed writer-asserted for its marked quotes is source-supported once kept, unless the writer edited it", async () => {
    for (const edited of [false, true]) {
      const { fixture, version } = await markedFixture();
      await fixture.t.run(async (ctx) => {
        await ctx.db.patch(fixture.seedId, { support: "writer_asserted", originalSupport: "writer_asserted" });
        if (edited) {
          const selection = await ctx.db.query("seedSelections")
            .withIndex("by_seedId", (q) => q.eq("seedId", fixture.seedId))
            .unique();
          if (selection) await ctx.db.patch(selection._id, { editedBullets: ["The writer's own wording."] });
          else throw new Error("Missing selection");
        }
      });
      await fixture.writer.mutation(api.seeds.useQuotesAnyway, {
        generationId: fixture.generationId,
        roleId: "company_context",
        expectedSeedStageVersion: version,
        seedId: fixture.seedId,
      });
      const seed = await fixture.t.run((ctx) => ctx.db.get(fixture.seedId));
      expect({ support: seed?.support, originalSupport: seed?.originalSupport }).toEqual(
        edited
          ? { support: "writer_asserted", originalSupport: "source_supported" }
          : { support: "source_supported", originalSupport: "source_supported" }
      );
    }
  });

  test("refuses a person without edit access, and a stale stage version, changing nothing", async () => {
    const { fixture, rowIds, version } = await markedFixture();
    await fixture.t.run((ctx) => ctx.db.insert("users", { authId: "seed-approval-outsider", role: "writer" }));
    await expect(
      fixture.t.withIdentity({ subject: "seed-approval-outsider" }).mutation(api.seeds.useQuotesAnyway, {
        generationId: fixture.generationId,
        roleId: "company_context",
        expectedSeedStageVersion: version,
        seedId: fixture.seedId,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED|not authorized|Only the project owner/i);
    await fixture.t.run((ctx) => ctx.db.patch(fixture.generationId, { seedStageVersion: version + 2 }));
    await expect(
      fixture.writer.mutation(api.seeds.useQuotesAnyway, {
        generationId: fixture.generationId,
        roleId: "company_context",
        expectedSeedStageVersion: version + 5,
        seedId: fixture.seedId,
      })
    ).rejects.toThrow(/STALE_REVISION/);
    const rows = await fixture.t.run((ctx) => Promise.all(rowIds.map((id) => ctx.db.get(id))));
    expect(rows.map((row) => row?.needsQuoteCheck ?? false)).toEqual([true, true, false]);
  });
});

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

  // 2026-09-29 (first amendment), release suite run 6 (Marrowgate, fictional).
  async function linkSeed(
    fixture: Fixture,
    args: {
      roleId: "active_uncertainties" | "experimentation" | "specific_advancements";
      bullet: string;
      /** "never": no selection row at all, as for a Seed never ticked. */
      selected: boolean | "never";
      uncertaintySeedId?: Id<"seeds">;
    },
  ) {
    const batchId = await seedBatch(fixture, {
      roleId: args.roleId,
      key: `${args.roleId}-${args.bullet.slice(0, 12)}`,
    });
    return await fixture.t.run(async (ctx) => {
      const seedId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId,
        roleId: args.roleId,
        order: 0,
        bullets: [args.bullet],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
        ...(args.uncertaintySeedId ? { uncertaintySeedId: args.uncertaintySeedId } : {}),
      });
      if (args.selected === "never") return seedId;
      await ctx.db.insert("seedSelections", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        seedId,
        roleId: args.roleId,
        selected: args.selected,
        selectedAt: NOW,
        version: 1,
      });
      return seedId;
    });
  }

  async function skipLaterSteps(fixture: Fixture, roleIds: PdSubsectionRoleId[]) {
    await fixture.t.run(async (ctx) => {
      for (const roleId of roleIds) {
        const subsectionId = fixture.subsectionIds[roleId];
        if (!subsectionId) throw new Error(`Missing ${roleId} subsection`);
        await ctx.db.patch(subsectionId, { state: "skipped" });
      }
    });
  }

  async function tryApprove(fixture: Fixture) {
    const view = await subsection(fixture);
    const challenge = view.approvalChallenge;
    if (!challenge) throw new Error("Expected a complete approval challenge");
    return fixture.writer.mutation(approveRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: view.seedStageVersion,
      approvalChallenge: challenge.approvalChallenge,
      acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
      acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
    });
  }

  test("refuses an advancement whose experiments tested another uncertainty, and the step says so first (2026-09-29, first)", async () => {
    const fixture = await approvalFixture({
      roleId: "specific_advancements",
      bullet: "Stepwise acclimation resolved the cold-water start-up uncertainty.",
    });
    const dosing = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether feed-forward dosing could hold TAN under 1 mg/L was unresolved.",
      selected: true,
    });
    const sensors = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether fouled sensors stay accurate enough for control was unknown.",
      selected: true,
    });
    const dosingTrial = await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "Trial three cut peak TAN from 2.3 to 1.2 mg/L.",
      selected: true,
      uncertaintySeedId: dosing,
    });
    // The run 6 shape: the advancement names the sensor uncertainty and a
    // trial that tested another one.
    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.seedId, { uncertaintySeedId: sensors, experimentSeedIds: [dosingTrial] }),
    );
    await skipLaterSteps(fixture, ["project_status", "goal_improvements"]);

    const before = await subsection(fixture);
    expect(before.linkNotice).toEqual({ kind: "unlinked_advancements", seedIds: [fixture.seedId] });
    expect(before.items.find((item) => item.seedId === fixture.seedId)?.linkedUncertainty).toEqual({
      seedId: sensors,
      bullets: ["Whether fouled sensors stay accurate enough for control was unknown."],
      picked: true,
    });
    // Run 7 re-check (lead decision 4): the card names its experiments too.
    expect(before.items.find((item) => item.seedId === fixture.seedId)?.linkedExperiments).toEqual([
      { seedId: dosingTrial, words: "Trial three cut peak TAN from 2.3 to 1.2 mg/L.", picked: true },
    ]);
    await expect(tryApprove(fixture)).rejects.toThrow(
      /Each picked advancement must link an uncertainty you picked and picked experiments that tested it/,
    );
    await expect(tryApprove(fixture)).rejects.toThrow(/UNLINKED_ADVANCEMENT/);

    await fixture.t.run((ctx) => ctx.db.patch(fixture.seedId, { uncertaintySeedId: dosing }));
    expect((await subsection(fixture)).linkNotice).toBeUndefined();
    await approveExact(fixture);
    await expect(fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId))).resolves.toMatchObject({
      state: "approved",
    });
  });

  test("shows the words of every linked experiment, an unticked one and one no selection row holds, marked no longer picked (PR #22 review G12)", async () => {
    const fixture = await approvalFixture({
      roleId: "specific_advancements",
      bullet: "Nitrite oxidizers, not ammonia oxidizers, set the cold start-up pace.",
    });
    const nitrite = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether nitrite oxidizing bacteria were the cold-sensitive bottleneck was unknown.",
      selected: true,
    });
    const picked = await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "Trial 1 ran three loops at 8 C: 66, 47 and 31 days to full nitrification.",
      selected: true,
      uncertaintySeedId: nitrite,
    });
    const unticked = await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "Trial 2 seeded nitrite oxidizers and cut start-up to 24 days.",
      selected: false,
      uncertaintySeedId: nitrite,
    });
    const neverTicked = await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "Trial 3 held the loop at 12 C for a week before cooling.",
      selected: "never",
      uncertaintySeedId: nitrite,
    });
    // An id that names no experiment is still not shown.
    const notAnExperiment = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether the sensors drift at 8 C was unknown.",
      selected: "never",
    });
    await fixture.t.run((ctx) =>
      ctx.db.patch(fixture.seedId, {
        uncertaintySeedId: nitrite,
        experimentSeedIds: [picked, unticked, neverTicked, notAnExperiment],
      }),
    );
    await skipLaterSteps(fixture, ["project_status", "goal_improvements"]);

    const view = await subsection(fixture);
    expect(view.items.find((item) => item.seedId === fixture.seedId)?.linkedExperiments).toEqual([
      { seedId: picked, words: "Trial 1 ran three loops at 8 C: 66, 47 and 31 days to full nitrification.", picked: true },
      { seedId: unticked, words: "Trial 2 seeded nitrite oxidizers and cut start-up to 24 days.", picked: false },
      { seedId: neverTicked, words: "Trial 3 held the loop at 12 C for a week before cooling.", picked: false },
      { seedId: notAnExperiment, words: "", picked: false },
    ]);
    // The extra reads stay inside the decisions' budget.
    expect(view.truncated).toBe(false);
  });

  test("says no advancement can be linked when every picked experiment tested a dropped uncertainty", async () => {
    const fixture = await approvalFixture({ roleId: "specific_advancements" });
    const startUp = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether acclimation could shorten start-up below 10 C was unknown.",
      selected: false,
    });
    await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether fouled sensors stay accurate enough for control was unknown.",
      selected: true,
    });
    await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "Trial one reached full nitrification in 31 days at 8 C.",
      selected: true,
      uncertaintySeedId: startUp,
    });
    const view = await subsection(fixture);
    expect(view.linkNotice).toEqual({ kind: "no_linkable_experiment", experimentsPicked: true });
    await expect(tryApprove(fixture)).rejects.toThrow(/UNLINKED_ADVANCEMENT/);
  });

  test("refuses experiments that tested an uncertainty the writer dropped, names it, and approves once they go (2026-09-29, first)", async () => {
    const fixture = await approvalFixture({
      roleId: "experimentation",
      bullet: "Trial one reached full nitrification in 31 days at 8 C.",
    });
    const startUp = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether acclimation could shorten start-up below 10 C was unknown.",
      selected: false,
    });
    const dosing = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether feed-forward dosing could hold TAN under 1 mg/L was unresolved.",
      selected: true,
    });
    await fixture.t.run((ctx) => ctx.db.patch(fixture.seedId, { uncertaintySeedId: startUp }));
    await skipLaterSteps(fixture, [
      "overall_advancement",
      "specific_advancements",
      "project_status",
      "goal_improvements",
    ]);

    const view = await subsection(fixture);
    expect(view.linkNotice).toEqual({
      kind: "experiments_for_dropped_uncertainty",
      seedIds: [fixture.seedId],
      uncertainties: ["Whether acclimation could shorten start-up below 10 C was unknown."],
    });
    expect(view.items.find((item) => item.seedId === fixture.seedId)?.linkedUncertainty).toMatchObject({
      seedId: startUp,
      picked: false,
    });
    await expect(tryApprove(fixture)).rejects.toThrow(
      /Some picked experiments tested an uncertainty you no longer have picked/,
    );
    await expect(tryApprove(fixture)).rejects.toThrow(/EXPERIMENT_FOR_DROPPED_UNCERTAINTY/);

    // The writer picks an experiment for the kept uncertainty and unticks the other.
    const dosingTrial = await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "Trial three cut peak TAN from 2.3 to 1.2 mg/L.",
      selected: true,
      uncertaintySeedId: dosing,
    });
    await fixture.t.run(async (ctx) => {
      const row = await ctx.db
        .query("seedSelections")
        .withIndex("by_seedId", (q) => q.eq("seedId", fixture.seedId))
        .unique();
      await ctx.db.patch(row!._id, { selected: false });
    });
    const fixed = await subsection(fixture);
    expect(fixed.linkNotice).toBeUndefined();
    expect(fixed.items.find((item) => item.seedId === dosingTrial)).toMatchObject({
      selected: true,
      linkedUncertainty: { seedId: dosing, picked: true },
    });
    await approveExact(fixture);
    await expect(fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId))).resolves.toMatchObject({
      state: "approved",
    });
  });

  test("approves experiments whose uncertainty the writer revised through Feedback, and shows the revision (review P2-2)", async () => {
    const fixture = await approvalFixture({
      roleId: "experimentation",
      bullet: "Trial one reached full nitrification in 31 days at 8 C.",
    });
    const startUp = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether acclimation could shorten start-up below 10 C was unknown.",
      selected: false,
    });
    const revised = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether acclimated seed reaches full nitrification within five weeks at 8 C was unknown.",
      selected: true,
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(revised, { revisionOfSeedId: startUp });
      await ctx.db.patch(fixture.seedId, { uncertaintySeedId: startUp });
    });
    await skipLaterSteps(fixture, [
      "overall_advancement",
      "specific_advancements",
      "project_status",
      "goal_improvements",
    ]);
    const view = await subsection(fixture);
    expect(view.linkNotice).toBeUndefined();
    expect(view.items.find((item) => item.seedId === fixture.seedId)?.linkedUncertainty).toEqual({
      seedId: revised,
      bullets: ["Whether acclimated seed reaches full nitrification within five weeks at 8 C was unknown."],
      picked: true,
    });
    await approveExact(fixture);
    await expect(fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId))).resolves.toMatchObject({
      state: "approved",
    });
  });

  test("approves an advancement that names the original of a revised uncertainty its experiment tested (review P2-2)", async () => {
    const fixture = await approvalFixture({ roleId: "specific_advancements" });
    const startUp = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether acclimation could shorten start-up below 10 C was unknown.",
      selected: false,
    });
    const revised = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether acclimated seed reaches full nitrification within five weeks at 8 C was unknown.",
      selected: true,
    });
    const trial = await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "Trial one reached full nitrification in 31 days at 8 C.",
      selected: true,
      uncertaintySeedId: revised,
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(revised, { revisionOfSeedId: startUp });
      await ctx.db.patch(fixture.seedId, { uncertaintySeedId: startUp, experimentSeedIds: [trial] });
    });
    await skipLaterSteps(fixture, ["project_status", "goal_improvements"]);
    expect((await subsection(fixture)).linkNotice).toBeUndefined();
    await approveExact(fixture);
    await expect(fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId))).resolves.toMatchObject({
      state: "approved",
    });
  });

  // 2026-09-30 (fourth amendment), release suite run 11 (Marrowgate,
  // fictional): the acclimation result survived in Advancement to science
  // and goal improvements after its uncertainty was dropped.
  async function resultSeed(
    fixture: Fixture,
    args: {
      roleId: "overall_advancement" | "goal_improvements" | "hypothesis" | "workplan";
      bullet: string;
      selected: boolean;
      answered?: Id<"seeds">[];
    },
  ) {
    const batchId = await seedBatch(fixture, { roleId: args.roleId, key: `${args.roleId}-${args.bullet.slice(0, 12)}` });
    return await fixture.t.run(async (ctx) => {
      const seedId = await ctx.db.insert("seeds", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        batchId,
        roleId: args.roleId,
        order: 0,
        bullets: [args.bullet],
        tags: ["technical"],
        support: "source_supported",
        originalSupport: "source_supported",
        ...(args.answered ? { answeredUncertaintySeedIds: args.answered } : {}),
      });
      await ctx.db.insert("seedSelections", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        seedId,
        roleId: args.roleId,
        selected: args.selected,
        selectedAt: NOW,
        version: 1,
      });
      return seedId;
    });
  }

  async function untick(fixture: Fixture, seedId: Id<"seeds">) {
    await fixture.t.run(async (ctx) => {
      const row = await ctx.db
        .query("seedSelections")
        .withIndex("by_seedId", (q) => q.eq("seedId", seedId))
        .unique();
      await ctx.db.patch(row!._id, { selected: false });
    });
  }

  const ACCLIMATION = "It was uncertain whether stepwise acclimation would actually work rather than just delay cold shock.";
  const NITRITE = "Nitrite oxidizing bacteria were suspected but not confirmed as the rate-limiting bottleneck under cold shock.";

  test("refuses an Advancement to science idea that answers an uncertainty the writer dropped, says so first, shows what it answers, and approves once it goes (2026-09-30, fourth)", async () => {
    const fixture = await approvalFixture({
      roleId: "overall_advancement",
      bullet: "Stepwise acclimation of seed media cut cold-water start-up roughly in half versus unacclimated seed.",
    });
    const acclimation = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: ACCLIMATION, selected: false });
    const nitrite = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: NITRITE, selected: true });
    await fixture.t.run((ctx) => ctx.db.patch(fixture.seedId, { answeredUncertaintySeedIds: [acclimation, nitrite] }));
    await skipLaterSteps(fixture, ["specific_advancements", "project_status", "goal_improvements"]);

    const before = await subsection(fixture);
    expect(before.linkNotice).toEqual({
      kind: "results_for_dropped_uncertainty",
      seedIds: [fixture.seedId],
      uncertainties: [ACCLIMATION],
    });
    const card = before.items.find((item) => item.seedId === fixture.seedId);
    expect(card?.answeredUncertaintySeedIds).toEqual([acclimation, nitrite]);
    expect(card?.answeredUncertainties).toEqual([
      { seedId: acclimation, bullets: [ACCLIMATION], picked: false },
      { seedId: nitrite, bullets: [NITRITE], picked: true },
    ]);
    // Experiment and advancement lines are not shown on a result card.
    expect(card).not.toHaveProperty("linkedUncertainty");
    await expect(tryApprove(fixture)).rejects.toThrow(
      /A picked idea answers an uncertainty you no longer have picked\. Untick it, pick that uncertainty again, or regenerate this step\./,
    );
    await expect(tryApprove(fixture)).rejects.toThrow(/RESULT_FOR_DROPPED_UNCERTAINTY/);

    // The writer picks an idea that answers the kept uncertainty and unticks the other.
    const kept = await resultSeed(fixture, {
      roleId: "overall_advancement",
      bullet: "Nitrite oxidizers were confirmed as the bottleneck of cold-water start-up.",
      selected: true,
      answered: [nitrite],
    });
    await untick(fixture, fixture.seedId);
    const fixed = await subsection(fixture);
    expect(fixed.linkNotice).toBeUndefined();
    expect(fixed.items.find((item) => item.seedId === kept)?.answeredUncertainties).toEqual([
      { seedId: nitrite, bullets: [NITRITE], picked: true },
    ]);
    await approveExact(fixture);
    await expect(fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId))).resolves.toMatchObject({ state: "approved" });
  });

  // Review P2-1 and its re-check: the link is the model's call, so the words
  // are read too, and approval asks the writer to acknowledge them.
  test("asks the writer to acknowledge an idea whose words state a dropped uncertainty's result, records it on the selection, and never lets a refused pick vouch (2026-09-30, fourth, review re-check)", async () => {
    const fixture = await approvalFixture({
      roleId: "overall_advancement",
      bullet: "Acclimated seed met the 5-week start-up objective, reaching about 31 days.",
    });
    const acclimation = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: ACCLIMATION, selected: false });
    const nitrite = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: NITRITE, selected: true });
    // Run 11's Subsection 11 pick, still ticked and still linked to the
    // dropped uncertainty: it is refused, so it cannot vouch for 31 days.
    await linkSeed(fixture, {
      roleId: "specific_advancements",
      bullet: "Acclimated seed reached full nitrification in 31 days at 8 C, against 47 days unacclimated.",
      selected: true,
      uncertaintySeedId: acclimation,
    });
    // A Seed nobody ticked gives no outcome.
    await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "The 15 percent seed fraction reached full nitrification in 29 days.",
      selected: "never",
      uncertaintySeedId: acclimation,
    });
    await fixture.t.run((ctx) => ctx.db.patch(fixture.seedId, { answeredUncertaintySeedIds: [nitrite] }));
    await skipLaterSteps(fixture, ["project_status", "goal_improvements"]);

    // No deselect event: the writer never ticked the uncertainty, so nothing was dropped.
    expect((await subsection(fixture)).approvalChallenge?.droppedResults).toEqual([]);
    await fixture.t.run(async (ctx) => {
      const seed = await ctx.db.get(acclimation);
      await ctx.db.insert("seedDecisionEvents", {
        projectId: fixture.projectId,
        generationId: fixture.generationId,
        roleId: "active_uncertainties",
        kind: "deselect",
        at: 10,
        actorUserId: fixture.userId,
        seedId: acclimation,
        batchId: seed!.batchId,
      });
    });

    const view = await subsection(fixture);
    expect(view.approvalChallenge?.droppedResults).toEqual([
      { seedId: fixture.seedId, figures: ["31 days"], uncertaintySeedIds: [acclimation], uncertainties: [ACCLIMATION] },
    ]);
    expect(view.approvalChallenge?.droppedResultSeedIds).toEqual([fixture.seedId]);
    // Not a refusal: no link notice and no readiness blocker for this step.
    expect(view.linkNotice).toBeUndefined();
    const readiness = await fixture.t.run((ctx) => readSeedReadiness(ctx, fixture.generationId));
    expect(readiness.blockers.filter((blocker) => blocker.roleId === "overall_advancement").map((blocker) => blocker.code)).not.toContain(
      "RESULT_FOR_DROPPED_UNCERTAINTY",
    );
    // Approval without the acknowledgement is refused; with it, it goes through.
    await expect(tryApprove(fixture)).rejects.toThrow(/Approval challenge or acknowledgments changed/);
    const challenge = view.approvalChallenge!;
    await fixture.writer.mutation(approveRef, {
      generationId: fixture.generationId,
      roleId: fixture.roleId,
      expectedSeedStageVersion: view.seedStageVersion,
      approvalChallenge: challenge.approvalChallenge,
      acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
      acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
      acknowledgedDroppedResultSeedIds: challenge.droppedResultSeedIds,
    });
    const after = await fixture.t.run(async (ctx) => ({
      row: await ctx.db.get(fixture.subsectionId),
      selection: await ctx.db.query("seedSelections").withIndex("by_seedId", (q) => q.eq("seedId", fixture.seedId)).unique(),
    }));
    expect(after.row).toMatchObject({ state: "approved" });
    expect(after.selection?.droppedResultAcknowledgement).toMatchObject({
      acknowledgedBy: fixture.userId,
      figures: ["31 days"],
      uncertaintySeedIds: [acclimation],
    });
    // The acknowledgement changes no revision: the step is not stale.
    expect(after.row?.approvedSelectionRevision).toBe(after.row?.selectionRevision);

    // Final check (P3-2): once an earlier step states 31 days, a re-approval
    // asks nothing and the old acknowledgement is cleared.
    await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "The acclimated control loop also took 31 days.",
      selected: true,
      uncertaintySeedId: nitrite,
    });
    const again = await subsection(fixture);
    expect(again.approvalChallenge?.droppedResults).toEqual([]);
    await approveExact(fixture);
    const cleared = await fixture.t.run((ctx) =>
      ctx.db.query("seedSelections").withIndex("by_seedId", (q) => q.eq("seedId", fixture.seedId)).unique(),
    );
    expect(cleared).not.toHaveProperty("droppedResultAcknowledgement");
  });

  // Final check (P2): a later step cannot vouch, since a change there never
  // marks the earlier step for review.
  test("lets only earlier steps vouch: a kept step 11 advancement never clears step 10, and steps before 13 clear step 13 (2026-09-30, fourth, final check)", async () => {
    const fixture = await approvalFixture({
      roleId: "overall_advancement",
      bullet: "Stepwise acclimation cut cold-water start-up from 47 days.",
    });
    const acclimation = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: ACCLIMATION, selected: false });
    const nitrite = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: NITRITE, selected: true });
    const dropped = await linkSeed(fixture, {
      roleId: "specific_advancements",
      bullet: "Acclimated seed reached full nitrification in 31 days at 8 C, against 47 days unacclimated.",
      selected: false,
      uncertaintySeedId: acclimation,
    });
    const trial = await linkSeed(fixture, {
      roleId: "experimentation",
      bullet: "The nitrite stall lasted 19 days in unacclimated seed but only 6 days in acclimated seed.",
      selected: true,
      uncertaintySeedId: nitrite,
    });
    // A kept, linked step 11 advancement that also states 47 days.
    const later = await linkSeed(fixture, {
      roleId: "specific_advancements",
      bullet: "Unacclimated seed stalled on nitrite before reaching nitrification at 47 days.",
      selected: true,
      uncertaintySeedId: nitrite,
    });
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(later, { experimentSeedIds: [trial] });
      await ctx.db.patch(fixture.seedId, { answeredUncertaintySeedIds: [nitrite] });
      for (const [roleId, seedId] of [["active_uncertainties", acclimation], ["specific_advancements", dropped]] as const) {
        const seed = await ctx.db.get(seedId);
        await ctx.db.insert("seedDecisionEvents", {
          projectId: fixture.projectId, generationId: fixture.generationId, roleId, kind: "deselect", at: 10,
          actorUserId: fixture.userId, seedId, batchId: seed!.batchId,
        });
      }
    });
    await skipLaterSteps(fixture, ["project_status"]);
    const asked = async (roleId: "overall_advancement" | "goal_improvements") =>
      ((await subsection(fixture, roleId)).approvalChallenge?.droppedResults ?? []).map((result) => [result.seedId, result.figures]);

    // Step 11 comes after step 10, so its advancement does not vouch for 47 days.
    expect(await asked("overall_advancement")).toEqual([[fixture.seedId, ["47 days"]]]);
    // Unticking it later changes nothing for step 10: the acknowledgement was asked for anyway.
    await untick(fixture, later);
    expect(await asked("overall_advancement")).toEqual([[fixture.seedId, ["47 days"]]]);

    // Step 13: steps 1 to 12 vouch, step 10 never does.
    const goal = await resultSeed(fixture, {
      roleId: "goal_improvements",
      bullet: "The start-up gap from 47 days closed.",
      selected: true,
      answered: [nitrite],
    });
    expect(await asked("goal_improvements")).toEqual([[goal, ["47 days"]]]);
    await fixture.t.run(async (ctx) => {
      const row = await ctx.db.query("seedSelections").withIndex("by_seedId", (q) => q.eq("seedId", later)).unique();
      await ctx.db.patch(row!._id, { selected: true });
    });
    expect(await asked("goal_improvements")).toEqual([]);
  });

  test("raises nothing for a figure a kept pick of another step states, or for a result that states none (2026-09-30, fourth, review re-check)", async () => {
    const fixture = await approvalFixture({
      roleId: "goal_improvements",
      bullet: "Unacclimated seed took 47 days, the baseline the method improved on.",
    });
    const acclimation = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: ACCLIMATION, selected: false });
    await linkSeed(fixture, { roleId: "active_uncertainties", bullet: NITRITE, selected: true });
    await linkSeed(fixture, {
      roleId: "specific_advancements",
      bullet: "Acclimated seed reached full nitrification in 31 days at 8 C, against 47 days unacclimated.",
      selected: false,
      uncertaintySeedId: acclimation,
    });
    await fixture.t.run(async (ctx) => {
      for (const [roleId, seedId] of [["active_uncertainties", acclimation]] as const) {
        const seed = await ctx.db.get(seedId);
        await ctx.db.insert("seedDecisionEvents", {
          projectId: fixture.projectId, generationId: fixture.generationId, roleId, kind: "deselect", at: 10,
          actorUserId: fixture.userId, seedId, batchId: seed!.batchId,
        });
      }
    });
    // The unticked Subsection 11 advancement was never ticked (no deselect
    // event for it), so it is no outcome: nothing is raised.
    expect((await subsection(fixture)).approvalChallenge?.droppedResults).toEqual([]);
    // Once it was ticked at some point, its 47 days is a dropped result...
    await fixture.t.run(async (ctx) => {
      const advancement = (await ctx.db.query("seeds").withIndex("by_generationId_and_roleId", (q) => q.eq("generationId", fixture.generationId).eq("roleId", "specific_advancements")).take(5))[0]!;
      await ctx.db.insert("seedDecisionEvents", {
        projectId: fixture.projectId, generationId: fixture.generationId, roleId: "specific_advancements", kind: "deselect", at: 11,
        actorUserId: fixture.userId, seedId: advancement._id, batchId: advancement.batchId,
      });
    });
    expect((await subsection(fixture)).approvalChallenge?.droppedResults.map((result) => result.figures)).toEqual([["47 days"]]);
    // ...unless a kept pick of another step states it: a baseline the kept work gives.
    await linkSeed(fixture, { roleId: "experimentation", bullet: "The unacclimated loop took 47 days to nitrify.", selected: true });
    expect((await subsection(fixture)).approvalChallenge?.droppedResults).toEqual([]);
    await approveExact(fixture);
  });

  test("never refuses a goal improvement that restates the goal, one written before the rule, or one that names the original of a revised uncertainty (2026-09-30, fourth)", async () => {
    const fixture = await approvalFixture({
      roleId: "goal_improvements",
      bullet: "Stepwise acclimation of seed media closed that gap, reaching full nitrification in about 31 days at 8 C.",
    });
    const acclimation = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: ACCLIMATION, selected: false });
    const revised = await linkSeed(fixture, {
      roleId: "active_uncertainties",
      bullet: "Whether acclimated seed reaches full nitrification within five weeks at 8 C was unknown.",
      selected: true,
    });
    const nitrite = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: NITRITE, selected: true });
    await fixture.t.run((ctx) => ctx.db.patch(fixture.seedId, { answeredUncertaintySeedIds: [acclimation] }));

    // Answers the dropped uncertainty: refused, and the notice names it.
    expect((await subsection(fixture)).linkNotice).toMatchObject({ kind: "results_for_dropped_uncertainty", uncertainties: [ACCLIMATION] });
    await expect(tryApprove(fixture)).rejects.toThrow(/RESULT_FOR_DROPPED_UNCERTAINTY/);

    // A goal restatement that answers none, and a Seed from before the rule.
    await untick(fixture, fixture.seedId);
    await resultSeed(fixture, {
      roleId: "goal_improvements",
      bullet: "The original goal was start-up under 5 weeks at 8 C instead of 9 to 10 weeks.",
      selected: true,
      answered: [],
    });
    await resultSeed(fixture, {
      roleId: "goal_improvements",
      bullet: "The start-up protocol now rests on the confirmed nitrite bottleneck.",
      selected: true,
    });
    expect((await subsection(fixture)).linkNotice).toBeUndefined();

    // Review P2-2 for results: an idea naming the original of a revised
    // uncertainty answers the picked revision, and is shown with its words.
    await fixture.t.run((ctx) => ctx.db.patch(revised, { revisionOfSeedId: acclimation }));
    const viaOriginal = await resultSeed(fixture, {
      roleId: "goal_improvements",
      bullet: "Acclimated seed met the five-week start-up target at 8 C.",
      selected: true,
      answered: [acclimation, nitrite],
    });
    const view = await subsection(fixture);
    expect(view.linkNotice).toBeUndefined();
    expect(view.items.find((item) => item.seedId === viaOriginal)?.answeredUncertainties).toEqual([
      { seedId: revised, bullets: ["Whether acclimated seed reaches full nitrification within five weeks at 8 C was unknown."], picked: true },
      { seedId: nitrite, bullets: [NITRITE], picked: true },
    ]);
    await approveExact(fixture);
    await expect(fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId))).resolves.toMatchObject({ state: "approved" });
  });

  // 2026-09-30 (fifth amendment), release suite run 12 (Marrowgate,
  // fictional): Hypothesis item 8 was the dosing hypothesis, carried and
  // confirmed after the writer dropped the dosing uncertainty.
  const DOSING = "It was unknown whether dosing alkalinity ahead of feeding would hold nitrification capacity through the ammonia pulse.";
  const DOSING_HYPOTHESIS = "If alkalinity is dosed ahead of each feeding in proportion to feed mass, then TAN will stay under 1 mg per litre through the pulse.";

  test("refuses a hypothesis that tests an uncertainty the writer dropped, says so first, shows what it tests, and keeps a carried one approvable (2026-09-30, fifth)", async () => {
    const fixture = await approvalFixture({ roleId: "hypothesis", bullet: DOSING_HYPOTHESIS });
    const dosing = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: DOSING, selected: false });
    const nitrite = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: NITRITE, selected: true });
    await fixture.t.run((ctx) => ctx.db.patch(fixture.seedId, { answeredUncertaintySeedIds: [dosing] }));
    await skipLaterSteps(fixture, ["experimentation", "overall_advancement", "specific_advancements", "project_status", "goal_improvements"]);

    const view = await subsection(fixture);
    expect(view.linkNotice).toEqual({ kind: "plans_for_dropped_uncertainty", seedIds: [fixture.seedId], uncertainties: [DOSING] });
    expect(view.items.find((item) => item.seedId === fixture.seedId)?.answeredUncertainties).toEqual([
      { seedId: dosing, bullets: [DOSING], picked: false },
    ]);
    // No figure acknowledgement for a plan step.
    expect(view.approvalChallenge?.droppedResults).toEqual([]);
    await expect(tryApprove(fixture)).rejects.toThrow(
      /A picked hypothesis tests an uncertainty you no longer have picked\. Untick it, pick that uncertainty again, or regenerate this step\./,
    );
    await expect(tryApprove(fixture)).rejects.toThrow(/PLAN_FOR_DROPPED_UNCERTAINTY/);
    const readiness = await fixture.t.run((ctx) => readSeedReadiness(ctx, fixture.generationId));
    expect(readiness.blockers).toContainEqual(
      expect.objectContaining({
        code: "PLAN_FOR_DROPPED_UNCERTAINTY",
        roleId: "hypothesis",
        message: "Hypothesis has a picked hypothesis that tests an uncertainty you no longer have picked",
      }),
    );

    // A hypothesis for the kept uncertainty, and a carried one that records
    // nothing (written before this amendment), are approved.
    const kept = await resultSeed(fixture, {
      roleId: "hypothesis",
      bullet: "If nitrite oxidizers are the cold bottleneck, acclimated seed shortens their stall.",
      selected: true,
      answered: [nitrite],
    });
    await resultSeed(fixture, { roleId: "hypothesis", bullet: "If acclimation works, start-up falls under 5 weeks.", selected: true });
    await untick(fixture, fixture.seedId);
    const fixed = await subsection(fixture);
    expect(fixed.linkNotice).toBeUndefined();
    expect(fixed.items.find((item) => item.seedId === kept)?.answeredUncertainties).toEqual([
      { seedId: nitrite, bullets: [NITRITE], picked: true },
    ]);
    await approveExact(fixture);
    await expect(fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId))).resolves.toMatchObject({ state: "approved" });
  });

  test("refuses a work plan that plans work for an uncertainty the writer dropped, with its own notice and blocker (2026-09-30, fifth)", async () => {
    const fixture = await approvalFixture({
      roleId: "workplan",
      bullet: "The team kept the three biofilter uncertainties separate because they fail differently.",
    });
    const dosing = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: DOSING, selected: false });
    const nitrite = await linkSeed(fixture, { roleId: "active_uncertainties", bullet: NITRITE, selected: true });
    await fixture.t.run((ctx) => ctx.db.patch(fixture.seedId, { answeredUncertaintySeedIds: [nitrite, dosing] }));
    await skipLaterSteps(fixture, ["hypothesis", "experimentation", "overall_advancement", "specific_advancements", "project_status", "goal_improvements"]);
    expect((await subsection(fixture)).linkNotice).toEqual({
      kind: "plans_for_dropped_uncertainty",
      seedIds: [fixture.seedId],
      uncertainties: [DOSING],
    });
    await expect(tryApprove(fixture)).rejects.toThrow(
      /A picked work plan plans work for an uncertainty you no longer have picked\. Untick it, pick that uncertainty again, or regenerate this step\./,
    );
    await expect(tryApprove(fixture)).rejects.toThrow(/PLAN_FOR_DROPPED_UNCERTAINTY/);
    const readiness = await fixture.t.run((ctx) => readSeedReadiness(ctx, fixture.generationId));
    expect(readiness.blockers).toContainEqual(
      expect.objectContaining({
        code: "PLAN_FOR_DROPPED_UNCERTAINTY",
        roleId: "workplan",
        message: "Work plan has a picked work plan that plans work for an uncertainty you no longer have picked",
      }),
    );
    await resultSeed(fixture, { roleId: "workplan", bullet: "Start-up trials ran first, over weeks.", selected: true, answered: [nitrite] });
    await untick(fixture, fixture.seedId);
    await approveExact(fixture);
    await expect(fixture.t.run((ctx) => ctx.db.get(fixture.subsectionId))).resolves.toMatchObject({ state: "approved" });
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

  // 2026-09-27 (third, P1-1): "Approve and continue" lands on the next step
  // at once and skips its open while a Batch is pending, so approval marks
  // a prefetch there as waited on; it never spends the quote repair.
  test("marks the prefetch on the step the writer lands on as waited on", async () => {
    const fixture = await approvalFixture({ roleId: "company_context" });
    await fixture.t.run(async (ctx) => {
      const successorId = fixture.subsectionIds.goal_problem;
      if (!successorId) throw new Error("Missing goal_problem subsection");
      const snapshot = await loadSeedDispatchSnapshot(ctx, {
        generationId: fixture.generationId,
        roleId: "goal_problem",
      });
      await ctx.db.patch(successorId, { currentContextRevision: snapshot.contextRevision });
    });
    await approveExact(fixture);
    const batches = await fixture.t.run((ctx) =>
      ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query.eq("generationId", fixture.generationId).eq("roleId", "goal_problem"),
        )
        .take(2),
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ operation: "prefetch", writerWaitingAt: expect.any(Number) });
  });

  test("leaves a prefetch on a step the writer does not land on free to repair", async () => {
    const fixture = await approvalFixture({ roleId: "company_context" });
    await fixture.t.run(async (ctx) => {
      // The next step is already in progress, so the writer lands there and
      // the prefetch goes to the first untouched step after it.
      const nextId = fixture.subsectionIds.goal_problem;
      const fartherId = fixture.subsectionIds.passive_limitations;
      if (!nextId || !fartherId) throw new Error("Missing subsections");
      await ctx.db.patch(nextId, { state: "in_progress" });
      const snapshot = await loadSeedDispatchSnapshot(ctx, {
        generationId: fixture.generationId,
        roleId: "passive_limitations",
      });
      await ctx.db.patch(fartherId, { currentContextRevision: snapshot.contextRevision });
    });
    await approveExact(fixture);
    const farther = await fixture.t.run((ctx) =>
      ctx.db
        .query("seedBatches")
        .withIndex("by_generationId_and_roleId", (query) =>
          query.eq("generationId", fixture.generationId).eq("roleId", "passive_limitations"),
        )
        .take(2),
    );
    expect(farther).toHaveLength(1);
    expect(farther[0].operation).toBe("prefetch");
    expect(farther[0].writerWaitingAt).toBeUndefined();
  });

  test("marks a running prefetch waited on when an open behind the stage version finds it", async () => {
    const fixture = await approvalFixture({ roleId: "company_context" });
    const prefetchId = await seedBatch(fixture, {
      roleId: "goal_problem",
      operation: "prefetch",
      status: "running",
      key: "behind-open-prefetch",
    });
    const version = await fixture.t.run(async (ctx) => {
      const subsectionId = fixture.subsectionIds.goal_problem;
      if (!subsectionId) throw new Error("Missing goal_problem subsection");
      await ctx.db.patch(subsectionId, {
        state: "generating",
        priorState: "untouched",
        pendingBatchId: prefetchId,
      });
      const generation = await ctx.db.get(fixture.generationId);
      await ctx.db.patch(fixture.generationId, { seedStageVersion: (generation?.seedStageVersion ?? 0) + 3 });
      return (generation?.seedStageVersion ?? 0) + 3;
    });
    const result = await fixture.writer.mutation(api.seeds.open, {
      generationId: fixture.generationId,
      roleId: "goal_problem",
      expectedSeedStageVersion: version - 1,
      commandId: "open:behind-writer",
    });
    expect(result).toMatchObject({ kind: "reused", batchId: prefetchId });
    await expect(fixture.t.run((ctx) => ctx.db.get(prefetchId))).resolves.toMatchObject({
      writerWaitingAt: expect.any(Number),
    });
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
