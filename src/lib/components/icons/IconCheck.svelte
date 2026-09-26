<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Done / ticked. Geometry copied from the Paper round 2 boards
   * (C1, C3-C5, D2, D5, E1-E6, F1, F5, G1-G3, H1, H2, I2, I4, I5, J5, J9); see README.md for where each size and stroke is used.
   */
  let { size = 11, strokeWidth = 3.2, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M20 6 9 17l-5-5" />
</svg>
