import { getConvexSize, type Value } from "convex/values";
import type { TransactionMetrics } from "convex/server";
import { DOCUMENT_HEADROOM } from "./readBudget";

/**
 * The read guard one project-purge page runs under (2026-09-25, review round
 * 2). A page reads the project row, one page of registry rows, the inline
 * children of those rows, and then deletes them; Convex charges every delete
 * (and every patch) as another read of the document it removes. The guard
 * covers the whole transaction, not only the child reads:
 *
 * - Metrics mode (the runtime reports them): before every child read and
 *   every row delete or patch, the guard asks the transaction for its real
 *   usage (`ctx.meta.getTransactionMetrics()`) and refuses when what would
 *   remain after this step, and after the deletes still owed for rows already
 *   read, drops below a margin. Bytes read, documents read, documents and
 *   bytes written and index ranges are all checked.
 * - Estimate mode (the runtime cannot report them): every read is charged by
 *   its size: the project row and the parent page up front, each child when
 *   read and again when deleted, each parent again when deleted, and a
 *   maximum-size document is reserved for each read not yet made, against
 *   PURGE_ESTIMATE_MAX_BYTES.
 *
 * A refusal ends the page cleanly: the row being worked on stays in its index
 * range and the next page resumes from the same cursor. Progress: a fresh
 * page has read at most the project row and one parent page (about 6 MiB of
 * the 16 MiB limit), which always leaves room for the first child read and
 * its delete, or the first parent's delete, so every page removes a row.
 */

const KIB = 1 << 10;
const MIB = 1 << 20;

/** What one more child costs before it is read: its read and its delete. */
export const PURGE_CHILD_RESERVE_BYTES = 2 * DOCUMENT_HEADROOM;
/** Headroom kept below every limit for the page's own bookkeeping (the
 * continuation it schedules, small point reads). */
export const PURGE_MARGIN_BYTES = 1 * MIB;
export const PURGE_MARGIN_DOCUMENTS = 64;
export const PURGE_MARGIN_QUERIES = 64;
/** Estimate mode's cap on everything the page reads. */
export const PURGE_ESTIMATE_MAX_BYTES = 14 * MIB;
/** Estimate mode's charge for one blob reference check (it reads at most
 * one referencing row per storage field, normally none). */
const BLOB_CHECK_ESTIMATE_BYTES = 4 * KIB;
const DOCUMENT_OVERHEAD = 256;

export type PurgeMetricsReader = () => Promise<TransactionMetrics | null>;

function sizeOf(value: Value): number {
  return getConvexSize(value) + DOCUMENT_OVERHEAD;
}

export function createPurgeGuard(options: {
  /** The transaction's real usage, or null where the runtime cannot say. */
  readMetrics: PurgeMetricsReader;
  /** Everything read before the guard existed (project row, parent page). */
  alreadyRead: readonly Value[];
  /** Storage fields a blob reference check may read one row from. */
  blobCheckFields: number;
}) {
  let estimateUsed = options.alreadyRead.reduce<number>((sum, value) => sum + sizeOf(value), 0);
  // Deletes still owed for rows already read: each will read its row again.
  let owedDeleteBytes = 0;
  let owedDeleteDocuments = 0;
  let mode: "metrics" | "estimate" | undefined;

  async function metrics(): Promise<TransactionMetrics | null> {
    if (mode === "estimate") return null;
    const read = await options.readMetrics();
    mode = read ? "metrics" : "estimate";
    return read;
  }

  /** Whether `bytes` more reads (and `documents` more documents, `queries`
   * more index ranges, `writes` more writes) fit after the owed deletes. */
  async function fits(step: {
    bytes: number;
    documents: number;
    queries: number;
    writes: number;
  }): Promise<boolean> {
    const current = await metrics();
    if (current === null) {
      return estimateUsed + owedDeleteBytes + step.bytes <= PURGE_ESTIMATE_MAX_BYTES;
    }
    return (
      current.bytesRead.remaining - owedDeleteBytes - step.bytes >= PURGE_MARGIN_BYTES &&
      current.documentsRead.remaining - owedDeleteDocuments - step.documents >=
        PURGE_MARGIN_DOCUMENTS &&
      current.documentsWritten.remaining - owedDeleteDocuments - step.writes >=
        PURGE_MARGIN_DOCUMENTS &&
      current.bytesWritten.remaining >= PURGE_MARGIN_BYTES &&
      current.databaseQueries.remaining - step.queries >= PURGE_MARGIN_QUERIES
    );
  }

  return {
    /** Before opening a child index range. */
    async canQuery(): Promise<boolean> {
      return await fits({ bytes: 0, documents: 0, queries: 1, writes: 0 });
    },
    /** Before reading one more child row (which will then be deleted). */
    async canReadChild(): Promise<boolean> {
      return await fits({ bytes: PURGE_CHILD_RESERVE_BYTES, documents: 2, queries: 0, writes: 1 });
    },
    /** A child row was read; `willDelete` when this page deletes it. */
    noteChildRead(row: Value, willDelete: boolean): void {
      const size = sizeOf(row);
      estimateUsed += size;
      if (willDelete) {
        owedDeleteBytes += size;
        owedDeleteDocuments += 1;
      }
    },
    /** A child row this page read was deleted (its second read happened). */
    noteChildDeleted(row: Value): void {
      const size = sizeOf(row);
      owedDeleteBytes -= size;
      owedDeleteDocuments -= 1;
      estimateUsed += size;
    },
    /** Before deleting or patching a registry row: its second read, plus the
     * reference check a blob-owning row makes. */
    async canTouchRow(row: Value, ownsBlob: boolean): Promise<boolean> {
      const blobReads = ownsBlob ? options.blobCheckFields : 0;
      return await fits({
        bytes: sizeOf(row) + blobReads * DOCUMENT_HEADROOM,
        documents: 1 + blobReads,
        queries: blobReads,
        writes: 1,
      });
    },
    /** A registry row was deleted or patched. */
    noteRowTouched(row: Value, ownsBlob: boolean): void {
      estimateUsed += sizeOf(row) + (ownsBlob ? BLOB_CHECK_ESTIMATE_BYTES : 0);
    },
    snapshot() {
      return { mode: mode ?? "unchecked", estimateUsed, owedDeleteBytes, owedDeleteDocuments };
    },
  };
}

export type PurgeGuard = ReturnType<typeof createPurgeGuard>;
