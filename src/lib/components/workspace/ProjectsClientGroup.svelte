<script lang="ts">
  // One recorded-client-name section of the Client → Fiscal year → Project
  // hierarchy (2026-08-14 sixth amendment). Server-backed and index-backed
  // selection stays bounded; the loaded page is arranged by the explicitly
  // selected within-year sort and grouped into recorded fiscal-year folders.
  // This is a display grouping of free-text client
  // names, never durable Client identity: no client pages, no merge
  // affordances. Project creation stays in the repository toolbar and board
  // stage footers rather than repeating an action on every client row.
  //
  // Presentations:
  // - "list": dense project cards inside each fiscal-year folder.
  // - "lane": the stage-column board inside each fiscal-year folder
  //   (ProjectsBoard — identical kanban
  //   anatomy to the ungrouped /projects board: same-tone columns,
  //   tinted-shell cards, per-column creation footers with this client's
  //   recorded-name prefill, horizontal snap scroll with the edge cue)
  //   rendered once for this client with its loaded rows and its VERIFIED
  //   exact stageCounts. Columns take natural height — the grouped board's
  //   outer vertical scroller owns the vertical axis. The 2026-08-06
  //   three-card preview and the "Show N more in Focus" navigation are
  //   retired (2026-08-12); when the server page is bounded, an honest
  //   "+N more" control loads more IN PLACE — never a navigation.
  //
  // Hide-empty (both presentations) uses ONLY the VERIFIED exact per-client
  // stageCounts (absent or sum-divergent = not backfilled = nothing hidden,
  // loaded-only counts with + / explicit not-fully-loaded markers). Empty
  // stages simply do not render; the Display menu's hide-empty switch is
  // the only reveal control (2026-08-12 — same decision as the main board).
  import { usePaginatedQuery } from "convex-svelte";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import { SvelteSet } from "svelte/reactivity";
  import { quintOut } from "svelte/easing";
  import { slide } from "svelte/transition";
  import {
    DASHBOARD_PROJECT_PAGE_SIZE,
    DASHBOARD_UNNAMED_COMPANY_KEY,
  } from "../../../../shared/dashboardProjection";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import { FolderDashedIcon, FolderIcon, FolderOpenIcon } from "phosphor-svelte";
  import ProjectBoardCard from "$lib/components/workspace/ProjectBoardCard.svelte";
  import ProjectsBoard from "$lib/components/workspace/ProjectsBoard.svelte";
  import { groupProjectsByFiscalYear } from "$lib/workspace/fiscalYearGroups";
  import { toProjectsTableRow } from "$lib/workspace/projectRowMapping";
  import { motionDuration } from "$lib/motion";
  import type { ProjectType } from "../../../../shared/projectTypes";
  import type { ClientProjectSort } from "$lib/dashboard/projectsTablePreferences";

  type CompanyProjectsResult = FunctionReturnType<typeof api.dashboard.listCompanyProjectsByStageRank>;
  type ProjectRow = CompanyProjectsResult["page"][number];

  let {
    companyKey,
    clientName,
    projectCount,
    stageCounts,
    hideEmpty = true,
    stage,
    ownerId,
    currentAssigneeId,
    projectType,
    sortBy = "project_number",
    presentation = "list",
    open,
    onToggle,
  }: {
    companyKey: string;
    /** Recorded client name as entered on projects — display text only. */
    clientName: string;
    /** Server-maintained recorded-projection count for this client name. */
    projectCount: number;
    /**
     * Exact per-client stage counts (transactionally maintained). Absent
     * means not yet backfilled; a record whose sum disagrees with
     * projectCount is treated the same (H3 consumer defense). Either way
     * nothing is hidden and loaded-only counts carry honest qualifiers.
     */
    stageCounts?: Record<string, number>;
    hideEmpty?: boolean;
    /** Optional repository filters applied by the indexed section query. */
    stage?: string;
    ownerId?: string;
    currentAssigneeId?: string;
    projectType?: ProjectType;
    sortBy?: ClientProjectSort;
    presentation?: "list" | "lane";
    open: boolean;
    onToggle: () => void;
  } = $props();

  // Blank recorded names key to the sentinel and present as the amendment's
  // conditional "No client recorded" section — never the stored "—" label,
  // and never a creation prefill (an em-dash client name would be a lie).
  const unnamed = $derived(companyKey === DASHBOARD_UNNAMED_COMPANY_KEY);
  const displayName = $derived(unnamed ? "No client recorded" : clientName);

  const disclosureId = $derived(`client-group-${encodeURIComponent(companyKey)}`);
  const filtered = $derived(Boolean(stage || ownerId || currentAssigneeId || projectType));
  const projectsQ = usePaginatedQuery(
    api.dashboard.listCompanyProjectsByStageRank,
    () =>
      open
        ? {
            companyKey,
            stage: stage as never,
            ownerId: ownerId as never,
            currentAssigneeId: currentAssigneeId as never,
            projectType,
            sortBy,
          }
        : "skip",
    { initialNumItems: DASHBOARD_PROJECT_PAGE_SIZE }
  );
  const projects = $derived(projectsQ.results as ProjectRow[]);
  const exhausted = $derived(projectsQ.status === "Exhausted");
  const hasMore = $derived(
    projectsQ.status === "CanLoadMore" || projectsQ.status === "LoadingMore"
  );
  const showError = $derived(open && Boolean(projectsQ.error));
  const showLoading = $derived(open && !projectsQ.error && projectsQ.status === "LoadingFirstPage");
  // Client → Fiscal year → Project is the repository hierarchy. The query
  // remains bounded; sort applies within each loaded fiscal-year section.
  const fiscalGroups = $derived(groupProjectsByFiscalYear(projects, sortBy));
  const collapsedFiscalGroups = new SvelteSet<string>();
  function toggleFiscalGroup(key: string) {
    if (collapsedFiscalGroups.has(key)) {
      collapsedFiscalGroups.delete(key);
    } else {
      collapsedFiscalGroups.add(key);
    }
  }
  const laneCountsApproximate = $derived(!exhausted);
  function fiscalStageCounts(rows: ProjectRow[]) {
    if (!exhausted) return undefined;
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const key = row.workflowStage ?? "legacy";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }
  // Honest in-place remainder for the bounded lane page: the recorded
  // projection count minus what is actually loaded. Load-more, never a
  // navigation (2026-08-12 — Focus retired).
  const laneMoreCount = $derived(
    filtered ? null : Math.max(0, projectCount - projects.length)
  );
</script>

<!-- Each recorded client is one quiet repository section. The restrained
     outline makes the client boundary legible while the project cards remain
     the primary content inside it. -->
<section
  data-client-group={companyKey}
  data-client-group-presentation={presentation}
  aria-labelledby={`${disclosureId}-heading`}
  class={`overflow-hidden rounded-lg border bg-surface transition-[border-color,background-color] duration-[325ms] motion-reduce:transition-none ${open ? "border-primary/40" : "border-line-soft"}`}
>
  <!-- One full-row disclosure avoids competing click targets. The recorded
       client name stands alone without a decorative initial badge; its
       chevron stays on the right edge and fiscal-year folders below remain
       visibly inset one level further. -->
  <div class={open ? "bg-primary-wash/75" : "bg-surface"}>
    <h3 id={`${disclosureId}-heading`} class="m-0">
      <button
        data-client-group-trigger
        data-client-group-chevron
        type="button"
        onclick={onToggle}
        aria-expanded={open}
        aria-controls={disclosureId}
        aria-label={`${open ? "Collapse" : "Expand"} ${displayName}`}
        class={`group/client grid min-h-11 w-full grid-cols-[minmax(0,1fr)_1.25rem] items-center gap-2 px-3 text-left transition-colors duration-[325ms] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:min-h-10 ${open ? "" : "hover:bg-workspace-rail-hover active:bg-chrome"}`}
      >
        <span class={`truncate text-[0.8125rem] font-medium ${open ? "text-primary-selected" : "text-ink"}`}>
          {displayName}
        </span>
        <DisclosureChevron {open} class="h-3.5 w-3.5 justify-self-end duration-[325ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]" />
      </button>
    </h3>
  </div>

  <!-- Closing still releases the query immediately. The first query does not
       paint temporary geometry: once real rows resolve, the actual fiscal
       hierarchy opens as one short, reduced-motion-aware reveal. -->
  {#if open}
    <div id={disclosureId} data-client-group-body class="border-t border-line-soft">
      {#if showError}
        <p class="px-4 py-6 text-center text-sm text-ink-muted" role="alert">
          This client group could not be loaded. Collapse and reopen it to retry.
        </p>
      {:else if showLoading}
        <p data-client-projects-loading class="sr-only" role="status">
          Loading {displayName} projects.
        </p>
      {:else}
        <div
          data-client-projects-resolved
          in:slide={{ duration: motionDuration(260), easing: quintOut, axis: "y" }}
        >
          {#if projects.length === 0}
            <p class="px-4 py-6 text-center text-sm text-ink-muted">
              {filtered ? "No projects in this client match the active filters." : "No loaded projects for this client name."}
            </p>
          {:else}
            <!-- Explorer hierarchy: Client → Fiscal year → Project. The
                 client heading is the outer disclosure; every fiscal folder
                 is one contained surface with its projects inside. -->
            <div class="space-y-2 bg-canvas/70 px-2 py-2 sm:px-3 sm:py-3">
              {#each fiscalGroups as fiscalGroup (fiscalGroup.key)}
                {@const fiscalOpen = !collapsedFiscalGroups.has(fiscalGroup.key)}
                {@const fiscalBodyId = `${disclosureId}-fy-${fiscalGroup.key}-body`}
                {@const unrecordedFiscalYear = fiscalGroup.year === null}
                <section
                  data-fiscal-year-group={fiscalGroup.key}
                  data-fiscal-year-kind={unrecordedFiscalYear ? "unrecorded" : "recorded"}
                  aria-labelledby={`${disclosureId}-fy-${fiscalGroup.key}`}
                  class={`overflow-hidden rounded-lg border bg-surface transition-colors duration-[240ms] motion-reduce:transition-none ${unrecordedFiscalYear ? "border-dashed border-line" : fiscalOpen ? "border-line" : "border-line-soft"}`}
                >
                  <h4 id={`${disclosureId}-fy-${fiscalGroup.key}`} class="m-0">
                    <button
                      data-fiscal-year-toggle={fiscalGroup.key}
                      type="button"
                      onclick={() => toggleFiscalGroup(fiscalGroup.key)}
                      aria-expanded={fiscalOpen}
                      aria-controls={fiscalBodyId}
                      aria-label={`${fiscalOpen ? "Collapse" : "Expand"} ${fiscalGroup.label}`}
                      class={`group/fiscal grid min-h-11 w-full grid-cols-[1rem_minmax(0,1fr)_1rem] items-center gap-2 px-3 text-left text-xs font-medium transition-colors duration-[240ms] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:min-h-8 ${unrecordedFiscalYear ? "text-ink-muted" : fiscalOpen ? "text-ink" : "text-ink-secondary"} ${fiscalOpen ? "bg-chrome/70" : "bg-surface hover:bg-workspace-rail-hover active:bg-chrome"}`}
                    >
                      {#if unrecordedFiscalYear}
                        <FolderDashedIcon size={15} weight="regular" class="shrink-0 text-ink-faint" aria-hidden="true" />
                      {:else if fiscalOpen}
                        <FolderOpenIcon size={15} weight="regular" class="shrink-0 text-ink-secondary" aria-hidden="true" />
                      {:else}
                        <FolderIcon size={15} weight="regular" class="shrink-0 text-ink-muted" aria-hidden="true" />
                      {/if}
                      <span class="min-w-0 truncate">{fiscalGroup.label}</span>
                      <DisclosureChevron open={fiscalOpen} tone="neutral" class="h-3.5 w-3.5 justify-self-end duration-[240ms] [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]" />
                    </button>
                  </h4>
                  <Disclosure id={fiscalBodyId} open={fiscalOpen}>
                    {#snippet children()}
                      <div data-fiscal-year-body={fiscalGroup.key} class="border-t border-line-soft bg-canvas/45">
                        {#if presentation === "lane"}
                          <div class="py-2">
                            <ProjectsBoard
                              rows={fiscalGroup.rows.map(toProjectsTableRow)}
                              stageCounts={fiscalStageCounts(fiscalGroup.rows)}
                              countsApproximate={laneCountsApproximate}
                              {hideEmpty}
                              newProjectClientName={unnamed ? null : clientName}
                              showCardClient={false}
                              showCardFiscalYear={false}
                              regionLabel={`${displayName}, ${fiscalGroup.label} board. Scroll horizontally to review every workflow stage.`}
                              idPrefix={`${disclosureId}-fy-${fiscalGroup.key}-board`}
                              columnHeadingLevel={4}
                            />
                          </div>
                        {:else}
                          <div role="list" class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-2 p-2.5">
                            {#each fiscalGroup.rows as project (project._id)}
                              <div role="listitem">
                                <ProjectBoardCard row={toProjectsTableRow(project)} showClient={false} showFiscalYear={false} showStage />
                              </div>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/snippet}
                  </Disclosure>
                </section>
              {/each}
            </div>
          {/if}
          {#if hasMore}
            <div class="border-t border-line-soft px-3 py-2">
              <button
                type="button"
                disabled={projectsQ.status === "LoadingMore"}
                onclick={() => projectsQ.loadMore(DASHBOARD_PROJECT_PAGE_SIZE)}
                class="min-h-11 rounded-lg px-3 text-xs font-medium text-ink-muted transition-colors duration-[240ms] hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none sm:min-h-8"
              >{projectsQ.status === "LoadingMore"
                  ? "Loading..."
                  : laneMoreCount !== null && laneMoreCount > 0
                    ? `Show ${laneMoreCount} more for ${displayName}`
                    : `Show more for ${displayName}`}</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>
