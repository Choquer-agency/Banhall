<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    id,
    label,
    count,
    hasMore = false,
    loading = false,
    loadingMore = false,
    error = false,
    note = null,
    noteRole = "status",
    emptyText,
    canLoadMore = false,
    onLoadMore,
    children,
  }: {
    id: string;
    label: string;
    count: number;
    hasMore?: boolean;
    loading?: boolean;
    loadingMore?: boolean;
    error?: boolean;
    note?: string | null;
    noteRole?: "status" | "alert";
    emptyText: string;
    canLoadMore?: boolean;
    onLoadMore?: () => void;
    collapsible?: boolean;
    defaultOpen?: boolean;
    children: Snippet;
  } = $props();
</script>

<section aria-labelledby={`my-work-group-${id}`} aria-busy={loading} class="mt-8 px-1">
  <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
    <h2 id={`my-work-group-${id}`} class="text-title">{label}</h2>
    {#if !loading && !error}
      <span class="font-mono text-sm tabular-nums text-ink-muted">{count}{hasMore ? "+" : ""}</span>
      <span class="sr-only">loaded</span>
    {/if}
  </header>

  <div id={`my-work-group-${id}-body`}>
    {#if loading}
      <div class="mt-2.5 space-y-1.5" role="status" aria-label={`Loading ${label}`}>
        <div class="mywork-skeleton h-14 animate-pulse motion-reduce:animate-none"></div>
        <div class="mywork-skeleton h-14 animate-pulse motion-reduce:animate-none"></div>
      </div>
    {:else if error}
      <p class="mt-2.5 flex items-center gap-2 text-sm text-red-700" role="alert">
        <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m0 3h.008v.008H12v-.008zM10.06 4.86L2.86 17.25a2.25 2.25 0 001.94 3.375h14.4a2.25 2.25 0 001.94-3.375L13.94 4.86a2.25 2.25 0 00-3.88 0z" /></svg>
        This group could not be loaded. Refresh the page and try again.
      </p>
    {:else}
      {#if note}<p class="mt-2.5 text-sm text-ink-muted" role={noteRole}>{note}</p>{/if}
      {#if count === 0}
        <p class="mt-2.5 text-sm text-ink-muted">{hasMore ? "None loaded yet. More results are available." : emptyText}</p>
      {:else}
        <ul class="mt-1.5 flex flex-col" role="list">{@render children()}</ul>
      {/if}
      {#if canLoadMore || loadingMore}
        <div class="mt-2">
          <button
            type="button"
            disabled={loadingMore}
            onclick={() => onLoadMore?.()}
            class="inline-flex min-h-8 items-center text-xs font-medium text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-60 motion-reduce:transition-none pointer-coarse:min-h-11"
          >{loadingMore ? "Loading…" : `Show more — ${label}`}</button>
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .mywork-skeleton {
    background: var(--color-chrome);
    border-radius: 0.75rem;
  }
</style>
