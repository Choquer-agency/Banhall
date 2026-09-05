/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// The prose write path of `convex/chatV2.ts`: `applyProposal` (:415),
// `updateProposalWording` (:624), `rejectProposal` (:701) and the internal
// `saveProposal` (:851), driven as real Convex functions against real rows.
// These scenarios previously lived in a handmade database under
// `tests/chatProposals.test.ts`, which mirrored the implementation and ran in
// no gate.

const AUTH = {
  owner: "cpa-owner",
  assignedWriter: "cpa-assigned-writer",
  unrelatedWriter: "cpa-unrelated-writer",
  manager: "cpa-manager",
  admin: "cpa-admin",
} as const;

type Actor = keyof typeof AUTH;

const PARAGRAPH = "Replace the exact target.";
const PINNED_DOC = JSON.stringify({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: PARAGRAPH }] },
  ],
});
const LATEST_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "The latest report must remain unchanged." }],
    },
  ],
});

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const pinnedHash = await sha256(PINNED_DOC);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {
      authId: AUTH.owner,
      role: "writer",
      firstName: "Owen",
    });
    const assignedWriterId = await ctx.db.insert("users", {
      authId: AUTH.assignedWriter,
      role: "writer",
      firstName: "Asa",
    });
    const unrelatedWriterId = await ctx.db.insert("users", {
      authId: AUTH.unrelatedWriter,
      role: "writer",
      firstName: "Wren",
    });
    const managerId = await ctx.db.insert("users", {
      authId: AUTH.manager,
      role: "manager",
      firstName: "Mara",
    });
    const adminId = await ctx.db.insert("users", {
      authId: AUTH.admin,
      role: "admin",
      firstName: "Ada",
    });

    // The Consultant who created the project is not its Owner: `createdBy`
    // grants no prose rights (docs/product-domain.md:188).
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      createdBy: unrelatedWriterId,
      ownerId,
      shareToken: "cpa-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview notes",
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "completed",
      startedAt: now,
      completedAt: now,
    });
    const provenanceId = await ctx.db.insert("reportProvenance", {
      projectId,
      generationId,
      sourceTranscriptId: transcriptId,
      contentHash: pinnedHash,
      status: "approved",
      claims: [],
      createdAt: now,
    });
    // The proposal pins the OLDER report; the project's newest report must not
    // move when the pinned one is edited.
    const pinnedReportId = await ctx.db.insert("reports", {
      projectId,
      content: PINNED_DOC,
      contentHash: pinnedHash,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 7,
      generationId,
      sourceTranscriptId: transcriptId,
      provenanceId,
    });
    const latestReportId = await ctx.db.insert("reports", {
      projectId,
      content: LATEST_DOC,
      contentHash: await sha256(LATEST_DOC),
      version: 2,
      generatedAt: now + 1,
      updatedAt: now + 1,
      revisionNumber: 2,
    });
    const researchSessionId = await ctx.db.insert("researchSessions", {
      projectId,
      reportId: pinnedReportId,
      requestedBy: ownerId,
      selectedText: "exact target",
      selectionFrom: PARAGRAPH.indexOf("exact target"),
      selectionTo: PARAGRAPH.indexOf("exact target") + "exact target".length,
      surroundingContext: PARAGRAPH,
      instruction: "Back this with sources",
      externalBrief: "Redacted brief",
      reportRevisionNumber: 7,
      status: "completed",
      evidenceSourceCount: 2,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workItems", {
      projectId,
      kind: "revision",
      assigneeId: assignedWriterId,
      assignerId: ownerId,
      instructions: "Tighten the target paragraph.",
      blocking: false,
      status: "open",
      version: 1,
      createRequestId: "cpa-req-1",
      createRequestFingerprint: "cpa-fp-1",
      createdAt: now,
      updatedAt: now,
    });
    const proposalId = await ctx.db.insert("chatProposals", {
      agentThreadId: "cpa-thread",
      promptMessageId: "cpa-prompt",
      projectId,
      reportId: pinnedReportId,
      kind: "edit",
      targetText: "exact target",
      newText: "approved replacement",
      state: "pending",
      createdAt: now,
    });
    return {
      ownerId,
      assignedWriterId,
      unrelatedWriterId,
      managerId,
      adminId,
      projectId,
      transcriptId,
      generationId,
      provenanceId,
      pinnedReportId,
      latestReportId,
      researchSessionId,
      proposalId,
    };
  });
  return {
    t,
    pinnedHash,
    as: (actor: Actor) => t.withIdentity({ subject: AUTH[actor] }),
    anonymous: t,
    ...ids,
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/** Resolve a call to its typed domain-error code, comparing codes not messages. */
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

function reportRow(f: Fixture, reportId: Id<"reports">) {
  return f.t.run((ctx) => ctx.db.get(reportId));
}

function proposalRow(f: Fixture) {
  return f.t.run((ctx) => ctx.db.get(f.proposalId));
}

function snapshotRows(f: Fixture, reportId: Id<"reports">) {
  return f.t.run((ctx) =>
    ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
      .collect()
  );
}

function wordingEvents(f: Fixture) {
  return f.t.run((ctx) =>
    ctx.db
      .query("proposalWordingEditEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", f.projectId))
      .collect()
  );
}

/** Add a second occurrence of the target so a single-target apply is ambiguous. */
async function duplicateTargetParagraph(f: Fixture) {
  await f.t.run(async (ctx) => {
    const report = (await ctx.db.get(f.pinnedReportId))!;
    const parsed = JSON.parse(report.content) as {
      content: Array<Record<string, unknown>>;
    };
    parsed.content.push({
      type: "paragraph",
      content: [{ type: "text", text: "A second exact target appears here." }],
    });
    await ctx.db.patch(f.pinnedReportId, { content: JSON.stringify(parsed) });
  });
}

describe("applyProposal writes the pinned report and its audit tuple", () => {
  test("edits the pinned report, leaves the project's newest report untouched", async () => {
    const f = await setup();

    const result = await f.as("manager").mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });
    expect(result).toEqual({ applied: true, count: 1 });

    const pinned = await reportRow(f, f.pinnedReportId);
    expect(pinned?.content).toContain("approved replacement");
    expect(pinned?.content).not.toContain("exact target");
    expect(pinned?.revisionNumber).toBe(8);
    expect(pinned?.contentHash).toBe(await sha256(pinned!.content));
    // Any writer edit invalidates the provenance review for that revision.
    expect(pinned?.provenanceId).toBeUndefined();

    const latest = await reportRow(f, f.latestReportId);
    expect(latest?.content).toBe(LATEST_DOC);
    expect(latest?.revisionNumber).toBe(2);

    expect((await proposalRow(f))?.state).toBe("applied");
    expect(await snapshotRows(f, f.latestReportId)).toEqual([]);

    const snapshots = await snapshotRows(f, f.pinnedReportId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      projectId: f.projectId,
      reportId: f.pinnedReportId,
      content: PINNED_DOC,
      contentHash: f.pinnedHash,
      provenanceId: f.provenanceId,
      generationId: f.generationId,
      sourceTranscriptId: f.transcriptId,
      sourceRevisionNumber: 7,
      reason: "pre_chat_edit",
      label: "Before AI edit",
      createdByRole: "system",
    });
  });

  test.each([
    ["requireUniqueTarget flag", "flag"],
    // Research proposals created before the flag existed still gate on origin.
    ["legacy researchSessionId fallback", "legacy"],
  ] as const)(
    "a single-target proposal (%s) refuses an ambiguous repeated passage",
    async (_label, gate) => {
      const f = await setup();
      await duplicateTargetParagraph(f);
      await f.t.run(async (ctx) => {
        await ctx.db.patch(
          f.proposalId,
          gate === "flag"
            ? { requireUniqueTarget: true }
            : { researchSessionId: f.researchSessionId }
        );
      });
      const beforeReport = await reportRow(f, f.pinnedReportId);
      const beforeProposal = await proposalRow(f);

      expect(
        await errorCode(() =>
          f.as("manager").mutation(api.chatV2.applyProposal, {
            proposalId: f.proposalId,
          })
        )
      ).toBe("STALE_REVISION");

      expect(await reportRow(f, f.pinnedReportId)).toEqual(beforeReport);
      expect(await proposalRow(f)).toEqual(beforeProposal);
      expect(await snapshotRows(f, f.pinnedReportId)).toEqual([]);
    }
  );

  test("a missing target marks the proposal stale and cannot be retried", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.proposalId, { targetText: "wording that is absent" });
    });

    const result = await f.as("manager").mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });
    expect(result).toMatchObject({ applied: false, count: 0 });
    expect((await proposalRow(f))?.state).toBe("stale");
    expect(await snapshotRows(f, f.pinnedReportId)).toEqual([]);
    expect((await reportRow(f, f.pinnedReportId))?.content).toBe(PINNED_DOC);

    expect(
      await errorCode(() =>
        f.as("manager").mutation(api.chatV2.applyProposal, {
          proposalId: f.proposalId,
        })
      )
    ).toBe("INVALID_INPUT");
  });

  test("re-applying an applied proposal is a no-op", async () => {
    const f = await setup();
    await f.as("manager").mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });
    const applied = await reportRow(f, f.pinnedReportId);
    const snapshots = await snapshotRows(f, f.pinnedReportId);

    const replay = await f.as("manager").mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });
    expect(replay).toEqual({ applied: true, count: 0, alreadyApplied: true });
    expect(await reportRow(f, f.pinnedReportId)).toEqual(applied);
    expect(await snapshotRows(f, f.pinnedReportId)).toHaveLength(
      snapshots.length
    );
  });

  test("an empty replacement deletes the target with one revision bump", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.proposalId, { newText: "" });
    });

    const result = await f.as("manager").mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });
    expect(result).toEqual({ applied: true, count: 1 });
    const pinned = await reportRow(f, f.pinnedReportId);
    expect(pinned?.content).not.toContain("exact target");
    expect(pinned?.revisionNumber).toBe(8);
  });

  test("an ordered replacement list yields the exact prose with one revision bump", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.proposalId, {
        kind: "replacements",
        targetText: undefined,
        newText: undefined,
        replacements: [
          { find: "Replace the", replaceWith: "update this" },
          { find: "exact target", replaceWith: "approved replacement" },
        ],
      });
    });

    const result = await f.as("manager").mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });
    expect(result).toEqual({ applied: true, count: 2 });
    const pinned = await reportRow(f, f.pinnedReportId);
    expect(pinned?.content).toContain("Update this approved replacement.");
    expect(pinned?.revisionNumber).toBe(8);
  });
});

// The remaining rows of this table are already proven on the same endpoint by
// convex/reportAuthz.test.ts: the durable Owner succeeds (:428), an elevated
// Admin who is not the Owner succeeds (:442), and every ineligible actor —
// including an anonymous caller — is rejected with the report, proposal and
// snapshot rows unchanged (:406). They are not duplicated here.
describe("applyProposal permission table", () => {
  test("a Consultant with an open assigned work item may apply", async () => {
    const f = await setup();
    expect(
      await f.as("assignedWriter").mutation(api.chatV2.applyProposal, {
        proposalId: f.proposalId,
      })
    ).toEqual({ applied: true, count: 1 });
  });

  test("a Consultant is denied once the assignment is no longer open", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      const item = await ctx.db
        .query("workItems")
        .withIndex("by_projectId_and_status", (q) =>
          q.eq("projectId", f.projectId).eq("status", "open")
        )
        .first();
      await ctx.db.patch(item!._id, { status: "completed" });
    });
    const before = await reportRow(f, f.pinnedReportId);

    expect(
      await errorCode(() =>
        f.as("assignedWriter").mutation(api.chatV2.applyProposal, {
          proposalId: f.proposalId,
        })
      )
    ).toBe("NOT_AUTHORIZED");
    expect(await reportRow(f, f.pinnedReportId)).toEqual(before);
  });

  test("an unrelated eligible Consultant is denied, even as the project creator", async () => {
    const f = await setup();
    const before = await reportRow(f, f.pinnedReportId);

    expect(
      await errorCode(() =>
        f.as("unrelatedWriter").mutation(api.chatV2.applyProposal, {
          proposalId: f.proposalId,
        })
      )
    ).toBe("NOT_AUTHORIZED");
    expect(await reportRow(f, f.pinnedReportId)).toEqual(before);
    expect((await proposalRow(f))?.state).toBe("pending");
    expect(await snapshotRows(f, f.pinnedReportId)).toEqual([]);
  });

  test("a Manager may apply on a project it does not own", async () => {
    const f = await setup();
    expect(
      await f.as("manager").mutation(api.chatV2.applyProposal, {
        proposalId: f.proposalId,
      })
    ).toEqual({ applied: true, count: 1 });
  });
});

describe("updateProposalWording", () => {
  test("stores the new wording, leaves the canonical target, writes one audit row", async () => {
    const f = await setup();

    await expect(
      f.as("manager").mutation(api.chatV2.updateProposalWording, {
        proposalId: f.proposalId,
        newText: "writer-polished replacement",
      })
    ).resolves.toEqual({ updated: true });

    const proposal = await proposalRow(f);
    expect(proposal?.targetText).toBe("exact target");
    expect(proposal?.newText).toBe("writer-polished replacement");
    expect(proposal?.wordingEditedBy).toBe(f.managerId);
    expect(proposal?.wordingEditCount).toBe(1);

    const events = await wordingEvents(f);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      projectId: f.projectId,
      reportId: f.pinnedReportId,
      proposalId: f.proposalId,
      userId: f.managerId,
      originalText: "approved replacement",
      editedText: "writer-polished replacement",
    });
  });

  test("refuses to change the replacement targets and writes nothing", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.proposalId, {
        kind: "replacements",
        targetText: undefined,
        newText: undefined,
        replacements: [
          { find: "exact target", replaceWith: "approved replacement" },
        ],
      });
    });
    const before = await proposalRow(f);

    expect(
      await errorCode(() =>
        f.as("manager").mutation(api.chatV2.updateProposalWording, {
          proposalId: f.proposalId,
          replacements: [
            { find: "different target", replaceWith: "writer wording" },
          ],
        })
      )
    ).toBe("INVALID_INPUT");

    expect(await proposalRow(f)).toEqual(before);
    expect(await wordingEvents(f)).toEqual([]);
  });
});

describe("rejectProposal", () => {
  // `rejectProposal` gates on internal project access, not on report.editProse:
  // any eligible internal actor may clear a suggestion off the card stack. That
  // is the current contract (chatV2.ts:701-712); this pins it rather than
  // tightening it during a test migration.
  test.each([["manager"], ["unrelatedWriter"]] as const)(
    "an internal %s may reject a pending proposal",
    async (actor) => {
      const f = await setup();
      await f.as(actor).mutation(api.chatV2.rejectProposal, {
        proposalId: f.proposalId,
      });
      expect((await proposalRow(f))?.state).toBe("rejected");
    }
  );

  test("an anonymous caller cannot reject, and nothing is written", async () => {
    const f = await setup();
    const before = await proposalRow(f);

    expect(
      await errorCode(() =>
        f.anonymous.mutation(api.chatV2.rejectProposal, {
          proposalId: f.proposalId,
        })
      )
    ).toBe("NOT_AUTHENTICATED");
    expect(await proposalRow(f)).toEqual(before);
  });

  test("an applied proposal cannot be rejected", async () => {
    const f = await setup();
    await f.as("manager").mutation(api.chatV2.applyProposal, {
      proposalId: f.proposalId,
    });

    expect(
      await errorCode(() =>
        f.as("manager").mutation(api.chatV2.rejectProposal, {
          proposalId: f.proposalId,
        })
      )
    ).toBe("INVALID_INPUT");
    expect((await proposalRow(f))?.state).toBe("applied");
  });
});

const LIVE_PARAGRAPH = "The team tested the alloy at low temperature.";
const LIVE_DOC = JSON.stringify({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: LIVE_PARAGRAPH }] },
  ],
});

/** A report with a real queued turn, the state the proposal tools run in. */
async function liveTurn() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const { reportId } = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: AUTH.owner,
      role: "writer",
      firstName: "Owen",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Live turn project",
      clientName: "Acme Metals",
      status: "review",
      createdBy: userId,
      ownerId: userId,
      shareToken: "cpa-live-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: LIVE_DOC,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
    return { reportId };
  });
  const actor = t.withIdentity({ subject: AUTH.owner });
  const sent = await actor.mutation(api.chatV2.sendMessage, {
    reportId,
    content: "Help revise this report.",
    newThread: true,
  });
  const proposals = () =>
    t.run((ctx) => ctx.db.query("chatProposals").collect());
  return { t, actor, reportId, sent, proposals };
}

describe("saveProposal on a live turn", () => {
  test("rejects a target copied from an unapplied candidate", async () => {
    const { t, sent, proposals } = await liveTurn();

    const result = await t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: sent.threadId,
      toolCallId: "cpa-tool-invalid",
      promptMessageId: sent.messageId,
      kind: "edit",
      targetText: "This wording existed only in a rejected suggestion.",
      newText: "A refined version of rejected wording.",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringContaining("not in the CURRENT REPORT"),
    });
    expect(await proposals()).toEqual([]);
  });

  test("stores the tool and prompt association for a valid pending edit", async () => {
    const { t, sent, proposals } = await liveTurn();

    const result = await t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: sent.threadId,
      toolCallId: "cpa-tool-valid",
      promptMessageId: sent.messageId,
      kind: "edit",
      targetText: "tested the alloy",
      newText: "measured the alloy",
    });
    expect(result).toMatchObject({ ok: true });

    const rows = await proposals();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentThreadId: sent.threadId,
      toolCallId: "cpa-tool-valid",
      promptMessageId: sent.messageId,
      // An `edit` is single-target by construction, so apply must refuse it
      // once the passage stops being unique.
      requireUniqueTarget: true,
      state: "pending",
    });
  });

  test("deduplicates a repeated tool execution by toolCallId", async () => {
    const { t, sent, proposals } = await liveTurn();
    const args = {
      agentThreadId: sent.threadId,
      toolCallId: "cpa-tool-repeat",
      promptMessageId: sent.messageId,
      kind: "edit" as const,
      targetText: "tested the alloy",
      newText: "measured the alloy",
    };

    const first = await t.mutation(internal.chatV2.saveProposal, args);
    expect(await t.mutation(internal.chatV2.saveProposal, args)).toEqual(first);

    // Dedupe is by tool call id alone: a retry carrying different wording
    // returns the first row untouched rather than a second card.
    expect(
      await t.mutation(internal.chatV2.saveProposal, {
        ...args,
        newText: "rewrote the alloy",
      })
    ).toEqual(first);

    const rows = await proposals();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.newText).toBe("measured the alloy");
  });
});
