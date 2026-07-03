<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";

  /**
   * Canned-prompt pill chip. Row them up with `flex flex-wrap gap-1.5`;
   * `onclick` typically seeds the composer value.
   */
  interface Props extends HTMLButtonAttributes {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children, ...rest }: Props = $props();
</script>

<button
  type="button"
  class={cn(
    "inline-flex items-center rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-primary/50 hover:bg-primary-wash hover:text-navy disabled:pointer-events-none disabled:opacity-50",
    className
  )}
  {...rest}
>
  {@render children?.()}
</button>
