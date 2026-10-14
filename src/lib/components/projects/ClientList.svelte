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
    /** The All clients count ("128", or "1000+" when bounded). */
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
    "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-left outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
  const footerRow =
    "flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[0.8125rem] leading-[1.125rem] transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
</script>

{#snippet countCell(count: number | string, active: boolean)}
  <span class={`w-8 shrink-0 text-right text-xs leading-4 ${active ? "text-primary-selected" : "text-ink-muted"}`}>{count}</span>
{/snippet}

<div data-client-list class="flex min-h-0 flex-1 flex-col">
  <div class="shrink-0 px-2 pt-3">
    {#if mergeMode}
      <div class="flex h-[1.875rem] items-center px-2.5" data-merge-header>
        <p class="flex-1 text-xs leading-4 text-ink-muted">Select clients to merge</p>
        <button
          type="button"
          data-merge-done
          onclick={onEndMerge}
          class="rounded-md text-xs leading-4 font-medium text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11"
        >Done</button>
      </div>
      <div class="h-1.5"></div>
    {/if}
    <div class="relative" role="search">
      <IconSearch size={13} strokeWidth={1.4} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
      <input
        type="search"
        bind:value={query}
        aria-label="Find a client"
        placeholder="Find a client"
        autocomplete="off"
        onkeydown={(event) => {
          if (event.key === "Escape" && query) {
            event.stopPropagation();
            query = "";
          }
        }}
        class="field-control h-[1.875rem] w-full rounded-[0.4375rem] bg-gray-50! pl-7 pr-2 text-xs leading-4 text-ink placeholder:text-ink-faint pointer-coarse:h-11"
      />
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-2" data-client-list-scroll>
    {#if failed}
      <div class="px-2.5 py-3" role="alert">
        <p class="text-[0.8125rem] leading-[1.125rem] text-ink">Clients could not be loaded.</p>
        <button
          type="button"
          onclick={onRetry}
          class="mt-2 h-8 rounded-md border border-line px-2.5 text-xs font-medium text-ink-secondary hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:h-11"
        >Try again</button>
      </div>
    {:else if mergeMode}
      <ul aria-label="Clients to merge" class="flex flex-col">
        {#each visible as client (client.key)}
          {@const checked = mergeSet.has(client.key)}
          <li>
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              data-merge-client={client.key}
              onclick={() => onToggleMerge(client.key)}
              class={`${rowBase} gap-[0.5625rem] ${checked ? "bg-primary-wash" : "hover:bg-primary-wash"}`}
            >
              <span
                aria-hidden="true"
                class={`flex size-[0.9375rem] shrink-0 items-center justify-center rounded-[0.25rem] ${checked ? "bg-fir text-white" : "border border-line bg-surface"}`}
              >
                {#if checked}
                  <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg>
                {/if}
              </span>
              <span class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-[1.125rem] ${checked ? "text-ink" : "text-ink-secondary"}`}>{client.name}</span>
              {@render countCell(client.projectCount, false)}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <nav aria-label="Clients">
        <ul class="flex flex-col">
          <li>
            <a
              href={hrefFor(null)}
              data-client-row="all"
              aria-current={selectedKey === null ? "page" : undefined}
              onclick={(event) => navigate(event, null)}
              class={`${rowBase} ${selectedKey === null ? "bg-primary-wash" : "hover:bg-primary-wash"}`}
            >
              <span class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-[1.125rem] ${selectedKey === null ? "font-medium text-primary-selected" : "text-ink-secondary"}`}>All clients</span>
              {#if totalLabel}{@render countCell(totalLabel, selectedKey === null)}{/if}
            </a>
          </li>
          <li aria-hidden="true" class="flex h-[0.5625rem] items-center px-2.5">
            <span class="h-px flex-1 bg-line-soft"></span>
          </li>
          {#if loading}
            {#each [0, 1, 2, 3, 4, 5, 6, 7] as item (item)}
              <li class="flex h-8 items-center px-2.5" aria-hidden="true">
                <span class="h-3 animate-pulse rounded bg-chrome motion-reduce:animate-none" style={`width:${55 + ((item * 17) % 35)}%`}></span>
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
                  <span class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-[1.125rem] ${active ? "font-medium text-primary-selected" : "text-ink-secondary"}`}>{client.name}</span>
                  {@render countCell(client.projectCount, active)}
                </a>
              </li>
            {/each}
          {/if}
        </ul>
      </nav>
    {/if}

    {#if !loading && !failed}
      {#if visible.length === 0}
        <p class="px-2.5 py-2 text-xs leading-4 text-ink-muted" role="status">
          {query.trim() ? `No client matches "${query.trim()}".` : "No clients yet."}
        </p>
      {/if}
      {#if truncated}
        <p data-clients-truncated class="px-2.5 pt-3 text-xs leading-4 text-ink-muted">Some clients are not shown. The list stops partway through the alphabet.</p>
      {/if}
    {/if}
  </div>

  {#if mergeMode}
    <div class="shrink-0 p-2">
      <div data-merge-bar class="flex h-11 items-center gap-2 rounded-[0.625rem] bg-ink pl-3 pr-1.5">
        <p class="flex-1 text-[0.8125rem] leading-[1.125rem] font-medium text-white" aria-live="polite">{mergeKeys.length} selected</p>
        <button
          type="button"
          data-merge-open
          disabled={mergeKeys.length < 2}
          onclick={onMerge}
          class="h-[1.875rem] rounded-[0.4375rem] bg-surface px-3 text-[0.8125rem] leading-[1.125rem] font-medium text-ink hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light disabled:opacity-50 pointer-coarse:h-11"
        >Merge</button>
      </div>
    </div>
  {:else if canCreate || canMerge}
    <div class="shrink-0 px-2 pb-2">
      {#if canCreate}
        <button type="button" data-new-client onclick={onNewClient} class={`${footerRow} text-primary-selected`}>
          <IconPlus size={13} strokeWidth={1.6} />
          New client
        </button>
      {/if}
      {#if canMerge}
        <button type="button" data-start-merge onclick={onStartMerge} class={`${footerRow} text-ink-secondary`}>
          Select clients to merge
        </button>
      {/if}
    </div>
  {/if}
</div>
