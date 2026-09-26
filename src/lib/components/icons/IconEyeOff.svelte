<script lang="ts">
  import type { IconProps } from "./types";

  /**
   * Hide password: the board eye (IconEye) with a slash. Not drawn on the
   * boards; it is the pressed state of the J1-J5, J8, J9 show-password
   * button, so it keeps the eye's size and stroke (16 / 1.6).
   */
  let { size = 16, strokeWidth = 1.6, class: className = undefined, ...rest }: IconProps = $props();
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
  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M4 4l16 16" />
</svg>
