<!--
  The Projects page client list (Paper W1, W5 and W6; 2026-10-14
  amendment). "Find a client" filters the loaded list (case and accents
  ignored); "All clients" carries the total; one row per client with its
  project count. Rows are links (`?client=<key>`), so they open in a new tab
  and the host turns a plain click into a soft navigation. The selected row
  is the primary wash with primary-selected text and aria-current.

  Footer: "New client" for roles that may create projects, "Select clients to
  merge" for Managers and Admins. Merge mode turns rows into checkboxes with
  a dark "N selected" bar and Merge (enabled at two or more).
-->
<script lang="ts">
  import { IconPlus, IconSearch } from "$lib/components/icons";
  import { filterClients, type ClientEntry } from "$lib/projects/clientList";

  let {
    clients,
    truncated = false,
    loading = false,
    failed = false,
    totalLabel = null,
    selectedKey,
    hrefFor,
    onSelect,
    canCreate = false,
    canMerge = false,
    onNewClient,
    mergeMode = false,
    mergeKeys = [],
    onStartMerge,
    onEndMerge,
    onToggleMerge,
    onMerge,
    onRetry,
  }: {
    clients: ClientEntry[];
    truncated?: boolean;
    loading?: boolean;
    failed?: boolean;
    /** The All companies count ("128", or "1000+" when bounded). */
    totalLabel?: string | null;
    selectedKey: string | null;
    hrefFor: (key: string | null) => string;
    onSelect: (key: string | null) => void;
    canCreate?: boolean;
    canMerge?: boolean;
    onNewClient: () => void;
    mergeMode?: boolean;
    mergeKeys?: string[];
    onStartMerge: () => void;
    onEndMerge: () => void;
    onToggleMerge: (key: string) => void;
    onMerge: () => void;
    onRetry: () => void;
  } = $props();

  let query = $state("");
  const visible = $derived(filterClients(clients, query));
  const mergeSet = $derived(new Set(mergeKeys));

  function navigate(event: MouseEvent, key: string | null) {
    // Modified clicks (new tab, new window) keep the link's own behaviour.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(key);
  }

  const rowBase =
    "flex h-[1.875rem] w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
  const footerRow =
    "flex h-[1.875rem] w-full items-center gap-2 rounded-lg px-2.5 text-left text-[0.8125rem] leading-4 text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
</script>

{#snippet countCell(count: number | string)}
  <span class="shrink-0 text-right text-xs leading-4 text-ink-muted">{count}</span>
{/snippet}

<!-- Paper Z3d and Z7e (2026-10-16): 240 wide, 14px padding, 32px rows,
     14px names, 12px counts, the 38px search, then New company and Merge
     companies under a hairline at the bottom. -->
<div data-client-list class="flex min-h-0 flex-1 flex-col px-3.5 py-5">
  <div class="relative shrink-0" role="search">
    <IconSearch size={15} strokeWidth={2} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
    <input
      type="search"
      bind:value={query}
      aria-label="Find a company"
      placeholder="Find a company"
      autocomplete="off"
      onkeydown={(event) => {
        if (event.key === "Escape" && query) {
          event.stopPropagation();
          query = "";
        }
      }}
      class="field-control h-[2.375rem] w-full rounded-lg pl-[2.125rem] pr-3 text-sm leading-[1.125rem] text-ink placeholder:text-ink-muted pointer-coarse:h-11"
    />
  </div>

  <div class="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pt-2" data-client-list-scroll>
    {#if failed}
      <div class="px-2.5 py-3" role="alert">
        <p class="text-sm leading-5 text-ink">Companies could not be loaded.</p>
        <button
          type="button"
          onclick={onRetry}
          class="mt-2 h-8 rounded-lg border border-line px-3 text-[0.8125rem] font-medium text-ink-secondary hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:h-11"
        >Try again</button>
      </div>
    {:else if mergeMode}
      <p class="px-1 pb-2 pt-1 text-[0.8125rem] leading-[1.125rem] text-ink-secondary" data-merge-header>Tick the names that are the same company.</p>
      <ul aria-label="Companies to merge" class="flex flex-col gap-0.5">
        {#each visible as client (client.key)}
          {@const checked = mergeSet.has(client.key)}
          <li>
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              data-merge-client={client.key}
              onclick={() => onToggleMerge(client.key)}
              class={`${rowBase} gap-2.5 ${checked ? "bg-primary-wash" : "hover:bg-primary-wash"}`}
            >
              <span
                aria-hidden="true"
                class={`flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border ${checked ? "border-primary-selected bg-primary-selected text-white" : "border-gray-300 bg-surface"}`}
              >
                {#if checked}
                  <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg>
                {/if}
              </span>
              <span class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-4 ${checked ? "text-ink" : "text-ink-secondary"}`}>{client.name}</span>
              {@render countCell(client.projectCount)}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <nav aria-label="Companies">
        <ul class="flex flex-col gap-0.5">
          <li>
            <a
              href={hrefFor(null)}
              data-client-row="all"
              aria-current={selectedKey === null ? "page" : undefined}
              onclick={(event) => navigate(event, null)}
              class={`${rowBase} ${selectedKey === null ? "bg-primary-wash" : "hover:bg-primary-wash"}`}
            >
              <span class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-4 ${selectedKey === null ? "font-medium text-primary-selected" : "text-ink-secondary"}`}>All companies</span>
              {#if totalLabel}{@render countCell(totalLabel)}{/if}
            </a>
          </li>
          {#if loading}
            {#each [0, 1, 2, 3, 4, 5, 6, 7] as item (item)}
              <li class="flex h-[1.875rem] items-center px-2.5" aria-hidden="true">
                <span class="h-3.5 animate-pulse rounded bg-chrome motion-reduce:animate-none" style={`width:${55 + ((item * 17) % 35)}%`}></span>
              </li>
            {/each}
          {:else}
            {#each visible as client (client.key)}
              {@const active = client.key === selectedKey}
              <li>
                <a
                  href={hrefFor(client.key)}
                  data-client-row={client.key}
                  aria-current={active ? "page" : undefined}
                  onclick={(event) => navigate(event, client.key)}
                  class={`${rowBase} ${active ? "bg-primary-wash" : "hover:bg-primary-wash"}`}
                >
                  <span class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-4 ${active ? "font-medium text-primary-selected" : "text-ink-secondary"}`}>{client.name}</span>
                  {@render countCell(client.projectCount)}
                </a>
              </li>
            {/each}
          {/if}
        </ul>
      </nav>
    {/if}

    {#if !loading && !failed}
      {#if visible.length === 0}
        <p class="px-2.5 py-2 text-[0.8125rem] leading-[1.125rem] text-ink-muted" role="status">
          {query.trim() ? `No company matches "${query.trim()}".` : "No companies yet."}
        </p>
      {/if}
      {#if truncated}
        <p data-clients-truncated class="px-2.5 pt-3 text-[0.8125rem] leading-[1.125rem] text-ink-muted">Some companies are not shown. The list stops partway through the alphabet.</p>
      {/if}
    {/if}
  </div>

  {#if mergeMode}
    <div class="flex shrink-0 flex-col gap-2 border-t border-line-soft pt-2.5" data-merge-bar>
      <p class="px-1 text-[0.8125rem] leading-4 text-ink-muted" aria-live="polite">
        {mergeKeys.length === 1 ? "1 company ticked" : `${mergeKeys.length} companies ticked`}
      </p>
      <div class="flex gap-2">
        <button
          type="button"
          data-merge-open
          disabled={mergeKeys.length < 2}
          onclick={onMerge}
          class="flex h-9 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg bg-primary-selected px-2.5 text-[0.8125rem] leading-[1.125rem] font-medium text-white transition-colors hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 pointer-coarse:h-11"
        >{mergeKeys.length >= 2 ? `Merge ${mergeKeys.length} companies` : "Merge"}</button>
        <button
          type="button"
          data-merge-done
          onclick={onEndMerge}
          class="flex h-9 shrink-0 items-center rounded-lg border border-line bg-surface px-2.5 text-[0.8125rem] leading-[1.125rem] font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:h-11"
        >Cancel</button>
      </div>
    </div>
  {:else if canCreate || canMerge}
    <div class="flex shrink-0 flex-col gap-0.5 border-t border-line-soft pt-2.5">
      {#if canCreate}
        <button type="button" data-new-client onclick={onNewClient} class={footerRow}>
          <IconPlus size={15} strokeWidth={2} class="shrink-0" />
          New company
        </button>
      {/if}
      {#if canMerge}
        <button type="button" data-start-merge onclick={onStartMerge} class={footerRow}>
          <svg class="size-[0.9375rem] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v4a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4M18 4v4a4 4 0 0 1-4 4" /></svg>
          Merge companies
        </button>
      {/if}
    </div>
  {/if}
</div>
