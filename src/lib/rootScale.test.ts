import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { boardRem, rootFontSize, rootScale } from "./rootScale";

// docs/design-system.md, "Sizes scale with the root": 16px on phones and
// tablets, 15px on a laptop up to 1440px wide, 16px at 1600, 20px at 2560.
describe("root scale", () => {
  test("keeps phones and tablets at the 16px default", () => {
    // Phones, and tablets up to the full rail's 1280px breakpoint.
    for (const width of [320, 390, 768, 1024, 1279]) expect(rootFontSize(width)).toBe(16);
    // A touch screen keeps 16px at laptop widths too.
    for (const width of [1280, 1366, 1440, 1520]) expect(rootFontSize(width, false)).toBe(16);
  });

  test("is 15px on a laptop window from 1280 to 1440 and rises to 16px at 1600", () => {
    for (const width of [1280, 1366, 1440]) expect(rootFontSize(width)).toBe(15);
    expect(rootFontSize(1512)).toBeCloseTo(15.45, 2);
    expect(rootFontSize(1520)).toBe(15.5);
    expect(rootFontSize(1600)).toBe(16);
  });

  test("grows to 20px at 2560 and stops", () => {
    expect(rootFontSize(1920)).toBeCloseTo(17.333, 3);
    expect(rootFontSize(2560)).toBe(20);
    expect(rootFontSize(3840)).toBe(20);
    // Above 1600 the pointer does not matter.
    expect(rootFontSize(1920, false)).toBeCloseTo(17.333, 3);
  });

  test("layout.css carries the same breakpoints and slopes", () => {
    const css = readFileSync(fileURLToPath(new URL("../routes/layout.css", import.meta.url)), "utf8");
    const rule = css.slice(css.indexOf("html {"), css.indexOf("svg[data-board-icon]"));
    expect(rule).toContain("font-size: 100%;");
    expect(rule).toContain("@media (min-width: 1280px) and (pointer: fine)");
    expect(rule).toContain("clamp(93.75%, calc(93.75% + (100vw - 1440px) / 160), 100%)");
    expect(rule).toContain("@media (min-width: 1600px)");
    expect(rule).toContain("clamp(100%, calc(100% + (100vw - 1600px) / 240), 125%)");
  });

  test("board pixels render as rem and the scale falls back to 1 without a document", () => {
    expect(boardRem(304)).toBe("19rem");
    expect(rootScale()).toBe(1);
  });
});
