<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  interface Props {
    class?: string;
    children?: Snippet;
  }

  let { class: className, children }: Props = $props();
</script>

<div class={cn("chain-of-thought space-y-0", className)}>
  {@render children?.()}
</div>

<style>
  :global(.chain-of-thought > .chain-step:last-child > .chain-step-connector) {
    display: none;
  }
</style>
