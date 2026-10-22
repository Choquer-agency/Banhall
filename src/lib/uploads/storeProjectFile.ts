import type { FunctionArgs } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ContextCategoryId } from "$lib/contextCategories";
import { parseFileToText, type ParsedFileType } from "$lib/parseDocument";
import { isParseAbort } from "$lib/spreadsheetClient";
import { guessFileType } from "$lib/components/project-new/shared";
import { withUploadTimeout } from "./outboxFlush";
import { uploadOriginal } from "./originalUpload";

/**
 * One file into a project: read its text, keep the original bytes, and save
 * the document row. Shared by the files panel's Add files and Replace file.
 *
 * Only a refused or timed-out save throws, plus an abort, which is rethrown as
 * it is. A file that cannot be read is still saved with no text, so the server
 * gives it an honest status; lost original bytes still leave the text worth
 * having.
 */

export type UploadDocumentArgs = FunctionArgs<typeof api.documents.uploadDocument>;

/** What `createExtractionScope().capture()` returns. */
export type ExtractionOperation = {
  signal: AbortSignal;
  throwIfAborted(): void;
};

export type StoreProjectFileDeps = {
  generateUploadUrl: (args: Record<string, never>) => Promise<string>;
  uploadDocument: (args: UploadDocumentArgs) => Promise<Id<"projectDocuments">>;
  /** Injected in unit tests; the real parser otherwise. */
  parse?: typeof parseFileToText;
};

export type StoreProjectFileInput = {
  projectId: Id<"projects">;
  file: File;
  /** Resolves the upload attempt in the same transaction as the insert. */
  attemptKey: string;
  source: string;
  category?: ContextCategoryId;
  operation: ExtractionOperation;
};

export type StoredProjectFile = {
  documentId: Id<"projectDocuments">;
  content: string;
  extractionFailed: boolean;
};

export async function storeProjectFile(
  deps: StoreProjectFileDeps,
  input: StoreProjectFileInput
): Promise<StoredProjectFile> {
  const { file, operation } = input;
  const parse = deps.parse ?? parseFileToText;
  operation.throwIfAborted();

  let content = "";
  let fileType: ParsedFileType = guessFileType(file.name);
  let extractionFailed = false;
  try {
    const parsed = await parse(file, { signal: operation.signal });
    content = parsed.content;
    fileType = parsed.fileType;
  } catch (error) {
    if (isParseAbort(error)) throw error;
    console.error("Could not read file", error);
    extractionFailed = true;
  }

  operation.throwIfAborted();
  // The shared transport: one retry with a fresh URL, a deadline, and a
  // checked response. Undefined when the bytes could not be stored.
  const storageId = await uploadOriginal({
    file,
    generateUploadUrl: () => deps.generateUploadUrl({}),
    fetch: (input, init) => fetch(input, init),
    signal: operation.signal,
  });

  operation.throwIfAborted();
  const documentId = await withUploadTimeout(
    deps.uploadDocument({
      projectId: input.projectId,
      fileName: file.name,
      fileType,
      content,
      source: input.source,
      ...(input.category ? { category: input.category } : {}),
      // A validated enum, never the error itself: the server decides what the
      // failure means, and no parser text can ride along.
      extractionOutcome: extractionFailed ? "failed" : "ok",
      attemptKey: input.attemptKey,
      ...(storageId ? { storageId } : {}),
      ...(file.type ? { mimeType: file.type } : {}),
    })
  );
  operation.throwIfAborted();
  return { documentId, content, extractionFailed };
}
