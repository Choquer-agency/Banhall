<!--
  The right side of the Projects page (Paper W1, V1 and V4; 2026-10-14
  amendment). With a client selected: the client name as a serif title with
  no subtext, a search scoped to that client, Select, and the client's
  project cards grouped by fiscal year (groupProjectsByFiscalYear). With no
  client: "All clients", a search across every project, and the recently
  edited projects, each card naming its client.

  Selecting (Paper Z7n, 2026-10-19): a checkbox shows on a card's hover
  (and on keyboard focus and touch). Once one card is ticked every card
  shows its checkbox, a click anywhere on a card toggles it, and a light
  grey bar at the bottom reads "N selected of M" with Edit details and
  Clear; Esc clears. A selection holds at most 200 projects, all of them on
  screen: a project that leaves the visible set drops out of the selection.
  Edit details and bulk edit go through the host's callbacks (the host
  opens its dialogs).
-->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { resolve } from "$app/paths";
  import { usePaginatedQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { DASHBOARD_PROJECT_PAGE_SIZE } from "../../../../shared/dashboardProjection";
  import ProjectCard from "./ProjectCard.svelte";
  import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";
  import ProjectCardMenu from "./ProjectCardMenu.svelte";
  import { IconArrowLeft, IconSearch } from "$lib/components/icons";
  import { isOpen, openByRule, readOverrides, writeOverrides } from "$lib/projects/fiscalYearOpen";
  import { toProjectsTableRow, type DashboardProjectionRow } from "$lib/workspace/projectRowMapping";
  import {
    formatYearEnd,
    groupProjectsByFiscalYear,
    withLoadState,
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
    canSelect = false,
    canDelete,
    onEditDetails,
    onDuplicate,
    onDelete,
    onBulkEdit,
    onRetry,
    onBack = undefined,
    backLabel = "All companies",
    allClientsHref = "/projects",
    onShowAll = undefined,
    countLabel = null,
  }: {
    /**
     * The selected client; null for All clients. `name` is null until known.
     * `missing`: the loaded client list does not hold this key (a merged
     * client, or an old link).
     */
    client: { key: string; name: string | null; missing?: boolean } | null;
    initialSearch?: string;
    canCreate?: boolean;
    canDuplicate?: boolean;
    /** Select and bulk edit: roles bulkUpdateProjects accepts (Consultant, Manager, Admin). */
    canSelect?: boolean;
    canDelete: (row: ProjectsTableRow) => boolean;
    onEditDetails: (projectId: string) => void;
    onDuplicate: (projectId: string) => void;
    onDelete: (project: { id: string; title: string }) => void;
    onBulkEdit: (rows: DashboardProjectionRow[]) => void;
    onRetry: () => void;
    /** Small screens: back to the client list. */
    onBack?: () => void;
    backLabel?: string;
    /** All clients, for a client that is no longer in the list. */
    allClientsHref?: string;
    onShowAll?: () => void;
    /** How many projects the title stands for ("10", "1000+"), from the company list. */
    countLabel?: string | null;
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
  // While more pages can load, the last loaded fiscal year (and No fiscal
  // year) may still grow: "3+ projects", and no Short year tag yet.
  const groups = $derived(client && !q ? withLoadState(groupProjectsByFiscalYear(raw), hasMore) : []);
  const gone = $derived(Boolean(client?.missing) && client?.name == null && raw.length === 0);
  const displayName = $derived(
    client
      ? (client.name ?? raw.find((row) => row.clientName)?.clientName ?? (client.missing ? "Company not found" : client.key))
      : "All companies"
  );
  const searchLabel = $derived("Search projects");

  // ─── Fiscal year sections (Paper 2V1W-0; the smart rule, 2026-10-19) ──────
  // Read with the company key, before the first frame, so one company's
  // toggles never show on another.
  let overridesVersion = $state(0);
  const overrides = $derived.by(() => {
    void overridesVersion;
    return client ? readOverrides(client.key) : {};
  });
  const openRule = $derived(openByRule(groups));
  function sectionOpen(key: string) {
    return isOpen(key, openRule, overrides);
  }
  function toggleSection(key: string) {
    if (!client) return;
    const next = { ...overrides, [key]: !sectionOpen(key) };
    writeOverrides(client.key, next);
    overridesVersion += 1;
  }

  /**
   * The projects on screen: in a company's view only those in open fiscal
   * year sections, so select all, the selection and bulk edit never reach
   * a project inside a closed section.
   */
  const shownRows = $derived(
    client && !q ? groups.filter((group) => sectionOpen(group.key)).flatMap((group) => group.rows) : raw
  );

  // ─── Selection (Paper Z7n) ────────────────────────────────────────────────
  const selected = new SvelteMap<string, DashboardProjectionRow>();
  /** Something is ticked: every card shows its checkbox and the bar shows. */
  const selecting = $derived(selected.size > 0);
  let limitHit = $state(false);

  /** The last input was a key press (not a pointer). */
  let keyboardInput = false;

  /**
   * Ticking the first card or unticking the last swaps the card's controls
   * (hover checkbox, whole-card toggle, title link). When focus was on the
   * control that left, put it on the same card's new one.
   */
  async function keepCardFocus(id: string) {
    // Pointer users keep the browser's own focus; only the keyboard needs it.
    if (!keyboardInput) return;
    await tick();
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    const escaped = CSS.escape(id);
    document
      .querySelector<HTMLElement>(
        `[data-card-select="${escaped}"], [data-card-select-box="${escaped}"]`
      )
      ?.focus();
  }

  /** The bar left with focus in it (Clear, Escape): focus the client title. */
  async function keepAreaFocus() {
    await tick();
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    document.querySelector<HTMLElement>("[data-client-title]")?.focus();
  }

  function toggle(source: DashboardProjectionRow) {
    void keepCardFocus(source._id);
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

  /**
   * The selected projects as they stand now (reactive): the bulk edit panel
   * follows this, so a project that leaves the visible set leaves the panel.
   */
  export function selectedRows(): DashboardProjectionRow[] {
    return [...selected.values()];
  }

  /** Empties the selection (after a bulk edit is saved). */
  export function clearSelection() {
    selected.clear();
    limitHit = false;
  }

  /** Leaves the selection (after a bulk edit is applied). */
  export function endSelect() {
    clearSelection();
  }

  // Selection hygiene: the selection only ever holds projects on screen. A
  // project that leaves the visible set (moved to another client, deleted,
  // or no longer matching the search) drops out of the selection, so bulk
  // edit never changes a project the person cannot see. Rows still shown are
  // refreshed, so the bulk edit's "Now:" lines read the latest values.
  $effect(() => {
    if (!selecting || loadingFirst || activeQ.error) return;
    const visible = new Map(shownRows.map((row) => [row._id, row]));
    untrack(() => {
      for (const [id, row] of selected) {
        const latest = visible.get(id);
        if (!latest) selected.delete(id);
        else if (latest !== row) selected.set(id, latest);
      }
    });
  });

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!selecting || event.key !== "Escape" || event.defaultPrevented) return;
    // An open dialog or menu takes Escape for itself.
    if (document.querySelector('[role="dialog"], [role="menu"]')) return;
    endSelect();
    void keepAreaFocus();
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
  // Paper Z11a: four cards a row at 1440 (and at 1280 with the rail
  // collapsed), five at 1920.
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))] gap-3";
</script>

<svelte:window
  onkeydown={handleWindowKeydown}
  onkeydowncapture={() => (keyboardInput = true)}
  onpointerdowncapture={() => (keyboardInput = false)}
/>

{#snippet card(source: DashboardProjectionRow, showCompany: boolean, showFiscalYear = false)}
  {@const row = tableRows.get(source._id) ?? toProjectsTableRow(source)}
  <li class="min-w-0">
    <ProjectCard
      {row}
      createdAt={source.createdAt ?? source._creationTime}
      updatedAt={source.updatedAt}
      {showCompany}
      {showFiscalYear}
      selectable={canSelect}
      selected={selected.has(source._id)}
      selectionActive={selecting}
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
    </ProjectCard>
  </li>
{/snippet}


{#snippet selectAllButton(rows: readonly DashboardProjectionRow[], label: string)}
  <button type="button" data-select-group onclick={() => selectAll(rows)} class={`${textButton} text-[0.8125rem]`}>{label}</button>
{/snippet}

{#snippet fiscalGroup(group: ProjectFiscalGroup<DashboardProjectionRow> & { more: boolean }, first: boolean)}
  {@const headingId = `projects-${group.key}`}
  {@const open = sectionOpen(group.key)}
  <section aria-labelledby={headingId} data-fy-group={group.key} data-open={open ? "true" : "false"} class={first ? "" : "pt-8"}>
    <div class="flex min-w-0 items-center gap-3" data-fy-header>
      <h3 id={headingId} class="flex min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${headingId}-cards`}
          data-fy-toggle={group.key}
          onclick={() => toggleSection(group.key)}
          class="flex min-w-0 flex-1 items-baseline gap-2.5 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          {#if group.fiscalYear === null || group.yearEnd === null}
            <span class="text-[0.9375rem] leading-5 font-medium text-ink">No fiscal year</span>
          {:else}
            <span class="shrink-0 text-[0.9375rem] leading-5 font-medium text-ink">FY {group.fiscalYear}</span>
            <span class="truncate text-sm leading-[1.125rem] text-ink-muted">{formatYearEnd(group.yearEnd)}</span>
            {#if group.shortYearMonths !== null}
              <span data-short-year class="flex h-5 shrink-0 items-center self-center rounded-[0.3125rem] bg-gray-50 px-[0.4375rem] text-xs leading-4 text-ink-secondary">{shortYearLabel(group.shortYearMonths)}</span>
            {/if}
          {/if}
          <span class="flex-1"></span>
          <span class="shrink-0 text-[0.8125rem] leading-4 text-ink-muted" data-fy-count>{projectCountLabel(group.rows.length, group.more)}</span>
          <svg class={`size-3.5 shrink-0 self-center text-ink-secondary transition-transform motion-reduce:transition-none ${open ? "" : "rotate-180"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
        </button>
      </h3>
      {#if selecting && open}{@render selectAllButton(group.rows, "Select all")}{/if}
    </div>
    {#if open}
      <ul id={`${headingId}-cards`} class={`${grid} pt-3.5`}>
        {#each group.rows as source (source._id)}
          {@render card(source, false)}
        {/each}
      </ul>
    {/if}
  </section>
{/snippet}

<section aria-label={displayName} class="relative flex min-h-0 min-w-0 flex-1 flex-col" data-client-area={client?.key ?? "all"}>
  <div class={`min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 ${selecting ? "pb-24" : "pb-8"}`} data-client-area-scroll>
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

    <!-- Paper Z3d: the company name at 20/500 with its project count, the
         search on the right, 28px above the first fiscal year. -->
    <div class="flex flex-wrap items-center gap-3 pb-7 pt-5 max-md:pt-1" data-client-header>
      <h2 data-client-title tabindex="-1" class="min-w-0 truncate text-xl leading-[1.625rem] font-medium text-ink outline-none">{displayName}</h2>
      {#if countLabel !== null && !gone}
        <span class="shrink-0 text-[0.9375rem] leading-5 text-ink-muted" data-client-count>{countLabel === "1" ? "1 project" : `${countLabel} projects`}</span>
      {/if}
      <div class="flex-1"></div>
      {#if selecting}
        {@render selectAllButton(shownRows, `Select all ${shownRows.length}${hasMore ? "+" : ""}`)}
      {/if}
      <div role="search" class="relative w-80 max-w-full max-md:order-last max-md:w-full">
        <IconSearch size={14} strokeWidth={2} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
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
          class="field-control h-9 w-full rounded-lg pl-[2.125rem] pr-3 text-sm leading-[1.125rem] text-ink placeholder:text-ink-muted pointer-coarse:h-11"
        />
      </div>
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
        <div class="flex items-baseline gap-3 pb-3.5">
          <h3 id="projects-search-results" class="text-[0.9375rem] leading-5 font-medium text-ink" role="status">
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
    {:else if gone}
      <div class="flex flex-col items-start gap-3 py-10" data-client-missing>
        <p class="text-[0.8125rem] leading-[1.125rem] text-ink-secondary">This company is no longer in the company list. It may have been merged.</p>
        <a
          href={allClientsHref}
          data-client-missing-back
          onclick={(event) => {
            if (!onShowAll) return;
            event.preventDefault();
            onShowAll();
          }}
          class="text-[0.8125rem] leading-[1.125rem] font-medium text-primary-selected hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy pointer-coarse:min-h-11"
        >Go to All companies</a>
      </div>
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
        {@render fiscalGroup(group, index === 0)}
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
        <div class="flex items-baseline gap-3">
          <h3 id="projects-recent" class="text-[0.9375rem] leading-5 font-medium text-ink">Recently updated</h3>
          {#if selecting}{@render selectAllButton(raw, "Select all")}{/if}
        </div>
        <ul class={`${grid} pt-3.5`}>
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
        class="pointer-events-auto flex h-12 w-full max-w-[28.75rem] items-center gap-2 rounded-[0.625rem] border border-line bg-gray-50 pl-4 pr-2 shadow-selection-bar"
      >
        <p class="flex min-w-0 items-baseline gap-1.5" aria-live="polite" data-selection-count>
          <span class="text-sm leading-5 font-medium text-ink">{selected.size} selected</span>
          <span class="text-[0.8125rem] leading-4 text-ink-muted">of {shownRows.length}{hasMore ? "+" : ""}</span>
        </p>
        <div class="flex-1"></div>
        <button
          type="button"
          data-selection-edit
          onclick={() => onBulkEdit([...selected.values()])}
          class="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[0.8125rem] leading-[1.125rem] font-medium text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11"
        >Edit details</button>
        <button
          type="button"
          data-selection-clear
          onclick={() => {
            clearSelection();
            void keepAreaFocus();
          }}
          class="flex h-8 items-center rounded-lg px-2.5 text-[0.8125rem] leading-[1.125rem] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11"
        >Clear</button>
      </div>
    </div>
  {/if}
</section>
