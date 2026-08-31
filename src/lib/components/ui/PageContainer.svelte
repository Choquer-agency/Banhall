<!--
  Shared page container: the global rail width (--container-shell) with the
  shared responsive gutters (page-gutter page-gutter-y). Pages that need a
  narrower reading column nest their own max-w-* inside. Replaces hand-rolled
  `mx-auto w-full max-w-[var(--container-shell)] page-gutter page-gutter-y …` mains.
-->
<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    class: className = "",
    children,
  }: { class?: string; children: Snippet } = $props();
</script>

<main class={`mx-auto w-full max-w-[var(--container-shell)] flex-1 page-gutter page-gutter-y pb-8 ${className}`}>
  {@render children()}
</main>
