<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  /**
   * Hover-revealed action row for a message (copy, retry, …). Fades in when
   * the pointer is over the message or an action has focus — the wrapping
   * <Message> must carry `class="group"` for the hover reveal to work.
   * Consumers supply small ghost icon buttons as children.
   */
  interface Props {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children }: Props = $props();
</script>

<div
  class={cn(
    "-ml-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 has-focus-visible:opacity-100 motion-reduce:transition-none",
    className
  )}
>
  {@render children?.()}
</div>