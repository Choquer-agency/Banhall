<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Info button (circle r=10). Geometry copied from the Paper round 2 boards
   * (F3-F5); see README.md for where each size and stroke is used.
   */
  let { size = 16, strokeWidth = 1.5, class: className = undefined, ...rest }: IconProps = $props();
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
  <circle cx="12" cy="12" r="10" />
  <path d="M12 16v-4M12 8h.01" />
</svg>
