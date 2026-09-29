import { describe, expect, it } from "vitest";
import {
  advancementLinkProblem,
  allowedAdvancementLinks,
  experimentsForDroppedUncertainties,
  pickedLinkSelections,
} from "./advancementLinks";

// 2026-09-29 (first amendment). The run 6 fixture (Marrowgate, fictional):
// U1 cold-water start-up, U2 feeding-surge dosing, U3 sensor accuracy.
describe("advancement links follow the uncertainty the experiments tested", () => {
  const picked = pickedLinkSelections(
    ["u2", "u3"],
    [
      { seedId: "trial-1", uncertaintySeedId: "u1" },
      { seedId: "trial-3", uncertaintySeedId: "u2" },
      { seedId: "trial-5", uncertaintySeedId: "u3" },
      { seedId: "legacy", uncertaintySeedId: null },
    ]
  );

  it("names why an advancement is not linked", () => {
    expect(advancementLinkProblem({ uncertaintySeedId: "u2", experimentSeedIds: ["trial-3"] }, picked)).toBeNull();
    expect(advancementLinkProblem({ uncertaintySeedId: "u2", experimentSeedIds: ["trial-3", "legacy"] }, picked)).toBeNull();
    expect(advancementLinkProblem({}, picked)).toBe("missing");
    expect(advancementLinkProblem({ uncertaintySeedId: "u2", experimentSeedIds: [] }, picked)).toBe("missing");
    expect(advancementLinkProblem({ uncertaintySeedId: "u1", experimentSeedIds: ["trial-1"] }, picked)).toBe(
      "uncertainty_not_picked"
    );
    expect(advancementLinkProblem({ uncertaintySeedId: "u2", experimentSeedIds: ["trial-9"] }, picked)).toBe(
      "experiment_not_picked"
    );
    // Run 6: a start-up trial linked to the sensor uncertainty.
    expect(advancementLinkProblem({ uncertaintySeedId: "u3", experimentSeedIds: ["trial-1"] }, picked)).toBe(
      "experiment_tested_other"
    );
  });

  it("pairs each picked uncertainty with the experiments that tested it, and leaves out one with none", () => {
    expect(
      allowedAdvancementLinks(
        ["u1", "u2", "u3"],
        [
          { seedId: "trial-3", uncertaintySeedId: "u2" },
          { seedId: "trial-4", uncertaintySeedId: "u2" },
          { seedId: "legacy", uncertaintySeedId: null },
        ]
      )
    ).toEqual([
      { uncertaintySeedId: "u1", experimentSeedIds: ["legacy"] },
      { uncertaintySeedId: "u2", experimentSeedIds: ["trial-3", "trial-4", "legacy"] },
      { uncertaintySeedId: "u3", experimentSeedIds: ["legacy"] },
    ]);
    // The run 6 corner: every picked experiment tested the dropped uncertainty.
    expect(
      allowedAdvancementLinks(
        ["u2", "u3"],
        [
          { seedId: "trial-1", uncertaintySeedId: "u1" },
          { seedId: "trial-2", uncertaintySeedId: "u1" },
        ]
      )
    ).toEqual([]);
    expect(allowedAdvancementLinks([], [{ seedId: "legacy", uncertaintySeedId: null }])).toEqual([]);
  });

  it("finds picked experiments that tested a dropped uncertainty, never one that records none", () => {
    expect(
      experimentsForDroppedUncertainties(new Set(["u2", "u3"]), [
        { seedId: "trial-1", uncertaintySeedId: "u1" },
        { seedId: "trial-3", uncertaintySeedId: "u2" },
        { seedId: "legacy", uncertaintySeedId: null },
      ])
    ).toEqual([{ seedId: "trial-1", uncertaintySeedId: "u1" }]);
  });
});
