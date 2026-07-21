<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  interface Props {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children }: Props = $props();
</script>

<div class={cn("grid grid-cols-[1rem_minmax(0,1fr)_1rem] gap-x-2 overflow-hidden", className)}>
  <span class="mx-auto h-full w-px bg-primary/20" aria-hidden="true"></span>
  <div class="space-y-2 pt-2 pb-1 text-ink-secondary">
    {@render children?.()}
  </div>
</div>
