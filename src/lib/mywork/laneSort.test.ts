import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANE_SORT,
  LANE_SORT_HELPER_TEXT,
  LANE_SORT_OPTIONS,
  parseLaneSortMode,
  sortLaneRows,
} from "./laneSort";

type Row = { clientName: string; updatedAt?: number; id: string };

const rows: Row[] = [
  { id: "a", clientName: "Zenith Corp", updatedAt: 300 },
  { id: "b", clientName: "acme labs", updatedAt: 100 },
  { id: "c", clientName: "Émile & Co", updatedAt: 200 },
  { id: "d", clientName: "Acme Labs", updatedAt: 400 },
];

describe("lane sort helper", () => {
  it("exposes exactly the three approved options with the server-order default", () => {
    expect(LANE_SORT_OPTIONS.map((o) => o.value)).toEqual(["default", "updated", "clientName"]);
    expect(LANE_SORT_OPTIONS.map((o) => o.label)).toEqual([
      "Server order",
      "Recently updated",
      "Client name A–Z",
    ]);
    expect(DEFAULT_LANE_SORT).toBe("default");
  });

  it("carries the exact loaded-items-only helper copy", () => {
    expect(LANE_SORT_HELPER_TEXT).toBe("Sorts loaded items only.");
  });

  it("parses only the known non-default modes and fails closed otherwise", () => {
    expect(parseLaneSortMode("clientName")).toBe("clientName");
    expect(parseLaneSortMode("updated")).toBe("updated");
    expect(parseLaneSortMode("company")).toBe("default");
    expect(parseLaneSortMode(undefined)).toBe("default");
    expect(parseLaneSortMode(null)).toBe("default");
    expect(parseLaneSortMode(3)).toBe("default");
  });

  it("keeps the loaded (server index) order untouched in default mode", () => {
    expect(sortLaneRows(rows, "default").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts by client name A–Z, case- and diacritic-insensitive", () => {
    const sorted = sortLaneRows(rows, "clientName");
    expect(sorted.map((r) => r.clientName)).toEqual([
      "acme labs",
      "Acme Labs",
      "Émile & Co",
      "Zenith Corp",
    ]);
  });

  it("keeps loaded relative order on client-name ties (stable)", () => {
    const tied: Row[] = [
      { id: "x", clientName: "Acme", updatedAt: 1 },
      { id: "y", clientName: "acme", updatedAt: 2 },
      { id: "z", clientName: "ACME", updatedAt: 3 },
    ];
    expect(sortLaneRows(tied, "clientName").map((r) => r.id)).toEqual(["x", "y", "z"]);
  });

  it("sorts by most recently updated first", () => {
    expect(sortLaneRows(rows, "updated").map((r) => r.id)).toEqual(["d", "a", "c", "b"]);
  });

  it("keeps rows without updatedAt in loaded order after dated rows", () => {
    const mixed: Row[] = [
      { id: "n1", clientName: "One" },
      { id: "d1", clientName: "Two", updatedAt: 10 },
      { id: "n2", clientName: "Three" },
      { id: "d2", clientName: "Four", updatedAt: 20 },
    ];
    expect(sortLaneRows(mixed, "updated").map((r) => r.id)).toEqual(["d2", "d1", "n1", "n2"]);
  });

  it("never mutates the input array", () => {
    const input = [...rows];
    sortLaneRows(input, "clientName");
    sortLaneRows(input, "updated");
    expect(input).toEqual(rows);
  });
});
