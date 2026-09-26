/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import crons from "./crons";
import { round2Api, round2Internal } from "./lib/round2Api";
import { notify, type NotifyInput } from "./lib/notify";
import {
  NOTIFICATION_PRUNE_BATCH,
  NOTIFICATION_RECENT_LIMIT,
  NOTIFICATION_RECENT_WINDOW_MS,
  NOTIFICATION_RETENTION_MS,
} from "./notifications";
import {
  AI_NOTIFICATION_KINDS,
  NOTIFICATION_KINDS,
  NOTIFICATION_SETTING_KEYS,
  isAiNotificationKind,
  notificationCopy,
  settingKeyForKind,
} from "../shared/notifications";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 26, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => ({
    meId: await ctx.db.insert("users", { authId: "n-me", role: "writer", firstName: "Mia" }),
    otherId: await ctx.db.insert("users", { authId: "n-other", role: "admin", firstName: "Ola" }),
    rolelessId: await ctx.db.insert("users", { authId: "n-roleless", firstName: "Rue" }),
    anonymousId: await ctx.db.insert("users", { authId: "n-anon", role: "writer", isAnonymous: true }),
  }));
  return {
    t,
    ...ids,
    me: t.withIdentity({ subject: "n-me" }),
    other: t.withIdentity({ subject: "n-other" }),
    roleless: t.withIdentity({ subject: "n-roleless" }),
    anonymous: t.withIdentity({ subject: "n-anon" }),
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

function input(userId: Id<"users">, overrides: Partial<NotifyInput> = {}): NotifyInput {
  return {
    userId,
    kind: "handoff",
    title: "Helios is with you",
    body: "Drafting. Handed off by Ola.",
    href: "/project/abc",
    dedupeKey: `key-${Math.random()}`,
    ...overrides,
  };
}

const send = (f: Fixture, value: NotifyInput) => f.t.run((ctx) => notify(ctx, value));

const rowsFor = (f: Fixture, userId: Id<"users">) =>
  f.t.run((ctx) =>
    ctx.db.query("notifications").withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId)).take(500)
  );

describe("shared/notifications", () => {
  it("maps every kind to its own settings key", () => {
    expect(NOTIFICATION_KINDS.map(settingKeyForKind)).toEqual([...NOTIFICATION_SETTING_KEYS]);
    expect(AI_NOTIFICATION_KINDS).toEqual(["ideas_ready", "draft_ready", "qa_finished"]);
    expect(NOTIFICATION_KINDS.filter(isAiNotificationKind)).toEqual([...AI_NOTIFICATION_KINDS]);
  });

  it("builds the spec copy with plain hyphens only", () => {
    const all = [
      notificationCopy.ideasReady({ step: "Uncertainties", project: "Helios" }),
      notificationCopy.draftReady({ project: "Helios" }),
      notificationCopy.qaFinished({ project: "Helios", score: 86 }),
      notificationCopy.handoff({ project: "Helios", stage: "Internal review", name: "Ola Admin" }),
      notificationCopy.inviteAccepted({ name: "Rue Smith", role: "Manager" }),
    ];
    expect(all).toEqual([
      { title: "Ideas are ready for Uncertainties", body: "Helios. Opens the Plan tab on that step." },
      { title: "Your draft is ready", body: "Helios. QA is checking it." },
      { title: "QA finished", body: "Helios, score 86." },
      { title: "Helios is with you", body: "Internal review. Handed off by Ola Admin." },
      { title: "Rue Smith joined Banhall", body: "They accepted your invite as Manager." },
    ]);
    expect(JSON.stringify(all)).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("notify", () => {
  it("inserts one row with its fields and the current time", async () => {
    const f = await setup();
    const id = await send(f, input(f.meId, { dedupeKey: "handoff:1" }));
    expect(id).not.toBeNull();
    const [row] = await rowsFor(f, f.meId);
    expect(row).toMatchObject({
      _id: id, userId: f.meId, kind: "handoff", title: "Helios is with you",
      body: "Drafting. Handed off by Ola.", href: "/project/abc", dedupeKey: "handoff:1", createdAt: START,
    });
    expect(row.seenAt).toBeUndefined();
  });

  it("skips a kind the recipient switched off, and only that kind", async () => {
    const f = await setup();
    await f.me.mutation(round2Api.notifications.setSetting, { key: "handoff", value: false });
    expect(await send(f, input(f.meId, { kind: "handoff" }))).toBeNull();
    expect(await send(f, input(f.meId, { kind: "draft_ready" }))).not.toBeNull();
    await f.me.mutation(round2Api.notifications.setSetting, { key: "handoff", value: true });
    expect(await send(f, input(f.meId, { kind: "handoff" }))).not.toBeNull();
    expect((await rowsFor(f, f.meId)).map((row) => row.kind).sort()).toEqual(["draft_ready", "handoff"]);
  });

  it("skips a missing, roleless or anonymous recipient", async () => {
    const f = await setup();
    const goneId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("users", { authId: "n-gone", role: "writer" });
      await ctx.db.delete(id);
      return id;
    });
    expect(await send(f, input(goneId))).toBeNull();
    expect(await send(f, input(f.rolelessId))).toBeNull();
    expect(await send(f, input(f.anonymousId))).toBeNull();
    expect(await rowsFor(f, f.rolelessId)).toEqual([]);
    expect(await rowsFor(f, f.anonymousId)).toEqual([]);
  });

  it("writes one row per dedupe key", async () => {
    const f = await setup();
    expect(await send(f, input(f.meId, { dedupeKey: "same" }))).not.toBeNull();
    expect(await send(f, input(f.meId, { dedupeKey: "same", title: "Again" }))).toBeNull();
    expect(await rowsFor(f, f.meId)).toHaveLength(1);
  });

  it("cuts long copy and refuses a link that leaves the app", async () => {
    const f = await setup();
    await send(f, input(f.meId, { title: "t".repeat(300), body: "b".repeat(900) }));
    const [row] = await rowsFor(f, f.meId);
    expect(row.title).toHaveLength(200);
    expect(row.body).toHaveLength(500);
    await expect(send(f, input(f.meId, { href: "https://evil.example" }))).rejects.toThrow(/app path/);
    await expect(send(f, input(f.meId, { href: "//evil.example" }))).rejects.toThrow(/app path/);
  });
});

describe("notifications.listRecent", () => {
  it("returns only the caller's rows, newest first", async () => {
    const f = await setup();
    await send(f, input(f.meId, { title: "Mine 1" }));
    vi.advanceTimersByTime(1000);
    await send(f, input(f.otherId, { title: "Theirs" }));
    vi.advanceTimersByTime(1000);
    await send(f, input(f.meId, { title: "Mine 2" }));
    const mine = await f.me.query(round2Api.notifications.listRecent, {});
    expect(mine.map((row) => row.title)).toEqual(["Mine 2", "Mine 1"]);
    expect(mine[0]).not.toHaveProperty("userId");
    expect(mine[0]).not.toHaveProperty("dedupeKey");
    expect((await f.other.query(round2Api.notifications.listRecent, {})).map((row) => row.title)).toEqual(["Theirs"]);
  });

  it("keeps to the last 7 days and at most 20 rows", async () => {
    const f = await setup();
    await send(f, input(f.meId, { title: "old" }));
    vi.advanceTimersByTime(NOTIFICATION_RECENT_WINDOW_MS + 1);
    for (let i = 0; i < NOTIFICATION_RECENT_LIMIT + 5; i += 1) {
      await send(f, input(f.meId, { title: `recent ${i}` }));
      vi.advanceTimersByTime(10);
    }
    const rows = await f.me.query(round2Api.notifications.listRecent, {});
    expect(rows).toHaveLength(NOTIFICATION_RECENT_LIMIT);
    expect(rows[0].title).toBe(`recent ${NOTIFICATION_RECENT_LIMIT + 4}`);
    expect(rows.at(-1)?.title).toBe("recent 5");
    expect(rows.map((row) => row.title)).not.toContain("old");
  });

  it("returns an empty list to signed-out, anonymous and roleless callers", async () => {
    const f = await setup();
    await send(f, input(f.meId));
    expect(await f.t.query(round2Api.notifications.listRecent, {})).toEqual([]);
    expect(await f.anonymous.query(round2Api.notifications.listRecent, {})).toEqual([]);
    expect(await f.roleless.query(round2Api.notifications.listRecent, {})).toEqual([]);
  });
});

describe("notifications.markSeen", () => {
  it("marks the caller's rows once and keeps the first seenAt", async () => {
    const f = await setup();
    const a = (await send(f, input(f.meId)))!;
    const b = (await send(f, input(f.meId)))!;
    await f.me.mutation(round2Api.notifications.markSeen, { ids: [a] });
    vi.advanceTimersByTime(5000);
    await f.me.mutation(round2Api.notifications.markSeen, { ids: [a, b, a] });
    const rows = await f.me.query(round2Api.notifications.listRecent, {});
    const seen = Object.fromEntries(rows.map((row) => [row._id, row.seenAt]));
    expect(seen[a]).toBe(START);
    expect(seen[b]).toBe(START + 5000);
  });

  it("refuses the whole call when any id is someone else's, before writing", async () => {
    const f = await setup();
    const mine = (await send(f, input(f.meId)))!;
    const theirs = (await send(f, input(f.otherId)))!;
    await expect(
      f.me.mutation(round2Api.notifications.markSeen, { ids: [mine, theirs] })
    ).rejects.toThrow(/your own notifications/);
    const rows = await f.t.run(async (ctx) => [await ctx.db.get(mine), await ctx.db.get(theirs)]);
    expect(rows.map((row) => row?.seenAt)).toEqual([undefined, undefined]);
  });

  it("skips ids that no longer exist", async () => {
    const f = await setup();
    const gone = (await send(f, input(f.meId)))!;
    await f.t.run((ctx) => ctx.db.delete(gone));
    await expect(f.me.mutation(round2Api.notifications.markSeen, { ids: [gone] })).resolves.toBeNull();
  });

  it("accepts at most 50 ids", async () => {
    const f = await setup();
    const id = (await send(f, input(f.meId)))!;
    await expect(
      f.me.mutation(round2Api.notifications.markSeen, { ids: Array.from({ length: 51 }, () => id) })
    ).rejects.toThrow(/at most 50/);
  });

  it("refuses signed-out, anonymous and roleless callers", async () => {
    const f = await setup();
    const id = (await send(f, input(f.meId)))!;
    await expect(f.t.mutation(round2Api.notifications.markSeen, { ids: [id] })).rejects.toThrow(/Authentication required/);
    await expect(f.anonymous.mutation(round2Api.notifications.markSeen, { ids: [id] })).rejects.toThrow(/Authentication required/);
    await expect(f.roleless.mutation(round2Api.notifications.markSeen, { ids: [id] })).rejects.toThrow(/active internal role/);
  });
});

describe("notification settings", () => {
  const allOn = { ideasReady: true, draftReady: true, qaFinished: true, handoff: true, inviteAccepted: true };

  it("defaults every switch on, signed in or not", async () => {
    const f = await setup();
    expect(await f.me.query(round2Api.notifications.getSettings, {})).toEqual(allOn);
    expect(await f.t.query(round2Api.notifications.getSettings, {})).toEqual(allOn);
    expect(await f.roleless.query(round2Api.notifications.getSettings, {})).toEqual(allOn);
  });

  it("upserts one row per person and never touches anyone else's", async () => {
    const f = await setup();
    await f.me.mutation(round2Api.notifications.setSetting, { key: "qaFinished", value: false });
    await f.me.mutation(round2Api.notifications.setSetting, { key: "inviteAccepted", value: false });
    await f.me.mutation(round2Api.notifications.setSetting, { key: "inviteAccepted", value: true });
    expect(await f.me.query(round2Api.notifications.getSettings, {})).toEqual({ ...allOn, qaFinished: false });
    expect(await f.other.query(round2Api.notifications.getSettings, {})).toEqual(allOn);
    const rows = await f.t.run((ctx) =>
      ctx.db.query("notificationSettings").withIndex("by_userId", (q) => q.eq("userId", f.meId)).take(5)
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses signed-out, anonymous and roleless callers", async () => {
    const f = await setup();
    const args = { key: "handoff" as const, value: false };
    await expect(f.t.mutation(round2Api.notifications.setSetting, args)).rejects.toThrow(/Authentication required/);
    await expect(f.anonymous.mutation(round2Api.notifications.setSetting, args)).rejects.toThrow(/Authentication required/);
    await expect(f.roleless.mutation(round2Api.notifications.setSetting, args)).rejects.toThrow(/active internal role/);
  });
});

describe("notifications.pruneOld", () => {
  it("deletes rows older than 30 days in batches of 200 and keeps newer ones", async () => {
    const f = await setup();
    const oldCount = NOTIFICATION_PRUNE_BATCH * 2 + 17;
    await f.t.run(async (ctx) => {
      for (let i = 0; i < oldCount; i += 1) {
        await notify(ctx, input(f.meId, { dedupeKey: `old-${i}` }));
      }
    });
    vi.advanceTimersByTime(NOTIFICATION_RETENTION_MS - DAY);
    const fresh = (await send(f, input(f.meId, { dedupeKey: "fresh" })))!;
    vi.advanceTimersByTime(DAY + 1);

    const first = await f.t.mutation(round2Internal.notifications.pruneOld, {});
    expect(first).toBe(NOTIFICATION_PRUNE_BATCH);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await rowsFor(f, f.meId);
    expect(left.map((row) => row._id)).toEqual([fresh]);
  });

  it("runs every day", () => {
    const jobs = (crons as unknown as { crons: Record<string, { name: string; schedule: { type: string; cron?: string } }> }).crons;
    expect(jobs["prune notifications"]?.name).toBe("notifications:pruneOld");
    expect(jobs["prune notifications"]?.schedule).toMatchObject({ type: "cron", cron: "10 10 * * *" });
  });
});
