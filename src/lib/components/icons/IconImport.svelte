<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Import: an arrow up off a line. Geometry copied from the Paper Import
   * boards (Files 1 to 6, the Admin sidebar's Import row); see README.md
   * for where each size and stroke is used.
   */
  let { size = 16, strokeWidth = 1.8, class: className = undefined, ...rest }: IconProps = $props();
</script>

<svg
  width={size}
  height={size}
  data-board-icon
  style:--icon-size={size}
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
  <path d="M12 16V5 M7 10l5-5 5 5 M5 19h14" />
</svg>
