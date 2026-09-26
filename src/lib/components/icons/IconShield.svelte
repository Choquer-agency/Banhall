<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Admin. Geometry copied from the Paper round 2 boards
   * (A2, A3, A5, B1-B3, C1, C3-C5, D1, D2, D4, D5, I1, I1b, I2-I5); see README.md for where each size and stroke is used.
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
  <path d="M12 3 5 6v5.5c0 4.3 3 7.7 7 9.5 4-1.8 7-5.2 7-9.5V6Z" />
</svg>
