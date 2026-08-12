/**
 * Presentation reorder for My Work — a pure reorder of *loaded* rows only
 * (product-domain 2026-08-06 amendments). It never claims completeness
 * beyond the regions' existing `N+` framing: unloaded pages are untouched,
 * no grouping axis, no filtering. The five accountability meanings, their
 * queries, and their server order are unchanged; this only reorders the
 * rows a region has already loaded.
 *
 * "default" (the queue-first default, 2026-08-06 second amendment) renders
 * rows exactly in the server's indexed order — due-date order for the
 * queue, frozen stage-rank order for Owned by me — with no client claim at
 * all.
 */

export type LaneSortMode = "default" | "updated" | "clientName";

export const DEFAULT_LANE_SORT: LaneSortMode = "default";

export const LANE_SORT_OPTIONS: { value: LaneSortMode; label: string }[] = [
  { value: "default", label: "Server order" },
  { value: "updated", label: "Recently updated" },
  { value: "clientName", label: "Client name A–Z" },
];

/** Exact helper copy (plan §1.4): the sort makes no completeness claim. */
export const LANE_SORT_HELPER_TEXT = "Sorts loaded items only.";

export function parseLaneSortMode(raw: unknown): LaneSortMode {
  // Fail closed to the default on anything unrecognized. Previously stored
  // values ("updated" — the retired default — and "clientName") stay valid.
  if (raw === "updated" || raw === "clientName") return raw;
  return DEFAULT_LANE_SORT;
}

type LaneSortableRow = {
  clientName: string;
  updatedAt?: number;
};

const clientNameCollator = new Intl.Collator("en-CA", { sensitivity: "base" });

/**
 * Returns a new, stably sorted array; the input is never mutated.
 * - "default": the loaded (server index) order, untouched.
 * - "updated": most recently updated first. Rows without a recorded
 *   `updatedAt` keep their loaded relative order after all dated rows.
 * - "clientName": recorded client name A–Z (case/diacritic-insensitive).
 *   Ties keep their loaded relative order.
 */
export function sortLaneRows<T extends LaneSortableRow>(
  rows: readonly T[],
  mode: LaneSortMode
): T[] {
  if (mode === "default") return [...rows];
  const indexed = rows.map((row, index) => ({ row, index }));
  if (mode === "clientName") {
    indexed.sort(
      (a, b) =>
        clientNameCollator.compare(a.row.clientName, b.row.clientName) || a.index - b.index
    );
  } else {
    indexed.sort((a, b) => {
      const aAt = typeof a.row.updatedAt === "number" ? a.row.updatedAt : Number.NEGATIVE_INFINITY;
      const bAt = typeof b.row.updatedAt === "number" ? b.row.updatedAt : Number.NEGATIVE_INFINITY;
      return bAt - aAt || a.index - b.index;
    });
  }
  return indexed.map((entry) => entry.row);
}
