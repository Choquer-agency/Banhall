<!--
  The one row above the Import sheet (board ao5): "Find a file or company"
  (15rem, wide enough for its placeholder), the "To check N" chip (a bits-ui
  checkbox drawn as a chip; review tab only), and on the right the legend
  for the AI mark, which wraps to its own line before the field would
  shrink. Nothing else sits above the sheet (owner rule). Phase 3b adds the
  "Select" toggle to the left of the legend (To review and Deleted; off
  while a search is showing).
-->
<script lang="ts">
  import { Checkbox } from "bits-ui";
  import { ListChecksIcon } from "phosphor-svelte";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { IconClose, IconSearch } from "$lib/components/icons";
  import { formatCount } from "./importFormat";

  let {
    search = $bindable(""),
    onlyToCheck = $bindable(false),
    toCheckCount = null,
    showToCheck = true,
    showSelect = false,
    selectOn = false,
    selectDisabled = false,
    onSelectChange,
  }: {
    search?: string;
    onlyToCheck?: boolean;
    /** Files on the tab that need a person; null while loading. */
    toCheckCount?: number | null;
    showToCheck?: boolean;
    /** The Select toggle (not on Approved). */
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

<div data-import-toolbar class="flex flex-wrap items-center gap-2">
  <div role="search" class="relative w-[15rem] shrink-0">
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
      class="field-control h-8 w-full rounded-md pr-7 pl-[1.875rem] text-[0.8125rem] leading-[calc(18/13)] text-ink placeholder:text-ink-faint pointer-coarse:h-11 [&::-webkit-search-cancel-button]:appearance-none"
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
    <Checkbox.Root
      bind:checked={onlyToCheck}
      data-import-to-check
      class="group inline-flex h-8 shrink-0 items-center gap-2 rounded-md bg-surface px-2.5 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir data-[state=checked]:bg-primary-wash data-[state=checked]:text-ink data-[state=checked]:shadow-[inset_0_0_0_1px_var(--color-primary-line)] motion-reduce:transition-none pointer-coarse:h-11"
    >
      {#snippet children({ checked })}
        <span
          aria-hidden="true"
          class={`flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border transition-colors motion-reduce:transition-none ${
            checked ? "border-primary-selected bg-primary-selected text-white" : "border-gray-300 bg-surface"
          }`}
        >
          {#if checked}
            <svg class="size-[62.5%]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12l5 5L20 7" />
            </svg>
          {/if}
        </span>
        <span>To check</span>
        {#if toCheckCount !== null}
          <span data-import-to-check-count class="text-ink-muted tabular-nums">{formatCount(toCheckCount)}</span>
        {/if}
      {/snippet}
    </Checkbox.Root>
  {/if}

  <div class="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
    {#if showSelect}
      <button
        type="button"
        aria-pressed={selectOn && !selectDisabled}
        disabled={selectDisabled}
        data-import-select-toggle
        onclick={() => onSelectChange?.(!selectOn)}
        class={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md pr-3 pl-2.5 text-[0.8125rem] leading-[calc(18/13)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11 ${
          selectOn && !selectDisabled
            ? "bg-primary-wash text-ink shadow-[inset_0_0_0_1px_var(--color-primary-line)]"
            : "bg-surface text-ink-secondary shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-gray-50"
        }`}
      >
        <ListChecksIcon size="0.875rem" aria-hidden="true" class="shrink-0 text-ink-muted" />
        Select
      </button>
    {/if}
    <div data-import-legend class="flex shrink-0 items-center gap-3 text-xs leading-[calc(4/3)] text-ink-muted">
      <span class="flex items-center gap-1.5"><AuroraMark size={14} />Filled in by AI</span>
      <span class="h-3.5 w-px bg-line" aria-hidden="true"></span>
      <span>No mark: from the file name or a person</span>
    </div>
  </div>
</div>
