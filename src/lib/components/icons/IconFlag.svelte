<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Flag an issue. Not drawn on the boards: "Flag an issue" joined the D1
   * account menu by decision 53, so it is drawn in the menu's line style
   * (24 grid, 15 / 1.5, round caps) to sit beside Account and Sign out.
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
  <path d="M5 21V4 M5 4h12.5l-2.5 4.5 2.5 4.5H5" />
</svg>
