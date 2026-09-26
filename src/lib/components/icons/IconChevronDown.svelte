<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Open a dropdown / expand. Geometry copied from the Paper round 2 boards
   * (A2, A3, B1, C1, C3-C5, D1-D5, E1-E6, F1, G1-G3, H1, H2, I1, I1b, I2-I5); see README.md for where each size and stroke is used.
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
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
  class={className}
  {...rest}
>
  <path d="m6 9 6 6 6-6" />
</svg>
