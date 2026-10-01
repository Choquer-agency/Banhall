/**
 * The Banhall mark (decision 62): the ring and teal triangle of the logo's
 * lowercase "a", traced from static/banhall-logo-dark.png on a 48 grid. The
 * brand colours are sampled from the same PNG and live here only; the
 * favicon (src/lib/assets/favicon.svg) is `logoMarkSvg()` written to disk, and
 * a unit test keeps the two identical.
 */

export const LOGO_MARK_COLORS = {
  /** Ring on light backgrounds (the dark logo's wordmark). */
  fir: "#0A3A38",
  /** Ring on dark backgrounds (the white logo's wordmark). */
  white: "#FFFFFF",
  /** Triangle in both logos. */
  teal: "#008186",
} as const;

export type LogoMarkTone = "dark" | "white";

export const LOGO_MARK_VIEWBOX = 48;

/** The ring: 46 across outside, 7.5 thick, like the logo's "a" (43 x 48, 7 to 8 thick). */
export const LOGO_MARK_RING = { cx: 24, cy: 24, r: 19.25, strokeWidth: 7.5 } as const;

/** The triangle: 17 wide, 14.5 tall, centred on the ring as in the logo. */
export const LOGO_MARK_TRIANGLE = "M24 17.5 32.5 32h-17Z";

export function logoMarkRingColor(tone: LogoMarkTone): string {
  return tone === "white" ? LOGO_MARK_COLORS.white : LOGO_MARK_COLORS.fir;
}

/**
 * Standalone SVG for the favicon: fir ring in a light browser theme, white in
 * a dark one, so the mark stays visible on either tab strip.
 */
export function logoMarkSvg(): string {
  const { cx, cy, r, strokeWidth } = LOGO_MARK_RING;
  const size = LOGO_MARK_VIEWBOX;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<title>Banhall</title>`,
    `<style>.ring{stroke:${LOGO_MARK_COLORS.fir}}@media (prefers-color-scheme: dark){.ring{stroke:${LOGO_MARK_COLORS.white}}}</style>`,
    `<circle class="ring" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${strokeWidth}"/>`,
    `<path d="${LOGO_MARK_TRIANGLE}" fill="${LOGO_MARK_COLORS.teal}"/>`,
    `</svg>`,
    "",
  ].join("\n");
}
