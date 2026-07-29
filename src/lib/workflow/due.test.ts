import { describe, expect, it } from "vitest";
import { formatDue } from "./due";

const noon = (day: number) => new Date(2026, 6, day, 12).getTime();

describe("formatDue", () => {
  it("keeps missing due dates empty", () => {
    expect(formatDue(null, noon(28))).toBeNull();
  });

  it("formats today, future, and overdue dates with text meaning", () => {
    expect(formatDue(noon(28), noon(28))).toMatchObject({ relative: "Due today", overdue: false });
    expect(formatDue(noon(29), noon(28))).toMatchObject({ relative: "Due tomorrow", overdue: false });
    expect(formatDue(noon(31), noon(28))).toMatchObject({ relative: "Due in 3 days", overdue: false });
    expect(formatDue(noon(27), noon(28))).toMatchObject({ relative: "1 day overdue", overdue: true });
    expect(formatDue(noon(25), noon(28))).toMatchObject({ relative: "3 days overdue", overdue: true });
  });

  it("includes an absolute en-CA date", () => {
    expect(formatDue(noon(28), noon(28))?.absolute).toMatch(/2026|Jul/);
  });
});
