import { describe, expect, it } from "vitest";
import { addFirmBusinessDays, assignmentDefaults, firmDateInputToTimestamp } from "./assignmentDefaults";

describe("assignment defaults", () => {
  it("skips weekends in the Vancouver firm calendar", () => {
    expect(addFirmBusinessDays(Date.UTC(2026, 6, 31, 19))).toBe("2026-08-04");
    expect(addFirmBusinessDays(Date.UTC(2026, 7, 3, 19))).toBe("2026-08-05");
  });

  it("keeps the correct civil date across a DST weekend", () => {
    expect(addFirmBusinessDays(Date.UTC(2026, 2, 6, 20))).toBe("2026-03-10");
  });

  it("provides review defaults without guessing an assignee", () => {
    expect(assignmentDefaults("internal_review", Date.UTC(2026, 6, 31, 19))).toEqual({
      kind: "internal_review",
      blocking: true,
      instructions: "Review the current draft and leave actionable feedback.",
      dueDate: "2026-08-04",
    });
    expect(firmDateInputToTimestamp("2026-08-04")).toBe(Date.UTC(2026, 7, 4, 12));
  });
});
