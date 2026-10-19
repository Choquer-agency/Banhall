import { beforeEach, describe, expect, it } from "vitest";
import { isOpen, openByRule, readOverrides, writeOverrides } from "./fiscalYearOpen";

const done = { workflowStage: "delivered" as const };
const working = { workflowStage: "drafting" as const };

describe("fiscal year sections open by the rule", () => {
  it("opens the two newest years, and an older one only while it has work in progress", () => {
    const open = openByRule([
      { key: "fy-2026", rows: [done] },
      { key: "fy-2025", rows: [done] },
      { key: "fy-2024", rows: [done, { workflowStage: "abandoned" }] },
      { key: "fy-2023", rows: [done, working] },
      { key: "none", rows: [{ workflowStage: null }] },
    ]);
    expect([...open]).toEqual(["fy-2026", "fy-2025", "fy-2023"]);
  });
});

describe("toggles kept for the session", () => {
  beforeEach(() => {
    // Unit tests run in Node: a minimal sessionStorage.
    const store = new Map<string, string>();
    globalThis.sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  });

  it("overrides the rule per company and ignores anything malformed", () => {
    writeOverrides("cedarline systems", { "fy-2026": false, "fy-2024": true });
    const overrides = readOverrides("cedarline systems");
    const byRule = new Set(["fy-2026", "fy-2025"]);
    expect(isOpen("fy-2026", byRule, overrides)).toBe(false);
    expect(isOpen("fy-2025", byRule, overrides)).toBe(true);
    expect(isOpen("fy-2024", byRule, overrides)).toBe(true);
    expect(readOverrides("acuity insights")).toEqual({});
    sessionStorage.setItem("projects:fiscal-year-open:broken", "[1,2]");
    expect(readOverrides("broken")).toEqual({});
  });
});
