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
 */

export type AddCompanyFileArgs = FunctionArgs<typeof api.companyFiles.addCompanyFile>;

export type StoreCompanyFileDeps = {
  generateUploadUrl: (args: Record<string, never>) => Promise<string>;
  addCompanyFile: (args: AddCompanyFileArgs) => Promise<Id<"companyFiles">>;
  /** Injected in unit tests; the real parser otherwise. */
  parse?: typeof parseFileToText;
};

export async function storeCompanyFile(
  deps: StoreCompanyFileDeps,
  input: {
    clientId: Id<"clients">;
    file: File;
    /** One key per picked file, reused by Try again, so a save whose answer was lost is not made twice. */
    attemptKey: string;
    signal?: AbortSignal;
  }
): Promise<{ companyFileId: Id<"companyFiles">; extractionFailed: boolean }> {
  const { file, signal } = input;
  const parse = deps.parse ?? parseFileToText;
  signal?.throwIfAborted();

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
  const storageId = await uploadOriginal({
    file,
    generateUploadUrl: () => deps.generateUploadUrl({}),
    fetch: (resource, init) => fetch(resource, init),
    ...(signal ? { signal } : {}),
  });

  signal?.throwIfAborted();
  const companyFileId = await withUploadTimeout(
    deps.addCompanyFile({
      clientId: input.clientId,
      fileName: file.name,
      fileType,
      content,
      // A validated enum, never the error itself.
      extractionOutcome: extractionFailed ? "failed" : "ok",
      ...(textFormat ? { textFormat } : {}),
      attemptKey: input.attemptKey,
      ...(storageId ? { storageId } : {}),
      ...(file.type ? { mimeType: file.type } : {}),
    })
  );
  return { companyFileId, extractionFailed };
}
