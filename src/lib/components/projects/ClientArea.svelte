<!--
  The right side of the Projects page (Paper W1, V1 and V4; 2026-10-14
  amendment). With a client selected: the client name as a serif title with
  no subtext, a search scoped to that client, Select, and the client's
  project cards grouped by fiscal year (groupProjectsByFiscalYear). With no
  client: "All clients", a search across every project, and the recently
  edited projects, each card naming its client.

  Select turns the cards into checkboxes with a dark bottom bar (Edit
  details, Clear, Done); Esc leaves it. A selection holds at most 200
  projects. Edit details and bulk edit go through the host's callbacks so a
  later step can swap them for side panels.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { resolve } from "$app/paths";
  import { usePaginatedQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { DASHBOARD_PROJECT_PAGE_SIZE } from "../../../../shared/dashboardProjection";
  import ProjectBoardCard from "$lib/components/workspace/ProjectBoardCard.svelte";
  import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";
  import ProjectCardMenu from "./ProjectCardMenu.svelte";
  import { IconArrowLeft, IconClock, IconSearch } from "$lib/components/icons";
  import { toProjectsTableRow, type DashboardProjectionRow } from "$lib/workspace/projectRowMapping";
  import {
    formatYearEnd,
    groupProjectsByFiscalYear,
    projectCountLabel,
    shortYearLabel,
    type ProjectFiscalGroup,
  } from "$lib/projects/fiscalYearGroups";
  import { addToSelection, newProjectSearch, PROJECT_SELECTION_LIMIT } from "$lib/projects/clientList";

  let {
    client,
    initialSearch = "",
    canCreate = false,
    canDuplicate = false,
    canDelete,
    onEditDetails,
    onDuplicate,
    onDelete,
    onBulkEdit,
    onRetry,
    onBack = undefined,
    backLabel = "All clients",
  }: {
    /** The selected client; null for All clients. `name` is null until known. */
    client: { key: string; name: string | null } | null;
    initialSearch?: string;
    canCreate?: boolean;
    canDuplicate?: boolean;
    canDelete: (row: ProjectsTableRow) => boolean;
    onEditDetails: (projectId: string) => void;
    onDuplicate: (projectId: string) => void;
    onDelete: (project: { id: string; title: string }) => void;
    onBulkEdit: (rows: DashboardProjectionRow[]) => void;
    onRetry: () => void;
    /** Small screens: back to the client list. */
    onBack?: () => void;
    backLabel?: string;
  } = $props();

  const auth = useAuth();
  const PAGE = DASHBOARD_PROJECT_PAGE_SIZE;

  let searchInput = $state(untrack(() => initialSearch));
  // Settled (debounced) query, seeded so a handed-over search subscribes once.
  let q = $state(untrack(() => initialSearch.trim()));
  let searchEl: HTMLInputElement | null = $state(null);

  $effect(() => {
    const next = searchInput.trim();
    if (next === untrack(() => q)) return;
    const timer = setTimeout(() => (q = next), 250);
    return () => clearTimeout(timer);
  });

  const companyQ = usePaginatedQuery(
    api.dashboard.listCompanyProjects,
    () => (auth.isAuthenticated && client && !q ? { companyKey: client.key } : "skip"),
    { initialNumItems: PAGE }
  );
  const recentQ = usePaginatedQuery(
    api.dashboard.listFlatProjects,
    () => (auth.isAuthenticated && !client && !q ? { sortBy: "updated" as const } : "skip"),
    { initialNumItems: PAGE }
  );
  const searchQ = usePaginatedQuery(
    api.dashboard.searchProjects,
    () =>
      auth.isAuthenticated && q
        ? { search: q, ...(client ? { companyKey: client.key } : {}) }
        : "skip",
    { initialNumItems: PAGE }
  );

  const activeQ = $derived(q ? searchQ : client ? companyQ : recentQ);
  const raw = $derived(activeQ.results as unknown as DashboardProjectionRow[]);
  const tableRows = $derived(new Map(raw.map((source) => [source._id, toProjectsTableRow(source)])));
  const loadingFirst = $derived(activeQ.status === "LoadingFirstPage" && !activeQ.error);
  const hasMore = $derived(activeQ.status === "CanLoadMore" || activeQ.status === "LoadingMore");
  const groups = $derived(client && !q ? groupProjectsByFiscalYear(raw) : []);
  const displayName = $derived(
    client ? (client.name ?? raw.find((row) => row.clientName)?.clientName ?? client.key) : "All clients"
  );
  const searchLabel = $derived(client ? `Search ${displayName}` : "Search all projects");

  // ─── Select mode (Paper V4) ───────────────────────────────────────────────
  let selecting = $state(false);
  const selected = new SvelteMap<string, DashboardProjectionRow>();
  let limitHit = $state(false);

  function toggle(source: DashboardProjectionRow) {
    if (selected.has(source._id)) {
      selected.delete(source._id);
      limitHit = false;
    } else if (selected.size >= PROJECT_SELECTION_LIMIT) {
      limitHit = true;
    } else {
      selected.set(source._id, source);
    }
  }

  function selectAll(rows: readonly DashboardProjectionRow[]) {
    const result = addToSelection([...selected.keys()], rows.map((row) => row._id));
    const byId = new Map(rows.map((row) => [row._id, row]));
    for (const id of result.ids) {
      const row = byId.get(id);
      if (row && !selected.has(id)) selected.set(id, row);
    }
    limitHit = result.refused;
  }

  /** Empties the selection (after a bulk edit is saved). */
  export function clearSelection() {
    selected.clear();
    limitHit = false;
  }

  function endSelect() {
    selecting = false;
    clearSelection();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!selecting || event.key !== "Escape" || event.defaultPrevented) return;
    // An open dialog or menu takes Escape for itself.
    if (document.querySelector('[role="dialog"], [role="menu"]')) return;
    endSelect();
  }

  /** Focus the page search (the rail's search and Home's search handoff). */
  export function focusSearch(options: { select?: boolean } = {}) {
    const input = searchEl;
    if (!input) return;
    input.focus();
    if (options.select ?? true) {
      input.select();
    } else {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }

  function clearSearch() {
    searchInput = "";
    q = "";
  }

  // Another client (or All clients): start from its unfiltered projects,
  // out of select mode.
  let shownKey = untrack(() => client?.key ?? null);
  $effect(() => {
    const key = client?.key ?? null;
    if (key === shownKey) return;
    shownKey = key;
    untrack(() => {
      clearSearch();
      endSelect();
    });
  });

  const quietButton =
    "flex h-[1.875rem] shrink-0 items-center rounded-[0.4375rem] border border-line px-2.5 text-[0.8125rem] leading-[1.125rem] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11";
  const textButton =
    "shrink-0 rounded-md text-xs leading-4 font-medium text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11";
  const barButton =
    "flex h-[1.875rem] items-center rounded-[0.4375rem] px-2.5 text-[0.8125rem] leading-[1.125rem] text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-light disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11";
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3";
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#snippet card(source: DashboardProjectionRow, showClient: boolean, showFiscalYear: boolean)}
  {@const row = tableRows.get(source._id) ?? toProjectsTableRow(source)}
  <li>
    <ProjectBoardCard
      {row}
      {showClient}
      {showFiscalYear}
      showStage
      selectable={selecting}
      selected={selected.has(source._id)}
      onToggleSelect={() => toggle(source)}
    >
      {#snippet actions()}
        <ProjectCardMenu
          projectId={row.id}
          projectTitle={row.title}
          canDuplicate={canDuplicate && !row.deleting}
          canDelete={canDelete(row)}
          onEditDetails={() => onEditDetails(row.id)}
          onDuplicate={() => onDuplicate(row.id)}
          onDelete={() => onDelete({ id: row.id, title: row.title })}
        />
      {/snippet}
    </ProjectBoardCard>
  </li>
{/snippet}

{#snippet calendarIcon(muted: boolean)}
  <svg class={`size-[0.8125rem] shrink-0 ${muted ? "text-ink-faint" : "text-ink-secondary"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={muted ? "M8 3v3 M16 3v3 M4 9h16 M5 5h14v15H5Z M9.5 13l5 4 M14.5 13l-5 4" : "M8 3v3 M16 3v3 M4 9h16 M5 5h14v15H5Z"} />
  </svg>
{/snippet}

{#snippet selectAllButton(rows: readonly DashboardProjectionRow[], label: string)}
  <button type="button" data-select-group onclick={() => selectAll(rows)} class={`${textButton} font-normal text-ink-secondary`}>{label}</button>
{/snippet}

{#snippet fiscalGroup(group: ProjectFiscalGroup<DashboardProjectionRow>, last: boolean)}
  {@const headingId = `projects-${group.key}`}
  <section aria-labelledby={headingId} data-fy-group={group.key}>
    <div class="flex h-[2.125rem] items-center gap-2" data-fy-header>
      {@render calendarIcon(group.fiscalYear === null)}
      {#if group.fiscalYear === null || group.yearEnd === null}
        <h3 id={headingId} class="text-xs leading-4 font-medium text-ink-muted">No fiscal year</h3>
      {:else}
        <h3 id={headingId} class="flex min-w-0 items-baseline gap-2 text-xs leading-4">
          <span class="font-medium text-ink">FY {group.fiscalYear}</span>
          <span class="truncate text-ink-muted">ended {formatYearEnd(group.yearEnd)}</span>
        </h3>
        {#if group.shortYearMonths !== null}
          <span data-short-year class="flex h-5 shrink-0 items-center rounded-[0.3125rem] bg-gray-50 px-[0.4375rem] text-[0.6875rem] leading-[0.875rem] text-ink-secondary">{shortYearLabel(group.shortYearMonths)}</span>
        {/if}
      {/if}
      {#if selecting}{@render selectAllButton(group.rows, "Select all")}{/if}
      <span class="ml-auto shrink-0 text-xs leading-4 text-ink-muted" data-fy-count>{projectCountLabel(group.rows.length, last && hasMore)}</span>
    </div>
    <ul class={`${grid} pb-2`}>
      {#each group.rows as source (source._id)}
        {@render card(source, false, false)}
      {/each}
    </ul>
  </section>
{/snippet}

<section aria-label={displayName} class="relative flex min-h-0 min-w-0 flex-1 flex-col" data-client-area={client?.key ?? "all"}>
  <div class={`min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 ${selecting ? "pb-24" : "pb-6"}`} data-client-area-scroll>
    {#if onBack}
      <button
        type="button"
        data-client-back
        onclick={onBack}
        class="-ml-1 mt-3 flex h-11 items-center gap-1.5 rounded-md px-1 text-[0.8125rem] text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy md:hidden"
      >
        <IconArrowLeft size={14} />
        {backLabel}
      </button>
    {/if}

    <div class="flex flex-wrap items-center gap-2 pb-3 pt-5 max-md:pt-1" data-client-header>
      <h2 data-client-title class="min-w-0 truncate font-serif text-[1.625rem] leading-8 tracking-[-0.01em] text-ink">{displayName}</h2>
      <div class="flex-1"></div>
      {#if selecting}
        {@render selectAllButton(raw, `Select all ${raw.length}${hasMore ? "+" : ""}`)}
        <button type="button" data-select-done onclick={endSelect} class={`${quietButton} font-medium text-ink`}>Done</button>
      {:else}
        <div role="search" class="relative w-[16.25rem] max-w-full max-md:order-last max-md:w-full">
          <IconSearch size={14} strokeWidth={1.4} class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            bind:this={searchEl}
            bind:value={searchInput}
            type="search"
            data-client-search
            aria-label={searchLabel}
            placeholder={searchLabel}
            autocomplete="off"
            onkeydown={(event) => {
              if (event.key !== "Escape") return;
              if (searchInput) {
                event.stopPropagation();
                clearSearch();
              } else {
                event.currentTarget.blur();
              }
            }}
            class="field-control h-[1.875rem] w-full rounded-[0.4375rem] bg-gray-50! pl-7 pr-2 text-[0.8125rem] leading-[1.125rem] text-ink placeholder:text-ink-faint pointer-coarse:h-11"
          />
        </div>
        <button type="button" data-select-start onclick={() => (selecting = true)} class={quietButton}>Select</button>
      {/if}
    </div>

    {#if activeQ.error}
      <div class="flex flex-col items-start gap-2 py-10" role="alert" data-projects-error>
        <p class="text-[0.8125rem] leading-[1.125rem] text-ink">Projects could not be loaded.</p>
        <button type="button" onclick={onRetry} class={quietButton}>Try again</button>
      </div>
    {:else if loadingFirst}
      <div role="status" aria-label="Loading projects" data-projects-loading>
        <div class="flex h-[2.125rem] items-center">
          <span class="h-3 w-40 animate-pulse rounded bg-chrome motion-reduce:animate-none"></span>
        </div>
        <div class={grid}>
          {#each [0, 1, 2, 3, 4, 5] as item (item)}
            <div class="h-40 animate-pulse rounded-xl bg-chrome motion-reduce:animate-none"></div>
          {/each}
        </div>
      </div>
    {:else if q}
      <section aria-labelledby="projects-search-results" data-search-results>
        <div class="flex h-[2.125rem] items-center gap-2">
          <h3 id="projects-search-results" class="text-xs leading-4 text-ink-secondary" role="status">
            {raw.length === 0
              ? `No projects match "${q}".`
              : `${raw.length}${hasMore ? "+" : ""} ${raw.length === 1 && !hasMore ? "project matches" : "projects match"}`}
          </h3>
          <button type="button" data-search-clear onclick={clearSearch} class={textButton}>Clear</button>
          {#if selecting && raw.length > 0}{@render selectAllButton(raw, "Select all")}{/if}
        </div>
        {#if raw.length > 0}
          <ul class={grid}>
            {#each raw as source (source._id)}
              {@render card(source, !client, true)}
            {/each}
          </ul>
        {/if}
      </section>
    {:else if client && raw.length === 0}
      <div class="flex flex-col items-start gap-3 py-10" data-client-empty>
        <p class="text-[0.8125rem] leading-[1.125rem] text-ink-secondary">{displayName} has no projects yet.</p>
        {#if canCreate}
          <a
            href={`${resolve("/project/new")}${newProjectSearch(displayName)}`}
            data-client-new-project
            class="inline-flex h-8 items-center rounded-[0.4375rem] bg-primary-selected px-3 text-[0.8125rem] font-medium text-white hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:h-11"
          >New project</a>
        {/if}
      </div>
    {:else if client}
      {#each groups as group, index (group.key)}
        {@render fiscalGroup(group, index === groups.length - 1)}
      {/each}
    {:else if raw.length === 0}
      <div class="flex flex-col items-start gap-3 py-10" data-client-empty>
        <p class="text-[0.8125rem] leading-[1.125rem] text-ink-secondary">No projects yet.</p>
        {#if canCreate}
          <a
            href={resolve("/project/new")}
            class="inline-flex h-8 items-center rounded-[0.4375rem] bg-primary-selected px-3 text-[0.8125rem] font-medium text-white hover:bg-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:h-11"
          >New project</a>
        {/if}
      </div>
    {:else}
      <section aria-labelledby="projects-recent" data-recent-projects>
        <div class="flex h-[2.125rem] items-center gap-2">
          <IconClock size={13} strokeWidth={1.4} class="shrink-0 text-ink-secondary" />
          <h3 id="projects-recent" class="text-xs leading-4 font-medium text-ink">Recently edited</h3>
          {#if selecting}{@render selectAllButton(raw, "Select all")}{/if}
        </div>
        <ul class={grid}>
          {#each raw as source (source._id)}
            {@render card(source, true, true)}
          {/each}
        </ul>
      </section>
    {/if}

    {#if hasMore && !activeQ.error && !loadingFirst}
      <div class="flex justify-center pt-4">
        <button
          type="button"
          data-show-more
          disabled={activeQ.status === "LoadingMore"}
          onclick={() => activeQ.loadMore(PAGE)}
          class={quietButton}
        >{activeQ.status === "LoadingMore" ? "Loading..." : "Show more"}</button>
      </div>
    {/if}
  </div>

  {#if selecting}
    <div class="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-4">
      {#if limitHit}
        <p role="status" data-selection-limit class="pointer-events-auto rounded-lg bg-surface px-3 py-1.5 text-xs leading-4 text-ink-secondary shadow-menu">
          You can select up to {PROJECT_SELECTION_LIMIT} projects at a time.
        </p>
      {/if}
      <div
        role="toolbar"
        aria-label="Selected projects"
        data-selection-bar
        class="pointer-events-auto flex h-11 w-full max-w-[28.75rem] items-center gap-1 rounded-[0.6875rem] bg-ink pl-3.5 pr-1.5 shadow-toast-dark"
      >
        <p class="text-[0.8125rem] leading-[1.125rem] font-medium text-white" aria-live="polite" data-selection-count>{selected.size} selected</p>
        <div class="flex-1"></div>
        <button
          type="button"
          data-selection-edit
          disabled={selected.size === 0}
          onclick={() => onBulkEdit([...selected.values()])}
          class={`${barButton} bg-white/15`}
        >Edit details</button>
        <button type="button" data-selection-clear disabled={selected.size === 0} onclick={clearSelection} class={barButton}>Clear</button>
        <span aria-hidden="true" class="mx-1 h-[1.125rem] w-px bg-white/20"></span>
        <button type="button" data-selection-done onclick={endSelect} class={barButton}>Done</button>
      </div>
    </div>
  {/if}
</section>
