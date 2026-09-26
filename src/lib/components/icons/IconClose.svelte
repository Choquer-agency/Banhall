<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Close / remove. Geometry copied from the Paper round 2 boards
   * (C3, C5, D2, E1-E6, F1, G1-G3, H1, H2, I1, I1b); see README.md for where each size and stroke is used.
   */
  let { size = 14, strokeWidth = 1.8, class: className = undefined, ...rest }: IconProps = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  aria-hidden="true"
  focusable="false"
  class={className}
  {...rest}
>
  <path d="M18 6 6 18M6 6l12 12" />
</svg>
