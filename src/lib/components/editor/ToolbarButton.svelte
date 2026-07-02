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
  class={`flex h-7 w-7 items-center justify-center rounded text-xs transition-colors ${
    active
      ? "bg-navy text-white"
      : "text-gray-600 hover:bg-primary-wash hover:text-gray-900"
  }`}
>
  {@render children()}
</button>
