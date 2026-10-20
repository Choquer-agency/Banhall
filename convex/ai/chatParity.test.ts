import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_CONTEXT_LOSS_NOTE,
  CHAT_THINKING,
  CHAT_TOOL_NAMES,
  ChatTurnMeter,
  TurnProgressWriter,
  buildChatTools,
  chatHistoryStartOrder,
  chatTurnNote,
  continuationReasonForFailure,
  toolCallSection,
  watchForStop,
} from "./chatAgentV2";
import { newWebSearchTurn } from "./chatWebSearch";
import { completionReportCounts } from "../lib/completionReport";
import { findDashConnectors } from "../../shared/humanProse";

/** Report chat parity, Phase A (2026-10-19): the engine's pure pieces. */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reasoning summaries", () => {
  it("asks Anthropic for summarized thinking", () => {
    expect(CHAT_THINKING).toEqual({ thinking: { type: "adaptive", display: "summarized" } });
  });
});

describe("the tool list", () => {
  it("is the same whatever the message options", () => {
    const keys = (tools: object) => Object.keys(tools);
    const plain = buildChatTools(false);
    const toggled = buildChatTools(true, true, newWebSearchTurn({ allowed: true }));
    expect(keys(toggled)).toEqual(keys(plain));
    expect(keys(plain)).toEqual([...CHAT_TOOL_NAMES]);
    const descriptions = (tools: Record<string, { description?: string }>) =>
      Object.values(tools).map((tool) => tool.description);
    expect(descriptions(toggled)).toEqual(descriptions(plain));
  });
});

describe("toolCallSection", () => {
  it("reads the Line from fixed input fields only", () => {
    expect(toolCallSection({ section: "244" })).toBe("244");
    expect(toolCallSection({ findings: [{ section: "246" }, { section: "246" }] })).toBe("246");
    expect(toolCallSection({ findings: [{ section: "242" }, { section: "244" }] })).toBeUndefined();
    expect(toolCallSection({ section: "Line 244" })).toBeUndefined();
    expect(toolCallSection('{"section":"244"')).toBeUndefined();
    expect(toolCallSection(null)).toBeUndefined();
  });
});

describe("ChatTurnMeter", () => {
  it("derives the phases and the step's numbers from raw stream events", () => {
    let now = 1_000;
    const updates: unknown[] = [];
    const meter = new ChatTurnMeter((update) => updates.push(update), () => now);
    meter.beginStep("default");
    now = 1_400;
    meter.onRaw({ type: "message_start", message: { usage: { input_tokens: 900, output_tokens: 1 } } });
    now = 1_500;
    meter.onRaw({ type: "content_block_start", content_block: { type: "thinking" } });
    meter.onRaw({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Plan it." } });
    meter.onRaw({ type: "content_block_start", content_block: { type: "tool_use", name: "deviationInventory" } });
    meter.onRaw({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"section":"244"}' } });
    meter.onToolCall("deviationInventory", { section: "244" });
    meter.onRaw({ type: "content_block_start", content_block: { type: "tool_use", name: "madeUpTool" } });
    meter.onRaw({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 300 } });
    now = 2_000;
    meter.onRaw({ type: "message_stop" });
    expect(updates).toEqual([
      { phase: "thinking", step: 1 },
      { phase: "tool", tool: "deviationInventory", step: 1 },
      { phase: "tool", tool: "deviationInventory", section: "244", step: 1 },
    ]);
    expect(meter.current).toMatchObject({
      step: 1, effort: "default", startedAt: 1_000, firstTokenAt: 1_500, endedAt: 2_000,
      stopReason: "tool_use", outputTokens: 300, receivedChars: "Plan it.".length + '{"section":"244"}'.length,
      startUsage: { input_tokens: 900, output_tokens: 1 }, stepFinished: false,
    });
    expect([...meter.toolNames]).toEqual(["deviationInventory"]);
    meter.finishStep();
    expect(meter.current?.stepFinished).toBe(true);

    meter.beginStep("medium");
    meter.onRaw({ type: "content_block_start", content_block: { type: "text" } });
    expect(updates.at(-1)).toEqual({ phase: "writing", step: 2 });
    expect(meter.current).toMatchObject({ step: 2, effort: "medium", receivedChars: 0 });
  });
});

describe("TurnProgressWriter", () => {
  it("writes one phase at a time, skips repeats and keeps only the newest waiting change", async () => {
    let now = 1;
    const written: unknown[] = [];
    let release!: () => void;
    const writer = new TurnProgressWriter(async (progress) => {
      written.push(progress);
      if (written.length === 1) await new Promise<void>((resolve) => { release = resolve; });
    }, () => now);
    writer.set({ phase: "thinking", step: 1 });
    writer.set({ phase: "thinking", step: 1 });
    now = 2;
    writer.set({ phase: "writing", step: 1 });
    now = 3;
    writer.set({ phase: "tool", tool: "proposeBulkEdits", step: 1 });
    await Promise.resolve();
    release();
    await writer.flush();
    expect(written).toEqual([
      { phase: "thinking", step: 1, since: 1 },
      { phase: "tool", tool: "proposeBulkEdits", step: 1, since: 3 },
    ]);
  });

  it("logs a failed write and goes on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const written: unknown[] = [];
    const writer = new TurnProgressWriter(async (progress) => {
      written.push(progress);
      if (written.length === 1) throw new Error("offline");
    }, () => 5);
    writer.set({ phase: "thinking", step: 1 });
    await writer.flush();
    writer.set({ phase: "writing", step: 1 });
    await writer.flush();
    expect(written).toHaveLength(2);
    expect(error).toHaveBeenCalledWith("chat progress could not be written", expect.anything());
  });
});

describe("watchForStop", () => {
  it("checks every interval, one check at a time, and stops once", async () => {
    vi.useFakeTimers();
    const answers = [true, true, false];
    const isActive = vi.fn(async () => answers.shift() ?? false);
    const onStop = vi.fn();
    const end = watchForStop({ intervalMs: 2_000, isActive, onStop });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(isActive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(isActive).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(isActive).toHaveBeenCalledTimes(3);
    expect(onStop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(isActive).toHaveBeenCalledTimes(3);
    end();
  });

  it("keeps watching after a failed check and ends without a call when told", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const isActive = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    const onStop = vi.fn();
    const end = watchForStop({ intervalMs: 2_000, isActive, onStop });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(isActive).toHaveBeenCalledTimes(2);
    end();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(isActive).toHaveBeenCalledTimes(2);
    expect(onStop).not.toHaveBeenCalled();
  });
});

describe("history the model reads", () => {
  const rows = (orders: number[]) => orders.map((order) => ({ order }));

  it("is the whole thread when it fits", () => {
    expect(chatHistoryStartOrder(rows([3, 3, 2, 2, 1, 1, 0]), { recentMessages: 30, complete: true })).toBeUndefined();
  });

  it("starts at the oldest order of the rows read", () => {
    expect(chatHistoryStartOrder(rows([9, 8, 8, 7, 7, 6, 6]), { recentMessages: 5, complete: true })).toBe(7);
    // A probe that stopped short cannot prove the thread fits.
    expect(chatHistoryStartOrder(rows([9, 8, 8]), { recentMessages: 30, complete: false })).toBe(8);
  });

  it("tells the model the options and, when older turns are cut, the fixed sentence", () => {
    expect(chatTurnNote({ allowBrain: false, allowWeb: true, historyCut: false })).toBe(
      "Message options for this message: Brain examples are off, web search is on."
    );
    const cut = chatTurnNote({ allowBrain: true, allowWeb: false, historyCut: true });
    expect(cut.endsWith(`\n${CHAT_CONTEXT_LOSS_NOTE}`)).toBe(true);
    expect(CHAT_CONTEXT_LOSS_NOTE).toBe(
      "Earlier turns of this conversation are not shown to you; if the writer refers to them, say so and ask them to restate what matters."
    );
    expect(findDashConnectors(cut)).toEqual([]);
  });
});

describe("Continue and the Completion Report", () => {
  it("offers Continue after a cut, never after other failures", () => {
    for (const code of ["CHAT_CUT_OFF_TOOL_CALL", "CHAT_THINKING_CUT_OFF", "CHAT_THINKING_CUT_OFF_PARTIAL", "CHAT_REPLY_CUT_OFF"]) {
      expect(continuationReasonForFailure(new Error(code))).toBe("cut_off");
    }
    for (const code of ["CHAT_TIMED_OUT", "CHAT_STOPPED", "CHAT_PROFILE_UNAVAILABLE", "CHAT_INCOMPLETE_RESPONSE"]) {
      expect(continuationReasonForFailure(new Error(code))).toBeNull();
    }
    expect(continuationReasonForFailure("CHAT_REPLY_CUT_OFF")).toBeNull();
  });

  it("counts the Completion Report by status with the ids that need the writer", () => {
    expect(completionReportCounts([
      { id: "r-242-1-1", status: "resolved" },
      { id: "c-242-2-1", status: "blocked" },
      { id: "x-244-1-1", status: "conflicting" },
      { id: "r-244-2-1", status: "blocked" },
    ])).toBe("1 resolved, 2 blocked (c-242-2-1, r-244-2-1), 1 conflicting (x-244-1-1)");
    expect(completionReportCounts([])).toBe("0 resolved, 0 blocked, 0 conflicting");
  });
});
