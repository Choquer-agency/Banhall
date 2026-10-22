import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { listSourceFiles } from "../scripts/px-to-rem.mjs";

// Owner, 2026-10-21: every line height is a unitless ratio of its font size
// (leading-[1.5], line-height: 1.5), never a fixed length, so text keeps its
// proportions at any size. The value is the line divided by the font size it
// sits with; when that does not end, the exact fraction: 18px on 13px text is
// leading-[calc(18/13)].
const LENGTH = String.raw`\[[^\]\s]*?\d(?:rem|px|em)[^\]\s]*\]`;
const SPACING_STEP = String.raw`[0-9]+(?:\.[0-9]+)?`;
const FIXED_LEADING = new RegExp(
  String.raw`(?<![\w[-])(?:[a-z0-9-]+:)*!?leading-(?:${LENGTH}|px|${SPACING_STEP})(?![\w.\]-])`,
  "g"
);
// A font size's /line-height modifier (text-sm/5, text-[0.8125rem]/[1.125rem]).
// Only a size: text-ink/50 is a colour at 50% opacity.
const FIXED_SLASH = new RegExp(
  String.raw`(?<![\w[-])(?:[a-z0-9-]+:)*!?text-(?:xs|sm|base|lg|[2-9]?xl|${LENGTH})\/(?:${LENGTH}|${SPACING_STEP})(?![\w.\]-])`,
  "g"
);
const FIXED_LINE_HEIGHT = /line-height:\s*[^;{}]*?\d(?:rem|px|em)\b/g;
const FIXED_JS_LINE_HEIGHT = /lineHeight\s*[:=]\s*["'`][0-9.]+(?:rem|px|em)\b/g;

export function fixedLineHeights(text: string): string[] {
  return [FIXED_LEADING, FIXED_SLASH, FIXED_LINE_HEIGHT, FIXED_JS_LINE_HEIGHT].flatMap((re) => text.match(re) ?? []);
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
    // Review 2026-10-21: the forms the first guard missed.
    expect(
      fixedLineHeights(
        'class="text-sm/5 text-[0.8125rem]/[1.125rem] leading-px leading-[calc(1rem+2px)] data-[state=open]:leading-5" style={{ lineHeight: "20px" }}'
      )
    ).toEqual([
      "leading-px",
      "leading-[calc(1rem+2px)]",
      "leading-5",
      "text-sm/5",
      "text-[0.8125rem]/[1.125rem]",
      'lineHeight: "20px',
    ]);
    expect(
      fixedLineHeights(
        'class="leading-[calc(18/13)] leading-[1.25] leading-none max-w-5 text-ink/50 text-sm/[1.5]" .c { line-height: calc(5 / 3); }'
      )
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
