<script lang="ts">
  import type { SVGAttributes } from "svelte/elements";
  import {
    LOGO_MARK_COLORS,
    LOGO_MARK_RING,
    LOGO_MARK_TRIANGLE,
    LOGO_MARK_VIEWBOX,
    logoMarkRingColor,
    type LogoMarkTone,
  } from "./logoMark";

  /**
   * The square Banhall mark (decision 62): the logo's "a" ring with its teal
   * triangle. Use it where only a square fits (the favicon); keep
   * `BanhallLogo` or `BanhallRailMark` wherever the wordmark has room. Fir ring
   * on light backgrounds, white on dark. An empty `label` makes it decorative.
   */
  let {
    size = 28,
    tone = "dark",
    label = "Banhall",
    class: className = "",
    ...rest
  }: {
    size?: number;
    tone?: LogoMarkTone;
    label?: string;
    class?: string;
  } & Omit<SVGAttributes<SVGSVGElement>, "width" | "height" | "viewBox"> = $props();
</script>

<svg
  {...rest}
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  data-board-icon
  style:--icon-size={size}
  viewBox={`0 0 ${LOGO_MARK_VIEWBOX} ${LOGO_MARK_VIEWBOX}`}
  role={label ? "img" : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : "true"}
  data-logo-mark={tone}
  class={`shrink-0 ${className}`}
>
  <circle
    cx={LOGO_MARK_RING.cx}
    cy={LOGO_MARK_RING.cy}
    r={LOGO_MARK_RING.r}
    fill="none"
    stroke={logoMarkRingColor(tone)}
    stroke-width={LOGO_MARK_RING.strokeWidth}
  />
  <path d={LOGO_MARK_TRIANGLE} fill={LOGO_MARK_COLORS.teal} />
</svg>
