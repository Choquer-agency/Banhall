<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Models. Geometry copied from the Paper round 2 boards
   * (A5); see README.md for where each size and stroke is used.
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
  <path d="M5 20v-6 M5 10V4 M12 20v-8 M12 8V4 M19 20v-4 M19 12V4 M3 14h4 M10 8h4 M17 16h4" />
</svg>
