import { describe, expect, it } from "vitest";
import { firmDateParts, firmDateStartAfterDays, firmDateStartUtc, isFirmDateStart } from "./firmTime";

describe("Vancouver civil dates", () => {
  it("keeps midnight boundaries correct through spring DST", () => {
    const march8 = firmDateStartUtc({ year: 2026, month: 3, day: 8 });
    const march9 = firmDateStartAfterDays(march8, 1);
    expect(march9 - march8).toBe(23 * 60 * 60 * 1000);
    expect(firmDateParts(march9)).toEqual({ year: 2026, month: 3, day: 9 });
    expect(isFirmDateStart(march9)).toBe(true);
  });

  it("keeps midnight boundaries correct through autumn DST", () => {
    const november1 = firmDateStartUtc({ year: 2026, month: 11, day: 1 });
    const november2 = firmDateStartAfterDays(november1, 1);
    expect(november2 - november1).toBe(25 * 60 * 60 * 1000);
    expect(firmDateParts(november2)).toEqual({ year: 2026, month: 11, day: 2 });
  });
});
