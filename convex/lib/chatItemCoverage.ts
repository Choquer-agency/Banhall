import type { CompletionReportSection } from "./completionReport";

/**
 * Report chat parity, Phase A review P2-2 (2026-10-19): the Completion Report
 * moved onto the card, so the replies no longer carry item ids and statuses,
 * and the model's history leaves tool rows out. What this conversation already
 * did with each Deviation is read back from `chatProposalItems` instead, so
 * the inventory can mark it and the model revises only what is left.
 */

/** One `chatProposalItems` row with the state of the card that carries it. */
export type ItemCoverageRow = {
  itemId: string;
  section?: CompletionReportSection;
  status: "resolved" | "blocked" | "conflicting";
  proposalState: "pending" | "applied" | "rejected" | "stale";
  createdAt: number;
};

/**
 * What the conversation did with one item. `handled` items are not revised
 * again: they sit on a pending or applied card, or need the writer (blocked,
 * conflicting). An item whose card the writer rejected, or whose card went
 * stale, is labelled but left to revise.
 */
export type ItemCoverage = {
  itemId: string;
  section?: CompletionReportSection;
  label: string;
  handled: boolean;
};

function coverageOf(row: ItemCoverageRow): ItemCoverage {
  const base = { itemId: row.itemId, ...(row.section ? { section: row.section } : {}) };
  if (row.status === "blocked") {
    return { ...base, label: "blocked: needs a missing fact from the writer", handled: true };
  }
  if (row.status === "conflicting") {
    return { ...base, label: "conflicting: needs the writer's decision", handled: true };
  }
  switch (row.proposalState) {
    case "pending":
      return { ...base, label: "already on a pending card", handled: true };
    case "applied":
      return { ...base, label: "applied", handled: true };
    case "rejected":
      return { ...base, label: "the writer rejected the card that carried it", handled: false };
    case "stale":
      return { ...base, label: "the card that carried it went stale", handled: false };
  }
}

/**
 * One entry per item id: the newest row decides. `rows` come newest card
 * first, so on equal times the row seen first wins.
 */
export function itemCoverage(rows: ReadonlyArray<ItemCoverageRow>): ItemCoverage[] {
  const newest = new Map<string, ItemCoverageRow>();
  for (const row of rows) {
    const seen = newest.get(row.itemId);
    if (!seen || row.createdAt > seen.createdAt) newest.set(row.itemId, row);
  }
  return [...newest.values()].map(coverageOf);
}

/** The per-turn note line: handled items per Line, or null when there are none. */
export function handledItemsNote(coverage: ReadonlyArray<ItemCoverage>): string | null {
  const counts = new Map<string, number>();
  for (const item of coverage) {
    if (!item.handled) continue;
    const line = item.section ?? "other";
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const parts = (["242", "244", "246", "other"] as const)
    .filter((line) => counts.has(line))
    .map((line) => `${line === "other" ? "other items" : `Line ${line}`} ${counts.get(line)}`);
  return `Deviations already handled in this conversation (on a pending or applied card, or blocked or conflicting): ${parts.join(", ")}. deviationInventory and compareReferencePd mark each one; revise only the unmarked items.`;
}
