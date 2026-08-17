/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type DigestKind = "qa_calibration" | "draft_style";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "learning-admin", role: "admin" });
    await ctx.db.insert("users", { authId: "learning-writer", role: "writer" });
    await ctx.db.insert("users", {
      authId: "learning-manager",
      role: "manager",
    });
  });
  return {
    t,
    admin: t.withIdentity({ subject: "learning-admin" }),
    writer: t.withIdentity({ subject: "learning-writer" }),
    manager: t.withIdentity({ subject: "learning-manager" }),
  };
}

async function insertDigest(
  t: ReturnType<typeof convexTest>,
  kind: DigestKind,
  content: string,
  feedbackCutoff: number,
) {
  return await t.run((ctx) =>
    ctx.db.insert("learningDigests", {
      kind,
      content,
      sourceCount: 5,
      feedbackCutoff,
      model: "test-model",
      createdAt: feedbackCutoff,
    }),
  );
}

describe("governed learning digest publication", () => {
  test("keeps the newest legacy digest active before governance is initialized", async () => {
    const { t } = await setup();
    await insertDigest(t, "draft_style", "older", 1);
    const newestId = await insertDigest(t, "draft_style", "newest", 2);

    const active = await t.query(internal.learning.getActiveDigest, {
      kind: "draft_style",
    });
    expect(active?._id).toBe(newestId);
  });

  test("admin can disable a legacy digest before the first automatic save", async () => {
    const { t, admin } = await setup();
    await insertDigest(t, "qa_calibration", "legacy", 10);

    const selectionId = await admin.mutation(api.learning.selectDigest, {
      kind: "qa_calibration",
      digestId: null,
      expectedSelectionId: null,
      reason: "Immediate kill switch",
    });

    expect(selectionId).not.toBeNull();
    await expect(
      t.query(internal.learning.getActiveDigest, { kind: "qa_calibration" }),
    ).resolves.toBeNull();
    const history = await admin.query(api.learning.getDigestHistory, {
      kind: "qa_calibration",
    });
    expect(history.explicitlyDisabled).toBe(true);
    expect(history.publishedDigestId).toBeNull();
  });

  test("first automatic save freezes legacy guidance and leaves the new row unpublished", async () => {
    const { t } = await setup();
    const legacyId = await insertDigest(t, "qa_calibration", "legacy", 10);
    const candidateId = await t.mutation(internal.learning.saveDigest, {
      kind: "qa_calibration",
      content: "candidate",
      sourceCount: 8,
      feedbackCutoff: 20,
      model: "test-model",
    });

    const active = await t.query(internal.learning.getActiveDigest, {
      kind: "qa_calibration",
    });
    const state = await t.run(async (ctx) => ({
      selection: await ctx.db.query("learningDigestSelections").first(),
      candidate: candidateId ? await ctx.db.get(candidateId) : null,
    }));
    expect(active?._id).toBe(legacyId);
    expect(state.selection).toMatchObject({
      selectedDigestId: legacyId,
      action: "compatibility_freeze",
      actorKind: "system",
    });
    expect(state.candidate?.content).toBe("candidate");
  });

  test("first candidate with no legacy digest freezes guidance as disabled", async () => {
    const { t } = await setup();
    await t.mutation(internal.learning.saveDigest, {
      kind: "draft_style",
      content: "candidate",
      sourceCount: 5,
      feedbackCutoff: 10,
      model: "test-model",
    });

    await expect(
      t.query(internal.learning.getActiveDigest, { kind: "draft_style" }),
    ).resolves.toBeNull();
    const selection = await t.run((ctx) =>
      ctx.db.query("learningDigestSelections").first(),
    );
    expect(selection).toMatchObject({
      selectedDigestId: null,
      action: "compatibility_freeze",
    });
  });

  test("deduplicates candidate saves transactionally by feedback cutoff", async () => {
    const { t } = await setup();
    const args = {
      kind: "draft_style" as const,
      content: "candidate",
      sourceCount: 5,
      feedbackCutoff: 10,
      model: "test-model",
    };
    const first = await t.mutation(internal.learning.saveDigest, args);
    const second = await t.mutation(internal.learning.saveDigest, args);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const count = await t.run(async (ctx) => {
      const rows = [];
      for await (const row of ctx.db.query("learningDigests")) rows.push(row);
      return rows.length;
    });
    expect(count).toBe(1);
  });

  test("admin can publish, disable, and restore an exact older version", async () => {
    const { t, admin } = await setup();
    const firstId = await insertDigest(t, "draft_style", "first", 1);
    const secondId = await insertDigest(t, "draft_style", "second", 2);

    const firstSelectionId = await admin.mutation(api.learning.selectDigest, {
      kind: "draft_style",
      digestId: secondId,
      expectedSelectionId: null,
      reason: "Reviewed and approved",
    });
    expect(
      (
        await t.query(internal.learning.getActiveDigest, {
          kind: "draft_style",
        })
      )?._id,
    ).toBe(secondId);

    const disabledId = await admin.mutation(api.learning.selectDigest, {
      kind: "draft_style",
      digestId: null,
      expectedSelectionId: firstSelectionId,
      reason: "Operational kill switch",
    });
    await expect(
      t.query(internal.learning.getActiveDigest, { kind: "draft_style" }),
    ).resolves.toBeNull();

    await admin.mutation(api.learning.selectDigest, {
      kind: "draft_style",
      digestId: firstId,
      expectedSelectionId: disabledId,
      reason: "Rollback to known-good guidance",
    });
    expect(
      (
        await t.query(internal.learning.getActiveDigest, {
          kind: "draft_style",
        })
      )?._id,
    ).toBe(firstId);
  });

  test("history always includes a published version older than the candidate window", async () => {
    const { t, admin } = await setup();
    const publishedId = await insertDigest(t, "draft_style", "known good", 1);
    const selectionId = await admin.mutation(api.learning.selectDigest, {
      kind: "draft_style",
      digestId: publishedId,
      expectedSelectionId: null,
    });
    for (let i = 2; i <= 25; i += 1) {
      await insertDigest(t, "draft_style", `candidate ${i}`, i);
    }

    const history = await admin.query(api.learning.getDigestHistory, {
      kind: "draft_style",
    });
    expect(selectionId).not.toBeNull();
    expect(history.publishedDigestId).toBe(publishedId);
    expect(history.digests.some((digest) => digest._id === publishedId)).toBe(
      true,
    );
  });

  test("publication is admin-only and protected by optimistic concurrency", async () => {
    const { t, admin, writer, manager } = await setup();
    const digestId = await insertDigest(t, "qa_calibration", "candidate", 1);
    const args = {
      kind: "qa_calibration" as const,
      digestId,
      expectedSelectionId: null,
    };
    await expect(
      writer.mutation(api.learning.selectDigest, args),
    ).rejects.toThrow(/permission|authorized/i);
    await expect(
      manager.mutation(api.learning.selectDigest, args),
    ).rejects.toThrow(/permission|authorized/i);
    const selectionId = await admin.mutation(api.learning.selectDigest, args);
    await expect(
      admin.mutation(api.learning.selectDigest, args),
    ).rejects.toThrow(/changed|refresh/i);
    expect(selectionId).not.toBeNull();
  });

  test("a per-writer digest can never become global guidance", async () => {
    const { t, admin } = await setup();
    const ids = await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", "learning-writer"))
        .unique();
      if (!user) throw new Error("writer fixture missing");
      const digestId = await ctx.db.insert("learningDigests", {
        kind: "draft_style",
        content: "personal",
        sourceCount: 5,
        feedbackCutoff: 1,
        model: "test-model",
        createdAt: 1,
        userId: user._id,
      });
      return { digestId };
    });

    await expect(
      admin.mutation(api.learning.selectDigest, {
        kind: "draft_style",
        digestId: ids.digestId,
        expectedSelectionId: null,
      }),
    ).rejects.toThrow(/personal/i);
    await expect(
      t.query(internal.learning.getActiveDigest, { kind: "draft_style" }),
    ).resolves.toBeNull();
  });
});
