<!--
  Styled single-select on bits-ui Select (same pattern as IndustryField) —
  use instead of native <select> in forms ("md", 42px input height) and
  toolbars ("sm", compact).
-->
<script lang="ts">
  import { Select } from "bits-ui";

  let {
    value = $bindable(""),
    items,
    placeholder = "Select…",
    id,
    size = "md",
    disabled = false,
    class: className = "",
  }: {
    value?: string;
    items: { value: string; label: string }[];
    placeholder?: string;
    id?: string;
    size?: "md" | "sm";
    disabled?: boolean;
    class?: string;
  } = $props();

  const selected = $derived(items.find((i) => i.value === value));
</script>

<Select.Root type="single" bind:value {items} {disabled}>
  <Select.Trigger
    {id}
    class={`flex w-full cursor-pointer items-center justify-between gap-1.5 border border-gray-200 bg-white text-left transition-colors hover:border-gray-300 focus:outline-none focus-visible:border-navy focus-visible:ring-1 focus-visible:ring-navy disabled:opacity-50 ${
      size === "md"
        ? "h-[42px] rounded-lg px-3.5 text-sm"
        : "rounded-md px-2 py-1.5 text-xs"
    } ${className}`}
  >
    <span class={`truncate ${selected?.value ? "text-gray-900" : "text-gray-500"}`}>
      {selected?.label ?? placeholder}
    </span>
    <svg class="h-3.5 w-3.5 flex-none text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  </Select.Trigger>
  <Select.Portal>
    <Select.Content
      sideOffset={4}
      class="select-pop z-50 max-h-60 w-max min-w-[var(--bits-select-anchor-width)] max-w-80 overflow-y-auto overflow-x-hidden rounded-md border border-gray-200 bg-white shadow-lg"
    >
      {#each items as item (item.value)}
        <Select.Item
          value={item.value}
          label={item.label}
          class={`cursor-pointer px-2.5 py-1.5 transition-colors duration-100 not-data-selected:data-highlighted:bg-primary/10 not-data-selected:data-highlighted:text-primary-dark data-selected:bg-primary-dark data-selected:font-medium data-selected:text-white ${
            size === "md" ? "text-sm" : "text-xs"
          } ${item.value ? "text-gray-900" : "text-gray-500"}`}
        >
          {item.label}
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Portal>
</Select.Root>
