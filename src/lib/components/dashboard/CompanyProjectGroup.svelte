<script lang="ts">
  import { usePaginatedQuery } from "convex-svelte";
  import { slide } from "svelte/transition";
  import { api } from "../../../../convex/_generated/api";
  import type { FunctionReturnType } from "convex/server";
  import Checkbox from "$lib/components/ui/Checkbox.svelte";
  import ProjectCard from "$lib/components/dashboard/ProjectCard.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import { DASHBOARD_PROJECT_PAGE_SIZE } from "../../../../shared/dashboardProjection";

  type CompanyProjectsResult = FunctionReturnType<typeof api.dashboard.listCompanyProjects>;
  type ProjectRow = CompanyProjectsResult["page"][number];
  type Tag = { id: string; label: string };

  let {
    companyKey,
    company,
    total,
    open,
    selectedIds,
    selectionMode,
    onToggle,
    onToggleSelect,
    projectTags,
    ownerLabel,
  }: {
    companyKey: string;
    company: string;
    total: number;
    open: boolean;
    selectedIds: Set<string>;
    selectionMode: boolean;
    onToggle: () => void;
    onToggleSelect: (project: ProjectRow) => void;
    projectTags: (project: ProjectRow) => Tag[];
    ownerLabel: (project: ProjectRow) => string | null;
  } = $props();

  const disclosureId = $derived(`company-projects-${encodeURIComponent(companyKey)}`);
  const projectsQ = usePaginatedQuery(
    api.dashboard.listCompanyProjects,
    () => (open ? { companyKey } : "skip"),
    { initialNumItems: DASHBOARD_PROJECT_PAGE_SIZE }
  );
  const projects = $derived(projectsQ.results);
  const fullyLoaded = $derived(projectsQ.status === "Exhausted");
  const selectedCount = $derived(
    projects.reduce((count, project) => count + (selectedIds.has(project._id as string) ? 1 : 0), 0)
  );
  const allSelected = $derived(
    projects.length > 0 && selectedCount === projects.length && fullyLoaded
  );
  const someSelected = $derived(selectedCount > 0 && !allSelected);

  type FiscalGroup = {
    key: string;
    label: string;
    dateLabel: string | null;
    projects: ProjectRow[];
  };

  const fiscalGroups = $derived.by(() => {
    const groups = new Map<string, ProjectRow[]>();
    for (const project of projects) {
      const year = project.fiscalYearEnd
        ? String(new Date(project.fiscalYearEnd).getUTCFullYear())
        : "none";
      const existing = groups.get(year) ?? [];
      existing.push(project);
      groups.set(year, existing);
    }
    return [...groups.entries()]
      .sort((a, b) => {
        if (a[0] === "none") return 1;
        if (b[0] === "none") return -1;
        return Number(b[0]) - Number(a[0]);
      })
      .map(([key, rows]): FiscalGroup => {
        const withDate = rows.find((project) => project.fiscalYearEnd);
        return {
          key,
          label: key === "none" ? "No fiscal year set" : `Fiscal ${key}`,
          dateLabel: withDate?.fiscalYearEnd
            ? new Date(withDate.fiscalYearEnd).toLocaleDateString("en-CA", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })
            : null,
          projects: [...rows].sort((a, b) => b.updatedAt - a.updatedAt),
        };
      });
  });

  function toggleLoadedGroup() {
    if (!fullyLoaded) return;
    const deselect = allSelected;
    for (const project of projects) {
      const id = project._id as string;
      if (deselect) {
        if (selectedIds.has(id)) onToggleSelect(project);
      } else if (!selectedIds.has(id)) {
        onToggleSelect(project);
      }
    }
  }
</script>

<div class="card overflow-hidden">
  <div class="group/chdr flex min-h-11 items-center transition-colors hover:bg-primary-wash">
    <div
      class={`flex pl-4 transition-opacity duration-300 ${
        selectionMode || allSelected || someSelected
          ? "opacity-100"
          : "opacity-0 focus-within:opacity-100 group-hover/chdr:opacity-100"
      }`}
    >
      <Checkbox
        checked={allSelected}
        indeterminate={someSelected}
        disabled={!open || !fullyLoaded || projects.length === 0}
        aria-label={
          fullyLoaded
            ? `Select all loaded ${company} projects`
            : `Load every ${company} project before selecting the group`
        }
        onCheckedChange={toggleLoadedGroup}
      />
    </div>
    <button
      onclick={onToggle}
      aria-expanded={open}
      aria-controls={disclosureId}
      class="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left"
    >
      <span class={`text-sm font-semibold ${open ? "text-primary-selected" : "text-navy"}`}>{company}</span>
      <span class="text-xs text-ink-muted">{total} report{total !== 1 ? "s" : ""}</span>
      <svg class={`ml-auto h-4 w-4 flex-shrink-0 transition-transform ${open ? "rotate-180 text-primary-selected" : "text-ink-faint"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  </div>

  {#if open}
    <div
      id={disclosureId}
      class="border-t border-line-soft"
      transition:slide={{ duration: 300 }}
    >
      {#if projectsQ.error}
        <div class="px-6 py-8 text-center" role="alert">
          <p class="text-sm font-medium text-ink-secondary">Couldn't load this company's projects.</p>
          <p class="mt-1 text-xs text-ink-muted">Collapse and reopen the company to retry.</p>
        </div>
      {:else if projectsQ.status === "LoadingFirstPage"}
        <div class="flex min-h-32 items-center justify-center"><Spinner /></div>
      {:else}
        {#each fiscalGroups as group (group.key)}
          <section class="border-b border-line-soft last:border-0" aria-labelledby={`${disclosureId}-fy-${group.key}`}>
            <div class="flex min-h-11 items-center gap-2 px-7 py-2.5">
              <h3 id={`${disclosureId}-fy-${group.key}`} class="text-sm font-medium text-ink-secondary">{group.label}</h3>
              {#if group.dateLabel}<span class="text-xs text-ink-muted">· {group.dateLabel}</span>{/if}
              <span class="ml-auto text-xs text-ink-muted">{group.projects.length}{fullyLoaded ? "" : "+"}</span>
            </div>
            <div class="grid gap-3 px-4 pb-4 pl-10 sm:grid-cols-2 lg:grid-cols-3">
              {#each group.projects as project (project._id)}
                <ProjectCard
                  {project}
                  tags={projectTags(project)}
                  selected={selectedIds.has(project._id as string)}
                  {selectionMode}
                  onToggleSelect={() => onToggleSelect(project)}
                  writerLabel={ownerLabel(project)}
                />
              {/each}
            </div>
          </section>
        {/each}
        {#if projectsQ.status === "CanLoadMore" || projectsQ.status === "LoadingMore"}
          <div class="flex justify-center border-t border-line-soft px-4 py-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={projectsQ.status === "LoadingMore"}
              onclick={() => projectsQ.loadMore(DASHBOARD_PROJECT_PAGE_SIZE)}
            >
              {projectsQ.status === "LoadingMore" ? "Loading…" : "Load more projects"}
            </Button>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>
