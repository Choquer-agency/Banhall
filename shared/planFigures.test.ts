import { describe, expect, it } from "vitest";
import { distinctiveFigures, figuresOf } from "./planFigures";

describe("figures with a unit (2026-09-30 second, shared by the product and the release suite)", () => {
  it("reads the release suite's forms as before", () => {
    expect(figuresOf("At 6 degrees C the loops took 44 and 29 days; 15 percent seed, from 14 to 8 degrees.")).toEqual([
      "6 C", "44 days", "29 days", "15 percent", "14 C", "8 C",
    ]);
    expect(figuresOf("A 5-week target, 10% seed and 2.3 mg/L TAN at 7 C.")).toEqual(["10 percent", "2.3 mg/L", "7 C"]);
    expect(figuresOf("No unit here: 44, 2025.")).toEqual([]);
  });

  it("reads a degree sign, a range with a hyphen and a comparison with vs", () => {
    // Release suite run 11 drafted "8°C", "6-12°C" and "19 vs 6 days".
    expect(figuresOf("Loops ran at 8°C, clients raise fish in 6-12°C water and 14 ºC seed.")).toEqual([
      "8 C", "6 C", "12 C", "14 C",
    ]);
    expect(figuresOf("P3 states stall durations (19 vs 6 days), close to dropped")).toEqual(["19 days", "6 days"]);
    expect(figuresOf("raw drift exceeded 5 percent by day 36 to 40, or 36 to 40 days")).toEqual([
      "5 percent", "36 days", "40 days",
    ]);
  });

  it("reads the units of the other fixtures and never a lower-case letter alone", () => {
    expect(figuresOf("A 20 N force, 8 to 40 N, 0.18 mm at 210 ms, 3.8 kg/s, 10 ppi and 40 mm/s.")).toEqual([
      "20 N", "8 N", "40 N", "0.18 mm", "210 ms", "3.8 kg/s", "10 ppi", "40 mm/s",
    ]);
    expect(figuresOf("Step 3 n was 4 c in the table.")).toEqual([]);
    expect(figuresOf("Trial 2 Nitrite rose; 3 Celsius readings.")).toEqual([]);
  });

  it("finds the figures only the given texts use", () => {
    const dropped = [
      "It was unclear what seed fraction would be needed at 6 degrees C.",
      "Trial 2 at 6 C compared 5 and 15 percent seed. The loops took 44 and 29 days.",
    ];
    const plan = [
      "The nitrite stall lasted 19 days in unacclimated seed but only 6 days in acclimated seed.",
      "Full nitrification under 5 weeks at 8 degrees C, about 31 days.",
    ];
    expect(distinctiveFigures(dropped, plan)).toEqual(["6 C", "5 percent", "15 percent", "44 days", "29 days"]);
    expect(distinctiveFigures(["6 days at 8 C"], plan)).toEqual([]);
  });
});
