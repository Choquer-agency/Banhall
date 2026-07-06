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
    children,
  }: {
    text: string;
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
        {text}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
