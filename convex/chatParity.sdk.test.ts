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
    // Phase B (2026-10-20): these suites drive the writer's own Continue
    // messages, so automatic continuing is off here (convex/chatAutoContinue.test.ts
    // covers it).
    await ctx.db.insert("appSettings", { key: "ai.chatAutoContinue", value: "off", updatedBy: userId, updatedAt: now });
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
      "readDocument", "searchDocuments", "readTranscript", "viewFile",
    ]);
    expect(JSON.stringify(toggledSent[0]!.tools)).toBe(JSON.stringify(plainSent[0]!.tools));
    expect(JSON.stringify(toggledSent[0]!.system)).toBe(JSON.stringify(plainSent[0]!.system));
    // The options reach the model in the per-turn note after the evidence.
    expect(lastUserText(plainSent[0]!)).toContain("Brain examples are off for this message, web search is off in this conversation.");
    expect(lastUserText(toggledSent[0]!)).toContain("Brain examples are on for this message, web search is on in this conversation.");
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

// ─── Backend review fixes (Claude Opus 5.5, high effort) ─────────────────────

/** A tool call cut off at the output limit: the API closes the block first. */
function cutToolAnswer(id: string, toolUseId: string): Response {
  const json = JSON.stringify({ edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope." }], findings: [] }).slice(0, 60);
  return sse([
    messageStart(id),
    ...thinking(id),
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: toolUseId, name: "proposeBulkEdits", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: json } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "max_tokens", stop_sequence: null }, usage: { output_tokens: CHAT_MAX_OUTPUT_TOKENS } },
    { type: "message_stop" },
  ]);
}

async function chatUsage(f: Awaited<ReturnType<typeof setup>>) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await f.t.finishAllScheduledFunctions(() => {});
  return (await f.t.run((ctx) => ctx.db.query("aiUsage").collect())).filter((row) => row.callSite === "chat_v2");
}

describe("review P2-1: a Stop caught before a pass's stream exists", () => {
  test("ends the turn before the recovery pass sends its request", async () => {
    vi.useRealTimers();
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const sent = stubAnthropic([
      () => thinkingOnlyAnswer("msg_1"),
      () => textAnswer("msg_2", "Recovered after the Stop."),
    ]);
    const original = reportChatAgent.streamText.bind(reportChatAgent);
    let passes = 0;
    vi.spyOn(reportChatAgent, "streamText").mockImplementation((async (...args: unknown[]) => {
      passes += 1;
      if (passes === 2) {
        // The recovery pass has begun: the writer stops, and the watcher
        // sees it before the agent links its own abort to the turn's.
        const { order } = await f.turn();
        await f.actor.mutation(api.chatV2.abortStreaming, { threadId: f.threadId, order });
        await new Promise((resolve) => setTimeout(resolve, CHAT_STOP_POLL_MS + 300));
      }
      return await (original as (...a: unknown[]) => Promise<unknown>)(...args);
    }) as never);
    await f.run();

    expect(passes).toBe(2);
    expect(sent).toHaveLength(1);
    const turn = await f.turn();
    expect(turn.status).toBe("aborted");
    const texts = (await f.messages()).filter((m) => m.role === "assistant").map((m) => m.text);
    expect(texts).not.toContain("Recovered after the Stop.");
    expect(texts).not.toContain(chatFailureReply(new Error("CHAT_THINKING_CUT_OFF")));
    expect(texts).not.toContain(chatFailureReply(new Error("CHAT_STOPPED")));
  });
});

describe("review P2-2: the conversation's record of handled Deviations", () => {
  async function nextTurn(f: Awaited<ReturnType<typeof setup>>, content: string) {
    const next = await f.actor.mutation(api.chatV2.sendMessage, { reportId: f.reportId, content, threadId: f.threadId });
    await f.t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: next.threadId, promptMessageId: next.messageId, reportId: f.reportId, userId: f.userId,
    });
    return next;
  }
  const lineOf = (listed: string, id: string) => listed.split("\n").find((line) => line.includes(id));

  test("marks an item on a pending card as handled, with how to refine that card", async () => {
    const f = await setup({ notes: [{ section: "242", paragraphIndex: 0 }, { section: "244", paragraphIndex: 0 }] });
    let ids: { r242: string; r244: string } | undefined;
    const first = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv", "deviationInventory", {}),
      () => {
        const listed = JSON.stringify(toolResult(first[1]!, "toolu_inv"));
        ids = { r242: /r-242-\d+-\d+/.exec(listed)![0], r244: /r-244-\d+-\d+/.exec(listed)![0] };
        return toolAnswer("msg_2", "toolu_bulk", "proposeBulkEdits", {
          edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope." }],
          findings: [{ id: ids.r242, section: "242", paragraph: 1, kind: "rule", rule: "Call the range the operating envelope.", status: "resolved", editNumbers: [1] }],
        });
      },
      () => textAnswer("msg_3", "Proposed the Line 242 revision."),
    ]);
    await f.run();
    // Before this turn nothing was handled, so neither the list nor the note marks anything.
    expect(JSON.stringify(toolResult(first[1]!, "toolu_inv"))).not.toContain("Handled earlier");
    expect(lastUserText(first[0]!)).not.toContain("already handled");

    // Round 2 N1: the writer asks to refine that card; the mark guides, it does not forbid.
    const second = stubAnthropic([
      () => toolAnswer("msg_4", "toolu_inv2", "deviationInventory", {}),
      () => textAnswer("msg_5", "Proposed the whole set again with the change."),
    ]);
    await nextTurn(f, "Refine the Line 242 card: say pressure operating envelope in bar.");
    expect(second).toHaveLength(2);
    expect(lastUserText(second[0]!)).toContain(
      "Deviations already handled in this conversation (on a pending or applied card, or blocked or conflicting): Line 242 1. deviationInventory and compareReferencePd mark each one still in the list; skip them unless the writer's message reopens one."
    );
    const listed = String(toolResult(second[1]!, "toolu_inv2")?.content);
    expect(lineOf(listed, ids!.r242)).toContain(
      "Handled earlier in this conversation (already on a pending card): skip it by default (leave it out of the edits and the findings); revise it if the writer asks to refine or redo that card; to refine a pending proposeBulkEdits card, propose its whole set again, this item included."
    );
    expect(lineOf(listed, ids!.r244)).not.toContain("Handled earlier");
    expect(listed).toContain("1 of them were handled earlier in this conversation and are marked: skip them by default (leave them out of the edits and the findings) and revise the others, unless the writer's message reopens one");
    expect(listed).not.toContain("do not propose it again");
  });

  test("a blocked item stays out of Continue but reopens when the writer supplies the fact", async () => {
    const f = await setup({ notes: [{ section: "242", paragraphIndex: 0 }, { section: "244", paragraphIndex: 0 }] });
    let id = "";
    const first = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv", "deviationInventory", { section: "242" }),
      () => {
        id = /r-242-\d+-\d+/.exec(JSON.stringify(toolResult(first[1]!, "toolu_inv")))![0];
        return toolAnswer("msg_2", "toolu_rec", "proposeBulkEdits", {
          edits: [],
          findings: [{ id, section: "242", paragraph: 1, kind: "rule", rule: "Call the range the operating envelope.", status: "blocked",
            reason: "The sources do not give the range.", missingFact: "The pressure range.", missingFactSource: "The interview." }],
        });
      },
      () => textAnswer("msg_3", "Nothing to apply: Line 242 needs the pressure range."),
    ]);
    await f.run();
    // The Continue offer moves on to the next Line.
    expect((await f.turn()).continuation).toEqual({ reason: "lines_left", nextSection: "244", remaining: 1 });

    const second = stubAnthropic([
      () => toolAnswer("msg_4", "toolu_inv2", "deviationInventory", { section: "242" }),
      () => toolAnswer("msg_5", "toolu_bulk", "proposeBulkEdits", {
        edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope of 2 to 5 bar." }],
        findings: [{ id, section: "242", paragraph: 1, kind: "rule", rule: "Call the range the operating envelope.", status: "resolved", editNumbers: [1] }],
      }),
      () => textAnswer("msg_6", "Proposed the Line 242 revision with the range."),
    ]);
    await nextTurn(f, "The range is 2 to 5 bar. Fix Line 242.");
    expect(String(toolResult(second[1]!, "toolu_inv2")?.content)).toContain(
      "Handled earlier in this conversation (blocked: needs a missing fact from the writer): skip it by default (leave it out of the edits and the findings); revise it once the writer supplies that fact."
    );
    // The reopened item lands as a card.
    expect(String(toolResult(second[2]!, "toolu_bulk")?.content)).toContain("Coordinated revision proposed");
  });

  // Round 2 N2: content (c-) ids are positional, so their marks last only
  // for the job that produced them.
  async function contentTurn() {
    const f = await setup();
    const named = [{ section: "242", paragraph: 1, instruction: "Call it the operating envelope." }];
    let id = "";
    const first = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv", "deviationInventory", { contentDeviations: named }),
      () => {
        id = /c-242-\d+-\d+/.exec(JSON.stringify(toolResult(first[1]!, "toolu_inv")))![0];
        return toolAnswer("msg_2", "toolu_bulk", "proposeBulkEdits", {
          edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope." }],
          findings: [{ id, section: "242", paragraph: 1, kind: "content", status: "resolved", editNumbers: [1] }],
        });
      },
      () => textAnswer("msg_3", "Proposed the Line 242 revision."),
    ]);
    await f.run();
    return { f, id };
  }

  test("a fresh request naming the same paragraph starts clean", async () => {
    const { f, id } = await contentTurn();
    const second = stubAnthropic([
      () => toolAnswer("msg_4", "toolu_inv2", "deviationInventory", {
        contentDeviations: [{ section: "242", paragraph: 1, instruction: "Name the supplier of the sensor." }],
      }),
      () => textAnswer("msg_5", "Line 242 paragraph 1 has one item."),
    ]);
    await nextTurn(f, "In Line 242 paragraph 1, name the supplier of the sensor.");
    const listed = String(toolResult(second[1]!, "toolu_inv2")?.content);
    expect(lineOf(listed, id)).toContain("Name the supplier of the sensor.");
    // Round 3 (P2-A): same id, a different item, so no mark.
    expect(lineOf(listed, id)).not.toContain("Handled earlier");
  });

  test("a Continue chain still skips the items its own request handled", async () => {
    const { f, id } = await contentTurn();
    const second = stubAnthropic([
      () => toolAnswer("msg_4", "toolu_inv2", "deviationInventory", {
        contentDeviations: [{ section: "242", paragraph: 1, instruction: "Call it the operating envelope." }],
      }),
      () => textAnswer("msg_5", "Line 242 is done."),
    ]);
    await nextTurn(f, "Continue with Line 244.");
    const listed = String(toolResult(second[1]!, "toolu_inv2")?.content);
    expect(lineOf(listed, id)).toContain("Handled earlier in this conversation (already on a pending card)");
    expect(lastUserText(second[0]!)).toContain("Line 242 1.");
  });
});

describe("review P3-1: Continue for every item kind", () => {
  test("content Deviations the writer named and the turn left open offer the next Line", async () => {
    const f = await setup();
    const contentDeviations = [
      { section: "242", paragraph: 1, instruction: "Call it the operating envelope." },
      { section: "244", paragraph: 1, instruction: "Name the month the rig was rebuilt." },
    ];
    const sent = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv", "deviationInventory", { contentDeviations, section: "242" }),
      () => {
        const id = /c-242-\d+-\d+/.exec(JSON.stringify(toolResult(sent[1]!, "toolu_inv")))![0];
        return toolAnswer("msg_2", "toolu_bulk", "proposeBulkEdits", {
          edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope." }],
          findings: [{ id, section: "242", paragraph: 1, kind: "content", status: "resolved", editNumbers: [1] }],
        });
      },
      () => textAnswer("msg_3", "Proposed the Line 242 revision. Line 244 has one item left."),
    ]);
    await f.run();
    expect(sent).toHaveLength(3);
    expect((await f.turn()).continuation).toEqual({ reason: "lines_left", nextSection: "244", remaining: 1 });
  });
});

describe("review P3-4: measurements belong to their own step", () => {
  test("a held-back step logged after a Stop keeps its own stop reason and effort", async () => {
    vi.useRealTimers();
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    let requested!: () => void;
    const secondRequest = new Promise<void>((resolve) => { requested = resolve; });
    const sent = stubAnthropic([
      () => cutToolAnswer("msg_1", "toolu_cut"),
      (signal) => {
        requested();
        return stillThinking("msg_2", "Splitting the revision.", signal);
      },
    ]);
    const running = f.run();
    await secondRequest;
    const { order } = await f.turn();
    await f.actor.mutation(api.chatV2.abortStreaming, { threadId: f.threadId, order });
    await running;

    expect(sent).toHaveLength(2);
    expect((await f.turn()).status).toBe("aborted");
    const rows = await chatUsage(f);
    const held = rows.find((row) => row.outputTokens === CHAT_MAX_OUTPUT_TOKENS);
    const stopped = rows.find((row) => row.partial === true);
    expect(rows).toHaveLength(2);
    expect(held).toMatchObject({ stopReason: "max_tokens", effort: "default" });
    expect(held?.partial).toBeUndefined();
    expect(stopped).toMatchObject({ stopReason: "aborted", outputTokens: Math.ceil("Splitting the revision.".length / 3) });
  });
});

// ─── Round 3 (P2-A): content marks follow what the item is ──────────────────

describe("round 3 P2-A: content and reference marks keyed on what the item is", () => {
  const named = [
    { section: "242", paragraph: 1, instruction: "Call it the operating envelope." },
    { section: "244", paragraph: 1, instruction: "Name the month the rig was rebuilt." },
  ];
  const inventoryCall = (id: string, toolUseId: string, section?: "242" | "244") =>
    toolAnswer(id, toolUseId, "deviationInventory", { contentDeviations: named, ...(section ? { section } : {}) });
  const cardFor = (id: string, toolUseId: string, itemId: string, section: "242" | "244", targetText: string, newText: string) =>
    toolAnswer(id, toolUseId, "proposeBulkEdits", {
      edits: [{ targetText, newText }],
      findings: [{ id: itemId, section, paragraph: 1, kind: "content", status: "resolved", editNumbers: [1] }],
    });
  const idIn = (body: Body | undefined, toolUseId: string, section: "242" | "244") =>
    new RegExp(`c-${section}-\\d+-\\d+`).exec(JSON.stringify(toolResult(body!, toolUseId)))![0];

  async function send(f: Awaited<ReturnType<typeof setup>>, content: string, extra: Record<string, unknown> = {}) {
    const next = await f.actor.mutation(api.chatV2.sendMessage, { reportId: f.reportId, content, threadId: f.threadId, ...extra });
    await f.t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: next.threadId, promptMessageId: next.messageId, reportId: f.reportId, userId: f.userId,
    });
    const turn = await f.t.run(async (ctx) => (await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
        q.eq("agentThreadId", next.threadId).eq("promptMessageId", next.messageId))
      .unique())!);
    return { ...next, turn };
  }

  /** T1 revises Line 242 (card A); T2, a Continue, revises Line 244 (card B). */
  async function twoCards() {
    const f = await setup();
    let c242 = "";
    const t1 = stubAnthropic([
      () => inventoryCall("msg_1", "toolu_inv1", "242"),
      () => {
        c242 = idIn(t1[1], "toolu_inv1", "242");
        return cardFor("msg_2", "toolu_a", c242, "242", P1, "Trial 1 described a pressure operating envelope.");
      },
      () => textAnswer("msg_3", "Proposed the Line 242 revision."),
    ]);
    await f.run();
    let c244 = "";
    const t2 = stubAnthropic([
      () => inventoryCall("msg_4", "toolu_inv2", "244"),
      () => {
        c244 = idIn(t2[1], "toolu_inv2", "244");
        return cardFor("msg_5", "toolu_b", c244, "244", P244, "The team rebuilt the rig in March 2025.");
      },
      () => textAnswer("msg_6", "Proposed the Line 244 revision."),
    ]);
    await send(f, "Continue with Line 244.");
    // Each card recorded what its content item is.
    const items = await f.t.run((ctx) => ctx.db.query("chatProposalItems").collect());
    expect(items.map((item) => [item.itemId, typeof item.fingerprint])).toEqual([[c242, "string"], [c244, "string"]]);
    const cardA = (await f.t.run((ctx) => ctx.db.query("chatProposals").collect())).find((card) => card.toolCallId === "toolu_a")!;
    return { f, c242, c244, cardA };
  }

  test("a Refine after a Continue chain keeps the other card's items handled, so Continue does not offer them again", async () => {
    const { f, c242, c244, cardA } = await twoCards();
    const t3 = stubAnthropic([
      () => inventoryCall("msg_7", "toolu_inv3"),
      () => cardFor("msg_8", "toolu_a2", c242, "242", P1, "Trial 1 described a pressure operating envelope in bar."),
      () => textAnswer("msg_9", "Proposed card A again with the change."),
    ]);
    const refined = await send(f, "Say it in bar.", { refineProposalId: cardA._id });
    const listed = String(toolResult(t3[1]!, "toolu_inv3")?.content);
    expect(listed.split("\n").find((line) => line.includes(c244))).toContain("Handled earlier in this conversation (already on a pending card)");
    // Nothing is left, so the refine offers no Continue with Line 244.
    expect(refined.turn.status).toBe("completed");
    expect(refined.turn.continuation).toBeUndefined();

    // T4: a typed continue still sees card B's item as handled.
    const t4 = stubAnthropic([
      () => inventoryCall("msg_10", "toolu_inv4", "244"),
      () => textAnswer("msg_11", "Line 244 is already on a card."),
    ]);
    await send(f, "continue please");
    const listed4 = String(toolResult(t4[1]!, "toolu_inv4")?.content);
    expect(listed4.split("\n").find((line) => line.includes(c244))).toContain("Handled earlier in this conversation (already on a pending card)");
  });

  test("a question mid-chain and a typed continue keep the earlier card's items handled", async () => {
    const f = await setup();
    let c242 = "";
    const t1 = stubAnthropic([
      () => inventoryCall("msg_1", "toolu_inv1", "242"),
      () => {
        c242 = idIn(t1[1], "toolu_inv1", "242");
        return cardFor("msg_2", "toolu_a", c242, "242", P1, "Trial 1 described a pressure operating envelope.");
      },
      () => textAnswer("msg_3", "Proposed the Line 242 revision."),
    ]);
    await f.run();
    stubAnthropic([() => textAnswer("msg_4", "Because the rule asks for the operating envelope.")]);
    await send(f, "Why does Line 242 need this?");
    const t3 = stubAnthropic([
      () => inventoryCall("msg_5", "toolu_inv3"),
      () => textAnswer("msg_6", "Line 244 is next."),
    ]);
    await send(f, "continue please");
    const listed = String(toolResult(t3[1]!, "toolu_inv3")?.content);
    expect(listed.split("\n").find((line) => line.includes(c242))).toContain("Handled earlier in this conversation (already on a pending card)");
    expect(listed.split("\n").find((line) => /c-244-\d+-\d+/.test(line))).not.toContain("Handled earlier");
  });

  test("a card saved without a list call in its turn falls back to its id within the job", async () => {
    const f = await setup();
    // No inventory call: the card records no fingerprint.
    stubAnthropic([
      () => cardFor("msg_1", "toolu_a", "c-242-1-1", "242", P1, "Trial 1 described a pressure operating envelope."),
      () => textAnswer("msg_2", "Proposed."),
    ]);
    await f.run();
    const [row] = await f.t.run((ctx) => ctx.db.query("chatProposalItems").collect());
    expect(row?.fingerprint).toBeUndefined();
    const t2 = stubAnthropic([
      () => inventoryCall("msg_3", "toolu_inv2"),
      () => textAnswer("msg_4", "Line 244 is next."),
    ]);
    await send(f, "Continue with Line 244.");
    const listed = String(toolResult(t2[1]!, "toolu_inv2")?.content);
    expect(listed.split("\n").find((line) => line.includes("c-242-1-1"))).toContain("Handled earlier");
  });
});

// ─── Round 4 (N1): a Continue chain survives re-extracted instructions ─────

describe("round 4 N1: re-extracted instructions in a Continue chain", () => {
  async function send(f: Awaited<ReturnType<typeof setup>>, content: string) {
    const next = await f.actor.mutation(api.chatV2.sendMessage, { reportId: f.reportId, content, threadId: f.threadId });
    await f.t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: next.threadId, promptMessageId: next.messageId, reportId: f.reportId, userId: f.userId,
    });
    return await f.t.run(async (ctx) => (await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
        q.eq("agentThreadId", next.threadId).eq("promptMessageId", next.messageId))
      .unique())!);
  }
  const card = (id: string, toolUseId: string, ids: Array<{ id: string; section: "242" | "244" }>, targetText: string, newText: string) =>
    toolAnswer(id, toolUseId, "proposeBulkEdits", {
      edits: [{ targetText, newText }],
      findings: ids.map((x) => ({ id: x.id, section: x.section, paragraph: 1, kind: "content", status: "resolved", editNumbers: [1] })),
    });
  type Named = Array<{ section: string; paragraph: number; instruction: string }>;

  /** The reviewer's probe: T1 revises 242, T2 (a Continue) lists again with `t2Named` and revises 244. */
  async function chain(t1Named: Named, t2Named: Named) {
    const f = await setup();
    stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv1", "deviationInventory", { contentDeviations: t1Named, section: "242" }),
      () => card("msg_2", "toolu_a", t1Named.filter((n) => n.section === "242").map((_, i) => ({ id: `c-242-1-${i + 1}`, section: "242" as const })), P1, "Trial 1 described a pressure operating envelope."),
      () => textAnswer("msg_3", "Proposed the Line 242 revision."),
    ]);
    await f.run();
    const t2 = stubAnthropic([
      () => toolAnswer("msg_4", "toolu_inv2", "deviationInventory", { contentDeviations: t2Named }),
      () => card("msg_5", "toolu_b", [{ id: "c-244-1-1", section: "244" }], P244, "The team rebuilt the rig in March 2025."),
      () => textAnswer("msg_6", "Proposed the Line 244 revision."),
    ]);
    const second = await send(f, "Continue with Line 244.");
    const listed = String(toolResult(t2[1]!, "toolu_inv2")?.content).split("\n");
    return { second, listed, note: lastUserText(t2[0]!) };
  }
  const lineWith = (listed: string[], id: string) => listed.find((line) => line.startsWith(`- ${id} `));

  test("drift: a quoted or rephrased instruction still counts as handled within the chain", async () => {
    const { second, listed, note } = await chain(
      [
        { section: "242", paragraph: 1, instruction: "Call it the operating envelope." },
        { section: "244", paragraph: 1, instruction: "Name the month the rig was rebuilt." },
      ],
      [
        { section: "242", paragraph: 1, instruction: 'Call it the "operating envelope".' },
        { section: "244", paragraph: 1, instruction: "Name the month the rig was rebuilt." },
      ]
    );
    expect(lineWith(listed, "c-242-1-1")).toContain("Handled earlier in this conversation (already on a pending card)");
    expect(second.continuation).toBeUndefined();
    expect(note).toContain("Line 242 1.");
  });

  test("reorder: two instructions on one paragraph listed in the other order both stay handled", async () => {
    const { second, listed, note } = await chain(
      [
        { section: "242", paragraph: 1, instruction: "Call it the operating envelope." },
        { section: "242", paragraph: 1, instruction: "Give the range in bar." },
        { section: "244", paragraph: 1, instruction: "Name the month the rig was rebuilt." },
      ],
      [
        { section: "242", paragraph: 1, instruction: "Give the range in bar." },
        { section: "242", paragraph: 1, instruction: "Call it the operating envelope." },
        { section: "244", paragraph: 1, instruction: "Name the month the rig was rebuilt." },
      ]
    );
    expect(lineWith(listed, "c-242-1-1")).toContain("Handled earlier");
    expect(lineWith(listed, "c-242-1-2")).toContain("Handled earlier");
    expect(second.continuation).toBeUndefined();
    expect(note).toContain("Line 242 2.");
  });

  test("control: identical re-extraction", async () => {
    const named = [
      { section: "242", paragraph: 1, instruction: "Call it the operating envelope." },
      { section: "244", paragraph: 1, instruction: "Name the month the rig was rebuilt." },
    ];
    const { second, listed } = await chain(named, named);
    expect(lineWith(listed, "c-242-1-1")).toContain("Handled earlier");
    expect(second.continuation).toBeUndefined();
  });

  test("a card from a recovery pass records no fingerprint and is matched by id within the job", async () => {
    const f = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const named = [
      { section: "242", paragraph: 1, instruction: "Call it the operating envelope." },
      { section: "244", paragraph: 1, instruction: "Name the month the rig was rebuilt." },
    ];
    // Pass 1 lists, then thinks to the limit; the recovery pass cannot see
    // that list, so its card has nothing to fingerprint against.
    stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv1", "deviationInventory", { contentDeviations: named }),
      () => thinkingOnlyAnswer("msg_2"),
      () => card("msg_3", "toolu_a", [{ id: "c-242-1-1", section: "242" }], P1, "Trial 1 described a pressure operating envelope."),
      () => textAnswer("msg_4", "Proposed the Line 242 revision."),
    ]);
    await f.run();
    const [row] = await f.t.run((ctx) => ctx.db.query("chatProposalItems").collect());
    expect(row).toMatchObject({ itemId: "c-242-1-1" });
    expect(row?.fingerprint).toBeUndefined();

    const t2 = stubAnthropic([
      () => toolAnswer("msg_5", "toolu_inv2", "deviationInventory", { contentDeviations: named }),
      () => textAnswer("msg_6", "Line 244 is next."),
    ]);
    await send(f, "Continue with Line 244.");
    const listed = String(toolResult(t2[1]!, "toolu_inv2")?.content).split("\n");
    expect(lineWith(listed, "c-242-1-1")).toContain("Handled earlier");
    expect(lineWith(listed, "c-244-1-1")).not.toContain("Handled earlier");
  });
});

// Phase B (2026-10-20), W2 round 2: the 2026-10-20 replay. A card rewrote a
// paragraph but missed one of its Deviations; the Continue offer sent the
// job back to that Line and a second card rewrote the same paragraphs. Now
// that item waits on the pending card: the offer moves on, the next turn is
// told, and the inventory marks it.
describe("items waiting on a pending card", () => {
  test("do not send the job back to the card's Line, and the next turn is told", async () => {
    const f = await setup({ notes: [
      { section: "242", paragraphIndex: 0 }, { section: "242", paragraphIndex: 0 }, { section: "244", paragraphIndex: 0 },
    ] });
    let missed = "";
    const first = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_inv", "deviationInventory", {}),
      () => {
        const listed = JSON.stringify(toolResult(first[1]!, "toolu_inv"));
        const ids = [...new Set(listed.match(/r-242-1-\d+/g) ?? [])];
        if (ids.length !== 2) throw new Error(`expected two Line 242 ids, got ${ids.join(", ")}`);
        missed = ids[1]!;
        // The card rewrites paragraph 1 for the first item and misses the second.
        return toolAnswer("msg_2", "toolu_bulk", "proposeBulkEdits", {
          edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope." }],
          findings: [{ id: ids[0], section: "242", paragraph: 1, kind: "rule", rule: "Call the range the operating envelope.", status: "resolved", editNumbers: [1] }],
        });
      },
      () => textAnswer("msg_3", "Proposed the Line 242 revision."),
    ]);
    await f.run();

    // The offer moves on to Line 244, and the missed item waits on the card.
    expect((await f.turn()).continuation).toEqual({
      reason: "lines_left", nextSection: "244", remaining: 1,
      waiting: [{ itemId: missed, section: "242", paragraph: 1 }],
    });

    // The writer's Continue (the same offer) reaches the next turn.
    const second = stubAnthropic([
      () => toolAnswer("msg_4", "toolu_inv2", "deviationInventory", { section: "242" }),
      () => textAnswer("msg_5", "Line 242 is on the pending card."),
    ]);
    const next = await f.actor.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, content: "Continue with Line 244.", threadId: f.threadId,
    });
    await f.t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: next.threadId, promptMessageId: next.messageId, reportId: f.reportId, userId: f.userId,
    });
    const note = `Deviations waiting on a pending card: ${missed} (Line 242, paragraph 1). These items sit in paragraphs a pending card already rewrites, so do not rewrite those paragraphs again. Name them in your closing by Line and paragraph, so the writer can refine that card or ask for them after applying it.`;
    // In the per-turn tail (the last user message), never in the cached head.
    expect(lastUserText(second[0]!)).toContain(note);
    expect(JSON.stringify(second[0]!.system ?? "")).not.toContain("waiting on a pending card");
    const listed = String(toolResult(second[1]!, "toolu_inv2")?.content).split("\n");
    expect(listed.find((line) => line.includes(missed))).toContain(
      "Waiting on a pending card that already rewrites this paragraph: do not rewrite the paragraph again; name this item in your closing so the writer can refine that card or ask for it after applying it."
    );
  });
});
