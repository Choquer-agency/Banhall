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

<button
  type="button"
  {onclick}
  {title}
  class={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[5px] text-xs text-ink transition-colors ${
    active ? "bg-chrome text-fir" : "hover:bg-primary-wash"
  }`}
>
  {@render children()}
</button>
