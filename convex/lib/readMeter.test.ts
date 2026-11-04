import { describe, expect, it } from "vitest";
import type { QueryMeta, TransactionMetrics } from "convex/server";
import { TransactionGuard, countedRows } from "./readMeter";

/** B1 review (2026-10-27): the guard a draft's reservation freezes under. */

const MIB = 1 << 20;

function metric(used: number, limit = 16 * MIB) {
  return { used, remaining: limit - used };
}

function metaReporting(usage: { read: number; written: number } | null): { meta: QueryMeta } {
  return {
    meta: {
      getTransactionMetrics: async () => {
        if (!usage) throw new Error("not supported");
        return {
          bytesRead: metric(usage.read),
          bytesWritten: metric(usage.written),
          databaseQueries: metric(0, 4096),
          documentsRead: metric(0, 32000),
          documentsWritten: metric(0, 16000),
          functionsScheduled: metric(0, 1000),
          scheduledFunctionArgsBytes: metric(0, 16 * MIB),
        } satisfies TransactionMetrics;
      },
    } as unknown as QueryMeta,
  };
}

const refuse = (): never => {
  throw new Error("too large");
};
const options = { marginBytes: 256 * 1024, estimateLimitBytes: 15 * MIB };

describe("TransactionGuard", () => {
  it("with the transaction's real usage: refuses a read or write only when one more largest document and the margin would not fit", async () => {
    const usage = { read: 14 * MIB, written: 0 };
    const guard = new TransactionGuard(metaReporting(usage), options, refuse);
    await expect(guard.beforeRead()).resolves.toBeUndefined();
    usage.read = 15 * MIB - 128 * 1024;
    await expect(guard.beforeRead()).rejects.toThrow("too large");
    await expect(guard.beforeWrite(0, 600 * 1024)).resolves.toBeUndefined();
    usage.written = 15.5 * MIB;
    await expect(guard.beforeWrite(0, 600 * 1024)).rejects.toThrow("too large");
  });

  it("says whether more fits without refusing, with the real usage and with its own count", async () => {
    const usage = { read: 15 * MIB, written: 10 * MIB };
    const measured = new TransactionGuard(metaReporting(usage), options, refuse);
    expect(await measured.hasRoom("read", 512 * 1024)).toBe(true);
    expect(await measured.hasRoom("read", 900 * 1024)).toBe(false);
    expect(await measured.hasRoom("write", 5 * MIB)).toBe(true);
    expect(await measured.hasRoom("write", 6 * MIB)).toBe(false);
    const counted = new TransactionGuard(metaReporting(null), options, refuse);
    counted.read({ text: "x".repeat(14 * MIB) });
    expect(await counted.hasRoom("read", 512 * 1024)).toBe(true);
    expect(await counted.hasRoom("read", 900 * 1024)).toBe(false);
    expect(await counted.hasRoom("write", MIB, 13 * MIB)).toBe(true);
    expect(await counted.hasRoom("write", 2 * MIB, 13 * MIB)).toBe(false);
  });

  it("without it: counts what it is told and refuses once one more largest document and the margin would pass the estimate limit", async () => {
    const guard = new TransactionGuard(metaReporting(null), options, refuse);
    const rows = Array.from({ length: 20 }, (_, index) => ({ index, text: "x".repeat(MIB - 100) }));
    async function* source() {
      yield* rows;
    }
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const row of countedRows(source(), guard)) seen.push(row.index);
      })()
    ).rejects.toThrow("too large");
    // Refused before the 15th row: 14 rows of about 1 MiB, one more and the
    // margin would pass 15 MiB.
    expect(seen).toHaveLength(14);
    await expect(guard.beforeWrite(14 * MIB, 600 * 1024)).resolves.toBeUndefined();
    await expect(guard.beforeWrite(14.5 * MIB, 600 * 1024)).rejects.toThrow("too large");
  });
});
