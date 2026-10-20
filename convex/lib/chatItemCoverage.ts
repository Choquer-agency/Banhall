import type { CompletionReportSection } from "./completionReport";

/**
 * Report chat parity, Phase A review P2-2 (2026-10-19): the Completion Report
 * moved onto the card, so the replies no longer carry item ids and statuses,
 * and the model's history leaves tool rows out. What this conversation already
 * did with each Deviation is read back from `chatProposalItems` instead, so
 * the inventory can mark it and the model revises what is left.
 *
 * Round 2 (N1): a mark is guidance, not a ban. It names the item's status and
 * what reopens it, because the writer may supply the missing fact, decide a
 * conflict, refine a pending card or ask for a redo, and the inventory is the
 * model's only source of the ids.
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
 * What the conversation did with one item. `handled` items are skipped by
 * default and left out of the Continue offer; `reopen` says when the model
 * revises one anyway. An item whose card the writer rejected, or whose card
 * went stale, is labelled but not handled.
 */
export type ItemCoverage = {
  itemId: string;
  section?: CompletionReportSection;
  label: string;
  handled: boolean;
  reopen: string;
};

function coverageOf(row: ItemCoverageRow): ItemCoverage {
  const base = { itemId: row.itemId, ...(row.section ? { section: row.section } : {}) };
  if (row.status === "blocked") {
    return {
      ...base,
      label: "blocked: needs a missing fact from the writer",
      handled: true,
      reopen: "revise it once the writer supplies that fact",
    };
  }
  if (row.status === "conflicting") {
    return {
      ...base,
      label: "conflicting: needs the writer's decision",
      handled: true,
      reopen: "revise it once the writer decides",
    };
  }
  switch (row.proposalState) {
    case "pending":
      return {
        ...base,
        label: "already on a pending card",
        handled: true,
        reopen:
          "revise it if the writer asks to refine or redo that card; to refine a pending proposeBulkEdits card, propose its whole set again, this item included",
      };
    case "applied":
      return { ...base, label: "applied", handled: true, reopen: "revise it if the writer asks for it to be redone" };
    case "rejected":
      return { ...base, label: "the writer rejected the card that carried it", handled: false, reopen: "it may be revised again" };
    case "stale":
      return { ...base, label: "the card that carried it went stale", handled: false, reopen: "it may be revised again" };
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

/**
 * Round 2 (N2): item ids are positional (kind, section, paragraph, position).
 * A rule Deviation (`r-`) comes from the stored Compliance Notes, so its id
 * names the same Deviation for the whole conversation. A content (`c-`) or
 * reference (`x-`) id names whatever the writer, or the Reference PD, put at
 * that position in one request, so its coverage holds only for the current
 * job.
 */
export function coverageLastsWholeConversation(itemId: string): boolean {
  return itemId.startsWith("r-");
}

/**
 * A writer message that carries on the job before it rather than starting a
 * new one: the Continue button's "Continue with Line N." and "Continue.", or
 * the same typed by hand.
 */
export function isContinuePrompt(text: string): boolean {
  return /^\s*continue(\s+with\s+line\s+(242|244|246))?\s*[.!]?\s*$/i.test(text);
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
  return `Deviations already handled in this conversation (on a pending or applied card, or blocked or conflicting): ${parts.join(", ")}. deviationInventory and compareReferencePd mark each one; skip them unless the writer's message reopens one.`;
}
