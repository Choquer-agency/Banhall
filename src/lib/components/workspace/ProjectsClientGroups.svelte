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
  // (its subscription releases to "skip"); the cap is disclosed in the UI.
  import { usePaginatedQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import { DASHBOARD_COMPANY_PAGE_SIZE } from "../../../../shared/dashboardProjection";
  import ProjectsClientGroup from "$lib/components/workspace/ProjectsClientGroup.svelte";
  import { verifiedStageCounts } from "$lib/workspace/stageRankGroups";

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
    countsAvailable = $bindable(false),
  }: {
    presentation?: "list" | "lanes";
    /** Client-surface hide-empty preference (exact stageCounts criterion). */
    hideEmpty?: boolean;
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

  const anyExpanded = $derived(expanded.length > 0);
  const expandAllCount = $derived(Math.min(companies.length, MAX_EXPANDED_SECTIONS));
  const expandAllCapped = $derived(companies.length > MAX_EXPANDED_SECTIONS);

  function toggleAll() {
    if (anyExpanded) {
      expanded = [];
    } else {
      // Honest bounded expand: opens the first N sections only — never an
      // unbounded fan-out of live queries.
      expanded = companies
        .slice(0, MAX_EXPANDED_SECTIONS)
        .map((company) => company.companyKey);
    }
  }
</script>

<div
  role="region"
  aria-label={presentation === "lanes"
    ? "Projects board grouped by client name"
    : "Projects grouped by client name"}
  class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
>
  <!-- Readable-but-quiet: secondary/muted ink tiers (QA 2026-08-06 flagged
       the faint/faint pairing as under-readable on the near-black canvas). -->
  <!-- Provenance stays visible at every viewport but compact on phones: the
       backfill notice flows inline with the qualifier below `sm` instead of
       taking its own line (live QA 2026-08-07 — first-viewport chrome). -->
  <div class="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-workspace-rail-line px-3 py-1.5">
    <p data-client-grouping-qualifier class="min-w-0 truncate text-xs text-ink-muted" title={`${GROUPING_QUALIFIER} ${BACKFILL_NOTICE}`}>
      Client names as entered
      <span class="mx-1 text-line" aria-hidden="true">·</span>
      <span class="text-ink-faint">Older projects may be missing</span>
      <span class="sr-only"> {GROUPING_QUALIFIER}</span>
      <span data-client-grouping-backfill-notice class="sr-only"> {BACKFILL_NOTICE}</span>
    </p>
    {#if companies.length > 0}
      <div class="flex shrink-0 flex-col items-end">
        <button
          type="button"
          data-toggle-all-groups
          onclick={toggleAll}
          class="min-h-11 shrink-0 rounded-lg px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:min-h-8"
        >{anyExpanded ? "Collapse all" : expandAllCapped ? `Expand first ${expandAllCount}` : "Expand all"}</button>
        {#if expandAllCapped}
          <!-- Persistent helper copy is information-bearing: secondary ink
               (≥4.5:1 at this 11px size), never faint (faint ≈2.6:1 on
               white — placeholders/disabled only; live QA 2026-08-07). -->
          <p data-expand-cap-note class="text-[0.6875rem] text-ink-secondary">
            Up to {MAX_EXPANDED_SECTIONS} sections stay open at once.
          </p>
        {/if}
      </div>
    {/if}
  </div>

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
    <!-- Band-headed sections stack flush (each closes with its own hairline)
         — ruled divider grammar on the white plane, not stacked outline
         boxes. -->
    <div class="flex flex-col">
      {#if presentation === "list"}
        <div
          data-client-table-header
          class="hidden h-9 grid-cols-[minmax(13rem,1fr)_6rem_minmax(18rem,1.15fr)_7rem_2.25rem] items-center border-b border-workspace-rail-line bg-gray-50 px-3 text-[0.6875rem] font-medium text-ink-muted sm:grid"
        >
          <span>Client</span>
          <span class="pl-2">Projects</span>
          <span>Stage mix</span>
          <span class="text-center">Create</span>
          <span class="sr-only">Open section</span>
        </div>
      {/if}
      {#each companies as company (company.companyKey)}
        <ProjectsClientGroup
          companyKey={company.companyKey}
          clientName={company.clientName}
          projectCount={company.projectCount}
          stageCounts={company.stageCounts}
          {hideEmpty}
          presentation={presentation === "lanes" ? "lane" : "list"}
          open={expanded.includes(company.companyKey)}
          onToggle={() => toggleGroup(company.companyKey)}
        />
      {/each}
    </div>
    <footer class="flex min-h-12 shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line-soft px-4 py-2">
      <!-- Truthful pagination footer: how many client names are actually on
           screen, qualified while more exist beyond the loaded pages. -->
      <p data-client-pagination-note class="text-xs text-ink-muted" role="status">
        Showing {companies.length} client name{companies.length === 1 ? "" : "s"}{hasMore
          ? " — more exist"
          : ""}
      </p>
      {#if hasMore}
        <button
          type="button"
          class="min-h-11 rounded-xl px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none"
          disabled={companiesQ.status === "LoadingMore"}
          onclick={() => companiesQ.loadMore(DASHBOARD_COMPANY_PAGE_SIZE)}
        >
          {companiesQ.status === "LoadingMore" ? "Loading…" : "Show more client names"}
        </button>
      {/if}
    </footer>
  {/if}
</div>
