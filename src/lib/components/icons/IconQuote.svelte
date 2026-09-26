<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Quoted lines (not on the boards). The seed card's "Quoted lines" tool
   * beside Edit and Give feedback (F4); drawn in the card tools' line style
   * (14px, stroke 1.7). See README.md.
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
  <path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5a6 6 0 0 1-4 5.7 M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5a6 6 0 0 1-4 5.7" />
</svg>
