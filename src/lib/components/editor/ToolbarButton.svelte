<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    active,
    onclick,
    title,
    children,
  }: {
    active: boolean;
    onclick: () => void;
    title: string;
    children: Snippet;
  } = $props();
</script>

<!--
  The name screen readers announce comes from aria-label; title stays as the
  mouse tooltip. On a touch screen the button grows to the 44 px floor; with a
  mouse or trackpad it keeps its 26 px board size.
-->
<button
  type="button"
  {onclick}
  {title}
  aria-label={title}
  class={`flex h-[1.625rem] w-[1.625rem] pointer-coarse:size-11 shrink-0 items-center justify-center rounded-[0.3125rem] text-xs text-ink transition-colors ${
    active ? "bg-chrome text-fir" : "hover:bg-primary-wash"
  }`}
>
  {@render children()}
</button>
