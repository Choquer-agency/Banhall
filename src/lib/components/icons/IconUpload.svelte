<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Upload files. Geometry copied from the Paper round 2 boards
   * (E1-E3, E6, F1, G1, G2); see README.md for where each size and stroke is used.
   */
  let { size = 16, strokeWidth = 1.6, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M12 15.5V4.5 M7.5 9 12 4.5 16.5 9 M4.5 15v4a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4" />
</svg>
