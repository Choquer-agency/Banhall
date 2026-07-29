<script lang="ts">
  import { goto } from "$app/navigation";
  import { usePaginatedQuery, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { fly } from "svelte/transition";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../convex/_generated/api";
  import type { Id } from "../../../convex/_generated/dataModel";
  import { CRA_SCIENCE_CODES } from "../../../shared/craScienceCodes";
  import {
    DASHBOARD_COMPANY_PAGE_SIZE,
    DASHBOARD_PROJECT_PAGE_SIZE,
  } from "../../../shared/dashboardProjection";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { BASE_INDUSTRIES, industryLabel } from "$lib/industries";
  import ProjectCard from "$lib/components/dashboard/ProjectCard.svelte";
  import CompanyProjectGroup from "$lib/components/dashboard/CompanyProjectGroup.svelte";
  import BulkEditDialog from "$lib/components/dashboard/BulkEditDialog.svelte";
  import TagPicker from "$lib/components/project-new/TagPicker.svelte";
  import {
    stageFilterItemsFromCounts,
    stageFilterLabel,
  } from "$lib/dashboard/stageFilter";

  type FlatResult = FunctionReturnType<typeof api.dashboard.listFlatProjects>;
  type ProjectRow = FlatResult["page"][number];
  type CompanyRow = FunctionReturnType<typeof api.dashboard.listCompanies>["page"][number];
  type TeamMember = FunctionReturnType<typeof api.users.listTeam>[number];

  const ADMIN_ROUTES = [
    { href: "/admin/brain", label: "The Brain" },
    { href: "/admin/tags", label: "Project tags" },
    { href: "/admin/reviews", label: "Consultant QA reviews" },
    { href: "/admin/users", label: "Users & roles" },
    { href: "/admin/models", label: "Model preferences" },
    { href: "/admin/usage", label: "AI usage & cost" },
  ] as const;
  type SortBy = "client" | "created" | "updated" | "viewed";
  const SORTS: { value: SortBy; label: string }[] = [
    { value: "client", label: "Client name" },
    { value: "created", label: "Recently created" },
    { value: "updated", label: "Recently edited" },
    { value: "viewed", label: "Recently viewed" },
  ];

  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const isAdmin = $derived(userQ.data?.role === "admin");
  const facetsQ = useQuery(api.dashboard.getFacets, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const tagsQ = useQuery(api.tags.listTags, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const teamQ = useQuery(api.users.listTeam, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  let filter = $state<string>("all");
  let search = $state("");
  let sortBy = $state<string>("client");
  let filterOwner = $state("all");
  let filterIndustry = $state("all");
  let filterScienceCode = $state("all");
  let selectedTags = $state<string[]>([]);
  const expanded = new SvelteSet<string>();
  const selected = new SvelteSet<string>();
  let selectedRows = $state<ProjectRow[]>([]);
  let bulkEditOpen = $state(false);

  const q = $derived(search.trim());
  const attrFiltersActive = $derived(
    filter !== "all" ||
      filterOwner !== "all" ||
      filterIndustry !== "all" ||
      filterScienceCode !== "all" ||
      selectedTags.length > 0
  );
  const flatMode = $derived(q.length > 0 || attrFiltersActive || sortBy !== "client");

  const companiesQ = usePaginatedQuery(
    api.dashboard.listCompanies,
    () => (auth.isAuthenticated && !flatMode ? {} : "skip"),
    { initialNumItems: DASHBOARD_COMPANY_PAGE_SIZE }
  );
  const flatQ = usePaginatedQuery(
    api.dashboard.listFlatProjects,
    () =>
      auth.isAuthenticated && flatMode && !q
        ? {
            sortBy: (sortBy === "client" ? "updated" : sortBy) as Exclude<SortBy, "client">,
            stage: filter === "all" ? undefined : (filter as never),
            ownerId: filterOwner === "all" ? undefined : (filterOwner as Id<"users">),
            industry: filterIndustry === "all" ? undefined : filterIndustry,
            scienceCode: filterScienceCode === "all" ? undefined : filterScienceCode,
            tagIds: selectedTags as Id<"tags">[],
          }
        : "skip",
    { initialNumItems: DASHBOARD_PROJECT_PAGE_SIZE }
  );
  const searchQ = usePaginatedQuery(
    api.dashboard.searchProjects,
    () =>
      auth.isAuthenticated && q
        ? {
            search: q,
            stage: filter === "all" ? undefined : (filter as never),
            ownerId: filterOwner === "all" ? undefined : (filterOwner as Id<"users">),
            industry: filterIndustry === "all" ? undefined : filterIndustry,
            scienceCode: filterScienceCode === "all" ? undefined : filterScienceCode,
            tagIds: selectedTags as Id<"tags">[],
          }
        : "skip",
    { initialNumItems: DASHBOARD_PROJECT_PAGE_SIZE }
  );

  const companies = $derived(companiesQ.results as CompanyRow[]);
  const flatProjects = $derived((q ? searchQ.results : flatQ.results) as ProjectRow[]);
  const activeFlatQ = $derived(q ? searchQ : flatQ);
  const projectsLoading = $derived(
    flatMode
      ? activeFlatQ.status === "LoadingFirstPage"
      : companiesQ.status === "LoadingFirstPage"
  );
  const allTags = $derived(tagsQ.data ?? []);
  const tagById = $derived(new Map(allTags.map((tag) => [tag._id as string, tag])));
  const team = $derived(teamQ.data ?? []);
  const ownerById = $derived(new Map(team.map((member) => [member.id as string, member])));
  const stageItems = $derived(
    stageFilterItemsFromCounts(
      facetsQ.data?.stageCounts ?? {},
      facetsQ.data?.total ?? 0,
      facetsQ.data?.truncated ?? false
    )
  );
  const ownerItems = $derived([
    { value: "all", label: "All" },
    ...team
      .filter((member) => facetsQ.data?.ownerIds.includes(member.id))
      .map((member) => ({ value: member.id as string, label: member.name })),
  ]);
  const industryItems = $derived([
    { value: "all", label: "Not set (all industries)" },
    ...BASE_INDUSTRIES,
    ...(facetsQ.data?.industries ?? [])
      .filter((slug) => !BASE_INDUSTRIES.some((base) => base.value === slug))
      .map((slug) => ({ value: slug, label: industryLabel(slug) })),
  ]);
  const totalProjects = $derived(facetsQ.data?.total ?? 0);
  const selectionMode = $derived(selected.size > 0);
  const selectedProjects = $derived(selectedRows);
  const allCompanies = $derived(companies.map((company) => company.clientName));

  const VIEW_PREFS_KEY = "banhall_dashboard_view";
  let viewPrefsLoaded = false;
  $effect(() => {
    if (viewPrefsLoaded) return;
    viewPrefsLoaded = true;
    try {
      const raw = sessionStorage.getItem(VIEW_PREFS_KEY);
      if (!raw) return;
      const value = JSON.parse(raw);
      if (SORTS.some((item) => item.value === value.sortBy)) sortBy = value.sortBy;
      if (typeof value.filterOwner === "string") filterOwner = value.filterOwner;
      if (typeof value.filterIndustry === "string") filterIndustry = value.filterIndustry;
      if (typeof value.filterScienceCode === "string") filterScienceCode = value.filterScienceCode;
    } catch {
      // Stale preferences are disposable.
    }
  });
  $effect(() => {
    sessionStorage.setItem(
      VIEW_PREFS_KEY,
      JSON.stringify({ sortBy, filterOwner, filterIndustry, filterScienceCode })
    );
  });
  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) goto("/login", { replaceState: true });
  });

  function projectTags(project: ProjectRow) {
    const seen = new Set<string>();
    return (project.tagIds ?? []).flatMap((rawId) => {
      const id = rawId as string;
      const tag = tagById.get(id);
      if (!tag || seen.has(id)) return [];
      seen.add(id);
      return [{ id, label: tag.name }];
    });
  }

  function ownerLabel(project: ProjectRow) {
    return project.ownerId ? ownerById.get(project.ownerId as string)?.name ?? project.writer ?? null : project.writer ?? null;
  }

  function toggleCompany(companyKey: string) {
    if (expanded.has(companyKey)) expanded.delete(companyKey);
    else expanded.add(companyKey);
  }

  function toggleSelect(project: ProjectRow) {
    const id = project._id as string;
    if (selected.has(id)) {
      selected.delete(id);
      selectedRows = selectedRows.filter((row) => row._id !== project._id);
    } else {
      selected.add(id);
      selectedRows = [...selectedRows, project];
    }
  }

  function clearSelection() {
    selected.clear();
    selectedRows = [];
  }

  function clearFilters() {
    filter = "all";
    filterOwner = "all";
    filterIndustry = "all";
    filterScienceCode = "all";
    selectedTags = [];
  }

  function onWindowKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && selectionMode && !bulkEditOpen) clearSelection();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas"><Spinner /></div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav />

    {#if isAdmin}
      <div class="border-b border-line-soft bg-white">
        <nav aria-label="Admin" class="mx-auto flex w-full max-w-[var(--container-shell)] items-center justify-center gap-1 px-6 py-1.5">
          {#each ADMIN_ROUTES as route (route.href)}
            <a href={route.href} class="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-primary-wash hover:text-navy">{route.label}</a>
          {/each}
        </nav>
      </div>
    {/if}

    <main class="mx-auto w-full max-w-[var(--container-shell)] flex-1 px-6 pt-12 pb-8">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-display">Projects</h2>
          {#if totalProjects > 0}
            <p class="mt-0.5 text-sm text-ink-muted">
              {totalProjects}{facetsQ.data?.truncated ? "+" : ""} project{totalProjects !== 1 ? "s" : ""}
            </p>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <a href="/project/questionnaire"><Button variant="secondary">Self-Serve</Button></a>
          <a href="/project/new"><Button>New Project</Button></a>
        </div>
      </div>

      {#if totalProjects > 0}
        <div class="relative mt-4">
          <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input bind:value={search} aria-label="Search projects" placeholder="Search company, project, consultant, or interviewer…" class="min-h-11 w-full rounded-md border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy" />
        </div>

        <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <SelectInput size="md" bind:value={filter} items={stageItems} class="w-52" placeholder="Stage" />
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1.5 text-xs text-ink-muted">Sort<SelectInput size="sm" bind:value={sortBy} items={SORTS} class="w-40" /></label>
            {#if ownerItems.length > 2}
              <label class="flex items-center gap-1.5 text-xs text-ink-muted">Owner<SelectInput size="sm" bind:value={filterOwner} items={ownerItems} class="w-40" /></label>
            {/if}
            <label class="flex items-center gap-1.5 text-xs text-ink-muted">Industry<SelectInput size="sm" bind:value={filterIndustry} items={industryItems} class="w-44" /></label>
            <label class="flex items-center gap-1.5 text-xs text-ink-muted">Science<SelectInput size="sm" bind:value={filterScienceCode} items={[{ value: "all", label: "All" }, ...CRA_SCIENCE_CODES.map((code) => ({ value: code.code, label: `${code.code} — ${code.label}` }))]} class="w-44" /></label>
          </div>
        </div>

        {#if allTags.length > 0 || attrFiltersActive}
          <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            {#if allTags.length > 0}<TagPicker {allTags} bind:selectedTagIds={selectedTags} size="sm" />{/if}
            {#if attrFiltersActive}<button onclick={clearFilters} class="ml-auto min-h-11 text-xs font-medium text-primary-selected hover:underline">Clear filters</button>{/if}
          </div>
        {/if}
      {/if}

      {#if projectsLoading || facetsQ.data === undefined}
        <div class="flex min-h-[55vh] items-center justify-center"><Spinner /></div>
      {:else if totalProjects === 0}
        <div class="mt-16 text-center">
          <p class="font-medium text-navy">No projects yet.</p>
          <p class="mt-1 text-sm text-ink-muted">Create your first project to get started.</p>
          <a href="/project/new" class="mt-4 inline-block"><Button>Create your first project</Button></a>
        </div>
      {:else if flatMode}
        {#if flatProjects.length === 0 && (activeFlatQ.status === "Exhausted" || activeFlatQ.error)}
          <div class="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-chrome/50 px-6 py-14 text-center">
            <p class="text-sm font-medium text-ink-secondary">{q ? `No matches for “${search}”` : `No ${stageFilterLabel(filter)} projects match these filters`}</p>
            <p class="mt-1 text-xs text-ink-muted">Try a shorter search or clear some filters.</p>
            <button onclick={() => { search = ""; clearFilters(); }} class="mt-3 min-h-11 rounded-lg border border-line bg-white px-3 text-xs font-medium text-ink-secondary hover:border-primary">Clear search and filters</button>
          </div>
        {:else}
          {#if q}<p class="mt-4 text-xs text-ink-muted">Search results are ordered by relevance.</p>{/if}
          {#if activeFlatQ.status !== "Exhausted" && flatProjects.length < DASHBOARD_PROJECT_PAGE_SIZE}
            <p class="mt-2 text-xs text-ink-muted" role="status">This page was bounded for performance. Load more or refine the filters to continue.</p>
          {/if}
          <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {#each flatProjects as project (project._id)}
              <ProjectCard
                {project}
                tags={projectTags(project)}
                writerLabel={ownerLabel(project)}
                selected={selected.has(project._id as string)}
                {selectionMode}
                onToggleSelect={() => toggleSelect(project)}
              />
            {/each}
          </div>
          {#if activeFlatQ.status === "CanLoadMore" || activeFlatQ.status === "LoadingMore"}
            <div class="mt-6 flex justify-center">
              <Button variant="secondary" disabled={activeFlatQ.status === "LoadingMore"} onclick={() => activeFlatQ.loadMore(DASHBOARD_PROJECT_PAGE_SIZE)}>{activeFlatQ.status === "LoadingMore" ? "Loading…" : "Load more projects"}</Button>
            </div>
          {/if}
        {/if}
      {:else}
        <div class="mt-5 flex flex-col gap-2">
          {#each companies as company (company.companyKey)}
            <CompanyProjectGroup
              companyKey={company.companyKey}
              company={company.clientName}
              total={company.projectCount}
              open={expanded.has(company.companyKey)}
              selectedIds={selected}
              {selectionMode}
              onToggle={() => toggleCompany(company.companyKey)}
              onToggleSelect={toggleSelect}
              {projectTags}
              {ownerLabel}
            />
          {/each}
        </div>
        {#if companiesQ.status === "CanLoadMore" || companiesQ.status === "LoadingMore"}
          <div class="mt-6 flex justify-center">
            <Button variant="secondary" disabled={companiesQ.status === "LoadingMore"} onclick={() => companiesQ.loadMore(DASHBOARD_COMPANY_PAGE_SIZE)}>{companiesQ.status === "LoadingMore" ? "Loading…" : "Load more companies"}</Button>
          </div>
        {/if}
      {/if}

      {#if selectionMode}
        <div transition:fly={{ y: 16, duration: 300 }} class="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-3 rounded-xl border border-line bg-white py-2 pl-4 pr-2 shadow-lg motion-reduce:transition-none">
          <span class="text-data text-ink-secondary">{selected.size} selected</span>
          <button onclick={clearSelection} class="min-h-11 text-xs text-ink-muted hover:text-navy">Clear</button>
          <Button size="sm" onclick={() => (bulkEditOpen = true)}>Edit details</Button>
        </div>
      {/if}

      <BulkEditDialog bind:open={bulkEditOpen} projects={selectedProjects} companies={allCompanies} onSaved={clearSelection} />
    </main>
  </div>
{/if}
