import { getConvexSize, type Value } from "convex/values";

const MIB = 1 << 20;
/** A maximum-size Convex document plus its field overhead. */
export const DOCUMENT_HEADROOM = MIB + 4096;
const DOCUMENT_OVERHEAD = 256;

/**
 * Collect rows from an index range under a row cap AND a byte budget, and say
 * whether the range was exhausted. The generic cousin of
 * `learningHealthReads.list`: `getConvexSize` matches Convex's own bandwidth
 * accounting, and a maximum-size document is reserved BEFORE each read so the
 * budget is never crossed. `QueryImpl.next()` issues one queryStreamNext per
 * row, so stopping early leaves the rest of the range unread.
 *
 * `complete` is truthful, not "the cap happened to fill": hitting the row cap
 * reports incomplete only when a further row actually arrived.
 */
export async function collectBounded<T extends Value>(
  source: AsyncIterable<T>,
  limits: { maxRows: number; maxBytes: number }
): Promise<{ rows: T[]; complete: boolean }> {
  const rows: T[] = [];
  let used = 0;
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (used + DOCUMENT_HEADROOM <= limits.maxBytes) {
      const next = await iterator.next();
      if (next.done) return { rows, complete: true };
      used += getConvexSize(next.value) + DOCUMENT_OVERHEAD;
      if (rows.length === limits.maxRows) return { rows, complete: false };
      rows.push(next.value);
    }
    return { rows, complete: false };
  } finally {
    await iterator.return?.();
  }
}
