<script lang="ts">
  /**
   * The one white card of the page frame (owner, 2026-10-28; Paper S9, S11,
   * A1): from 1024px it sits beside the rail with radius 12, a 1px line
   * border and clipped corners; below that it runs full bleed under the
   * page's own bar. It holds an optional section sidebar and the page.
   * `data-work-panel` is the View as frame's hook.
   */
  import type { Snippet } from "svelte";

  let {
    sidebar = undefined,
    children,
    class: className = "",
    ...rest
  }: {
    sidebar?: Snippet;
    children: Snippet;
    class?: string;
    [key: `data-${string}`]: string | boolean | undefined;
  } = $props();
</script>

<div
  {...rest}
  data-frame-card
  data-work-panel
  class={`relative flex min-h-0 min-w-0 overflow-hidden bg-surface lg:rounded-xl lg:border lg:border-line ${className}`}
>
  {@render sidebar?.()}
  <div data-frame-main class="flex min-h-0 min-w-0 flex-1 flex-col">
    {@render children()}
  </div>
</div>
