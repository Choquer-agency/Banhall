<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Collapse a section. Geometry copied from the Paper round 2 boards
   * (B2, B3); see README.md for where each size and stroke is used.
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
  <path d="m6 15 6-6 6 6" />
</svg>
