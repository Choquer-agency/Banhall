<!--
  Shared checkbox (bits-ui Checkbox.Root) — replaces native inputs with
  accent-primary. Lagoon fill when checked, chrome border when not; inline
  SVG check/minus (no icon dependency). Label is optional; pass children
  for richer label content.
-->
<script lang="ts">
  import { Checkbox, Label, useId, type WithoutChildrenOrChild } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    id = useId(),
    checked = $bindable(false),
    ref = $bindable(null),
    labelText,
    label,
    ...restProps
  }: WithoutChildrenOrChild<Checkbox.RootProps> & {
    labelText?: string;
    /** Rich label content; wins over labelText. */
    label?: Snippet;
  } = $props();
</script>

<div class="flex items-center gap-2">
  <Checkbox.Root
    {id}
    bind:checked
    bind:ref
    aria-labelledby={labelText || label ? `${id}-label` : undefined}
    class="peer inline-flex size-[18px] flex-none items-center justify-center rounded-[5px] border transition-colors duration-150 ease-out active:scale-[0.97] data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=unchecked]:border-gray-300 data-[state=unchecked]:bg-white data-[state=unchecked]:hover:border-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[disabled]:opacity-50"
    {...restProps}
  >
    {#snippet children({ checked: isChecked, indeterminate })}
      <span class="inline-flex items-center justify-center text-white">
        {#if indeterminate}
          <svg class="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
            <path stroke-linecap="round" d="M5 12h14" />
          </svg>
        {:else if isChecked}
          <svg class="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        {/if}
      </span>
    {/snippet}
  </Checkbox.Root>
  {#if labelText || label}
    <Label.Root
      id="{id}-label"
      for={id}
      class="cursor-pointer select-none text-sm text-gray-600 peer-data-[disabled]:cursor-not-allowed peer-data-[disabled]:opacity-70"
    >
      {#if label}{@render label()}{:else}{labelText}{/if}
    </Label.Root>
  {/if}
</div>
