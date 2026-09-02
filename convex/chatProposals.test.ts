/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { sha256 } from "./lib/contracts";

const modules = import.meta.glob("./**/*.ts");

// Sprint 1 story 6 (CAP-2, decision D-1): the one-by-one path
// `markProposalApplied` carries the same guarantees as `applyProposal` —
// authorization recheck, a `pre_chat_edit` snapshot of the content as it
// stands before the edit, a revision fence, content and status written
// together, and the revision bumped by exactly one, all inside one mutation.

const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "The team tested the alloy. The team tested the coating.",
        },
      ],
    },
  ],
});

// What the writer's editor holds after stepping through the replacements.
const STEPPED_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "The team measured the alloy. The team measured the coating.",
        },
      ],
    },
  ],
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {
      authId: "cp-owner",
      role: "writer",
      firstName: "Owen",
    });
    // Mapped, signed in, but holds no internal role.
    await ctx.db.insert("users", {
      authId: "cp-roleless",
      firstName: "Rory",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "cp-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: REPORT_DOC,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
    // A pre-existing snapshot, so "exactly one new row" and "the snapshot
    // list is unchanged" are real comparisons rather than empty-vs-empty.
    await ctx.db.insert("reportSnapshots", {
      projectId,
      reportId,
      content: REPORT_DOC,
      reason: "manual",
      createdByRole: "writer",
      createdAt: now,
    });
    await ctx.db.insert("agentChatThreads", {
      projectId,
      reportId,
      agentThreadId: "cp-thread",
      title: "Chat",
      createdAt: now,
    });
    const proposal = (state: "pending" | "rejected") => ({
      agentThreadId: "cp-thread",
      projectId,
      reportId,
      kind: "replacements" as const,
      replacements: [{ find: "tested", replaceWith: "measured" }],
      state,
      createdAt: now,
    });
    const proposalId = await ctx.db.insert("chatProposals", proposal("pending"));
    // A second pending proposal on the same report: the concurrent writer
    // whose apply must be fenced once the first one has bumped the revision.
    const otherProposalId = await ctx.db.insert(
      "chatProposals",
      proposal("pending")
    );
    const rejectedProposalId = await ctx.db.insert(
      "chatProposals",
      proposal("rejected")
    );
    return { projectId, reportId, proposalId, otherProposalId, rejectedProposalId };
  });

  return {
    t,
    ...ids,
    noIdentity: t,
    roleless: t.withIdentity({ subject: "cp-roleless" }),
    owner: t.withIdentity({ subject: "cp-owner" }),
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/** Typed domain-error code of a failed call, or a readable marker. */
async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      return String((data as { code: unknown }).code);
    }
    return `UNTYPED: ${(error as Error).message}`;
  }
  return "NO_ERROR";
}

async function reportRow(f: Fixture) {
  return await f.t.run((ctx) => ctx.db.get(f.reportId));
}

async function proposalRows(f: Fixture) {
  return await f.t.run(async (ctx) => ({
    first: await ctx.db.get(f.proposalId),
    other: await ctx.db.get(f.otherProposalId),
    rejected: await ctx.db.get(f.rejectedProposalId),
  }));
}

async function snapshots(f: Fixture) {
  return await f.t.run((ctx) =>
    ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", f.reportId))
      .collect()
  );
}

/** Everything the mutation may touch, for "nothing changed" comparisons. */
async function state(f: Fixture) {
  return {
    report: await reportRow(f),
    proposals: await proposalRows(f),
    snapshots: await snapshots(f),
  };
}

describe("markProposalApplied apply parity (CAP-2)", () => {
  it("applies the stepped document with a pre_chat_edit snapshot and one revision bump", async () => {
    const f = await setup();
    const before = await state(f);
    expect(before.report?.revisionNumber).toBe(0);

    const result = await f.owner.mutation(api.chatV2.markProposalApplied, {
      proposalId: f.proposalId,
      content: STEPPED_DOC,
      expectedRevisionNumber: 0,
    });
    expect(result).toEqual({
      applied: true,
      alreadyApplied: false,
      revisionNumber: 1,
    });

    const after = await state(f);
    expect(after.proposals.first?.state).toBe("applied");
    // Untouched neighbours.
    expect(after.proposals.other).toEqual(before.proposals.other);
    expect(after.proposals.rejected).toEqual(before.proposals.rejected);

    // Exactly one new snapshot, holding the content from before the apply.
    expect(after.snapshots.length).toBe(before.snapshots.length + 1);
    const beforeIds = new Set(before.snapshots.map((snapshot) => snapshot._id));
    const added = after.snapshots.filter((snapshot) => !beforeIds.has(snapshot._id));
    expect(added.length).toBe(1);
    expect(added[0]).toMatchObject({
      reason: "pre_chat_edit",
      label: "Before AI edit",
      createdByRole: "system",
      reportId: f.reportId,
      projectId: f.projectId,
      content: REPORT_DOC,
      sourceRevisionNumber: 0,
      contentHash: await sha256(REPORT_DOC),
    });

    // Content, hash and revision moved together; provenance is invalidated.
    expect(after.report?.content).toBe(STEPPED_DOC);
    expect(after.report?.contentHash).toBe(await sha256(STEPPED_DOC));
    expect(after.report?.revisionNumber).toBe(1);
    expect(after.report?.provenanceId).toBeUndefined();
  });

  it("rejects a second call with the same expectedRevisionNumber and changes nothing", async () => {
    const f = await setup();
    await f.owner.mutation(api.chatV2.markProposalApplied, {
      proposalId: f.proposalId,
      content: STEPPED_DOC,
      expectedRevisionNumber: 0,
    });
    const before = await state(f);
    expect(before.report?.revisionNumber).toBe(1);

    // Another pending proposal applied against the revision that no longer
    // exists: fenced, typed, and no row moves.
    expect(
      await errorCode(() =>
        f.owner.mutation(api.chatV2.markProposalApplied, {
          proposalId: f.otherProposalId,
          content: REPORT_DOC,
          expectedRevisionNumber: 0,
        })
      )
    ).toBe("STALE_REVISION");
    expect(await state(f)).toEqual(before);

    // The current revision still goes through, bumping by exactly one again.
    const result = await f.owner.mutation(api.chatV2.markProposalApplied, {
      proposalId: f.otherProposalId,
      content: REPORT_DOC,
      expectedRevisionNumber: 1,
    });
    expect(result).toEqual({
      applied: true,
      alreadyApplied: false,
      revisionNumber: 2,
    });
    const after = await state(f);
    expect(after.report?.revisionNumber).toBe(2);
    expect(after.snapshots.length).toBe(before.snapshots.length + 1);
    // Its snapshot holds the content that stood before THIS apply.
    expect(
      after.snapshots.find((snapshot) => snapshot.sourceRevisionNumber === 1)
    ).toMatchObject({ reason: "pre_chat_edit", content: STEPPED_DOC });
  });

  it("replays an already-applied proposal as a no-op without writing", async () => {
    const f = await setup();
    await f.owner.mutation(api.chatV2.markProposalApplied, {
      proposalId: f.proposalId,
      content: STEPPED_DOC,
      expectedRevisionNumber: 0,
    });
    const before = await state(f);
    // Same proposal, stale fence: the client retry lands on the applied row
    // and is told so, with the live revision, instead of re-writing.
    const replay = await f.owner.mutation(api.chatV2.markProposalApplied, {
      proposalId: f.proposalId,
      content: REPORT_DOC,
      expectedRevisionNumber: 0,
    });
    expect(replay).toEqual({
      applied: true,
      alreadyApplied: true,
      revisionNumber: 1,
    });
    expect(await state(f)).toEqual(before);
  });

  it("rejects a caller without an internal role before any write", async () => {
    const f = await setup();
    const before = await state(f);
    const attempts: Array<[string, Fixture["owner"], string]> = [
      ["role-less", f.roleless, "NOT_AUTHORIZED"],
      ["no identity", f.noIdentity, "NOT_AUTHENTICATED"],
    ];
    for (const [label, actor, code] of attempts) {
      expect(
        await errorCode(() =>
          actor.mutation(api.chatV2.markProposalApplied, {
            proposalId: f.proposalId,
            content: STEPPED_DOC,
            expectedRevisionNumber: 0,
          })
        ),
        label
      ).toBe(code);
      expect(await state(f), label).toEqual(before);
    }
  });

  it("rejects content that is not a JSON editor document and writes nothing", async () => {
    const f = await setup();
    const before = await state(f);
    const invalid: Array<[string, string]> = [
      ["empty", "   "],
      ["not JSON", "The team measured the alloy."],
      ["JSON array", JSON.stringify([{ type: "doc" }])],
      ["JSON string", JSON.stringify("doc")],
      ["JSON null", "null"],
      ["oversized", JSON.stringify({ type: "doc", pad: "x".repeat(1_000_001) })],
    ];
    for (const [label, content] of invalid) {
      expect(
        await errorCode(() =>
          f.owner.mutation(api.chatV2.markProposalApplied, {
            proposalId: f.proposalId,
            content,
            expectedRevisionNumber: 0,
          })
        ),
        label
      ).toBe("INVALID_INPUT");
      expect(await state(f), label).toEqual(before);
    }
  });

  it("rejects a proposal that is no longer pending, with nothing written", async () => {
    const f = await setup();
    const before = await state(f);
    expect(
      await errorCode(() =>
        f.owner.mutation(api.chatV2.markProposalApplied, {
          proposalId: f.rejectedProposalId,
          content: STEPPED_DOC,
          expectedRevisionNumber: 0,
        })
      )
    ).toBe("INVALID_INPUT");
    expect(await state(f)).toEqual(before);
  });
});
