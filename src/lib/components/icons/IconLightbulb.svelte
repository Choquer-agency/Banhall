<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Feature requests. Geometry copied from the Paper round 2 boards
   * (A3, A5, B1-B3, D1, D2, D5, I1, I1b, I2-I5); see README.md for where each size and stroke is used.
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
  <path d="M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
</svg>
