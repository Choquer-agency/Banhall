/**
 * Board pixels and the scaling root (docs/design-system.md, "Sizes scale
 * with the root"). The boards are drawn at a 16px root; above a 1600px wide
 * window layout.css grows the root to 20px at 2560px. Sizes held in script
 * as board pixels (resizable pane widths, avatar sizes, card widths) render
 * through `boardRem` so they scale with the classes around them, and pointer
 * or window measurements convert back with `rootScale`.
 */

export const BOARD_PX_PER_REM = 16;

/** A board pixel length as a rem length: 304 becomes "19rem". */
export function boardRem(px: number): string {
  return `${px / BOARD_PX_PER_REM}rem`;
}

/** Screen pixels per board pixel: 1 up to 1600px wide, 1.25 at 2560px. */
export function rootScale(): number {
  if (typeof document === "undefined") return 1;
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size / BOARD_PX_PER_REM : 1;
}
