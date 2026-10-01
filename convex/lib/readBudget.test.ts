import { describe, expect, it } from "vitest";
import { createReadBudget, DOCUMENT_HEADROOM } from "./readBudget";

async function* rows(count: number, size: number) {
  for (let index = 0; index < count; index += 1) {
    yield { index, body: "x".repeat(size) };
  }
}

describe("createReadBudget (DW-133)", () => {
  it("reads an exhausted range completely", async () => {
    const budget = createReadBudget({ maxBytes: 8 * DOCUMENT_HEADROOM });
    const result = await budget.list(rows(5, 10), 100);
    expect(result.rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result).toMatchObject({ complete: true, stoppedBy: null });
    expect(budget.snapshot().exhausted).toBe(false);
  });

  it("reports incomplete only when a row past the cap actually exists", async () => {
    const exact = await createReadBudget({ maxBytes: 8 * DOCUMENT_HEADROOM }).list(rows(3, 10), 3);
    expect(exact.rows).toHaveLength(3);
    expect(exact).toMatchObject({ complete: true, stoppedBy: null });

    const over = await createReadBudget({ maxBytes: 8 * DOCUMENT_HEADROOM }).list(rows(4, 10), 3);
    expect(over.rows).toHaveLength(3);
    expect(over).toMatchObject({ complete: false, stoppedBy: "rows" });
  });

  it("stops before the byte budget could be crossed by one more document", async () => {
    // Room for three maximum-size documents; rows of half a document each.
    const half = Math.floor(DOCUMENT_HEADROOM / 2);
    const budget = createReadBudget({ maxBytes: 3 * DOCUMENT_HEADROOM });
    const result = await budget.list(rows(10, half), 100);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThan(10);
    expect(result).toMatchObject({ complete: false, stoppedBy: "bytes" });
    const snapshot = budget.snapshot();
    expect(snapshot.exhausted).toBe(true);
    expect(snapshot.estimatedBytesRead).toBeLessThanOrEqual(snapshot.limit);
  });

  it("shares one budget across reads, with up-front reservations and accounted rows", async () => {
    // Four documents of budget: one reserved up front, one charged for a row
    // read outside the budget, leaving room to read two more.
    const large = "x".repeat(DOCUMENT_HEADROOM);
    const budget = createReadBudget({ maxBytes: 4 * DOCUMENT_HEADROOM, reservedBytes: DOCUMENT_HEADROOM });
    budget.account({ already: large });
    const first = await budget.list(rows(1, 10), 100);
    expect(first.complete).toBe(true);
    const loaded = await budget.one(async () => ({ body: large }));
    expect(loaded.kind).toBe("loaded");
    // Three documents are now charged; no reservation for a fourth fits.
    const refused = await budget.one(async () => ({ value: 2 }));
    expect(refused.kind).toBe("not-loaded");
    const later = await budget.list(rows(5, 10), 100);
    expect(later).toMatchObject({ rows: [], complete: false, stoppedBy: "bytes" });
    const snapshot = budget.snapshot();
    expect(snapshot.exhausted).toBe(true);
    expect(snapshot.estimatedBytesRead).toBeLessThanOrEqual(snapshot.limit);
  });

  it("closes the source iterator when it stops early", async () => {
    let closed = false;
    const source: AsyncIterable<{ index: number }> = {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            return { done: false, value: { index: index++ } };
          },
          async return() {
            closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const result = await createReadBudget({ maxBytes: 8 * DOCUMENT_HEADROOM }).list(source, 2);
    expect(result.rows).toHaveLength(2);
    expect(result).toMatchObject({ complete: false, stoppedBy: "rows" });
    expect(closed).toBe(true);
  });

  it("shares a range limit across point reads and empty index streams", async () => {
    const budget = createReadBudget({ maxBytes: 8 * DOCUMENT_HEADROOM, maxRanges: 3 });
    let pointCalls = 0;
    const point = async () => { pointCalls += 1; return null; };
    expect((await budget.one(point)).kind).toBe("loaded");
    expect(await budget.list(rows(0, 0), 10)).toMatchObject({ complete: true });
    expect((await budget.one(point)).kind).toBe("loaded");
    expect((await budget.one(point)).kind).toBe("not-loaded");
    let opened = false;
    const source = {
      [Symbol.asyncIterator]() { opened = true; return rows(1, 1); },
    };
    expect(await budget.list(source, 10)).toEqual({ rows: [], complete: false, stoppedBy: "ranges" });
    expect(opened).toBe(false);
    expect(pointCalls).toBe(2);
    expect(budget.snapshot()).toMatchObject({ rangeLimit: 3, rangesRead: 3, exhausted: true });
  });

  it("charges one range for a streamed collection, not one per row", async () => {
    const budget = createReadBudget({ maxBytes: 8 * DOCUMENT_HEADROOM, maxRanges: 1 });
    const result = await budget.list(rows(100, 1), 100);
    expect(result.rows).toHaveLength(100);
    expect(result.complete).toBe(true);
    expect(budget.snapshot()).toMatchObject({ rangesRead: 1, exhausted: false });
    expect((await budget.one(async () => null)).kind).toBe("not-loaded");
  });

});
