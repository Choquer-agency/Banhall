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
    <label for={id} class="text-sm font-medium text-gray-700">
      {label}{#if rest.required}<span class="ml-0.5 text-red-500" aria-hidden="true">*</span>{/if}
    </label>
  {/if}
  <input
    {id}
    bind:value
    {...rest}
    aria-invalid={error ? "true" : rest["aria-invalid"]}
    class={`field-control rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 disabled:opacity-60 ${className}`}
  />
  {#if error}
    <p class="text-xs text-red-500">{error}</p>
  {/if}
</div>
