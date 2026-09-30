import { describe, expect, it } from "vitest";
import { distinctiveFigures, droppedUncertaintyFigures, figuresOf } from "./planFigures";

describe("figures with a unit (2026-09-30 second, shared by the product and the release suite)", () => {
  it("reads the release suite's forms, a hyphenated unit included", () => {
    expect(figuresOf("At 6 degrees C the loops took 44 and 29 days; 15 percent seed, from 14 to 8 degrees.")).toEqual([
      "6 C", "44 days", "29 days", "15 percent", "14 C", "8 C",
    ]);
    // Review P2-5: "a 5-week target" is "5 weeks".
    expect(figuresOf("A 5-week target, 10% seed and 2.3 mg/L TAN at 7 C.")).toEqual(["5 weeks", "10 percent", "2.3 mg/L", "7 C"]);
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

  it("review P2-5: a hyphen between number and unit, spelled units, thousands separators and a minus sign", () => {
    expect(figuresOf("a 44-day run, a 30-day trial and a 5-week target")).toEqual(["44 days", "30 days", "5 weeks"]);
    expect(figuresOf(
      "5 per cent, 180 nanometres, 1 millimetres per second, 1 mg per litre, 2 milligrams per liter, 30 s, 6 h, 45 mins and 3 hrs"
    )).toEqual(["5 percent", "180 nm", "1 mm/s", "1 mg/L", "2 mg/L", "30 seconds", "6 hours", "45 minutes", "3 hours"]);
    expect(figuresOf("the ramp through 1,100 to 1,350 C, then 1,580 C, and 44,290 days")).toEqual([
      "1100 C", "1350 C", "1580 C", "44290 days",
    ]);
    expect(figuresOf("from -5 to 5 C, and \u22123 C overnight")).toEqual(["-5 C", "5 C", "-3 C"]);
    // A hyphen after a number is a range, never a minus.
    expect(figuresOf("in 6-12 C water")).toEqual(["6 C", "12 C"]);
  });

  it("review P2-5: never reads a capital label, a decade or a glued letter as a unit", () => {
    expect(figuresOf("Trial 4 C ran long; loops at 8 C.")).toEqual(["8 C"]);
    expect(figuresOf("In Bay 4 C the probe drifted.")).toEqual([]);
    // A capitalised word opening a sentence is no label.
    expect(figuresOf("Below 10 C, start-up slowed. At 7 C it stalled.")).toEqual(["10 C", "7 C"]);
    expect(figuresOf("in the 1990s the 4C loop ran")).toEqual([]);
    // A list that opens after a label counts its first numbers as the label's.
    expect(figuresOf("drifted 8% low by day 10 and 0.4 mg/L per week")).toEqual(["8 percent", "0.4 mg/L"]);
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

  it("review P3-2: one rule for a dropped uncertainty's own figures, as release suite run 11 froze it", () => {
    // changed-advancement-links, run 11: the frozen dropped uncertainty, the
    // experiments and advancements that recorded it, and signed-off items
    // that use 31 days, 8 C and 5 weeks. "44" in "29 days against 44" has no
    // unit of its own.
    expect(droppedUncertaintyFigures({
      wording: [
        "It was uncertain whether stepwise acclimation would actually work rather than just delay cold shock.",
        "The team did not know what seed fraction would be needed at colder temperatures like 6 degrees C.",
      ],
      references: [
        { wording: ["Trial 1 tested acclimated versus unacclimated seed media across loops A, B and C at 8 C.", "Acclimated seed reached full nitrification in 31 days against 47 for unacclimated seed."] },
        { wording: ["Trial 2 tested acclimated seed fractions of 5 and 15 percent at 6 C to find the needed dose.", "The 15 percent seed fraction reached full nitrification in 29 days against 44 for 5 percent."] },
        { wording: ["Acclimated seed reached full nitrification in 31 days at 8 C, against 47 days unacclimated."] },
      ],
      planWording: [
        ["The U1 objective of full nitrification under 5 weeks at 8 degrees C was achieved, reaching about 31 days."],
      ],
    })).toEqual(["6 C", "5 percent", "15 percent", "29 days", "47 days"]);
  });
});
