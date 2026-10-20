import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import type { Id } from "../_generated/dataModel";
import {
  CHAT_READ_FAILED,
  CHAT_READ_MAX_TURN_CHARS,
  CHAT_READING_OFF,
  CHAT_VIEW_BUDGET_USED,
  CHAT_VIEW_OFF,
  chatReadNoText,
  chatViewNotMedia,
  chatViewTooBig,
  chatViewTooManyPages,
  chatViewUnreadable,
  newDocumentReadTurn,
  pinnedFilesMessage,
  releaseMedia,
  reserveMedia,
  runReadDocument,
  runViewFile,
  withOpenedText,
  type OpenedMediaPart,
  type ViewingToolCtx,
} from "./chatDocumentTools";
import { buildChatEvidence, type ChatEvidenceDoc } from "./chatEvidence";
import {
  CHAT_VIEW_MAX_IMAGES,
  CHAT_VIEW_MAX_TURN_BYTES,
  formatBytes,
  sniffChatMedia,
  toBase64,
} from "../lib/chatMedia";
import { findDashConnectors } from "../../shared/humanProse";
import * as tools from "./chatDocumentTools";

/**
 * Chat parity Phase C (2026-10-20), W1: viewFile's body, the media
 * allowance, the step injection of media and the pinned files message, with
 * the reads, the page count and storage stubbed. Every name is fictional.
 */

const docId = (value: string) => value as Id<"projectDocuments">;
const storageId = (value: string) => value as Id<"_storage">;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const PDF = new TextEncoder().encode("%PDF-1.4\nfictional pdf body\n%%EOF\n");

const doc = (fileName: string, over: Partial<ChatEvidenceDoc> = {}): ChatEvidenceDoc => ({
  fileName,
  content: "",
  documentId: docId(`doc-${fileName}`),
  category: "other",
  hasOriginal: true,
  ...over,
});

function turnWith(documents: ChatEvidenceDoc[], over: { chatVision?: boolean; documentTools?: boolean } = {}) {
  return newDocumentReadTurn({ documents, transcripts: [], ...over });
}

type Stored = { bytes: Uint8Array<ArrayBuffer>; size?: number; pageCount?: number; fileName?: string };

/**
 * A ctx whose viewFileForChat answers from `files` (by document id), whose
 * page count action answers `counted`, and whose storage serves the bytes.
 */
function viewingCtx(files: Record<string, Stored>, options: { counted?: number | null; status?: string } = {}) {
  const queries: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];
  const reads: string[] = [];
  const ctx: ViewingToolCtx = {
    threadId: "thread-1",
    runQuery: (async (_ref: unknown, args: Record<string, unknown>) => {
      queries.push(args);
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (options.status) return { status: options.status, fileName: "x" };
      const id = String(args.documentId);
      const file = files[id];
      if (!file) return { status: "not_found" };
      const name = file.fileName ?? id.replace(/^doc-/, "");
      const pdf = name.endsWith(".pdf");
      return {
        status: "ok",
        fileName: name,
        kind: pdf ? "pdf" : "image",
        mediaType: pdf ? "application/pdf" : name.endsWith(".png") ? "image/png" : "image/jpeg",
        storageId: storageId(`st-${id}`),
        size: file.size ?? file.bytes.length,
        ...(file.pageCount !== undefined ? { pageCount: file.pageCount } : {}),
        category: "other",
      };
    }) as unknown as ViewingToolCtx["runQuery"],
    runAction: (async (_ref: unknown, args: Record<string, unknown>) => {
      actions.push(args);
      return options.counted === undefined ? 3 : options.counted;
    }) as unknown as ViewingToolCtx["runAction"],
    storage: {
      get: (async (id: string) => {
        reads.push(id);
        const file = files[id.replace(/^st-/, "")];
        return file ? new Blob([file.bytes]) : null;
      }) as unknown as ViewingToolCtx["storage"]["get"],
    },
  };
  return { ctx, queries, actions, reads };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("media helpers", () => {
  it("encode base64 exactly as the platform does, at every length", () => {
    for (let length = 0; length < 70; length += 1) {
      const bytes = new Uint8Array(length).map((_, index) => (index * 37 + 11) & 255);
      expect(toBase64(bytes)).toBe(btoa(String.fromCharCode(...bytes)));
    }
    const large = new Uint8Array(200_003).map((_, index) => (index * 13) & 255);
    expect(toBase64(large)).toBe(Buffer.from(large).toString("base64"));
  });

  it("tell the media type from the bytes, not the name", () => {
    expect(sniffChatMedia(PNG)).toBe("image/png");
    expect(sniffChatMedia(JPEG)).toBe("image/jpeg");
    expect(sniffChatMedia(PDF)).toBe("application/pdf");
    expect(sniffChatMedia(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    expect(sniffChatMedia(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffChatMedia(new TextEncoder().encode("plain text"))).toBeNull();
  });

  it("say sizes in plain words", () => {
    expect(formatBytes(840_000)).toBe("840 KB");
    expect(formatBytes(2_400_000)).toBe("2.4 MB");
    expect(formatBytes(8_000_000)).toBe("8 MB");
  });
});

describe("the turn's media allowance", () => {
  it("is taken synchronously, so parallel views never pass it together", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith([doc("a.png", { fileType: "image" }), doc("b.png", { fileType: "image" }), doc("c.png", { fileType: "image" })]);
    turn.media.bytes = CHAT_VIEW_MAX_TURN_BYTES - 30;
    const { ctx, queries } = viewingCtx({
      "doc-a.png": { bytes: PNG, size: 12 },
      "doc-b.png": { bytes: PNG, size: 12 },
      "doc-c.png": { bytes: PNG, size: 12 },
    });
    const results = await Promise.all(
      ["F1", "F2", "F3"].map((file, index) => runViewFile(ctx, { file }, { toolCallId: `v${index}` }, turn))
    );
    // 30 bytes left: the first call took all of it before any await, so the
    // other two were refused at once; the first then gave back what it did
    // not use.
    expect(queries).toHaveLength(1);
    expect(results[0]).toMatch(/^Viewed F1 "a\.png", an image/);
    expect(results[1]).toBe(CHAT_VIEW_BUDGET_USED);
    expect(results[2]).toBe(CHAT_VIEW_BUDGET_USED);
    expect(turn.media.bytes).toBe(CHAT_VIEW_MAX_TURN_BYTES - 30 + PNG.length);
    expect(turn.media.images).toBe(1);
  });

  it("counts images apart from bytes, and gives both back when nothing was sent", () => {
    const turn = turnWith([]);
    turn.media.images = CHAT_VIEW_MAX_IMAGES - 1;
    const grant = reserveMedia(turn, "image", 5_000_000)!;
    expect(grant).toEqual({ bytes: 5_000_000, image: true });
    expect(reserveMedia(turn, "image", 10)).toBeNull();
    // A PDF does not count as an image.
    expect(reserveMedia(turn, "pdf", 1_000)).toEqual({ bytes: 1_000, image: false });
    releaseMedia(turn, grant, 0);
    expect(turn.media).toEqual({ bytes: 1_000, images: CHAT_VIEW_MAX_IMAGES - 1 });
  });
});

describe("viewFile", () => {
  it("returns a receipt and keeps the receipt and media, in markers, for the step injection", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith([doc("diagram.png", { fileType: "image" })]);
    // Named .png, holds a JPEG: sent as what the bytes are.
    const { ctx, reads } = viewingCtx({ "doc-diagram.png": { bytes: JPEG } });
    const receipt = await runViewFile(ctx, { file: "F1" }, { toolCallId: "call-1" }, turn);
    expect(receipt).toBe('Viewed F1 "diagram.png", an image (1 KB). It is shown to you for this reply only.');
    expect(reads).toEqual(["st-doc-diagram.png"]);
    const kept = turn.opened.get("call-1") as OpenedMediaPart[];
    expect(kept).toEqual([
      { type: "text", text: `${receipt}\n\n--- BEGIN [OTHER SUPPORTING MATERIAL] F1, diagram.png ---` },
      { type: "image-data", data: toBase64(JPEG), mediaType: "image/jpeg" },
      { type: "text", text: "--- END [OTHER SUPPORTING MATERIAL] F1, diagram.png ---" },
    ]);
    expect(info).toHaveBeenCalledWith("chat file view", { tool: "viewFile", kind: "image", bytes: JPEG.length, pages: 0 });
    expect(JSON.stringify(info.mock.calls)).not.toContain("diagram");
  });

  it("counts a PDF's pages on the server when the count is unknown, and refuses one with too many", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith([doc("scan.pdf", { fileType: "pdf" }), doc("long.pdf", { fileType: "pdf" })]);
    const counted = viewingCtx({ "doc-scan.pdf": { bytes: PDF } }, { counted: 4 });
    const receipt = await runViewFile(counted.ctx, { file: "scan.pdf" }, { toolCallId: "p" }, turn);
    expect(counted.actions).toEqual([{ documentId: "doc-scan.pdf", storageId: "st-doc-scan.pdf" }]);
    expect(receipt).toMatch(/^Viewed F1 "scan\.pdf", a PDF of 4 page\(s\) \(1 KB\)\./);
    expect((turn.opened.get("p") as OpenedMediaPart[])[1]).toEqual({
      type: "file-data",
      data: toBase64(PDF),
      mediaType: "application/pdf",
    });

    const stored = viewingCtx({ "doc-long.pdf": { bytes: PDF, pageCount: 31 } });
    expect(await runViewFile(stored.ctx, { file: "F2" }, { toolCallId: "q" }, turn)).toBe(
      chatViewTooManyPages('F2 "long.pdf"', 31)
    );
    expect(stored.actions).toHaveLength(0);
    expect(stored.reads).toHaveLength(0);
    const unreadable = viewingCtx({ "doc-long.pdf": { bytes: PDF } }, { counted: null });
    expect(await runViewFile(unreadable.ctx, { file: "F2" }, { toolCallId: "r" }, turn)).toBe(chatViewUnreadable('F2 "long.pdf"'));
    expect(turn.opened.has("q")).toBe(false);
    expect(turn.opened.has("r")).toBe(false);
  });

  it("holds the per-file caps and gives fixed texts", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith([
      doc("big.png", { fileType: "image" }),
      doc("big.pdf", { fileType: "pdf" }),
      doc("notes.txt", { fileType: "txt", content: "Notes." }),
      doc("lost.png", { fileType: "image", hasOriginal: false }),
      doc("fake.png", { fileType: "image" }),
    ]);
    const { ctx } = viewingCtx({
      "doc-big.png": { bytes: PNG, size: 5_000_001 },
      "doc-big.pdf": { bytes: PDF, size: 8_000_001, pageCount: 2 },
      "doc-fake.png": { bytes: new TextEncoder().encode("not an image") },
    });
    expect(await runViewFile(ctx, { file: "big.png" }, { toolCallId: "a" }, turn)).toBe(
      chatViewTooBig('F1 "big.png"', "image", 5_000_001)
    );
    expect(chatViewTooBig('F1 "big.png"', "image", 5_000_001)).toBe('F1 "big.png" is too large to view (5 MB). Images can be at most 5 MB.');
    expect(await runViewFile(ctx, { file: "big.pdf" }, { toolCallId: "b" }, turn)).toBe(
      'F2 "big.pdf" is too large to view (8 MB). PDFs can be at most 8 MB. Use readDocument for its text instead.'
    );
    expect(await runViewFile(ctx, { file: "notes.txt" }, { toolCallId: "c" }, turn)).toBe(chatViewNotMedia('F3 "notes.txt"'));
    expect(await runViewFile(ctx, { file: "lost.png" }, { toolCallId: "d" }, turn)).toBe(chatViewNotMedia('F4 "lost.png"'));
    expect(await runViewFile(ctx, { file: "fake.png" }, { toolCallId: "e" }, turn)).toBe(chatViewUnreadable('F5 "fake.png"'));
    expect(turn.opened.size).toBe(0);
    expect(turn.media).toEqual({ bytes: 0, images: 0 });
  });

  it("stops at the turn's image count", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith([doc("a.png", { fileType: "image" })]);
    turn.media.images = CHAT_VIEW_MAX_IMAGES;
    const { ctx, queries } = viewingCtx({ "doc-a.png": { bytes: PNG } });
    expect(await runViewFile(ctx, { file: "F1" }, { toolCallId: "a" }, turn)).toBe(CHAT_VIEW_BUDGET_USED);
    expect(queries).toHaveLength(0);
  });

  it("says off when reading or viewing is off, and when the server says so", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const files = [doc("a.png", { fileType: "image" })];
    const { ctx } = viewingCtx({ "doc-a.png": { bytes: PNG } });
    expect(await runViewFile(ctx, { file: "F1" }, { toolCallId: "a" }, newDocumentReadTurn())).toBe(CHAT_READING_OFF);
    expect(await runViewFile(ctx, { file: "F1" }, { toolCallId: "a" }, turnWith(files, { documentTools: false }))).toBe(CHAT_READING_OFF);
    expect(await runViewFile(ctx, { file: "F1" }, { toolCallId: "a" }, turnWith(files, { chatVision: false }))).toBe(CHAT_VIEW_OFF);
    const server = viewingCtx({}, { status: "vision_off" });
    expect(await runViewFile(server.ctx, { file: "F1" }, { toolCallId: "a" }, turnWith(files))).toBe(CHAT_VIEW_OFF);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = viewingCtx({ "doc-a.png": { bytes: PNG } });
    broken.ctx.storage.get = (async () => {
      throw new Error("storage down");
    }) as unknown as ViewingToolCtx["storage"]["get"];
    const turn = turnWith(files);
    expect(await runViewFile(broken.ctx, { file: "F1" }, { toolCallId: "a" }, turn)).toBe(CHAT_READ_FAILED);
    expect(turn.media).toEqual({ bytes: 0, images: 0 });
  });

  it("points readDocument at viewFile for a viewable file with no text", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith([doc("scan.pdf", { fileType: "pdf" }), doc("photo.png", { fileType: "image" })]);
    const { ctx } = viewingCtx({});
    expect(await runReadDocument(ctx, { file: "F1" }, { toolCallId: "a" }, turn)).toBe(
      'F1 "scan.pdf" has no text that can be read (for example an image or a scan), so readDocument cannot open it. viewFile can show you its pages.'
    );
    expect(chatReadNoText('F2 "photo.png"', "image")).toMatch(/viewFile can show you the image\.$/);
    // With viewing off it does not offer viewFile.
    const off = turnWith([doc("scan.pdf", { fileType: "pdf" })], { chatVision: false });
    expect(await runReadDocument(ctx, { file: "F1" }, { toolCallId: "b" }, off)).toBe(chatReadNoText('F1 "scan.pdf"'));
  });
});

describe("withOpenedText", () => {
  it("puts the receipt and media back as content parts, the same object on every step", () => {
    const turn = turnWith([]);
    const parts: OpenedMediaPart[] = [
      { type: "text", text: "Viewed F1." },
      { type: "image-data", data: "AAAA", mediaType: "image/png" },
    ];
    turn.opened.set("call-1", parts);
    const messages: ModelMessage[] = [
      { role: "user", content: "Look at the figure." },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "call-1", toolName: "viewFile", output: { type: "text", value: "Viewed F1." } }],
      },
    ];
    const first = withOpenedText(messages, turn, [{}]);
    const second = withOpenedText(messages, turn, [{}, {}]);
    const output = (list: ModelMessage[]) => (list[1]!.content as Array<{ output: unknown }>)[0]!.output;
    expect(output(first)).toEqual({ type: "content", value: parts });
    expect((output(second) as { value: unknown }).value).toBe(parts);
    // A new pass starts clean.
    expect(withOpenedText(messages, turn, [])).toBe(messages);
    expect(turn.opened.size).toBe(0);
  });
});

describe("pinned files", () => {
  const documents = [
    doc("notes.txt", { fileType: "txt", content: "Pinned fictional notes.", hasOriginal: false }),
    doc("figure.png", { fileType: "image" }),
    doc("scan.pdf", { fileType: "pdf", content: "Scan text." }),
  ];

  it("sends PDFs and images as files and other files as text, after an intro naming them", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith(documents);
    const { ctx } = viewingCtx({ "doc-figure.png": { bytes: PNG }, "doc-scan.pdf": { bytes: PDF, pageCount: 2 } });
    const message = await pinnedFilesMessage(
      ctx,
      "thread-1",
      [docId("doc-notes.txt"), docId("doc-figure.png"), docId("doc-scan.pdf"), docId("doc-notes.txt")],
      turn,
      documents
    );
    expect(message?.role).toBe("user");
    const content = message!.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({
      type: "text",
      text: 'The writer pinned these project files to this message so you read them in full. They are below, for this reply only, and you do not need to open them: F1 "notes.txt" (text); F2 "figure.png" (an image); F3 "scan.pdf" (a PDF of 2 page(s)).',
    });
    expect(content[1]).toEqual({
      type: "text",
      text: "--- BEGIN [OTHER SUPPORTING MATERIAL] F1, pinned, notes.txt ---\nPinned fictional notes.\n--- END [OTHER SUPPORTING MATERIAL] F1, pinned, notes.txt ---",
    });
    expect(content[3]).toEqual({ type: "file", data: toBase64(PNG), mediaType: "image/png" });
    expect(content[6]).toEqual({ type: "file", data: toBase64(PDF), mediaType: "application/pdf" });
    expect(content).toHaveLength(8);
    expect(turn.used).toBe("Pinned fictional notes.".length);
    expect(turn.media).toEqual({ bytes: PNG.length + PDF.length, images: 1 });
  });

  it("falls back to text when viewing is off or a PDF is too long, and names what it cannot show", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const off = turnWith(documents, { chatVision: false });
    const { ctx } = viewingCtx({ "doc-scan.pdf": { bytes: PDF, pageCount: 40 } });
    const message = await pinnedFilesMessage(ctx, "thread-1", [docId("doc-figure.png"), docId("doc-scan.pdf"), docId("doc-gone")], off, documents);
    const text = JSON.stringify(message);
    expect(text).toContain('F2 \\"figure.png\\" has no text, and viewing PDFs and images is turned off, so it is not shown.');
    expect(text).toContain('F3 \\"scan.pdf\\" (text, because viewing PDFs and images is turned off)');
    expect(text).toContain("One pinned file is no longer in this project's files, so it is not shown.");
    expect(text).not.toContain('"type":"file"');

    const on = turnWith(documents);
    const long = await pinnedFilesMessage(ctx, "thread-1", [docId("doc-scan.pdf")], on, documents);
    expect(JSON.stringify(long)).toContain("(text, because it has 40 pages, more than the 30 that can be shown)");
  });

  it("shares the reading allowance and cuts with a notice", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const big = [doc("long.txt", { fileType: "txt", content: "x".repeat(300_000), hasOriginal: false })];
    const turn = turnWith(big);
    turn.used = CHAT_READ_MAX_TURN_CHARS - 50_000;
    const { ctx } = viewingCtx({});
    const message = await pinnedFilesMessage(ctx, "thread-1", [docId("doc-long.txt")], turn, big);
    const text = JSON.stringify(message);
    expect(text).toContain(
      'F1 \\"long.txt\\" is cut at 50,000 of 300,000 characters because this reply\'s reading allowance ran out. To read on, call readDocument with part 2.'
    );
    expect(turn.used).toBe(CHAT_READ_MAX_TURN_CHARS);
  });

  it("sends nothing without pins, and says so when reading is off", async () => {
    const { ctx } = viewingCtx({});
    expect(await pinnedFilesMessage(ctx, "thread-1", [], turnWith(documents), documents)).toBeNull();
    const off = await pinnedFilesMessage(ctx, "thread-1", [docId("doc-notes.txt")], turnWith(documents, { documentTools: false }), documents);
    expect(off?.content).toMatch(/opening files is turned off for this workspace/);
  });
});

describe("the evidence head", () => {
  const documents = [
    doc("notes.txt", { fileType: "txt", content: "Fictional notes.", hasOriginal: false }),
    doc("figure.png", { fileType: "image" }),
    doc("scan.pdf", { fileType: "pdf" }),
    doc("lost.png", { fileType: "image", hasOriginal: false }),
  ];
  const base = { reportText: "Report.", analysisText: "Analysis.", documents };

  it("marks the files viewFile can show and names them apart in the no-text notice", () => {
    const { head } = buildChatEvidence(base);
    expect(head).toContain('F2 | "figure.png" | OTHER SUPPORTING MATERIAL | image, no text | 0 characters | original image kept, viewFile can show it');
    expect(head).toContain("original PDF kept, viewFile can show its pages");
    expect(head).toContain('[2 attached file(s) carry no text, but viewFile can show you their pages or image: F2 "figure.png", F3 "scan.pdf".]');
    expect(head).toContain('[1 attached file(s) carry no text you can read (for example images or scans), so you cannot see them and readDocument cannot open them: F4 "lost.png".]');
  });

  it("offers nothing to view while viewing or reading is off", () => {
    for (const off of [{ viewingOff: true }, { readingToolsOff: true }]) {
      const { head } = buildChatEvidence({ ...base, ...off });
      // The guidance names the tool; the list and the notices offer nothing.
      expect(head).not.toContain("kept, viewFile can show");
      expect(head).not.toContain("but viewFile can show you");
    }
  });
});

describe("copy", () => {
  it("uses plain hyphens only in every viewFile text", () => {
    const texts = [
      CHAT_VIEW_OFF,
      CHAT_VIEW_BUDGET_USED,
      chatViewNotMedia("F1"),
      chatViewTooBig("F1", "pdf", 9_000_000),
      chatViewTooManyPages("F1", 40),
      chatViewUnreadable("F1"),
      tools.chatViewReceipt("F1", "pdf", 1_000, 2),
      chatReadNoText("F1", "image"),
    ];
    for (const text of texts) expect(findDashConnectors(text)).toEqual([]);
  });
});
