<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Locked setting. Geometry copied from the Paper round 2 boards
   * (G3, I2); see README.md for where each size and stroke is used.
   */
  let { size = 11, strokeWidth = 2.2, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z M8 11V8a4 4 0 0 1 8 0v3" />
</svg>
