/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { CHAT_MAX_OUTPUT_TOKENS } from "./ai/chatAgentV2";
import {
  CHAT_READ_BUDGET_USED,
  CHAT_READ_MAX_CALL_CHARS,
  CHAT_READ_NO_FILE,
  CHAT_READING_OFF,
} from "./ai/chatDocumentTools";
import { CHAT_DOCUMENT_TOOLS_KEY } from "./appSettings";

/**
 * Report chat parity, Phase B (2026-10-20): the reading tools at the real
 * request/response boundary. The chat action, the agent, the AI SDK's
 * Anthropic provider and the tools are real; only `fetch` is stubbed with
 * Anthropic's server-sent events (the harness of chatParity.sdk.test.ts).
 * Every name and text here is fictional.
 */

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-chat-reading";
const DIRECT_URL = "https://api.anthropic.com/v1/messages";

type Body = Record<string, unknown> & {
  tools?: unknown;
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

const thinking = (id: string): Event[] => [
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: `sig-${id}` } },
  { type: "content_block_stop", index: 0 },
];

/** One step that calls each tool in `calls`, in parallel. */
function toolAnswer(id: string, calls: Array<{ id: string; tool: string; input: unknown }>): Response {
  return sse([
    messageStart(id),
    ...thinking(id),
    ...calls.flatMap((call, i): Event[] => [
      { type: "content_block_start", index: i + 1, content_block: { type: "tool_use", id: call.id, name: call.tool, input: {} } },
      { type: "content_block_delta", index: i + 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(call.input) } },
      { type: "content_block_stop", index: i + 1 },
    ]),
    { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 300 } },
    { type: "message_stop" },
  ]);
}

const oneCall = (id: string, toolUseId: string, tool: string, input: unknown) =>
  toolAnswer(id, [{ id: toolUseId, tool, input }]);

function textAnswer(id: string, text: string): Response {
  return sse([
    messageStart(id),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ]);
}

/** A step that spends the whole output limit thinking: no tool call, no text. */
function thinkingOnlyAnswer(id: string): Response {
  return sse([
    messageStart(id),
    ...thinking(id),
    { type: "message_delta", delta: { stop_reason: "max_tokens", stop_sequence: null }, usage: { output_tokens: CHAT_MAX_OUTPUT_TOKENS } },
    { type: "message_stop" },
  ]);
}

/** Answers each Anthropic request with the next answer, recording each body. */
function stubAnthropic(answers: Array<() => Response>): Body[] {
  const sent: Body[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== DIRECT_URL) return new Response("unavailable", { status: 503 });
    sent.push(JSON.parse(await request.text()) as Body);
    const answer = answers[sent.length - 1];
    if (!answer) throw new Error(`Unexpected request ${sent.length}`);
    return answer();
  }));
  return sent;
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

/** A tool result's text, whatever shape the provider gave its content. */
function resultText(body: Body, toolUseId: string): string {
  const block = toolResult(body, toolUseId);
  if (!block) return "";
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>).map((part) => String(part.text ?? "")).join("");
  }
  return JSON.stringify(content);
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });

/** Fictional file text with a sentinel at the start of every part. */
function longText(chars: number, sentinel: string): string {
  let text = "";
  for (let part = 0; text.length < chars; part += 1) {
    const head = `${sentinel}_PART_${part + 1}. `;
    text += head + "The test rig held the fictional coolant loop at a steady pressure. ".repeat(700).slice(0, 40_000 - head.length);
  }
  return text.slice(0, chars);
}

const FILE_SENTINEL = "NORTHWIND_FICTIONAL_FILE_BODY";
const TRANSCRIPT_SENTINEL = "FICTIONAL_TRANSCRIPT_WORDS";

async function setup(options: { fileChars?: number; readingOff?: boolean } = {}) {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Reading project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "reading-token", createdAt: now, updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Other project", clientName: "Other", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "other-token", createdAt: now, updatedAt: now,
    });
    const file = (projectId: Id<"projects">, fileName: string, content: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("projectDocuments", {
        projectId, fileName, fileType: "txt", content, source: "upload", uploadedBy: "writer",
        uploaderRole: "writer", createdAt: now, ...extra,
      });
    await file(projectId, "rig-notes.txt", longText(options.fileChars ?? 50_000, FILE_SENTINEL), { category: "other" });
    await file(projectId, "archived-notes.txt", "ARCHIVED_FICTIONAL_TEXT", { archived: true });
    await file(projectId, "diagram.png", "", { fileType: "image", processingStatus: "reference_only" });
    await file(otherProjectId, "other-project.txt", "OTHER_PROJECT_FICTIONAL_TEXT");
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId, label: "Kickoff interview", content: `Dana: ${TRANSCRIPT_SENTINEL} about the rig.`, createdAt: now,
    });
    await ctx.db.insert("transcriptTurns", {
      transcriptId, projectId, parserVersion: "7", index: 0, speakerLabel: "Dana",
      startMs: 872_000, charStart: 0, charEnd: 40, cleanText: `${TRANSCRIPT_SENTINEL} about the rig.`,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Dana", role: "client", roleSource: "consultant", confidence: 1, turnCount: 1,
    });
    if (options.readingOff) {
      await ctx.db.insert("appSettings", { key: CHAT_DOCUMENT_TOOLS_KEY, value: "off", updatedAt: now, updatedBy: userId });
    }
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [
        heading("Line 242 - Scientific/Technological Uncertainty"), paragraph("Uncertainty paragraph."),
        heading("Line 244 - Work Performed"), paragraph("Work paragraph."),
        heading("Line 246 - Scientific/Technological Advancement"), paragraph("Advancement paragraph."),
      ] }),
      version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    return { userId, projectId, reportId };
  });
  const actor = t.withIdentity({ subject: authId });
  const send = async (content: string, threadId?: string) => {
    const sent = await actor.mutation(api.chatV2.sendMessage, {
      reportId: ids.reportId,
      content,
      ...(threadId ? { threadId } : { newThread: true }),
    });
    await t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, reportId: ids.reportId, userId: ids.userId,
    });
    return sent;
  };
  /** Every message the agent saved for the thread, tool rows included. */
  const saved = async (threadId: string) =>
    await t.query(components.agent.messages.listMessagesByThreadId, { threadId, order: "asc" });
  /** What the browser reads. */
  const visible = async (threadId: string) =>
    (await actor.query(api.chatV2.listMessages, {
      threadId, paginationOpts: { cursor: null, numItems: 50 }, streamArgs: undefined,
    })).page;
  return { t, actor, ...ids, send, saved, visible };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readDocument", () => {
  test("saves only the receipt, and puts the same text back on every later step", async () => {
    const f = await setup();
    const sent = stubAnthropic([
      () => oneCall("msg_1", "toolu_read", "readDocument", { file: "F1" }),
      () => oneCall("msg_2", "toolu_inv", "deviationInventory", { section: "242" }),
      () => textAnswer("msg_3", "The rig notes describe a steady pressure."),
    ]);
    const { threadId } = await f.send("What do the rig notes say?");

    expect(sent).toHaveLength(3);
    // The head lists the file with its handle and the transcript with its own.
    const head = JSON.stringify(sent[0]!.messages[0]);
    expect(head).toContain('F1 | \\"rig-notes.txt\\"');
    expect(head).toContain('T1 | \\"Kickoff interview\\"');
    // Step 1 sent no file text at all: the head carries the 5,000-token slice
    // of part 1 only, never part 2.
    expect(JSON.stringify(sent[0]!.messages)).not.toContain(`${FILE_SENTINEL}_PART_2`);
    const second = resultText(sent[1]!, "toolu_read");
    const third = resultText(sent[2]!, "toolu_read");
    expect(second).toMatch(/^Opened F1 "rig-notes\.txt", part 1 of 2 \(40,000 of 50,000 characters\)\. To read on, call readDocument with part 2\./);
    expect(second).toContain("--- BEGIN [OTHER SUPPORTING MATERIAL] F1 part 1, rig-notes.txt ---");
    expect(second).toContain(`${FILE_SENTINEL}_PART_1`);
    // Identical bytes on every later step, so the step prefix stays cacheable.
    expect(JSON.stringify(toolResult(sent[2]!, "toolu_read")?.content)).toBe(
      JSON.stringify(toolResult(sent[1]!, "toolu_read")?.content)
    );
    expect(third).toBe(second);

    // Stored: the receipt only. Shown: no file text either.
    const rows = JSON.stringify(await f.saved(threadId));
    expect(rows).toContain("Opened F1");
    expect(rows).not.toContain(FILE_SENTINEL);
    const shown = JSON.stringify(await f.visible(threadId));
    expect(shown).not.toContain(FILE_SENTINEL);
    // The browser gets no tool result at all, not even the receipt.
    expect(shown).not.toContain("Opened F1");
  });

  test("holds the per-call and per-turn allowances, and refuses archived and other projects' files", async () => {
    const f = await setup({ fileChars: 300_000 });
    const sent = stubAnthropic([
      // 3 parts is the per-call cap, whatever is asked.
      () => oneCall("msg_1", "toolu_a", "readDocument", { file: "F1", parts: 3 }),
      () => oneCall("msg_2", "toolu_b", "readDocument", { file: "rig-notes.TXT", part: 4, parts: 3 }),
      () =>
        toolAnswer("msg_3", [
          { id: "toolu_c", tool: "readDocument", input: { file: "F1", part: 7 } },
          { id: "toolu_d", tool: "readDocument", input: { file: "archived-notes.txt" } },
          { id: "toolu_e", tool: "readDocument", input: { file: "other-project.txt" } },
          { id: "toolu_f", tool: "readDocument", input: { file: "diagram.png" } },
        ]),
      () => textAnswer("msg_4", "Read what fit."),
    ]);
    await f.send("Read the whole rig notes file.");

    expect(sent).toHaveLength(4);
    const a = resultText(sent[1]!, "toolu_a");
    expect(a).toMatch(/^Opened F1 "rig-notes\.txt", parts 1-3 of 8 \(120,000 of 300,000 characters\)\./);
    expect(a.length).toBeGreaterThan(CHAT_READ_MAX_CALL_CHARS);
    expect(a.length).toBeLessThan(CHAT_READ_MAX_CALL_CHARS + 2_000);
    const b = resultText(sent[2]!, "toolu_b");
    expect(b).toMatch(/^Opened F1 "rig-notes\.txt", parts 4-6 of 8 \(120,000 of 300,000 characters\)\./);
    // 240,000 characters opened: the turn's allowance is spent.
    expect(resultText(sent[3]!, "toolu_c")).toBe(CHAT_READ_BUDGET_USED);
    expect(resultText(sent[3]!, "toolu_d")).toBe(CHAT_READ_NO_FILE);
    expect(resultText(sent[3]!, "toolu_e")).toBe(CHAT_READ_NO_FILE);
    expect(resultText(sent[3]!, "toolu_f")).toContain('F2 "diagram.png" has no text that can be read');
    const request = JSON.stringify(sent[3]!.messages);
    expect(request).not.toContain("ARCHIVED_FICTIONAL_TEXT");
    expect(request).not.toContain("OTHER_PROJECT_FICTIONAL_TEXT");
  });

  test("with the setting off, every reading tool stays registered and says so", async () => {
    const f = await setup({ readingOff: true });
    const sent = stubAnthropic([
      () =>
        toolAnswer("msg_1", [
          { id: "toolu_r", tool: "readDocument", input: { file: "F1" } },
          { id: "toolu_s", tool: "searchDocuments", input: { query: "coolant pressure" } },
          { id: "toolu_t", tool: "readTranscript", input: { transcript: "T1" } },
        ]),
      () => textAnswer("msg_2", "Opening files is off here."),
    ]);
    await f.send("Open the rig notes.");
    const names = (sent[0]!.tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(names.slice(-3)).toEqual(["readDocument", "searchDocuments", "readTranscript"]);
    for (const id of ["toolu_r", "toolu_s", "toolu_t"]) expect(resultText(sent[1]!, id)).toBe(CHAT_READING_OFF);
    // The notice no longer offers readDocument while the setting is off.
    expect(JSON.stringify(sent[0]!.messages[0])).not.toContain("open one with readDocument");
  });
});

describe("searchDocuments and readTranscript", () => {
  test("find and open a transcript by turn, names as written, without storing the words", async () => {
    const f = await setup();
    const sent = stubAnthropic([
      () => oneCall("msg_1", "toolu_s", "searchDocuments", { query: "transcript words" }),
      () => oneCall("msg_2", "toolu_t", "readTranscript", { transcript: "kickoff interview" }),
      () => textAnswer("msg_3", "Dana spoke about the rig."),
    ]);
    const { threadId } = await f.send("What did the client say about the rig?");

    const search = resultText(sent[1]!, "toolu_s");
    expect(search).toMatch(/^Searched this project's files and transcripts: found 1 excerpt\(s\), at T1 turn 1\./);
    expect(search).toContain(`[turn 1, 00:14:32] Client (Dana): ${TRANSCRIPT_SENTINEL} about the rig.`);
    const read = resultText(sent[2]!, "toolu_t");
    expect(read).toMatch(/^Opened T1 "Kickoff interview", turn 1 of 1 \(/);
    expect(read).toContain("--- BEGIN [INTERVIEW TRANSCRIPT] T1 turn 1, Kickoff interview ---");
    expect(read).toContain(`[turn 1, 00:14:32] Client (Dana): ${TRANSCRIPT_SENTINEL} about the rig.`);
    // The search excerpt is still there, the same, on the next step.
    expect(resultText(sent[2]!, "toolu_s")).toBe(search);

    expect(JSON.stringify(await f.saved(threadId))).not.toContain(TRANSCRIPT_SENTINEL);
    expect(JSON.stringify(await f.visible(threadId))).not.toContain(TRANSCRIPT_SENTINEL);
  });
});

describe("turns and passes", () => {
  test("sends the same tools bytes on every turn, and keeps no opened text for the next turn", async () => {
    const f = await setup();
    const sent = stubAnthropic([
      () => textAnswer("msg_1", "First answer."),
      () => oneCall("msg_2", "toolu_read", "readDocument", { file: "F1", part: 2 }),
      () => textAnswer("msg_3", "Second answer."),
      () => textAnswer("msg_4", "Third answer."),
    ]);
    const first = await f.send("First question.");
    await f.send("Second question.", first.threadId);
    await f.send("Third question.", first.threadId);
    expect(sent).toHaveLength(4);
    for (const body of sent.slice(1)) expect(JSON.stringify(body.tools)).toBe(JSON.stringify(sent[0]!.tools));
    expect(JSON.stringify(sent[2]!.messages)).toContain(`${FILE_SENTINEL}_PART_2`);
    // The next turn's history has no tool rows: part 2 is not there.
    expect(JSON.stringify(sent[3]!.messages)).not.toContain(`${FILE_SENTINEL}_PART_2`);
  });

  test("the recovery pass starts clean and shares the turn's allowance", async () => {
    const f = await setup({ fileChars: 300_000 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent = stubAnthropic([
      () => oneCall("msg_1", "toolu_a", "readDocument", { file: "F1", part: 2, parts: 3 }),
      () => oneCall("msg_2", "toolu_b", "readDocument", { file: "F1", part: 5, parts: 3 }),
      () => thinkingOnlyAnswer("msg_3"),
      () => oneCall("msg_4", "toolu_c", "readDocument", { file: "F1", part: 8 }),
      () => textAnswer("msg_5", "Proposed nothing; part 8 is left."),
    ]);
    await f.send("Read the rest of the rig notes.");

    expect(sent).toHaveLength(5);
    expect(resultText(sent[2]!, "toolu_a")).toContain(`${FILE_SENTINEL}_PART_2`);
    // The recovery pass (request 4) carries nothing opened in the first pass.
    const recovery = JSON.stringify(sent[3]!.messages);
    for (const part of [2, 3, 4, 5, 6, 7]) expect(recovery).not.toContain(`${FILE_SENTINEL}_PART_${part}`);
    // The allowance is the turn's: 240,000 characters were opened already.
    expect(resultText(sent[4]!, "toolu_c")).toBe(CHAT_READ_BUDGET_USED);
  });
});
