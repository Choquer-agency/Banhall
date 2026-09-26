<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Company document (14 grid). Geometry copied from the Paper round 2 boards
   * (A1-A5, B1, B2, D1-D3, D5); see README.md for where each size and stroke is used.
   */
  let { size = 14, strokeWidth = 1.2, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M3.5 1.5h5l2 2v9h-7z" />
  <path d="M5 7h4M5 9.5h4" />
</svg>
