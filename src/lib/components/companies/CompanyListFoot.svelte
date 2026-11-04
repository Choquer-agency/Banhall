<!--
  The foot of a sidebar's company list (shared by the Projects and
  Companies sidebars since 2026-10-28): "New company" (Projects only; the
  Companies sidebar has it as its main action) and "Merge companies" for
  Managers and Admins. In merge mode: "N companies ticked" with Merge
  (enabled at two or more) and Cancel.
-->
<script lang="ts">
  import { IconPlus } from "$lib/components/icons";

  let {
    showNewClient = false,
    onNewClient = undefined,
    showMerge = false,
    mergeMode = false,
    mergeKeys = [],
    onStartMerge = undefined,
    onEndMerge = undefined,
    onMerge = undefined,
  }: {
    showNewClient?: boolean;
    onNewClient?: () => void;
    showMerge?: boolean;
    mergeMode?: boolean;
    mergeKeys?: string[];
    onStartMerge?: () => void;
    onEndMerge?: () => void;
    onMerge?: () => void;
  } = $props();

  const footerRow =
    "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11";
</script>

{#if mergeMode}
  <div class="flex shrink-0 flex-col gap-2 border-t border-line-soft pt-2.5" data-merge-bar>
    <p class="px-1 text-[0.8125rem] leading-[calc(16/13)] text-ink-muted" aria-live="polite">
      {mergeKeys.length === 1 ? "1 company ticked" : `${mergeKeys.length} companies ticked`}
    </p>
    <div class="flex gap-2">
      <button
        type="button"
        data-merge-open
        disabled={mergeKeys.length < 2}
        onclick={() => onMerge?.()}
        class="flex h-9 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg bg-primary-selected px-2.5 text-[0.8125rem] leading-[calc(18/13)] font-medium text-white transition-colors hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-50 pointer-coarse:h-11"
      >{mergeKeys.length >= 2 ? `Merge ${mergeKeys.length} companies` : "Merge"}</button>
      <button
        type="button"
        data-merge-done
        onclick={() => onEndMerge?.()}
        class="flex h-9 shrink-0 items-center rounded-lg border border-line bg-surface px-2.5 text-[0.8125rem] leading-[calc(18/13)] font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir pointer-coarse:h-11"
      >Cancel</button>
    </div>
  </div>
{:else if showNewClient || showMerge}
  <div class="flex shrink-0 flex-col gap-0.5 border-t border-line-soft pt-2.5" data-client-list-foot>
    {#if showNewClient}
      <button type="button" data-new-client onclick={() => onNewClient?.()} class={footerRow}>
        <IconPlus size={16} strokeWidth={1.7} class="shrink-0" />
        New company
      </button>
    {/if}
    {#if showMerge}
      <button type="button" data-start-merge onclick={() => onStartMerge?.()} class={footerRow}>
        <svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v4a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4M18 4v4a4 4 0 0 1-4 4" /></svg>
        Merge companies
      </button>
    {/if}
  </div>
{/if}
