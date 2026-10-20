import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import type { Id } from "../_generated/dataModel";
import {
  CHAT_READ_BUDGET_USED,
  CHAT_READ_MAX_TURN_CHARS,
  CHAT_READ_NO_FILE,
  CHAT_READ_NO_TRANSCRIPT,
  CHAT_READ_PART_CHARS,
  CHAT_READING_OFF,
  newDocumentReadTurn,
  releaseReading,
  reserveReading,
  runReadDocument,
  runReadTranscript,
  runSearchDocuments,
  withOpenedText,
  type ReadingToolCtx,
} from "./chatDocumentTools";
import type { ChatEvidenceDoc } from "./chatEvidence";
import { findDashConnectors } from "../../shared/humanProse";
import * as tools from "./chatDocumentTools";

/**
 * Chat parity Phase B (2026-10-20): the reading tools' bodies and the step
 * injection, with the reads stubbed. Every name and text is fictional.
 */

const id = <T extends "projectDocuments" | "transcripts">(value: string) => value as Id<T>;

const doc = (fileName: string, content: string, over: Partial<ChatEvidenceDoc> = {}): ChatEvidenceDoc => ({
  fileName,
  content,
  documentId: id<"projectDocuments">(`doc-${fileName}`),
  category: "other",
  ...over,
});

function turnWith(documents: ChatEvidenceDoc[] = [doc("notes.txt", "Notes.")]) {
  return newDocumentReadTurn({
    documents,
    transcripts: [
      { transcriptId: id<"transcripts">("tr-1"), label: "Kickoff", turnCount: 3, chars: 300, speakers: [] },
    ],
  });
}

/** A ctx whose reads answer `answer`, after a tick, recording each call's args. */
function ctxAnswering(answer: (args: Record<string, unknown>) => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const ctx: ReadingToolCtx = {
    threadId: "thread-1",
    runQuery: (async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push(args);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return answer(args);
    }) as unknown as ReadingToolCtx["runQuery"],
  };
  return { ctx, calls };
}

const okRead = (args: Record<string, unknown>) => {
  const start = Number(args.start);
  const end = Math.min(300_000, start + Number(args.maxChars));
  return { status: "ok", fileName: "notes.txt", category: "other", totalChars: 300_000, start, end, text: "n".repeat(end - start) };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the turn's allowance", () => {
  it("is taken synchronously, so parallel calls never pass it together", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith();
    turn.used = 100_000;
    const { ctx, calls } = ctxAnswering(okRead);
    const results = await Promise.all([
      runReadDocument(ctx, { file: "F1", parts: 3 }, { toolCallId: "a" }, turn),
      runReadDocument(ctx, { file: "F1", part: 4, parts: 3 }, { toolCallId: "b" }, turn),
      runReadDocument(ctx, { file: "F1", part: 7 }, { toolCallId: "c" }, turn),
    ]);
    // 140,000 left: 120,000 for the first, 20,000 for the second, none for the third.
    expect(calls.map((call) => call.maxChars)).toEqual([120_000, 20_000]);
    expect(results[2]).toBe(CHAT_READ_BUDGET_USED);
    expect(results[1]).toContain("The text stops early because this reply's reading allowance ran out.");
    expect(turn.used).toBe(CHAT_READ_MAX_TURN_CHARS);
  });

  it("gives back what a call did not use", () => {
    const turn = turnWith();
    expect(reserveReading(turn, 50_000)).toBe(50_000);
    releaseReading(turn, 30_000);
    expect(turn.used).toBe(20_000);
    expect(reserveReading(turn, CHAT_READ_MAX_TURN_CHARS)).toBe(CHAT_READ_MAX_TURN_CHARS - 20_000);
  });

  it("is refunded when a read fails", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const turn = turnWith();
    const { ctx } = ctxAnswering(() => {
      throw new Error("read failed");
    });
    expect(await runReadDocument(ctx, { file: "F1" }, { toolCallId: "a" }, turn)).toContain("could not be read just now");
    expect(turn.used).toBe(0);
    expect(turn.opened.size).toBe(0);
  });
});

describe("readDocument", () => {
  it("returns a receipt with no text, and keeps the text for the step injection", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith();
    const { ctx } = ctxAnswering(okRead);
    const receipt = await runReadDocument(ctx, { file: "F1", part: 2, parts: 2 }, { toolCallId: "call-1" }, turn);
    expect(receipt).toBe(
      'Opened F1 "notes.txt", parts 2-3 of 8 (80,000 of 300,000 characters). To read on, call readDocument with part 4.'
    );
    expect(receipt).not.toContain("nnnn");
    const kept = turn.opened.get("call-1") as string;
    expect(kept.startsWith(`${receipt}\n\n--- BEGIN [OTHER SUPPORTING MATERIAL] F1 parts 2-3, notes.txt ---\n`)).toBe(true);
    expect(kept).toContain("n".repeat(80_000));
    // One log line per call: the tool, characters and parts, never a name.
    expect(info).toHaveBeenCalledWith("chat document read", { tool: "readDocument", chars: 80_000, parts: 2 });
    expect(JSON.stringify(info.mock.calls)).not.toContain("notes.txt");
  });

  it("finds a file by handle or exact name, and asks for a handle when two share a name", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith([doc("Notes.txt", "A."), doc("other.txt", "B."), doc("notes.txt", "C.", { documentId: id("doc-dup") })]);
    const { ctx, calls } = ctxAnswering(okRead);
    await runReadDocument(ctx, { file: 'f 2 "other.txt"' }, { toolCallId: "a" }, turn);
    await runReadDocument(ctx, { file: "OTHER.TXT" }, { toolCallId: "b" }, turn);
    expect(calls.map((call) => call.documentId)).toEqual(["doc-other.txt", "doc-other.txt"]);
    expect(await runReadDocument(ctx, { file: "notes.txt" }, { toolCallId: "c" }, turn)).toBe(
      "More than one file in this project has that name: F1, F3. Call readDocument again with one handle."
    );
    expect(await runReadDocument(ctx, { file: "F9" }, { toolCallId: "d" }, turn)).toBe(CHAT_READ_NO_FILE);
    expect(calls).toHaveLength(2);
  });

  // Review P3-4: a file whose name starts like a handle is that file, and a
  // handle counts only when it is the whole input (or the receipt form).
  it("prefers an exact name over a handle-like prefix, for files and transcripts", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = newDocumentReadTurn({
      documents: [
        doc("notes.txt", "A."),
        doc("F2.pdf", "B."),
        doc("F1 budget.xlsx", "C."),
        doc("F3", "D."),
      ],
      transcripts: [
        { transcriptId: id<"transcripts">("tr-1"), label: "Kickoff", turnCount: 1, chars: 10, speakers: [] },
        { transcriptId: id<"transcripts">("tr-2"), label: "T1 follow-up", turnCount: 1, chars: 10, speakers: [] },
      ],
    });
    // List order: F1 notes.txt, F2 F2.pdf, F3 F1 budget.xlsx, F4 F3.
    expect(turn.files.map((file) => `${file.handle} ${file.fileName}`)).toEqual([
      "F1 notes.txt", "F2 F2.pdf", "F3 F1 budget.xlsx", "F4 F3",
    ]);
    const { ctx, calls } = ctxAnswering(okRead);
    for (const file of ["F2.pdf", "f1 budget.xlsx", "F3", 'F2 "F2.pdf"', "F1", "  f 1  "]) {
      await runReadDocument(ctx, { file }, { toolCallId: file }, turn);
    }
    expect(calls.map((call) => call.documentId)).toEqual([
      "doc-F2.pdf", "doc-F1 budget.xlsx", "doc-F3", "doc-F2.pdf", "doc-notes.txt", "doc-notes.txt",
    ]);
    // A handle-like prefix of no file is not a handle.
    expect(await runReadDocument(ctx, { file: "F1 report.docx" }, { toolCallId: "x" }, turn)).toBe(CHAT_READ_NO_FILE);
    expect(calls).toHaveLength(6);

    turn.used = 0;
    const reads = ctxAnswering(() => ({ status: "past_end", label: "x", totalTurns: 1, totalChars: 10 }));
    for (const transcript of ["T1 follow-up", "T1", 'T2 "T1 follow-up"']) {
      await runReadTranscript(reads.ctx, { transcript }, { toolCallId: transcript }, turn);
    }
    expect(reads.calls.map((call) => call.transcriptId)).toEqual(["tr-2", "tr-1", "tr-2"]);
    expect(await runReadTranscript(reads.ctx, { transcript: "T1 notes" }, { toolCallId: "y" }, turn)).toBe(
      CHAT_READ_NO_TRANSCRIPT
    );
  });

  it("refuses a file with no text without reading it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith([doc("scan.pdf", "", { fileType: "pdf", processingStatus: "could_not_read" })]);
    const { ctx, calls } = ctxAnswering(okRead);
    expect(await runReadDocument(ctx, { file: "F1" }, { toolCallId: "a" }, turn)).toBe(
      'F1 "scan.pdf" has no text that can be read (for example an image or a scan), so readDocument cannot open it.'
    );
    expect(calls).toHaveLength(0);
  });

  it("fails closed without a turn context, and says off when the setting is off", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { ctx, calls } = ctxAnswering(okRead);
    expect(await runReadDocument(ctx, { file: "F1" }, { toolCallId: "a" }, newDocumentReadTurn())).toBe(CHAT_READING_OFF);
    const off = newDocumentReadTurn({ documents: [doc("notes.txt", "N.")], documentTools: false });
    expect(await runReadDocument(ctx, { file: "F1" }, { toolCallId: "a" }, off)).toBe(CHAT_READING_OFF);
    expect(await runSearchDocuments(ctx, { query: "notes" }, { toolCallId: "b" }, off)).toBe(CHAT_READING_OFF);
    expect(await runReadTranscript(ctx, { transcript: "T1" }, { toolCallId: "c" }, off)).toBe(CHAT_READING_OFF);
    expect(calls).toHaveLength(0);
  });
});

describe("readTranscript and searchDocuments", () => {
  it("reads turns from a 1-based turn and says where to go on", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith();
    const { ctx, calls } = ctxAnswering(() => ({
      status: "turns", label: "Kickoff", totalTurns: 30, firstIndex: 9, lastIndex: 11, cutShort: false,
      text: "[turn 10] Client (Dana): A.\n[turn 11] Client (Dana): B.\n[turn 12] Client (Dana): C.",
    }));
    const receipt = await runReadTranscript(ctx, { transcript: "kickoff", fromTurn: 10, turns: 3 }, { toolCallId: "t" }, turn);
    expect(calls[0]).toMatchObject({ fromIndex: 9, maxTurns: 3, transcriptId: "tr-1" });
    expect(receipt).toBe('Opened T1 "Kickoff", turns 10-12 of 30 (83 characters). To read on, call readTranscript with fromTurn 13.');
    expect(turn.opened.get("t")).toContain("--- BEGIN [INTERVIEW TRANSCRIPT] T1 turns 10-12, Kickoff ---");
    expect(await runReadTranscript(ctx, { transcript: "T7" }, { toolCallId: "u" }, turn)).toBe(CHAT_READ_NO_TRANSCRIPT);
  });

  it("names each excerpt's place by handle, and counts what it found", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turn = turnWith();
    const { ctx } = ctxAnswering(() => ({
      status: "ok",
      complete: true,
      excerpts: [
        { kind: "file", documentId: "doc-notes.txt", fileName: "notes.txt", category: "other", start: CHAT_READ_PART_CHARS + 5, text: "File words." },
        { kind: "transcript", transcriptId: "tr-1", label: "Kickoff", firstIndex: 39, lastIndex: 45, text: "[turn 40] ..." },
      ],
    }));
    const receipt = await runSearchDocuments(ctx, { query: "words" }, { toolCallId: "s" }, turn);
    expect(receipt).toBe(
      "Searched this project's files and transcripts: found 2 excerpt(s), at F1 part 2, T1 turns 40-46. To read more around one, open it with readDocument or readTranscript."
    );
    expect(turn.opened.get("s")).toContain("--- BEGIN [OTHER SUPPORTING MATERIAL] F1 part 2, notes.txt ---\nFile words.\n");
    expect(turn.used).toBe("File words.".length + "[turn 40] ...".length);
  });
});

describe("withOpenedText", () => {
  const messages = (output: string): ModelMessage[] => [
    { role: "user", content: "Question." },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "readDocument", input: { file: "F1" } }] },
    {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "call-1", toolName: "readDocument", output: { type: "text", value: output } }],
    },
  ];

  it("puts the same bytes back on every later step, and leaves other steps alone", () => {
    const turn = turnWith();
    turn.opened.set("call-1", "Receipt.\n\n--- BEGIN [X] ---\nText\n--- END [X] ---");
    const first = withOpenedText(messages("Receipt."), turn, [{}]);
    const second = withOpenedText(messages("Receipt."), turn, [{}, {}]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).toContain("Text");
    const untouched = messages("Other.");
    untouched[2] = { role: "tool", content: [{ type: "tool-result", toolCallId: "call-2", toolName: "readDocument", output: { type: "text", value: "Other." } }] };
    expect(withOpenedText(untouched, turn, [{}])).toBe(untouched);
  });

  // Review test gap: a new pass that reuses a tool call id must not get the
  // earlier pass's text. Fails without the clear on the pass's first step.
  it("does not put an earlier pass's text into a later pass that reuses the call id", () => {
    const turn = turnWith();
    turn.opened.set("call-1", "Receipt.\n\nFIRST_PASS_TEXT");
    withOpenedText([{ role: "user", content: "Question." }], turn, []);
    const laterStep = messages("Receipt.");
    const next = withOpenedText(laterStep, turn, [{}]);
    expect(next).toBe(laterStep);
    expect(JSON.stringify(next)).not.toContain("FIRST_PASS_TEXT");
  });

  it("starts each pass clean", () => {
    const turn = turnWith();
    turn.opened.set("call-1", "Receipt plus text.");
    const input = messages("Receipt.");
    expect(withOpenedText(input, turn, [])).toBe(input);
    expect(turn.opened.size).toBe(0);
  });
});

describe("tool texts", () => {
  it("use plain hyphens and no dash connectors", () => {
    const texts = Object.values(tools).filter((value): value is string => typeof value === "string");
    expect(texts.length).toBeGreaterThan(4);
    for (const text of texts) {
      expect(text).not.toMatch(/[\u2010-\u2015\u2212]/);
      expect(findDashConnectors(text)).toEqual([]);
    }
  });
});
