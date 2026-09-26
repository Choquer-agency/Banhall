<script lang="ts">
  import type { PageIcon } from "$lib/components/shell/pageIcon";
  import type { Snippet } from "svelte";

  /**
   * Round 2 page icon tile (top bar, every A to D and I board): 26px square,
   * radius 6, `workspace-page-icon` fill, a 15px icon in primary. Pass a
   * Phosphor icon component, or a snippet for anything else.
   */
  let {
    icon = undefined,
    children = undefined,
    class: className = "",
  }: {
    icon?: PageIcon;
    children?: Snippet;
    class?: string;
  } = $props();
</script>

<span
  data-page-icon-tile
  aria-hidden="true"
  class={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-workspace-page-icon text-primary ${className}`}
>
  {#if icon}
    {@const Icon = icon}
    <Icon size={15} weight="regular" />
  {:else}
    {@render children?.()}
  {/if}
</span>
