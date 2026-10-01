<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  interface Props {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children }: Props = $props();
</script>
<div class={cn("text-[0.6875rem] leading-relaxed text-ink-muted", className)}>
  {@render children?.()}
</div>
