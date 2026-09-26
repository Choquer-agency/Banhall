<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Back / resend. Geometry copied from the Paper round 2 boards
   * (C4, H2, H4); see README.md for where each size and stroke is used.
   */
  let { size = 20, strokeWidth = 1.8, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M19 12H5 M11 6l-6 6 6 6" />
</svg>
