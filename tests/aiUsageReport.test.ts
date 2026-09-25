import { describe, expect, test } from "vitest";
// @ts-expect-error: plain ESM script without type declarations.
import { isNativeCost, parseRows, summarize } from "../scripts/ai-usage-report.mjs";

const rows = [
  { callSite: "chat_v2", model: "claude-sonnet-5", inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 9_000, cacheCreationInputTokens: 0, costUsd: 1, createdAt: Date.UTC(2026, 8, 1) },
  { callSite: "chat_v2", model: "claude-sonnet-5", inputTokens: 1_000, outputTokens: 100, costUsd: 1, createdAt: Date.UTC(2026, 8, 2) },
  { callSite: "generation:qa", model: "openai/gpt-5.6-sol", inputTokens: 500, outputTokens: 50, costUsd: 0.25, createdAt: Date.UTC(2026, 8, 3) },
];

describe("ai usage report script", () => {
  test("reads JSON lines and JSON arrays", () => {
    const lines = rows.map((row) => JSON.stringify(row)).join("\n");
    expect(parseRows(lines)).toEqual(rows);
    expect(parseRows(JSON.stringify(rows))).toEqual(rows);
  });

  test("groups by call site with cache hit ratio and cost share", () => {
    const summary = summarize(rows, { by: "callSite", reprice: false });
    const chat = summary.groups.find((group: { key: string }) => group.key === "chat_v2");
    expect(chat).toMatchObject({ calls: 2, cacheReadInputTokens: 9_000, costUsd: 2 });
    expect(chat.cacheHitRatio).toBeCloseTo(9_000 / 11_000, 10);
    expect(summary.totals.costUsd).toBeCloseTo(2.25, 10);
    expect(summary.groups[0].key).toBe("chat_v2");
  });

  test("reprices estimated rows only and honours the date window", () => {
    const summary = summarize(rows, { by: "model", reprice: true, since: "2026-09-02" });
    const sonnet = summary.groups.find((group: { key: string }) => group.key === "claude-sonnet-5");
    expect(sonnet.calls).toBe(1);
    expect(sonnet.costUsd).toBeCloseTo((1_000 * 2 + 100 * 10) / 1_000_000, 12);
    const gateway = summary.groups.find((group: { key: string }) => group.key === "openai/gpt-5.6-sol");
    expect(gateway.costUsd).toBe(0.25);
    expect(isNativeCost({ model: "claude-sonnet-5", costSource: "native" })).toBe(true);
    expect(isNativeCost({ model: "vendor/model" })).toBe(true);
    expect(isNativeCost({ model: "claude-sonnet-5" })).toBe(false);
  });
});
