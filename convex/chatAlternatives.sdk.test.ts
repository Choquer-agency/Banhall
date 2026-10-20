/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

/**
 * Report chat parity, Phase C (2026-10-20), W2: the leak test. After Edit or
 * Regenerate, the model's request carries the active path only: no reply of
 * a sibling alternative, and nothing after an edited message. The production
 * chat action, the agent and the AI SDK's Anthropic provider are real; only
 * `fetch` is stubbed with Anthropic's server-sent events. Fictional data only.
 */

// Review P2-1: a switch that makes the history path read, or the reading of
// its rows, fail for one reply.
const failures = vi.hoisted(() => ({ pathRead: false, pathRows: false }));
vi.mock("./lib/chatPath", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/chatPath")>();
  return {
    ...actual,
    loadChatPath: (...args: Parameters<typeof actual.loadChatPath>) => {
      if (failures.pathRead) throw new Error("synthetic path read failure");
      return actual.loadChatPath(...args);
    },
    onHistoryPath: (...args: Parameters<typeof actual.onHistoryPath>) => {
      if (failures.pathRows) throw new Error("synthetic history read failure");
      return actual.onHistoryPath(...args);
    },
  };
});

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-chat-alternatives-sdk";
const DIRECT_URL = "https://api.anthropic.com/v1/messages";

type Body = Record<string, unknown> & { messages: Array<{ role: string; content: unknown }> };
type Event = Record<string, unknown> & { type: string };

function sse(events: Event[]): Response {
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

function textAnswer(id: string, text: string) {
  return sse([
    {
      type: "message_start",
      message: {
        id, type: "message", role: "assistant", model: "claude-sonnet-5", content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ]);
}

/** Each request answers with the next text, in order. */
function stubAnthropic(texts: string[]): Body[] {
  const sent: Body[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== DIRECT_URL) throw new Error(`Unexpected URL ${request.url}`);
    sent.push(JSON.parse(await request.text()) as Body);
    const text = texts[sent.length - 1];
    if (text === undefined) throw new Error(`Unexpected request ${sent.length}`);
    return textAnswer(`msg_${sent.length}`, text);
  }));
  return sent;
}

/** The conversation part of a request: everything the model reads as messages. */
const conversation = (body: Body) => JSON.stringify(body.messages);
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer", firstName: "Avery", lastName: "Lane" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alternatives project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "alternatives-sdk-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "A fictional report paragraph." }] },
      ] }),
      version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    return { userId, projectId, reportId };
  });
  const actor = t.withIdentity({ subject: authId });
  const first = await actor.mutation(api.chatV2.sendMessage, {
    reportId: ids.reportId, content: "First question QUEBEC.", newThread: true,
  });
  const threadId = first.threadId;
  const run = (promptMessageId: string) =>
    t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: threadId, promptMessageId, reportId: ids.reportId, userId: ids.userId,
    });
  const send = async (content: string) =>
    (await actor.mutation(api.chatV2.sendMessage, { reportId: ids.reportId, content, threadId })).messageId;
  const alternative = async (ofPromptMessageId: string, kind: "edit" | "regenerate", content?: string) =>
    (await actor.mutation(api.chatV2.sendAlternative, {
      threadId, ofPromptMessageId, kind, ...(content !== undefined ? { content } : {}),
    })).messageId;
  return { t, actor, ...ids, threadId, firstPrompt: first.messageId, run, send, alternative };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
});
afterEach(() => {
  failures.pathRead = false;
  failures.pathRows = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the model reads only the active path", () => {
  test("Regenerate: the request has the earlier turns and the prompt once, and no sibling reply", async () => {
    const f = await setup();
    const sent = stubAnthropic(["First reply ALPHA.", "Sibling reply BRAVO.", "Fresh reply CHARLIE."]);
    await f.run(f.firstPrompt);
    const second = await f.send("Second question ROMEO.");
    await f.run(second);
    expect(conversation(sent[1]!)).toContain("First reply ALPHA.");

    const regenerated = await f.alternative(second, "regenerate");
    await f.run(regenerated);
    const request = conversation(sent[2]!);
    expect(request).toContain("First question QUEBEC.");
    expect(request).toContain("First reply ALPHA.");
    expect(count(request, "Second question ROMEO.")).toBe(1);
    expect(request).not.toContain("Sibling reply BRAVO.");

    // The conversation shows the fresh reply, not the sibling's.
    const texts = (await f.actor.query(api.chatV2.listMessages, {
      threadId: f.threadId, paginationOpts: { cursor: null, numItems: 50 }, streamArgs: undefined,
    })).page.map((message) => message.text);
    expect(texts).toContain("Fresh reply CHARLIE.");
    expect(texts).not.toContain("Sibling reply BRAVO.");
  });

  test("Edit of the first message: nothing of the old path reaches the model", async () => {
    const f = await setup();
    const sent = stubAnthropic(["First reply ALPHA.", "Second reply BRAVO.", "Edited reply DELTA."]);
    await f.run(f.firstPrompt);
    const second = await f.send("Second question ROMEO.");
    await f.run(second);

    const edited = await f.alternative(f.firstPrompt, "edit", "First question, edited SIERRA.");
    await f.run(edited);
    const request = conversation(sent[2]!);
    expect(request).toContain("First question, edited SIERRA.");
    for (const gone of ["First question QUEBEC.", "First reply ALPHA.", "Second question ROMEO.", "Second reply BRAVO."]) {
      expect(request).not.toContain(gone);
    }
  });

  test("a send after switching back reads the path it was sent on", async () => {
    const f = await setup();
    const sent = stubAnthropic(["First reply ALPHA.", "Old reply BRAVO.", "New reply CHARLIE.", "Follow-up ECHO."]);
    await f.run(f.firstPrompt);
    const second = await f.send("Second question ROMEO.");
    await f.run(second);
    const regenerated = await f.alternative(second, "regenerate");
    await f.run(regenerated);
    await f.actor.mutation(api.chatV2.setActiveAlternative, { threadId: f.threadId, promptMessageId: second });

    const followUp = await f.send("Follow-up TANGO.");
    await f.run(followUp);
    const request = conversation(sent[3]!);
    expect(request).toContain("Old reply BRAVO.");
    expect(request).not.toContain("New reply CHARLIE.");
    expect(count(request, "Second question ROMEO.")).toBe(1);
  });
});

describe("review P2-1: the history fails closed", () => {
  async function regeneratedWith(failure: keyof typeof failures) {
    const f = await setup();
    const sent = stubAnthropic(["First reply ALPHA.", "Sibling reply BRAVO.", "Fresh reply CHARLIE."]);
    await f.run(f.firstPrompt);
    const second = await f.send("Second question ROMEO.");
    await f.run(second);
    const regenerated = await f.alternative(second, "regenerate");
    vi.spyOn(console, "error").mockImplementation(() => {});
    failures[failure] = true;
    await f.run(regenerated);
    failures[failure] = false;
    return sent;
  }

  test("when the history rows cannot be read, the model reads no history, never a sibling's reply, and is told", async () => {
    const sent = await regeneratedWith("pathRows");
    const request = conversation(sent[2]!);
    expect(request).not.toContain("Sibling reply BRAVO.");
    expect(request).not.toContain("First reply ALPHA.");
    expect(count(request, "Second question ROMEO.")).toBe(1);
    expect(request).toContain("Earlier turns of this conversation are not shown to you");
  });

  test("when the path cannot be read at all, no request carries a sibling's reply", async () => {
    // The turn's other path reads (cards, coverage) fail too, so the reply
    // may not run; whatever is sent holds no hidden alternative.
    const sent = await regeneratedWith("pathRead");
    for (const body of sent.slice(2)) expect(conversation(body)).not.toContain("Sibling reply BRAVO.");
  });
});
