import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { boardRem, rootFontSize, rootScale } from "./rootScale";

// docs/design-system.md, "Sizes scale with the root": 16px on phones and
// tablets, 15.75px on a laptop up to 1440px wide, 16.8px at 1600, 21px at
// 2560 (owner, 2026-11-05: 5% larger than 15, 16 and 20).
describe("root scale", () => {
  test("keeps phones and tablets at the 16px default", () => {
    // Phones, and tablets up to the full rail's 1280px breakpoint.
    for (const width of [320, 390, 768, 1024, 1279]) expect(rootFontSize(width)).toBe(16);
    // A touch screen keeps 16px at laptop widths too.
    for (const width of [1280, 1366, 1440, 1520]) expect(rootFontSize(width, false)).toBe(16);
  });

  test("is 15.75px on a laptop window from 1280 to 1440 and rises to 16.8px at 1600", () => {
    for (const width of [1280, 1366, 1440]) expect(rootFontSize(width)).toBe(15.75);
    expect(rootFontSize(1512)).toBeCloseTo(16.2225, 4);
    expect(rootFontSize(1520)).toBeCloseTo(16.275, 4);
    expect(rootFontSize(1600)).toBeCloseTo(16.8, 6);
  });

  test("grows to 21px at 2560 and stops", () => {
    expect(rootFontSize(1920)).toBeCloseTo(18.2, 6);
    expect(rootFontSize(2560)).toBeCloseTo(21, 6);
    expect(rootFontSize(3840)).toBe(21);
    // Above 1600 the pointer does not matter.
    expect(rootFontSize(1920, false)).toBeCloseTo(18.2, 6);
  });

  test("layout.css carries the same breakpoints and slopes", () => {
    const css = readFileSync(fileURLToPath(new URL("../routes/layout.css", import.meta.url)), "utf8");
    const rule = css.slice(css.indexOf("html {"), css.indexOf("svg[data-board-icon]"));
    expect(rule).toContain("font-size: 100%;");
    expect(rule).toContain("@media (min-width: 1280px) and (pointer: fine)");
    expect(rule).toContain("clamp(98.4375%, calc(98.4375% + (100vw - 1440px) * 0.0065625), 105%)");
    expect(rule).toContain("@media (min-width: 1600px)");
    expect(rule).toContain("clamp(105%, calc(105% + (100vw - 1600px) * 0.004375), 131.25%)");
  });

  test("board pixels render as rem and the scale falls back to 1 without a document", () => {
    expect(boardRem(304)).toBe("19rem");
    expect(rootScale()).toBe(1);
  });
});
