<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Table / list view (14 grid). Geometry copied from the Paper round 2 boards
   * (A1-A5, B1, B2, D1-D3, D5, J7); see README.md for where each size and stroke is used.
   */
  let { size = 14, strokeWidth = 1.3, class: className = undefined, ...rest }: IconProps = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 14 14"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  aria-hidden="true"
  focusable="false"
  class={className}
  {...rest}
>
  <rect x="1.5" y="1.5" width="11" height="11" rx="2" />
  <path d="M1.5 5.5h11M5.5 5.5v7" />
</svg>
