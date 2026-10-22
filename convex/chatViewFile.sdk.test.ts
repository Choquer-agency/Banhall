/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { CHAT_MAX_OUTPUT_TOKENS } from "./ai/chatAgentV2";
import { CHAT_VIEW_BUDGET_USED, CHAT_VIEW_OFF, chatViewTooBig, chatViewTooManyPages } from "./ai/chatDocumentTools";
import { CHAT_VISION_KEY } from "./appSettings";
import { CHAT_PIN_UNAVAILABLE, CHAT_PINS_TOO_MANY } from "./lib/chatPins";
import { toBase64 } from "./lib/chatMedia";

/**
 * Report chat parity, Phase C (2026-10-20), W1: viewFile and pinned files at
 * the real request/response boundary. The chat action, the agent, the AI
 * SDK's Anthropic provider and the tools are real; only `fetch` is stubbed
 * with Anthropic's server-sent events (the harness of
 * chatDocumentTools.sdk.test.ts). Every name, byte and text is fictional.
 */

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-chat-viewing";
const DIRECT_URL = "https://api.anthropic.com/v1/messages";

type Block = Record<string, unknown>;
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

function thinkingOnlyAnswer(id: string): Response {
  return sse([
    messageStart(id),
    ...thinking(id),
    { type: "message_delta", delta: { stop_reason: "max_tokens", stop_sequence: null }, usage: { output_tokens: CHAT_MAX_OUTPUT_TOKENS } },
    { type: "message_stop" },
  ]);
}

/** Answers each Anthropic request with the next answer, recording each body and its beta header. */
function stubAnthropic(answers: Array<() => Response>): { bodies: Body[]; betas: string[] } {
  const bodies: Body[] = [];
  const betas: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== DIRECT_URL) return new Response("unavailable", { status: 503 });
    bodies.push(JSON.parse(await request.text()) as Body);
    betas.push(request.headers.get("anthropic-beta") ?? "");
    const answer = answers[bodies.length - 1];
    if (!answer) throw new Error(`Unexpected request ${bodies.length}`);
    return answer();
  }));
  return { bodies, betas };
}

function toolResult(body: Body, toolUseId: string): Block | undefined {
  for (const message of body.messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content as Block[]) {
      if (block.type === "tool_result" && block.tool_use_id === toolUseId) return block;
    }
  }
  return undefined;
}

function resultText(body: Body, toolUseId: string): string {
  const content = toolResult(body, toolUseId)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return (content as Block[]).map((part) => String(part.text ?? "")).join("");
  return JSON.stringify(content);
}

/** Every content block of the request, in order. */
function blocks(body: Body): Block[] {
  return body.messages.flatMap((message) => (Array.isArray(message.content) ? (message.content as Block[]) : []));
}

/**
 * The agent stores a file part of a saved message in its own files table
 * (convex/storageSweep.test.ts). Nothing of a view or a pin may be saved
 * that way: no saved row has a file id or an image or file part.
 */
function expectNoAgentFiles(saved: unknown): void {
  const page = (saved as { page: Array<{ fileIds?: string[]; message?: { content?: unknown } }> }).page;
  expect(page.length).toBeGreaterThan(0);
  for (const row of page) {
    expect(row.fileIds ?? []).toEqual([]);
    const content = row.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as Block[]) expect(["image", "file"]).not.toContain(part.type);
  }
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string) => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });

/** Fictional image bytes: a PNG signature, then a sentinel. */
/** A PNG signature and a 640 by 480 IHDR, then a sentinel. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 2, 128, 0, 0, 1, 224, 8, 6, 0, 0, 0, 1, 2, 3, 4,
  ...new TextEncoder().encode("FICTIONAL_FIGURE_PIXELS"),
]);
const PDF = new TextEncoder().encode("%PDF-1.4\nFICTIONAL_SCAN_PAGES\n%%EOF\n");
const PNG_DATA = toBase64(PNG);
const PDF_DATA = toBase64(PDF);
const DEEP_SENTINEL = "FICTIONAL_PINNED_DEEP_TEXT";

async function setup(options: { visionOff?: boolean } = {}) {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Viewing project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "viewing-token", createdAt: now, updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Other project", clientName: "Other", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "other-token", createdAt: now, updatedAt: now,
    });
    const store = (bytes: Uint8Array<ArrayBuffer>, type: string) => ctx.storage.store(new Blob([bytes], { type }));
    const file = (fileName: string, extra: Record<string, unknown> = {}, project = projectId) =>
      ctx.db.insert("projectDocuments", {
        projectId: project, fileName, fileType: "txt", content: "", source: "upload", uploadedBy: "writer",
        uploaderRole: "writer", category: "other", createdAt: now, ...extra,
      });
    // The pinned text: its sentinel sits past the head's slice of the file.
    const notesId = await file("rig-notes.txt", { content: `${"The fictional rig ran steady. ".repeat(2_000)}${DEEP_SENTINEL}` });
    const figureId = await file("figure.png", {
      fileType: "image", processingStatus: "reference_only", storageId: await store(PNG, "image/png"), mimeType: "image/png",
    });
    // Stored counts, each taken from the original the row holds.
    const scanStorage = await store(PDF, "application/pdf");
    const scanId = await file("scan.pdf", {
      fileType: "pdf", processingStatus: "could_not_read", storageId: scanStorage, pageCount: 2, pageCountStorageId: scanStorage,
    });
    const longStorage = await store(PDF, "application/pdf");
    await file("long.pdf", { fileType: "pdf", content: "Long text.", storageId: longStorage, pageCount: 31, pageCountStorageId: longStorage });
    const big = new Uint8Array(3_750_001);
    big.set(PNG);
    await file("big.png", { fileType: "image", storageId: await store(big, "image/png") });
    const archivedId = await file("archived.txt", { content: "Archived.", archived: true });
    const otherId = await file("other.txt", { content: "Other." }, otherProjectId);
    if (options.visionOff) {
      await ctx.db.insert("appSettings", { key: CHAT_VISION_KEY, value: "off", updatedAt: now, updatedBy: userId });
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
    return { userId, projectId, reportId, notesId, figureId, scanId, archivedId, otherId };
  });
  const actor = t.withIdentity({ subject: authId });
  /** Send through the real mutation, then run the reply it scheduled, with its own arguments. */
  const send = async (content: string, pinnedDocumentIds?: Id<"projectDocuments">[]) => {
    const sent = await actor.mutation(api.chatV2.sendMessage, {
      reportId: ids.reportId,
      content,
      newThread: true,
      ...(pinnedDocumentIds ? { pinnedDocumentIds } : {}),
    });
    const turn = await t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
          q.eq("agentThreadId", sent.threadId).eq("promptMessageId", sent.messageId)
        )
        .unique()
    );
    await t.action(internal.ai.chatAgentV2.streamChatReply, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, reportId: ids.reportId, userId: ids.userId,
      ...(turn?.pinnedDocumentIds ? { pinnedDocumentIds: turn.pinnedDocumentIds } : {}),
    });
    return { ...sent, turn };
  };
  const saved = async (threadId: string) =>
    await t.query(components.agent.messages.listMessagesByThreadId, { threadId, order: "asc" });
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

describe("viewFile", () => {
  test("sends an image and a PDF inside the tool results, the same bytes on every later step, and saves only receipts", async () => {
    const f = await setup();
    const { bodies, betas } = stubAnthropic([
      () =>
        toolAnswer("msg_1", [
          { id: "toolu_img", tool: "viewFile", input: { file: "figure.png" } },
          { id: "toolu_pdf", tool: "viewFile", input: { file: "scan.pdf" } },
        ]),
      () => toolAnswer("msg_2", [{ id: "toolu_inv", tool: "deviationInventory", input: { section: "242" } }]),
      () => textAnswer("msg_3", "The figure shows a fictional loop."),
    ]);
    const { threadId } = await f.send("What does the figure show?");

    expect(bodies).toHaveLength(3);
    // Appended last, on every turn.
    expect((bodies[0]!.tools as Array<{ name: string }>).map((tool) => tool.name).slice(-4)).toEqual([
      "readDocument", "searchDocuments", "readTranscript", "viewFile",
    ]);
    // The files list marks what viewFile can show.
    const head = JSON.stringify(bodies[0]!.messages[0]);
    expect(head).toContain("original image kept, viewFile can show it");
    expect(head).toContain("original PDF kept, viewFile can show its pages");

    const image = toolResult(bodies[1]!, "toolu_img")!;
    const imageParts = image.content as Block[];
    expect(imageParts.map((part) => part.type)).toEqual(["text", "image", "text"]);
    expect(String(imageParts[0]!.text)).toMatch(/^Viewed F\d "figure\.png", an image \(1 KB\)\. It is shown to you for this reply only\.\n\n--- BEGIN \[OTHER SUPPORTING MATERIAL\] F\d, figure\.png ---$/);
    expect(imageParts[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_DATA } });
    const pdfParts = toolResult(bodies[1]!, "toolu_pdf")!.content as Block[];
    expect(pdfParts[1]).toEqual({ type: "document", source: { type: "base64", media_type: "application/pdf", data: PDF_DATA } });
    expect(betas[1]).toContain("pdfs-2024-09-25");
    // No cache breakpoint on the media or their results: the chat's four are taken.
    for (const id of ["toolu_img", "toolu_pdf"]) {
      expect(JSON.stringify(toolResult(bodies[1]!, id))).not.toContain("cache_control");
      expect(JSON.stringify(toolResult(bodies[2]!, id))).not.toContain("cache_control");
    }
    // Identical bytes on the later step.
    for (const id of ["toolu_img", "toolu_pdf"]) {
      expect(JSON.stringify(toolResult(bodies[2]!, id))).toBe(JSON.stringify(toolResult(bodies[1]!, id)));
    }

    // Stored and shown: receipts only, never the bytes.
    const savedRows = await f.saved(threadId);
    expectNoAgentFiles(savedRows);
    const rows = JSON.stringify(savedRows);
    expect(rows).toContain('Viewed F');
    for (const data of [PNG_DATA, PDF_DATA, "FICTIONAL_FIGURE_PIXELS", "FICTIONAL_SCAN_PAGES"]) {
      expect(rows).not.toContain(data);
    }
    const shown = JSON.stringify(await f.visible(threadId));
    expect(shown).not.toContain(PNG_DATA);
    expect(shown).not.toContain("Viewed F");
  });

  // Review R1 P3-5: a count taken from another original is not trusted.
  test("counts a PDF's pages on its first view of a new original, ignoring a stale count, and stores it", async () => {
    const f = await setup();
    // A valid two-page PDF (the PDF of chatPdfPages.test.ts), put in place of
    // the original the stored count of 31 pages was taken from.
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
    pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    await f.t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([new TextEncoder().encode(pdf)], { type: "application/pdf" }));
      await ctx.db.patch(f.scanId, { storageId, pageCount: 31 });
    });
    const { bodies } = stubAnthropic([
      () => toolAnswer("msg_1", [{ id: "toolu_pdf", tool: "viewFile", input: { file: "scan.pdf" } }]),
      () => textAnswer("msg_2", "Two pages."),
    ]);
    await f.send("How many pages does the scan have?");
    expect(resultText(bodies[1]!, "toolu_pdf")).toMatch(/^Viewed F\d "scan\.pdf", a PDF of 2 page\(s\) \(1 KB\)\./);
    const stored = await f.t.run(async (ctx) => await ctx.db.get(f.scanId));
    expect(stored?.pageCount).toBe(2);
    expect(stored?.pageCountStorageId).toBe(stored?.storageId);
  });

  test("gives each cap's fixed text", async () => {
    const f = await setup();
    const { bodies } = stubAnthropic([
      () =>
        toolAnswer("msg_1", [
          { id: "toolu_big", tool: "viewFile", input: { file: "big.png" } },
          { id: "toolu_long", tool: "viewFile", input: { file: "long.pdf" } },
          { id: "toolu_txt", tool: "viewFile", input: { file: "rig-notes.txt" } },
        ]),
      () => textAnswer("msg_2", "Some files were too large."),
    ]);
    await f.send("Look at the big files.");
    const ref = (name: string) => {
      // A files list row reads `F5 | "big.png" | ...`.
      const match = new RegExp(`(F\\d+) \\| \\\\"${name.replace(".", "\\.")}\\\\"`).exec(JSON.stringify(bodies[0]!.messages[0]));
      return `${match![1]} "${name}"`;
    };
    expect(resultText(bodies[1]!, "toolu_big")).toBe(chatViewTooBig(ref("big.png"), "image", 3_750_001));
    expect(resultText(bodies[1]!, "toolu_long")).toBe(chatViewTooManyPages(ref("long.pdf"), 31));
    expect(resultText(bodies[1]!, "toolu_txt")).toBe(
      `${ref("rig-notes.txt")} is not a PDF or an image whose original file is kept, so viewFile cannot show it. Use readDocument for its text.`
    );
  });

  test("with the setting off, viewFile stays registered, says so, and the list offers nothing", async () => {
    const f = await setup({ visionOff: true });
    const { bodies } = stubAnthropic([
      () => toolAnswer("msg_1", [{ id: "toolu_v", tool: "viewFile", input: { file: "figure.png" } }]),
      () => textAnswer("msg_2", "Viewing is off."),
    ]);
    await f.send("Show me the figure.");
    expect((bodies[0]!.tools as Array<{ name: string }>).at(-1)?.name).toBe("viewFile");
    expect(resultText(bodies[1]!, "toolu_v")).toBe(CHAT_VIEW_OFF);
    expect(JSON.stringify(bodies[0]!.messages[0])).not.toContain("kept, viewFile can show");
  });
});

describe("pinned files", () => {
  test("go after the options note, are never stored, and come back on the recovery pass", async () => {
    const f = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { bodies } = stubAnthropic([
      () => thinkingOnlyAnswer("msg_1"),
      () => textAnswer("msg_2", "The pinned figure and notes agree."),
    ]);
    const { threadId, turn } = await f.send("Compare the figure with the notes.", [f.figureId, f.notesId, f.figureId]);
    // De-duplicated and stored as ids only.
    expect(turn?.pinnedDocumentIds).toEqual([f.figureId, f.notesId]);

    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const all = blocks(body);
      const texts = all.map((block) => String(block.text ?? ""));
      const note = texts.findIndex((text) => text.includes("Options for this reply"));
      const intro = texts.findIndex((text) => text.startsWith("The writer pinned these project files to this message"));
      expect(note).toBeGreaterThanOrEqual(0);
      expect(intro).toBeGreaterThan(note);
      expect(texts[intro]).toMatch(/: F\d "figure\.png" \(an image\); F\d "rig-notes\.txt" \(text\)\.$/);
      const image = all.find((block) => block.type === "image");
      expect(image).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_DATA } });
      expect(JSON.stringify(image)).not.toContain("cache_control");
      expect(JSON.stringify(body.messages)).toContain(DEEP_SENTINEL);
    }

    const savedRows = await f.saved(threadId);
    expectNoAgentFiles(savedRows);
    const rows = JSON.stringify(savedRows);
    expect(rows).not.toContain(PNG_DATA);
    expect(rows).not.toContain(DEEP_SENTINEL);
    expect(JSON.stringify(await f.visible(threadId))).not.toContain(DEEP_SENTINEL);

    // The writer's message shows the pinned files' names.
    const turns = await f.actor.query(api.chatV2.listTurns, { threadId });
    expect(turns[0]?.pinnedFiles).toEqual([
      { documentId: f.figureId, name: "figure.png" },
      { documentId: f.notesId, name: "rig-notes.txt" },
    ]);
  });

  test("share the turn's media allowance with viewFile", async () => {
    const f = await setup();
    const { bodies } = stubAnthropic([
      () => toolAnswer("msg_1", [{ id: "toolu_v", tool: "viewFile", input: { file: "figure.png" } }]),
      () => textAnswer("msg_2", "Seen."),
    ]);
    await f.t.run(async (ctx) => {
      // Fill the allowance: a pinned PDF of nearly 8 MB.
      const bytes = new Uint8Array(8_000_000 - 4);
      bytes.set(new TextEncoder().encode("%PDF-"));
      const storageId = await ctx.storage.store(new Blob([bytes], { type: "application/pdf" }));
      await ctx.db.patch(f.scanId, { storageId, pageCountStorageId: storageId });
    });
    await f.send("Read the scan and the figure.", [f.scanId]);
    expect(blocks(bodies[0]!).some((block) => block.type === "document")).toBe(true);
    expect(resultText(bodies[1]!, "toolu_v")).toBe(CHAT_VIEW_BUDGET_USED);
  });

  test("a send refuses more than 5, archived files and other projects' files", async () => {
    const f = await setup();
    const more = await f.t.run(async (ctx) =>
      await Promise.all(
        ["a", "b", "c", "d", "e"].map((name) =>
          ctx.db.insert("projectDocuments", {
            projectId: f.projectId, fileName: `${name}.txt`, fileType: "txt", content: name, source: "upload",
            uploadedBy: "writer", createdAt: Date.now(),
          })
        )
      )
    );
    const attempt = (pinnedDocumentIds: Id<"projectDocuments">[]) =>
      f.actor.mutation(api.chatV2.sendMessage, { reportId: f.reportId, content: "Read these.", newThread: true, pinnedDocumentIds });
    await expect(attempt([f.notesId, ...more])).rejects.toThrow(CHAT_PINS_TOO_MANY);
    await expect(attempt([f.archivedId])).rejects.toThrow(CHAT_PIN_UNAVAILABLE);
    await expect(attempt([f.otherId])).rejects.toThrow(CHAT_PIN_UNAVAILABLE);
    // Nothing was written by a refused send.
    expect(await f.t.run(async (ctx) => await ctx.db.query("chatTurns").take(1))).toEqual([]);
  });
});
