<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * No access dash. Geometry copied from the Paper round 2 boards
   * (D2); see README.md for where each size and stroke is used.
   */
  let { size = 11, strokeWidth = 2.4, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M6 12h12" />
</svg>
