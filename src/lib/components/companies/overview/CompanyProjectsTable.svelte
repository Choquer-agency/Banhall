<!--
  A company's projects on its Overview tab (2026-11-04, Paper "Profile /
  Overview" and "Spec / Project row states"): one table (#, project, stage,
  fiscal year, owner, last updated), 10 a page with Previous, page numbers
  and Next, a search, filters for stage, fiscal year and owner, and a sort
  (last updated first). The whole row is one link to the project: on hover
  only the background changes; Cmd or Ctrl click opens a new tab; Tab
  reaches each row and its focus shows the hover background with a 2px teal
  ring. The fiscal year sections of cards stay on the Projects page.

  The server does the search, filters, sort and paging over the company's
  newest 300 projects (`companyProjects.listCompanyProjects`).
-->
<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { resolve } from "$app/paths";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import { IconCheck, IconChevronDown, IconSearch } from "$lib/components/icons";
  import { topBarPrimary } from "$lib/components/shell/topBar";
  import { newProjectSearch } from "$lib/projects/clientList";
  import { shortDate } from "$lib/companies/companies";
  import { WORKFLOW_STAGE_LABELS } from "../../../../../shared/workflowLabels";
  import type { WorkflowStage } from "../../../../../shared/workflowStages";

  let {
    companyKey,
    companyName,
    canCreate = false,
  }: {
    companyKey: string;
    companyName: string;
    /** New project for this company in the empty state (`project.create`). */
    canCreate?: boolean;
  } = $props();

  type Sort = "updated" | "title" | "number";
  const SORTS: { id: Sort; label: string }[] = [
    { id: "updated", label: "Last updated" },
    { id: "title", label: "Name, A to Z" },
    { id: "number", label: "Number" },
  ];

  const auth = useAuth();
  let search = $state("");
  let query = $state("");
  let stage = $state<WorkflowStage | null>(null);
  /** undefined: every year; null: no fiscal year. */
  let fiscalYear = $state<number | null | undefined>(undefined);
  let ownerId = $state<string | null>(null);
  let sort = $state<Sort>("updated");
  let page = $state(1);

  // The search waits for a pause in typing before it asks the server.
  $effect(() => {
    const next = search.trim();
    const timer = setTimeout(() => {
      query = next;
    }, 200);
    return () => clearTimeout(timer);
  });

  // A different company, or a changed search, filter or sort, starts at page 1.
  let filterKey = $derived(JSON.stringify([companyKey, query, stage, fiscalYear === undefined ? "all" : fiscalYear === null ? "none" : fiscalYear, ownerId, sort]));
  let lastFilterKey = $state("");
  $effect(() => {
    if (filterKey === lastFilterKey) return;
    lastFilterKey = filterKey;
    page = 1;
  });

  const projectsQ = useQuery(api.companyProjects.listCompanyProjects, () =>
    auth.isAuthenticated
      ? {
          companyKey,
          ...(query ? { search: query } : {}),
          ...(stage ? { stage } : {}),
          ...(fiscalYear !== undefined ? { fiscalYear } : {}),
          ...(ownerId ? { ownerId: ownerId as Id<"users"> } : {}),
          ...(sort !== "updated" ? { sort } : {}),
          ...(page > 1 ? { page } : {}),
        }
      : "skip"
  );
  // The last answer stays on screen while the next one loads, so the table does not jump.
  type Result = NonNullable<typeof projectsQ.data>;
  let shown = $state.raw<Result | null>(null);
  let shownKey = $state<string | null>(null);
  $effect(() => {
    if (projectsQ.data) {
      shown = projectsQ.data;
      shownKey = companyKey;
    }
  });
  const data = $derived(shownKey === companyKey ? shown : null);
  const filtered = $derived(Boolean(query || stage || fiscalYear !== undefined || ownerId));

  function clearFilters() {
    search = "";
    query = "";
    stage = null;
    fiscalYear = undefined;
    ownerId = null;
  }

  const stageLabel = $derived(stage ? WORKFLOW_STAGE_LABELS[stage] : null);
  const yearLabel = $derived(fiscalYear === undefined ? null : fiscalYear === null ? "No fiscal year" : `FY ${fiscalYear}`);
  const ownerLabel = $derived(ownerId ? (data?.options.owners.find((owner) => owner.id === ownerId)?.name ?? "Owner") : null);
  const sortLabel = $derived(SORTS.find((entry) => entry.id === sort)!.label);

  /** Page numbers with gaps: every page up to 7, else the first, the last and two either side. */
  const pageItems = $derived.by(() => {
    const count = data?.pageCount ?? 1;
    const current = data?.page ?? 1;
    if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
    const pages = new Set([1, count, current - 1, current, current + 1]);
    if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
    if (current >= count - 2) [count - 3, count - 2, count - 1].forEach((p) => pages.add(p));
    const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
    const items: (number | "gap")[] = [];
    for (const p of sorted) {
      const previous = items.at(-1);
      if (typeof previous === "number" && p - previous > 1) items.push("gap");
      items.push(p);
    }
    return items;
  });

  const rangeLabel = $derived.by(() => {
    if (!data || data.total === 0) return "";
    const from = (data.page - 1) * data.pageSize + 1;
    const to = Math.min(data.total, data.page * data.pageSize);
    return `${from} to ${to} of ${data.total} ${data.total === 1 ? "project" : "projects"}`;
  });

  const trigger =
    "inline-flex h-[2.125rem] min-w-0 shrink-0 items-center gap-1.5 rounded-[0.5625rem] border pr-2.5 pl-3 text-[0.8125rem] leading-[calc(16/13)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11";
  const triggerIdle = "border-line bg-surface text-ink-secondary hover:bg-primary-wash";
  const triggerActive = "border-primary-line bg-primary-wash text-fir";
  const menu = "z-[100] max-h-[min(22rem,60vh)] min-w-[12rem] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-menu outline-none";
  const item =
    "flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-[0.8125rem] leading-[calc(16/13)] text-ink outline-none data-[highlighted]:bg-primary-wash pointer-coarse:h-11";
  const pageButton =
    "flex h-[1.875rem] min-w-[1.875rem] items-center justify-center rounded-md px-1.5 text-xs leading-[calc(4/3)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11 pointer-coarse:min-w-11";
</script>

{#snippet check(on: boolean)}
  <span class="flex w-3.5 shrink-0 justify-center text-primary-selected">{#if on}<IconCheck size={13} strokeWidth={2.4} />{/if}</span>
{/snippet}

{#snippet filterMenu(id: string, label: string, value: string | null, options: { value: string; label: string }[], current: string, onPick: (value: string) => void)}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger data-projects-filter={id} aria-label={value ? `${label}: ${value}` : label} class={`${trigger} ${value ? triggerActive : triggerIdle}`}>
      <span class="truncate">{value ?? label}</span>
      <IconChevronDown size={12} strokeWidth={2.2} class="shrink-0 text-ink-muted" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content side="bottom" align="start" sideOffset={6} class={menu} data-projects-filter-menu={id}>
        <DropdownMenu.RadioGroup value={current} onValueChange={onPick}>
          {#each options as option (option.value)}
            <DropdownMenu.RadioItem value={option.value} class={item} data-projects-filter-option={option.value}>
              {#snippet children({ checked })}
                {@render check(checked)}
                <span class="truncate">{option.label}</span>
              {/snippet}
            </DropdownMenu.RadioItem>
          {/each}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
{/snippet}

<section data-company-projects aria-labelledby="company-projects-title" class="flex flex-col gap-3.5">
  <h2 id="company-projects-title" class="flex items-center gap-2 text-[0.9375rem] leading-[calc(4/3)]">
    <span class="font-medium text-ink">Projects</span>
    {#if data}<span class="text-ink-faint" data-company-projects-count>{data.truncated ? `${data.all}+` : data.all}</span>{/if}
  </h2>

  {#if data && data.all === 0 && !filtered}
    <!-- Paper Z9a: a company with no projects yet. -->
    <div class="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-line px-6 py-[4.5rem] text-center" data-client-empty>
      <p class="text-base leading-[1.5] font-medium text-ink">No projects for {companyName} yet</p>
      <p class="max-w-[26.25rem] text-[0.9375rem] leading-[calc(22/15)] text-ink-secondary">Start a project and it will show up here.</p>
      {#if canCreate}
        <a href={`${resolve("/project/new")}${newProjectSearch(companyName)}`} data-client-new-project class={`${topBarPrimary} mt-1 max-w-full`}>
          <span class="truncate">New project for {companyName}</span>
        </a>
      {/if}
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-2" data-company-projects-toolbar>
      <div role="search" class="relative w-60 max-w-full shrink-0">
        <IconSearch size={14} strokeWidth={2} class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          bind:value={search}
          type="search"
          aria-label="Search projects"
          placeholder="Search projects"
          autocomplete="off"
          data-company-projects-search
          onkeydown={(event) => {
            if (event.key === "Escape" && search) {
              event.stopPropagation();
              search = "";
            }
          }}
          class="field-control h-[2.125rem] w-full rounded-[0.5625rem] pr-3 pl-8 text-[0.8125rem] leading-[calc(16/13)] text-ink placeholder:text-ink-muted pointer-coarse:h-11"
        />
      </div>
      {@render filterMenu(
        "stage",
        "Stage",
        stageLabel,
        [{ value: "", label: "All stages" }, ...(data?.options.stages ?? []).map((value) => ({ value, label: WORKFLOW_STAGE_LABELS[value] }))],
        stage ?? "",
        (value) => (stage = (value || null) as WorkflowStage | null)
      )}
      {@render filterMenu(
        "fiscal-year",
        "Fiscal year",
        yearLabel,
        [
          { value: "", label: "All fiscal years" },
          ...(data?.options.fiscalYears ?? []).map((year) => ({ value: String(year), label: `FY ${year}` })),
          ...(data?.options.noFiscalYear ? [{ value: "none", label: "No fiscal year" }] : []),
        ],
        fiscalYear === undefined ? "" : fiscalYear === null ? "none" : String(fiscalYear),
        (value) => (fiscalYear = value === "" ? undefined : value === "none" ? null : Number(value))
      )}
      {@render filterMenu(
        "owner",
        "Owner",
        ownerLabel,
        [{ value: "", label: "Everyone" }, ...(data?.options.owners ?? []).map((owner) => ({ value: owner.id, label: owner.name }))],
        ownerId ?? "",
        (value) => (ownerId = value || null)
      )}
      {#if filtered}
        <button
          type="button"
          data-company-projects-clear
          onclick={clearFilters}
          class="inline-flex h-[2.125rem] items-center rounded-[0.5625rem] px-2.5 text-[0.8125rem] leading-[calc(16/13)] text-ink-secondary transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
        >Clear</button>
      {/if}
      <div class="flex-1"></div>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          data-company-projects-sort
          aria-label={`Sort: ${sortLabel}`}
          class="inline-flex h-[2.125rem] shrink-0 items-center gap-1.5 rounded-[0.5625rem] px-2.5 text-[0.8125rem] leading-[calc(16/13)] text-ink-secondary transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="size-3.5 shrink-0">
            <path d="M7 4v16M3 16l4 4 4-4M14 6h7M14 12h5M14 18h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {sortLabel}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="bottom" align="end" sideOffset={6} class={menu} data-company-projects-sort-menu>
            <DropdownMenu.RadioGroup value={sort} onValueChange={(value) => (sort = value as Sort)}>
              {#each SORTS as entry (entry.id)}
                <DropdownMenu.RadioItem value={entry.id} class={item} data-company-projects-sort-option={entry.id}>
                  {#snippet children({ checked })}
                    {@render check(checked)}
                    {entry.label}
                  {/snippet}
                </DropdownMenu.RadioItem>
              {/each}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>

    <div class="overflow-hidden rounded-xl border border-line" data-company-projects-table>
      {#if projectsQ.error && !data}
        <p role="alert" class="px-4 py-6 text-[0.8125rem] leading-[calc(18/13)] text-ink-muted">The projects could not be loaded. Refresh the page to try again.</p>
      {:else}
        <table class="w-full table-fixed border-collapse text-left">
          <caption class="sr-only">{companyName}'s projects</caption>
          <thead>
            <tr class="h-9 border-b border-line bg-gray-50 text-xs leading-[calc(4/3)] text-ink-muted">
              <th scope="col" class="pr-3.5 pl-4 font-normal">Project</th>
              <th scope="col" class="w-[8.75rem] pr-3.5 font-normal">Stage</th>
              <th scope="col" class="w-[5.625rem] pr-3.5 font-normal max-md:hidden">Year</th>
              <th scope="col" class="w-[8.125rem] pr-3.5 font-normal max-md:hidden">Owner</th>
              <th scope="col" class="w-[6.875rem] pr-4 text-right font-normal max-sm:hidden">Updated</th>
            </tr>
          </thead>
          <tbody aria-busy={projectsQ.isLoading ? "true" : undefined}>
            {#if !data}
              {#each [0, 1, 2, 3, 4] as row (row)}
                <tr class="h-[2.875rem] border-b border-line-soft last:border-b-0" data-company-projects-skeleton>
                  <td class="pr-3.5 pl-4"><span class="block h-3.5 w-48 max-w-full rounded bg-chrome"></span></td>
                  <td class="pr-3.5"><span class="block h-5 w-20 rounded-full bg-chrome"></span></td>
                  <td class="pr-3.5 max-md:hidden"><span class="block h-3 w-14 rounded bg-chrome"></span></td>
                  <td class="pr-3.5 max-md:hidden"><span class="block h-3 w-20 rounded bg-chrome"></span></td>
                  <td class="pr-4 max-sm:hidden"><span class="ml-auto block h-3 w-16 rounded bg-chrome"></span></td>
                </tr>
              {/each}
            {:else if data.rows.length === 0}
              <tr>
                <td colspan="5" class="px-4 py-8 text-center" data-company-projects-none>
                  <p class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">No projects match these filters.</p>
                </td>
              </tr>
            {:else}
              {#each data.rows as row (row._id)}
                <tr
                  data-company-project-row={row._id}
                  class="group/row relative h-[2.875rem] border-b border-line-soft bg-surface transition-colors duration-[80ms] ease-out last:border-b-0 hover:bg-gray-50 hover:duration-[120ms] has-[a:focus-visible]:bg-gray-50 motion-reduce:transition-none"
                >
                  <td class="pr-3.5 pl-4">
                    <div class="flex min-w-0 items-center gap-2.5">
                      <span class="w-7 shrink-0 font-mono text-xs leading-[calc(4/3)] text-ink-faint" data-company-project-number>{row.projectNumber ? `#${row.projectNumber}` : ""}</span>
                      <a
                        href={resolve("/project/[id]", { id: row._id })}
                        data-company-project-link={row._id}
                        class="min-w-0 truncate text-sm font-medium leading-[calc(9/7)] text-ink outline-none after:absolute after:inset-0 after:rounded-[0.625rem] after:content-[''] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary"
                      >{row.title}</a>
                    </div>
                  </td>
                  <td class="pr-3.5"><div class="flex">
                    <StageBadge stage={row.stage} dot />
                  </div></td>
                  <td class="truncate pr-3.5 font-mono text-xs leading-[calc(4/3)] text-ink-secondary max-md:hidden">{row.fiscalYear !== null ? `FY ${row.fiscalYear}` : ""}</td>
                  <td class="truncate pr-3.5 text-[0.8125rem] leading-[calc(16/13)] text-ink-secondary max-md:hidden">{row.ownerName ?? ""}</td>
                  <td class="truncate pr-4 text-right text-[0.8125rem] leading-[calc(16/13)] text-ink-muted max-sm:hidden">{shortDate(row.updatedAt)}</td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      {/if}
    </div>

    {#if data && data.total > 0}
      <nav aria-label="Project pages" class="flex h-9 shrink-0 items-center gap-3 px-1" data-company-projects-pages>
        <p class="text-xs leading-[calc(4/3)] text-ink-muted" data-company-projects-range>{rangeLabel}</p>
        <div class="flex-1"></div>
        {#if data.pageCount > 1}
          <div class="flex items-center gap-1">
            <button
              type="button"
              data-company-projects-previous
              disabled={data.page <= 1}
              onclick={() => (page = data.page - 1)}
              class={`${pageButton} gap-1 pr-2.5 pl-1.5 text-ink enabled:hover:bg-primary-wash disabled:text-ink-faint`}
            ><svg viewBox="0 0 24 24" aria-hidden="true" class="size-3.5"><path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>Previous</button>
            {#each pageItems as item, index (index)}
              {#if item === "gap"}
                <span aria-hidden="true" class="px-1 text-xs text-ink-faint">...</span>
              {:else}
                <button
                  type="button"
                  data-company-projects-page={item}
                  aria-label={`Page ${item}`}
                  aria-current={item === data.page ? "page" : undefined}
                  onclick={() => (page = item)}
                  class={`${pageButton} ${item === data.page ? "bg-primary-selected font-medium text-white" : "text-ink-secondary hover:bg-primary-wash"}`}
                >{item}</button>
              {/if}
            {/each}
            <button
              type="button"
              data-company-projects-next
              disabled={data.page >= data.pageCount}
              onclick={() => (page = data.page + 1)}
              class={`${pageButton} gap-1 pr-1.5 pl-2.5 text-ink enabled:hover:bg-primary-wash disabled:text-ink-faint`}
            >Next<svg viewBox="0 0 24 24" aria-hidden="true" class="size-3.5"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></button>
          </div>
        {/if}
      </nav>
    {/if}
  {/if}
</section>
