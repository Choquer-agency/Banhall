import { getDocumentSize, type Value } from "convex/values";
import type { QueryMeta, TransactionMetrics } from "convex/server";

/** Told before and after each document a reader reads. */
export type ReadCounter = {
  /** Before a read that may be large: refuses when it might not fit. */
  beforeRead?(): Promise<void>;
  read(doc: object | null | undefined): void;
};

const MIB = 1 << 20;
/** The largest document Convex stores, which the next read may be. */
const LARGEST_DOCUMENT_BYTES = 1 * MIB;

/**
 * Keeps a transaction's reads and writes under Convex's limits, stopping by
 * name first (B1 review, 2026-10-27), as the project purge does
 * (`purgeBudget.ts`):
 *
 * - When the runtime reports the transaction's real usage
 *   (`ctx.meta.getTransactionMetrics()`), it refuses before a read or write
 *   once what remains could not take one more largest document and
 *   `marginBytes` for the rest of the work.
 * - Otherwise it counts every document read (sized as Convex sizes them) and
 *   the writes its caller reports, and refuses once either passes
 *   `estimateLimitBytes`.
 */
export class TransactionGuard implements ReadCounter {
  bytesRead = 0;
  private metricsAvailable: boolean | undefined;

  constructor(
    private readonly ctx: { meta: QueryMeta },
    private readonly options: { marginBytes: number; estimateLimitBytes: number },
    private readonly over: () => never
  ) {}

  private async metrics(): Promise<TransactionMetrics | null> {
    if (this.metricsAvailable === false) return null;
    try {
      const metrics = await this.ctx.meta.getTransactionMetrics();
      this.metricsAvailable = true;
      return metrics;
    } catch {
      this.metricsAvailable = false;
      return null;
    }
  }

  async beforeRead(): Promise<void> {
    const metrics = await this.metrics();
    if (metrics) {
      if (metrics.bytesRead.remaining < LARGEST_DOCUMENT_BYTES + this.options.marginBytes) this.over();
    } else if (this.bytesRead > this.options.estimateLimitBytes) {
      this.over();
    }
  }

  read(doc: object | null | undefined): void {
    if (doc) this.bytesRead += getDocumentSize(doc as Record<string, Value>);
  }

  /** Before writing up to `nextBytes` more; `writtenBytes` is what the caller wrote so far. */
  async beforeWrite(writtenBytes: number, nextBytes: number): Promise<void> {
    const metrics = await this.metrics();
    if (metrics) {
      if (metrics.bytesWritten.remaining < nextBytes + this.options.marginBytes) this.over();
    } else if (writtenBytes + nextBytes > this.options.estimateLimitBytes) {
      this.over();
    }
  }
}

/** A query's rows one at a time, `counter` asked before each read and told after. */
export async function* countedRows<T extends object>(
  rows: AsyncIterable<T>,
  counter: ReadCounter | undefined
): AsyncGenerator<T> {
  const iterator = rows[Symbol.asyncIterator]();
  try {
    for (;;) {
      await counter?.beforeRead?.();
      const next = await iterator.next();
      if (next.done) return;
      counter?.read(next.value);
      yield next.value;
    }
  } finally {
    await iterator.return?.();
  }
}
