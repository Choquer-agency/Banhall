<script lang="ts">
  import type { Snippet } from "svelte";

  /** Sub-menu action showing an icon with its label beside it. */
  let {
    icon,
    label,
    title,
    onclick,
    href,
    disabled,
  }: {
    icon: Snippet;
    label: string;
    title?: string;
    onclick?: () => void;
    href?: string;
    disabled?: boolean;
  } = $props();

  const className =
    "flex h-9 items-center gap-1.5 px-3 text-xs font-medium text-navy transition-colors hover:text-primary disabled:opacity-50";
</script>

{#snippet inner()}
  <span class="flex h-4 w-4 flex-shrink-0 items-center justify-center">
    {@render icon()}
  </span>
  <span class="whitespace-nowrap">{label}</span>
{/snippet}

{#if href}
  <a {href} title={title ?? label} class={className}>
    {@render inner()}
  </a>
{:else}
  <button type="button" title={title ?? label} {onclick} {disabled} class={className}>
    {@render inner()}
  </button>
{/if}
