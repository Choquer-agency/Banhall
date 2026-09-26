<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Continue / start. Geometry copied from the Paper round 2 boards
   * (E1-E3, E5, E6, F1, G1, G2); see README.md for where each size and stroke is used.
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
  <path d="M4.5 12h15 M13.5 6l6 6-6 6" />
</svg>
