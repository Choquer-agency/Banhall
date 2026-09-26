<script lang="ts">
  /**
   * One Settings row (I1, I3): a 280px label column (label plus an optional
   * muted hint), 24px gap, the control on the right; 16px vertical padding
   * and a `line-soft` hairline below. Stacks below 768px.
   */
  import type { Snippet } from "svelte";

  let {
    label,
    hint = null,
    labelFor = undefined,
    last = false,
    children,
  }: {
    label: string;
    /** Muted line under the label: plain text, or a snippet for live text. */
    hint?: string | Snippet | null;
    /** Id of the control the label names, when there is exactly one. */
    labelFor?: string;
    last?: boolean;
    children: Snippet;
  } = $props();
</script>

<div
  data-settings-row
  class={`flex flex-col gap-2 py-4 md:flex-row md:items-center md:gap-6 ${last ? "" : "border-b border-line-soft"}`}
>
  <div class="flex shrink-0 flex-col gap-0.5 md:w-[280px]">
    {#if labelFor}
      <label for={labelFor} class="text-sm font-medium leading-5 text-ink">{label}</label>
    {:else}
      <span class="text-sm font-medium leading-5 text-ink">{label}</span>
    {/if}
    {#if typeof hint === "function"}
      <span class="text-[13px] leading-[18px] text-ink-muted">{@render hint()}</span>
    {:else if hint}
      <span class="text-[13px] leading-[18px] text-ink-muted">{hint}</span>
    {/if}
  </div>
  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
