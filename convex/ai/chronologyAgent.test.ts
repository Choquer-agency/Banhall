import { describe, test, expect } from "vitest";
import { normalizeChronology } from "./chronologyAgent";

const ENTRY = {
  phase: "Regulatory Analysis",
  description: "Analyzed IMO regulations.",
  uncertaintyAddressed: "How to configure coverage.",
  activityType: "experimental" as const,
};

describe("normalizeChronology", () => {
  test("passes a well-formed table through", () => {
    expect(normalizeChronology({ entries: [ENTRY] })).toEqual({ entries: [ENTRY] });
  });

  test("unwraps the double-encoded shape seen in production", () => {
    // A real report stored entries as a JSON string wrapping another table,
    // which made the panel call .filter on a string and crash the page.
    const doubled = { entries: JSON.stringify({ entries: [ENTRY] }) };
    expect(normalizeChronology(doubled)).toEqual({ entries: [ENTRY] });
  });

  test("accepts a bare array of entries", () => {
    expect(normalizeChronology([ENTRY])).toEqual({ entries: [ENTRY] });
  });

  test("accepts a fully stringified table", () => {
    expect(normalizeChronology(JSON.stringify({ entries: [ENTRY] }))).toEqual({
      entries: [ENTRY],
    });
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
    ["unparseable text", "not json at all"],
    ["an empty object", {}],
    ["entries as a number", { entries: 7 }],
  ])("returns an empty table for %s", (_label, value) => {
    expect(normalizeChronology(value)).toEqual({ entries: [] });
  });

  test("drops non-object entries rather than rendering junk rows", () => {
    expect(normalizeChronology({ entries: [ENTRY, null, "x", 3] })).toEqual({
      entries: [ENTRY],
    });
  });

  test("stops unwrapping instead of recursing forever", () => {
    // Defensive: a pathologically nested payload must terminate.
    let nested: unknown = { entries: [ENTRY] };
    for (let i = 0; i < 6; i++) nested = { entries: JSON.stringify(nested) };
    expect(() => normalizeChronology(nested)).not.toThrow();
  });
});
