<!--
  The Projects section sidebar (the page frame, owner 2026-10-28; Paper S9),
  shared by Projects and Home. "Projects" with its collapse button, the New
  project button, Home and All projects (with the project count), then the
  Companies group: a search button that opens "Find a company" (case and
  accents ignored) and every company with its project count. Rows are links
  (`?client=<key>`), so they open in a new tab; on Projects the host turns a
  plain click into a soft navigation. The selected row is the primary wash
  with a primary-selected 500 label and aria-current.

  Foot (Projects only): "New company" for roles that may create projects,
  "Merge companies" for Managers and Admins. Merge mode turns rows into
  checkboxes with "N companies ticked" and Merge (enabled at two or more).
-->
<script lang="ts">
  import { tick } from "svelte";
  import { resolve } from "$app/paths";
  import { IconPlus } from "$lib/components/icons";
  import { filterClients, type ClientEntry } from "$lib/projects/clientList";
  import SectionSidebar from "$lib/components/workspace/SectionSidebar.svelte";
  import SectionSidebarGroup from "$lib/components/workspace/SectionSidebarGroup.svelte";
  import SectionSidebarLink from "$lib/components/workspace/SectionSidebarLink.svelte";
  import FrameIcon from "$lib/components/workspace/FrameIcon.svelte";

  let {
    clients,
    truncated = false,
    loading = false,
    failed = false,
    totalLabel = null,
    selectedKey,
    current = "projects",
    homeHref,
    homeAvailable = true,
    hrefFor,
    onSelect = undefined,
    phone = "hidden",
    canCreate = false,
    canMerge = false,
    onNewClient = undefined,
    mergeMode = false,
    mergeKeys = [],
    onStartMerge = undefined,
    onEndMerge = undefined,
    onToggleMerge = undefined,
    onMerge = undefined,
    onRetry,
  }: {
    clients: ClientEntry[];
    truncated?: boolean;
    loading?: boolean;
    failed?: boolean;
    /** The All projects count ("128", or "1000+" when bounded). */
    totalLabel?: string | null;
    selectedKey: string | null;
    /** Which page holds the sidebar: Home marks Home, Projects marks All projects or the company. */
    current?: "home" | "projects";
    homeHref: string;
    /** Home is switched off (the rollout kill switch): shown, not followed. */
    homeAvailable?: boolean;
    hrefFor: (key: string | null) => string;
    /** A plain click on All projects or a company (Projects' soft navigation). */
    onSelect?: (key: string | null) => void;
    /** Below 768px: hidden, or filling the card (the Projects list on a phone). */
    phone?: "hidden" | "full";
    canCreate?: boolean;
    canMerge?: boolean;
    onNewClient?: () => void;
    mergeMode?: boolean;
    mergeKeys?: string[];
    onStartMerge?: () => void;
    onEndMerge?: () => void;
    onToggleMerge?: (key: string) => void;
    onMerge?: () => void;
    onRetry: () => void;
  } = $props();

  let query = $state("");
  let searchOpen = $state(false);
  let searchEl: HTMLInputElement | null = $state(null);
  const visible = $derived(filterClients(clients, query));
  const mergeSet = $derived(new Set(mergeKeys));
  const showNewClient = $derived(canCreate && onNewClient !== undefined);
  const showMerge = $derived(canMerge && onStartMerge !== undefined);

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

  const select = (key: string | null) => (onSelect ? () => onSelect(key) : undefined);

  const rowBase =
    "flex h-[1.875rem] w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11";
  const footerRow =
    "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11";
</script>

<SectionSidebar
  section="projects"
  title="Projects"
  action={{ label: "New project", href: resolve("/project/new") }}
  {phone}
>
  <nav aria-label="Projects" data-client-list class="flex shrink-0 flex-col gap-0.5 pt-3">
    <SectionSidebarLink
      href={homeHref}
      label="Home"
      data-projects-sidebar-home
      active={current === "home"}
      disabled={!homeAvailable}
    >
      {#snippet icon()}<FrameIcon name="home" />{/snippet}
    </SectionSidebarLink>
    <SectionSidebarLink
      href={hrefFor(null)}
      label="All projects"
      data-client-row="all"
      active={current === "projects" && selectedKey === null}
      count={totalLabel}
      onnavigate={select(null)}
    >
      {#snippet icon()}<FrameIcon name="all-projects" />{/snippet}
    </SectionSidebarLink>
  </nav>

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
              active={current === "projects" && client.key === selectedKey}
              count={client.projectCount}
              onnavigate={select(client.key)}
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

  {#snippet footer()}
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
  {/snippet}
</SectionSidebar>
