import { describe, expect, it } from "vitest";
import {
  advancementLinkProblem,
  allowedAdvancementLinks,
  experimentsForDroppedUncertainties,
  pickedLinkSelections,
  pickedUncertaintyFor,
  revisionRoots,
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

  it("counts an uncertainty and its Feedback revisions as one (review P2-2)", () => {
    // u1 was revised to u1b, and u1b to u1c; a cycle never hangs.
    const rootOf = revisionRoots([
      { seedId: "u1b", revisionOfSeedId: "u1" },
      { seedId: "u1c", revisionOfSeedId: "u1b" },
      { seedId: "x", revisionOfSeedId: "y" },
      { seedId: "y", revisionOfSeedId: "x" },
      { seedId: "u2", revisionOfSeedId: null },
    ]);
    expect(["u1", "u1b", "u1c"].map(rootOf)).toEqual(["u1", "u1", "u1"]);
    expect(rootOf("u2")).toBe("u2");
    expect(["x", "y"].map(rootOf).sort()).toEqual(["x", "y"]);
    const trials = [{ seedId: "trial-1", uncertaintySeedId: "u1" }];
    // The writer picked the latest revision; the trial named the original.
    expect(experimentsForDroppedUncertainties(new Set(["u1c"]), trials, rootOf)).toEqual([]);
    expect(experimentsForDroppedUncertainties(new Set(["u1c"]), trials)).toEqual(trials);
    expect(allowedAdvancementLinks(["u1c"], trials, rootOf)).toEqual([
      { uncertaintySeedId: "u1c", experimentSeedIds: ["trial-1"] },
    ]);
    const picked = pickedLinkSelections(["u1c"], trials, rootOf);
    expect(advancementLinkProblem({ uncertaintySeedId: "u1b", experimentSeedIds: ["trial-1"] }, picked)).toBeNull();
    expect(pickedUncertaintyFor("u1", ["u2", "u1c"], rootOf)).toBe("u1c");
    expect(pickedUncertaintyFor("u2", ["u2", "u1c"], rootOf)).toBe("u2");
    expect(pickedUncertaintyFor("u3", ["u2", "u1c"], rootOf)).toBeNull();
  });
});
