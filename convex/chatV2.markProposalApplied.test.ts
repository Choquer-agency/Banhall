/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Audit CAP-2: markProposalApplied must be fenced on the report revision,
// snapshot the flushed content, and bump the revision in one transaction.
const authIds = {
  writer: "auth-mark-writer",
  manager: "auth-mark-manager",
  anonymous: "auth-mark-anonymous",
  roleless: "auth-mark-roleless",
} as const;

type Actor = keyof typeof authIds;

const TARGET = "exact target";
const REPLACEMENT = "approved replacement";
// The client already replaced the passage and autosaved before marking, so the
// seeded report carries the replacement text (the "flushed" state).
const reportContent = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: `Replace the ${REPLACEMENT} here.` }],
    },
  ],
});

async function setup() {
  const t = convexTest(schema, modules);
  // chatV2.ts imports @convex-dev/agent, so the agent component must be
  // registered for the module to load.
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: authIds.writer,
      role: "writer",
    });
    await ctx.db.insert("users", {
      authId: authIds.manager,
      role: "manager",
      isAnonymous: false,
    });
    await ctx.db.insert("users", {
      authId: authIds.anonymous,
      role: "writer",
      isAnonymous: true,
    });
    await ctx.db.insert("users", { authId: authIds.roleless });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Mark applied project",
      clientName: "Client",
      status: "review",
      createdBy: writerId,
      shareToken: "mark-applied-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Other project",
      clientName: "Client",
      status: "review",
      createdBy: writerId,
      shareToken: "mark-applied-other-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: reportContent,
      contentHash: await sha256(reportContent),
      version: 1,
      revisionNumber: 7,
      generatedAt: now,
      updatedAt: now,
    });
    const proposalId = await ctx.db.insert("chatProposals", {
      agentThreadId: "thread-mark",
      projectId,
      reportId,
      kind: "edit",
      targetText: TARGET,
      newText: REPLACEMENT,
      state: "pending",
      createdAt: now,
    });
    return { writerId, projectId, otherProjectId, reportId, proposalId };
  });
  return { t, ...ids };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function asActor(t: Setup["t"], actor: Actor) {
  return t.withIdentity({ subject: authIds[actor] });
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    return (err as ConvexError<{ code: string }>).data.code;
  }
  throw new Error("expected the call to reject");
}

async function getReport(t: Setup["t"], reportId: Id<"reports">) {
  return await t.run(async (ctx) => ctx.db.get(reportId));
}

async function getProposal(t: Setup["t"], proposalId: Id<"chatProposals">) {
  return await t.run(async (ctx) => ctx.db.get(proposalId));
}

async function snapshotsFor(t: Setup["t"], reportId: Id<"reports">) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
      .collect()
  );
}

// Attach a real approved provenance row so the "provenance cleared" assertion
// cannot pass vacuously on a fixture that never had one.
async function seedProvenance(s: Setup) {
  return await s.t.run(async (ctx) => {
    const provenanceId = await ctx.db.insert("reportProvenance", {
      projectId: s.projectId,
      contentHash: await sha256(reportContent),
      status: "approved",
      claims: [],
      createdAt: Date.now(),
    });
    await ctx.db.patch(s.reportId, { provenanceId });
    return provenanceId;
  });
}

async function expectNoWrites(s: Setup) {
  const report = await getReport(s.t, s.reportId);
  expect(report?.revisionNumber).toBe(7);
  expect(report?.content).toBe(reportContent);
  expect((await getProposal(s.t, s.proposalId))?.state).toBe("pending");
  expect(await snapshotsFor(s.t, s.reportId)).toHaveLength(0);
}

describe("markProposalApplied fence", () => {
  test("happy path: snapshots the flushed content, bumps the revision, marks applied", async () => {
    const s = await setup();
    const provenanceId = await seedProvenance(s);
    const before = await getReport(s.t, s.reportId);
    expect(before?.provenanceId).toBe(provenanceId);

    const result = await asActor(s.t, "manager").mutation(
      api.chatV2.markProposalApplied,
      { proposalId: s.proposalId, expectedRevisionNumber: 7 }
    );
    expect(result).toEqual({ applied: true, revisionNumber: 8 });

    const after = await getReport(s.t, s.reportId);
    expect(after?.revisionNumber).toBe(8);
    expect(after?.provenanceId).toBeUndefined();
    expect(after?.updatedAt).toBeGreaterThanOrEqual(before?.updatedAt ?? Infinity);
    expect(after?.content).toBe(before?.content);
    expect(after?.contentHash).toBe(before?.contentHash);
    expect(after?.contentHash).toBe(await sha256(reportContent));

    const snapshots = await snapshotsFor(s.t, s.reportId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      projectId: s.projectId,
      reportId: s.reportId,
      reason: "pre_chat_edit",
      label: "AI edit reviewed one by one",
      createdByRole: "system",
      content: reportContent,
      sourceRevisionNumber: 7,
      // Audit tuple from snapshotAuditFields: no lineage on this fixture, so
      // only the hash is present and the optional ids are absent.
      contentHash: await sha256(reportContent),
      // The snapshot records the provenance the report had at mark time.
      provenanceId,
    });
    expect(snapshots[0].generationId).toBeUndefined();
    expect(snapshots[0].sourceTranscriptId).toBeUndefined();
    expect(snapshots[0].createdAt).toBeGreaterThan(0);

    expect((await getProposal(s.t, s.proposalId))?.state).toBe("applied");
  });

  test("stale revision: STALE_REVISION with no writes", async () => {
    const s = await setup();
    const provenanceId = await seedProvenance(s);
    const code = await errorCode(
      asActor(s.t, "manager").mutation(api.chatV2.markProposalApplied, {
        proposalId: s.proposalId,
        expectedRevisionNumber: 6,
      })
    );
    expect(code).toBe("STALE_REVISION");
    await expectNoWrites(s);
    expect((await getReport(s.t, s.reportId))?.provenanceId).toBe(provenanceId);
  });

  test("already applied: idempotent return with the current revision, no snapshot, no bump", async () => {
    const s = await setup();
    const provenanceId = await seedProvenance(s);
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.proposalId, { state: "applied" });
    });
    const result = await asActor(s.t, "manager").mutation(
      api.chatV2.markProposalApplied,
      { proposalId: s.proposalId, expectedRevisionNumber: 7 }
    );
    expect(result).toEqual({ applied: true, alreadyApplied: true, revisionNumber: 7 });
    const report = await getReport(s.t, s.reportId);
    expect(report?.revisionNumber).toBe(7);
    expect(report?.provenanceId).toBe(provenanceId);
    expect(await snapshotsFor(s.t, s.reportId)).toHaveLength(0);
    expect((await getProposal(s.t, s.proposalId))?.state).toBe("applied");
  });

  test.each(["rejected", "stale"] as const)(
    "%s proposal: INVALID_INPUT with no writes",
    async (state) => {
      const s = await setup();
      await s.t.run(async (ctx) => {
        await ctx.db.patch(s.proposalId, { state });
      });
      const code = await errorCode(
        asActor(s.t, "manager").mutation(api.chatV2.markProposalApplied, {
          proposalId: s.proposalId,
          expectedRevisionNumber: 7,
        })
      );
      expect(code).toBe("INVALID_INPUT");
      const report = await getReport(s.t, s.reportId);
      expect(report?.revisionNumber).toBe(7);
      expect((await getProposal(s.t, s.proposalId))?.state).toBe(state);
      expect(await snapshotsFor(s.t, s.reportId)).toHaveLength(0);
    }
  );

  test("references proposal: INVALID_INPUT with no writes", async () => {
    const s = await setup();
    const referencesId = await s.t.run(async (ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "thread-mark",
        projectId: s.projectId,
        reportId: s.reportId,
        kind: "references",
        references: [REPLACEMENT],
        state: "pending",
        createdAt: Date.now(),
      })
    );
    const code = await errorCode(
      asActor(s.t, "manager").mutation(api.chatV2.markProposalApplied, {
        proposalId: referencesId,
        expectedRevisionNumber: 7,
      })
    );
    expect(code).toBe("INVALID_INPUT");
    expect((await getProposal(s.t, referencesId))?.state).toBe("pending");
    await expectNoWrites(s);
  });

  test("missing proposal: NOT_FOUND with no writes", async () => {
    const s = await setup();
    const missingId = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("chatProposals", {
        agentThreadId: "thread-mark",
        projectId: s.projectId,
        reportId: s.reportId,
        kind: "edit",
        targetText: TARGET,
        newText: REPLACEMENT,
        state: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    const code = await errorCode(
      asActor(s.t, "manager").mutation(api.chatV2.markProposalApplied, {
        proposalId: missingId,
        expectedRevisionNumber: 7,
      })
    );
    expect(code).toBe("NOT_FOUND");
    await expectNoWrites(s);
  });

  test("deleted report: NOT_FOUND and the proposal stays pending", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.delete(s.reportId);
    });
    const code = await errorCode(
      asActor(s.t, "manager").mutation(api.chatV2.markProposalApplied, {
        proposalId: s.proposalId,
        expectedRevisionNumber: 7,
      })
    );
    expect(code).toBe("NOT_FOUND");
    expect((await getProposal(s.t, s.proposalId))?.state).toBe("pending");
    expect(await snapshotsFor(s.t, s.reportId)).toHaveLength(0);
  });

  test("report belonging to another project: NOT_FOUND with no writes", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.reportId, { projectId: s.otherProjectId });
    });
    const code = await errorCode(
      asActor(s.t, "manager").mutation(api.chatV2.markProposalApplied, {
        proposalId: s.proposalId,
        expectedRevisionNumber: 7,
      })
    );
    expect(code).toBe("NOT_FOUND");
    const report = await getReport(s.t, s.reportId);
    expect(report?.revisionNumber).toBe(7);
    expect(report?.content).toBe(reportContent);
    expect((await getProposal(s.t, s.proposalId))?.state).toBe("pending");
    expect(await snapshotsFor(s.t, s.reportId)).toHaveLength(0);
  });

  test("no identity: NOT_AUTHENTICATED with no writes", async () => {
    const s = await setup();
    const code = await errorCode(
      s.t.mutation(api.chatV2.markProposalApplied, {
        proposalId: s.proposalId,
        expectedRevisionNumber: 7,
      })
    );
    expect(code).toBe("NOT_AUTHENTICATED");
    await expectNoWrites(s);
  });

  test.each(["anonymous", "roleless"] as const)(
    "%s user: NOT_AUTHORIZED and the proposal stays pending",
    async (actor) => {
      const s = await setup();
      const code = await errorCode(
        asActor(s.t, actor).mutation(api.chatV2.markProposalApplied, {
          proposalId: s.proposalId,
          expectedRevisionNumber: 7,
        })
      );
      expect(code).toBe("NOT_AUTHORIZED");
      await expectNoWrites(s);
    }
  );

  test("a writer can mark applied too", async () => {
    const s = await setup();
    const result = await asActor(s.t, "writer").mutation(
      api.chatV2.markProposalApplied,
      { proposalId: s.proposalId, expectedRevisionNumber: 7 }
    );
    expect(result).toEqual({ applied: true, revisionNumber: 8 });
  });

  test("client resync: the returned revision fences the next updateReportContent", async () => {
    const s = await setup();
    const writer = asActor(s.t, "writer");
    const { revisionNumber } = await writer.mutation(
      api.chatV2.markProposalApplied,
      { proposalId: s.proposalId, expectedRevisionNumber: 7 }
    );
    expect(revisionNumber).toBe(8);

    // A tab that still holds the pre-mark revision is rejected.
    const staleCode = await errorCode(
      writer.mutation(api.reports.updateReportContent, {
        reportId: s.reportId,
        content: "Edited after mark with stale revision",
        expectedRevisionNumber: 7,
      })
    );
    expect(staleCode).toBe("STALE_REVISION");
    expect((await getReport(s.t, s.reportId))?.content).toBe(reportContent);

    // The page that adopted the returned revision saves cleanly.
    const next = await writer.mutation(api.reports.updateReportContent, {
      reportId: s.reportId,
      content: "Edited after mark",
      expectedRevisionNumber: revisionNumber,
    });
    expect(next).toBe(9);
    const report = await getReport(s.t, s.reportId);
    expect(report?.content).toBe("Edited after mark");
    expect(report?.revisionNumber).toBe(9);
    // Still exactly one snapshot: the mark's, not another from the save.
    expect(await snapshotsFor(s.t, s.reportId)).toHaveLength(1);
  });

  test("the mark prunes the recovery stream to the retention cap and keeps its own snapshot", async () => {
    const s = await setup();
    // 55 fresh manual checkpoints (all < 1h old, so each is its own bucket)
    // exceed the HARD_CAP of 50 once the mark adds one more.
    const now = Date.now();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 55; i++) {
        await ctx.db.insert("reportSnapshots", {
          projectId: s.projectId,
          reportId: s.reportId,
          content: `old ${i}`,
          contentHash: await sha256(`old ${i}`),
          sourceRevisionNumber: 1,
          reason: "manual",
          createdByRole: "writer",
          createdAt: now - 55_000 + i * 1_000,
        });
      }
    });
    expect(await snapshotsFor(s.t, s.reportId)).toHaveLength(55);

    await asActor(s.t, "manager").mutation(api.chatV2.markProposalApplied, {
      proposalId: s.proposalId,
      expectedRevisionNumber: 7,
    });

    const snapshots = await snapshotsFor(s.t, s.reportId);
    expect(snapshots).toHaveLength(50);
    const marks = snapshots.filter((snap) => snap.reason === "pre_chat_edit");
    expect(marks).toHaveLength(1);
    expect(marks[0].sourceRevisionNumber).toBe(7);
    // The oldest manual checkpoints were the ones trimmed.
    expect(snapshots.some((snap) => snap.content === "old 0")).toBe(false);
    expect(snapshots.some((snap) => snap.content === "old 54")).toBe(true);
  });
});
