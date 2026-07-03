<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  /** Action slot for the composer (attach / send buttons) — an items-end
   * cluster so round buttons sit on the composer baseline. */
  let {
    class: className,
    children,
  }: { class?: string; children?: Snippet } = $props();
</script>

<div class={cn("flex items-end gap-1", className)}>
  {@render children?.()}
</div>
