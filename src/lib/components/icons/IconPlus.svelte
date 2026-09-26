<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Add (24 grid). Geometry copied from the Paper round 2 boards
   * (E1-E6, F1, G1-G3, H1, H2, J7); see README.md for where each size and stroke is used.
   */
  let { size = 12, strokeWidth = 2, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M12 5v14M5 12h14" />
</svg>
