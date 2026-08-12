<script lang="ts">
  // Projects is a read-only repository projection. The default presentation
  // is the workflow-stage kanban Board (product-domain amendment 2026-08-05:
  // canonical WORKFLOW_STAGE_PIPELINE_ORDER columns plus the explicitly
  // qualified Legacy status column), with the sparse List one click away.
  // Obvious contributes the interaction borrows — debounced ⌘K search,
  // compact calm toolbar of recessed chrome pills, quiet show-more — while
  // Banhall's bounded queries, canonical stage tones, Owner truth, activity
  // distinction, and report links stay authoritative. Surfaces are the
  // light workspace plane (token-driven; see layout.css light scope).
  import { untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { usePaginatedQuery, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import { DASHBOARD_PROJECT_PAGE_SIZE } from "../../../../shared/dashboardProjection";
  import ViewModeToggle from "$lib/components/ui/ViewModeToggle.svelte";
  import ProjectsBoard from "$lib/components/workspace/ProjectsBoard.svelte";
  import GhostPopover from "$lib/components/ui/GhostPopover.svelte";
  import BoardFiltersPopover from "$lib/components/workspace/BoardFiltersPopover.svelte";
  import ProjectsDisplayMenu from "$lib/components/workspace/ProjectsDisplayMenu.svelte";
  import ProjectsClientGroups from "$lib/components/workspace/ProjectsClientGroups.svelte";
  import ProjectsTable from "$lib/components/workspace/ProjectsTable.svelte";
  import { toProjectsTableRow } from "$lib/workspace/projectRowMapping";
  import { searchShortcutHint } from "$lib/workspace/searchContinuity";
  import {
    parseHideEmptyParam,
    parseProjectGroupParam,
    parseProjectLayoutParam,
    parseProjectsTablePreferences,
    serializeProjectsTablePreferences,
    withHideEmptyParam,
    withProjectGroupParam,
    withProjectLayoutParam,
    type ProjectColumnId,
    type ProjectGroupMode,
    type ProjectLayoutMode,
    type ProjectsTablePreferences,
  } from "$lib/dashboard/projectsTablePreferences";
  import {
    stageFilterItemsFromCounts,
    stageFilterLabel,
    type StageFilter,
  } from "$lib/dashboard/stageFilter";
  import { stageBadgeClasses } from "$lib/workflow/stagePresentation";
  import { WORKFLOW_STAGES, type WorkflowStage } from "../../../../shared/workflowStages";

  type FlatResult = FunctionReturnType<typeof api.dashboard.listFlatProjects>;
  type ProjectRow = FlatResult["page"][number];
  type SortBy = "updated" | "created" | "viewed";

  const SORTS: { value: SortBy; label: string }[] = [
    { value: "updated", label: "Recently edited" },
    { value: "created", label: "Recently created" },
    { value: "viewed", label: "Recently viewed" },
  ];
  const COLUMN_OPTIONS: { id: ProjectColumnId; label: string }[] = [
    { id: "clientName", label: "Client name" },
    { id: "stage", label: "Stage" },
    { id: "owner", label: "Owner" },
    { id: "generationActivity", label: "AI activity" },
    { id: "updated", label: "Updated" },
  ];
  const PREFS_KEY = "banhall.projectsTablePreferences";
  const SKELETON_ITEMS = [0, 1, 2, 3];

  let { externalSearch }: { externalSearch?: string } = $props();
  const auth = useAuth();
  let searchInput = $state("");
  // Settled (debounced) query. Seeded from an already-typed external query
  // (the /my-work → /projects search handoff) so the first subscribed
  // server query is the search, not a discarded unfiltered page. The
  // initial-value capture is deliberate: later changes settle through the
  // debounce effect below.
  // svelte-ignore state_referenced_locally
  let search = $state((externalSearch ?? "").trim());
  let searchElement: HTMLInputElement | null = $state(null);
  let sortBy = $state<string>("updated");
  let stage = $state<string>("all");
  // Owner filter (Obvious filter anatomy, 2026-08-10) — server-indexed via
  // the same listFlatProjects/searchProjects args as stage. The label is
  // captured at pick time so the chip never needs a standing team query.
  let filterOwner = $state<string | null>(null);
  let filterOwnerLabel = $state<string | null>(null);
  let filtersOpen = $state(false);
  // Popover instance — value mode opens anchored to a condition chip's value
  // segment (Obvious behavior: pick a field, the chip appears immediately,
  // and the value list opens from the chip, not from the Filters button).
  let filtersPopover: {
    openTo: (field: "stage" | "owner", anchor?: HTMLElement | null) => void;
    openFields: (anchor?: HTMLElement | null) => void;
  } | null = $state(null);
  // Fields picked but no value yet — each renders a placeholder condition
  // chip that filters nothing and persists until its value is chosen (via
  // the chip's "Select…" segment) or its × removes it (owner direction,
  // 2026-08-10: picking a field never auto-opens the value list).
  let pendingFilters = $state<{ stage: boolean; owner: boolean }>({ stage: false, owner: false });

  function handleFieldPick(field: "stage" | "owner") {
    pendingFilters[field] = true;
  }
  let preferences = $state<ProjectsTablePreferences>(parseProjectsTablePreferences(null));
  let preferencesLoaded = $state(false);
  // Both search paths — the standalone field below AND the workspace
  // header's `externalSearch` — settle through the same debounce, so the
  // server sees one query transition per settled query, never one per
  // keystroke (the external path previously bypassed the debounce).
  const rawSearch = $derived(externalSearch ?? searchInput);
  const q = $derived(search);
  const selectedStage = $derived(stage === "all" ? undefined : stage as Exclude<StageFilter, "all">);
  // Proper-cased chip label ("Drafting", "Legacy status") — the lowercase
  // stageFilterLabel copy is for mid-sentence use.
  function stageChipLabel(value: string) {
    return stageItems.find((item) => item.value === value)?.label.replace(/ \(\d+\+?\)$/, "") ?? stageFilterLabel(value);
  }
  // Applied stage chips wear the stage's canonical label tint (owner
  // direction, 2026-08-10); legacy/non-workflow values stay neutral ink.
  const stageValueClass = $derived.by(() => {
    if (!selectedStage) return "";
    if (!(WORKFLOW_STAGES as readonly string[]).includes(stage)) return "";
    return stageBadgeClasses(stage as WorkflowStage).badge;
  });
  const urlLayout = $derived(parseProjectLayoutParam(page.url.searchParams.get("layout")));
  // Last URL layout value already applied to `preferences`. Plain (non-state)
  // on purpose: it makes the URL-sync effect edge-triggered on genuine URL
  // changes instead of level-comparing against `preferences.layout` — a level
  // comparison reverts a fresh user selection whenever `page.url` lags the
  // address bar (SvelteKit's shallow replaceState never updates page.url and
  // goto updates it asynchronously; the 2026-08-06 stale-toggle QA failure).
  let lastAppliedUrlLayout: ProjectLayoutMode | null = null;
  const urlGroup = $derived(parseProjectGroupParam(page.url.searchParams.get("group")));
  // Same edge-triggered contract as lastAppliedUrlLayout, for `group=client`.
  let lastAppliedUrlGroup: ProjectGroupMode | null = null;
  // `?hideEmpty=0|1` governs the stage-first board's display option; the
  // client-scoped preference persists in storage only. Same edge-triggered
  // contract as `?layout`.
  const urlHideEmpty = $derived(parseHideEmptyParam(page.url.searchParams.get("hideEmpty")));
  let lastAppliedUrlHideEmpty: boolean | null = null;
  // The `?client=` focused-board param was retired 2026-08-12 (owner
  // direction): lanes show all loaded projects, so the param is ignored
  // here. `/project/new?client=` remains the wizard's own prefill param.
  // Grouped board folds to the grouped List below `md` (no mobile swimlanes).
  let mdUp = $state(true);
  $effect(() => {
    const query = window.matchMedia("(min-width: 48rem)");
    const update = () => {
      mdUp = query.matches;
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  $effect(() => {
    if (preferencesLoaded) return;
    let stored = parseProjectsTablePreferences(null);
    try {
      stored = parseProjectsTablePreferences(localStorage.getItem(PREFS_KEY));
    } catch {
      // The complete default remains available when browser storage is blocked.
    }
    lastAppliedUrlLayout = urlLayout;
    lastAppliedUrlGroup = urlGroup;
    lastAppliedUrlHideEmpty = urlHideEmpty;
    preferences = {
      ...stored,
      layout: urlLayout ?? stored.layout,
      group: urlGroup ?? stored.group,
      hideEmptyBoard: urlHideEmpty ?? stored.hideEmptyBoard,
    };
    preferencesLoaded = true;
  });

  // Apply genuine URL layout changes (back/forward, external navigation),
  // including the retired `grid` param migrating to board via
  // parseProjectLayoutParam. Edge-triggered — see lastAppliedUrlLayout above.
  $effect(() => {
    if (!preferencesLoaded || urlLayout === lastAppliedUrlLayout) return;
    lastAppliedUrlLayout = urlLayout;
    if (!urlLayout) return;
    const current = untrack(() => preferences);
    if (current.layout === urlLayout) return;
    const next = { ...current, layout: urlLayout };
    preferences = next;
    try {
      localStorage.setItem(PREFS_KEY, serializeProjectsTablePreferences(next));
    } catch {
      // URL state still controls the current view when storage is blocked.
    }
  });

  // Apply genuine URL `group` changes (back/forward, shared links) with the
  // same edge-triggered contract as the layout param above.
  $effect(() => {
    if (!preferencesLoaded || urlGroup === lastAppliedUrlGroup) return;
    lastAppliedUrlGroup = urlGroup;
    if (urlGroup === null) return;
    const current = untrack(() => preferences);
    if (current.group === urlGroup) return;
    const next = { ...current, group: urlGroup };
    preferences = next;
    try {
      localStorage.setItem(PREFS_KEY, serializeProjectsTablePreferences(next));
    } catch {
      // URL state still controls the current view when storage is blocked.
    }
  });

  // Apply genuine URL `hideEmpty` changes with the same edge-triggered
  // contract (URL wins over the stored board preference).
  $effect(() => {
    if (!preferencesLoaded || urlHideEmpty === lastAppliedUrlHideEmpty) return;
    lastAppliedUrlHideEmpty = urlHideEmpty;
    if (urlHideEmpty === null) return;
    const current = untrack(() => preferences);
    if (current.hideEmptyBoard === urlHideEmpty) return;
    const next = { ...current, hideEmptyBoard: urlHideEmpty };
    preferences = next;
    try {
      localStorage.setItem(PREFS_KEY, serializeProjectsTablePreferences(next));
    } catch {
      // URL state still controls the current view when storage is blocked.
    }
  });

  $effect(() => {
    const nextSearch = rawSearch.trim();
    if (nextSearch === untrack(() => search)) return;
    const timeout = window.setTimeout(() => {
      search = nextSearch;
    }, 250);
    return () => window.clearTimeout(timeout);
  });

  $effect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (externalSearch !== undefined) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase("en-CA") === "k") {
        event.preventDefault();
        searchElement?.focus();
        searchElement?.select();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  // Client → Status grouping (2026-08-06 second amendment; Focus drill-in
  // retired 2026-08-12): valid on BOTH layouts, search-off, server-backed
  // through ProjectsClientGroups. List = client sections with status
  // sub-headers; Board = stacked client lanes, each rendering the standard
  // stage-column board scoped to that client, folding to the grouped List
  // below `md`.
  const effectiveGroup = $derived(preferences.group);
  const grouped = $derived(effectiveGroup === "client" && !q);
  /** Desktop grouped Board renders the stacked per-client boards. */
  const groupedLanes = $derived(grouped && preferences.layout === "board" && mdUp);
  // Availability of VERIFIED exact per-client stageCounts on the currently
  // mounted client surface — drives the honest disabled state of the
  // client hide-empty control (pre-backfill it cannot take effect).
  let clientCountsAvailable = $state(false);

  const facetsQ = useQuery(api.dashboard.getFacets, () => (auth.isAuthenticated ? {} : "skip"));

  const flatQ = usePaginatedQuery(
    api.dashboard.listFlatProjects,
    () =>
      auth.isAuthenticated && !q && !grouped
        ? {
            sortBy: (SORTS.some((item) => item.value === sortBy) ? sortBy : "updated") as SortBy,
            stage: selectedStage,
            ownerId: (filterOwner ?? undefined) as never,
          }
        : "skip",
    { initialNumItems: DASHBOARD_PROJECT_PAGE_SIZE }
  );
  const searchQ = usePaginatedQuery(
    api.dashboard.searchProjects,
    () =>
      auth.isAuthenticated && q
        ? { search: q, stage: selectedStage, ownerId: (filterOwner ?? undefined) as never }
        : "skip",
    { initialNumItems: DASHBOARD_PROJECT_PAGE_SIZE }
  );

  const activeQ = $derived(q ? searchQ : flatQ);
  const projects = $derived((q ? searchQ.results : flatQ.results) as ProjectRow[]);
  const stageItems = $derived(
    q
      ? stageFilterItemsFromCounts({}, projects.length, activeQ.status !== "Exhausted")
      : stageFilterItemsFromCounts(
          facetsQ.data?.stageCounts ?? {},
          facetsQ.data?.total ?? 0,
          facetsQ.data?.truncated ?? false
        )
  );

  const rows = $derived(projects.map(toProjectsTableRow));
  const loadingFirstPage = $derived(activeQ.status === "LoadingFirstPage");
  const hasMore = $derived(activeQ.status === "CanLoadMore" || activeQ.status === "LoadingMore");
  const countSuffix = $derived(activeQ.status === "Exhausted" ? "" : "+");
  const boundedPage = $derived(
    !grouped &&
      !activeQ.error &&
      !loadingFirstPage &&
      activeQ.status !== "Exhausted" &&
      rows.length < DASHBOARD_PROJECT_PAGE_SIZE
  );
  // Board column counts stay truthful: facet totals when browsing (marked
  // approximate when the facet scan truncated), loaded-row grouping when a
  // relevance search narrows the set (approximate until exhausted).
  const filtered = $derived(Boolean(selectedStage || filterOwner));
  const boardStageCounts = $derived(
    q || filtered ? undefined : facetsQ.data?.stageCounts
  );
  const boardCountsApproximate = $derived(
    q || filtered ? activeQ.status !== "Exhausted" : (facetsQ.data?.truncated ?? false)
  );

  function persistPreferences(next: ProjectsTablePreferences) {
    preferences = next;
    try {
      localStorage.setItem(PREFS_KEY, serializeProjectsTablePreferences(next));
    } catch {
      // Preferences remain usable in memory when browser storage is blocked.
    }
  }

  function toggleColumn(id: ProjectColumnId) {
    persistPreferences({
      ...preferences,
      columns: { ...preferences.columns, [id]: !preferences.columns[id] },
    });
  }

  function setDensity(density: ProjectsTablePreferences["density"]) {
    persistPreferences({ ...preferences, density });
  }

  function setSortBy(value: SortBy) {
    sortBy = value;
  }

  function setGroup(group: ProjectGroupMode) {
    persistPreferences({ ...preferences, group });
    // Grouped sections are index-backed only (client name A→Z, stage-rank
    // order within): the flat filters do not apply there, so they reset
    // rather than silently pretending to filter the groups.
    if (group === "client") {
      stage = "all";
      filterOwner = null;
      filterOwnerLabel = null;
    }
    // Same in-flight guard + stay-on-route navigation as setLayout below.
    lastAppliedUrlGroup = group;
    const url = withProjectGroupParam(page.url, group);
    goto(`${url.pathname}${url.search}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });
  }

  function setHideEmptyBoard(next: boolean) {
    persistPreferences({ ...preferences, hideEmptyBoard: next });
    // Same in-flight guard + stay-on-route navigation as setLayout.
    lastAppliedUrlHideEmpty = next;
    const url = withHideEmptyParam(page.url, next);
    goto(`${url.pathname}${url.search}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });
  }

  function setHideEmptyClientGroups(next: boolean) {
    persistPreferences({ ...preferences, hideEmptyClientGroups: next });
  }

  function setLayout(layout: ProjectLayoutMode) {
    persistPreferences({ ...preferences, layout });
    // The toggle is the source of truth here: mark the target as already
    // applied so the URL-sync effect cannot revert the selection while the
    // navigation is in flight. Navigate with goto (the selectView pattern)
    // rather than shallow replaceState, which never updates page.url and
    // left the rendered layout and pressed state stale until reload.
    lastAppliedUrlLayout = layout;
    // Stay on the current route: the view mounts on the canonical /projects
    // URL (and on /dashboard during the compatibility window), so the layout
    // toggle must never bounce through a hardcoded /dashboard path.
    const url = withProjectLayoutParam(page.url, layout);
    goto(`${url.pathname}${url.search}`, {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });
  }

  function clearSearchAndFilters() {
    searchInput = "";
    search = "";
    stage = "all";
    filterOwner = null;
    filterOwnerLabel = null;
  }

  function handleSearchKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
    if (event.key !== "Escape") return;
    searchInput = "";
    search = "";
    event.currentTarget.blur();
  }
</script>

<section aria-label="Projects repository" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <div class="shrink-0 border-b border-line-soft py-2">
    {#if externalSearch === undefined}
      <div class="relative mb-2 min-w-0 sm:max-w-[19rem]" role="search">
        <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          bind:this={searchElement}
          bind:value={searchInput}
          onkeydown={handleSearchKeydown}
          aria-label="Search projects"
          placeholder="Search projects…"
          class="h-11 w-full rounded-xl border border-line bg-chrome/70 py-2 pl-9 pr-12 text-sm text-ink placeholder:text-ink-faint sm:h-9"
        />
        <kbd class="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-line-soft bg-chrome px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-muted sm:inline">{searchShortcutHint()}</kbd>
      </div>
    {/if}

    <div class="grid min-w-0 grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
      <div class="col-span-2 flex min-w-0 items-center justify-end gap-2 sm:ml-auto">
        {#if !q}
          <!-- Grouping lives in the right control cluster (owner direction,
               2026-08-10); align="end" opens the panel leftward so it stays
               on-screen next to the viewport edge. The chip reads as a
               labeled control (2026-08-12): "Group" when off, faint
               "Group ·" + ink "Client" when active; panel options are the
               bare values under the "Group by" heading. -->
          <GhostPopover
            value={effectiveGroup}
            onValueChange={(next) => setGroup(next === "client" ? "client" : "none")}
            items={[
              { value: "none", label: "None" },
              { value: "client", label: "Client" },
            ]}
            ariaLabel="Group projects"
            label="Group by"
            align="end"
          >
            {#snippet chip()}
              {#if effectiveGroup === "client"}
                <span class="truncate"><span class="text-ink-faint">Group ·</span> <span class="text-ink">Client</span></span>
              {:else}
                <span class="truncate">Group</span>
              {/if}
            {/snippet}
          </GhostPopover>
        {/if}
        <!-- Obvious filter anatomy + placement: Filters lives in the right
             control cluster; chips render in the row below the toolbar. -->
        {#if !grouped}
          <BoardFiltersPopover
            bind:this={filtersPopover}
            bind:open={filtersOpen}
            {stage}
            onStageChange={(value) => {
              stage = value;
              pendingFilters.stage = false;
            }}
            ownerId={filterOwner}
            onOwnerChange={(id, label) => {
              filterOwner = id;
              filterOwnerLabel = label;
              pendingFilters.owner = false;
            }}
            {stageItems}
            onFieldPick={handleFieldPick}
          />
        {/if}
        <ProjectsDisplayMenu
          {preferences}
          sortBy={(SORTS.some((item) => item.value === sortBy) ? sortBy : "updated") as SortBy}
          sortOptions={SORTS}
          columnOptions={COLUMN_OPTIONS}
          showSort={!q && !grouped}
          showBoardOptions={!q && preferences.layout === "board" && !grouped}
          showClientOptions={!q && grouped}
          {clientCountsAvailable}
          boardCountsLimited={facetsQ.data?.truncated ?? false}
          onSortChange={setSortBy}
          onToggleColumn={toggleColumn}
          onDensityChange={setDensity}
          onHideEmptyBoardChange={setHideEmptyBoard}
          onHideEmptyClientGroupsChange={setHideEmptyClientGroups}
        />
        <ViewModeToggle value={preferences.layout} onChange={setLayout} label="Project layout" />
      </div>
    </div>
  </div>

  {#if !grouped && (selectedStage || filterOwner || pendingFilters.stage || pendingFilters.owner)}
    <!-- Obvious filter pill (their markup, 2026-08-10): ONE joined rounded-md
         pill with internal hairline dividers — static field, "equals"
         operator, CLICKABLE value (opens the value popover anchored to this
         segment), and a small remove button. A just-picked field renders the
         chip immediately with a faint "Select…" placeholder value. -->
    {#snippet filterChip(field: string, fieldId: "stage" | "owner", value: string, pending: boolean, valueClass: string, onRemove: () => void)}
      <span data-active-filter={field} data-active-filter-id={fieldId} class="inline-flex items-center rounded-md border border-line bg-surface text-xs shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <span class="border-r border-line-soft px-2 py-1 font-medium text-ink-secondary">{field}</span>
        <span class="border-r border-line-soft px-2 py-1 text-ink-faint">equals</span>
        <button
          type="button"
          data-filter-pill-value
          onclick={(event) => filtersPopover?.openTo(fieldId, event.currentTarget as HTMLElement)}
          class={`cursor-pointer border-r border-line-soft px-2 py-1 transition-[filter,background-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy motion-reduce:transition-none ${pending ? "text-ink-faint hover:bg-chrome/60 hover:text-ink" : valueClass ? `font-medium ${valueClass} hover:brightness-95` : "font-medium text-ink-secondary hover:bg-chrome/60 hover:text-ink"}`}
        >{value}</button>
        <button
          type="button"
          aria-label={`Remove ${field} filter`}
          onclick={onRemove}
          class="mx-1 flex size-5 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
        >
          <svg class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M8 8l8 8m0-8l-8 8" /></svg>
        </button>
      </span>
    {/snippet}
    <div data-active-filters class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-2 py-2">
      {#if selectedStage || pendingFilters.stage}
        {@render filterChip("Stage", "stage", selectedStage ? stageChipLabel(stage) : "Select…", !selectedStage, stageValueClass, () => {
          stage = "all";
          pendingFilters.stage = false;
        })}
      {/if}
      {#if (selectedStage || pendingFilters.stage) && (filterOwner || pendingFilters.owner)}
        <!-- Obvious joins multiple conditions with a quiet AND. -->
        <span data-filter-join class="text-[11px] font-medium text-ink-faint">AND</span>
      {/if}
      {#if filterOwner || pendingFilters.owner}
        {@render filterChip("Owner", "owner", filterOwner ? (filterOwnerLabel ?? "Selected owner") : "Select…", !filterOwner, "", () => {
          filterOwner = null;
          filterOwnerLabel = null;
          pendingFilters.owner = false;
        })}
      {/if}
      <button
        type="button"
        aria-label="Add filter"
        onclick={(event) => filtersPopover?.openFields(event.currentTarget as HTMLElement)}
        class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-dashed border-line text-ink-faint transition-colors hover:border-ink-faint hover:bg-chrome/40 hover:text-ink-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:h-11 pointer-coarse:w-11"
      >
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M12 7v10M7 12h10" /></svg>
      </button>
    </div>
  {/if}

  {#if q || boundedPage}
    <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft bg-primary-wash px-2 py-2">
      {#if q}
        <p class="text-xs text-ink-secondary" role="status">{rows.length}{countSuffix} loaded {rows.length === 1 ? "result" : "results"}, ordered by relevance.</p>
      {/if}
      {#if boundedPage}<p class="text-xs text-ink-muted" role="status">Results are bounded for performance. Load more or refine the view.</p>{/if}
    </div>
  {/if}

  {#if grouped}
    <!-- Server-backed Client → Status views: sections/lanes own their
         loading/error/empty states, pagination, exact qualifier copy, and
         interim backfill notice. Counts stay truthful (recorded-projection
         totals; exact per-client stageCounts once backfilled). -->
    {#if groupedLanes}
      <!-- Stacked client lanes (desktop grouped board): the standard
           stage-column board rendered once per client. Below `md` this mode
           folds to the grouped List — no mobile swimlanes. -->
      <ProjectsClientGroups
        presentation="lanes"
        hideEmpty={preferences.hideEmptyClientGroups}
        bind:countsAvailable={clientCountsAvailable}
      />
    {:else}
      {#if preferences.layout === "board" && !mdUp}
        <!-- The view-mode control keeps the stored Board preference pressed;
             this status states the truth of what actually renders below
             `md` (live QA 2026-08-07: selected Board + rendered List read
             as a contradiction). Never discards the preference. -->
        <p data-grouped-board-fold-note class="shrink-0 px-1 pt-2 text-xs text-ink-secondary md:hidden" role="status">
          Board grouping uses the list layout on small screens.
        </p>
      {/if}
      <ProjectsClientGroups
        presentation="list"
        hideEmpty={preferences.hideEmptyClientGroups}
        bind:countsAvailable={clientCountsAvailable}
      />
    {/if}
  {:else if activeQ.error}
    <div class="flex flex-1 flex-col items-center justify-center p-8 text-center" role="alert">
      <h2 class="text-title text-ink">Projects could not be loaded</h2>
      <p class="mt-1 max-w-md text-sm text-ink-muted">Refresh the page and try again. The current dashboard remains available from the workspace navigation.</p>
    </div>
  {:else if loadingFirstPage}
    {#if preferences.layout === "board"}
      <div class="flex gap-2 overflow-hidden py-4" role="status" aria-label="Loading projects board">
        {#each SKELETON_ITEMS as item (item)}
          <div class="w-[360px] shrink-0">
            <div class="h-64 animate-pulse rounded-xl bg-gray-50 motion-reduce:animate-none"></div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="space-y-1 py-4" role="status" aria-label="Loading projects">
        {#each SKELETON_ITEMS as item (item)}
          <div class="h-10 animate-pulse rounded-lg bg-chrome motion-reduce:animate-none"></div>
        {/each}
      </div>
    {/if}
  {:else if rows.length === 0 && q}
    <div class="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p class="text-sm font-medium text-ink">No matches for “{q}”</p>
      <p class="mt-1 text-xs text-ink-muted">Try a shorter search or clear the stage filter.</p>
      {#if externalSearch === undefined}
        <button onclick={clearSearchAndFilters} class="mt-4 min-h-11 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none">Clear search and filters</button>
      {:else if selectedStage}
        <button onclick={() => (stage = "all")} class="mt-4 min-h-11 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none">Clear stage filter</button>
      {/if}
    </div>
  {:else if rows.length === 0 && selectedStage}
    <div class="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p class="text-sm font-medium text-ink">No {stageFilterLabel(stage)} projects in this bounded page</p>
      <p class="mt-1 max-w-md text-xs text-ink-muted">More matching projects may exist beyond the current scan.</p>
      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <button onclick={() => (stage = "all")} class="min-h-11 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none">Clear stage filter</button>
        {#if hasMore}
          <button class="min-h-11 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink disabled:opacity-50" disabled={activeQ.status === "LoadingMore"} onclick={() => activeQ.loadMore(DASHBOARD_PROJECT_PAGE_SIZE)}>{activeQ.status === "LoadingMore" ? "Loading…" : "Scan more projects"}</button>
        {/if}
      </div>
    </div>
  {:else if rows.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-wash text-primary-selected" aria-hidden="true">+</span>
      <p class="mt-3 font-medium text-ink">No projects yet</p>
      <p class="mt-1 text-sm text-ink-muted">Create your first project to begin the production workspace.</p>
      <!-- AA on white: lagoon `primary` under white text measures ≈2.8:1, so
           the CTA uses the minted `primary-selected` pair (≥4.5:1). -->
      <a href={resolve("/project/new")} class="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary-selected px-4 text-sm font-medium text-white transition-colors hover:bg-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Create your first project</a>
    </div>
  {:else}
    {#if preferences.layout === "board"}
      <ProjectsBoard
        {rows}
        onlyStage={(selectedStage ?? null) as never}
        stageCounts={boardStageCounts}
        countsApproximate={boardCountsApproximate}
        hideEmpty={preferences.hideEmptyBoard}
      />
    {:else}
      <ProjectsTable {rows} columns={preferences.columns} density={preferences.density} />
    {/if}

    {#if hasMore}
      <footer class="mt-auto flex min-h-12 shrink-0 items-center justify-center border-t border-line-soft px-4 py-2">
        <button
          class="min-h-11 rounded-xl px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none"
          disabled={activeQ.status === "LoadingMore"}
          onclick={() => activeQ.loadMore(DASHBOARD_PROJECT_PAGE_SIZE)}
        >
          {activeQ.status === "LoadingMore" ? "Loading…" : "Show more projects"}
        </button>
      </footer>
    {/if}
  {/if}
</section>
