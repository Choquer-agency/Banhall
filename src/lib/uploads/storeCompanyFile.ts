import type { FunctionArgs } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { parseFileToText, type ParsedFileType } from "$lib/parseDocument";
import { isParseAbort } from "$lib/spreadsheetClient";
import { guessFileType } from "$lib/components/project-new/shared";
import { withUploadTimeout } from "./outboxFlush";
import { uploadOriginal } from "./originalUpload";

/**
 * One file into a company (2026-10-26, Phase C): read its text in the
 * browser, keep the original bytes, and save the company file row. The same
 * steps as a project file (storeProjectFile.ts): a file that cannot be read
 * is still saved with no text, so the server reads it or gives it an honest
 * status; lost original bytes still leave the text worth having. Only a
 * refused or timed-out save throws, plus an abort, rethrown as it is.
 *
 * 2026-11-04 (the company profile): each step is reported (`onProgress`,
 * with the share of the original sent), a file over 50 MB is refused in the
 * browser before anything is sent, and Replace file reads and uploads a new
 * original the same way (`prepareCompanyFile`) before it is swapped in.
 */

export type AddCompanyFileArgs = FunctionArgs<typeof api.companyFiles.addCompanyFile>;

/** The largest original a company file takes (convex/lib/storage.ts MAX_UPLOAD_BYTES). */
export const MAX_COMPANY_FILE_BYTES = 50 * 1024 * 1024;
export const TOO_LARGE_MESSAGE = "Too large, up to 50 MB";

/** A file over 50 MB, refused before it is read or sent. */
export class CompanyFileTooLargeError extends Error {
  constructor() {
    super(TOO_LARGE_MESSAGE);
    this.name = "CompanyFileTooLargeError";
  }
}

export function isTooLarge(file: Pick<File, "size">): boolean {
  return file.size > MAX_COMPANY_FILE_BYTES;
}

export type CompanyFileProgress =
  | { phase: "reading" }
  | { phase: "uploading"; fraction: number }
  | { phase: "saving" };

export type StoreCompanyFileDeps = {
  generateUploadUrl: (args: Record<string, never>) => Promise<string>;
  addCompanyFile: (args: AddCompanyFileArgs) => Promise<Id<"companyFiles">>;
  /** Injected in unit tests; the real parser otherwise. */
  parse?: typeof parseFileToText;
  /** Injected in unit tests; a progress-reporting upload otherwise. */
  fetch?: typeof fetch;
};

export type PreparedCompanyFile = {
  fileName: string;
  fileType: ParsedFileType;
  content: string;
  textFormat?: "markdown";
  extractionFailed: boolean;
  storageId?: Id<"_storage">;
  mimeType?: string;
};

/**
 * A `fetch` for the original's POST that reports how much of the body was
 * sent (XMLHttpRequest, the only browser API with upload progress). Other
 * requests, and a body that is not a Blob, go through `fetch` unchanged.
 */
export function progressFetch(onFraction: (fraction: number) => void): typeof fetch {
  return (resource, init) => {
    const body = init?.body;
    if (typeof XMLHttpRequest === "undefined" || !(body instanceof Blob) || init?.method !== "POST") {
      return fetch(resource, init);
    }
    return new Promise<Response>((resolve, reject) => {
      const request = new XMLHttpRequest();
      const signal = init.signal;
      const abort = () => request.abort();
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException("Upload canceled", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      request.open("POST", String(resource instanceof Request ? resource.url : resource));
      const headers = new Headers(init.headers);
      headers.forEach((value, key) => request.setRequestHeader(key, value));
      request.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onFraction(Math.min(1, event.loaded / event.total));
      };
      request.onload = () => {
        signal?.removeEventListener("abort", abort);
        onFraction(1);
        resolve(new Response(request.responseText, { status: request.status }));
      };
      request.onerror = () => {
        signal?.removeEventListener("abort", abort);
        reject(new TypeError("Original upload failed"));
      };
      request.onabort = () => {
        signal?.removeEventListener("abort", abort);
        reject(signal?.reason ?? new DOMException("Upload canceled", "AbortError"));
      };
      request.send(body);
    });
  };
}

/**
 * Reads a file's text in the browser and stores its original: everything a
 * company file save needs except the save itself. A file over 50 MB throws
 * CompanyFileTooLargeError before anything is read or sent.
 */
export async function prepareCompanyFile(
  deps: Pick<StoreCompanyFileDeps, "generateUploadUrl" | "parse" | "fetch">,
  input: { file: File; signal?: AbortSignal; onProgress?: (progress: CompanyFileProgress) => void }
): Promise<PreparedCompanyFile> {
  const { file, signal, onProgress } = input;
  if (isTooLarge(file)) throw new CompanyFileTooLargeError();
  const parse = deps.parse ?? parseFileToText;
  signal?.throwIfAborted();

  onProgress?.({ phase: "reading" });
  let content = "";
  let fileType: ParsedFileType = guessFileType(file.name);
  let extractionFailed = false;
  let textFormat: "markdown" | undefined;
  try {
    const parsed = await parse(file, signal ? { signal } : {});
    content = parsed.content;
    fileType = parsed.fileType;
    textFormat = parsed.textFormat;
  } catch (error) {
    if (isParseAbort(error)) throw error;
    console.error("Could not read file", error);
    extractionFailed = true;
  }

  signal?.throwIfAborted();
  onProgress?.({ phase: "uploading", fraction: 0 });
  const report = (fraction: number) => onProgress?.({ phase: "uploading", fraction });
  const storageId = await uploadOriginal({
    file,
    generateUploadUrl: () => deps.generateUploadUrl({}),
    fetch: deps.fetch ?? progressFetch(report),
    ...(signal ? { signal } : {}),
  });
  signal?.throwIfAborted();
  return {
    fileName: file.name,
    fileType,
    content,
    ...(textFormat ? { textFormat } : {}),
    extractionFailed,
    ...(storageId ? { storageId } : {}),
    ...(file.type ? { mimeType: file.type } : {}),
  };
}

export async function storeCompanyFile(
  deps: StoreCompanyFileDeps,
  input: {
    clientId: Id<"clients">;
    file: File;
    /** One key per picked file, reused by Try again, so a save whose answer was lost is not made twice. */
    attemptKey: string;
    signal?: AbortSignal;
    onProgress?: (progress: CompanyFileProgress) => void;
  }
): Promise<{ companyFileId: Id<"companyFiles">; extractionFailed: boolean }> {
  const prepared = await prepareCompanyFile(deps, input);
  input.onProgress?.({ phase: "saving" });
  const companyFileId = await withUploadTimeout(
    deps.addCompanyFile({
      clientId: input.clientId,
      fileName: prepared.fileName,
      fileType: prepared.fileType,
      content: prepared.content,
      // A validated enum, never the error itself.
      extractionOutcome: prepared.extractionFailed ? "failed" : "ok",
      ...(prepared.textFormat ? { textFormat: prepared.textFormat } : {}),
      attemptKey: input.attemptKey,
      ...(prepared.storageId ? { storageId: prepared.storageId } : {}),
      ...(prepared.mimeType ? { mimeType: prepared.mimeType } : {}),
    })
  );
  return { companyFileId, extractionFailed: prepared.extractionFailed };
}
