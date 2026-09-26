<script lang="ts">
  import { Tooltip } from "bits-ui";
  import type { Snippet } from "svelte";

  /**
   * Small bits-ui Tooltip wrapper — a styled replacement for native `title=`
   * attributes. Renders no trigger element of its own: the `children` snippet
   * receives the tooltip trigger `props`, which the caller spreads onto its own
   * element/component (avoids nested buttons).
   *
   * Usage:
   *   <Tooltip text="Delete">
   *     {#snippet children({ props })}
   *       <button {...props}>…</button>
   *     {/snippet}
   *   </Tooltip>
   */
  let {
    text,
    side = "top",
    delayDuration = 700,
    hint = null,
    children,
  }: {
    text: string;
    /** Keyboard hint shown after the text in a quieter tone ("⌘K"). */
    hint?: string | null;
    side?: "top" | "right" | "bottom" | "left";
    /** ms before the tooltip opens — default mirrors native `title` timing */
    delayDuration?: number;
    children: Snippet<[{ props: Record<string, unknown> }]>;
  } = $props();
</script>

<Tooltip.Provider {delayDuration}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        {@render children({ props })}
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        {side}
        sideOffset={6}
        class="z-[110] select-none rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow-md"
      >
        {text}{#if hint}<span data-tooltip-hint class="ml-2 text-gray-300">{hint}</span>{/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
