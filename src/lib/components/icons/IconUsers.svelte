<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Team. Geometry copied from the Paper round 2 boards
   * (A2, A3, A5, B1-B3, C1-C5, D1, D2, D5, I1, I1b, I2-I5); see README.md for where each size and stroke is used.
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
  <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2 21a7 7 0 0 1 14 0 M16 3.5a4 4 0 0 1 0 7 M18 14a7 7 0 0 1 4 7" />
</svg>
