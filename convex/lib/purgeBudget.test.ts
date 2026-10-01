import type { TransactionMetrics } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  createPurgeGuard,
  PURGE_CHILD_RESERVE_BYTES,
  PURGE_ESTIMATE_MAX_BYTES,
  PURGE_MARGIN_BYTES,
  PURGE_MARGIN_DOCUMENTS,
} from "./purgeBudget";

const MIB = 1 << 20;
const LIMIT = 16 * MIB;

function metrics(used: Partial<Record<keyof TransactionMetrics, number>>): TransactionMetrics {
  const limits: Record<keyof TransactionMetrics, number> = {
    bytesRead: LIMIT,
    bytesWritten: LIMIT,
    databaseQueries: 4096,
    documentsRead: 32_000,
    documentsWritten: 16_000,
    functionsScheduled: 1000,
    scheduledFunctionArgsBytes: LIMIT,
  };
  const out = {} as TransactionMetrics;
  for (const key of Object.keys(limits) as Array<keyof TransactionMetrics>) {
    const value = used[key] ?? 0;
    out[key] = { used: value, remaining: limits[key] - value };
  }
  return out;
}

const row = (bytes: number) => ({ content: "x".repeat(bytes) });

describe("purge guard, metrics mode", () => {
  it("allows a child read while its read and delete fit under the margin", async () => {
    const guard = createPurgeGuard({
      readMetrics: async () => metrics({ bytesRead: LIMIT - PURGE_MARGIN_BYTES - PURGE_CHILD_RESERVE_BYTES }),
      alreadyRead: [],
      blobCheckFields: 5,
    });
    expect(await guard.canReadChild()).toBe(true);
  });

  it("refuses a child read once the remaining bytes, less the deletes owed, run short", async () => {
    let used = 8 * MIB;
    const guard = createPurgeGuard({
      readMetrics: async () => metrics({ bytesRead: used }),
      alreadyRead: [],
      blobCheckFields: 5,
    });
    expect(await guard.canReadChild()).toBe(true);
    // Four 1 MB rows read, not yet deleted: their deletes are owed.
    for (let i = 0; i < 4; i++) {
      guard.noteChildRead(row(1_000_000), true);
      used += 1_000_000;
    }
    expect(await guard.canReadChild()).toBe(false);
    // Deleting them spends the owed bytes (the metrics now count them).
    for (let i = 0; i < 4; i++) {
      guard.noteChildDeleted(row(1_000_000));
      used += 1_000_000;
    }
    expect(await guard.canReadChild()).toBe(false);
    expect(guard.snapshot()).toMatchObject({ mode: "metrics", owedDeleteBytes: 0, owedDeleteDocuments: 0 });
  });

  it("checks document, write and index-range counts as well as bytes", async () => {
    const at = (used: Partial<Record<keyof TransactionMetrics, number>>) =>
      createPurgeGuard({ readMetrics: async () => metrics(used), alreadyRead: [], blobCheckFields: 5 });
    expect(await at({ documentsRead: 32_000 - PURGE_MARGIN_DOCUMENTS - 1 }).canReadChild()).toBe(false);
    expect(await at({ documentsWritten: 16_000 - PURGE_MARGIN_DOCUMENTS }).canReadChild()).toBe(false);
    expect(await at({ bytesWritten: LIMIT - PURGE_MARGIN_BYTES + 1 }).canReadChild()).toBe(false);
    expect(await at({ databaseQueries: 4096 - 64 }).canQuery()).toBe(false);
    expect(await at({}).canQuery()).toBe(true);
  });

  it("reserves a blob-owning row's reference checks before it is deleted", async () => {
    const used = LIMIT - PURGE_MARGIN_BYTES - 3 * MIB;
    const guard = createPurgeGuard({
      readMetrics: async () => metrics({ bytesRead: used }),
      alreadyRead: [],
      blobCheckFields: 5,
    });
    expect(await guard.canTouchRow(row(1000), false)).toBe(true);
    expect(await guard.canTouchRow(row(1000), true)).toBe(false);
  });
});

describe("purge guard, estimate mode (no metrics from the runtime)", () => {
  it("charges what the page already read and every read and delete after it", async () => {
    const guard = createPurgeGuard({
      readMetrics: async () => null,
      alreadyRead: [row(5 * MIB)],
      blobCheckFields: 5,
    });
    let reads = 0;
    while (await guard.canReadChild()) {
      guard.noteChildRead(row(1_000_000), true);
      guard.noteChildDeleted(row(1_000_000));
      reads += 1;
      expect(reads).toBeLessThan(20);
    }
    const { mode, estimateUsed } = guard.snapshot();
    expect(mode).toBe("estimate");
    // 5 MiB up front, then about 2 MB (read plus delete) per child: it stops
    // only when one more reservation would pass the cap, never after.
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(estimateUsed).toBeLessThanOrEqual(PURGE_ESTIMATE_MAX_BYTES);
    expect(estimateUsed + PURGE_CHILD_RESERVE_BYTES).toBeGreaterThan(PURGE_ESTIMATE_MAX_BYTES);
  });

  it("always admits the first child read and the first delete of a fresh page", async () => {
    // A fresh page: the project row and a full 4 MiB parent page (plus one
    // overshoot row) already read.
    const fresh = () =>
      createPurgeGuard({
        readMetrics: async () => null,
        alreadyRead: [row(1_000_000), row(5 * MIB)],
        blobCheckFields: 5,
      });
    expect(await fresh().canReadChild()).toBe(true);
    expect(await fresh().canTouchRow(row(1_000_000), true)).toBe(true);
  });
});
