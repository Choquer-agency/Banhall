/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { saveMessage } from "@convex-dev/agent";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  CHAT_BRAIN_OFF,
  CHAT_CONTEXT_LOSS_NOTE,
  CHAT_MAX_OUTPUT_TOKENS,
  CHAT_MAX_STEPS,
  CHAT_STOP_POLL_MS,
  chatFailureReply,
  reportChatAgent,
} from "./ai/chatAgentV2";

/**
 * Report chat parity, Phase A (2026-10-19), at the real request/response
 * boundary: the production chat action (`streamChatReply`), the agent, the AI
 * SDK's Anthropic provider and the tools are real; only `fetch` is stubbed
 * with Anthropic's server-sent events (the harness of chatBulkSplit.sdk.test.ts).
 * Every name and text here is fictional.
 */

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-chat-parity";
const DIRECT_URL = "https://api.anthropic.com/v1/messages";

type Body = Record<string, unknown> & {
  tools?: unknown;
  system?: unknown;
  thinking?: unknown;
  messages: Array<{ role: string; content: unknown }>;
};
type Event = Record<string, unknown> & { type: string };

const encodeEvent = (event: Event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

function sse(events: Event[]): Response {
  return new Response(events.map(encodeEvent).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
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

/** A thinking block with an optional summary, then its signature. */
const thinking = (id: string, summary = ""): Event[] => [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  ...(summary ? [{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: summary } }] : []),
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: `sig-${id}` } },
  { type: "content_block_stop", index: 0 },
];

function toolAnswer(id: string, toolUseId: string, tool: string, input: unknown, summary = ""): Response {
  return sse([
    messageStart(id),
    ...thinking(id, summary),
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: toolUseId, name: tool, input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 300 } },
    { type: "message_stop" },
  ]);
}

function textAnswer(id: string, text: string, options: { stop?: "end_turn" | "max_tokens"; summary?: string } = {}) {
  const stop = options.stop ?? "end_turn";
  const offset = options.summary ? 1 : 0;
  return sse([
    messageStart(id),
    ...(options.summary ? thinking(id, options.summary) : []),
    { type: "content_block_start", index: offset, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: offset, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: offset },
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: stop === "max_tokens" ? CHAT_MAX_OUTPUT_TOKENS : 20 },
    },
    { type: "message_stop" },
  ]);
}

/** A step that spends the whole output limit thinking: no tool call, no text. */
function thinkingOnlyAnswer(id: string, summary = "") {
  return sse([
    messageStart(id),
    ...thinking(id, summary),
    {
      type: "message_delta",
      delta: { stop_reason: "max_tokens", stop_sequence: null },
      usage: { output_tokens: CHAT_MAX_OUTPUT_TOKENS },
    },
    { type: "message_stop" },
  ]);
}

/**
 * A step that is still thinking: the summary so far, then nothing until the
 * request is aborted, when the body fails as `fetch` does.
 */
function stillThinking(id: string, summary: string, signal: AbortSignal | null | undefined): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of [
        messageStart(id),
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: summary } },
      ]) {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      }
      const fail = () => controller.error(new DOMException("The operation was aborted.", "AbortError"));
      if (signal?.aborted) fail();
      else signal?.addEventListener("abort", fail, { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

type Answer = (signal: AbortSignal | null | undefined) => Response | Promise<Response>;

/** Answers each Anthropic request with the next answer; anything else fails the request. */
function stubAnthropic(answers: Answer[]): Body[] {
  const sent: Body[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== DIRECT_URL) {
      // The Brain's embedding call, when a test reaches it: an outage.
      return new Response("unavailable", { status: 503 });
    }
    sent.push(JSON.parse(await request.text()) as Body);
    const answer = answers[sent.length - 1];
    if (!answer) throw new Error(`Unexpected request ${sent.length}`);
    return answer(init?.signal);
  }));
  return sent;
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const P1 = "Trial 1 described a pressure range.";
const P244 = "The team rebuilt the rig in March.";

async function setup(options: {
  notes?: Array<{ section: "242" | "244" | "246"; paragraphIndex: number }>;
  historyExchanges?: number;
  allowBrain?: boolean;
  allowWeb?: boolean;
} = {}) {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Parity project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "parity-token", createdAt: now, updatedAt: now,
    });
    let generationId: Id<"generations"> | undefined;
    if (options.notes) {
      const transcriptId = await ctx.db.insert("transcripts", { projectId, content: "Interview content", createdAt: now });
      generationId = await ctx.db.insert("generations", {
        projectId, transcriptId, status: "completed", candidateMode: "single", startedAt: now,
      });
      for (const note of options.notes) {
        await ctx.db.insert("complianceNotes", {
          projectId, generationId, section: note.section, paragraphIndex: note.paragraphIndex,
          source: "deterministic", instruction: "Call the range the operating envelope.",
          outcome: "not_applied", tier: "conflict", reason: 'the paragraph still says "range"', repaired: false,
        });
      }
    }
    const reportId = await ctx.db.insert("reports", {
      projectId,
      ...(generationId ? { generationId } : {}),
      content: JSON.stringify({ type: "doc", content: [
        heading("Line 242 - Scientific/Technological Uncertainty"), paragraph(P1),
        heading("Line 244 - Work Performed"), paragraph(P244),
        heading("Line 246 - Scientific/Technological Advancement"), paragraph("Advancement paragraph."),
      ] }),
      version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    let threadId: string | undefined;
    if (options.historyExchanges) {
      threadId = (await reportChatAgent.createThread(ctx, { userId })).threadId;
      await ctx.db.insert("agentChatThreads", {
        projectId, reportId, agentThreadId: threadId, title: "Chat", createdAt: now,
      });
      for (let i = 0; i < options.historyExchanges; i += 1) {
        const { messageId } = await saveMessage(ctx, components.agent, {
          threadId, userId, message: { role: "user", content: `Earlier question ${i}.` },
        });
        await saveMessage(ctx, components.agent, {
          threadId, promptMessageId: messageId, message: { role: "assistant", content: `Earlier answer ${i}.` },
        });
      }
    }
    return { userId, projectId, reportId, threadId };
  });
  const actor = t.withIdentity({ subject: authId });
  const sent = await actor.mutation(api.chatV2.sendMessage, {
    reportId: ids.reportId,
    content: "Address each itemized deviation.",
    ...(ids.threadId ? { threadId: ids.threadId } : { newThread: true }),
    ...(options.allowBrain ? { allowBrain: true } : {}),
    ...(options.allowWeb ? { allowWeb: true } : {}),
  });
  const run = () =>
    t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, reportId: ids.reportId, userId: ids.userId,
      ...(options.allowBrain ? { allowBrain: true } : {}),
      ...(options.allowWeb ? { allowWeb: true } : {}),
    });
  const turn = () => t.run(async (ctx) => (await ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
      q.eq("agentThreadId", sent.threadId).eq("promptMessageId", sent.messageId))
    .unique())!);
  const messages = async () =>
    (await actor.query(api.chatV2.listMessages, {
      threadId: sent.threadId, paginationOpts: { cursor: null, numItems: 50 }, streamArgs: undefined,
    })).page;
  const usageRows = async () => {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return (await t.run((ctx) => ctx.db.query("aiUsage").collect())).filter((row) => row.callSite === "chat_v2");
  };
  return { t, actor, ...ids, threadId: sent.threadId, promptMessageId: sent.messageId, run, turn, messages, usageRows };
}

function toolResult(body: Body, toolUseId: string): Record<string, unknown> | undefined {
  for (const message of body.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block.type === "tool_result" && block.tool_use_id === toolUseId) return block;
    }
  }
  return undefined;
}

const lastUserText = (body: Body) => JSON.stringify(body.messages.at(-1));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Stop while the model thinks", () => {
  // Real timers: the watcher's check runs from the action's own timer, as in
  // a deployment. Fake timers would run it from the test's context instead.
  test("aborts the request within one poll, logs one partial usage row and writes no failure message", async () => {
    vi.useRealTimers();
    const f = await setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let requested!: () => void;
    const firstRequest = new Promise<void>((resolve) => { requested = resolve; });
    let abortedAt: number | undefined;
    const sent = stubAnthropic([
      (signal) => {
        signal?.addEventListener("abort", () => { abortedAt = performance.now(); });
        requested();
        return stillThinking("msg_1", "Planning the Line 244 revision.", signal);
      },
    ]);
    const running = f.run();
    await firstRequest;
    const { order } = await f.turn();
    await f.actor.mutation(api.chatV2.abortStreaming, { threadId: f.threadId, order });
    const stoppedAt = performance.now();
    // The agent alone would never notice: a thinking step writes no delta.
    // The watcher's next check aborts the request.
    await running;
    expect(abortedAt).toBeDefined();
    expect(abortedAt! - stoppedAt).toBeLessThanOrEqual(CHAT_STOP_POLL_MS + 500);

    expect(sent).toHaveLength(1);
    const turn = await f.turn();
    expect(turn.status).toBe("aborted");
    expect(turn.continuation).toBeUndefined();
    const texts = (await f.messages()).filter((m) => m.role === "assistant").map((m) => m.text);
    for (const failure of ["CHAT_TIMED_OUT", "", "CHAT_STOPPED"].map((code) => chatFailureReply(new Error(code)))) {
      expect(texts).not.toContain(failure);
    }
    expect(error.mock.calls.filter((call) => call[0] === "report chat response failed")).toEqual([]);
    expect(info.mock.calls.some((call) => call[0] === "chat turn stopped by the writer")).toBe(true);

    // One row for the one billed request: its input as message_start said,
    // its output estimated from the summary received.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await f.t.finishAllScheduledFunctions(() => {});
    const rows = (await f.t.run((ctx) => ctx.db.query("aiUsage").collect())).filter((row) => row.callSite === "chat_v2");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      partial: true,
      stopReason: "aborted",
      inputTokens: 900,
      outputTokens: Math.ceil("Planning the Line 244 revision.".length / 3),
      effort: "default",
    });
  });
});

describe("one tool list whatever the message options", () => {
  test("sends identical tools and system bytes with and without Brain examples and web search", async () => {
    const plain = await setup();
    const plainSent = stubAnthropic([() => textAnswer("msg_1", "Answer.")]);
    await plain.run();

    const toggled = await setup({ allowBrain: true, allowWeb: true });
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
    const toggledSent = stubAnthropic([() => textAnswer("msg_1", "Answer.")]);
    await toggled.run();

    expect(plainSent).toHaveLength(1);
    expect(toggledSent).toHaveLength(1);
    const names = (body: Body) => (body.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names(plainSent[0]!)).toEqual([
      "proposeEdit", "proposeReplacements", "proposeBulkEdits", "deviationInventory",
      "compareReferencePd", "highlightPassages", "searchBrain", "searchWeb",
    ]);
    expect(JSON.stringify(toggledSent[0]!.tools)).toBe(JSON.stringify(plainSent[0]!.tools));
    expect(JSON.stringify(toggledSent[0]!.system)).toBe(JSON.stringify(plainSent[0]!.system));
    // The options reach the model in the per-turn note after the evidence.
    expect(lastUserText(plainSent[0]!)).toContain("Brain examples are off, web search is off.");
    expect(lastUserText(toggledSent[0]!)).toContain("Brain examples are on, web search is on.");
    // Not in the cached head: the first block of the first message.
    const head = (body: Body) => JSON.stringify((body.messages[0]!.content as unknown[])[0]);
    expect(head(plainSent[0]!)).toContain("EVIDENCE FOR THIS TURN");
    expect(head(plainSent[0]!)).not.toContain("Message options");
  });

  test("a searchBrain call without Brain examples searches nothing and says how to turn them on", async () => {
    const f = await setup();
    const sent = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_brain", "searchBrain", { query: "uncertainty framing" }),
      () => textAnswer("msg_2", "Brain examples are off for this message."),
    ]);
    await f.run();
    expect(sent).toHaveLength(2);
    expect(toolResult(sent[1]!, "toolu_brain")?.content).toBe(CHAT_BRAIN_OFF);
    expect((await f.turn()).brainSearchedAt).toBeUndefined();
  });
});

describe("thinking summaries", () => {
  test("requests summaries, keeps the signature between steps and shows the summary without it", async () => {
    const f = await setup();
    const sent = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv", "deviationInventory", { section: "242" }, "Checks complete."),
      () => textAnswer("msg_2", "Line 242 has one paragraph."),
    ]);
    await f.run();

    expect(sent).toHaveLength(2);
    expect(sent[0]!.thinking).toEqual({ type: "adaptive", display: "summarized" });
    // preserveReasoningSignature: the summary ends on punctuation and still
    // goes back with its signature.
    const replayed = sent[1]!.messages
      .flatMap((message) => (Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : []))
      .find((block) => block.type === "thinking");
    expect(replayed).toMatchObject({ type: "thinking", thinking: "Checks complete.", signature: "sig-msg_1" });

    const reply = (await f.messages()).find((message) => message.role === "assistant");
    expect(reply?.parts).toContainEqual(expect.objectContaining({ type: "reasoning", text: "Checks complete." }));
    expect(JSON.stringify(await f.messages())).not.toContain("sig-msg_1");
  });

  test("drops the summaries written after a Brain search and records the search on the turn", async () => {
    const f = await setup({ allowBrain: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_brain", "searchBrain", { query: "uncertainty framing" }, "Before the Brain search."),
      () => textAnswer("msg_2", "Here is how others framed it.", { summary: "PRIVATE_AFTER_BRAIN_SUMMARY" }),
    ]);
    await f.run();

    expect(sent).toHaveLength(2);
    expect((await f.turn()).brainSearchedAt).toBeDefined();
    const visible = JSON.stringify(await f.messages());
    expect(visible).toContain("Before the Brain search.");
    expect(visible).not.toContain("PRIVATE_AFTER_BRAIN_SUMMARY");
    expect(visible).toContain("Here is how others framed it.");
  });

  test("a step that only thought, summary included, is still left out of the recovery pass", async () => {
    const f = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const sent = stubAnthropic([
      () => thinkingOnlyAnswer("msg_1", "SUMMARY_OF_A_STEP_THAT_ONLY_THOUGHT"),
      () => textAnswer("msg_2", "Proposed nothing yet; Line 242 needs a decision."),
    ]);
    await f.run();

    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[1]!.messages)).not.toContain("SUMMARY_OF_A_STEP_THAT_ONLY_THOUGHT");
    expect(JSON.stringify(sent[1]!.messages)).not.toContain("sig-msg_1");
    const turn = await f.turn();
    expect(turn.status).toBe("completed");
    expect(turn.progress).toMatchObject({ phase: "writing", step: 2 });
  });
});

describe("progress and measurement", () => {
  test("writes each phase while the turn runs and records each step's numbers on its usage row", async () => {
    const f = await setup();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const t0 = Date.now();
    const seen: Array<unknown> = [];
    const sent = stubAnthropic([
      async () => {
        seen.push((await f.turn()).progress);
        vi.setSystemTime(t0 + 700);
        return toolAnswer("msg_1", "toolu_inv", "deviationInventory", { section: "244" });
      },
      async () => {
        seen.push((await f.turn()).progress);
        vi.setSystemTime(t0 + 1_000);
        return textAnswer("msg_2", "Line 244 has one paragraph.");
      },
    ]);
    await f.run();

    expect(sent).toHaveLength(2);
    expect(seen[0]).toEqual({ phase: "reading", step: 0, since: t0 });
    expect(seen[1]).toEqual({ phase: "tool", tool: "deviationInventory", section: "244", step: 1, since: t0 + 700 });
    const turn = await f.turn();
    expect(turn.status).toBe("completed");
    expect(turn.progress).toEqual({ phase: "writing", step: 2, since: t0 + 1_000 });

    const rows = (await f.usageRows()).sort((left, right) => (left.durationMs ?? 0) - (right.durationMs ?? 0));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ durationMs: 300, firstTokenMs: 300, stopReason: "end_turn", effort: "medium" });
    expect(rows[1]).toMatchObject({ durationMs: 700, firstTokenMs: 700, stopReason: "tool_use", effort: "default" });
    expect(rows.every((row) => row.partial === undefined)).toBe(true);

    const timing = info.mock.calls.filter((call) => call[0] === "chat step timing").map((call) => call[1]);
    expect(timing).toEqual([
      { threadId: f.threadId, step: 1, durationMs: 700, firstTokenMs: 700, inputTokens: 900, outputTokens: 300, reasoningTokens: null },
      { threadId: f.threadId, step: 2, durationMs: 300, firstTokenMs: 300, inputTokens: 900, outputTokens: 20, reasoningTokens: null },
    ]);
    // Numbers only: no report text in the line.
    expect(JSON.stringify(timing)).not.toContain("paragraph");
  });

  test("a progress write after the turn ended is refused", async () => {
    const f = await setup();
    stubAnthropic([() => textAnswer("msg_1", "Answer.")]);
    await f.run();
    const before = (await f.turn()).progress;
    const written = await f.t.mutation(internal.chatV2.markTurnProgress, {
      agentThreadId: f.threadId, promptMessageId: f.promptMessageId,
      progress: { phase: "thinking", step: 9, since: 1 },
    });
    expect(written).toBe(false);
    expect((await f.turn()).progress).toEqual(before);
  });
});

describe("the Continue offer", () => {
  test("after a Line is revised, offers the next Line that still holds Deviations", async () => {
    const f = await setup({ notes: [{ section: "242", paragraphIndex: 0 }, { section: "244", paragraphIndex: 0 }] });
    const sent = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv", "deviationInventory", { section: "242" }),
      () => {
        const listed = JSON.stringify(toolResult(sent[1]!, "toolu_inv"));
        const id = /r-242-\d+-\d+/.exec(listed)?.[0];
        if (!id) throw new Error("inventory id missing");
        return toolAnswer("msg_2", "toolu_bulk", "proposeBulkEdits", {
          edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope." }],
          findings: [{ id, section: "242", paragraph: 1, kind: "rule", rule: "Call the range the operating envelope.", status: "resolved", editNumbers: [1] }],
        });
      },
      () => textAnswer("msg_3", "Proposed the Line 242 revision. Line 244 is still to do."),
    ]);
    await f.run();

    expect(sent).toHaveLength(3);
    // The tool result no longer asks for the checklist to be retyped.
    expect(String(toolResult(sent[2]!, "toolu_bulk")?.content)).toContain("Do not repeat the checklist");
    const turn = await f.turn();
    expect(turn.status).toBe("completed");
    expect(turn.continuation).toEqual({ reason: "lines_left", nextSection: "244", remaining: 1 });
    const listed = await f.actor.query(api.chatV2.listTurns, { threadId: f.threadId });
    expect(listed[0]?.continuation).toEqual({ reason: "lines_left", nextSection: "244", remaining: 1 });
  });

  test("a turn that only lists the Deviations offers nothing", async () => {
    const f = await setup({ notes: [{ section: "242", paragraphIndex: 0 }] });
    stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv", "deviationInventory", {}),
      () => textAnswer("msg_2", "Line 242 paragraph 1 has one Deviation."),
    ]);
    await f.run();
    expect((await f.turn()).continuation).toBeUndefined();
  });

  test("a turn that ends on the step limit offers Continue", async () => {
    const f = await setup();
    stubAnthropic(
      Array.from({ length: CHAT_MAX_STEPS }, (_, i) => () =>
        toolAnswer(`msg_${i + 1}`, `toolu_hl${i + 1}`, "highlightPassages", { references: [P1] }))
    );
    await f.run();
    expect((await f.turn()).continuation).toEqual({ reason: "step_limit" });
  });

  test("a reply cut off in its text offers Continue", async () => {
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubAnthropic([() => textAnswer("msg_1", "A very long answer", { stop: "max_tokens" })]);
    await f.run();
    const turn = await f.turn();
    expect(turn.status).toBe("failed");
    expect(turn.continuation).toEqual({ reason: "cut_off" });
  });
});

describe("history the model no longer reads", () => {
  test("records where the history starts and tells the model, in the per-turn note only", async () => {
    const f = await setup({ historyExchanges: 20 });
    const sent = stubAnthropic([() => textAnswer("msg_1", "Answer.")]);
    await f.run();

    expect(sent).toHaveLength(1);
    const turn = await f.turn();
    // 20 earlier exchanges plus the prompt: the window starts on the fixed
    // turn boundary at order 8 (CHAT_HISTORY_CHUNK_TURNS).
    expect(turn.historyStartOrder).toBe(8);
    const listed = await f.actor.query(api.chatV2.listTurns, { threadId: f.threadId });
    expect(listed.at(-1)?.historyStartOrder).toBe(8);
    const body = JSON.stringify(sent[0]!.messages);
    expect(body).not.toContain("Earlier question 7.");
    expect(body).toContain("Earlier question 8.");
    expect(lastUserText(sent[0]!)).toContain(CHAT_CONTEXT_LOSS_NOTE);
    expect(JSON.stringify((sent[0]!.messages[0]!.content as unknown[])[0])).toContain("EVIDENCE FOR THIS TURN");
    expect(JSON.stringify((sent[0]!.messages[0]!.content as unknown[])[0])).not.toContain(CHAT_CONTEXT_LOSS_NOTE);
    expect(JSON.stringify(sent[0]!.system)).not.toContain(CHAT_CONTEXT_LOSS_NOTE);
  });

  test("a thread the model reads whole records nothing and says nothing", async () => {
    const f = await setup({ historyExchanges: 3 });
    const sent = stubAnthropic([() => textAnswer("msg_1", "Answer.")]);
    await f.run();
    expect((await f.turn()).historyStartOrder).toBeUndefined();
    expect(JSON.stringify(sent[0]!.messages)).not.toContain(CHAT_CONTEXT_LOSS_NOTE);
    expect(JSON.stringify(sent[0]!.messages)).toContain("Earlier question 0.");
  });
});
