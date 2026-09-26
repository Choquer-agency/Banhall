<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * More actions (horizontal dots). Geometry copied from the Paper round 2 boards
   * (C1, C3-C5, H4); see README.md for where each size and stroke is used.
   */
  let { size = 16, strokeWidth = 3, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M6 12h.01 M12 12h.01 M18 12h.01" />
</svg>
