// Report chat parity, Phase B (2026-10-20): the chat's three reading tools,
// readDocument, searchDocuments and readTranscript.
//
// What a tool opens reaches the model for the current turn only and is never
// stored. `@convex-dev/agent` saves each step's response messages, which
// carry the tool's result, so the result is a short receipt with no text
// from the file (`toModelOutput` would also be saved, so it is never used).
// The opened text waits in the turn's `DocumentReadTurn`, keyed by the tool
// call, and `withOpenedText` puts the receipt plus the text into that tool
// result on every later step of the same pass (AI SDK `prepareStep`). The SDK
// builds each step's input afresh from its own record, so the text is put
// back on every step, with the same bytes each time, which keeps the step
// prefix cacheable. A new pass (the recovery pass) starts clean; the turn's
// character allowance is shared by every pass.
//
// Phase C (2026-10-20): viewFile sends a stored PDF's pages or an image to
// the model inline, the same way: the saved result is a receipt, and the
// receipt plus the media (`image-data`, or `file-data` for a PDF) wait in
// `opened` for `withOpenedText`. Files a writer pinned to the message reach
// the model in one ephemeral user message after the options note
// (`pinnedFilesMessage`), never saved. Both share the turn's media allowance
// (bytes and images) and the pins share its character allowance.

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import type { FilePart, ModelMessage, TextPart } from "ai";
import {
  makeFunctionReference,
  type FunctionReference,
  type RegisteredAction,
  type RegisteredQuery,
} from "convex/server";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type * as chatDocuments from "../chatDocuments";
import type * as chatPdfPages from "./chatPdfPages";
import {
  CHAT_READ_MAX_CALL_CHARS,
  CHAT_READ_MAX_PARTS,
  CHAT_READ_MAX_TURN_CHARS,
  CHAT_READ_PART_CHARS,
  CHAT_SEARCH_EXCERPT_CHARS,
  CHAT_SEARCH_MAX_EXCERPTS,
  CHAT_TRANSCRIPT_READ_CHARS,
  safeRange,
  type ReadDocumentResult,
  type ReadTranscriptResult,
  type SearchDocumentsResult,
  type SearchExcerpt,
  type ViewFileResult,
} from "../chatDocuments";
import {
  chatFileOrder,
  chatTranscriptHandle,
  chatViewableKind,
  openedDocumentBlock,
  openedMediaMarkers,
  openedTranscriptBlock,
  type ChatEvidenceDoc,
  type ChatTurnContext,
} from "./chatEvidence";
import {
  CHAT_VIEW_MAX_IMAGE_BYTES,
  CHAT_VIEW_MAX_IMAGES,
  CHAT_VIEW_MAX_PDF_BYTES,
  CHAT_VIEW_MAX_PDF_PAGES,
  CHAT_VIEW_MAX_TURN_BYTES,
  formatBytes,
  sniffChatMedia,
  toBase64,
  type ChatImageMediaType,
  type ChatMediaKind,
  type ChatMediaType,
} from "../lib/chatMedia";
import { CHAT_MAX_PINNED_FILES } from "../../shared/chatLimits";
import { formatCount, neutralizeMarkers, sanitizeFileName } from "./trustedContext";
import { safeErrorDetails } from "../lib/safeErrorDetails";

export {
  CHAT_READ_MAX_CALL_CHARS,
  CHAT_READ_MAX_TURN_CHARS,
  CHAT_READ_PART_CHARS,
  CHAT_SEARCH_EXCERPT_CHARS,
  CHAT_SEARCH_MAX_EXCERPTS,
  CHAT_TRANSCRIPT_READ_CHARS,
};

// ─── Function references ─────────────────────────────────────────────────────

type QueryRef<Export> =
  Export extends RegisteredQuery<infer Visibility, infer Args, infer Return>
    ? FunctionReference<"query", Visibility, Args, Awaited<Return>>
    : never;

/**
 * convex/chatDocuments.ts is new, and `convex/_generated/api.d.ts` lists a
 * module only after codegen. Typed from the registered exports, as
 * convex/ai/anthropicCredit.ts does; interchangeable with
 * `internal.chatDocuments.*` once codegen runs.
 */
function queryRef<Export>(name: string): QueryRef<Export> {
  return makeFunctionReference(name) as unknown as QueryRef<Export>;
}

type ActionRef<Export> =
  Export extends RegisteredAction<infer Visibility, infer Args, infer Return>
    ? FunctionReference<"action", Visibility, Args, Awaited<Return>>
    : never;

/** The same for the Phase C page count action (convex/ai/chatPdfPages.ts). */
function actionRef<Export>(name: string): ActionRef<Export> {
  return makeFunctionReference(name) as unknown as ActionRef<Export>;
}

const readDocumentRef = queryRef<typeof chatDocuments.readDocumentForChat>("chatDocuments:readDocumentForChat");
const readTranscriptRef = queryRef<typeof chatDocuments.readTranscriptForChat>("chatDocuments:readTranscriptForChat");
const searchRef = queryRef<typeof chatDocuments.searchForChat>("chatDocuments:searchForChat");
const viewFileRef = queryRef<typeof chatDocuments.viewFileForChat>("chatDocuments:viewFileForChat");
const countPdfPagesRef = actionRef<typeof chatPdfPages.countPdfPages>("ai/chatPdfPages:countPdfPages");

// ─── Fixed texts ─────────────────────────────────────────────────────────────

/** The admin setting `ai.chatDocumentTools` is off. */
export const CHAT_READING_OFF = "Opening files is turned off for this workspace.";

export const CHAT_READ_BUDGET_USED = `Nothing was opened. This reply has used its reading allowance of ${formatCount(CHAT_READ_MAX_TURN_CHARS)} characters. Answer with what you opened, and tell the writer what is left to read so they can ask again.`;

export const CHAT_READ_NO_FILE =
  "No file in this project matches that. Use a handle from FILES IN THIS PROJECT, such as F1, or a file name exactly as it is listed. Archived files cannot be opened.";

export const CHAT_READ_NO_TRANSCRIPT =
  "No transcript in this project matches that. Use a handle from TRANSCRIPTS IN THIS PROJECT, such as T1, or a label exactly as it is listed. Removed and replaced transcripts cannot be opened.";

export const CHAT_READ_FAILED = "That could not be read just now. Try once more; if it fails again, tell the writer.";

export const CHAT_SEARCH_NO_TERMS =
  "Nothing was searched. The query needs at least one word of three or more letters.";

export const CHAT_SEARCH_NOTHING_FOUND =
  "Found nothing in this project's files or transcripts for those words. Try other words, or open a file with readDocument.";

/**
 * A file with no text: an image, a scan, a failed extraction. Phase C: one
 * viewFile can show says so.
 */
export function chatReadNoText(ref: string, viewable: ChatMediaKind | null = null): string {
  const base = `${ref} has no text that can be read (for example an image or a scan), so readDocument cannot open it.`;
  if (viewable === "pdf") return `${base} viewFile can show you its pages.`;
  if (viewable === "image") return `${base} viewFile can show you the image.`;
  return base;
}

// Phase C (2026-10-20): viewFile's fixed texts.

/** The admin setting `ai.chatVision` is off. */
export const CHAT_VIEW_OFF = "Viewing PDFs and images is turned off for this workspace. Use readDocument for a file's text.";

export const CHAT_VIEW_BUDGET_USED = `Nothing was shown. This reply has used its viewing allowance of ${formatBytes(CHAT_VIEW_MAX_TURN_BYTES)} and ${CHAT_VIEW_MAX_IMAGES} images. Answer with what you have seen, and tell the writer what is left to look at so they can ask again.`;

/** Not a PDF or one of the four image types, or no original is kept. */
export function chatViewNotMedia(ref: string): string {
  return `${ref} is not a PDF or an image whose original file is kept, so viewFile cannot show it. Use readDocument for its text.`;
}

export function chatViewTooBig(ref: string, kind: ChatMediaKind, size: number): string {
  return kind === "image"
    ? `${ref} is too large to view (${formatBytes(size)}). Images can be at most ${formatBytes(CHAT_VIEW_MAX_IMAGE_BYTES)}.`
    : `${ref} is too large to view (${formatBytes(size)}). PDFs can be at most ${formatBytes(CHAT_VIEW_MAX_PDF_BYTES)}. Use readDocument for its text instead.`;
}

export function chatViewTooManyPages(ref: string, pages: number): string {
  return `${ref} has ${formatCount(pages)} pages, and viewFile shows PDFs of at most ${CHAT_VIEW_MAX_PDF_PAGES} pages. Use readDocument for its text instead.`;
}

/** The bytes are not the PDF or image the file says it is, or pdf.js could not open it. */
export function chatViewUnreadable(ref: string): string {
  return `${ref} could not be opened as a PDF or an image. Use readDocument for its text instead.`;
}

/** viewFile's receipt: the only thing the saved tool row holds. */
export function chatViewReceipt(ref: string, kind: ChatMediaKind, size: number, pages?: number): string {
  return kind === "pdf"
    ? `Viewed ${ref}, a PDF of ${formatCount(pages ?? 0)} page(s) (${formatBytes(size)}). Its pages are shown to you for this reply only.`
    : `Viewed ${ref}, an image (${formatBytes(size)}). It is shown to you for this reply only.`;
}

// ─── The turn's reading state ────────────────────────────────────────────────

export type ChatReadFile = {
  documentId?: Id<"projectDocuments">;
  fileName: string;
  handle: string | null;
  hasText: boolean;
  /** Phase C: what viewFile can show of it (`chatViewableKind`), or null. */
  viewable: ChatMediaKind | null;
};

export type ChatReadTranscript = {
  transcriptId?: Id<"transcripts">;
  label: string;
  handle: string;
};

/** Phase C: one part of what viewFile puts back into its tool result. */
export type OpenedMediaPart =
  | { type: "text"; text: string }
  | { type: "image-data"; data: string; mediaType: ChatImageMediaType }
  | { type: "file-data"; data: string; mediaType: "application/pdf" };

/** Text a reading tool opened, or (Phase C) the receipt and media viewFile showed. */
export type OpenedContent = string | OpenedMediaPart[];

/**
 * One turn's reading state, created once per turn next to the web search
 * state and shared by every pass. `used` counts the characters granted to
 * calls (the turn allowance); `opened` holds, per tool call of the current
 * pass, the text `withOpenedText` puts back into the step's input. Phase C:
 * `vision` is `ai.chatVision`, and `media` counts the original bytes and
 * images granted to viewFile and pinned files (the turn's media allowance).
 */
export type DocumentReadTurn = {
  enabled: boolean;
  vision: boolean;
  used: number;
  media: { bytes: number; images: number };
  files: ChatReadFile[];
  transcripts: ChatReadTranscript[];
  opened: Map<string, OpenedContent>;
};

/**
 * The turn's reading state from the turn's evidence context: the files in
 * the files list's order (so F3 here is F3 there) and the transcripts in
 * their list's order. Without a context (the agent's static tool list),
 * every tool says reading is off: it fails closed.
 */
export function newDocumentReadTurn(
  context?: Pick<ChatTurnContext, "documents" | "transcripts" | "documentTools" | "chatVision">
): DocumentReadTurn {
  const enabled = context !== undefined && context.documentTools !== false;
  return {
    enabled,
    vision: enabled && context?.chatVision !== false,
    used: 0,
    media: { bytes: 0, images: 0 },
    files: chatFileOrder(context?.documents ?? []).map(({ doc, handle }) => ({
      ...(doc.documentId ? { documentId: doc.documentId } : {}),
      fileName: doc.fileName,
      handle,
      hasText: (doc.textLength ?? doc.content.length) > 0,
      viewable: chatViewableKind(doc),
    })),
    transcripts: (context?.transcripts ?? []).map((transcript, index) => ({
      ...(transcript.transcriptId ? { transcriptId: transcript.transcriptId } : {}),
      label: transcript.label,
      handle: chatTranscriptHandle(index),
    })),
    opened: new Map(),
  };
}

/**
 * Take up to `wanted` characters of the turn's allowance, synchronously, so
 * calls running in parallel in one step can never pass it together. Returns
 * what was granted (0 when nothing is left).
 */
export function reserveReading(turn: DocumentReadTurn, wanted: number): number {
  const granted = Math.max(0, Math.min(wanted, CHAT_READ_MAX_TURN_CHARS - turn.used));
  turn.used += granted;
  return granted;
}

/** Give back the part of a grant a call did not use. */
export function releaseReading(turn: DocumentReadTurn, unused: number): void {
  turn.used = Math.max(0, turn.used - Math.max(0, unused));
}

/** Phase C: what one view or pin holds of the turn's media allowance. */
export type MediaGrant = { bytes: number; image: boolean };

/**
 * Take up to `maxBytes` of the turn's media allowance, and one of its images
 * for an image, synchronously, so views running in parallel in one step can
 * never pass it together. Null when nothing is left.
 */
export function reserveMedia(turn: DocumentReadTurn, kind: ChatMediaKind, maxBytes: number): MediaGrant | null {
  const image = kind === "image";
  if (image && turn.media.images >= CHAT_VIEW_MAX_IMAGES) return null;
  const bytes = Math.max(0, Math.min(maxBytes, CHAT_VIEW_MAX_TURN_BYTES - turn.media.bytes));
  if (bytes === 0) return null;
  turn.media.bytes += bytes;
  if (image) turn.media.images += 1;
  return { bytes, image };
}

/** Give back what a view did not send: the unused bytes, and the image when nothing was sent. */
export function releaseMedia(turn: DocumentReadTurn, grant: MediaGrant, keptBytes: number): void {
  const kept = Math.max(0, Math.min(grant.bytes, keptBytes));
  turn.media.bytes = Math.max(0, turn.media.bytes - (grant.bytes - kept));
  if (grant.image && kept === 0) turn.media.images = Math.max(0, turn.media.images - 1);
}

/**
 * The step's input with each reading call's receipt replaced by the receipt
 * plus the text it opened, by tool call id, in the same bytes on every step.
 * Phase C: a viewFile call's result becomes its receipt and media parts (the
 * same base64 string each time). The first step of a pass (no steps yet)
 * clears what an earlier pass opened: the recovery pass starts clean.
 * Returns the same array when nothing changes.
 */
export function withOpenedText(
  messages: ModelMessage[],
  turn: DocumentReadTurn,
  steps: ReadonlyArray<unknown>
): ModelMessage[] {
  if (steps.length === 0) {
    turn.opened.clear();
    return messages;
  }
  if (turn.opened.size === 0) return messages;
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "tool") return message;
    let touched = false;
    const content = message.content.map((part) => {
      if (part.type !== "tool-result") return part;
      const opened = turn.opened.get(part.toolCallId);
      if (opened === undefined) return part;
      touched = true;
      return typeof opened === "string"
        ? { ...part, output: { type: "text" as const, value: opened } }
        : { ...part, output: { type: "content" as const, value: opened } };
    });
    if (!touched) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? next : messages;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

const MAX_NAME_CHARS = 80;

/** A file name or label, quoted and sanitized like the evidence lists'. */
function quoted(name: string): string {
  const safe = neutralizeMarkers(sanitizeFileName(name)).replace(/"/g, "'");
  return `"${safe.length > MAX_NAME_CHARS ? `${safe.slice(0, MAX_NAME_CHARS - 1)}…` : safe}"`;
}

/** How a name is compared: trimmed, case folded, quotes and spacing loosened. */
function nameKey(name: string): string {
  return sanitizeFileName(name).replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

type Resolved<T> = { kind: "one"; entry: T } | { kind: "none" } | { kind: "many"; handles: string[] };

/**
 * An exact name first, case-insensitive, so a file named `F2.pdf` or
 * `F1 budget.xlsx` is that file. Otherwise a handle, only when the input is
 * wholly a handle (`F3`, `t1`), optionally followed by the quoted name the
 * lists and receipts write after it (`F3 "notes.txt"`). A name two entries
 * share asks for the handle.
 */
function resolveEntry<T extends { handle: string | null }>(
  entries: readonly T[],
  prefix: "F" | "T",
  given: string,
  nameOf: (entry: T) => string
): Resolved<T> {
  const key = nameKey(given);
  const matches = entries.filter((entry) => nameKey(nameOf(entry)) === key);
  if (matches.length === 1) return { kind: "one", entry: matches[0]! };
  if (matches.length > 1) {
    return { kind: "many", handles: matches.map((entry) => entry.handle).filter((h): h is string => h !== null) };
  }
  const handle = new RegExp(`^\\s*${prefix}\\s*(\\d+)(?:\\s+(["'“‘]).*["'”’])?\\s*$`, "iu").exec(given);
  if (!handle) return { kind: "none" };
  const wanted = `${prefix}${Number(handle[1])}`;
  const entry = entries.find((candidate) => candidate.handle === wanted);
  return entry ? { kind: "one", entry } : { kind: "none" };
}

function manyText(kind: "file" | "transcript", handles: string[], tool = kind === "file" ? "readDocument" : "readTranscript"): string {
  return handles.length
    ? `More than one ${kind} in this project has that name: ${handles.join(", ")}. Call ${tool} again with one handle.`
    : `More than one ${kind} in this project has that name. Ask the writer which one they mean.`;
}

/** The parts a character range touches, as "part 2" or "parts 1-3". */
function partsLabel(start: number, end: number): string {
  const first = Math.floor(start / CHAT_READ_PART_CHARS) + 1;
  const last = Math.max(first, Math.ceil(end / CHAT_READ_PART_CHARS));
  return first === last ? `part ${first}` : `parts ${first}-${last}`;
}

const totalParts = (chars: number) => Math.max(1, Math.ceil(chars / CHAT_READ_PART_CHARS));
const partAt = (offset: number) => Math.floor(offset / CHAT_READ_PART_CHARS) + 1;

/** One "chat document read" log line per call: numbers only, no names, no text. */
function logRead(tool: string, chars: number, parts: number): void {
  console.info("chat document read", { tool, chars, parts });
}

/** What the reading tool bodies need from the agent's tool context. */
export type ReadingToolCtx = {
  threadId?: string | undefined;
  runQuery: ActionCtx["runQuery"];
};

// ─── readDocument ────────────────────────────────────────────────────────────

export async function runReadDocument(
  ctx: ReadingToolCtx,
  input: { file: string; part?: number; parts?: number },
  options: { toolCallId: string },
  turn: DocumentReadTurn
): Promise<string> {
  if (!turn.enabled) {
    logRead("readDocument", 0, 0);
    return CHAT_READING_OFF;
  }
  const resolved = resolveEntry(turn.files, "F", input.file, (entry) => entry.fileName);
  if (resolved.kind !== "one" || !resolved.entry.documentId || !ctx.threadId) {
    logRead("readDocument", 0, 0);
    return resolved.kind === "many" ? manyText("file", resolved.handles) : CHAT_READ_NO_FILE;
  }
  const file = resolved.entry;
  const ref = file.handle ? `${file.handle} ${quoted(file.fileName)}` : quoted(file.fileName);
  if (!file.hasText) {
    logRead("readDocument", 0, 0);
    return chatReadNoText(ref, turn.vision ? file.viewable : null);
  }
  const part = Math.max(1, Math.floor(input.part ?? 1));
  const parts = Math.min(CHAT_READ_MAX_PARTS, Math.max(1, Math.floor(input.parts ?? 1)));
  // Reserved before any await, so parallel calls cannot pass the allowance.
  const requested = Math.min(parts * CHAT_READ_PART_CHARS, CHAT_READ_MAX_CALL_CHARS);
  const granted = reserveReading(turn, requested);
  if (granted === 0) {
    logRead("readDocument", 0, 0);
    return CHAT_READ_BUDGET_USED;
  }
  let usedChars = 0;
  try {
    const result: ReadDocumentResult = await ctx.runQuery(readDocumentRef, {
      agentThreadId: ctx.threadId,
      documentId: file.documentId!,
      start: (part - 1) * CHAT_READ_PART_CHARS,
      maxChars: granted,
    });
    switch (result.status) {
      case "off":
        return CHAT_READING_OFF;
      case "unavailable":
        return CHAT_READ_FAILED;
      case "not_found":
        return CHAT_READ_NO_FILE;
      case "no_text":
        return chatReadNoText(ref, turn.vision ? file.viewable : null);
      case "past_end": {
        const count = totalParts(result.totalChars);
        return `${ref} has ${count} part(s) (${formatCount(result.totalChars)} characters). Call readDocument with a part from 1 to ${count}.`;
      }
      case "ok": {
        usedChars = result.text.length;
        const count = totalParts(result.totalChars);
        const place = partsLabel(result.start, result.end);
        const wantedEnd = Math.min(result.totalChars, (part - 1 + parts) * CHAT_READ_PART_CHARS);
        // Cut only when the allowance granted less than the call asked for.
        const cut = granted < requested && result.end < wantedEnd;
        const receipt = [
          `Opened ${ref}, ${place} of ${count} (${formatCount(result.end - result.start)} of ${formatCount(result.totalChars)} characters).`,
          ...(cut ? ["The text stops early because this reply's reading allowance ran out."] : []),
          ...(result.end < result.totalChars
            ? [`To read on, call readDocument with part ${partAt(result.end)}.`]
            : []),
        ].join(" ");
        const block = openedDocumentBlock(
          {
            fileName: result.fileName,
            ...(result.category ? { category: result.category } : {}),
            ...(result.uploaderRole ? { uploaderRole: result.uploaderRole } : {}),
          },
          `${file.handle ?? "file"} ${place}`,
          result.text
        );
        turn.opened.set(options.toolCallId, `${receipt}\n\n${block}`);
        return receipt;
      }
    }
    return CHAT_READ_FAILED;
  } catch (error) {
    console.error("readDocument tool failed", safeErrorDetails(error));
    return CHAT_READ_FAILED;
  } finally {
    releaseReading(turn, granted - usedChars);
    logRead("readDocument", usedChars, usedChars > 0 ? Math.ceil(usedChars / CHAT_READ_PART_CHARS) : 0);
  }
}

// ─── searchDocuments ─────────────────────────────────────────────────────────

/** Where an excerpt sits, as the model can open it: `F3 part 2`, `T1 turns 40-46`. */
function excerptPlace(excerpt: SearchExcerpt, turn: DocumentReadTurn): string {
  if (excerpt.kind === "file") {
    const file = turn.files.find((entry) => entry.documentId === excerpt.documentId);
    const name = file?.handle ?? quoted(excerpt.fileName);
    return `${name} part ${partAt(excerpt.start)}`;
  }
  const transcript = turn.transcripts.find((entry) => entry.transcriptId === excerpt.transcriptId);
  const name = transcript?.handle ?? quoted(excerpt.label);
  if (excerpt.firstIndex === undefined || excerpt.lastIndex === undefined) {
    return `${name} part ${partAt(excerpt.start ?? 0)}`;
  }
  return excerpt.firstIndex === excerpt.lastIndex
    ? `${name} turn ${excerpt.firstIndex + 1}`
    : `${name} turns ${excerpt.firstIndex + 1}-${excerpt.lastIndex + 1}`;
}

export async function runSearchDocuments(
  ctx: ReadingToolCtx,
  input: { query: string },
  options: { toolCallId: string },
  turn: DocumentReadTurn
): Promise<string> {
  if (!turn.enabled) {
    logRead("searchDocuments", 0, 0);
    return CHAT_READING_OFF;
  }
  if (!ctx.threadId) {
    logRead("searchDocuments", 0, 0);
    return CHAT_READ_FAILED;
  }
  const granted = reserveReading(turn, CHAT_SEARCH_MAX_EXCERPTS * CHAT_SEARCH_EXCERPT_CHARS);
  if (granted === 0) {
    logRead("searchDocuments", 0, 0);
    return CHAT_READ_BUDGET_USED;
  }
  let usedChars = 0;
  let found = 0;
  try {
    const result: SearchDocumentsResult = await ctx.runQuery(searchRef, {
      agentThreadId: ctx.threadId,
      query: input.query,
      maxChars: granted,
    });
    switch (result.status) {
      case "off":
        return CHAT_READING_OFF;
      case "unavailable":
        return CHAT_READ_FAILED;
      case "no_terms":
        return CHAT_SEARCH_NO_TERMS;
      case "ok": {
        const partial = result.complete
          ? ""
          : " The search stopped before it read every file and transcript, so it may have missed some.";
        if (result.excerpts.length === 0) return `${CHAT_SEARCH_NOTHING_FOUND}${partial}`;
        found = result.excerpts.length;
        usedChars = result.excerpts.reduce((sum, excerpt) => sum + excerpt.text.length, 0);
        const places = result.excerpts.map((excerpt) => excerptPlace(excerpt, turn));
        const receipt = `Searched this project's files and transcripts: found ${found} excerpt(s), at ${[...new Set(places)].join(", ")}. To read more around one, open it with readDocument or readTranscript.${partial}`;
        const blocks = result.excerpts.map((excerpt, index) =>
          excerpt.kind === "file"
            ? openedDocumentBlock(
                {
                  fileName: excerpt.fileName,
                  ...(excerpt.category ? { category: excerpt.category } : {}),
                  ...(excerpt.uploaderRole ? { uploaderRole: excerpt.uploaderRole } : {}),
                },
                places[index]!,
                excerpt.text
              )
            : openedTranscriptBlock(excerpt.label, places[index]!, excerpt.text)
        );
        turn.opened.set(options.toolCallId, `${receipt}\n\n${blocks.join("\n\n")}`);
        return receipt;
      }
    }
  } catch (error) {
    console.error("searchDocuments tool failed", safeErrorDetails(error));
    return CHAT_READ_FAILED;
  } finally {
    releaseReading(turn, granted - usedChars);
    logRead("searchDocuments", usedChars, found);
  }
}

// ─── readTranscript ──────────────────────────────────────────────────────────

export async function runReadTranscript(
  ctx: ReadingToolCtx,
  input: { transcript: string; fromTurn?: number; turns?: number },
  options: { toolCallId: string },
  turn: DocumentReadTurn
): Promise<string> {
  if (!turn.enabled) {
    logRead("readTranscript", 0, 0);
    return CHAT_READING_OFF;
  }
  const resolved = resolveEntry(turn.transcripts, "T", input.transcript, (entry) => entry.label);
  if (resolved.kind !== "one" || !resolved.entry.transcriptId || !ctx.threadId) {
    logRead("readTranscript", 0, 0);
    return resolved.kind === "many" ? manyText("transcript", resolved.handles) : CHAT_READ_NO_TRANSCRIPT;
  }
  const transcript = resolved.entry;
  const ref = `${transcript.handle} ${quoted(transcript.label)}`;
  const granted = reserveReading(turn, CHAT_TRANSCRIPT_READ_CHARS);
  if (granted === 0) {
    logRead("readTranscript", 0, 0);
    return CHAT_READ_BUDGET_USED;
  }
  const fromIndex = Math.max(1, Math.floor(input.fromTurn ?? 1)) - 1;
  let usedChars = 0;
  let parts = 0;
  try {
    const result: ReadTranscriptResult = await ctx.runQuery(readTranscriptRef, {
      agentThreadId: ctx.threadId,
      transcriptId: transcript.transcriptId!,
      fromIndex,
      ...(input.turns !== undefined ? { maxTurns: input.turns } : {}),
      maxChars: granted,
    });
    switch (result.status) {
      case "off":
        return CHAT_READING_OFF;
      case "unavailable":
        return CHAT_READ_FAILED;
      case "not_found":
        return CHAT_READ_NO_TRANSCRIPT;
      case "past_end":
        return result.totalTurns > 0
          ? `${ref} has ${formatCount(result.totalTurns)} speaker turns. Call readTranscript with fromTurn from 1 to ${result.totalTurns}.`
          : `${ref} has no speaker turns and ${totalParts(result.totalChars)} part(s) (${formatCount(result.totalChars)} characters). Call readTranscript with fromTurn from 1 to ${totalParts(result.totalChars)}; here it counts parts.`;
      case "turns": {
        usedChars = result.text.length;
        parts = result.lastIndex - result.firstIndex + 1;
        const place =
          result.firstIndex === result.lastIndex
            ? `turn ${result.firstIndex + 1}`
            : `turns ${result.firstIndex + 1}-${result.lastIndex + 1}`;
        const receipt = [
          `Opened ${ref}, ${place} of ${formatCount(result.totalTurns)} (${formatCount(usedChars)} characters).`,
          ...(result.cutShort ? [`Turn ${result.lastIndex + 1} is cut short to fit.`] : []),
          ...(result.lastIndex + 1 < result.totalTurns
            ? [`To read on, call readTranscript with fromTurn ${result.lastIndex + 2}.`]
            : []),
        ].join(" ");
        turn.opened.set(
          options.toolCallId,
          `${receipt}\n\n${openedTranscriptBlock(result.label, `${transcript.handle} ${place}`, result.text)}`
        );
        return receipt;
      }
      case "chars": {
        usedChars = result.text.length;
        parts = 1;
        const count = totalParts(result.totalChars);
        const place = `part ${partAt(result.start)}`;
        const receipt = [
          `Opened ${ref}, ${place} of ${count} (${formatCount(usedChars)} of ${formatCount(result.totalChars)} characters).`,
          "It has no speaker turns, so it is read in parts of 40,000 characters and fromTurn counts parts.",
          ...(result.end < result.totalChars ? [`To read on, call readTranscript with fromTurn ${partAt(result.end)}.`] : []),
        ].join(" ");
        turn.opened.set(
          options.toolCallId,
          `${receipt}\n\n${openedTranscriptBlock(result.label, `${transcript.handle} ${place}`, result.text)}`
        );
        return receipt;
      }
    }
  } catch (error) {
    console.error("readTranscript tool failed", safeErrorDetails(error));
    return CHAT_READ_FAILED;
  } finally {
    releaseReading(turn, granted - usedChars);
    logRead("readTranscript", usedChars, parts);
  }
}

// ─── viewFile (Phase C, 2026-10-20) ──────────────────────────────────────────

/** What viewFile and pinned files need from the agent's tool context. */
export type ViewingToolCtx = ReadingToolCtx & {
  runAction: ActionCtx["runAction"];
  storage: Pick<ActionCtx["storage"], "get">;
};

/** One "chat file view" log line per view or pin: numbers only, no names, no bytes. */
function logView(tool: string, kind: ChatMediaKind | null, bytes: number, pages: number): void {
  console.info("chat file view", { tool, kind, bytes, pages });
}

type MediaLoad =
  | {
      status: "ok";
      kind: ChatMediaKind;
      mediaType: ChatMediaType;
      /** Base64 of the original, encoded once. */
      data: string;
      size: number;
      pageCount?: number;
      fileName: string;
      category?: Doc<"projectDocuments">["category"];
      uploaderRole?: string;
    }
  | { status: Exclude<ViewFileResult["status"], "ok" | "not_media"> | "not_media" | "unreadable" | "allowance" | "failed" }
  | { status: "too_big"; kind: ChatMediaKind; size: number }
  | { status: "too_many_pages"; pageCount: number };

/**
 * One file's original as base64, within the per-file caps and the turn's
 * media allowance. The allowance is taken before the first await (call this
 * without awaiting anything first), and what is not sent is given back. A
 * PDF with no stored page count is counted on the server (Node runtime) and
 * the count is stored. The bytes' own signature decides the media type sent.
 */
async function loadMedia(ctx: ViewingToolCtx, file: ChatReadFile, turn: DocumentReadTurn): Promise<MediaLoad> {
  const kind = file.viewable;
  if (!kind || !file.documentId || !ctx.threadId) return { status: "not_media" };
  const cap = kind === "image" ? CHAT_VIEW_MAX_IMAGE_BYTES : CHAT_VIEW_MAX_PDF_BYTES;
  const grant = reserveMedia(turn, kind, cap);
  if (!grant) return { status: "allowance" };
  let kept = 0;
  try {
    const view: ViewFileResult = await ctx.runQuery(viewFileRef, {
      agentThreadId: ctx.threadId,
      documentId: file.documentId,
    });
    if (view.status !== "ok") return { status: view.status };
    if (view.kind !== kind) return { status: "not_media" };
    if (view.size > cap) return { status: "too_big", kind, size: view.size };
    let pageCount = view.pageCount;
    if (kind === "pdf" && pageCount === undefined) {
      const counted: number | null = await ctx.runAction(countPdfPagesRef, {
        documentId: file.documentId,
        storageId: view.storageId,
      });
      if (counted === null) return { status: "unreadable" };
      pageCount = counted;
    }
    if (kind === "pdf" && (pageCount ?? 0) > CHAT_VIEW_MAX_PDF_PAGES) {
      return { status: "too_many_pages", pageCount: pageCount ?? 0 };
    }
    if (view.size > grant.bytes) return { status: "allowance" };
    const blob = await ctx.storage.get(view.storageId);
    if (!blob) return { status: "failed" };
    if (blob.size > grant.bytes) return blob.size > cap ? { status: "too_big", kind, size: blob.size } : { status: "allowance" };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sniffed = sniffChatMedia(bytes);
    const mediaType =
      kind === "pdf"
        ? sniffed === "application/pdf"
          ? sniffed
          : null
        : sniffed !== null && sniffed !== "application/pdf"
          ? sniffed
          : null;
    if (!mediaType) return { status: "unreadable" };
    const data = toBase64(bytes);
    kept = bytes.length;
    return {
      status: "ok",
      kind,
      mediaType,
      data,
      size: bytes.length,
      ...(pageCount !== undefined ? { pageCount } : {}),
      fileName: view.fileName,
      ...(view.category ? { category: view.category } : {}),
      ...(view.uploaderRole ? { uploaderRole: view.uploaderRole } : {}),
    };
  } catch (error) {
    console.error("chat file view failed", safeErrorDetails(error));
    return { status: "failed" };
  } finally {
    releaseMedia(turn, grant, kept);
  }
}

/** The media part a tool result carries for a loaded original. */
function toolMediaPart(loaded: Extract<MediaLoad, { status: "ok" }>): OpenedMediaPart {
  return loaded.mediaType === "application/pdf"
    ? { type: "file-data", data: loaded.data, mediaType: "application/pdf" }
    : { type: "image-data", data: loaded.data, mediaType: loaded.mediaType };
}

export async function runViewFile(
  ctx: ViewingToolCtx,
  input: { file: string },
  options: { toolCallId: string },
  turn: DocumentReadTurn
): Promise<string> {
  if (!turn.enabled) {
    logView("viewFile", null, 0, 0);
    return CHAT_READING_OFF;
  }
  if (!turn.vision) {
    logView("viewFile", null, 0, 0);
    return CHAT_VIEW_OFF;
  }
  const resolved = resolveEntry(turn.files, "F", input.file, (entry) => entry.fileName);
  if (resolved.kind !== "one" || !resolved.entry.documentId || !ctx.threadId) {
    logView("viewFile", null, 0, 0);
    return resolved.kind === "many" ? manyText("file", resolved.handles, "viewFile") : CHAT_READ_NO_FILE;
  }
  const file = resolved.entry;
  const ref = file.handle ? `${file.handle} ${quoted(file.fileName)}` : quoted(file.fileName);
  if (!file.viewable) {
    logView("viewFile", null, 0, 0);
    return chatViewNotMedia(ref);
  }
  // No await before this call: the allowance is taken synchronously inside.
  const loaded = await loadMedia(ctx, file, turn);
  switch (loaded.status) {
    case "ok": {
      const receipt = chatViewReceipt(ref, loaded.kind, loaded.size, loaded.pageCount);
      const markers = openedMediaMarkers(
        {
          fileName: loaded.fileName,
          ...(loaded.category ? { category: loaded.category } : {}),
          ...(loaded.uploaderRole ? { uploaderRole: loaded.uploaderRole } : {}),
        },
        file.handle ?? "file"
      );
      turn.opened.set(options.toolCallId, [
        { type: "text", text: `${receipt}\n\n${markers.begin}` },
        toolMediaPart(loaded),
        { type: "text", text: markers.end },
      ]);
      logView("viewFile", loaded.kind, loaded.size, loaded.pageCount ?? 0);
      return receipt;
    }
    case "off":
      return CHAT_READING_OFF;
    case "vision_off":
      return CHAT_VIEW_OFF;
    case "not_found":
      return CHAT_READ_NO_FILE;
    case "not_media":
      return chatViewNotMedia(ref);
    case "too_big":
      return chatViewTooBig(ref, loaded.kind, loaded.size);
    case "too_many_pages":
      return chatViewTooManyPages(ref, loaded.pageCount);
    case "unreadable":
      return chatViewUnreadable(ref);
    case "allowance":
      return CHAT_VIEW_BUDGET_USED;
    case "unavailable":
    case "failed":
      return CHAT_READ_FAILED;
  }
}

// ─── Pinned files (Phase C, 2026-10-20) ──────────────────────────────────────

/** Why a pinned PDF or image went as its text, or not at all. */
function pinMediaReason(loaded: MediaLoad): string | null {
  switch (loaded.status) {
    case "too_big":
      return `its original is too large to show (${formatBytes(loaded.size)})`;
    case "too_many_pages":
      return `it has ${formatCount(loaded.pageCount)} pages, more than the ${CHAT_VIEW_MAX_PDF_PAGES} that can be shown`;
    case "allowance":
      return "this reply's viewing allowance was used up";
    case "vision_off":
      return "viewing PDFs and images is turned off";
    case "unreadable":
      return "its original could not be opened";
    default:
      return loaded.status === "ok" ? null : "its original could not be read just now";
  }
}

/**
 * Phase C: the ephemeral user message that puts the files the writer pinned
 * to this message in front of the model, after the options note. PDFs and
 * images whose original can be viewed go as files, under the turn's media
 * allowance; every other file (and a PDF that cannot be shown) goes as its
 * text in an opened block, under the turn's reading allowance, cut with a
 * notice. Pinned files that are gone or unreadable are named in a notice.
 * Built once per turn and never saved; the recovery pass sends it again.
 * Null without pins.
 */
export async function pinnedFilesMessage(
  actionCtx: Pick<ActionCtx, "runQuery" | "runAction"> & { storage: Pick<ActionCtx["storage"], "get"> },
  agentThreadId: string,
  pinned: readonly Id<"projectDocuments">[],
  turn: DocumentReadTurn,
  documents: readonly ChatEvidenceDoc[]
): Promise<ModelMessage | null> {
  const ids = [...new Set(pinned)].slice(0, CHAT_MAX_PINNED_FILES);
  if (ids.length === 0) return null;
  // The reads are scoped through the thread, as the tools' are.
  const ctx: ViewingToolCtx = {
    threadId: agentThreadId,
    runQuery: actionCtx.runQuery,
    runAction: actionCtx.runAction,
    storage: actionCtx.storage,
  };
  if (!turn.enabled) {
    return {
      role: "user",
      content: `The writer pinned ${ids.length} project file(s) to this message, but opening files is turned off for this workspace, so they are not shown. Tell the writer you could not read them.`,
    };
  }
  const parts: Array<TextPart | FilePart> = [];
  const shown: string[] = [];
  const notices: string[] = [];
  let chars = 0;
  let bytes = 0;
  for (const documentId of ids) {
    const file = turn.files.find((entry) => entry.documentId === documentId);
    const doc = documents.find((entry) => entry.documentId === documentId);
    if (!file || !doc) {
      notices.push("One pinned file is no longer in this project's files, so it is not shown.");
      continue;
    }
    const ref = file.handle ? `${file.handle} ${quoted(file.fileName)}` : quoted(file.fileName);
    const place = file.handle ?? "pinned file";
    const meta = {
      fileName: doc.fileName,
      ...(doc.category ? { category: doc.category } : {}),
      ...(doc.uploaderRole ? { uploaderRole: doc.uploaderRole } : {}),
    };
    let reason: string | null = null;
    if (file.viewable) {
      if (turn.vision) {
        const loaded = await loadMedia(ctx, file, turn);
        if (loaded.status === "ok") {
          const markers = openedMediaMarkers(meta, place);
          parts.push(
            { type: "text", text: markers.begin },
            { type: "file", data: loaded.data, mediaType: loaded.mediaType },
            { type: "text", text: markers.end }
          );
          shown.push(
            loaded.kind === "pdf" ? `${ref} (a PDF of ${formatCount(loaded.pageCount ?? 0)} page(s))` : `${ref} (an image)`
          );
          bytes += loaded.size;
          continue;
        }
        reason = pinMediaReason(loaded);
      } else {
        reason = "viewing PDFs and images is turned off";
      }
    }
    if (!file.hasText) {
      notices.push(`${ref} has no text${reason ? `, and ${reason}` : ""}, so it is not shown.`);
      continue;
    }
    const content = doc.content;
    const granted = reserveReading(turn, content.length);
    if (granted === 0) {
      notices.push(`${ref} is not shown: this reply's reading allowance of ${formatCount(CHAT_READ_MAX_TURN_CHARS)} characters is used up.`);
      continue;
    }
    const end = safeRange(content, 0, granted).end;
    releaseReading(turn, granted - end);
    chars += end;
    parts.push({ type: "text", text: openedDocumentBlock(meta, `${place}, pinned`, content.slice(0, end)) });
    shown.push(`${ref} (text${reason ? `, because ${reason}` : ""})`);
    if (end < content.length) {
      notices.push(
        `${ref} is cut at ${formatCount(end)} of ${formatCount(content.length)} characters because this reply's reading allowance ran out. To read on, call readDocument with part ${partAt(end)}.`
      );
    }
  }
  const intro = shown.length
    ? `The writer pinned these project files to this message so you read them in full. They are below, for this reply only, and you do not need to open them: ${shown.join("; ")}.`
    : "The writer pinned project files to this message, but none of them could be shown.";
  logView("pinned", null, bytes, 0);
  logRead("pinned", chars, chars > 0 ? Math.ceil(chars / CHAT_READ_PART_CHARS) : 0);
  return {
    role: "user",
    content: [
      { type: "text", text: intro },
      ...parts,
      ...(notices.length ? [{ type: "text" as const, text: notices.join("\n") }] : []),
    ],
  };
}

// ─── The tools ───────────────────────────────────────────────────────────────

export function makeReadDocumentTool(turn: DocumentReadTurn) {
  return createTool({
    description: `Open a project file and read its text, in parts of ${formatCount(CHAT_READ_PART_CHARS)} characters, up to ${CHAT_READ_MAX_PARTS} parts per call. Use it when the evidence blocks do not hold what you need: a file a notice says was left out, or more of a file than its block shows. Name the file by its handle in FILES IN THIS PROJECT, such as F3, or by its exact name. Files with no text, such as images and scans, cannot be opened. The text is shown to you for this reply only.`,
    inputSchema: z.object({
      file: z.string().min(1).describe("The file's handle from FILES IN THIS PROJECT, such as F3, or its exact file name."),
      part: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(`The part to start from, counting from 1. Each part is ${formatCount(CHAT_READ_PART_CHARS)} characters. Defaults to 1.`),
      parts: z
        .number()
        .int()
        .min(1)
        .max(CHAT_READ_MAX_PARTS)
        .optional()
        .describe(`How many parts to read, at most ${CHAT_READ_MAX_PARTS}. Defaults to 1.`),
    }),
    execute: async (ctx, input, options): Promise<string> =>
      await runReadDocument(ctx, input, { toolCallId: options.toolCallId }, turn),
  });
}

export function makeSearchDocumentsTool(turn: DocumentReadTurn) {
  return createTool({
    description: `Search the text of this project's files and transcripts for words, and get up to ${CHAT_SEARCH_MAX_EXCERPTS} short excerpts, each with its place, such as F3 part 2 or T1 turns 40-46. Use it to find where something is mentioned, then open the file or transcript to read more. Write words as they appear in the files; in transcripts, accents do not need to match.`,
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .max(200)
        .describe("A few distinctive words to look for, for example 'calibration drift sensor'."),
    }),
    execute: async (ctx, input, options): Promise<string> =>
      await runSearchDocuments(ctx, input, { toolCallId: options.toolCallId }, turn),
  });
}

export function makeReadTranscriptTool(turn: DocumentReadTurn) {
  return createTool({
    description: `Open an interview transcript of this project and read its speaker turns, up to ${formatCount(CHAT_TRANSCRIPT_READ_CHARS)} characters per call. Name it by its handle in TRANSCRIPTS IN THIS PROJECT, such as T1, or by its exact label. Each line gives the turn number, the time when known, the speaker's role and the speaker's name as written. A transcript without speaker turns is read in parts of ${formatCount(CHAT_READ_PART_CHARS)} characters, and fromTurn then counts parts. The text is shown to you for this reply only.`,
    inputSchema: z.object({
      transcript: z.string().min(1).describe("The transcript's handle from TRANSCRIPTS IN THIS PROJECT, such as T1, or its exact label."),
      fromTurn: z.number().int().min(1).optional().describe("The turn to start from, counting from 1. Defaults to 1."),
      turns: z.number().int().min(1).optional().describe("At most this many turns. Defaults to as many as fit."),
    }),
    execute: async (ctx, input, options): Promise<string> =>
      await runReadTranscript(ctx, input, { toolCallId: options.toolCallId }, turn),
  });
}

/** Phase C (2026-10-20): appended after readTranscript. */
export function makeViewFileTool(turn: DocumentReadTurn) {
  return createTool({
    description: `Look at a project PDF's pages or an image itself, when its text is not enough: a scan, a figure, a chart, a form or a table's layout. Name the file by its handle in FILES IN THIS PROJECT, such as F3, or by its exact name. Only files the list marks as ones viewFile can show work. Images can be at most ${formatBytes(CHAT_VIEW_MAX_IMAGE_BYTES)}; PDFs at most ${formatBytes(CHAT_VIEW_MAX_PDF_BYTES)} and ${CHAT_VIEW_MAX_PDF_PAGES} pages; one reply can view at most ${formatBytes(CHAT_VIEW_MAX_TURN_BYTES)} and ${CHAT_VIEW_MAX_IMAGES} images in all. For a file's words, use readDocument instead. What you see is shown to you for this reply only.`,
    inputSchema: z.object({
      file: z.string().min(1).describe("The file's handle from FILES IN THIS PROJECT, such as F3, or its exact file name."),
    }),
    execute: async (ctx, input, options): Promise<string> =>
      await runViewFile(ctx, input, { toolCallId: options.toolCallId }, turn),
  });
}
