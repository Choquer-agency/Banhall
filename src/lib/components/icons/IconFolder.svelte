<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Projects. Geometry copied from the Paper round 2 boards
   * (A1-A5, B1-B3, C1-C5, D1-D5, E1-E6, F1-F5, G1-G3, H1, H3, I1, I1b, I2-I5, J7); see README.md for where each size and stroke is used.
   */
  let { size = 15, strokeWidth = 1.5, class: className = undefined, ...rest }: IconProps = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  class={className}
  {...rest}
>
  <path d="M3 6h6l2 2h10v12H3Z" />
</svg>
