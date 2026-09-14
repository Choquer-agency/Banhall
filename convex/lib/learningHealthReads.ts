import type { Value } from "convex/values";
import { createReadBudget, DOCUMENT_HEADROOM } from "./readBudget";

const MIB = 1 << 20;
export const HEALTH_READ_BYTES = 8 * MIB;
export const HEALTH_DOCUMENT_HEADROOM = DOCUMENT_HEADROOM;

/**
 * A shared conservative budget for the complete metrics query, with the
 * health report's population labels layered over the generic read budget
 * (`readBudget.ts` owns the accounting, reservation and stream mechanics).
 * Two maximum-size documents are reserved up front for the existing
 * authorization helper, which runs before metrics access.
 */
export function learningHealthReads(truncated: Set<string>) {
  const budget = createReadBudget({
    maxBytes: HEALTH_READ_BYTES,
    reservedBytes: 2 * HEALTH_DOCUMENT_HEADROOM,
  });
  function exhaustedBy(population: string) {
    truncated.add(population);
    truncated.add("read byte budget");
  }
  return {
    async one<T extends Value>(population: string, read: () => Promise<T>) {
      const result = await budget.one(read);
      if (result.kind === "not-loaded") exhaustedBy(population);
      return result;
    },
    async list<T extends Value>(population: string, source: AsyncIterable<T>, cap: number) {
      const { rows, complete, stoppedBy } = await budget.list(source, cap);
      if (stoppedBy === "bytes") exhaustedBy(population);
      else if (stoppedBy === "rows") truncated.add(population);
      return { rows, complete };
    },
    snapshot: budget.snapshot,
  };
}
