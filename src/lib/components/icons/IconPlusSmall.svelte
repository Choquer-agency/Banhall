<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Add (12 grid). Geometry copied from the Paper round 2 boards
   * (A1-A5, B1-B3, C1-C5, D1-D3, D5, J7); see README.md for where each size and stroke is used.
   */
  let { size = 12, strokeWidth = 1.3, class: className = undefined, ...rest }: IconProps = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 12 12"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  aria-hidden="true"
  focusable="false"
  class={className}
  {...rest}
>
  <path d="M6 2v8M2 6h8" />
</svg>
