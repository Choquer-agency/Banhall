<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Report page (24 grid). Geometry copied from the Paper round 2 boards
   * (F2-F5); see README.md for where each size and stroke is used.
   */
  let { size = 15, strokeWidth = 1.8, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6M9 16h6" />
</svg>
