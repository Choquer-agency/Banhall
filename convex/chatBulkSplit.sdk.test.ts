/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  CHAT_CUT_OFF_INSTRUCTION,
  CHAT_CUT_OFF_REPLY,
  CHAT_MAX_OUTPUT_TOKENS,
} from "./ai/chatAgentV2";
import { BULK_EDIT_SIZE_RULE } from "./lib/completionReport";
import { correlateProposals } from "../src/lib/chat/turnParts";

/**
 * 2026-10-01 (first), alerts triage, at the real request/response boundary:
 * the production chat action (`streamChatReply`), the agent, the AI SDK's
 * Anthropic provider and the tools are real; only `fetch` is stubbed with
 * Anthropic's server-sent events.
 *
 * Alert 2026-09-29: asked to address 11 itemized deviations, chat wrote one
 * huge proposeBulkEdits call, the step stopped at the 16,384-token output
 * limit mid tool input, and the turn failed with "I couldn't finish that
 * response. Try again." Anthropic closes the cut tool_use block before its
 * max_tokens stop, so the SDK records a call whose JSON never closed and
 * answers it with the parse error. Now the model reads a fixed instruction to
 * split the revision instead, and a second cut-off ends the turn with a plain
 * message. Every card is anchored to its prompt, so listProposals shows it.
 */

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-chat-bulk-split";
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

const thinking = (id: string): Event[] => [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: `sig-${id}` } },
  { type: "content_block_stop", index: 0 },
];

/**
 * A proposeBulkEdits answer. With `stop: "max_tokens"` the input JSON is cut
 * where the output limit fell; the API still closes the block first.
 */
function toolAnswer(id: string, toolUseId: string, json: string, stop: "tool_use" | "max_tokens") {
  const events: Event[] = [
    messageStart(id),
    ...thinking(id),
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: toolUseId, name: "proposeBulkEdits", input: {} } },
  ];
  for (let at = 0; at < json.length; at += 40) {
    events.push({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: json.slice(at, at + 40) } });
  }
  events.push(
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: stop === "max_tokens" ? CHAT_MAX_OUTPUT_TOKENS : 300 },
    },
    { type: "message_stop" }
  );
  return sse(events);
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

/** Answers each request with the next answer; a request past the list fails the test. */
function stubAnthropic(answers: Array<() => Response>): Body[] {
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
const P2 = "Trial 2 described a temperature range.";

const smallInput = {
  edits: [{ targetText: P1, newText: "Trial 1 described a pressure operating envelope." }],
  findings: [{ id: "c-242-1-1", section: "242", paragraph: 1, kind: "content", status: "resolved", editNumbers: [1] }],
};
/** The opening of an oversize call, cut where the output limit fell. */
const cutJson = JSON.stringify({
  edits: [
    { targetText: P1, newText: "Trial 1 described a pressure operating envelope." },
    { targetText: P2, newText: "Trial 2 described a temperature operating envelope." },
  ],
  findings: [],
}).slice(0, 150);

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Bulk split project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "bulk-split-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [
        heading("Line 242 - Scientific/Technological Uncertainty"), paragraph(P1), paragraph(P2),
        heading("Line 244 - Work Performed"), paragraph("Work paragraph."),
        heading("Line 246 - Scientific/Technological Advancement"), paragraph("Advancement paragraph."),
      ] }),
      version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    return { userId, projectId, reportId };
  });
  const actor = t.withIdentity({ subject: authId });
  const sent = await actor.mutation(api.chatV2.sendMessage, {
    reportId: ids.reportId, content: "Address each itemized deviation.", newThread: true,
  });
  const run = () =>
    t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, reportId: ids.reportId, userId: ids.userId,
    });
  const turn = () => t.run(async (ctx) => (await ctx.db.query("chatTurns").collect())[0]!);
  const messages = async () =>
    (await actor.query(api.chatV2.listMessages, {
      threadId: sent.threadId, paginationOpts: { cursor: null, numItems: 50 }, streamArgs: undefined,
    })).page;
  return { t, actor, ...ids, threadId: sent.threadId, promptMessageId: sent.messageId, run, turn, messages };
}

/** The tool_result block a request sends for one tool call. */
function toolResult(body: Body, toolUseId: string): Record<string, unknown> | undefined {
  for (const message of body.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block.type === "tool_result" && block.tool_use_id === toolUseId) return block;
    }
  }
  return undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("a bulk revision cut off at the output limit", () => {
  test("gets the split instruction, and the next call lands as a card on its turn", async () => {
    const f = await setup();
    const sent = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_cut", cutJson, "max_tokens"),
      () => toolAnswer("msg_2", "toolu_part1", JSON.stringify(smallInput), "tool_use"),
      () => textAnswer("msg_3", "Proposed the first part. Review and apply the proposal when ready."),
    ]);
    await f.run();

    expect(sent).toHaveLength(3);
    // The output cap is unchanged; the size rule reaches the tool and the prompt.
    expect(sent[0]!.max_tokens).toBe(CHAT_MAX_OUTPUT_TOKENS);
    const bulkTool = (sent[0]!.tools as Array<{ name: string; description: string }>)
      .find((tool) => tool.name === "proposeBulkEdits");
    expect(bulkTool?.description).toContain(BULK_EDIT_SIZE_RULE);
    expect(JSON.stringify(sent[0]!.system)).toContain(BULK_EDIT_SIZE_RULE);

    // The model reads the fixed instruction, not the parse error that echoes
    // the cut input, and every later step sends the same history.
    const instruction = { type: "tool_result", tool_use_id: "toolu_cut", content: CHAT_CUT_OFF_INSTRUCTION, is_error: true };
    expect(toolResult(sent[1]!, "toolu_cut")).toEqual(instruction);
    expect(toolResult(sent[2]!, "toolu_cut")).toEqual(instruction);
    expect(JSON.stringify(sent.slice(1))).not.toContain("JSON parsing failed");
    expect(sent[2]!.messages.slice(0, sent[1]!.messages.length)).toEqual(sent[1]!.messages);

    expect((await f.turn()).status).toBe("completed");
    const stored = await f.t.run((ctx) => ctx.db.query("chatProposals").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: "replacements", toolCallId: "toolu_part1", promptMessageId: f.promptMessageId, state: "pending",
    });

    // Bug A through the real tool path: the card is listed and placed on the
    // reply of its turn.
    const listed = await f.actor.query(api.chatV2.listProposals, { threadId: f.threadId });
    expect(listed.map((row) => row.toolCallId)).toEqual(["toolu_part1"]);
    const messages = await f.messages();
    const { byMessageId, orphans } = correlateProposals(messages, listed);
    expect(orphans).toEqual([]);
    const reply = messages.find((message) => message.role === "assistant");
    expect(byMessageId.get(reply!.id)?.map((row) => row.toolCallId)).toEqual(["toolu_part1"]);
  });

  test("a second cut-off ends the turn and tells the writer what to do", async () => {
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_cut_1", cutJson, "max_tokens"),
      () => toolAnswer("msg_2", "toolu_cut_2", cutJson, "max_tokens"),
    ]);
    await f.run();

    // No third request: the instruction is given once.
    expect(sent).toHaveLength(2);
    expect(toolResult(sent[1]!, "toolu_cut_1")).toMatchObject({ content: CHAT_CUT_OFF_INSTRUCTION });
    expect((await f.turn()).status).toBe("failed");
    expect(await f.t.run((ctx) => ctx.db.query("chatProposals").collect())).toEqual([]);
    const texts = (await f.messages()).filter((m) => m.role === "assistant").map((m) => m.text);
    expect(texts.at(-1)).toBe(CHAT_CUT_OFF_REPLY);
    expect(CHAT_CUT_OFF_REPLY).toBe(
      "That revision was too long to write in one reply. Ask for it a few paragraphs at a time."
    );
  });

  test("a cut tool block that never closed still gets the plain message", async () => {
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = stubAnthropic([
      () => sse([
        messageStart("msg_1"),
        ...thinking("msg_1"),
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_open", name: "proposeBulkEdits", input: {} } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: cutJson } },
        { type: "message_delta", delta: { stop_reason: "max_tokens", stop_sequence: null }, usage: { output_tokens: CHAT_MAX_OUTPUT_TOKENS } },
        { type: "message_stop" },
      ]),
    ]);
    await f.run();

    expect(sent).toHaveLength(1);
    expect((await f.turn()).status).toBe("failed");
    const texts = (await f.messages()).filter((m) => m.role === "assistant").map((m) => m.text);
    expect(texts.at(-1)).toBe(CHAT_CUT_OFF_REPLY);
  });
});

describe("turns the output limit does not cut a tool call from", () => {
  test("a tool turn sends the SDK's own requests, the tool result untouched", async () => {
    const f = await setup();
    const sent = stubAnthropic([
      () => toolAnswer("msg_1", "toolu_ok", JSON.stringify(smallInput), "tool_use"),
      () => textAnswer("msg_2", "Proposed one change. Review and apply the proposal when ready."),
    ]);
    await f.run();

    expect(sent).toHaveLength(2);
    expect(toolResult(sent[1]!, "toolu_ok")?.content).toMatch(/^Coordinated revision proposed for writer review/);
    expect(JSON.stringify(sent)).not.toContain(CHAT_CUT_OFF_INSTRUCTION);
    expect(sent[1]!.messages.slice(0, sent[0]!.messages.length)).toEqual(sent[0]!.messages);
    expect((await f.turn()).status).toBe("completed");
    expect(await f.actor.query(api.chatV2.listProposals, { threadId: f.threadId })).toHaveLength(1);
  });

  test("a reply cut off in its text keeps the general failure message", async () => {
    const f = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = stubAnthropic([() => textAnswer("msg_1", "A very long answer", "max_tokens")]);
    await f.run();

    expect(sent).toHaveLength(1);
    expect((await f.turn()).status).toBe("failed");
    const texts = (await f.messages()).filter((m) => m.role === "assistant").map((m) => m.text);
    expect(texts.at(-1)).toBe("I couldn’t finish that response. Try again.");
  });
});
