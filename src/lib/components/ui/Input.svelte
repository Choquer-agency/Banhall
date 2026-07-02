<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  let {
    label,
    error,
    class: className = "",
    id,
    value = $bindable(),
    ...rest
  }: HTMLInputAttributes & { label?: string; error?: string } = $props();
</script>

<div class="flex flex-col gap-1.5">
  {#if label}
    <label for={id} class="text-sm font-medium text-gray-700">{label}</label>
  {/if}
  <input
    {id}
    bind:value
    class={`rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy disabled:bg-gray-50 disabled:text-gray-500 ${error ? "border-red-400 focus:border-red-400 focus:ring-red-400" : ""} ${className}`}
    {...rest}
  />
  {#if error}
    <p class="text-xs text-red-500">{error}</p>
  {/if}
</div>
