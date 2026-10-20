// Report chat parity, Phase C (2026-10-20): the limits and helpers for the
// PDFs and images the chat sends to Anthropic inline (viewFile and pinned
// files). Pure functions only, shared by the default runtime (the chat
// action, its queries and the evidence lists).
//
// The limits fit Anthropic's 32 MB request limit and its 10 MB base64 image
// limit, and the chat action's 64 MiB memory: base64 plus the request body
// is about 3x the raw size.

import type { Doc } from "../_generated/dataModel";
import { getFileExtension } from "../../shared/documentStatus";

/** One image's original, in bytes. */
export const CHAT_VIEW_MAX_IMAGE_BYTES = 5_000_000;
/** One PDF's original, in bytes. */
export const CHAT_VIEW_MAX_PDF_BYTES = 8_000_000;
/** One PDF's pages. No page ranges: a longer PDF is read as text. */
export const CHAT_VIEW_MAX_PDF_PAGES = 30;
/** Originals sent in one reply, viewed and pinned together, across its passes. */
export const CHAT_VIEW_MAX_TURN_BYTES = 8_000_000;
/** Images sent in one reply, viewed and pinned together. */
export const CHAT_VIEW_MAX_IMAGES = 12;

export type ChatMediaKind = "image" | "pdf";
export type ChatImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type ChatMediaType = ChatImageMediaType | "application/pdf";

const IMAGE_TYPES: Readonly<Record<string, ChatImageMediaType>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * The media a stored original can be viewed as, from the stored file type
 * and the name's extension (never the browser's `mimeType`, which is
 * untrusted), or null when it is neither a PDF nor one of the four image
 * types Anthropic reads.
 */
export function chatViewMedia(
  fileName: string,
  fileType: Doc<"projectDocuments">["fileType"] | undefined
): { kind: ChatMediaKind; mediaType: ChatMediaType } | null {
  const extension = getFileExtension(fileName);
  if (fileType === "pdf" && extension === "pdf") return { kind: "pdf", mediaType: "application/pdf" };
  if (fileType === "image") {
    const mediaType = IMAGE_TYPES[extension];
    if (mediaType) return { kind: "image", mediaType };
  }
  return null;
}

/**
 * What the bytes themselves are, by their signature: a PDF or one of the
 * four image types, else null. A file named `.png` that holds a JPEG is
 * sent as a JPEG, since Anthropic refuses an image whose declared type does
 * not match its bytes.
 */
export function sniffChatMedia(bytes: Uint8Array): ChatMediaType | null {
  const at = (index: number) => bytes[index] ?? -1;
  const ascii = (start: number, text: string) =>
    [...text].every((char, index) => at(start + index) === char.charCodeAt(0));
  if (ascii(0, "%PDF-")) return "application/pdf";
  if (at(0) === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Standard base64 of `bytes`, encoded once per file. Plain JavaScript, so it
 * runs the same in every Convex runtime; built in chunks so no single string
 * concatenation grows one character at a time.
 */
export function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const CHUNK = 3 * 16_384;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const end = Math.min(bytes.length, offset + CHUNK);
    const out: string[] = [];
    let i = offset;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
      out.push(BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]! + BASE64[(n >> 6) & 63]! + BASE64[n & 63]!);
    }
    if (i < end) {
      const a = bytes[i]!;
      const b = i + 1 < end ? bytes[i + 1]! : 0;
      const n = (a << 16) | (b << 8);
      out.push(
        BASE64[(n >> 18) & 63]! +
          BASE64[(n >> 12) & 63]! +
          (i + 1 < end ? BASE64[(n >> 6) & 63]! : "=") +
          "="
      );
    }
    chunks.push(out.join(""));
  }
  return chunks.join("");
}

/** A byte size in plain words: "840 KB", "2.4 MB" (decimal, as the limits are). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(Math.round(bytes / 100_000) / 10).toLocaleString("en-US")} MB`;
  return `${Math.max(1, Math.round(bytes / 1_000)).toLocaleString("en-US")} KB`;
}
