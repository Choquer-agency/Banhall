import { rootScale } from "$lib/rootScale";

/**
 * Board lengths as they render (docs/design-system.md, "Sizes scale with
 * the root"). The boards are drawn at a 16px root; a laptop window of 1280
 * to 1440 renders them at 15px per rem, so a 44px board row is 41.25px
 * there, and a 2560 window at 20px. Component tests assert board sizes
 * through these so they hold at every window width.
 */
export function board(px: number): number {
  return px * rootScale();
}

/**
 * A number as Chromium writes it in a computed style: 6 significant digits,
 * an exact tie going to the even digit, so 21.65625 reads "21.6562" and
 * 33.46875 "33.4688". At a 15.75px root many board lengths carry more
 * digits than that. A value Chromium derives through float maths (a line
 * height from a unitless ratio, say) can land just off the tie; compare
 * those as numbers.
 */
export function cssNumber(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const scale = 10 ** (5 - Math.floor(Math.log10(Math.abs(value))));
  const scaled = value * scale;
  const floor = Math.floor(scaled);
  const rounded = scaled - floor === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  return rounded / scale;
}

/** A board length as it reads in a computed style: board(44) as "41.25px". */
export function boardCss(px: number): number {
  return cssNumber(board(px));
}

/** A board length as a computed style value: board(44) as "41.25px". */
export function boardPx(px: number): string {
  return `${boardCss(px)}px`;
}
