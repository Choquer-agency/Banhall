/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MAX_STEPS,
  CHAT_MIN_STEP_REMAINING_MS,
  CHAT_RECOVERY_MIN_REMAINING_MS,
  CHAT_REPLY_CUT_OFF_REPLY,
  CHAT_STEP_LIMIT_REPLY,
  chatFailureReply,
} from "./ai/chatAgentV2";

/**
 * Report chat parity, Phase B (2026-10-20), W2, review R1: a long job carries
 * on by itself, end to end. The production chat action, the agent, the AI
 * SDK's Anthropic provider and the tools are real, with automatic continuing
 * on; only `fetch` is stubbed with Anthropic's server-sent events. Fictional
 * data only.
 */

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-chat-auto-continue-sdk";
const DIRECT_URL = "https://api.anthropic.com/v1/messages";

type Body = Record<string, unknown> & { messages: Array<{ role: string; content: unknown }> };
type Event = Record<string, unknown> & { type: string };

function sse(events: Event[]): Response {
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

function messageStart(id: string): Event {
  return {
    type: "message_start",
    message: {
      id, type: "message", role: "assistant", model: "claude-sonnet-5", content: [],
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  };
}

function toolAnswer(id: string, toolUseId: string, json: string, tool = "proposeBulkEdits") {
  return sse([
    messageStart(id),
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: toolUseId, name: tool, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 300 } },
    { type: "message_stop" },
  ]);
}

function textAnswer(id: string, text: string, stop: "end_turn" | "max_tokens" = "end_turn") {
  return sse([
    messageStart(id),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: stop === "max_tokens" ? CHAT_MAX_OUTPUT_TOKENS : 20 },
    },
    { type: "message_stop" },
  ]);
}

function stubAnthropic(answers: Array<() => Response | Promise<Response>>): Body[] {
  const sent: Body[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== DIRECT_URL) throw new Error(`Unexpected URL ${request.url}`);
    sent.push(JSON.parse(await request.text()) as Body);
    const answer = answers[sent.length - 1];
    if (!answer) throw new Error(`Unexpected request ${sent.length}`);
    return answer();
  }));
  return sent;
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const P1 = "Trial 1 described a pressure range.";
const card = JSON.stringify({
  edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope." }],
  findings: [{ id: "c-242-1-1", section: "242", paragraph: 1, kind: "content", status: "resolved", editNumbers: [1] }],
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer", firstName: "Avery", lastName: "Lane" });
    const projectId = await ctx.db.insert("projects", {
      title: "Chain project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "chain-sdk-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [
        heading("Line 242 - Scientific/Technological Uncertainty"), paragraph(P1),
        heading("Line 244 - Work Performed"), paragraph("Work paragraph."),
        heading("Line 246 - Scientific/Technological Advancement"), paragraph("Advancement paragraph."),
      ] }),
      version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    return { userId, projectId, reportId };
  });
  const actor = t.withIdentity({ subject: authId });
  const sent = await actor.mutation(api.chatV2.sendMessage, {
    reportId: ids.reportId, content: "Revise every Line.", newThread: true,
  });
  const run = () =>
    t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, reportId: ids.reportId, userId: ids.userId,
    });
  const turns = () => t.run((ctx) => ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", sent.threadId))
    .collect());
  const messages = async () =>
    (await actor.query(api.chatV2.listMessages, {
      threadId: sent.threadId, paginationOpts: { cursor: null, numItems: 50 }, streamArgs: undefined,
    })).page.sort((a, b) => a.order - b.order || a.stepOrder - b.stepOrder);
  const replies = async () =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()))
      .filter((job) => job.name.includes("streamChatReply"));
  return { t, actor, ...ids, threadId: sent.threadId, promptMessageId: sent.messageId, run, turns, messages, replies };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the time stop", () => {
  test("needs as much of the window as the recovery pass", () => {
    expect(CHAT_MIN_STEP_REMAINING_MS).toBe(150_000);
    expect(CHAT_MIN_STEP_REMAINING_MS).toBe(CHAT_RECOVERY_MIN_REMAINING_MS);
  });
});

describe("a job that carries on by itself", () => {
  test("after the closing note of a step-limit stop, the link's Continue sorts after it and its reply is scheduled", async () => {
    const f = await setup();
    stubAnthropic([
      () => toolAnswer("msg_1", "toolu_card", card),
      ...Array.from({ length: CHAT_MAX_STEPS - 1 }, (_, i) => () =>
        toolAnswer(`msg_${i + 2}`, `toolu_list${i + 2}`, "{}", "deviationInventory")),
    ]);
    await f.run();

    const [first, link] = await f.turns();
    expect(first).toMatchObject({ status: "completed", continuation: { reason: "step_limit" } });
    expect(link).toMatchObject({ status: "queued", origin: "auto_continue", userId: f.userId });

    const messages = await f.messages();
    const note = messages.findIndex((m) => m.role === "assistant" && m.text === CHAT_STEP_LIMIT_REPLY);
    const linkPrompt = messages.findIndex((m) => m.id === link!.promptMessageId);
    expect(note).toBeGreaterThanOrEqual(0);
    // The Continue message comes after the closing note: in order, and in time.
    expect(linkPrompt).toBe(messages.length - 1);
    expect(messages[linkPrompt]).toMatchObject({ role: "user", text: "Continue." });
    expect(messages[linkPrompt]!.order).toBeGreaterThan(messages[note]!.order);
    expect(messages[linkPrompt]!._creationTime).toBeGreaterThanOrEqual(messages[note]!._creationTime);

    const jobs = await f.replies();
    expect(jobs.at(-1)?.args[0]).toMatchObject({
      agentThreadId: f.threadId, promptMessageId: link!.promptMessageId, reportId: f.reportId, userId: f.userId,
    });
    expect(jobs.at(-1)?.args[0]).not.toHaveProperty("allowBrain");
  });

  test("after the failure reply of a cut-off reply that saved a card, the link follows it", async () => {
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubAnthropic([
      () => toolAnswer("msg_1", "toolu_card", card),
      () => textAnswer("msg_2", "A very long answer", "max_tokens"),
    ]);
    await f.run();

    const [first, link] = await f.turns();
    expect(first).toMatchObject({ status: "failed", continuation: { reason: "cut_off" } });
    expect(link).toMatchObject({ status: "queued", origin: "auto_continue" });
    const messages = await f.messages();
    const failure = messages.findIndex((m) => m.role === "assistant" && m.text === CHAT_REPLY_CUT_OFF_REPLY);
    expect(failure).toBeGreaterThanOrEqual(0);
    expect(messages.findIndex((m) => m.id === link!.promptMessageId)).toBe(messages.length - 1);
    expect(failure).toBeLessThan(messages.length - 1);
    expect((await f.replies()).at(-1)?.args[0]).toMatchObject({ promptMessageId: link!.promptMessageId });
  });

  test("a turn stopped by the writer does not chain", async () => {
    const f = await setup();
    stubAnthropic([
      () => toolAnswer("msg_1", "toolu_card", card),
      async () => {
        // The writer presses Stop while the second request runs.
        const [turn] = await f.turns();
        await f.actor.mutation(api.chatV2.abortStreaming, { threadId: f.threadId, order: turn!.order });
        return textAnswer("msg_2", "A very long answer", "max_tokens");
      },
    ]);
    const before = (await f.replies()).length;
    await f.run();

    const turns = await f.turns();
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ status: "aborted" });
    expect(turns[0]!.continuation).toBeUndefined();
    expect((await f.replies()).length).toBe(before);
  });
});

describe("review R1 P2-1: a turn that runs out of time", () => {
  /** The action's time limit fires during the second request. */
  function timeLimitDuringSecondRequest() {
    const timer = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timer.signal);
    return () => {
      timer.abort(new DOMException("The operation timed out.", "TimeoutError"));
      throw new DOMException("The operation was aborted.", "AbortError");
    };
  }

  test("after it saved a card, offers Continue and its job carries on", async () => {
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const expire = timeLimitDuringSecondRequest();
    stubAnthropic([() => toolAnswer("msg_1", "toolu_card", card), expire]);
    await f.run();

    const [first, link] = await f.turns();
    expect(first).toMatchObject({ status: "failed", continuation: { reason: "cut_off" } });
    const texts = (await f.messages()).filter((m) => m.role === "assistant").map((m) => m.text);
    expect(texts).toContain(chatFailureReply(new Error("CHAT_TIMED_OUT")));
    expect(link).toMatchObject({ status: "queued", origin: "auto_continue" });
  });

  test("before it saved any card, offers nothing", async () => {
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const expire = timeLimitDuringSecondRequest();
    stubAnthropic([() => toolAnswer("msg_1", "toolu_list", "{}", "deviationInventory"), expire]);
    await f.run();

    const turns = await f.turns();
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ status: "failed" });
    expect(turns[0]!.continuation).toBeUndefined();
  });
});
