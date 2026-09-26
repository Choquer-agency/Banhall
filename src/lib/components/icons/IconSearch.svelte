<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Search. Geometry copied from the Paper round 2 boards
   * (A4, A5, H1, H3); see README.md for where each size and stroke is used.
   */
  let { size = 17, strokeWidth = 1.5, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z M20 20l-4-4" />
</svg>
