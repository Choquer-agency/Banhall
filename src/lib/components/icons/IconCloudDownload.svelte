<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * OneDrive import. Geometry copied from the Paper round 2 boards
   * (A5, E2); see README.md for where each size and stroke is used.
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
  <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5 3.8 3.8 0 0 1-.3 7.5Z M12 10.5v6 M9.5 14l2.5 2.5 2.5-2.5" />
</svg>
