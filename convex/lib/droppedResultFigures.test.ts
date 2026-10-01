import { describe, expect, it } from "vitest";
import { droppedResultFigures } from "./droppedResultFigures";

// 2026-09-30 (fourth, review re-check). Release suite run 11, fixture
// "Changed advancement links" (Marrowgate, fictional), wording as in the
// pack's results.json (_bmad-output/test-artifacts/seed-plan-eval/
// 2026-09-30-run2): the writer dropped the acclimation and seed-fraction
// uncertainty (yn755fx5...).
const RUN11 = {
  // Seeds that recorded it and that the writer ticked at some point.
  outcomes: [
    { wording: ["Trial 1 tested acclimated versus unacclimated seed media across loops A, B and C at 8 C.", "Acclimated seed reached full nitrification in 31 days against 47 for unacclimated seed."] },
    { wording: ["Stepwise acclimation of seed media cuts cold-water start-up roughly in half versus unacclimated seed.", "Acclimated seed reached full nitrification in 31 days at 8 C, against 47 days unacclimated."] },
    { wording: ["Acclimated seed media reaches full nitrification at 8 C well within the objective under 5 weeks."] },
  ],
  // Trial 2 was never ticked: its figures are not the writer's decision.
  neverTicked: { wording: ["Trial 2 tested acclimated seed fractions of 5 and 15 percent at 6 C to find the needed dose.", "The 15 percent seed fraction reached full nitrification in 29 days against 44 for 5 percent."] },
  // The kept picks of the other steps, as signed off.
  kept: [
    ["The objective was to shorten biofilter nitrification start-up at water temperatures below 10 C.", "Below 10 degrees C, nitrification start-up was taking 9 to 10 weeks instead of 3 to 4."],
    ["The company sought new knowledge on whether stepwise cold acclimation of seed media could speed nitrification start-up below 10 C.", "That knowledge was meant to enable a start-up protocol reaching full nitrification in under 5 weeks at 8 degrees C."],
    // A kept hypothesis in the fixture's words (its stepwise schedule).
    ["If seed media is acclimated stepwise from 14 to 8 degrees, the nitrite stall shortens."],
    ["The nitrite stall lasted 19 days in unacclimated seed but only 6 days in acclimated seed.", "This confirmed nitrite oxidizing bacteria as the rate-limiting step under cold shock."],
    ["The start-up method has been used on one client farm, reaching full nitrification in 34 days at 7 to 8 degrees.", "This field result was close to the pilot result, though it fell outside controlled pilot conditions."],
  ],
  item10: ["Stepwise acclimation of seed media cut cold-water start-up roughly in half versus unacclimated seed.", "The U1 objective of full nitrification under 5 weeks at 8 degrees C was achieved, reaching about 31 days."],
  item13: ["The original goal was to shorten biofilter start-up below 10 C from 9 to 10 weeks toward under 5 weeks.", "Stepwise acclimation of seed media closed that gap, reaching full nitrification in about 31 days at 8 C."],
};

describe("a result that states a dropped uncertainty's result asks for an acknowledgement", () => {
  it("raises items 10 and 13 for 31 days, and nothing for the kept hypothesis or the kept stall result", () => {
    const found = droppedResultFigures({
      picks: [
        { seedId: "item10", wording: RUN11.item10 },
        { seedId: "item13", wording: RUN11.item13 },
        { seedId: "hypothesisLike", wording: ["Acclimating seed stepwise from 14 to 8 degrees shortened the stall."] },
        { seedId: "stall", wording: ["The nitrite stall fell from 19 vs 6 days with acclimated seed."] },
      ],
      kept: RUN11.kept,
      dropped: [{ seedId: "yn755", outcomes: RUN11.outcomes }],
    });
    // 8 C and 5 weeks are the kept objective's; 31 days is only the dropped trial's.
    expect(found).toEqual([
      { seedId: "item10", figures: ["31 days"], uncertaintySeedIds: ["yn755"] },
      { seedId: "item13", figures: ["31 days"], uncertaintySeedIds: ["yn755"] },
    ]);
  });

  it("reads outcomes only from what it is given: never a Seed nobody ticked, never the uncertainty's own words", () => {
    // Trial 2's 29 days would only count had the writer ticked it.
    const pick = { seedId: "o1", wording: ["The 15 percent fraction reached 29 days."] };
    expect(droppedResultFigures({ picks: [pick], kept: RUN11.kept, dropped: [{ seedId: "yn755", outcomes: RUN11.outcomes }] })).toEqual([]);
    expect(
      droppedResultFigures({ picks: [pick], kept: RUN11.kept, dropped: [{ seedId: "yn755", outcomes: [RUN11.neverTicked] }] })
    ).toEqual([{ seedId: "o1", figures: ["15 percent", "29 days"], uncertaintySeedIds: ["yn755"] }]);
    // No outcome at all (only the uncertainty's own wording, "6 degrees C"): nothing.
    expect(droppedResultFigures({ picks: [{ seedId: "o2", wording: ["It worked at 6 C."] }], kept: [], dropped: [{ seedId: "yn755", outcomes: [] }] })).toEqual([]);
  });

  it("lets a kept pick vouch for a figure, and names every figure and uncertainty a pick states", () => {
    const pick = { seedId: "o1", wording: ["Start-up took 31 days against 47 days."] };
    expect(droppedResultFigures({ picks: [pick], kept: [...RUN11.kept, ["The unacclimated loop took 47 days."]], dropped: [{ seedId: "yn755", outcomes: RUN11.outcomes }] }))
      .toEqual([{ seedId: "o1", figures: ["31 days"], uncertaintySeedIds: ["yn755"] }]);
    expect(
      droppedResultFigures({
        picks: [pick],
        kept: RUN11.kept,
        dropped: [
          { seedId: "yn755", outcomes: RUN11.outcomes },
          { seedId: "other", outcomes: [{ wording: ["A second trial took 47 days."] }] },
        ],
      })
    ).toEqual([{ seedId: "o1", figures: ["31 days", "47 days"], uncertaintySeedIds: ["yn755", "other"] }]);
  });
});
