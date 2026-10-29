<!--
  The "Companies" group of a section sidebar (Paper S9; shared by the
  Projects and Companies sidebars since 2026-10-28): a search button that
  opens "Find a company" (case and accents ignored) and every company, A to
  Z, with its project count. Rows are links, so they open in a new tab;
  `onSelect` turns a plain click into the host's soft navigation. The
  selected row is the primary wash with a primary-selected 500 label and
  aria-current. Merge mode turns rows into checkboxes.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { filterClients, type ClientEntry } from "$lib/projects/clientList";
  import SectionSidebarGroup from "$lib/components/workspace/SectionSidebarGroup.svelte";
  import SectionSidebarLink from "$lib/components/workspace/SectionSidebarLink.svelte";

  let {
    clients,
    truncated = false,
    loading = false,
    failed = false,
    selectedKey,
    hrefFor,
    onSelect = undefined,
    mergeMode = false,
    mergeKeys = [],
    onToggleMerge = undefined,
    onRetry,
  }: {
    clients: ClientEntry[];
    truncated?: boolean;
    loading?: boolean;
    failed?: boolean;
    /** The company row to mark, or null for none. */
    selectedKey: string | null;
    hrefFor: (key: string) => string;
    /** A plain click on a company (the host's soft navigation). */
    onSelect?: (key: string) => void;
    mergeMode?: boolean;
    mergeKeys?: string[];
    onToggleMerge?: (key: string) => void;
    onRetry: () => void;
  } = $props();

  let query = $state("");
  let searchOpen = $state(false);
  let searchEl: HTMLInputElement | null = $state(null);
  const visible = $derived(filterClients(clients, query));
  const mergeSet = $derived(new Set(mergeKeys));

  async function toggleSearch() {
    if (searchOpen) {
      searchOpen = false;
      query = "";
      return;
    }
    searchOpen = true;
    await tick();
    searchEl?.focus();
  }

  const rowBase =
    "flex h-[1.875rem] w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11";
</script>

<SectionSidebarGroup
  id="companies"
  label="Companies"
  searchLabel={searchOpen ? "Close the company search" : "Find a company"}
  {searchOpen}
  onSearch={() => void toggleSearch()}
>
  {#if searchOpen}
    <div class="shrink-0 px-0.5 pb-1" role="search">
      <input
        bind:this={searchEl}
        type="search"
        bind:value={query}
        aria-label="Find a company"
        placeholder="Find a company"
        autocomplete="off"
        data-client-search-field
        onkeydown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          query = "";
          searchOpen = false;
        }}
        class="field-control h-8 w-full rounded-lg px-2.5 text-[0.8125rem] leading-[calc(18/13)] text-ink placeholder:text-ink-muted pointer-coarse:h-11"
      />
    </div>
  {/if}

  {#if failed}
    <div class="px-2.5 py-3" role="alert">
      <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink">Companies could not be loaded.</p>
      <button
        type="button"
        onclick={onRetry}
        class="mt-2 h-8 rounded-lg border border-line px-3 text-[0.8125rem] font-medium text-ink-secondary hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir pointer-coarse:h-11"
      >Try again</button>
    </div>
  {:else if mergeMode}
    <p class="px-2.5 pb-2 pt-1 text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary" data-merge-header>Tick the names that are the same company.</p>
    <ul aria-label="Companies to merge" class="flex flex-col gap-0.5">
      {#each visible as client (client.key)}
        {@const checked = mergeSet.has(client.key)}
        <li>
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            data-merge-client={client.key}
            onclick={() => onToggleMerge?.(client.key)}
            class={`${rowBase} ${checked ? "bg-primary-wash" : "hover:bg-primary-wash"}`}
          >
            <span
              aria-hidden="true"
              class={`flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] border ${checked ? "border-primary-selected bg-primary-selected text-white" : "border-gray-300 bg-surface"}`}
            >
              {#if checked}
                <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg>
              {/if}
            </span>
            <span class={`min-w-0 flex-1 truncate text-[0.8125rem] leading-[calc(18/13)] ${checked ? "text-ink" : "text-ink-secondary"}`}>{client.name}</span>
            <span class="shrink-0 text-right text-xs leading-[calc(4/3)] text-ink-muted">{client.projectCount}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if loading}
    {#each [0, 1, 2, 3, 4, 5, 6, 7] as item (item)}
      <div class="flex h-[1.875rem] shrink-0 items-center px-2.5" aria-hidden="true" data-client-skeleton>
        <span class="h-3.5 animate-pulse rounded bg-chrome motion-reduce:animate-none" style={`width:${55 + ((item * 17) % 35)}%`}></span>
      </div>
    {/each}
  {:else}
    <ul aria-label="Companies" class="flex flex-col gap-0.5">
      {#each visible as client (client.key)}
        <li>
          <SectionSidebarLink
            kind="group"
            href={hrefFor(client.key)}
            label={client.name}
            data-client-row={client.key}
            active={client.key === selectedKey}
            count={client.projectCount}
            onnavigate={onSelect ? () => onSelect(client.key) : undefined}
          />
        </li>
      {/each}
    </ul>
  {/if}

  {#if !loading && !failed}
    {#if visible.length === 0}
      <p class="px-2.5 py-2 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted" role="status">
        {query.trim() ? `No company matches "${query.trim()}".` : "No companies yet."}
      </p>
    {/if}
    {#if truncated}
      <p data-clients-truncated class="px-2.5 pt-3 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">Some companies are not shown. The list stops partway through the alphabet.</p>
    {/if}
  {/if}
</SectionSidebarGroup>
