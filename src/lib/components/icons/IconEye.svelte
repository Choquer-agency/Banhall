<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Preview / show / view as. Geometry copied from the Paper round 2 boards
   * (D1, D3, D4, E1-E6, F1, G1-G3, H1, H2, J1-J5, J8, J9); see README.md for where each size and stroke is used.
   */
  let { size = 15, strokeWidth = 1.6, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
</svg>
