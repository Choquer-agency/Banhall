<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Go / open submenu. Geometry copied from the Paper round 2 boards
   * (A5, C4); see README.md for where each size and stroke is used.
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
  <path d="m9 6 6 6-6 6" />
</svg>
