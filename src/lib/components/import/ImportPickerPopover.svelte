<!--
  A picker in a popover under an Import sheet cell (board ao5): the cell's
  own control is the trigger (and its tab stop); Escape or a pick closes it
  and focus goes back to that control. The content gets `close`.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Popover } from "bits-ui";
  import { POPOVER_CARD } from "./sheetLayout";

  let {
    trigger,
    content,
    open = $bindable(false),
    align = "start",
    width = "w-[17.5rem]",
    label,
  }: {
    trigger: Snippet<[{ props: Record<string, unknown> }]>;
    content: Snippet<[{ close: () => void }]>;
    open?: boolean;
    align?: "start" | "center" | "end";
    /** The card's width, as a class. */
    width?: string;
    /** What the picker sets, for screen readers ("Writer"). */
    label: string;
  } = $props();
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      {@render trigger({ props })}
    {/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      side="bottom"
      {align}
      sideOffset={4}
      collisionPadding={12}
      aria-label={label}
      class={`${POPOVER_CARD} ${width} max-w-[calc(100vw-1.5rem)] overflow-hidden`}
    >
      {@render content({ close: () => (open = false) })}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
