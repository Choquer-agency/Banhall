/// <reference types="vite/client" />
/**
 * Phase E, E2a (part 6 of the first 2026-10-26 entry): removing a Brain
 * source withdraws the lessons drawn from it, and a published lesson set
 * drawn from it is turned off until an Admin publishes a new one.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { AdmissionSnapshot } from "./lib/learningAdmission";

const eraseMock = vi.hoisted(() => vi.fn(async () => "confirmed" as const));
vi.mock("./ai/brain/erase", () => ({ eraseBrainEntry: eraseMock }));

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "withdraw-admin", role: "admin", name: "Admin" });
  });
  return { t, admin: t.withIdentity({ subject: "withdraw-admin" }) };
}

async function insertSource(t: T, status: "pending" | "approved" | "revoked" = "pending") {
  return await t.run((ctx) =>
    ctx.db.insert("brainSources", {
      kind: "writer_feedback",
      status,
      title: "Writer feedback",
      industry: "general",
      writerTier: 0.4,
      docType: "writer_feedback",
      content: "Lead each section with the result, then the method.",
      ragKey: `brain:${Math.random()}`,
      sourceHash: `hash-${Math.random()}`,
      createdBy: "withdraw-admin",
      createdAt: 1,
    })
  );
}

/** Approved feedback, approved at `approvedAt`, optionally linked to a source. */
async function insertFeedback(
  t: T,
  options: { approvedAt: number; sourceId?: Id<"brainSources">; linkThroughAuditOnly?: boolean }
) {
  return await t.run(async (ctx) => {
    const feedbackId = await ctx.db.insert("brainFeedbackQueue", {
      fromUserId: "writer-a",
      body: "Lead each section with the result, then explain the method that produced it.",
      status: "approved",
      createdAt: 1,
      ...(options.sourceId && !options.linkThroughAuditOnly ? { brainSourceId: options.sourceId } : {}),
    });
    await ctx.db.insert("brainAuditLog", {
      action: "approve",
      feedbackId,
      ...(options.sourceId ? { sourceId: options.sourceId } : {}),
      actorId: "withdraw-admin",
      at: options.approvedAt,
    });
    return feedbackId;
  });
}

function admissionFor(feedbackIds: string[], cutoff: number): AdmissionSnapshot {
  return {
    admittedCount: feedbackIds.length,
    excludedCount: 0,
    feedbackCutoff: cutoff,
    producers: [],
    streams: [
      {
        stream: "brainFeedbackQueue",
        admittedCount: feedbackIds.length,
        excludedCount: 0,
        signalIds: feedbackIds,
        producers: [],
        missingWriterCount: 0,
        missingProjectCount: 0,
        insufficientDiversityCount: 0,
        writerCount: 2,
        projectCount: 2,
      },
    ],
  };
}

async function insertDigest(t: T, options: { cutoff: number; admitted?: string[]; createdAt?: number }) {
  return await t.run((ctx) =>
    ctx.db.insert("learningDigests", {
      kind: "draft_style",
      content: "Learned from 6 human feedback events:\n- Lead with the result.",
      sourceCount: 6,
      feedbackCutoff: options.cutoff,
      model: "test-model",
      createdAt: options.createdAt ?? 10,
      ...(options.admitted ? { admission: admissionFor(options.admitted, options.cutoff) } : {}),
    })
  );
}

async function publish(t: T, digestId: Id<"learningDigests">) {
  return await t.run((ctx) =>
    ctx.db.insert("learningDigestSelections", {
      kind: "draft_style",
      selectedDigestId: digestId,
      actorKind: "system",
      action: "select",
      selectedAt: 5,
    })
  );
}

async function latestSelection(t: T) {
  return await t.run((ctx) =>
    ctx.db.query("learningDigestSelections").withIndex("by_kind", (q) => q.eq("kind", "draft_style")).order("desc").first()
  );
}

describe("removing a Brain source withdraws its lessons (Phase E, E2a)", () => {
  test("revoking a source withdraws its feedback and turns off a published set that admitted it", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, "approved");
    const feedbackId = await insertFeedback(t, { approvedAt: 3, sourceId });
    const digestId = await insertDigest(t, { cutoff: 3, admitted: [feedbackId] });
    await publish(t, digestId);

    await admin.mutation(api.brain.revokeSource, { sourceId, reason: "Wrong guidance" });

    expect((await t.run((ctx) => ctx.db.get(feedbackId)))?.withdrawnAt).toEqual(expect.any(Number));
    expect(await latestSelection(t)).toMatchObject({ selectedDigestId: null, action: "source_withdrawn", actorKind: "system" });
    expect(await t.query(internal.learning.getActiveDigest, { kind: "draft_style" })).toBeNull();
    // New lesson sets no longer read it.
    const inputs = await t.query(internal.learning.getApprovedBrainFeedbackForDigest, { limit: 50 });
    expect(inputs.map((row) => row.signalId)).not.toContain(feedbackId);
  });

  test("a published set that did not admit it stays on", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, "approved");
    await insertFeedback(t, { approvedAt: 3, sourceId });
    const other = await insertFeedback(t, { approvedAt: 2 });
    const digestId = await insertDigest(t, { cutoff: 3, admitted: [other] });
    const selectionId = await publish(t, digestId);

    await admin.mutation(api.brain.revokeSource, { sourceId });

    expect((await latestSelection(t))?._id).toBe(selectionId);
    expect((await t.query(internal.learning.getActiveDigest, { kind: "draft_style" }))?._id).toBe(digestId);
  });

  test("a set with no admission record counts as drawn from every item approved up to its cutoff", async () => {
    const { t, admin } = await setup();
    // Approved after the legacy set's cutoff: the set cannot have read it.
    const late = await insertSource(t, "approved");
    await insertFeedback(t, { approvedAt: 9, sourceId: late });
    const legacy = await insertDigest(t, { cutoff: 4 });
    await admin.mutation(api.brain.revokeSource, { sourceId: late });
    // No selection yet: the newest global set stays published.
    expect(await latestSelection(t)).toBeNull();
    expect((await t.query(internal.learning.getActiveDigest, { kind: "draft_style" }))?._id).toBe(legacy);

    // Approved by the cutoff, linked only through its approval's audit row.
    const early = await insertSource(t, "approved");
    await insertFeedback(t, { approvedAt: 2, sourceId: early, linkThroughAuditOnly: true });
    await admin.mutation(api.brain.revokeSource, { sourceId: early });
    expect(await latestSelection(t)).toMatchObject({ selectedDigestId: null, action: "source_withdrawn" });
  });

  test("publishing or rolling back to a set that drew on withdrawn feedback is refused", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, "approved");
    const feedbackId = await insertFeedback(t, { approvedAt: 3, sourceId });
    const drew = await insertDigest(t, { cutoff: 3, admitted: [feedbackId] });
    const clean = await insertDigest(t, { cutoff: 3, admitted: [], createdAt: 11 });
    await publish(t, drew);
    await admin.mutation(api.brain.revokeSource, { sourceId });
    const current = await latestSelection(t);

    await expect(
      admin.mutation(api.learning.selectDigest, {
        kind: "draft_style",
        digestId: drew,
        expectedSelectionId: current!._id,
        privacyReviewed: true,
      })
    ).rejects.toThrow(/Brain source that was removed/);
    // A version that never read it can be published.
    await admin.mutation(api.learning.selectDigest, {
      kind: "draft_style",
      digestId: clean,
      expectedSelectionId: current!._id,
      privacyReviewed: true,
    });
    const history = await admin.query(api.learning.getDigestHistory, { kind: "draft_style" });
    expect(history.digests.find((digest) => digest._id === drew)?.drewOnRemovedSource).toBe(true);
    expect(history.digests.find((digest) => digest._id === clean)?.drewOnRemovedSource).toBe(false);
    expect(history.turnedOffForRemovedSource).toBe(false);
  });

  test("a candidate whose feedback was withdrawn while it was built is not saved", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, "approved");
    const feedbackId = await insertFeedback(t, { approvedAt: 3, sourceId });
    // The build read the feedback, then the source was revoked during its model call.
    const freshness = await t.query(internal.learning.getLearningFreshness, { kind: "draft_style", feedbackCutoff: 3 });
    await admin.mutation(api.brain.revokeSource, { sourceId });

    const saved = await t.mutation(internal.learning.saveDigest, {
      kind: "draft_style",
      content: "Learned from 6 human feedback events:\n- Lead with the result.",
      sourceCount: 6,
      feedbackCutoff: 3,
      model: "test-model",
      admission: admissionFor([feedbackId], 3),
      learningRevision: freshness.revision,
    });
    expect(saved).toBeNull();
    const attempt = await t.run((ctx) =>
      ctx.db.query("learningDigestAttempts").withIndex("by_kind", (q) => q.eq("kind", "draft_style")).unique()
    );
    expect(attempt?.outcome).toBe("withdrawn_inputs");
    const history = await admin.query(api.learning.getDigestHistory, { kind: "draft_style" });
    expect(history.digests).toHaveLength(0);
  });

  test("after a withdrawal a rebuild with no newer feedback is built and saved; with none since it is not", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, "approved");
    const withdrawn = await insertFeedback(t, { approvedAt: 5, sourceId });
    const kept = await insertFeedback(t, { approvedAt: 4 });
    await insertDigest(t, { cutoff: 5, admitted: [withdrawn, kept] });
    await admin.mutation(api.brain.revokeSource, { sourceId });

    // The rebuild's newest admitted feedback is older than the last cutoff.
    const freshness = await t.query(internal.learning.getLearningFreshness, { kind: "draft_style", feedbackCutoff: 4 });
    expect(freshness.unchanged).toBe(false);
    expect(freshness.revision).toBeGreaterThan(0);
    const rebuilt = await t.mutation(internal.learning.saveDigest, {
      kind: "draft_style",
      content: "Learned from 5 human feedback events:\n- Keep background short.",
      sourceCount: 5,
      feedbackCutoff: 4,
      model: "test-model",
      admission: admissionFor([kept], 4),
      learningRevision: freshness.revision,
    });
    expect(rebuilt).not.toBeNull();
    // The next nightly run finds nothing new.
    expect(
      (await t.query(internal.learning.getLearningFreshness, { kind: "draft_style", feedbackCutoff: 4 })).unchanged
    ).toBe(true);
  });

  test("approving feedback links the Brain source it nominates", async () => {
    const { t, admin } = await setup();
    const feedbackId = await t.run((ctx) =>
      ctx.db.insert("brainFeedbackQueue", {
        fromUserId: "writer-a",
        body: "Lead each section with the result, then explain the method that produced it, in plain words.",
        status: "pending",
        createdAt: 1,
      })
    );
    await admin.mutation(api.brain.reviewFeedback, { feedbackId, decision: "approved" });
    const row = await t.run((ctx) => ctx.db.get(feedbackId));
    expect(row?.brainSourceId).toEqual(expect.any(String));
    expect((await t.run((ctx) => ctx.db.get(row!.brainSourceId!)))?.status).toBe("pending");
  });

  test("removing a pending source for good withdraws its feedback and clears the link", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, "pending");
    const feedbackId = await insertFeedback(t, { approvedAt: 3, sourceId });
    const digestId = await insertDigest(t, { cutoff: 3, admitted: [feedbackId] });
    await publish(t, digestId);

    await t.mutation(internal.brain.removeSourcePermanently, { sourceId });

    const row = await t.run((ctx) => ctx.db.get(feedbackId));
    expect(row?.withdrawnAt).toEqual(expect.any(Number));
    expect(row?.brainSourceId).toBeUndefined();
    expect(await latestSelection(t)).toMatchObject({ selectedDigestId: null, action: "source_withdrawn" });
  });

  test("the one-off pass links older feedback and withdraws feedback of sources removed before E2a", async () => {
    const { t } = await setup();
    const revoked = await insertSource(t, "revoked");
    const live = await insertSource(t, "approved");
    const fromRevoked = await insertFeedback(t, { approvedAt: 3, sourceId: revoked, linkThroughAuditOnly: true });
    const fromLive = await insertFeedback(t, { approvedAt: 3, sourceId: live, linkThroughAuditOnly: true });
    const digestId = await insertDigest(t, { cutoff: 3, admitted: [fromRevoked, fromLive] });
    await publish(t, digestId);

    const result = await t.mutation(internal.brain.linkBrainFeedbackSources, {});
    expect(result).toEqual({ linked: 2, withdrawn: 1, done: true });
    const rows = await t.run(async (ctx) => [await ctx.db.get(fromRevoked), await ctx.db.get(fromLive)]);
    expect(rows.map((row) => [row?.brainSourceId, row?.withdrawnAt !== undefined])).toEqual([
      [revoked, true],
      [live, false],
    ]);
    expect(await latestSelection(t)).toMatchObject({ selectedDigestId: null, action: "source_withdrawn" });
    // Run again: nothing more to do.
    expect(await t.mutation(internal.brain.linkBrainFeedbackSources, {})).toEqual({ linked: 0, withdrawn: 0, done: true });
  });

  test("an old withdrawal still blocks publication after many newer ones (review)", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, "approved");
    const old = await insertFeedback(t, { approvedAt: 3, sourceId });
    const drew = await insertDigest(t, { cutoff: 3, admitted: [old] });
    await admin.mutation(api.brain.revokeSource, { sourceId });
    // Six hundred later withdrawals, newer than the old one.
    await t.run(async (ctx) => {
      for (let index = 0; index < 600; index += 1) {
        await ctx.db.insert("brainFeedbackQueue", {
          fromUserId: "writer-b", body: `Later feedback ${index}`, status: "approved", createdAt: 1,
          withdrawnAt: Date.now() + 1_000 + index, withdrawnApprovedAt: 9,
        });
      }
    });
    const current = await latestSelection(t);
    await expect(
      admin.mutation(api.learning.selectDigest, {
        kind: "draft_style", digestId: drew, expectedSelectionId: current?._id ?? null, privacyReviewed: true,
      })
    ).rejects.toThrow(/Brain source that was removed/);
  });

  test("revoking a source with more than 200 linked items withdraws every one (review)", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, "approved");
    await t.run(async (ctx) => {
      for (let index = 0; index < 250; index += 1) {
        await ctx.db.insert("brainFeedbackQueue", {
          fromUserId: "writer-a", body: `Linked feedback ${index}`, status: "approved", createdAt: 1, brainSourceId: sourceId,
        });
      }
    });
    await admin.mutation(api.brain.revokeSource, { sourceId });
    const rows = await t.run((ctx) => ctx.db.query("brainFeedbackQueue").collect());
    expect(rows.filter((row) => row.withdrawnAt === undefined)).toHaveLength(0);
    expect(rows.every((row) => row.withdrawnApprovedAt === 1)).toBe(true);
  });

  test("approving feedback that duplicates a revoked source withdraws it at once (review)", async () => {
    const { t, admin } = await setup();
    const body = "Lead each section with the result, then explain the method that produced it, in plain words.";
    const first = await t.run((ctx) => ctx.db.insert("brainFeedbackQueue", { fromUserId: "writer-a", body, status: "pending", createdAt: 1 }));
    await admin.mutation(api.brain.reviewFeedback, { feedbackId: first, decision: "approved" });
    const sourceId = (await t.run((ctx) => ctx.db.get(first)))!.brainSourceId!;
    await admin.mutation(api.brain.revokeSource, { sourceId });

    const again = await t.run((ctx) => ctx.db.insert("brainFeedbackQueue", { fromUserId: "writer-b", body, status: "pending", createdAt: 2 }));
    await admin.mutation(api.brain.reviewFeedback, { feedbackId: again, decision: "approved" });
    const row = await t.run((ctx) => ctx.db.get(again));
    expect(row).toMatchObject({ brainSourceId: sourceId, withdrawnAt: expect.any(Number) });
    const inputs = await t.query(internal.learning.getApprovedBrainFeedbackForDigest, { limit: 50 });
    expect(inputs).toEqual([]);
  });

  test("two approvals of the same text link the one source, and an item linked twice is withdrawn once (review)", async () => {
    const { t, admin } = await setup();
    const body = "Name the uncertainty before the work that answered it, every time, in each Line.";
    const ids: Id<"brainFeedbackQueue">[] = [];
    for (const writer of ["writer-a", "writer-b"]) {
      const id = await t.run((ctx) => ctx.db.insert("brainFeedbackQueue", { fromUserId: writer, body, status: "pending", createdAt: 1 }));
      await admin.mutation(api.brain.reviewFeedback, { feedbackId: id, decision: "approved" });
      ids.push(id);
    }
    const rows = await t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
    expect(rows[0]!.brainSourceId).toBe(rows[1]!.brainSourceId);
    // Linked directly and through each approval's audit row.
    const withdrawn = await t.run(async (ctx) => {
      const { withdrawSourceFeedback } = await import("./lib/learningWithdrawal");
      return await withdrawSourceFeedback(ctx, rows[0]!.brainSourceId!);
    });
    expect(withdrawn).toBe(2);
  });

  test("revoking leaves a published QA calibration set alone, and a second revoke turns nothing off again (review)", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, "approved");
    const feedbackId = await insertFeedback(t, { approvedAt: 3, sourceId });
    const qa = await t.run((ctx) =>
      ctx.db.insert("learningDigests", { kind: "qa_calibration", content: "QA rules", sourceCount: 5, feedbackCutoff: 9, model: "m", createdAt: 1 })
    );
    await t.run((ctx) =>
      ctx.db.insert("learningDigestSelections", { kind: "qa_calibration", selectedDigestId: qa, actorKind: "system", action: "select", selectedAt: 1 })
    );
    const style = await insertDigest(t, { cutoff: 3, admitted: [feedbackId] });
    await publish(t, style);
    await admin.mutation(api.brain.revokeSource, { sourceId });
    await admin.mutation(api.brain.revokeSource, { sourceId });
    expect((await t.query(internal.learning.getActiveDigest, { kind: "qa_calibration" }))?._id).toBe(qa);
    const styleSelections = await t.run((ctx) =>
      ctx.db.query("learningDigestSelections").withIndex("by_kind", (q) => q.eq("kind", "draft_style")).collect()
    );
    expect(styleSelections.filter((row) => row.action === "source_withdrawn")).toHaveLength(1);
  });

  test("the one-off pass walks every page (review)", async () => {
    vi.useFakeTimers();
    try {
      const { t } = await setup();
      const revoked = await insertSource(t, "revoked");
      for (let index = 0; index < 150; index += 1) {
        await insertFeedback(t, { approvedAt: 3, sourceId: revoked, linkThroughAuditOnly: true });
      }
      await t.mutation(internal.brain.linkBrainFeedbackSources, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const rows = await t.run((ctx) => ctx.db.query("brainFeedbackQueue").collect());
      expect(rows.filter((row) => row.brainSourceId === revoked && row.withdrawnAt !== undefined)).toHaveLength(150);
    } finally {
      vi.useRealTimers();
    }
  });
});
