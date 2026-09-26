<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Edit. Geometry copied from the Paper round 2 boards
   * (F4); see README.md for where each size and stroke is used.
   */
  let { size = 14, strokeWidth = 1.7, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
</svg>
