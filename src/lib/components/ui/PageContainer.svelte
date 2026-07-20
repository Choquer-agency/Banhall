<!--
  Shared page container: the global rail width (--container-shell) with the
  standard gutters (px-6 pt-12). Pages that need a narrower reading column
  nest their own max-w-* inside. Replaces hand-rolled
  `mx-auto w-full max-w-[var(--container-shell)] px-6 pt-12 …` mains.
-->
<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    class: className = "",
    children,
  }: { class?: string; children: Snippet } = $props();
</script>

<main class={`mx-auto w-full max-w-[var(--container-shell)] flex-1 px-6 pt-12 pb-8 ${className}`}>
  {@render children()}
</main>
