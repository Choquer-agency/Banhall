/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import type * as endpoints from "./seeds";
import {
  decisionFixture,
  addDecisionSeed,
  decisionMutation,
} from "./seedDecision.fixture";
import { PD_SUBSECTIONS } from "../shared/pdSubsections";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_SEED_BATCH_MS } from "./seeds";
import { WORK_ITEM_KINDS } from "../shared/workItems";
import { isSeedSubsectionStale } from "./lib/seedRevisions";
import { readSeedReadiness } from "./lib/seedReadiness";
import { createReadBudget, DOCUMENT_HEADROOM } from "./lib/readBudget";
import {
  SEED_DECISION_READ_BYTES,
  SEED_DECISION_READ_RANGES,
} from "./lib/seedDecisionState";
import { api } from "./_generated/api";
import type { completeAttempt } from "./seedRuns";
import { readCompleteFixture } from "./testFixtureRows";

const SEED_DECISION_FIXTURE_ROW_LIMIT = 100;

const select = decisionMutation<typeof endpoints.select>("seeds:select");
const deselect = decisionMutation<typeof endpoints.deselect>("seeds:deselect");
const edit = decisionMutation<typeof endpoints.edit>("seeds:edit");
const restore = decisionMutation<typeof endpoints.restoreWording>(
  "seeds:restoreWording",
);
const feedback =
  decisionMutation<typeof endpoints.giveFeedback>("seeds:giveFeedback");
const withdraw = decisionMutation<typeof endpoints.withdrawFeedback>(
  "seeds:withdrawFeedback",
);
const open = decisionMutation<typeof endpoints.open>("seeds:open");
const skip = decisionMutation<typeof endpoints.skip>("seeds:skip");
const unskip = decisionMutation<typeof endpoints.unskip>("seeds:unskip");
const view = decisionMutation<typeof endpoints.markBatchViewed>(
  "seeds:markBatchViewed",
);
const complete = decisionMutation<typeof completeAttempt>(
  "seedRuns:completeAttempt",
);
const readiness = makeFunctionReference<
  "query",
  { generationId: ReturnType<typeof args>["generationId"] },
  Awaited<ReturnType<typeof readSeedReadiness>>
>("seeds:getReadiness");
type Setup = Awaited<ReturnType<typeof decisionFixture>>;
function args(
  s: Setup,
  expectedSeedStageVersion = 0,
  roleId: (typeof PD_SUBSECTIONS)[number]["roleId"] = "company_context",
) {
  return { generationId: s.generationId, roleId, expectedSeedStageVersion };
}
async function dump(s: Setup) {
  return s.t.run(async (ctx) => ({
    generation: await ctx.db.get(s.generationId),
    selections: await readCompleteFixture({
      label: "seedSelections",
      maxRows: SEED_DECISION_FIXTURE_ROW_LIMIT,
      query: ctx.db.query("seedSelections"),
    }),
    events: await readCompleteFixture({
      label: "seedDecisionEvents",
      maxRows: SEED_DECISION_FIXTURE_ROW_LIMIT,
      query: ctx.db.query("seedDecisionEvents"),
    }),
    feedback: await readCompleteFixture({
      label: "seedFeedbackRequests",
      maxRows: SEED_DECISION_FIXTURE_ROW_LIMIT,
      query: ctx.db.query("seedFeedbackRequests"),
    }),
    batches: await readCompleteFixture({
      label: "seedBatches",
      maxRows: SEED_DECISION_FIXTURE_ROW_LIMIT,
      query: ctx.db.query("seedBatches"),
    }),
    episodes: await readCompleteFixture({
      label: "seedStaleEpisodes",
      maxRows: SEED_DECISION_FIXTURE_ROW_LIMIT,
      query: ctx.db.query("seedStaleEpisodes"),
    }),
    roles: await readCompleteFixture({
      label: "seedSubsections",
      maxRows: PD_SUBSECTIONS.length,
      query: ctx.db.query("seedSubsections"),
    }),
    scheduled: await readCompleteFixture({
      label: "_scheduled_functions",
      maxRows: SEED_DECISION_FIXTURE_ROW_LIMIT,
      query: ctx.db.system.query("_scheduled_functions"),
    }),
  }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("public seed decisions", () => {
  it("preserves no-op rows, originals, support, selection and text-free telemetry", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s);
    const baseline = await dump(s);
    await s.writer.mutation(deselect, { ...args(s), seedId: seed.seedId });
    await s.writer.mutation(restore, { ...args(s), seedId: seed.seedId });
    expect(await dump(s)).toEqual(baseline);
    await s.writer.mutation(edit, {
      ...args(s),
      seedId: seed.seedId,
      bullets: ["The writer supplies a different technical claim."],
    });
    let d = await dump(s);
    expect(d.selections[0]).toMatchObject({ selected: false, version: 1 });
    expect(d.events.map((e) => e.kind)).toEqual(["edit"]);
    expect(await s.t.run((ctx) => ctx.db.get(seed.seedId))).toMatchObject({
      bullets: ["Original frozen wording."],
      support: "writer_asserted",
      originalSupport: "source_supported",
    });
    await s.writer.mutation(restore, { ...args(s, 1), seedId: seed.seedId });
    expect(await s.t.run((ctx) => ctx.db.get(seed.seedId))).toMatchObject({
      support: "source_supported",
    });
    d = await dump(s);
    expect(d.selections[0].editedBullets).toBeUndefined();
    expect(d.selections[0].selected).toBe(false);
    expect(JSON.stringify(d.events)).not.toMatch(
      /Original frozen|different technical|bullets|instruction/,
    );
    expect(
      await s.t.run(async (ctx) =>
        Promise.all([
          ctx.db.query("reports").take(1),
          ctx.db.query("chatProposals").take(1),
          ctx.db.query("summaryVersions").take(1),
          ctx.db.query("summaryItems").take(1),
          ctx.db.query("generationBriefEntries").take(1),
        ]),
      ),
    ).toEqual([[], [], [], [], []]);
  });
  it("validates bullets and computes large-token edit telemetry without quadratic work", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s);
    for (const bullets of [
      [],
      [""],
      ["   "],
      ["One.", "Two.", "Three."],
      ["x".repeat(601)],
    ])
      await expect(
        s.writer.mutation(edit, { ...args(s), seedId: seed.seedId, bullets }),
      ).rejects.toThrow(/one or two non-empty bullets/);
    expect((await dump(s)).events).toEqual([]);
    await s.writer.mutation(edit, {
      ...args(s),
      seedId: seed.seedId,
      bullets: ["x".repeat(600), "y".repeat(600)],
    });
    expect((await dump(s)).events[0].editRatio).toBe(1);
  });
  it("never holds a writer's edit to the AI Seed's 25-word, one-sentence contract", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s);
    const long = Array(40).fill("word").join(" ") + ".";
    const twoSentences = "Baseline logging ran for six weeks. Then one zone trialled the model.";
    const noFullStop = "Defrost-aware term added in the third iteration";
    await s.writer.mutation(edit, {
      ...args(s),
      seedId: seed.seedId,
      bullets: [long, twoSentences],
    });
    await s.writer.mutation(edit, {
      ...args(s, (await dump(s)).generation?.seedStageVersion ?? 0),
      seedId: seed.seedId,
      bullets: [noFullStop],
    });
    const selection = (await dump(s)).selections.find(
      (row: { seedId: string }) => row.seedId === seed.seedId,
    );
    expect(selection?.editedBullets).toEqual([noFullStop]);
  });
  it("uses one stale episode through R0 → R1 → R0 → R2 without changing consumed inputs", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s),
      later = await addDecisionSeed(s, "goal_problem");
    await s.t.run(async (ctx) => {
      const row = await ctx.db.get(later.rowId);
      if (!row) throw Error();
      await ctx.db.patch(row._id, {
        state: "approved",
        approvedContextRevision: row.currentContextRevision,
        approvedSelectionRevision: row.selectionRevision,
      });
    });
    const batchBefore = await s.t.run((ctx) => ctx.db.get(later.batchId));
    await s.writer.mutation(select, {
      ...args(s),
      seedId: seed.seedId,
      selected: true,
    });
    let row = await s.t.run((ctx) => ctx.db.get(later.rowId));
    if (!row) throw Error();
    expect(isSeedSubsectionStale(row)).toBe(true);
    const episode = row.activeStaleEpisodeId;
    await s.writer.mutation(deselect, { ...args(s, 1), seedId: seed.seedId });
    row = await s.t.run((ctx) => ctx.db.get(later.rowId));
    if (!row) throw Error();
    expect(isSeedSubsectionStale(row)).toBe(false);
    expect(row.activeStaleEpisodeId).toBe(episode);
    await s.writer.mutation(select, {
      ...args(s, 2),
      seedId: seed.seedId,
      selected: true,
    });
    const d = await dump(s);
    expect(d.episodes).toHaveLength(1);
    expect(d.episodes[0].disposedAt).toBeUndefined();
    expect(await s.t.run((ctx) => ctx.db.get(later.batchId))).toEqual(
      batchBefore,
    );
  });
  it("fences feedback transport retry before command reuse and retains frozen wording", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s);
    const payload = {
      ...args(s),
      seedId: seed.seedId,
      instruction: "Make the limitation explicit.",
      commandId: "feedback-command",
    };
    const result = await s.writer.mutation(feedback, payload);
    const first = await dump(s);
    await expect(s.writer.mutation(feedback, payload)).rejects.toThrow(
      /STALE_REVISION/,
    );
    expect(await dump(s)).toEqual(first);
    expect(
      await s.writer.mutation(feedback, {
        ...payload,
        expectedSeedStageVersion: 1,
      }),
    ).toEqual(result);
    expect(await dump(s)).toEqual(first);
    await expect(
      s.writer.mutation(feedback, {
        ...payload,
        expectedSeedStageVersion: 1,
        instruction: "Different.",
      }),
    ).rejects.toThrow(/INVALID_INPUT/);
    expect(await dump(s)).toEqual(first);
    await s.writer.mutation(edit, {
      ...args(s, 1),
      seedId: seed.seedId,
      bullets: ["The writer changed the live target."],
    });
    expect(
      await s.writer.mutation(feedback, {
        ...payload,
        expectedSeedStageVersion: 2,
      }),
    ).toMatchObject({
      feedbackRequestId: result.feedbackRequestId,
      batchId: result.batchId,
      seedStageVersion: 2,
    });
    expect((await dump(s)).feedback[0].targetWording).toEqual([
      "Original frozen wording.",
    ]);
  });
  it("suspends only active feedback, bypasses episodes, and fences a late completion after skip", async () => {
    const s = await decisionFixture(),
      roleId = "prior_year_status",
      seed = await addDecisionSeed(s, roleId);
    const f = await s.writer.mutation(feedback, {
      ...args(s, 0, roleId),
      seedId: seed.seedId,
      instruction: "Clarify the prior year.",
      commandId: "pending-feedback",
    });
    const pending = await s.t.run((ctx) => ctx.db.get(f.batchId));
    if (!pending) throw Error();
    const withdrawnId = await s.t.run(async (ctx) => {
      const episode = await ctx.db.insert("seedStaleEpisodes", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId,
        openedAt: 1,
        reasons: ["company_context"],
      });
      await ctx.db.patch(seed.rowId, { activeStaleEpisodeId: episode });
      return ctx.db.insert("seedFeedbackRequests", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId,
        targetSeedId: seed.seedId,
        targetWording: ["Original frozen wording."],
        instruction: "Old withdrawn request.",
        status: "withdrawn",
        withdrawnAt: 1,
      });
    });
    await s.writer.mutation(skip, args(s, 1, roleId));
    expect(
      await s.t.run((ctx) => ctx.db.get(f.feedbackRequestId)),
    ).toMatchObject({ status: "suspendedBySkip" });
    expect((await dump(s)).episodes[0]).toMatchObject({
      disposition: "bypassed",
    });
    await s.t.mutation(complete, {
      batchId: f.batchId,
      attemptId: pending.attemptId,
      requestsMade: 1,
      seeds: [
        {
          bullets: ["A late proposed revision."],
          tags: ["technical"],
          provenance: [],
        },
      ],
      seedsDropped: 0,
    });
    expect(await s.t.run((ctx) => ctx.db.get(seed.rowId))).toMatchObject({
      state: "skipped",
      shownBatchId: seed.batchId,
    });
    const version = (await dump(s)).generation?.seedStageVersion ?? 0;
    await s.writer.mutation(unskip, args(s, version, roleId));
    expect(
      await s.t.run((ctx) => ctx.db.get(f.feedbackRequestId)),
    ).toMatchObject({ status: "active" });
    expect(await s.t.run((ctx) => ctx.db.get(withdrawnId))).toMatchObject({
      status: "withdrawn",
    });
    expect(await s.t.run((ctx) => ctx.db.get(seed.rowId))).toMatchObject({
      state: "in_progress",
    });
    await s.writer.mutation(withdraw, {
      ...args(s, version + 1, roleId),
      feedbackRequestId: f.feedbackRequestId,
    });
    expect((await dump(s)).selections).toHaveLength(0);
  });
  it("deduplicates first-view events per server user and fences stale view retries", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s);
    await s.writer.mutation(view, { ...args(s), batchId: seed.batchId });
    const d = await dump(s);
    await expect(
      s.writer.mutation(view, { ...args(s), batchId: seed.batchId }),
    ).rejects.toThrow(/STALE_REVISION/);
    await s.writer.mutation(view, { ...args(s, 1), batchId: seed.batchId });
    expect(await dump(s)).toEqual(d);
    expect(d.events).toHaveLength(1);
    expect(d.events[0]).toMatchObject({
      kind: "batchViewed",
      actorUserId: s.userId,
    });
  });
  it("query and mutation-context readiness agree and decisions remove readiness without lifecycle writes", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s);
    await s.t.run(async (ctx) => {
      const rows = await readCompleteFixture({
        label: "seedSubsections",
        maxRows: PD_SUBSECTIONS.length,
        query: ctx.db.query("seedSubsections"),
      });
      for (const row of rows)
        await ctx.db.patch(row._id, {
          state: row.kind === "optional" ? "skipped" : "approved",
          approvedContextRevision: row.currentContextRevision,
          approvedSelectionRevision: row.selectionRevision,
        });
    });
    const query = await s.writer.query(readiness, {
      generationId: s.generationId,
    });
    const local = await s.t.run((ctx) =>
      readSeedReadiness(ctx, s.generationId, {
        budget: createReadBudget({
          maxBytes: SEED_DECISION_READ_BYTES,
          maxRanges: SEED_DECISION_READ_RANGES,
          reservedBytes: 3 * DOCUMENT_HEADROOM,
        }),
      }),
    );
    expect(query).toEqual(local);
    expect(query.ready).toBe(true);
    await s.writer.mutation(select, {
      ...args(s),
      seedId: seed.seedId,
      selected: true,
    });
    expect(
      await s.writer.query(readiness, { generationId: s.generationId }),
    ).toMatchObject({ ready: false });
    const d = await dump(s);
    expect(d.generation?.status).toBe("awaiting_input");
    expect(d.generation?.summaryVersionId).toBeUndefined();
  });
  it("cancellation bypasses open episodes", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s);
    await s.t.run(async (ctx) => {
      const episode = await ctx.db.insert("seedStaleEpisodes", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId: "company_context",
        openedAt: 1,
        reasons: ["company_context"],
      });
      await ctx.db.patch(seed.rowId, { activeStaleEpisodeId: episode });
    });
    await s.writer.mutation(api.generations.cancelIterativeGeneration, {
      generationId: s.generationId,
    });
    const d = await dump(s);
    expect(d.episodes[0].disposition).toBe("bypassed");
    expect(
      d.roles.find((r) => r._id === seed.rowId)?.activeStaleEpisodeId,
    ).toBeUndefined();
  });
});

describe("every seed mutation uses the same authorization and stage fences", () => {
  const actors = [
    "owner",
    "assigned",
    "manager",
    "admin",
    "closed",
    "unrelated",
    "creator-only",
    "anonymous",
    "roleless",
    "unauthenticated",
  ];
  for (const actor of actors)
    it(`${actor}: authorization precedes expected-version validation on all public writers`, async () => {
      const s = await decisionFixture(),
        seed = await addDecisionSeed(s);
      const feedbackRequestId = await s.t.run((ctx) =>
        ctx.db.insert("seedFeedbackRequests", {
          projectId: s.projectId,
          generationId: s.generationId,
          roleId: "company_context",
          targetSeedId: seed.seedId,
          targetWording: ["Original frozen wording."],
          instruction: "Instruction.",
          status: "active",
        }),
      );
      const actorId = await s.t.run(async (ctx) => {
        if (actor === "owner") return s.userId;
        const role =
          actor === "roleless"
            ? undefined
            : actor === "manager"
              ? "manager"
              : actor === "admin"
                ? "admin"
                : "writer";
        const userId = await ctx.db.insert("users", {
          authId: actor,
          role,
          isAnonymous: actor === "anonymous",
        });
        if (actor === "creator-only")
          await ctx.db.patch(s.projectId, { createdBy: userId });
        if (actor === "assigned" || actor === "closed")
          await ctx.db.insert("workItems", {
            projectId: s.projectId,
            kind: WORK_ITEM_KINDS[0],
            assigneeId: userId,
            assignerId: s.userId,
            instructions: "Review",
            blocking: false,
            status: actor === "assigned" ? "open" : "completed",
            version: 0,
            createRequestId: actor,
            createRequestFingerprint: actor,
            createdAt: 1,
            updatedAt: 1,
          });
        return userId;
      });
      expect(actorId).toBeTruthy();
      const client =
        actor === "owner"
          ? s.writer
          : actor === "unauthenticated"
            ? s.t
            : s.t.withIdentity({ subject: actor });
      const allowed = ["owner", "assigned", "manager", "admin"].includes(actor);
      const calls = mutationCases(seed, feedbackRequestId);
      const before = await dump(s);
      for (const call of calls) {
        const ref = makeFunctionReference<
          "mutation",
          Record<string, import("convex/values").Value>
        >(`seeds:${call.name}`);
        await expect(
          client.mutation(ref, { ...args(s, -1), ...call.extra }),
          call.name,
        ).rejects.toThrow(allowed ? /STALE_REVISION/ : /NOT_AUTH/);
      }
      expect(await dump(s)).toEqual(before);
    });
  for (const stage of [
    "legacy",
    "cancelled",
    "completed",
    "inactive",
    "deleting",
    "signed-off",
  ])
    it(`all writers reject ${stage} before checking the revision`, async () => {
      const s = await decisionFixture(),
        seed = await addDecisionSeed(s);
      const feedbackRequestId = await s.t.run(async (ctx) => {
        if (stage === "legacy")
          await ctx.db.patch(s.generationId, { gatedWorkflow: "sections" });
        if (stage === "cancelled")
          await ctx.db.patch(s.generationId, {
            status: "failed",
            currentStep: "Cancelled",
            error: "Cancelled by writer",
          });
        if (stage === "completed")
          await ctx.db.patch(s.generationId, { status: "completed" });
        if (stage === "inactive")
          await ctx.db.patch(s.projectId, { activeGenerationId: undefined });
        if (stage === "deleting")
          await ctx.db.patch(s.projectId, { deletionStartedAt: 1 });
        if (stage === "signed-off") {
          const id = await ctx.db.insert("summaryVersions", {
            projectId: s.projectId,
            generationId: s.generationId,
            version: 1,
            originGenerationId: s.generationId,
            briefVersionId: s.briefId,
            settingsHash: "settings",
            skippedRoleIds: [],
            readiness: true,
            signedOffBy: s.userId,
            signedOffAt: 1,
          });
          await ctx.db.patch(s.generationId, { summaryVersionId: id });
        }
        return ctx.db.insert("seedFeedbackRequests", {
          projectId: s.projectId,
          generationId: s.generationId,
          roleId: "company_context",
          targetSeedId: seed.seedId,
          targetWording: ["Original frozen wording."],
          instruction: "Instruction.",
          status: "active",
        });
      });
      const before = await dump(s);
      for (const call of mutationCases(seed, feedbackRequestId)) {
        const ref = makeFunctionReference<
          "mutation",
          Record<string, import("convex/values").Value>
        >(`seeds:${call.name}`);
        await expect(
          s.writer.mutation(ref, { ...args(s, -1), ...call.extra }),
          call.name,
        ).rejects.toThrow(
          stage === "deleting"
            ? /NOT_FOUND|PROJECT_DELETING|INVALID_STATE/
            : /INVALID_STATE/,
        );
      }
      expect(await dump(s)).toEqual(before);
    });
  it("rejects foreign role, generation and project seed/batch/request references without writes", async () => {
    const s = await decisionFixture(),
      local = await addDecisionSeed(s),
      otherRole = await addDecisionSeed(s, "goal_problem");
    const foreignGeneration = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("generations", {
        projectId: s.projectId,
        status: "awaiting_input",
        gatedWorkflow: "seeds",
        startedAt: 1,
      });
      const original = await ctx.db.get(local.seedId);
      if (!original) throw Error();
      return ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: id,
        batchId: local.batchId,
        roleId: "company_context",
        order: 0,
        bullets: original.bullets,
        tags: [],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
    });
    const foreignProject = await s.t.run(async (ctx) => {
      const p = await ctx.db.insert("projects", {
        title: "Foreign",
        clientName: "Client",
        ownerId: s.userId,
        createdBy: s.userId,
        shareToken: "foreign",
        status: "draft",
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("seeds", {
        projectId: p,
        generationId: s.generationId,
        batchId: local.batchId,
        roleId: "company_context",
        order: 0,
        bullets: ["Secret."],
        tags: [],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
    });
    const before = await dump(s);
    for (const seedId of [
      otherRole.seedId,
      foreignGeneration,
      foreignProject,
    ]) {
      await expect(
        s.writer.mutation(select, { ...args(s), seedId, selected: true }),
      ).rejects.toThrow(/INVALID_INPUT/);
      await expect(
        s.writer.mutation(edit, { ...args(s), seedId, bullets: ["Edit."] }),
      ).rejects.toThrow(/INVALID_INPUT/);
      await expect(
        s.writer.mutation(feedback, {
          ...args(s),
          seedId,
          instruction: "Feedback.",
          commandId: "x",
        }),
      ).rejects.toThrow(/INVALID_INPUT/);
    }
    await expect(
      s.writer.mutation(view, { ...args(s), batchId: otherRole.batchId }),
    ).rejects.toThrow(/INVALID_INPUT/);
    expect(await dump(s)).toEqual(before);
  });
});
function mutationCases(
  seed: Awaited<ReturnType<typeof addDecisionSeed>>,
  feedbackRequestId: import("./_generated/dataModel").Id<"seedFeedbackRequests">,
): Array<{
  name: string;
  extra: Record<string, import("convex/values").Value>;
}> {
  return [
    { name: "select", extra: { seedId: seed.seedId, selected: true } },
    { name: "deselect", extra: { seedId: seed.seedId } },
    { name: "edit", extra: { seedId: seed.seedId, bullets: ["Edited."] } },
    { name: "restoreWording", extra: { seedId: seed.seedId } },
    {
      name: "giveFeedback",
      extra: {
        seedId: seed.seedId,
        instruction: "Feedback.",
        commandId: "feedback",
      },
    },
    { name: "withdrawFeedback", extra: { feedbackRequestId } },
    { name: "open", extra: { commandId: "open" } },
    { name: "regenerate", extra: { commandId: "regenerate" } },
    { name: "retry", extra: { commandId: "retry" } },
    { name: "restoreBatch", extra: { batchId: seed.batchId } },
    { name: "skip", extra: {} },
    { name: "unskip", extra: {} },
    {
      name: "approve",
      extra: {
        approvalChallenge: "hash",
        acknowledgedCarriedSeedIds: [],
        acknowledgedExclusionEntryIds: [],
      },
    },
    { name: "markBatchViewed", extra: { batchId: seed.batchId } },
  ];
}

describe("attempt commands and field ownership", () => {
  it("public open reuses initial work; regenerate/retry preserve one pending attempt", async () => {
    const s = await decisionFixture();
    const first = await s.writer.mutation(open, {
      ...args(s),
      commandId: "open-1",
    });
    expect(first.kind).toBe("dispatched");
    const before = await dump(s);
    expect(
      await s.writer.mutation(open, { ...args(s, 1), commandId: "open-2" }),
    ).toMatchObject({ kind: "reused", seedStageVersion: 1 });
    const regenerate =
        decisionMutation<typeof endpoints.regenerate>("seeds:regenerate"),
      retry = decisionMutation<typeof endpoints.retry>("seeds:retry");
    await expect(
      s.writer.mutation(regenerate, { ...args(s, 1), commandId: "regen" }),
    ).rejects.toThrow(/pending/);
    expect(
      await s.writer.mutation(retry, { ...args(s, 1), commandId: "retry" }),
    ).toMatchObject({ kind: "reused", seedStageVersion: 1 });
    expect(await dump(s)).toEqual(before);
  });
  it("restores a completed ordinary Batch through its owner without losing decisions or consumed revision", async () => {
    const s = await decisionFixture(),
      old = await addDecisionSeed(s),
      current = await addDecisionSeed(s);
    await s.t.run(async (ctx) => {
      await ctx.db.patch(old.batchId, { status: "superseded" });
      const row = await ctx.db.get(current.rowId);
      if (!row) throw Error();
      await ctx.db.patch(row._id, {
        state: "approved",
        approvedContextRevision: row.currentContextRevision,
        approvedSelectionRevision: row.selectionRevision,
      });
    });
    const before = await s.t.run((ctx) => ctx.db.get(old.batchId));
    await s.writer.mutation(
      decisionMutation<typeof endpoints.restoreBatch>("seeds:restoreBatch"),
      { ...args(s), batchId: old.batchId },
    );
    expect(await s.t.run((ctx) => ctx.db.get(old.batchId))).toEqual({
      ...before,
      status: "shown",
    });
    expect(await s.t.run((ctx) => ctx.db.get(current.batchId))).toMatchObject({
      status: "superseded",
    });
    expect(await s.t.run((ctx) => ctx.db.get(current.rowId))).toMatchObject({
      state: "in_progress",
      shownBatchId: old.batchId,
    });
    expect((await dump(s)).events.map((e) => e.kind)).toEqual(["restoreBatch"]);
  });
  it("edit and select share the sole insertion helper while preserving immutable Seed fields", async () => {
    const s = await decisionFixture(),
      seed = await addDecisionSeed(s);
    const registered = await import("./seeds");
    function handler(value: object) {
      if (!("_handler" in value) || typeof value._handler !== "function")
        throw Error("Missing handler");
      return value._handler;
    }
    const writes = await s.writer.run(async (ctx) => {
      const insert = vi.spyOn(ctx.db, "insert"),
        patch = vi.spyOn(ctx.db, "patch");
      try {
        await handler(registered.edit)(ctx, {
          ...args(s),
          seedId: seed.seedId,
          bullets: ["A writer supplied clarification."],
        });
        const insertions = insert.mock.calls.filter(
          ([table]) => table === "seedSelections",
        );
        const seedPatches = patch.mock.calls
          .filter(([id]) => id === seed.seedId)
          .map(([, fields]) => fields);
        await handler(registered.select)(ctx, {
          ...args(s, 1),
          seedId: seed.seedId,
          selected: true,
        });
        return {
          insertions,
          seedPatches,
          totalSelectionInserts: insert.mock.calls.filter(
            ([table]) => table === "seedSelections",
          ).length,
        };
      } finally {
        insert.mockRestore();
        patch.mockRestore();
      }
    });
    expect(writes.insertions).toHaveLength(1);
    expect(writes.insertions[0][1]).toMatchObject({ selected: false });
    expect(writes.totalSelectionInserts).toBe(1);
    expect(writes.seedPatches).toEqual([{ support: "writer_asserted" }]);
  });
});

it("a failed regeneration cannot restore approval after an own decision changed while pending", async () => {
  const s = await decisionFixture(),
    seed = await addDecisionSeed(s);
  await s.t.run(async (ctx) => {
    const row = await ctx.db.get(seed.rowId);
    if (!row) throw Error();
    await ctx.db.patch(row._id, {
      state: "approved",
      approvedContextRevision: row.currentContextRevision,
      approvedSelectionRevision: row.selectionRevision,
    });
  });
  const result = await s.writer.mutation(
    decisionMutation<typeof endpoints.regenerate>("seeds:regenerate"),
    { ...args(s), commandId: "regen" },
  );
  if (result.kind !== "dispatched") throw Error("Expected dispatch");
  await s.writer.mutation(select, {
    ...args(s, 1),
    seedId: seed.seedId,
    selected: true,
  });
  const batch = await s.t.run((ctx) => ctx.db.get(result.batchId));
  if (!batch) throw Error();
  await s.t.mutation(
    decisionMutation<typeof import("./seedRuns").failAttempt>(
      "seedRuns:failAttempt",
    ),
    {
      batchId: batch._id,
      attemptId: batch.attemptId,
      requestsMade: 1,
      errorCode: "PROVIDER_FAILED",
    },
  );
  expect(await s.t.run((ctx) => ctx.db.get(seed.rowId))).toMatchObject({
    state: "in_progress",
  });
});

it("skipped selections above the prompt ceiling stay inactive for later dispatch snapshots", async () => {
  const s = await decisionFixture(),
    seed = await addDecisionSeed(s, "prior_year_status");
  await s.t.run(async (ctx) => {
    await ctx.db.patch(seed.rowId, { state: "skipped" });
    for (let n = 0; n < 130; n++) {
      const id = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: seed.batchId,
        roleId: "prior_year_status",
        order: n,
        bullets: ["Inactive prior year idea."],
        tags: [],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId: "prior_year_status",
        seedId: id,
        selected: true,
        selectedAt: 1,
        version: 1,
      });
    }
  });
  const { loadSeedDispatchSnapshot } = await import("./lib/seedSnapshotLoader");
  const loaded = await s.t.run((ctx) =>
    loadSeedDispatchSnapshot(ctx, {
      generationId: s.generationId,
      roleId: "workplan",
    }),
  );
  expect(loaded.snapshot.items).toEqual([
    { roleId: "prior_year_status", kind: "skip" },
  ]);
});

it("refuses an incomplete decision calculation atomically and never reports partial readiness as ready", async () => {
  const s = await decisionFixture(),
    seed = await addDecisionSeed(s);
  await s.t.run(async (ctx) => {
    const roles = await readCompleteFixture({
      label: "seedSubsections",
      maxRows: PD_SUBSECTIONS.length,
      query: ctx.db.query("seedSubsections"),
    });
    for (const role of roles)
      await ctx.db.patch(role._id, {
        state: role.kind === "optional" ? "skipped" : "approved",
        approvedContextRevision: role.currentContextRevision,
        approvedSelectionRevision: role.selectionRevision,
      });
    for (let n = 0; n < 32; n++) {
      const id = await ctx.db.insert("seeds", {
        projectId: s.projectId,
        generationId: s.generationId,
        batchId: seed.batchId,
        roleId: "company_context",
        order: n + 1,
        bullets: ["x".repeat(150000) + "."],
        tags: [],
        support: "writer_asserted",
        originalSupport: "writer_asserted",
      });
      await ctx.db.insert("seedSelections", {
        projectId: s.projectId,
        generationId: s.generationId,
        roleId: "company_context",
        seedId: id,
        selected: true,
        selectedAt: 1,
        version: 1,
      });
    }
  });
  const before = await dump(s);
  await expect(
    s.writer.mutation(select, {
      ...args(s),
      seedId: seed.seedId,
      selected: true,
    }),
  ).rejects.toThrow(/SEED_PROCESSING_LIMIT/);
  expect(await dump(s)).toEqual(before);
  expect(
    await s.writer.query(readiness, { generationId: s.generationId }),
  ).toMatchObject({ ready: false, complete: false });
});

describe("stale transition when a pending attempt restores approval", () => {
  async function pendingApproved() {
    const s = await decisionFixture(),
      up = await addDecisionSeed(s),
      down = await addDecisionSeed(s, "goal_problem");
    await s.writer.mutation(select, {
      ...args(s, 0, "goal_problem"),
      seedId: down.seedId,
      selected: true,
    });
    await s.t.run(async (ctx) => {
      const row = await ctx.db.get(down.rowId);
      if (!row) throw Error();
      await ctx.db.patch(row._id, {
        state: "approved",
        approvedContextRevision: row.currentContextRevision,
        approvedSelectionRevision: row.selectionRevision,
      });
    });
    const result = await s.writer.mutation(
      decisionMutation<typeof endpoints.regenerate>("seeds:regenerate"),
      { ...args(s, 1, "goal_problem"), commandId: "regenerate-approved" },
    );
    if (result.kind !== "dispatched") throw Error("Expected dispatch");
    const batch = await s.t.run((ctx) => ctx.db.get(result.batchId));
    if (!batch) throw Error();
    await s.t.mutation(
      decisionMutation<typeof import("./seedRuns").claimAttempt>(
        "seedRuns:claimAttempt",
      ),
      { batchId: batch._id },
    );
    await s.writer.mutation(select, {
      ...args(s, 3),
      seedId: up.seedId,
      selected: true,
    });
    return { s, up, down, batch };
  }
  async function fail(p: Awaited<ReturnType<typeof pendingApproved>>) {
    return p.s.t.mutation(
      decisionMutation<typeof import("./seedRuns").failAttempt>(
        "seedRuns:failAttempt",
      ),
      {
        batchId: p.batch._id,
        attemptId: p.batch.attemptId,
        requestsMade: 1,
        errorCode: "INVALID_OUTPUT",
      },
    );
  }
  it("opens only at failure restoration and disposes exactly once on cancellation", async () => {
    const p = await pendingApproved(),
      before = await dump(p.s);
    expect(before.episodes).toHaveLength(0);
    expect(before.roles.find((r) => r._id === p.down.rowId)).toMatchObject({
      state: "generating",
      pendingApprovalReasons: ["company_context"],
    });
    vi.setSystemTime(Date.now() + 5000);
    const restoredAt = Date.now();
    await fail(p);
    let d = await dump(p.s);
    expect(d.episodes).toHaveLength(1);
    expect(d.episodes[0]).toMatchObject({
      openedAt: restoredAt,
      reasons: ["company_context"],
    });
    const row = d.roles.find((r) => r._id === p.down.rowId);
    if (!row) throw Error();
    expect(isSeedSubsectionStale(row)).toBe(true);
    expect(row.pendingApprovalReasons).toBeUndefined();
    expect(row.activeStaleEpisodeId).toBe(d.episodes[0]._id);
    expect(d.events.filter((e) => e.kind === "staleOpened")).toHaveLength(1);
    await p.s.writer.mutation(api.generations.cancelIterativeGeneration, {
      generationId: p.s.generationId,
    });
    d = await dump(p.s);
    expect(d.episodes[0].disposition).toBe("bypassed");
    expect(d.events.filter((e) => e.kind === "staleDisposed")).toHaveLength(1);
  });
  it.each([false, true])(
    "R0→R1→R0 with another divergence=%s opens only for the remaining mismatch",
    async (divergeAgain) => {
      const p = await pendingApproved();
      await p.s.writer.mutation(deselect, {
        ...args(p.s, 4),
        seedId: p.up.seedId,
      });
      if (divergeAgain)
        await p.s.writer.mutation(select, {
          ...args(p.s, 5),
          seedId: p.up.seedId,
          selected: true,
        });
      expect((await dump(p.s)).episodes).toHaveLength(0);
      await fail(p);
      const d = await dump(p.s),
        row = d.roles.find((r) => r._id === p.down.rowId);
      if (!row) throw Error();
      expect(isSeedSubsectionStale(row)).toBe(divergeAgain);
      expect(d.episodes).toHaveLength(divergeAgain ? 1 : 0);
      expect(row.pendingApprovalReasons).toBeUndefined();
    },
  );
  it("lease reaping restores the same stale transition atomically", async () => {
    const p = await pendingApproved();
    vi.setSystemTime(p.batch.leaseExpiresAt + 1);
    await p.s.t.mutation(
      decisionMutation<typeof import("./generations").reapSeedBatchPage>(
        "generations:reapSeedBatchPage",
      ),
      { status: "running", cutoff: Date.now(), pageSize: 10 },
    );
    const d = await dump(p.s);
    expect(d.episodes).toHaveLength(1);
    expect(d.episodes[0].reasons).toEqual(["company_context"]);
    expect(d.batches.find((b) => b._id === p.batch._id)).toMatchObject({
      status: "failed",
      error: "LEASE_EXPIRED",
    });
    expect(d.roles.find((r) => r._id === p.down.rowId)).toMatchObject({
      state: "approved",
      activeStaleEpisodeId: d.episodes[0]._id,
    });
  });
  it("successful completion clears pending evidence without manufacturing an episode", async () => {
    const p = await pendingApproved();
    await p.s.t.mutation(complete, {
      batchId: p.batch._id,
      attemptId: p.batch.attemptId,
      requestsMade: 1,
      seeds: [
        {
          bullets: ["A conservative plan tests the governing constraint."],
          tags: ["conservative"],
          provenance: [],
        },
        {
          bullets: ["A technical comparison isolates the measurement error."],
          tags: ["technical"],
          provenance: [],
        },
        {
          bullets: ["A detailed trial measures the limiting condition."],
          tags: ["detailed"],
          provenance: [],
        },
      ],
      seedsDropped: 0,
    });
    const d = await dump(p.s);
    expect(d.episodes).toHaveLength(0);
    expect(d.roles.find((r) => r._id === p.down.rowId)).toMatchObject({
      state: "in_progress",
    });
    expect(
      d.roles.find((r) => r._id === p.down.rowId)?.pendingApprovalReasons,
    ).toBeUndefined();
  });
  it("terminalizes without a complete decision read and preserves unknown upgrade provenance honestly", async () => {
    const p = await pendingApproved();
    await p.s.t.run(async (ctx) => {
      await ctx.db.patch(p.down.rowId, { pendingApprovalReasons: undefined });
      for (let n = 0; n < 32; n++) {
        const id = await ctx.db.insert("seeds", {
          projectId: p.s.projectId,
          generationId: p.s.generationId,
          batchId: p.up.batchId,
          roleId: "company_context",
          order: n + 1,
          bullets: ["x".repeat(150000) + "."],
          tags: [],
          support: "writer_asserted",
          originalSupport: "writer_asserted",
        });
        await ctx.db.insert("seedSelections", {
          projectId: p.s.projectId,
          generationId: p.s.generationId,
          roleId: "company_context",
          seedId: id,
          selected: false,
          selectedAt: 1,
          version: 0,
        });
      }
    });
    expect(
      await p.s.writer.query(readiness, { generationId: p.s.generationId }),
    ).toMatchObject({ complete: false, ready: false });
    expect(await fail(p)).toMatchObject({ kind: "failed" });
    const d = await dump(p.s);
    expect(d.episodes).toHaveLength(1);
    expect(d.episodes[0].reasons).toEqual([]);
    expect(
      d.roles.find((r) => r._id === p.down.rowId)?.pendingBatchId,
    ).toBeUndefined();
  });
  it("does not manufacture episodes after project deletion starts or cancellation closes pending work", async () => {
    for (const deleting of [false, true]) {
      const p = await pendingApproved();
      if (deleting) {
        await p.s.t.run((ctx) =>
          ctx.db.patch(p.s.projectId, { deletionStartedAt: Date.now() }),
        );
        await fail(p);
      } else
        await p.s.writer.mutation(api.generations.cancelIterativeGeneration, {
          generationId: p.s.generationId,
        });
      const d = await dump(p.s);
      expect(d.episodes).toHaveLength(0);
      expect(
        d.roles.find((r) => r._id === p.down.rowId)?.pendingApprovalReasons,
      ).toBeUndefined();
    }
  });
  it("keeps one preexisting episode and adds real predecessor reasons during generation", async () => {
    const s = await decisionFixture(),
      first = await addDecisionSeed(s),
      second = await addDecisionSeed(s, "goal_problem"),
      later = await addDecisionSeed(s, "passive_limitations");
    await s.writer.mutation(select, {
      ...args(s, 0, "passive_limitations"),
      seedId: later.seedId,
      selected: true,
    });
    await s.t.run(async (ctx) => {
      const row = await ctx.db.get(later.rowId);
      if (!row) throw Error();
      await ctx.db.patch(row._id, {
        state: "approved",
        approvedContextRevision: row.currentContextRevision,
        approvedSelectionRevision: row.selectionRevision,
      });
    });
    await s.writer.mutation(select, {
      ...args(s, 1),
      seedId: first.seedId,
      selected: true,
    });
    const original = (await dump(s)).episodes[0];
    const result = await s.writer.mutation(
      decisionMutation<typeof endpoints.regenerate>("seeds:regenerate"),
      { ...args(s, 2, "passive_limitations"), commandId: "existing-episode" },
    );
    if (result.kind !== "dispatched") throw Error();
    await s.writer.mutation(select, {
      ...args(s, 3, "goal_problem"),
      seedId: second.seedId,
      selected: true,
    });
    const batch = await s.t.run((ctx) => ctx.db.get(result.batchId));
    if (!batch) throw Error();
    await s.t.mutation(
      decisionMutation<typeof import("./seedRuns").failAttempt>(
        "seedRuns:failAttempt",
      ),
      {
        batchId: batch._id,
        attemptId: batch.attemptId,
        requestsMade: 1,
        errorCode: "INVALID_OUTPUT",
      },
    );
    const d = await dump(s);
    expect(d.episodes).toHaveLength(1);
    expect(d.episodes[0]).toMatchObject({
      _id: original._id,
      reasons: ["company_context", "goal_problem"],
    });
    expect(d.events.filter((e) => e.kind === "staleOpened")).toHaveLength(1);
  });
});

// ─── Round 2 (F3 to F5): the seed-step progress reads ───────────────────────
// getSubsection names the pending batch (queued or running, with its times);
// getOutline adds when each pending row's batch started and one pace for the
// run: the median time of its finished batches, 20 seconds before any. An
// estimate, not measured progress (open question 13).

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
