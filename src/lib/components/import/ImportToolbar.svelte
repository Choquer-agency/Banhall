<!--
  The one row above the Import sheet (board ao5, Paper Files 1), in the
  drawing's order: "Find a file or company" (192px: the drawing's 176px
  cuts the placeholder short in Geist, the app's font), the "To check N" chip
  (a bits-ui checkbox drawn as a chip; review tab only), then on the right
  the legend for the AI mark and, 16px after it, "Select" (To review and
  Deleted; off while a search is showing). Approve (2026-11-17) is on each
  company ("Approve N ready") and in the selection bar, not here. The right-hand group wraps to its own line before
  the field would shrink. Nothing else sits above the sheet (owner rule).

  "New N" (2026-11-12, Paper Files 2 and 3) sits 8px after "To check", on
  To review while at least one file is New, and works like it: one filter
  at a time, so turning one on turns the other off. A chip that is on is
  the primary wash with fir words and its count in primary (Files 2).
-->
<script lang="ts">
  import { Checkbox } from "bits-ui";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { IconClose, IconSearch } from "$lib/components/icons";
  import { formatCount } from "./importFormat";

  let {
    search = $bindable(""),
    onlyToCheck = $bindable(false),
    onlyNew = $bindable(false),
    toCheckCount = null,
    newCount = 0,
    showToCheck = true,
    showSelect = false,
    selectOn = false,
    selectDisabled = false,
    onSelectChange,
  }: {
    search?: string;
    onlyToCheck?: boolean;
    /** The New filter (2026-11-12). */
    onlyNew?: boolean;
    /** Files on the tab that need a person; null while loading. */
    toCheckCount?: number | null;
    /** New files on To review; the chip shows only when there is one. */
    newCount?: number;
    showToCheck?: boolean;
    /** The Select toggle (on Approved since 2026-11-17, for Send back to review). */
    showSelect?: boolean;
    selectOn?: boolean;
    /** While a search is showing, selection is off. */
    selectDisabled?: boolean;
    onSelectChange?: (on: boolean) => void;
  } = $props();

  let input: HTMLInputElement | null = $state(null);

  /** The clear control goes away with the text, so focus goes back to the field. */
  function clear() {
    search = "";
    input?.focus();
  }
</script>

{#snippet filterChip(chip: {
  label: string;
  count: number | null;
  checked: boolean;
  attribute: string;
  onChange: (value: boolean) => void;
})}
  <!-- A bits-ui checkbox drawn as a chip (Paper Files 2). -->
  <Checkbox.Root
    bind:checked={() => chip.checked, chip.onChange}
    {...{ [chip.attribute]: "" }}
    class="group inline-flex h-8 shrink-0 items-center gap-2 rounded-lg bg-surface pr-3 pl-2.5 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir data-[state=checked]:bg-primary-wash data-[state=checked]:font-medium data-[state=checked]:text-fir data-[state=checked]:shadow-[inset_0_0_0_1px_var(--color-primary-line)] motion-reduce:transition-none pointer-coarse:h-11"
  >
    {#snippet children({ checked })}
      <span
        aria-hidden="true"
        class={`flex size-3.5 shrink-0 items-center justify-center rounded-[0.25rem] border-[1.5px] transition-colors motion-reduce:transition-none ${
          checked ? "border-primary-selected bg-primary-selected text-white" : "border-gray-300 bg-surface"
        }`}
      >
        {#if checked}
          <svg class="size-[62.5%]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5L20 7" />
          </svg>
        {/if}
      </span>
      <span>{chip.label}</span>
      {#if chip.count !== null}
        <span
          data-import-filter-count
          class={`text-xs leading-[calc(4/3)] font-normal tabular-nums ${checked ? "text-primary-selected" : "text-ink-muted"}`}
        >{formatCount(chip.count)}</span>
      {/if}
    {/snippet}
  </Checkbox.Root>
{/snippet}

<div data-import-toolbar class="flex flex-wrap items-center gap-2">
  <!-- 192px; the clear button takes room only while there is text to clear. -->
  <div role="search" class="relative w-[12rem] shrink-0">
    <IconSearch size={13} strokeWidth={1.8} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-muted" />
    <input
      bind:this={input}
      bind:value={search}
      type="search"
      aria-label="Find a file or company"
      placeholder="Find a file or company"
      autocomplete="off"
      spellcheck="false"
      data-import-search
      onkeydown={(event) => {
        if (event.key === "Escape" && search) {
          event.stopPropagation();
          search = "";
        }
      }}
      class={`field-control h-8 w-full rounded-lg pl-[1.9375rem] text-[0.8125rem] leading-[calc(18/13)] text-ink placeholder:text-ink-faint pointer-coarse:h-11 [&::-webkit-search-cancel-button]:appearance-none ${search ? "pr-7" : "pr-2.5"}`}
    />
    {#if search}
      <button
        type="button"
        aria-label="Clear the search"
        data-import-search-clear
        onclick={clear}
        class="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
      >
        <IconClose size={12} strokeWidth={1.8} />
      </button>
    {/if}
  </div>

  {#if showToCheck}
    {@render filterChip({
      label: "To check",
      count: toCheckCount,
      checked: onlyToCheck,
      attribute: "data-import-to-check",
      onChange: (value) => {
        onlyToCheck = value;
        if (value) onlyNew = false;
      },
    })}
    {#if newCount > 0}
      {@render filterChip({
        label: "New",
        count: newCount,
        checked: onlyNew,
        attribute: "data-import-new-filter",
        onChange: (value) => {
          onlyNew = value;
          if (value) onlyToCheck = false;
        },
      })}
    {/if}
  {/if}

  <!-- 24px between the legend and Select, 8px between the buttons after it (Paper Files 1). -->
  <div data-import-toolbar-end class="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-2">
    <div data-import-legend class="mr-4 flex shrink-0 items-center gap-1.5 text-xs leading-[calc(4/3)] text-ink-muted">
      <AuroraMark size={14} />
      <span>Filled in by AI</span>
      <span class="mx-1.5 h-3 w-px shrink-0 bg-line" aria-hidden="true"></span>
      <span>No mark: from the file name or a person</span>
    </div>
    {#if showSelect}
      <button
        type="button"
        aria-pressed={selectOn && !selectDisabled}
        disabled={selectDisabled}
        data-import-select-toggle
        onclick={() => onSelectChange?.(!selectOn)}
        class={`inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-[0.8125rem] leading-[calc(18/13)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11 ${
          selectOn && !selectDisabled
            ? "bg-primary-wash font-medium text-fir shadow-[inset_0_0_0_1px_var(--color-primary-line)]"
            : "bg-surface text-ink-secondary shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-gray-50"
        }`}
      >Select</button>
    {/if}
  </div>
</div>
