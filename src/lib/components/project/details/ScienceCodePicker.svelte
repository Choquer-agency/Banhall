<!--
  Science code picker (ui-design-final.md section 8, board 5.1y A3): a
  searchable list grouped by field, the code in muted mono before the name, a
  check on the current code. Group headers show the field name only. The
  list itself is ScienceCodeList, mounted each time the popover opens.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Popover } from "bits-ui";
  import ScienceCodeList from "./ScienceCodeList.svelte";

  let {
    value,
    open = $bindable(false),
    trigger,
    onSelect,
    onSuggest,
    clearLabel = undefined,
  }: {
    value: string | null;
    open?: boolean;
    /** The fact row value; spread `props` onto a button. */
    trigger: Snippet<[{ props: Record<string, unknown> }]>;
    onSelect: (code: string | null) => void | Promise<void>;
    /** Optional AI suggestion; the host saves the suggested code. */
    onSuggest?: () => void | Promise<void>;
    /** Always offer Clear, with this label (bulk edit: clear on every project). */
    clearLabel?: string;
  } = $props();

  function choose(code: string | null) {
    open = false;
    void onSelect(code);
  }
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
      align="end"
      sideOffset={4}
      collisionPadding={12}
      class="z-[120] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-popover outline-none"
    >
      <ScienceCodeList
        {value}
        {clearLabel}
        onSelect={choose}
        onSuggest={onSuggest
          ? () => {
              open = false;
              void onSuggest?.();
            }
          : undefined}
      />
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
