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

/** Why a transcript file was refused, so New project can show E5's boxes. */
export type TranscriptFileProblem = "type" | "size" | "unreadable" | "empty" | "too_long";

export class TranscriptFileError extends Error {
  readonly problem: TranscriptFileProblem;
  constructor(message: string, problem: TranscriptFileProblem = "unreadable") {
    super(message);
    this.problem = problem;
  }
}

/** The parts of a mammoth document element the text walk reads. */
type DocxNode = { type: string; value?: string; breakType?: string; children?: DocxNode[] };

/**
 * mammoth's raw text walk (node_modules/mammoth/lib/raw-text.js) with one
 * change: a soft line break (`w:br`) reads as a newline. `extractRawText`
 * drops it, and a cue-timed Teams export writes each cue as one paragraph
 * with soft breaks between the timing, the speaker's name and the speech, so
 * the three were glued into one line and no cue kept its speaker:
 * "0:0:0.0 --> 0:0:3.520Dana WhitfieldThanks for joining.". Everything else
 * reads as before:
 * paragraphs end in a blank line, tabs read as tabs, page and column breaks
 * read as nothing.
 */
function docxNodeText(node: DocxNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type === "tab") return "\t";
  if (node.type === "break") return node.breakType === "line" ? "\n" : "";
  const tail = node.type === "paragraph" ? "\n\n" : "";
  return (node.children ?? []).map(docxNodeText).join("") + tail;
}

/**
 * The text of a transcript .docx with its soft line breaks kept
 * (`docxNodeText`). mammoth hands the document tree to `transformDocument`
 * before it builds HTML; the walk reads the tree there, the HTML is thrown
 * away and images are never read. The browser passes `arrayBuffer`;
 * mammoth's Node build (tests) takes `buffer`.
 */
export async function docxTranscriptText(
  input: { arrayBuffer: ArrayBuffer } | { buffer: Uint8Array }
): Promise<string> {
  const mammoth = await import("mammoth");
  const mammothInput = input as Parameters<typeof mammoth.extractRawText>[0];
  let text: string | undefined;
  try {
    await mammoth.convertToHtml(mammothInput, {
      transformDocument: (document: DocxNode) => {
        text = docxNodeText(document);
        return document;
      },
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    });
  } catch {
    text = undefined;
  }
  // Never worse than before: if the walk could not run, read as before.
  return text ?? (await mammoth.extractRawText(mammothInput)).value;
}

async function extractText(file: File): Promise<string> {
  if (file.name.toLowerCase().endsWith(".docx")) {
    return await docxTranscriptText({ arrayBuffer: await file.arrayBuffer() });
  }
  return await file.text();
}

/**
 * One transcript file as the text and format the app stores. Throws a
 * TranscriptFileError with a sentence the writer can act on.
 */
export async function readTranscriptFile(file: File): Promise<ReadTranscript> {
  if (!isTranscriptFileName(file.name)) {
    throw new TranscriptFileError(`${file.name} is not a transcript file. ${TRANSCRIPT_FILE_TYPES_COPY}`, "type");
  }
  if (file.size > MAX_TRANSCRIPT_FILE_BYTES) {
    throw new TranscriptFileError(`${file.name} is larger than 25 MB.`, "size");
  }
  let raw: string;
  try {
    raw = await extractText(file);
  } catch {
    throw new TranscriptFileError(`Couldn't read ${file.name}. Try another file.`, "unreadable");
  }
  const { format, content } = prepareTranscriptUpload({ fileName: file.name, text: raw, intake: "file" });
  if (!content.trim()) {
    throw new TranscriptFileError(`Couldn't extract any text from ${file.name}.`, "empty");
  }
  if (content.length > MAX_TRANSCRIPT_CHARS) {
    throw new TranscriptFileError(
      `${file.name} is longer than 500,000 characters. Split it into two transcripts.`,
      "too_long"
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
 * generation reads, so a failed original upload never blocks it. The file
 * is then claimed as this user's upload (`documents.claimUpload`), which is
 * what lets `discardTranscriptOriginals` release it after a refusal; a
 * failed claim only means the storage sweep releases it instead.
 */
export async function uploadTranscriptOriginal(
  file: File,
  generateUploadUrl: () => Promise<string>,
  claimUpload?: (storageId: string) => Promise<unknown>
): Promise<string | null> {
  let storageId: string | null;
  try {
    const url = await generateUploadUrl();
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { storageId?: string };
    storageId = body.storageId ?? null;
  } catch {
    return null;
  }
  if (storageId && claimUpload) {
    try {
      await claimUpload(storageId);
    } catch {
      // Best effort, see above.
    }
  }
  return storageId;
}

/**
 * Runs `save` with the originals just uploaded for it. The bytes go to
 * storage before the server checks anything, so when `save` throws (a
 * duplicate, a cap, a report generating) the originals are released first
 * (`transcripts.discardTranscriptOriginals`, which deletes only files no row
 * holds) and then the error goes on. A failed release never hides the
 * refusal.
 */
export async function releaseOriginalsOnFailure<T>(
  storageIds: readonly string[],
  discard: (storageIds: string[]) => Promise<unknown>,
  save: () => Promise<T>
): Promise<T> {
  try {
    return await save();
  } catch (error) {
    if (storageIds.length > 0) {
      try {
        await discard([...storageIds]);
      } catch {
        // Best effort: the refusal is what the writer needs to see.
      }
    }
    throw error;
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
