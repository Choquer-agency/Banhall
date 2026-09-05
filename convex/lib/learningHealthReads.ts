import { getConvexSize, type Value } from "convex/values";

const MIB = 1 << 20;
export const HEALTH_READ_BYTES = 8 * MIB;
export const HEALTH_DOCUMENT_HEADROOM = MIB + 4096;
const DOCUMENT_OVERHEAD = 256;

/**
 * A shared conservative budget for the complete metrics query. Convex's public
 * getConvexSize matches its bandwidth accounting (values/size.ts). Leave room
 * for a maximum-size document BEFORE each read, and reserve two such documents
 * for the existing authorization helper, which runs before metrics access.
 *
 * QueryImpl.next() issues one queryStreamNext syscall; it does not eagerly
 * fetch the remaining stream (server/impl/query_impl.ts:255). Explicit next()
 * lets us check headroom before the read; return() closes even a partial stream.
 */
export function learningHealthReads(truncated: Set<string>) {
  let used = 2 * HEALTH_DOCUMENT_HEADROOM;
  let exhausted = false;
  function reserve(population: string) {
    if (used + HEALTH_DOCUMENT_HEADROOM <= HEALTH_READ_BYTES) return true;
    exhausted = true;
    truncated.add(population);
    truncated.add("read byte budget");
    return false;
  }
  function account(value: Value) {
    used += getConvexSize(value) + DOCUMENT_OVERHEAD;
  }
  return {
    async one<T extends Value>(population: string, read: () => Promise<T>) {
      if (!reserve(population)) return { kind: "not-loaded" } as const;
      const value = await read();
      account(value);
      return { kind: "loaded", value } as const;
    },
    async list<T extends Value>(population: string, source: AsyncIterable<T>, cap: number) {
      const rows: T[] = [];
      // Do not start another index range once the shared budget is exhausted.
      if (!reserve(population)) return { rows, complete: false };
      const iterator = source[Symbol.asyncIterator]();
      try {
        while (reserve(population)) {
          const next = await iterator.next();
          if (next.done) return { rows, complete: true };
          account(next.value);
          if (rows.length === cap) {
            truncated.add(population);
            return { rows, complete: false };
          }
          rows.push(next.value);
        }
        return { rows, complete: false };
      } finally {
        await iterator.return?.();
      }
    },
    snapshot() {
      return { limit: HEALTH_READ_BYTES, estimatedBytesRead: used, reservedDocumentBytes: HEALTH_DOCUMENT_HEADROOM, exhausted };
    },
  };
}
