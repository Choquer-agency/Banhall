import { expect, it } from "vitest";
import { calendarDaysAgo } from "./usageDateRange";
it("subtracts local dates across spring and fall DST changes", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Vancouver";
  try {
    for (const date of [new Date(2026, 2, 9, 0, 15), new Date(2026, 10, 2, 23, 45)]) {
      const day = calendarDaysAgo(1, date);
      expect(day.getDate()).toBe(date.getDate() - 1);
      expect(day.getHours()).toBe(date.getHours());
      expect(day.getMinutes()).toBe(date.getMinutes());
    }
    const start = calendarDaysAgo(29, new Date(2026, 2, 15, 0, 15));
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 1, 14]);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
