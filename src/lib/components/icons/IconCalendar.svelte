<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Fiscal year date. Geometry copied from the Paper round 2 boards
   * (E1-E6, F1, G1-G3, H1, H2); see README.md for where each size and stroke is used.
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
  aria-hidden="true"
  focusable="false"
  class={className}
  {...rest}
>
  <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z M4 10h16 M8 3v4 M16 3v4" />
</svg>
