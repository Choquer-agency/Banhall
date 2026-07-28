import type { Id } from "../../../convex/_generated/dataModel";
import type {
  ProcessingDetail,
  ProcessingStatus,
  ReceiptStatus,
} from "../../../shared/documentStatus";
import { SUMMARY_CLAUSE, SUMMARY_LOADING_CLAUSE } from "./processingStatus";

/**
 * PSOS-04: the pure seam between the two server queries (plus the chat panel's
 * in-session entries) and the receipt UI.
 *
 * Everything here is data-in/data-out so the acceptance scenarios can be
 * tested directly: the components that consume it import `convex-svelte` and
 * cannot be tested without mocks, but this can.
 */

/** Structural subset of one `listDocuments` row. The real payload is wider. */
export type ListedDocument = {
  _id: Id<"projectDocuments">;
  fileName: string;
  createdAt: number;
  sizeChars: number;
  archived: boolean;
  processingStatus: ProcessingStatus;
  processingDetail: ProcessingDetail | null;
};

/**
 * Structural match for one `listUploadAttempts` row.
 *
 * `documentId` is not in today's projection and cannot be for a listed row: it
 * is only written together with status `succeeded`, which the list query
 * excludes. It is accepted optionally so the cross-check below stays honest if
 * that projection ever widens.
 */
export type ListedAttempt = {
  attemptKey: string;
  fileName: string;
  fileSizeBytes: number | null;
  createdAt: number;
  displayStatus: "in_progress" | "failed";
  documentId?: Id<"projectDocuments"> | null;
};

/** One upload the current session is still tracking. */
export type EphemeralEntry = {
  attemptKey: string;
  fileName: string;
  fileSizeBytes?: number;
  /** null while storage, parsing, or the upload itself are in flight. */
  status: ReceiptStatus | null;
  detail?: ProcessingDetail | null;
  documentId?: Id<"projectDocuments"> | null;
  /** Whether this session still holds the `File`, which is what Retry needs. */
  hasFile: boolean;
};

export type ReceiptRow = {
  key: string;
  fileName: string;
  documentId?: Id<"projectDocuments">;
  attemptKey?: string;
  /** null renders the loading row. */
  status: ReceiptStatus | null;
  detail?: ProcessingDetail | null;
  /** Suppresses the badge and copy: an archived file is excluded from AI. */
  archived?: boolean;
  sizeChars?: number;
  fileSizeBytes?: number;
  createdAt?: number;
  canRetry: boolean;
  canReplace: boolean;
  canRemove: boolean;
};

/** Statuses whose file put no usable text in the project. */
const REPLACEABLE_STATUSES: ProcessingStatus[] = [
  "reference_only",
  "could_not_read",
  "skipped_unsupported",
];

/**
 * Merge the three sources into one ledger.
 *
 * Order is deliberate: in-session work first, then recorded failures, then
 * stored documents — so on a mixed panel every problem sits above the files
 * that are fine. Within each group the input order is preserved (both queries
 * already deliver newest-first), which keeps keys stable as a row's status
 * changes underneath it.
 */
export function buildReceiptRows(
  docs: ListedDocument[],
  attempts: ListedAttempt[],
  ephemeral: EphemeralEntry[]
): ReceiptRow[] {
  const docIds = new Set<string>(docs.map((d) => d._id));
  const ephemeralKeys = new Set(ephemeral.map((e) => e.attemptKey));
  const rows: ReceiptRow[] = [];

  for (const entry of ephemeral) {
    if (entry.documentId && docIds.has(entry.documentId)) continue;
    rows.push({
      key: `local:${entry.attemptKey}`,
      fileName: entry.fileName,
      attemptKey: entry.attemptKey,
      ...(entry.documentId ? { documentId: entry.documentId } : {}),
      status: entry.status,
      detail: entry.detail ?? null,
      ...(entry.fileSizeBytes !== undefined
        ? { fileSizeBytes: entry.fileSizeBytes }
        : {}),
      // Retry re-runs the upload from bytes this session still holds; once
      // they are gone the only honest offer is to pick the file again.
      canRetry: entry.status === "upload_failed" && entry.hasFile,
      canReplace: entry.status === "upload_failed" && !entry.hasFile,
      // Only rows that put nothing in the project are removable here; anything
      // that stored a document belongs to the files panel's own flow.
      canRemove:
        entry.status === "upload_failed" || entry.status === "skipped_unsupported",
    });
  }

  for (const attempt of attempts) {
    // The in-session entry is fresher and still holds the file.
    if (ephemeralKeys.has(attempt.attemptKey)) continue;
    if (attempt.documentId && docIds.has(attempt.documentId)) continue;
    if (attempt.displayStatus !== "failed" && attempt.displayStatus !== "in_progress") {
      continue;
    }
    const failed = attempt.displayStatus === "failed";
    rows.push({
      key: `attempt:${attempt.attemptKey}`,
      fileName: attempt.fileName,
      attemptKey: attempt.attemptKey,
      status: failed ? "upload_failed" : null,
      detail: null,
      ...(attempt.fileSizeBytes !== null
        ? { fileSizeBytes: attempt.fileSizeBytes }
        : {}),
      createdAt: attempt.createdAt,
      // After a reload the bytes are gone, so Retry degrades to Replace.
      canRetry: false,
      canReplace: failed,
      canRemove: failed,
    });
  }

  for (const doc of docs) {
    rows.push({
      key: doc._id,
      fileName: doc.fileName,
      documentId: doc._id,
      status: doc.processingStatus,
      detail: doc.processingDetail,
      ...(doc.archived ? { archived: true } : {}),
      sizeChars: doc.sizeChars,
      createdAt: doc.createdAt,
      canRetry: false,
      // Deliberately excludes both ready states. Replace deletes the old row,
      // and a truncated file did capture real text — the advice there is to
      // split it, not to overwrite it.
      canReplace: !doc.archived && REPLACEABLE_STATUSES.includes(doc.processingStatus),
      canRemove: true,
    });
  }

  return rows;
}

/**
 * How many rows represent an upload that never reached the project. Surfaced
 * in the files panel's collapsed header so failures are not invisible behind a
 * closed panel — the one case the receipt exists for.
 */
export function countReceiptFailures(rows: ReceiptRow[]): number {
  // Archived rows are excluded here for the same reason the summary excludes
  // them: the header and the summary must never report different totals.
  return rows.filter((row) => !row.archived && row.status === "upload_failed").length;
}

const CLAUSE_ORDER: (ReceiptStatus | null)[] = [
  "ready",
  "ready_truncated",
  "reference_only",
  "could_not_read",
  "skipped_unsupported",
  "upload_failed",
  null,
];

/**
 * One line describing the batch: "6 files: 4 ready, 1 reference only, 1 failed".
 *
 * Archived rows are left out entirely — counting one as "ready" would restate
 * in prose the contradiction the badge suppression exists to avoid.
 */
export function summarizeReceipt(rows: ReceiptRow[]): string {
  const counted = rows.filter((row) => !row.archived);
  if (counted.length === 0) return "";

  const counts = new Map<ReceiptStatus | null, number>();
  for (const row of counted) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  const clauses = CLAUSE_ORDER.filter((status) => counts.has(status)).map((status) => {
    const noun = status === null ? SUMMARY_LOADING_CLAUSE : SUMMARY_CLAUSE[status];
    return `${counts.get(status)} ${noun}`;
  });

  return `${counted.length} ${counted.length === 1 ? "file" : "files"}: ${clauses.join(", ")}`;
}
