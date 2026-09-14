import { getConvexSize, type Value } from "convex/values";

const MIB = 1 << 20;
/** A maximum-size Convex document plus its field overhead. */
export const DOCUMENT_HEADROOM = MIB + 4096;
const DOCUMENT_OVERHEAD = 256;

export type ListStop = "rows" | "bytes";
export type ListResult<T> = {
  rows: T[];
  complete: boolean;
  /** Why the walk stopped short; `null` when the range was exhausted. */
  stoppedBy: ListStop | null;
};

/**
 * One byte budget for every read a query makes inside a single transaction.
 * The mechanics behind `learningHealthReads` and `generations.getContextInclusion`:
 *
 * - `getConvexSize` matches Convex's own bandwidth accounting (values/size.ts).
 * - A maximum-size document is reserved BEFORE each read, so a read that
 *   fits the reservation can never push the total past `maxBytes`.
 * - `QueryImpl.next()` issues one queryStreamNext syscall and never fetches
 *   the rest of the stream eagerly, so stopping early leaves the remainder
 *   unread; `return()` closes even a partial stream.
 * - `reservedBytes` charges up front for reads the caller makes outside the
 *   budget (authorization rows already read, small settings reads to come).
 * - `complete` is truthful: the row cap reports incomplete only when a
 *   further row actually arrived, never because the cap happened to fill.
 */
export function createReadBudget(options: { maxBytes: number; reservedBytes?: number }) {
  const { maxBytes } = options;
  let used = options.reservedBytes ?? 0;
  let exhausted = false;

  function reserve(): boolean {
    if (used + DOCUMENT_HEADROOM <= maxBytes) return true;
    exhausted = true;
    return false;
  }
  /** Charge a value that was already read (an authorization row, a `get`). */
  function account(value: Value): void {
    used += getConvexSize(value) + DOCUMENT_OVERHEAD;
  }

  async function one<T extends Value>(read: () => Promise<T>) {
    if (!reserve()) return { kind: "not-loaded" } as const;
    const value = await read();
    account(value);
    return { kind: "loaded", value } as const;
  }

  async function list<T extends Value>(source: AsyncIterable<T>, cap: number): Promise<ListResult<T>> {
    const rows: T[] = [];
    // Do not start another index range once the budget is exhausted.
    if (!reserve()) return { rows, complete: false, stoppedBy: "bytes" };
    const iterator = source[Symbol.asyncIterator]();
    try {
      while (reserve()) {
        const next = await iterator.next();
        if (next.done) return { rows, complete: true, stoppedBy: null };
        account(next.value);
        if (rows.length === cap) return { rows, complete: false, stoppedBy: "rows" };
        rows.push(next.value);
      }
      return { rows, complete: false, stoppedBy: "bytes" };
    } finally {
      await iterator.return?.();
    }
  }

  function snapshot() {
    return { limit: maxBytes, estimatedBytesRead: used, reservedDocumentBytes: DOCUMENT_HEADROOM, exhausted };
  }

  return { reserve, account, one, list, snapshot };
}
