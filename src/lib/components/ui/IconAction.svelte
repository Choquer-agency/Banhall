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
    "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 px-2 text-xs font-medium text-navy transition-colors hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 sm:h-9 sm:min-w-0 sm:px-3";
</script>

{#snippet inner()}
  <span class="flex h-4 w-4 flex-shrink-0 items-center justify-center">
    {@render icon()}
  </span>
  <span class="hidden whitespace-nowrap sm:inline">{label}</span>
  <span class="sr-only sm:hidden">{label}</span>
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
