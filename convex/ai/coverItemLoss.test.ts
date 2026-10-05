/**
 * 2026-10-04 (first, review re-check P2-b): a shortening pass run only for
 * the writer's cap keeps every signed-off item (owner decision), but a
 * rephrase that keeps the items is kept. The plan and the Lines are the
 * release suite run of 2026-10-04 (fixture writer-settings-document,
 * fictional Velloway Panel Finishing, commit e0fd7892), as its pack holds
 * them.
 */
import { describe, expect, it } from "vitest";
import { coverItemLoss } from "./pipeline";
import { sectionMetrics } from "../lib/lineLimits";

/** Each signed-off item as compression gets it: its bullets joined. */
const item = (...bullets: string[]) => bullets.join(" ");

const ITEMS_242 = [
  item(
    "The company finishes MDF panels for cabinet and fixture makers using a solvent-borne liquid lacquer line.",
    "Before the project period, the company had not run any powder coating trials."
  ),
  item(
    "The aim of this work was to develop a process to powder coat 25 mm routed MDF doors at line speed.",
    "The target was film build of 70 to 90 microns on faces and at least 60 microns edge coverage on routed profiles."
  ),
  item(
    "Standard powder cure temperatures of 160 to 200 C for steel exceed what the MDF substrate could tolerate.",
    "The board held 6 to 7 percent moisture plus pressing resin, so existing powder recipes were not transferable."
  ),
  item(
    "The aim of this work was to develop a process achieving edge coverage without a preheat that triggers outgassing defects.",
    "The goal paired this with a low-temperature powder able to fully cure within a production oven's cure window."
  ),
  item(
    "It was not known at the outset whether the board could reach edge coverage without a preheat past the outgassing onset.",
    "The same moisture that gave conductivity also caused outgassing, so no setting was known to satisfy both."
  ),
  item(
    "It was not known at the outset whether any low-temperature powder could fully cure below the outgassing onset with a wide enough cure window.",
    "A faster catalyst could shorten gel time, but a short gel time risked poor flow, so the trade-off was untested."
  ),
];

const P1_242 =
  "The company finishes MDF panels for cabinet and fixture makers using a solvent-borne liquid lacquer line, and before July 2025 the company had not run any powder coating trials. Two major customers indicated they would move to a competitor unless the company could offer a powder finish, since powder coating is solvent-free and gives a more durable edge than lacquer, which tends to chip at the edge. Standard powder cure temperatures of 160 to 200 C, developed for steel, exceed what the MDF substrate could tolerate. The board held 6 to 7 percent moisture plus pressing resin, so existing powder recipes were not transferable to this substrate.";
const P2_242 =
  "The central conflict was that making the MDF conductive enough for powder to stick, and curing the powder fully, both required heat, and heat was exactly what drove moisture and resin vapour out of the board, causing outgassing defects. The standard fix for a non-conductive substrate is to preheat it to pull moisture to the surface, but preheating pushed the panel surface temperature into the range that caused outgassing defects.";
const P3A_242 =
  "It was not known at the outset whether the board could reach edge coverage of at least 60 microns on the routed edges without a preheat that pushed panel surface temperature past the outgassing onset, since the same moisture needed for conductivity also caused outgassing.";
const P3B_242 =
  "Nor was it known whether any low-temperature powder could reach full cure below that onset within a cure window wide enough for a production oven, since a faster catalyst could shorten gel time at the risk of poor flow.";
const P4_242 =
  "The aim of this work was to develop a process to powder coat 25 mm routed MDF doors at the existing line speed of 2.5 metres per minute, in shaker and deep cove profiles, reaching film build of 70 to 90 microns on faces and at least 60 microns edge coverage on routed edges, with full cure and an adequate cure window.";
/** Line 242 as drafted: 323 words against the writer's 260. */
const LINE_242 = [P1_242, P2_242, `${P3A_242} ${P3B_242}`, P4_242].join("\n\n");

/** A rephrase that meets the cap: the customers sentence out, "fully" and some framing gone. */
const REPHRASED_242 = [
  "The company finishes MDF panels for cabinet and fixture makers using a solvent-borne liquid lacquer line, and before July 2025 it had not run any powder coating trials. Standard powder cure temperatures of 160 to 200 C, developed for steel, exceed what the MDF substrate could tolerate. The board held 6 to 7 percent moisture plus pressing resin, so existing powder recipes were not transferable to it.",
  "The central conflict was that making the MDF conductive enough for powder to stick, and curing the powder, both required heat, and heat drove moisture and resin vapour out of the board, causing outgassing defects. Preheating, the standard fix, pushed the panel surface temperature into that range.",
  `${P3A_242} ${P3B_242}`,
  P4_242,
].join("\n\n");

const ITEMS_244 = [
  item(
    "The team planned to separate conductivity from heat by testing an edge-only conductive sealer rather than relying solely on preheat.",
    "This systematic approach aimed to answer whether edge coverage could reach 60 microns without pushing panel surface temperature past the outgassing onset."
  ),
  item("If a faster catalyst shortens gel time below 100 seconds, then full cure occurs below the outgassing onset with an adequate cure window."),
  item("Trial 1 used the supplier's datasheet preheat and cure settings on routed MDF panels."),
  item(
    "Trial 2 lowered cure air and extended dwell, testing whether dwell time controlled pinhole onset.",
    "Pinhole onset tracked peak substrate temperature at about 118 to 122 C regardless of dwell time, leaving a near-zero cure window."
  ),
];
const HYPOTHESIS_244 =
  "It was hypothesized that if a conductive edge sealer could carry electrostatic charge to ground and seal the opened fibres on the routed edges, preheat temperature could be reduced while still reaching 60 microns of edge coverage without pushing panel surface temperature past the outgassing onset. It was further hypothesized that if a faster catalyst shortened gel time below 100 seconds, full cure would occur below the outgassing onset within an adequate cure window.";
const TRIAL_1_244 =
  "Trial 1 ran the supplier's datasheet process on the routed MDF panels: preheat to 110 C, a standard low-temperature powder, and convection cure at 135 C air. Cure was adequate at 55 to 62 MEK double rubs, but panel surface temperature peaked at 131 C. Outgassing defects averaged 14 per square metre overall and 30 per square metre on the routed edges, and edge coverage reached only 35 microns against 82 microns on the faces. This showed the datasheet values, developed for flat steel panels, did not transfer to thick routed MDF.";
const TRIAL_2_244 =
  "Trial 2 lowered cure air to 125 C and extended dwell to 10 to 14 minutes, then nudged air to 127 C, to test whether dwell time controlled outgassing onset. At 125 C air, panel surface temperature peaked at 121 C and outgassing defects dropped to 4 per square metre, but cure fell to 30 MEK double rubs. At 127 C air, outgassing defects rose to 9 per square metre. Onset held at about 118 to 122 C regardless of dwell time, showing peak panel surface temperature, not dwell time, controlled outgassing, and leaving a cure window close to zero with this powder.";
const LATER_244 =
  "Trial 3 applied a conductive edge sealer to the routed edges only, flash-dried, then dropped preheat from 110 C to 85 C, a 25 C reduction. Edge coverage rose to a 58 micron average and outgassing defects fell to 1.8 per square metre. Trial 4 worked with the powder supplier to test three catalyst levels of a faster-catalysed polyester-epoxy hybrid, mapping the cure window in 1 C steps with the sealer in place.";
const LINE_244 = [HYPOTHESIS_244, TRIAL_1_244, TRIAL_2_244, LATER_244].join("\n\n");

const ITEMS_246 = [
  item(
    "The fast-catalysed powder reached full cure at a panel surface temperature of 120 C with an 8 C wide cure window.",
    "Combining the edge sealer with the fast powder met both the outgassing defect target and the cure target together."
  ),
  item(
    "Trial 1 used the supplier's datasheet preheat and cure settings, showing those values did not transfer to thick routed MDF."
  ),
  item(
    "Trial 2 established that pinhole onset tracked peak substrate temperature rather than dwell time.",
    "With that powder the bake window was close to zero across every dwell time tried."
  ),
  item(
    "The production pilot confirmed the shaker profile met the edge coverage target at line speed.",
    "The deep cove profile still fell short of edge coverage on a portion of the pilot panels."
  ),
  item(
    "The project goal of fully curing powder below the outgassing onset was met with a faster-catalysed powder reaching cure at 120 C.",
    "That powder gave an 8 C wide cure window, matching the target width needed for a real production oven."
  ),
];
const LINE_246 = [
  "Separating conductivity from heat, and cure from heat, resolved the central conflict at the outset: both mechanisms previously required heat, and heat drove outgassing defects. Trial 1 confirmed the supplier's datasheet preheat and cure settings did not transfer to 25 mm routed MDF. Trial 2 showed outgassing defects on this board begin at a panel surface temperature of about 118 to 122 C regardless of dwell time, leaving a cure window close to zero with the standard powder. Peak panel surface temperature, not dwell time, was established as the controlling variable for outgassing defects on this substrate.",
  "The conductive edge sealer tested in Trial 3 gave a way to reach edge coverage without preheat-driven heat, cutting preheat by 25 C while improving edge conductivity and film build. Trial 4 addressed cure separately: the fast-catalysed powder reached full cure at a panel surface temperature of 120 C within an 8 C wide cure window, matching the target width for production oven control. The middle catalyst level gave better flow but only a 4 C window and was not used. Combining the sealer with the fast-catalysed powder met both the outgassing defect target and the cure target together, at the cost of orange peel below the visual target.",
  "The production pilot confirmed these results at line speed: the shaker profile met the edge coverage target, while the deep cove profile fell short on a portion of its panels, tied to the Faraday cage effect of the concave geometry on electrostatic deposition. The sealer type, gun angle, or geometry change needed to resolve deep cove edge coverage remains unresolved and is carried into the next fiscal year.",
].join("\n\n");

describe("a shortening pass for the writer's cap keeps every signed-off item (review re-check P2-b)", () => {
  it("keeps a rephrase of run 2026-10-04's Line 242 that meets the writer's 260-word cap", () => {
    expect(sectionMetrics(LINE_242, "s242").words).toBe(323);
    expect(sectionMetrics(REPHRASED_242, "s242").words).toBeLessThanOrEqual(260);
    // "fully" goes from the central-conflict sentence, the item says "fully cure".
    expect(REPHRASED_242).not.toContain("fully");
    expect(coverItemLoss(LINE_242, REPHRASED_242, ITEMS_242)).toBeNull();
  });

  it("holds a pass that deletes the sentence stating an item", () => {
    const withoutCure = LINE_242.replace(` ${P3B_242}`, "");
    expect(coverItemLoss(LINE_242, withoutCure, ITEMS_242)).toMatch(/^dropped words of a signed-off item \(/);
  });

  it("holds a pass that deletes Line 244's Trial 1 paragraph, though its words are elsewhere in the Line", () => {
    const withoutTrial1 = [HYPOTHESIS_244, TRIAL_2_244, LATER_244].join("\n\n");
    for (const word of ["supplier", "preheat", "routed", "panel", "cure"]) expect(withoutTrial1).toContain(word);
    expect(coverItemLoss(LINE_244, withoutTrial1, ITEMS_244)).toMatch(/^dropped words of a signed-off item \(/);
  });

  it("keeps small rewordings in Line 246: an unrelated word gone, a sentence opened another way", () => {
    const reworded = LINE_246
      .replace("The sealer type, gun angle, or geometry change needed to resolve", "The sealer type, gun angle, or geometry change to resolve")
      .replace("Trial 2 showed outgassing defects on this board begin", "In Trial 2, outgassing defects on this board began");
    expect(reworded).not.toBe(LINE_246);
    expect(coverItemLoss(LINE_246, reworded, ITEMS_246)).toBeNull();
  });
});
