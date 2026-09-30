import { describe, expect, it } from "vitest";
import { chooseDroppedUncertainties, isNearCopy, NEAR_COPY_SHARE } from "./droppedUncertainties";
import { contentWords, sharedContentWords } from "./seedQuoteSupport";
import { MAX_DROPPED_UNCERTAINTIES_FROZEN, MAX_DROPPED_UNCERTAINTY_CHECKS } from "./seedRevisions";

// Fictional Marrowgate cold-water biofilter plan (release suite run 10).
const KEPT = "It was uncertain whether stepwise acclimation from 14 to 8 degrees would beat unacclimated seed enough to hit the 5-week target.";
const RUN_10_KEPT = [
  "It was uncertain whether stepwise acclimation from 14 to 8 degrees would actually beat unacclimated seed enough to hit the 5-week target.",
  "No prior data showed how much the nitrite stage specifically would shorten under acclimation versus ammonia oxidation.",
];
const RUN_10_DROPPED = [
  "It was unclear what seed fraction would be needed once water dropped further to 6 degrees C.",
  "The team did not know if gains from more seed would keep scaling or flatten at some point.",
];

/** Each side's share of content words found in the other. */
function shares(dropped: string, kept: string): [number, number] {
  return [
    sharedContentWords(kept, dropped) / contentWords(dropped).length,
    sharedContentWords(dropped, kept) / contentWords(kept).length,
  ];
}

describe("near-copy guard (2026-09-30, first)", () => {
  it("never treats run 10's dropped seed-fraction uncertainty as a copy of the kept acclimation one", () => {
    const [droppedShare, keptShare] = shares(RUN_10_DROPPED.join(" "), RUN_10_KEPT.join(" "));
    expect(droppedShare).toBeLessThan(0.2);
    expect(keptShare).toBeLessThan(0.2);
    expect(isNearCopy(RUN_10_DROPPED, RUN_10_KEPT)).toBe(false);
  });

  it("treats a lightly reworded uncertainty as a near copy", () => {
    const reworded = "It was uncertain whether stepwise acclimation from 14 to 8 degrees would beat unacclimated seed by enough to reach the 5-week target.";
    expect(Math.min(...shares(reworded, KEPT))).toBeGreaterThan(0.9);
    expect(isNearCopy([reworded], [KEPT])).toBe(true);
  });

  it("reads both sides of the 0.7 threshold on the dropped uncertainty's words only (review P3-3)", () => {
    expect(NEAR_COPY_SHARE).toBe(0.7);
    // 9 of 12 of the dropped one's content words are in the kept one: replaced.
    const over = "It was uncertain whether stepwise acclimation from 14 to 8 degrees would beat unacclimated seed in cold pump loops.";
    expect(shares(over, KEPT)[0]).toBe(0.75);
    expect(isNearCopy([over], [KEPT])).toBe(true);
    // 9 of 13: not replaced.
    const under = "It was uncertain whether stepwise acclimation from 14 to 8 degrees would beat unacclimated seed in cold pump loops at farms.";
    expect(shares(under, KEPT)[0]).toBeCloseTo(9 / 13);
    expect(isNearCopy([under], [KEPT])).toBe(false);
    // A dropped uncertainty contained in a longer kept one is replaced by it,
    // however many other words the kept one has.
    const subset = "It was uncertain whether stepwise acclimation would beat unacclimated seed.";
    expect(shares(subset, KEPT)).toEqual([1, expect.any(Number)]);
    expect(shares(subset, KEPT)[1]).toBeLessThan(0.5);
    expect(isNearCopy([subset], [KEPT])).toBe(true);
  });

  it("counts a kept uncertainty that merges two originals as replacing each", () => {
    const merged = [
      "It was uncertain whether stepwise acclimation from 14 to 8 degrees would beat unacclimated seed enough to hit the 5-week target,",
      "and whether nitrite oxidizing bacteria were the true bottleneck under cold shock.",
    ];
    const acclimation = [KEPT];
    const bottleneck = ["Whether nitrite oxidizing bacteria were the true bottleneck under cold shock was only inferred."];
    expect(isNearCopy(acclimation, merged)).toBe(true);
    expect(isNearCopy(bottleneck, merged)).toBe(true);
    expect(chooseDroppedUncertainties({
      unticked: [{ seedId: "acclimation", wording: acclimation }, { seedId: "bottleneck", wording: bottleneck }],
      kept: [{ seedId: "merged", wording: merged }],
      rootOf: (id) => id,
    })).toEqual({ checked: [], notChecked: [] });
  });

  it("never matches wording with no content words", () => {
    expect(isNearCopy(["It was the one."], [KEPT])).toBe(false);
    expect(isNearCopy([KEPT], [""])).toBe(false);
  });
});

describe("which unticked uncertainties are dropped (2026-09-30, first)", () => {
  const rootOf = (roots: Record<string, string>) => (seedId: string) => roots[seedId] ?? seedId;

  it("lists an unticked uncertainty, but not a kept one, one in a kept Seed's revision chain, a near copy or a second Seed of one chain", () => {
    const choice = chooseDroppedUncertainties({
      unticked: [
        { seedId: "kept", wording: [KEPT] },
        { seedId: "original", wording: ["The original wording of a revised uncertainty."] },
        { seedId: "nearCopy", wording: ["It was uncertain whether stepwise acclimation from 14 to 8 degrees would beat unacclimated seed by enough to reach the 5-week target."] },
        { seedId: "seedFraction", wording: RUN_10_DROPPED },
        { seedId: "seedFractionRevision", wording: ["A revision of the seed fraction uncertainty, also unticked."] },
      ],
      kept: [
        { seedId: "kept", wording: [KEPT] },
        { seedId: "revision", wording: ["The writer's picked revision of it."] },
      ],
      rootOf: rootOf({ revision: "original", seedFractionRevision: "seedFraction" }),
    });
    expect(choice).toEqual({ checked: [{ seedId: "seedFraction", wording: RUN_10_DROPPED }], notChecked: [] });
  });

  it("checks the first three in order and names the rest as not checked, up to sixteen in all", () => {
    const unticked = Array.from({ length: MAX_DROPPED_UNCERTAINTIES_FROZEN + 4 }, (_, index) => ({
      seedId: `u${index}`,
      wording: [`It was unknown how factor ${index} changed nitrification in cold water.`],
    }));
    const choice = chooseDroppedUncertainties({ unticked, kept: [{ seedId: "kept", wording: [KEPT] }], rootOf: (id) => id });
    expect(MAX_DROPPED_UNCERTAINTY_CHECKS).toBe(3);
    expect(choice.checked.map((entry) => entry.seedId)).toEqual(["u0", "u1", "u2"]);
    expect(choice.notChecked.map((entry) => entry.seedId)).toEqual(
      Array.from({ length: MAX_DROPPED_UNCERTAINTIES_FROZEN - 3 }, (_, index) => `u${index + 3}`)
    );
  });

  it("lists nothing when nothing was unticked", () => {
    expect(chooseDroppedUncertainties({ unticked: [], kept: [{ seedId: "kept", wording: [KEPT] }], rootOf: (id) => id }))
      .toEqual({ checked: [], notChecked: [] });
  });
});
