import { SvelteSet } from "svelte/reactivity";
import type { Id } from "../../../convex/_generated/dataModel";
import { deriveProcessingStatus, isSupportedFile } from "../../../shared/documentStatus";
import type { ContextCategoryId } from "$lib/contextCategories";
import { createRequestId } from "$lib/requestId";
import { isParseAbort } from "$lib/spreadsheetClient";
import {
  appendOutbox,
  clearOutboxFor,
  type OutboxFailureCode,
  type OutboxOrigin,
} from "./attemptOutbox";
import {
  ATTEMPT_BATCH_LIMIT,
  flushOutboxFor,
  shouldDropOutboxEntry,
  withUploadTimeout,
} from "./outboxFlush";
import type { EphemeralEntry, ReceiptRow } from "./receiptRows";
import {
  storeProjectFile,
  type ExtractionOperation,
  type StoreProjectFileDeps,
} from "./storeProjectFile";

/**
 * Add files from the project's files panel (2026-10-19, replacing the chat's
 * "Add a document"). There is no files-panel value for `source` or `origin`
 * yet; "context_input" is what New project's supporting documents use, and
 * these are the same kind of file: categorized contextual input.
 */
export const PROJECT_FILE_SOURCE = "context_input";
export const PROJECT_FILE_ORIGIN: OutboxOrigin = "context_input";

type AttemptPayload = {
  attemptKey: string;
  fileName: string;
  fileSizeBytes?: number;
  origin: OutboxOrigin;
  failureCode?: OutboxFailureCode;
};

type AttemptInfo = { attemptKey: string; fileName: string; fileSizeBytes: number };

export type ProjectFileUploadDeps = StoreProjectFileDeps & {
  projectId: () => Id<"projects">;
  /** Scopes the offline outbox to whoever queued an entry. */
  userId: () => string | undefined;
  capture: () => ExtractionOperation;
  recordUploadAttempts: (args: {
    projectId: Id<"projects">;
    attempts: AttemptPayload[];
  }) => Promise<unknown>;
  dismissUploadAttempt: (args: {
    projectId: Id<"projects">;
    attemptKey: string;
  }) => Promise<unknown>;
  /** Documents the project lists now, to tell a new file from one it already has. */
  listedDocumentIds: () => ReadonlySet<string>;
  /** The save returned a file the project already had, so nothing was added. */
  onAlreadyInProject?: (fileName: string) => void;
};

/**
 * The in-session half of the files panel's receipt: one entry per file being
 * added, plus the files waiting for a category. Call during component setup;
 * everything is discarded when the project changes or the component goes away.
 */
export function createProjectFileUploads(deps: ProjectFileUploadDeps) {
  let entries = $state<EphemeralEntry[]>([]);
  // Raw: File objects are host objects and must not be proxied.
  let pendingFiles = $state.raw<File[] | null>(null);
  // The running batch, scoped to its project: a new project's Add files must
  // not wait on an old project's upload that is still settling.
  let batch = $state.raw<{ projectId: Id<"projects"> } | null>(null);
  const uploading = $derived(batch !== null && batch.projectId === deps.projectId());
  const busy = new SvelteSet<string>();
  // Files again, so outside reactive state; only Retry reads it.
  const retryable = new Map<string, { file: File; category: ContextCategoryId }>();
  // A row removed here stays hidden under its attempt key, so the server's
  // copy of the same failure cannot show while the dismiss is on its way.
  // Once dismissed, the server stops listing it too.
  const hiddenAttempts = new SvelteSet<string>();

  $effect(() => {
    // Selections, rows and retained files belong to this exact project.
    deps.projectId();
    return () => {
      entries = [];
      pendingFiles = null;
      batch = null;
      retryable.clear();
      busy.clear();
      hiddenAttempts.clear();
    };
  });

  function patch(attemptKey: string, change: Partial<EphemeralEntry>) {
    entries = entries.map((entry) =>
      entry.attemptKey === attemptKey ? { ...entry, ...change } : entry
    );
  }

  /**
   * Record failures durably. If the server is unreachable they are queued
   * locally instead, because a network failure is exactly the case that leaves
   * no server-side trace. Never throws.
   */
  async function recordFailures(
    projectId: Id<"projects">,
    items: AttemptInfo[],
    failureCode: OutboxFailureCode
  ) {
    for (let i = 0; i < items.length; i += ATTEMPT_BATCH_LIMIT) {
      const slice = items.slice(i, i + ATTEMPT_BATCH_LIMIT);
      try {
        await withUploadTimeout(
          deps.recordUploadAttempts({
            projectId,
            attempts: slice.map((item) => ({ ...item, origin: PROJECT_FILE_ORIGIN, failureCode })),
          })
        );
      } catch (error) {
        console.error("Failed to record upload attempts", error);
        // The server considered it and refused: queueing would be poison.
        if (shouldDropOutboxEntry(error)) continue;
        const userId = deps.userId();
        if (!userId) continue;
        for (const item of slice) {
          appendOutbox(userId, {
            userId,
            projectId,
            attemptKey: item.attemptKey,
            fileName: item.fileName,
            fileSizeBytes: item.fileSizeBytes,
            origin: PROJECT_FILE_ORIGIN,
            failureCode,
            at: Date.now(),
          });
        }
      }
    }
  }

  /** One file all the way through. Returns whether it was saved. */
  async function uploadOne(
    projectId: Id<"projects">,
    file: File,
    attemptKey: string,
    category: ContextCategoryId
  ): Promise<boolean> {
    const operation = deps.capture();
    const listedBefore = deps.listedDocumentIds();
    try {
      const stored = await storeProjectFile(deps, {
        projectId,
        file,
        attemptKey,
        source: PROJECT_FILE_SOURCE,
        category,
        operation,
      });
      // The server owns the stored status; the same function decides only
      // what this row shows until the document list catches up.
      const derived = deriveProcessingStatus({
        fileName: file.name,
        content: stored.content,
        extractionFailed: stored.extractionFailed,
      });
      patch(attemptKey, {
        status: derived.status,
        detail: derived.detail,
        documentId: stored.documentId,
        hasFile: false,
      });
      retryable.delete(attemptKey);
      // The server returns the existing row for the same file; its list row
      // takes over at once, so say why nothing new appeared.
      if (listedBefore.has(stored.documentId)) deps.onAlreadyInProject?.(file.name);
      return true;
    } catch (error) {
      operation.throwIfAborted();
      if (isParseAbort(error)) throw error;
      console.error("Upload failed", error);
      patch(attemptKey, { status: "upload_failed", hasFile: true });
      await recordFailures(
        projectId,
        [{ attemptKey, fileName: file.name, fileSizeBytes: file.size }],
        "upload_failed"
      );
      return false;
    }
  }

  /** Files chosen in the picker. Unsupported ones get their own row now. */
  function select(files: File[]) {
    const supported = files.filter((file) => isSupportedFile(file.name));
    const rejected = files
      .filter((file) => !isSupportedFile(file.name))
      .map((file) => ({
        attemptKey: createRequestId(),
        fileName: file.name,
        fileSizeBytes: file.size,
      }));
    if (rejected.length) {
      entries = [
        ...entries,
        ...rejected.map((item) => ({
          ...item,
          status: "skipped_unsupported" as const,
          detail: "unsupported_extension" as const,
          hasFile: false,
        })),
      ];
      // These never reach the server, so without a recorded attempt the
      // rejection would vanish on reload.
      void recordFailures(deps.projectId(), rejected, "rejected_unsupported");
    }
    pendingFiles = supported.length ? supported : null;
  }

  function cancel() {
    pendingFiles = null;
  }

  /** Upload the waiting files under one category, one at a time. */
  async function uploadAs(category: ContextCategoryId) {
    const files = pendingFiles;
    if (!files || files.length === 0 || uploading) return;
    const batchOperation = deps.capture();
    const projectId = deps.projectId();
    const current = { projectId };
    pendingFiles = null;
    batch = current;

    const userId = deps.userId();
    if (userId) {
      // Anything queued while offline goes out now that the network is in use.
      void flushOutboxFor(userId, projectId, (attempts) =>
        deps.recordUploadAttempts({ projectId, attempts })
      );
    }

    const queued = files.map((file) => ({ file, attemptKey: createRequestId() }));
    entries = [
      ...entries,
      ...queued.map(({ file, attemptKey }) => ({
        attemptKey,
        fileName: file.name,
        fileSizeBytes: file.size,
        status: null,
        hasFile: true,
      })),
    ];
    for (const { file, attemptKey } of queued) retryable.set(attemptKey, { file, category });

    try {
      for (let i = 0; i < queued.length; i += ATTEMPT_BATCH_LIMIT) {
        batchOperation.throwIfAborted();
        await withUploadTimeout(
          deps.recordUploadAttempts({
            projectId,
            attempts: queued.slice(i, i + ATTEMPT_BATCH_LIMIT).map(({ file, attemptKey }) => ({
              attemptKey,
              fileName: file.name,
              fileSizeBytes: file.size,
              origin: PROJECT_FILE_ORIGIN,
            })),
          })
        );
      }
    } catch (error) {
      // A lost begin is safe: the failure path upserts its own row, and
      // resolving an attempt that does not exist is a no-op.
      console.error("Failed to open upload attempts", error);
    }

    try {
      for (const [index, { file, attemptKey }] of queued.entries()) {
        batchOperation.throwIfAborted();
        if (await uploadOne(projectId, file, attemptKey, category)) continue;
        // The batch stops at the first failure, so mark the files that never
        // got their turn rather than leaving them reading forever.
        const remaining = queued.slice(index + 1);
        for (const item of remaining) {
          patch(item.attemptKey, { status: "upload_failed", hasFile: true });
        }
        if (remaining.length) {
          await recordFailures(
            projectId,
            remaining.map((item) => ({
              attemptKey: item.attemptKey,
              fileName: item.file.name,
              fileSizeBytes: item.file.size,
            })),
            "upload_failed"
          );
        }
        break;
      }
    } catch (error) {
      if (!isParseAbort(error)) throw error;
    } finally {
      if (batch === current) batch = null;
    }
  }

  /** Runs alongside a batch: each file is its own upload. */
  async function retry(row: ReceiptRow) {
    const key = row.attemptKey;
    if (!key || busy.has(row.key)) return;
    const held = retryable.get(key);
    if (!held) return;
    const operation = deps.capture();
    const projectId = deps.projectId();
    busy.add(row.key);
    patch(key, { status: null });
    try {
      // Same key throughout: the server upsert flips the row back to in
      // progress, so a retry can never create a second record.
      await withUploadTimeout(
        deps.recordUploadAttempts({
          projectId,
          attempts: [
            {
              attemptKey: key,
              fileName: held.file.name,
              fileSizeBytes: held.file.size,
              origin: PROJECT_FILE_ORIGIN,
            },
          ],
        })
      );
    } catch (error) {
      console.error("Failed to reopen upload attempt", error);
    }
    try {
      operation.throwIfAborted();
      await uploadOne(projectId, held.file, key, held.category);
    } catch (error) {
      if (!isParseAbort(error)) throw error;
    } finally {
      busy.delete(row.key);
    }
  }

  /**
   * Remove an in-session row that put nothing in the project. Returns false
   * when the server could not dismiss it; the row then shows again.
   */
  async function remove(row: ReceiptRow): Promise<boolean> {
    const key = row.attemptKey;
    if (!key) return true;
    const projectId = deps.projectId();
    hiddenAttempts.add(key);
    retryable.delete(key);
    entries = entries.filter((entry) => entry.attemptKey !== key);
    // A failure this browser queued for the row must not be sent later.
    const userId = deps.userId();
    if (userId) clearOutboxFor(userId, projectId, [key]);
    try {
      await withUploadTimeout(deps.dismissUploadAttempt({ projectId, attemptKey: key }));
      return true;
    } catch (error) {
      console.error("Could not dismiss upload attempt", error);
      // The server still has the failure, so the panel shows its row again,
      // where Remove is offered again.
      if (deps.projectId() === projectId) hiddenAttempts.delete(key);
      return false;
    }
  }

  /**
   * Drop rows whose document is now listed. The list draws them from then on,
   * and a row kept here would come back as "Ready" if the file were deleted.
   */
  function forgetStored(documentIds: ReadonlySet<string>) {
    if (entries.some((entry) => entry.documentId && documentIds.has(entry.documentId))) {
      entries = entries.filter((entry) => !(entry.documentId && documentIds.has(entry.documentId)));
    }
  }

  return {
    get entries() {
      return entries;
    },
    get pendingFiles() {
      return pendingFiles;
    },
    get uploading() {
      return uploading;
    },
    busy,
    /** Attempt keys the panel must not draw from the server's list. */
    hiddenAttempts,
    isLocal(row: ReceiptRow) {
      return row.attemptKey !== undefined && entries.some((entry) => entry.attemptKey === row.attemptKey);
    },
    select,
    cancel,
    uploadAs,
    retry,
    remove,
    forgetStored,
  };
}
