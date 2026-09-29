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

/** A board length as a computed style value: board(44) as "41.25px". */
export function boardPx(px: number): string {
  return `${board(px)}px`;
}
