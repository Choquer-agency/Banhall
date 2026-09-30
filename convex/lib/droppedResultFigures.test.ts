import { describe, expect, it } from "vitest";
import { resultFigureConflicts } from "./droppedResultFigures";

// 2026-09-30 (fourth, review P2-1). Release suite run 11's Marrowgate plan
// (fictional): the writer dropped the acclimation uncertainty; its refused
// Subsection 11 advancement said "31 days at 8 C, against 47 days".
describe("a result that states a dropped uncertainty's result is found by its figures", () => {
  const dropped = {
    seedId: "u1-acclimation",
    wording: ["It was uncertain whether stepwise acclimation would actually work rather than just delay cold shock."],
    related: [
      "Stepwise acclimation of seed media cuts cold-water start-up roughly in half, 31 days at 8 C, against 47 days unacclimated.",
    ],
  };
  // Kept picks of the other steps: the objective names 8 C and 5 weeks.
  const otherPicked = [
    "That knowledge was meant to enable a start-up protocol reaching full nitrification in under 5 weeks at 8 degrees C.",
    "The nitrite stall lasted 19 days in unacclimated seed but only 6 days in acclimated seed.",
  ];

  it("flags the dropped result under a kept link or an empty list, with only its distinctive figures", () => {
    const conflicts = resultFigureConflicts({
      results: [
        { seedId: "o1", roleId: "overall_advancement", wording: ["The 5-week objective at 8 C was met, reaching about 31 days."] },
        { seedId: "g1", roleId: "goal_improvements", wording: ["Stepwise acclimation closed that gap, reaching full nitrification in about 31 days at 8 C."] },
        { seedId: "o2", roleId: "overall_advancement", wording: ["Nitrite oxidizers stalled for 19 days without acclimation."] },
      ],
      otherPicked,
      dropped: [dropped],
    });
    // 8 C is in a kept pick, so only 31 days is distinctive; 19 days is kept work.
    expect(conflicts).toEqual([
      { seedId: "o1", roleId: "overall_advancement", droppedSeedId: "u1-acclimation", figures: ["31 days"] },
      { seedId: "g1", roleId: "goal_improvements", droppedSeedId: "u1-acclimation", figures: ["31 days"] },
    ]);
  });

  it("never lets the two result steps vouch for each other, but a kept pick of another step does", () => {
    const results = [
      { seedId: "o1", roleId: "overall_advancement" as const, wording: ["Start-up fell to 47 days."] },
      { seedId: "g1", roleId: "goal_improvements" as const, wording: ["The gap closed at 47 days."] },
    ];
    expect(resultFigureConflicts({ results, otherPicked, dropped: [dropped] }).map((conflict) => conflict.seedId)).toEqual(["o1", "g1"]);
    expect(resultFigureConflicts({ results, otherPicked: [...otherPicked, "The unacclimated loop took 47 days."], dropped: [dropped] })).toEqual([]);
  });

  it("finds nothing without a figure, or with no dropped uncertainty", () => {
    const results = [{ seedId: "g1", roleId: "goal_improvements" as const, wording: ["The original goal was a faster cold start-up."] }];
    expect(resultFigureConflicts({ results, otherPicked, dropped: [dropped] })).toEqual([]);
    expect(resultFigureConflicts({ results: [{ ...results[0]!, wording: ["It took 31 days."] }], otherPicked, dropped: [] })).toEqual([]);
  });
});
