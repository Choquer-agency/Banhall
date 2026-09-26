<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Open the navigation drawer (three lines). Not drawn on the boards: the
   * drawer button only shows below 1024px, which the round 2 boards do not
   * cover, so it is drawn in the rail's line style (24 grid, round caps).
   */
  let { size = 20, strokeWidth = 1.5, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M4 6h16 M4 12h16 M4 18h16" />
</svg>
