<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Notes / house rules / written text. Geometry copied from the Paper round 2 boards
   * (A5, C4, E2); see README.md for where each size and stroke is used.
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
  <path d="M5 4.5h10.5a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z M5 17.5a3 3 0 0 1 3-3h10.5" />
</svg>
