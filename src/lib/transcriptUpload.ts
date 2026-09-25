/**
 * Reading a transcript file in the browser (phase 3, the transcript method).
 * The text is extracted here, its format detected and VTT/SRT rendered to the
 * canonical verbatim form (shared/transcriptParse.ts); the server re-parses
 * the stored text itself. The original bytes can be uploaded alongside so
 * the project keeps the file it came from.
 */
import {
  isTranscriptFileName,
  prepareTranscriptUpload,
  TRANSCRIPT_FORMAT_LABELS,
  type TranscriptSourceFormat,
} from "../../shared/transcriptParse";

/** Same limits the server enforces (convex/lib/transcripts.ts). */
export const MAX_TRANSCRIPT_CHARS = 500_000;
export const MAX_TRANSCRIPT_FILE_BYTES = 25 * 1024 * 1024;

export const TRANSCRIPT_FILE_TYPES_COPY =
  "Transcripts can be Word (.docx), WebVTT (.vtt), SubRip (.srt) or text (.txt) files.";

export type ReadTranscript = {
  label: string;
  content: string;
  format: TranscriptSourceFormat;
  formatLabel: string;
  file: File;
};

export class TranscriptFileError extends Error {}

async function extractText(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  return await file.text();
}

/**
 * One transcript file as the text and format the app stores. Throws a
 * TranscriptFileError with a sentence the writer can act on.
 */
export async function readTranscriptFile(file: File): Promise<ReadTranscript> {
  if (!isTranscriptFileName(file.name)) {
    throw new TranscriptFileError(`${file.name} is not a transcript file. ${TRANSCRIPT_FILE_TYPES_COPY}`);
  }
  if (file.size > MAX_TRANSCRIPT_FILE_BYTES) {
    throw new TranscriptFileError(`${file.name} is larger than 25 MB.`);
  }
  let raw: string;
  try {
    raw = await extractText(file);
  } catch {
    throw new TranscriptFileError(`Couldn't read ${file.name}. Try another file.`);
  }
  const { format, content } = prepareTranscriptUpload({ fileName: file.name, text: raw, intake: "file" });
  if (!content.trim()) {
    throw new TranscriptFileError(`Couldn't extract any text from ${file.name}.`);
  }
  if (content.length > MAX_TRANSCRIPT_CHARS) {
    throw new TranscriptFileError(
      `${file.name} is longer than 500,000 characters. Split it into two transcripts.`
    );
  }
  return { label: file.name, content, format, formatLabel: TRANSCRIPT_FORMAT_LABELS[format], file };
}

/** Pasted text as the text and format the app stores. */
export function readPastedTranscript(text: string): { content: string; format: TranscriptSourceFormat } {
  return prepareTranscriptUpload({ text, intake: "paste" });
}

/**
 * Uploads the original bytes through a Convex upload URL and returns the
 * storage id, or null when the upload fails: the transcript text is what
 * generation reads, so a failed original upload never blocks it.
 */
export async function uploadTranscriptOriginal(
  file: File,
  generateUploadUrl: () => Promise<string>
): Promise<string | null> {
  try {
    const url = await generateUploadUrl();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { storageId?: string };
    return body.storageId ?? null;
  } catch {
    return null;
  }
}

/** SHA-256 hex of a text, matching the server's `contentHash`. */
export async function transcriptContentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
