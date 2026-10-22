import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { listSourceFiles } from "../scripts/px-to-rem.mjs";

// Owner, 2026-10-21: every line height is a unitless ratio of its font size
// (leading-[1.5], line-height: 1.5), never a fixed length, so text keeps its
// proportions at any size. The value is the line divided by the font size it
// sits with; when that does not end, the exact fraction: 18px on 13px text is
// leading-[calc(18/13)].
const FIXED_LEADING = /(?<![\w[-])(?:[a-z0-9-]+:)*!?leading-(?:\[[0-9.]+(?:rem|px|em)\]|[0-9]+(?:\.[0-9]+)?)(?![\w.\]-])/g;
const FIXED_LINE_HEIGHT = /line-height:\s*[0-9.]+(?:rem|px|em)\b/g;

export function fixedLineHeights(text: string): string[] {
  return [...(text.match(FIXED_LEADING) ?? []), ...(text.match(FIXED_LINE_HEIGHT) ?? [])];
}

describe("unitless line heights", () => {
  test("recognises fixed line heights and leaves ratios alone", () => {
    expect(fixedLineHeights('class="text-xs leading-5 sm:leading-[1.125rem] leading-[18px]"')).toEqual([
      "leading-5",
      "sm:leading-[1.125rem]",
      "leading-[18px]",
    ]);
    expect(fixedLineHeights(".a { line-height: 1.25rem; } .b { line-height: 20px; }")).toEqual([
      "line-height: 1.25rem",
      "line-height: 20px",
    ]);
    expect(
      fixedLineHeights('class="leading-[calc(18/13)] leading-[1.25] leading-none max-w-5" .c { line-height: calc(5 / 3); }')
    ).toEqual([]);
  });

  test("src/ sets no line height as a fixed length", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const offenders = listSourceFiles(src)
      .filter((file) => !/\.test\.|__screenshots__/.test(file))
      .flatMap((file) => fixedLineHeights(readFileSync(file, "utf8")).map((hit) => `${file.slice(src.length - 3)}: ${hit}`));
    expect(offenders).toEqual([]);
  });
});
