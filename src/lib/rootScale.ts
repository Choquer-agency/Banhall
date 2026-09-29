/**
 * Board pixels and the scaling root (docs/design-system.md, "Sizes scale
 * with the root"). The boards are drawn at a 16px root. layout.css keeps
 * 16px on phones and tablets, sets 15px on a laptop window from 1280px up
 * to 1440px wide, rises to 16px at 1600px and grows to 20px at 2560px
 * (rootFontSize mirrors it). Sizes held in script as board pixels
 * (resizable pane widths, avatar sizes, card widths) render through
 * `boardRem` so they scale with the classes around them, and pointer or
 * window measurements convert back with `rootScale`.
 */

export const BOARD_PX_PER_REM = 16;

/** A board pixel length as a rem length: 304 becomes "19rem". */
export function boardRem(px: number): string {
  return `${px / BOARD_PX_PER_REM}rem`;
}

/** Screen pixels per board pixel: 0.9375 on a laptop up to 1440px wide, 1
 * at 1600px, 1.25 at 2560px, and 1 on phones and tablets. */
export function rootScale(): number {
  if (typeof document === "undefined") return 1;
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size / BOARD_PX_PER_REM : 1;
}

/** Where the laptop reduction starts: the full rail's breakpoint (xl).
 * From 1024px the shell shows the tablet's icons-only rail. */
export const LAPTOP_MIN_WIDTH = 1280;

/**
 * The root font size layout.css gives a window of this width, at the 16px
 * browser default: 16 below 1280px or on a touch screen, 15 from 1280 to
 * 1440 with a mouse or trackpad, then 1px per 160px to 16 at 1600, then 1px
 * per 240px to 20 at 2560 and wider.
 */
export function rootFontSize(width: number, finePointer = true): number {
  if (width >= 1600) return Math.min(20, 16 + (width - 1600) / 240);
  if (width < LAPTOP_MIN_WIDTH || !finePointer) return 16;
  return Math.max(15, Math.min(16, 15 + (width - 1440) / 160));
}
