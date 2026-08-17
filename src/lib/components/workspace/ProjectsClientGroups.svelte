<script lang="ts">
  // Client → Status container for the Projects repository (2026-08-06 second
  // amendment). Truthful and server-backed end to end: sections come from
  // dashboard.listCompanies (by_companyKey, A→Z, index-backed, paginated);
  // each section's projects come from dashboard.listCompanyProjectsByStageRank
  // (frozen stage-rank index order, paginated). No client-side reordering
  // presented as truth, no "Company" noun anywhere, no durable Client
  // identity claimed.
  //
  // Presentations:
  // - "list": collapsed client sections with status sub-headers (L1).
  // - "lanes": stacked client lanes, each rendering the STANDARD
  //   stage-column board (ProjectsBoard) scoped to that client — the Focus
  //   drill-in and per-lane preview caps were retired 2026-08-12 — the
  //   grouped Board mode. The first AUTO_EXPAND_LANES lanes auto-expand;
  //   the rest stay collapsed header rows with ZERO subscriptions until
  //   expanded (open ? args : "skip"). One outer vertical scroller owns the
  //   page in this mode (lane columns take natural height).
  //
  // Subscription budget (H1 correction 2026-08-06): at most
  // MAX_EXPANDED_SECTIONS sections hold a live per-section query at once —
  // including user toggles, expand-all, and every loaded client page.
  // Opening a section beyond the cap collapses the least-recently-opened one
  // (its subscription releases to "skip"). The budget stays implementation
  // detail instead of adding explanatory chrome above the project cards.
  import { usePaginatedQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import { DASHBOARD_COMPANY_PAGE_SIZE } from "../../../../shared/dashboardProjection";
  import ProjectsClientGroup from "$lib/components/workspace/ProjectsClientGroup.svelte";
  import { verifiedStageCounts } from "$lib/workspace/stageRankGroups";
  import type { ProjectType } from "../../../../shared/projectTypes";
  import type { ClientProjectSort } from "$lib/dashboard/projectsTablePreferences";

  type CompanyRow = FunctionReturnType<typeof api.dashboard.listCompanies>["page"][number];

  /**
   * Exact qualifier copy (plan §1.3). Grouping is display normalization of
   * free-text client names; D7/PSOS-31/32 own real Clients.
   */
  const GROUPING_QUALIFIER =
    "Grouped by recorded client name as entered on projects. Durable client records are not yet modelled.";
  /**
   * Interim under-reporting notice (plan §1.3 ops gate). Remove only after
   * the production backfill-completeness check (every project has
   * dashboardCompanyCounted === true) is verified and dated in the
   * product-domain amendment.
   */
  const BACKFILL_NOTICE =
    "Projects created before grouping was enabled may not appear here.";
  /** Subscription policy: auto-expanded lanes on first paint (budget 1 + K). */
  const AUTO_EXPAND_LANES = 5;
  /**
   * Hard cap on simultaneously expanded sections = live per-section
   * subscriptions (synthesis §D.5: K ≤ ~6). Applies to every path that can
   * open a section: user toggles, expand-all, and any number of loaded
   * client pages.
   */
  const MAX_EXPANDED_SECTIONS = 6;

  let {
    presentation = "list",
    hideEmpty = true,
    stage,
    ownerId,
    currentAssigneeId,
    projectType,
    sortBy = "project_number",
    countsAvailable = $bindable(false),
  }: {
    presentation?: "list" | "lanes";
    /** Client-surface hide-empty preference (exact stageCounts criterion). */
    hideEmpty?: boolean;
    /** Applied project filters. Client headings remain the stable A-Z index. */
    stage?: string;
    ownerId?: string;
    currentAssigneeId?: string;
    projectType?: ProjectType;
    sortBy?: ClientProjectSort;
    /**
     * Bindable: true once at least one loaded client has VERIFIED exact
     * stageCounts. The toolbar uses it to disable the hide-empty control
     * honestly before the backfill (pre-backfill it cannot take effect).
     */
    countsAvailable?: boolean;
  } = $props();

  const auth = useAuth();
  // Insertion-ordered so the cap can evict the least-recently-opened
  // section. $state on a plain array keeps reactivity.
  let expanded = $state<string[]>([]);
  // Lanes auto-expand the first page's first K clients exactly once.
  let autoExpanded = $state(false);

  const companiesQ = usePaginatedQuery(
    api.dashboard.listCompanies,
    () => (auth.isAuthenticated ? {} : "skip"),
    { initialNumItems: DASHBOARD_COMPANY_PAGE_SIZE }
  );
  const companies = $derived(companiesQ.results as CompanyRow[]);
  const loadingFirstPage = $derived(companiesQ.status === "LoadingFirstPage");
  const hasMore = $derived(
    companiesQ.status === "CanLoadMore" || companiesQ.status === "LoadingMore"
  );

  // Board must not paint a collapsed-list frame before its lane bootstrap
  // effect runs. That intermediate DOM was visible when switching from the
  // grouped List: client rows rendered collapsed for one frame, then jumped
  // open as their Board queries mounted. Treat the first K lane keys as open
  // synchronously; the effect below commits the exact same keys to durable
  // local disclosure state, so the first and subsequent Board frames match.
  const visibleExpanded = $derived(
    presentation === "lanes" && !autoExpanded
      ? companies
          .slice(0, Math.min(AUTO_EXPAND_LANES, MAX_EXPANDED_SECTIONS))
          .map((company) => company.companyKey)
      : expanded
  );

  $effect(() => {
    countsAvailable = companies.some(
      (company) =>
        verifiedStageCounts(company.stageCounts, company.projectCount) !== undefined
    );
  });

  $effect(() => {
    if (presentation !== "lanes" || autoExpanded || companies.length === 0) return;
    expanded = companies
      .slice(0, Math.min(AUTO_EXPAND_LANES, MAX_EXPANDED_SECTIONS))
      .map((company) => company.companyKey);
    autoExpanded = true;
  });

  function openGroup(companyKey: string) {
    const next = expanded.filter((key) => key !== companyKey);
    next.push(companyKey);
    // Cap enforcement: evict the least-recently-opened section so the total
    // live per-section subscriptions never exceed the budget.
    while (next.length > MAX_EXPANDED_SECTIONS) next.shift();
    expanded = next;
  }

  function toggleGroup(companyKey: string) {
    if (expanded.includes(companyKey)) {
      expanded = expanded.filter((key) => key !== companyKey);
    } else {
      openGroup(companyKey);
    }
  }

</script>

<div
  role="region"
  aria-label={presentation === "lanes"
    ? "Projects board grouped by client name"
    : "Projects grouped by client name"}
  aria-describedby="client-grouping-description"
  class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-chrome/25"
>
  <p id="client-grouping-description" class="sr-only">
    {GROUPING_QUALIFIER} {BACKFILL_NOTICE}
  </p>

  {#if companiesQ.error}
    <div class="flex flex-1 flex-col items-center justify-center p-8 text-center" role="alert">
      <h2 class="text-title text-ink">Client groups could not be loaded</h2>
      <p class="mt-1 max-w-md text-sm text-ink-muted">Refresh the page and try again, or switch back to the flat list.</p>
    </div>
  {:else if loadingFirstPage}
    <div class="space-y-2 py-3" role="status" aria-label="Loading client groups">
      <div class="h-11 animate-pulse rounded-xl bg-chrome motion-reduce:animate-none"></div>
      <div class="h-11 animate-pulse rounded-xl bg-chrome motion-reduce:animate-none"></div>
      <div class="h-11 animate-pulse rounded-xl bg-chrome motion-reduce:animate-none"></div>
    </div>
  {:else if companies.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p class="text-sm font-medium text-ink">No client name groups to show</p>
      <p class="mt-1 max-w-md text-xs text-ink-muted">{BACKFILL_NOTICE}</p>
    </div>
  {:else}
    <div data-client-groups class="flex flex-col gap-2 p-2 sm:p-3">
      {#each companies as company (company.companyKey)}
        <ProjectsClientGroup
          companyKey={company.companyKey}
          clientName={company.clientName}
          projectCount={company.projectCount}
          stageCounts={company.stageCounts}
          {hideEmpty}
          {stage}
          {ownerId}
          {currentAssigneeId}
          {projectType}
          {sortBy}
          presentation={presentation === "lanes" ? "lane" : "list"}
          open={visibleExpanded.includes(company.companyKey)}
          onToggle={() => toggleGroup(company.companyKey)}
        />
      {/each}
    </div>
    {#if hasMore}
      <div class="flex shrink-0 justify-center px-4 pb-4">
        <button
          type="button"
          class="min-h-11 rounded-lg border border-line-soft bg-surface px-3 text-xs font-medium text-ink-secondary transition-colors duration-[325ms] hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none"
          disabled={companiesQ.status === "LoadingMore"}
          onclick={() => companiesQ.loadMore(DASHBOARD_COMPANY_PAGE_SIZE)}
        >
          {companiesQ.status === "LoadingMore" ? "Loading..." : "Show more clients"}
        </button>
      </div>
    {/if}
  {/if}
</div>
