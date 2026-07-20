<script lang="ts">
  import { goto } from "$app/navigation";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../convex/_generated/api";
  import type { Doc } from "../../../convex/_generated/dataModel";
  import Button from "$lib/components/ui/Button.svelte";
  import ProjectCard from "$lib/components/dashboard/ProjectCard.svelte";
  import TagPicker from "$lib/components/project-new/TagPicker.svelte";
  import IndustrySelect from "$lib/components/ui/IndustrySelect.svelte";
  import AppNav from "$lib/components/ui/AppNav.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { slide } from "svelte/transition";
  import { scienceCodeLabel, CRA_SCIENCE_CODES } from "../../../shared/craScienceCodes";

  type Project = Doc<"projects">;

  /** BNH-36: group projects company (A→Z) → fiscal year (newest first) → reports. */
  function groupByCompanyAndYear(projects: Project[]) {
    const byCompany = new Map<string, Map<string, Project[]>>();
    for (const p of projects) {
      const company = p.clientName?.trim() || "—";
      const fyKey = p.fiscalYearEnd
        ? String(new Date(p.fiscalYearEnd).getFullYear())
        : "none";
      if (!byCompany.has(company)) byCompany.set(company, new Map());
      const years = byCompany.get(company)!;
      if (!years.has(fyKey)) years.set(fyKey, []);
      years.get(fyKey)!.push(p);
    }

    return [...byCompany.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
      .map(([company, years]) => {
        const total = [...years.values()].reduce((n, a) => n + a.length, 0);
        const yearGroups = [...years.entries()]
          .sort((a, b) => {
            if (a[0] === "none") return 1;
            if (b[0] === "none") return -1;
            return Number(b[0]) - Number(a[0]);
          })
          .map(([fyKey, ps]) => {
            const withDate = ps.find((p) => p.fiscalYearEnd);
            return {
              fyKey,
              label: fyKey === "none" ? "No fiscal year set" : `Fiscal ${fyKey}`,
              dateLabel: withDate
                ? new Date(withDate.fiscalYearEnd!).toLocaleDateString("en-CA", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : null,
              projects: [...ps].sort((a, b) => b.updatedAt - a.updatedAt),
            };
          });
        return { company, total, yearGroups };
      });
  }

  type StatusFilter = "all" | "draft" | "generating" | "review" | "client_review" | "final";

  const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "review", label: "Review" },
    { value: "client_review", label: "Client Review" },
    { value: "final", label: "Final" },
  ];

  const ADMIN_ROUTES = [
    { href: "/admin/brain", label: "The Brain" },
    { href: "/admin/tags", label: "Project tags" },
    { href: "/admin/reviews", label: "Consultant QA reviews" },
    { href: "/admin/users", label: "Users & roles" },
    { href: "/admin/models", label: "Model preferences" },
    { href: "/admin/usage", label: "AI usage & cost" },
  ] as const;

  const auth = useAuth();

  const user = useQuery(api.users.getCurrentUser, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const isAdmin = $derived(user.data?.role === "admin");
  const projectsQ = useQuery(api.projects.listProjects, () =>
    auth.isAuthenticated ? {} : "skip"
  );

  // string (not StatusFilter) so it can bind:value into SelectInput.
  let filter = $state<string>("all");
  let search = $state("");
  const expanded = new SvelteSet<string>();

  // BNH-49: extra sorts + attribute filters, preserved for the session.
  type SortBy = "client" | "created" | "updated" | "viewed";
  const SORTS: { value: SortBy; label: string }[] = [
    { value: "client", label: "Client name" },
    { value: "created", label: "Recently created" },
    { value: "updated", label: "Recently edited" },
    { value: "viewed", label: "Recently viewed" },
  ];
  // string (not SortBy) so it can bind:value into SelectInput; SORTS gates values.
  let sortBy = $state<string>("client");
  let filterWriter = $state("all");
  // Interviewer has no dedicated filter — it's covered by the search box.
  let filterIndustry = $state("all");
  let filterScienceCode = $state("all");

  // BNH-35: tag chips + tag filtering (selecting a parent also matches children).
  const tagsQ = useQuery(api.tags.listTags, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const allTags = $derived(tagsQ.data ?? []);
  const tagById = $derived(
    new Map(allTags.map((tag) => [tag._id as string, tag]))
  );
  let selectedTags = $state<string[]>([]);
  /** Selected tags expanded to include all descendants (nested-match rule). */
  const selectedTagSet = $derived.by(() => {
    const set = new Set(selectedTags);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of allTags) {
        if (t.parentId && set.has(t.parentId as string) && !set.has(t._id as string)) {
          set.add(t._id as string);
          grew = true;
        }
      }
    }
    return set;
  });
  function projectTags(project: Project): Array<{ id: string; label: string }> {
    const seen = new Set<string>();
    const resolved: Array<{ id: string; label: string }> = [];
    for (const rawId of project.tagIds ?? []) {
      const id = rawId as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const tag = tagById.get(id);
      if (tag) resolved.push({ id, label: tag.name });
    }
    return resolved;
  }

  const lastViewedQ = useQuery(api.reportViews.getLastViewedMap, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const lastViewed = $derived(lastViewedQ.data ?? {});

  const VIEW_PREFS_KEY = "banhall_dashboard_view";
  let viewPrefsLoaded = false;
  $effect(() => {
    if (viewPrefsLoaded) return;
    viewPrefsLoaded = true;
    try {
      const raw = sessionStorage.getItem(VIEW_PREFS_KEY);
      if (!raw) return;
      const v = JSON.parse(raw);
      if (SORTS.some((s) => s.value === v.sortBy)) sortBy = v.sortBy;
      if (typeof v.filterWriter === "string") filterWriter = v.filterWriter;
      if (typeof v.filterIndustry === "string") filterIndustry = v.filterIndustry;
      if (typeof v.filterScienceCode === "string") filterScienceCode = v.filterScienceCode;
    } catch {
      /* stale prefs are disposable */
    }
  });
  $effect(() => {
    sessionStorage.setItem(
      VIEW_PREFS_KEY,
      JSON.stringify({ sortBy, filterWriter, filterIndustry, filterScienceCode })
    );
  });

  function distinct(values: (string | undefined)[]): string[] {
    return [...new Set(values.filter((v): v is string => Boolean(v?.trim())))].sort(
      (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }

  function withAll(values: string[]): { value: string; label: string }[] {
    return [{ value: "all", label: "All" }, ...values.map((v) => ({ value: v, label: v }))];
  }

  function toggle(key: string) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
  }

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      goto("/login", { replaceState: true });
    }
  });

  const projects = $derived(projectsQ.data);

  const filtered = $derived(
    filter === "all" ? projects : projects?.filter((p) => p.status === filter)
  );
  const counts = $derived(
    projects?.reduce(
      (acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    )
  );
  const q = $derived(search.trim().toLowerCase());
  const searched = $derived(
    (filtered ?? []).filter(
      (p) =>
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        (p.writer ?? "").toLowerCase().includes(q) ||
        (p.interviewer ?? "").toLowerCase().includes(q) ||
        (p.scienceCode ?? "").toLowerCase().includes(q) ||
        scienceCodeLabel(p.scienceCode).toLowerCase().includes(q)
    )
  );
  // BNH-49: attribute filters apply after status + search.
  const writers = $derived(distinct((projects ?? []).map((p) => p.writer)));
  const industries = $derived(distinct((projects ?? []).map((p) => p.industry)));

  const attrFiltered = $derived(
    searched.filter(
      (p) =>
        (filterWriter === "all" || (p.writer ?? "") === filterWriter) &&
        (filterIndustry === "all" || (p.industry ?? "") === filterIndustry) &&
        (filterScienceCode === "all" || (p.scienceCode ?? "") === filterScienceCode) &&
        (selectedTags.length === 0 ||
          (p.tagIds ?? []).some((id) => selectedTagSet.has(id as string)))
    )
  );
  const attrFiltersActive = $derived(
    filterWriter !== "all" ||
      filterIndustry !== "all" ||
      filterScienceCode !== "all" ||
      selectedTags.length > 0
  );

  const groups = $derived(groupByCompanyAndYear(attrFiltered));
  // Non-default sorts show a flat, most-recent-first grid instead of the
  // company → fiscal-year tree (a recency ordering has no meaning inside it).
  const flatSorted = $derived.by(() => {
    const arr = [...attrFiltered];
    if (sortBy === "created") arr.sort((a, b) => b.createdAt - a.createdAt);
    else if (sortBy === "updated") arr.sort((a, b) => b.updatedAt - a.updatedAt);
    else if (sortBy === "viewed")
      arr.sort((a, b) => (lastViewed[b._id] ?? 0) - (lastViewed[a._id] ?? 0));
    return arr;
  });
  // Default collapsed; searching forces everything open so matches are visible.
  const isOpen = (key: string) => q.length > 0 || expanded.has(key);

  // Status dropdown options, counts baked into the labels.
  const statusItems = $derived(
    FILTERS.filter((f) => f.value === "all" || (counts?.[f.value] ?? 0) > 0).map((f) => ({
      value: f.value,
      label:
        f.value === "all"
          ? `All statuses (${projects?.length ?? 0})`
          : `${f.label} (${counts?.[f.value] ?? 0})`,
    }))
  );
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <div class="flex flex-1 items-center justify-center bg-canvas">
    <Spinner />
  </div>
{:else}
  <div class="flex flex-1 flex-col bg-canvas">
    <AppNav />

    <!-- Admin toolbar — dashboard only; other pages keep their plain PageBar -->
    {#if isAdmin}
      <div class="border-b border-line-soft bg-white">
        <nav
          aria-label="Admin"
          class="mx-auto flex w-full max-w-[var(--container-shell)] items-center justify-center gap-1 px-6 py-1.5"
        >
          {#each ADMIN_ROUTES as route (route.href)}
            <a
              href={route.href}
              class="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-primary-wash hover:text-navy"
            >
              {route.label}
            </a>
          {/each}
        </nav>
      </div>
    {/if}

    <!-- Content -->
    <main class="mx-auto w-full max-w-[var(--container-shell)] flex-1 px-6 pt-12 pb-8">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-display">Projects</h2>
          {#if projects && projects.length > 0}
            <p class="mt-0.5 text-sm text-gray-400">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </p>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <a href="/project/questionnaire">
            <Button variant="secondary">Self-Serve</Button>
          </a>
          <a href="/project/new">
            <Button>
              <svg class="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Project
            </Button>
          </a>
        </div>
      </div>

      <!-- Search + all filters/sort on one compact toolbar row -->
      {#if projects && projects.length > 0}
        <div class="relative mt-4">
          <svg class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            bind:value={search}
            placeholder="Search company, project, writer, or interviewer…"
            class="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>

        <!-- Filter row: status left, sort/attribute selects right -->
        <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <SelectInput size="sm" bind:value={filter} items={statusItems} class="w-36" placeholder="Status" />

          <div class="ml-auto flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1.5 text-xs text-gray-400">
              Sort
              <SelectInput size="sm" bind:value={sortBy} items={SORTS} class="w-40" />
            </label>
            {#if writers.length > 1}
              <label class="flex items-center gap-1.5 text-xs text-gray-400">
                Consultant
                <SelectInput size="sm" bind:value={filterWriter} items={withAll(writers)} class="w-36" />
              </label>
            {/if}
            <label class="flex items-center gap-1.5 text-xs text-gray-400">
              Industry
              <IndustrySelect variant="filter" size="sm" bind:value={filterIndustry} class="w-44" />
            </label>
            <label class="flex items-center gap-1.5 text-xs text-gray-400">
              Science
              <SelectInput
                size="sm"
                bind:value={filterScienceCode}
                items={[{ value: "all", label: "All" }, ...CRA_SCIENCE_CODES.map((c) => ({ value: c.code, label: `${c.code} — ${c.label}` }))]}
                class="w-44"
              />
            </label>
          </div>
        </div>

        <!-- BNH-35: tags on their own row; Clear filters lives here too -->
        {#if allTags.length > 0 || attrFiltersActive}
          <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            {#if allTags.length > 0}
              <TagPicker {allTags} bind:selectedTagIds={selectedTags} size="sm" />
            {/if}
            {#if attrFiltersActive}
              <button
                onclick={() => {
                  filterWriter = "all";
                  filterIndustry = "all";
                  filterScienceCode = "all";
                  selectedTags = [];
                }}
                class="ml-auto text-xs text-primary hover:underline"
              >
                Clear filters
              </button>
            {/if}
          </div>
        {/if}
      {/if}

      <!-- Project grid -->
      {#if projects === undefined}
        <div class="flex min-h-[55vh] items-center justify-center">
          <Spinner />
        </div>
      {:else if filtered && filtered.length === 0 && filter !== "all"}
        <div class="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-6 py-14 text-center">
          <p class="text-sm font-medium text-gray-600">No {filter.replace("_", " ")} projects</p>
          <p class="mt-1 text-xs text-gray-400">Try a different status, or show everything.</p>
          <button onclick={() => (filter = "all")} class="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-primary hover:text-primary-dark">
            Show all projects
          </button>
        </div>
      {:else if attrFiltered.length === 0 && attrFiltersActive}
        <div class="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-6 py-14 text-center">
          <p class="text-sm font-medium text-gray-600">No projects match the current filters</p>
          <p class="mt-1 text-xs text-gray-400">Loosen or clear the filters to see more projects.</p>
          <button
            onclick={() => {
              filterWriter = "all";
              filterIndustry = "all";
              filterScienceCode = "all";
              selectedTags = [];
            }}
            class="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-primary hover:text-primary-dark"
          >
            Clear filters
          </button>
        </div>
      {:else if searched.length === 0 && q}
        <div class="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50 px-6 py-14 text-center">
          <p class="text-sm font-medium text-gray-600">No matches for “{search}”</p>
          <p class="mt-1 text-xs text-gray-400">Check the spelling or try a shorter search.</p>
          <button onclick={() => (search = "")} class="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-primary hover:text-primary-dark">
            Clear search
          </button>
        </div>
      {:else if filtered && filtered.length === 0}
        <div class="mt-16 text-center">
          <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-chrome">
            <svg class="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p class="font-medium text-navy">No projects yet.</p>
          <p class="mt-1 text-sm text-gray-400">Create your first project to get started.</p>
          <a href="/project/new" class="mt-4 inline-block">
            <Button>Create your first project</Button>
          </a>
        </div>
      {:else if sortBy !== "client"}
        <!-- BNH-49: recency sorts render a flat, most-recent-first grid -->
        <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each flatSorted as project (project._id)}
            <ProjectCard {project} tags={projectTags(project)} />
          {/each}
        </div>
      {:else}
        <!-- BNH-36: company (A→Z) → fiscal year → report cards -->
        <div class="mt-5 flex flex-col gap-2">
          {#each groups as g (g.company)}
            {@const companyOpen = isOpen(g.company)}
            <div class="card overflow-hidden">
              <button
                onclick={() => toggle(g.company)}
                class="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-primary-wash"
              >
                <span class={`text-sm font-semibold transition-colors duration-300 ${companyOpen ? "text-primary" : "text-navy"}`}>{g.company}</span>
                <span class="text-xs text-gray-400">
                  {g.total} report{g.total !== 1 ? "s" : ""}
                </span>
                <svg class={`ml-auto h-4 w-4 flex-shrink-0 transition-all duration-300 ${companyOpen ? "rotate-180 text-primary" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {#if companyOpen}
                <div class="border-t border-gray-100" transition:slide={{ duration: 300 }}>
                  {#each g.yearGroups as yg (yg.fyKey)}
                    {@const yearKey = `${g.company}|${yg.fyKey}`}
                    {@const yearOpen = isOpen(yearKey)}
                    <div class="border-b border-gray-50 last:border-0">
                      <button
                        onclick={() => toggle(yearKey)}
                        class="flex w-full items-center gap-2 px-4 py-2.5 pl-7 text-left transition-colors hover:bg-primary-wash"
                      >
                        <span class="text-sm font-medium text-gray-700">{yg.label}</span>
                        {#if yg.dateLabel}
                          <span class="text-xs text-gray-400">· {yg.dateLabel}</span>
                        {/if}
                        <span class="ml-auto text-xs text-gray-400">{yg.projects.length}</span>
                        <svg class={`h-3.5 w-3.5 flex-shrink-0 transition-all duration-300 ${yearOpen ? "rotate-180 text-primary" : "text-gray-300"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {#if yearOpen}
                        <div class="grid gap-3 px-4 pb-4 pl-10 pt-1 sm:grid-cols-2 lg:grid-cols-3" transition:slide={{ duration: 300 }}>
                          {#each yg.projects as project (project._id)}
                            <ProjectCard {project} tags={projectTags(project)} />
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </main>
  </div>
{/if}
