/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { percentiles } from "./aiUsage";

/**
 * Chat parity Phase B (2026-10-20): the admin chat timing report. Numbers
 * only, from the chat's usage rows. Fictional rows.
 */

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.UTC(2026, 9, 20, 12);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { authId: "auth-admin", role: "admin" });
    await ctx.db.insert("users", { authId: "auth-writer", role: "writer" });
    const turn = (agentThreadId: string, order: number, startedAt: number) =>
      ctx.db.insert("chatTurns", {
        agentThreadId, promptMessageId: `prompt-${agentThreadId}-${order}`, order, status: "completed",
        startedAt, endedAt: startedAt + 50_000, stepCount: 1,
      } as never);
    await turn("thread-a", 0, now - 100_000);
    await turn("thread-a", 1, now - 40_000);
    await turn("thread-b", 0, now - 90_000);
    const step = (agentThreadId: string, createdAt: number, effort: string, durationMs: number, firstTokenMs: number, stopReason: string) =>
      ctx.db.insert("aiUsage", {
        agentThreadId, callSite: "chat_v2", model: "claude-sonnet-5", inputTokens: 10, outputTokens: 10,
        costUsd: 0.01, effort, durationMs, firstTokenMs, stopReason, createdAt,
      });
    // Thread A: a turn of 3 steps, then a turn of 1.
    await step("thread-a", now - 99_000, "default", 1_000, 100, "tool_use");
    await step("thread-a", now - 98_000, "medium", 2_000, 200, "tool_use");
    await step("thread-a", now - 97_000, "default", 3_000, 300, "end_turn");
    await step("thread-a", now - 39_000, "default", 4_000, 400, "end_turn");
    // Thread B: one step.
    await step("thread-b", now - 89_000, "default", 5_000, 500, "max_tokens");
    // Another call site is not chat.
    await ctx.db.insert("aiUsage", {
      callSite: "generation:242", model: "m", inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs: 99_999, createdAt: now - 1_000,
    });
  });
  return { t, since: now - 3_600_000 };
}

describe("chatTimingReport", () => {
  test("reports percentiles by effort, stop reasons and steps per turn, numbers only", async () => {
    const { t, since } = await setup();
    const report = await t.withIdentity({ subject: "auth-admin" }).query(api.aiUsage.chatTimingReport, { sinceMs: since });
    expect(report).toEqual({
      since,
      steps: 5,
      truncated: false,
      byEffort: [
        { effort: "default", steps: 4, durationMs: { p50: 3_000, p90: 5_000 }, firstTokenMs: { p50: 300, p90: 500 } },
        { effort: "medium", steps: 1, durationMs: { p50: 2_000, p90: 2_000 }, firstTokenMs: { p50: 200, p90: 200 } },
      ],
      stopReasons: [
        { stopReason: "end_turn", count: 2 },
        { stopReason: "tool_use", count: 2 },
        { stopReason: "max_tokens", count: 1 },
      ],
      stepsPerTurn: [
        { steps: 1, turns: 2 },
        { steps: 3, turns: 1 },
      ],
      turnsCounted: 3,
    });
  });

  test("is for admins only", async () => {
    const { t, since } = await setup();
    await expect(
      t.withIdentity({ subject: "auth-writer" }).query(api.aiUsage.chatTimingReport, { sinceMs: since })
    ).rejects.toThrow();
    await expect(t.query(api.aiUsage.chatTimingReport, { sinceMs: since })).rejects.toThrow();
  });

  test("percentiles are nearest rank, and null with no values", () => {
    expect(percentiles([])).toEqual({ p50: null, p90: null });
    expect(percentiles([5, 1, 4, 2, 3, 6, 7, 8, 9, 10])).toEqual({ p50: 5, p90: 9 });
  });
});
