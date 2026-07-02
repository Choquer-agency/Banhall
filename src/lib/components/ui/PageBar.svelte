<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * The bar directly below AppNav on every navigated page (design system).
   * Left: back button. Right: optional page actions (e.g. the report
   * workspace's Share / History / Export / Financial cluster).
   * `width` must match the page's <main> / AppNav width.
   */
  let {
    backHref = "/dashboard",
    backLabel = "Back",
    width = "max-w-7xl",
    actions,
  }: {
    backHref?: string;
    backLabel?: string;
    width?: string;
    actions?: Snippet;
  } = $props();
</script>

<div class={`mx-auto w-full shrink-0 px-6 pt-4 ${width}`}>
  <div class="card flex items-center justify-between gap-3 px-2 py-1.5">
    <a
      href={backHref}
      class="flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-navy transition-colors hover:bg-primary-wash"
    >
      <svg class="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      <span class="whitespace-nowrap">{backLabel}</span>
    </a>

    {#if actions}
      <div class="flex flex-shrink-0 items-center gap-1">
        {@render actions()}
      </div>
    {/if}
  </div>
</div>
