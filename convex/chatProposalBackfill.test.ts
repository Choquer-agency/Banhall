/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * 2026-10-01 (first), alerts triage. Every proposeBulkEdits card was saved
 * without its promptMessageId, so listProposals never returned it. The fix
 * anchors new cards; this suite covers the rows already stored: the backfill
 * that sets their prompt from the turn whose run time holds them, and the
 * defensive read in listProposals that places them the same way.
 */

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-proposal-backfill";
const T0 = Date.parse("2026-09-29T10:00:00.000Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Turn = {
  thread: string;
  prompt: string;
  order: number;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
};

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Backfill project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "backfill-token", createdAt: T0, updatedAt: T0,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: JSON.stringify({ type: "doc", content: [] }),
      version: 1, generatedAt: T0, updatedAt: T0,
    });
    for (const agentThreadId of ["thread-a", "thread-b"]) {
      await ctx.db.insert("agentChatThreads", {
        projectId, reportId, agentThreadId, title: "Chat", createdAt: T0,
      });
    }
    return { projectId, reportId };
  });

  /** A turn row queued at `queuedAt` (its _creationTime), like sendMessage. */
  async function turn(row: Turn) {
    vi.setSystemTime(row.queuedAt);
    await t.run((ctx) =>
      ctx.db.insert("chatTurns", {
        agentThreadId: row.thread,
        promptMessageId: row.prompt,
        order: row.order,
        status: row.endedAt === undefined ? "running" : "completed",
        ...(row.startedAt !== undefined ? { startedAt: row.startedAt } : {}),
        ...(row.endedAt !== undefined ? { endedAt: row.endedAt } : {}),
        stepCount: 1,
      })
    );
  }

  async function proposal(row: {
    thread: string;
    toolCallId: string;
    createdAt: number;
    promptMessageId?: string;
  }): Promise<Id<"chatProposals">> {
    return await t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: row.thread,
        toolCallId: row.toolCallId,
        ...(row.promptMessageId ? { promptMessageId: row.promptMessageId } : {}),
        projectId: ids.projectId,
        reportId: ids.reportId,
        kind: "replacements",
        replacements: [{ find: `Passage ${row.toolCallId}.`, replaceWith: `Revised ${row.toolCallId}.` }],
        requireUniqueTargets: true,
        state: "pending",
        createdAt: row.createdAt,
      })
    );
  }

  const prompts = async () =>
    Object.fromEntries(
      (await t.run((ctx) => ctx.db.query("chatProposals").collect())).map((row) => [
        row.toolCallId,
        row.promptMessageId ?? null,
      ])
    );

  return { t, ...ids, turn, proposal, prompts, actor: t.withIdentity({ subject: authId }) };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/**
 * Thread A: turn p1 runs from T0+1s to T0+1m, turn p2 from T0+2m+1s to
 * T0+4m, and turns p3 and p4 overlap (two turns at once, only possible before
 * the one-turn rule). Thread B has no turns.
 */
async function seed(f: Fixture) {
  await f.turn({ thread: "thread-a", prompt: "p1", order: 1, queuedAt: T0, startedAt: T0 + SECOND, endedAt: T0 + MINUTE });
  await f.turn({ thread: "thread-a", prompt: "p2", order: 2, queuedAt: T0 + 2 * MINUTE, startedAt: T0 + 2 * MINUTE + SECOND, endedAt: T0 + 4 * MINUTE });
  await f.turn({ thread: "thread-a", prompt: "p3", order: 3, queuedAt: T0 + 10 * MINUTE, startedAt: T0 + 10 * MINUTE, endedAt: T0 + 20 * MINUTE });
  await f.turn({ thread: "thread-a", prompt: "p4", order: 4, queuedAt: T0 + 12 * MINUTE, startedAt: T0 + 12 * MINUTE, endedAt: T0 + 14 * MINUTE });
  vi.setSystemTime(T0 + 30 * MINUTE);
  // Twelve bulk cards of turn p1, so the backfill needs two pages of ten.
  for (let i = 0; i < 12; i += 1) {
    await f.proposal({ thread: "thread-a", toolCallId: `in-p1-${i}`, createdAt: T0 + 30 * SECOND + i });
  }
  await f.proposal({ thread: "thread-a", toolCallId: "in-p2", createdAt: T0 + 3 * MINUTE });
  await f.proposal({ thread: "thread-a", toolCallId: "between-turns", createdAt: T0 + 90 * SECOND });
  await f.proposal({ thread: "thread-a", toolCallId: "two-turns", createdAt: T0 + 13 * MINUTE });
  // Same time as turn p1 but another thread: never matched across threads.
  await f.proposal({ thread: "thread-b", toolCallId: "other-thread", createdAt: T0 + 30 * SECOND });
  await f.proposal({ thread: "thread-a", toolCallId: "anchored", createdAt: T0 + 40 * SECOND, promptMessageId: "p1" });
  // A Contextual Research proposal (thread research:<session id>) never has
  // a prompt, so the backfill skips it and counts it apart (review P3-4).
  await f.proposal({ thread: "research:session-1", toolCallId: "research", createdAt: T0 + 30 * SECOND });
}

/** Starts the backfill, runs every scheduled page, returns the logged totals. */
async function runBackfill(f: Fixture, args: { dryRun?: boolean }) {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const first = await f.t.mutation(internal.chatV2.backfillProposalPromptMessageIds, args);
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  const done = info.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("backfillProposalPromptMessageIds"));
  info.mockRestore();
  return { first, done };
}

const IN_P1 = Array.from({ length: 12 }, (_, i) => `in-p1-${i}`);

describe("backfillProposalPromptMessageIds", () => {
  test("a dry run (the default) counts and writes nothing", async () => {
    const f = await setup();
    await seed(f);
    const before = await f.prompts();
    const { first, done } = await runBackfill(f, {});
    expect(first).toEqual({ dryRun: true, done: false, scanned: 10, set: 10, noTurn: 0, ambiguous: 0, research: 0 });
    expect(done).toEqual([
      "backfillProposalPromptMessageIds dry run done: 17 scanned, 13 would be set, 2 with no turn, 1 ambiguous, 1 research skipped",
    ]);
    expect(await f.prompts()).toEqual(before);
  });

  test("sets the prompt from the turn that holds each row, leaves the rest, skips research, and a second run does nothing", async () => {
    const f = await setup();
    await seed(f);
    const { done } = await runBackfill(f, { dryRun: false });
    expect(done).toEqual([
      "backfillProposalPromptMessageIds done: 17 scanned, 13 set, 2 with no turn, 1 ambiguous, 1 research skipped",
    ]);
    expect(await f.prompts()).toEqual({
      ...Object.fromEntries(IN_P1.map((id) => [id, "p1"])),
      "in-p2": "p2",
      "between-turns": null,
      "two-turns": null,
      "other-thread": null,
      anchored: "p1",
      research: null,
    });

    const after = await f.prompts();
    const second = await runBackfill(f, { dryRun: false });
    expect(second.first).toEqual({ dryRun: false, done: true, scanned: 4, set: 0, noTurn: 2, ambiguous: 1, research: 1 });
    expect(second.done).toEqual([
      "backfillProposalPromptMessageIds done: 4 scanned, 0 set, 2 with no turn, 1 ambiguous, 1 research skipped",
    ]);
    expect(await f.prompts()).toEqual(after);
  });

  // PR #24 P2: the scan starts at the card's time, not at the newest turn.
  test("finds a card's turn behind more than 200 newer turns", async () => {
    const f = await setup();
    await f.turn({ thread: "thread-a", prompt: "early", order: 1, queuedAt: T0, startedAt: T0 + SECOND, endedAt: T0 + MINUTE });
    vi.setSystemTime(T0 + 2 * MINUTE);
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 205; i += 1) {
        const at = T0 + 2 * MINUTE + i * MINUTE;
        await ctx.db.insert("chatTurns", {
          agentThreadId: "thread-a", promptMessageId: `later-${i}`, order: i + 2, status: "completed",
          startedAt: at, endedAt: at + 30 * SECOND, stepCount: 1,
        });
      }
    });
    await f.proposal({ thread: "thread-a", toolCallId: "far-back", createdAt: T0 + 30 * SECOND });
    const { done } = await runBackfill(f, { dryRun: false });
    expect(done).toEqual([
      "backfillProposalPromptMessageIds done: 1 scanned, 1 set, 0 with no turn, 0 ambiguous, 0 research skipped",
    ]);
    expect(await f.prompts()).toEqual({ "far-back": "early" });
  });

  test("a turn without both ends holds nothing", async () => {
    const f = await setup();
    await f.turn({ thread: "thread-a", prompt: "queued", order: 1, queuedAt: T0 });
    await f.turn({ thread: "thread-a", prompt: "running", order: 2, queuedAt: T0 + MINUTE, startedAt: T0 + MINUTE });
    vi.setSystemTime(T0 + 5 * MINUTE);
    await f.proposal({ thread: "thread-a", toolCallId: "during-running", createdAt: T0 + 2 * MINUTE });
    const { done } = await runBackfill(f, { dryRun: false });
    expect(done).toEqual([
      "backfillProposalPromptMessageIds done: 1 scanned, 0 set, 1 with no turn, 0 ambiguous, 0 research skipped",
    ]);
    expect(await f.prompts()).toEqual({ "during-running": null });
  });
});

describe("listProposals places rows saved without a prompt", () => {
  test("returns a row a window turn holds, with that turn's prompt, and hides the rest", async () => {
    const f = await setup();
    await seed(f);
    const listed = await f.actor.query(api.chatV2.listProposals, { threadId: "thread-a" });
    expect(Object.fromEntries(listed.map((row) => [row.toolCallId, row.promptMessageId]))).toEqual({
      ...Object.fromEntries(IN_P1.map((id) => [id, "p1"])),
      "in-p2": "p2",
      anchored: "p1",
    });
    // Creation order, as before: placed rows sort with anchored ones.
    const times = listed.map((row) => row._creationTime);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // A window that leaves turn p1 out leaves its rows out too.
    const later = await f.actor.query(api.chatV2.listProposals, { threadId: "thread-a", startOrder: 2 });
    expect(later.map((row) => row.toolCallId)).toEqual(["in-p2"]);
  });

  test("after the backfill the same rows come back through their own prompt", async () => {
    const f = await setup();
    await seed(f);
    const before = await f.actor.query(api.chatV2.listProposals, { threadId: "thread-a" });
    await runBackfill(f, { dryRun: false });
    const after = await f.actor.query(api.chatV2.listProposals, { threadId: "thread-a" });
    expect(after).toEqual(before);
  });
});
