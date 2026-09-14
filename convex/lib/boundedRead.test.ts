import { describe, expect, it } from "vitest";
import { collectBounded, DOCUMENT_HEADROOM } from "./boundedRead";

async function* rows(count: number, size: number) {
  for (let index = 0; index < count; index += 1) {
    yield { index, body: "x".repeat(size) };
  }
}

describe("collectBounded (DW-133)", () => {
  it("reads an exhausted range completely", async () => {
    const result = await collectBounded(rows(5, 10), { maxRows: 100, maxBytes: 8 * DOCUMENT_HEADROOM });
    expect(result.rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.complete).toBe(true);
  });

  it("reports incomplete only when a row past the cap actually exists", async () => {
    const exact = await collectBounded(rows(3, 10), { maxRows: 3, maxBytes: 8 * DOCUMENT_HEADROOM });
    expect(exact.rows).toHaveLength(3);
    expect(exact.complete).toBe(true);

    const over = await collectBounded(rows(4, 10), { maxRows: 3, maxBytes: 8 * DOCUMENT_HEADROOM });
    expect(over.rows).toHaveLength(3);
    expect(over.complete).toBe(false);
  });

  it("stops before the byte budget could be crossed by one more document", async () => {
    // Budget: room for two maximum-size documents. Rows of ~half a document
    // each: after two reads the reservation for a third no longer fits.
    const half = Math.floor(DOCUMENT_HEADROOM / 2);
    const result = await collectBounded(rows(10, half), { maxRows: 100, maxBytes: 3 * DOCUMENT_HEADROOM });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThan(10);
    expect(result.complete).toBe(false);
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
    const result = await collectBounded(source, { maxRows: 2, maxBytes: 8 * DOCUMENT_HEADROOM });
    expect(result.rows).toHaveLength(2);
    expect(result.complete).toBe(false);
    expect(closed).toBe(true);
  });
});
