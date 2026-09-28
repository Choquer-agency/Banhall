import { describe, expect, test } from "vitest";
// Plain-JS codemod module: JSDoc-typed, so it checks like any other import.
import {
  convertClassTokens,
  convertCss,
  pxToRem,
  transformSource,
} from "../scripts/px-to-rem.mjs";

// Sizes are rem so the whole UI follows the root font size, which grows
// above 1600px wide (docs/design-system.md, "Sizes scale with the root").
// Hairlines, borders, outlines, rings and shadows stay px.

describe("px-to-rem codemod", () => {
  test("converts at 16px per rem and keeps hairlines, zero and pill radii", () => {
    expect(pxToRem(13)).toBe("0.8125rem");
    expect(pxToRem(-3)).toBe("-0.1875rem");
    expect(pxToRem(1.5)).toBe("0.09375rem");
    expect(pxToRem(1)).toBeNull();
    expect(pxToRem(0.5)).toBeNull();
    expect(pxToRem(0)).toBeNull();
    expect(pxToRem(9999)).toBeNull();
    expect(pxToRem(1100)).toBe("68.75rem");
  });

  test("rewrites size utilities and leaves lines, shadows and conditions alone", () => {
    const before = [
      "text-[13px] leading-[18px] hover:w-[136px] -left-[3px] text-[13px]/[18px]",
      "grid-cols-[104px_minmax(0,1fr)] max-h-[min(760px,calc(100dvh-2rem))]",
      "[&>svg]:size-[14px] -translate-y-[calc(50%+3px)] h-[1px] w-[0.5px]",
      "border-[1.5px] data-[state=checked]:border-[2px] outline-offset-[3px] ring-[3px]",
      "shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-[880px]:flex [@media(min-height:640px)]:mt-2",
    ].join(" ");
    expect(convertClassTokens(before)).toBe(
      [
        "text-[0.8125rem] leading-[1.125rem] hover:w-[8.5rem] -left-[0.1875rem] text-[0.8125rem]/[1.125rem]",
        "grid-cols-[6.5rem_minmax(0,1fr)] max-h-[min(47.5rem,calc(100dvh-2rem))]",
        "[&>svg]:size-[0.875rem] -translate-y-[calc(50%+0.1875rem)] h-[1px] w-[0.5px]",
        "border-[1.5px] data-[state=checked]:border-[2px] outline-offset-[3px] ring-[3px]",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04)] min-[880px]:flex [@media(min-height:640px)]:mt-2",
      ].join(" ")
    );
  });

  test("rewrites size declarations only, outside media conditions and comments", () => {
    const css = [
      ".a { padding: 2px 8px; border: 2px solid red; border-radius: 9999px; font-size: 13px; }",
      "@media (min-width: 601px) { .b { max-width: min(560px, calc(100vw - 32px)); } }",
      "/* width: 12px; */",
      ".c:hover { --rail: var(--x, 275px); --shadow-x: 0 2px 4px; transform: translateY(4px); }",
      ".d { box-shadow: inset 0 0 0 1.5px red; margin-inline: -8px; line-height: 1px; }",
    ].join("\n");
    expect(convertCss(css)).toBe(
      [
        ".a { padding: 0.125rem 0.5rem; border: 2px solid red; border-radius: 9999px; font-size: 0.8125rem; }",
        "@media (min-width: 601px) { .b { max-width: min(35rem, calc(100vw - 2rem)); } }",
        "/* width: 12px; */",
        ".c:hover { --rail: var(--x, 17.1875rem); --shadow-x: 0 2px 4px; transform: translateY(4px); }",
        ".d { box-shadow: inset 0 0 0 1.5px red; margin-inline: -0.5rem; line-height: 1px; }",
      ].join("\n")
    );
  });

  test("rewrites static Svelte style attributes but never runtime expressions", () => {
    const source = [
      '<div style="left: calc(680px + 2rem); width: 256px; box-shadow: 0 0 2px red" style:height="12px"></div>',
      "<div style={`width:${w}px;height:40px`}></div>",
      "<canvas width=\"300\" height=\"150\"></canvas>",
    ].join("\n");
    expect(transformSource(source, "x.svelte")).toBe(
      [
        '<div style="left: calc(42.5rem + 2rem); width: 16rem; box-shadow: 0 0 2px red" style:height="0.75rem"></div>',
        "<div style={`width:${w}px;height:40px`}></div>",
        "<canvas width=\"300\" height=\"150\"></canvas>",
      ].join("\n")
    );
  });

  test("is idempotent", () => {
    const source = '<p class="text-[13px] leading-[18px]" style="width: 136px"></p><style>.x { gap: 10px; }</style>';
    const once = transformSource(source, "x.svelte");
    expect(transformSource(once, "x.svelte")).toBe(once);
  });
});

