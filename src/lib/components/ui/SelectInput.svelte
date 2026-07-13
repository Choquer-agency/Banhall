<!--
  Searchable single-select built on bits-ui Combobox. Use in forms ("md", 42px)
  and compact toolbars ("sm"). Closed state shows selected label; open state lets
  users type to filter long option lists.
-->
<script lang="ts">
  import { Combobox } from "bits-ui";

  let {
    value = $bindable(""),
    items,
    placeholder = "Select…",
    id,
    size = "md",
    disabled = false,
    openOnFocus = true,
    class: className = "",
    onValueChange,
    onCreate,
  }: {
    value?: string;
    items: readonly { value: string; label: string }[];
    placeholder?: string;
    id?: string;
    size?: "md" | "sm";
    disabled?: boolean;
    openOnFocus?: boolean;
    class?: string;
    onValueChange?: (value: string) => void;
    /** When set, typing a value that matches no option offers an "Add …" row. */
    onCreate?: (label: string) => void;
  } = $props();

  let open = $state(false);
  let searchValue = $state("");
  let inputRef = $state<HTMLElement | null>(null);

  const selected = $derived(items.find((i) => i.value === value));
  const query = $derived(searchValue.trim().toLowerCase());
  const filteredItems = $derived(
    query
      ? items.filter(
          (item) =>
            item.label.toLowerCase().includes(query) ||
            item.value.toLowerCase().includes(query)
        )
      : items
  );

  function handleValueChange(next: string) {
    value = next;
    searchValue = "";
    onValueChange?.(next);
  }

  // Offer "Add …" only when the typed text matches no existing label exactly.
  const canCreate = $derived(
    Boolean(
      onCreate &&
        searchValue.trim() &&
        !items.some((i) => i.label.toLowerCase() === searchValue.trim().toLowerCase())
    )
  );

  function handleCreate() {
    const label = searchValue.trim();
    if (!label) return;
    searchValue = "";
    open = false;
    onCreate?.(label);
  }

  // bits-ui's Combobox.Input is uncontrolled, so it renders the placeholder on
  // mount even when a value is selected. Sync the DOM value whenever closed so
  // the closed state always shows the selected label.
  $effect(() => {
    if (!open && inputRef instanceof HTMLInputElement) {
      inputRef.value = selected?.label ?? "";
    }
  });
</script>

<Combobox.Root
  type="single"
  value={value}
  bind:open
  {disabled}
  onValueChange={handleValueChange}
  onOpenChangeComplete={(nextOpen) => {
    if (!nextOpen) searchValue = "";
  }}
>
  <div class={`relative ${className}`}>
    <Combobox.Input
      {id}
      bind:ref={inputRef}
      defaultValue={selected?.label ?? ""}
      placeholder={placeholder}
      aria-label={placeholder}
      disabled={disabled}
      onfocus={(e) => {
        if (!openOnFocus) return;
        open = true;
        searchValue = "";
        e.currentTarget.select();
      }}
      onclick={(e) => {
        open = true;
        searchValue = "";
        e.currentTarget.select();
      }}
      oninput={(e) => {
        open = true;
        searchValue = e.currentTarget.value;
      }}
      class={`w-full border border-gray-200 bg-white pr-8 text-left font-normal transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:outline-none focus-visible:border-navy focus-visible:ring-1 focus-visible:ring-navy disabled:opacity-50 ${
        size === "md"
          ? "h-[42px] rounded-lg px-3.5 text-sm"
          : "rounded-md px-2 py-1.5 text-xs"
      } ${selected?.value ? "text-gray-900" : "text-gray-500"}`}
    />
    <Combobox.Trigger
      aria-label="Toggle options"
      class={`absolute right-2 top-1/2 flex -translate-y-1/2 items-center justify-center text-gray-400 ${
        size === "md" ? "h-7 w-7" : "h-5 w-5"
      }`}
    >
      <svg class="h-3.5 w-3.5 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </Combobox.Trigger>
  </div>
  <Combobox.Portal>
    <Combobox.Content
      sideOffset={4}
      class="select-pop z-50 max-h-72 w-[var(--bits-combobox-anchor-width)] min-w-[var(--bits-combobox-anchor-width)] max-w-[32rem] overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg"
    >
      <Combobox.Viewport class="max-h-72 overflow-y-auto">
        {#each filteredItems as item (item.value)}
          <Combobox.Item
            value={item.value}
            label={item.label}
            class={`cursor-pointer px-2.5 py-1.5 font-normal transition-colors duration-100 data-highlighted:bg-primary/10 data-highlighted:text-primary-dark data-selected:bg-primary/15 data-selected:font-medium data-selected:text-primary-dark ${
              size === "md" ? "text-sm" : "text-xs"
            } ${item.value ? "text-gray-900" : "text-gray-500"}`}
          >
            {item.label}
          </Combobox.Item>
        {:else}
          {#if !canCreate}
            <p class="px-2.5 py-2 text-xs text-gray-400">No matching options.</p>
          {/if}
        {/each}
        {#if canCreate}
          <button
            type="button"
            onmousedown={(e) => {
              e.preventDefault();
              handleCreate();
            }}
            class={`flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left font-medium text-primary-dark transition-colors duration-100 hover:bg-primary/10 ${
              size === "md" ? "text-sm" : "text-xs"
            }`}
          >
            <span aria-hidden="true">+</span>
            Add “{searchValue.trim()}”
          </button>
        {/if}
      </Combobox.Viewport>
    </Combobox.Content>
  </Combobox.Portal>
</Combobox.Root>
