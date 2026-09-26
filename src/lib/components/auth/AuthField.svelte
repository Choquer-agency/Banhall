<script lang="ts">
  // J1 field: 13px 500 label, 44px input (radius 10, line border, 15px ink,
  // faint placeholder). Invalid fields take a 1.5px danger border (J2, J4).
  import type { Snippet } from "svelte";
  import type { HTMLInputAttributes } from "svelte/elements";

  let {
    id,
    label,
    value = $bindable(""),
    invalid = false,
    labelAction,
    trailing,
    element = $bindable(),
    class: className = "",
    ...rest
  }: HTMLInputAttributes & {
    id: string;
    label: string;
    value?: string;
    invalid?: boolean;
    labelAction?: Snippet;
    trailing?: Snippet;
    element?: HTMLInputElement;
  } = $props();
</script>

<div class={`flex flex-col gap-1.5 ${className}`}>
  <div class="flex items-center justify-between gap-3">
    <label for={id} class="text-[13px] leading-[18px] font-medium text-ink-secondary">{label}</label>
    {@render labelAction?.()}
  </div>
  <div
    data-auth-input
    data-invalid={invalid ? "true" : undefined}
    class={`flex h-11 items-center gap-2 rounded-[10px] bg-surface px-3 transition-[border-color,box-shadow] ${invalid ? "border-[1.5px] border-danger" : "border border-line focus-within:border-[1.5px] focus-within:border-primary-selected focus-within:ring-[3px] focus-within:ring-primary/15"}`}
  >
    <input
      bind:this={element}
      {id}
      bind:value
      aria-invalid={invalid ? "true" : undefined}
      {...rest}
      class="input-chromeless h-full min-w-0 flex-1 bg-transparent p-0 text-[15px] leading-5 text-ink placeholder:text-ink-faint disabled:opacity-60"
    />
    {@render trailing?.()}
  </div>
</div>
