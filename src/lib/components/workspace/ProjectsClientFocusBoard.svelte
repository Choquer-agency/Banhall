<script lang="ts">
  // Focused single-client board (2026-08-06 second amendment): one ten-stage
  // stage-first board scoped to one recorded client name, the drill-in state
  // of the grouped board (and its approved fallback default). Classic board
  // containment (board owns horizontal, columns own vertical); hide-empty ON
  // by default from the VERIFIED exact per-client stageCounts; breadcrumb
  // back to all clients. Recorded-name caveat carries verbatim — never a
  // durable Client.
  //
  // Below `md` the board presents one stage column at a time (snap/peek),
  // with an explicit "Stage N of M" indicator and an accessible stage
  // selector (2026-08-06 correction): selecting a stage scrolls the board to
  // that column and focuses its header — pure presentation navigation, never
  // a mutation. The indicator follows manual swipes/scrolls too.
  import { resolve } from "$app/paths";
  import { usePaginatedQuery, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import {
    DASHBOARD_PROJECT_PAGE_SIZE,
    DASHBOARD_UNNAMED_COMPANY_KEY,
  } from "../../../../shared/dashboardProjection";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import ProjectsBoard from "$lib/components/workspace/ProjectsBoard.svelte";
  import { verifiedStageCounts } from "$lib/workspace/stageRankGroups";
  import { toProjectsTableRow } from "$lib/workspace/projectRowMapping";

  type CompanyProjectsResult = FunctionReturnType<typeof api.dashboard.listCompanyProjectsByStageRank>;
  type ProjectRow = CompanyProjectsResult["page"][number];

  let {
    companyKey,
    hideEmpty = true,
    onShowEmpty,
    allClientsHref,
    countsAvailable = $bindable(false),
  }: {
    companyKey: string;
    hideEmpty?: boolean;
    onShowEmpty?: () => void;
    /** Breadcrumb target: the grouped board without the focus param. */
    allClientsHref: string;
    /**
     * Bindable: true when this client has VERIFIED exact stageCounts. The
     * toolbar uses it to disable the hide-empty control honestly while the
     * backfill has not established exact counts for this client.
     */
    countsAvailable?: boolean;
  } = $props();

  const auth = useAuth();
  const companyQ = useQuery(api.dashboard.getCompany, () =>
    auth.isAuthenticated ? { companyKey } : "skip"
  );
  const projectsQ = usePaginatedQuery(
    api.dashboard.listCompanyProjectsByStageRank,
    () => (auth.isAuthenticated ? { companyKey } : "skip"),
    { initialNumItems: DASHBOARD_PROJECT_PAGE_SIZE }
  );
  const projects = $derived(projectsQ.results as ProjectRow[]);
  const rows = $derived(projects.map(toProjectsTableRow));
  const exhausted = $derived(projectsQ.status === "Exhausted");
  const hasMore = $derived(
    projectsQ.status === "CanLoadMore" || projectsQ.status === "LoadingMore"
  );
  const company = $derived(companyQ.data ?? null);
  const unnamed = $derived(companyKey === DASHBOARD_UNNAMED_COMPANY_KEY);
  // The blank-name sentinel presents as the conditional "No client recorded"
  // section — never the stored "—" placeholder, and never a creation prefill.
  const clientName = $derived(
    company ? (unnamed ? "No client recorded" : company.clientName) : null
  );
  // Exact per-client stageCounts, trusted only when internally consistent
  // with projectCount (H3 defense). Absent/unverifiable = not backfilled →
  // loaded-only counts with honest qualifiers and no hiding, fail honest.
  const stageCounts = $derived(
    company ? verifiedStageCounts(company.stageCounts, company.projectCount) : undefined
  );
  const countsApproximate = $derived(stageCounts === undefined && !exhausted);
  $effect(() => {
    countsAvailable = stageCounts !== undefined;
  });
  // Client-scoped quick-create from the focus header (2026-08-11): editable
  // recorded-name prefill only, same contract as the grouped section headers.
  // The group model is keyed by client name alone (no per-fiscal-year rows),
  // so no fiscal-year param rides along. Never offered for the blank-name
  // sentinel — there is no recorded name to prefill.
  const newProjectHref = $derived(
    company && !unnamed
      ? `${resolve("/project/new")}?client=${encodeURIComponent(company.clientName)}`
      : null
  );

  // ── Mobile stage navigation (one column at a time below `md`) ──────────
  // Columns are read from the rendered board (stable [data-board-column]
  // attrs) so the selector always matches what hide-empty actually shows.
  let boardHost: HTMLElement | null = $state(null);
  let stageOptions = $state<{ id: string; label: string }[]>([]);
  let currentStageIndex = $state(0);

  function columnElements(): HTMLElement[] {
    return boardHost
      ? [...boardHost.querySelectorAll<HTMLElement>("[data-board-column]")]
      : [];
  }

  function stageLabel(id: string) {
    return id === "legacy"
      ? "Legacy status"
      : (WORKFLOW_STAGE_LABELS[id as keyof typeof WORKFLOW_STAGE_LABELS] ?? id);
  }

  // Re-read the rendered column set whenever the board's inputs change
  // ($effect runs after the DOM flush).
  $effect(() => {
    void rows;
    void stageCounts;
    void hideEmpty;
    const next = columnElements().map((el) => {
      const id = el.getAttribute("data-board-column") ?? "";
      return { id, label: stageLabel(id) };
    });
    stageOptions = next;
    if (currentStageIndex >= next.length) currentStageIndex = Math.max(0, next.length - 1);
  });

  // Follow manual swipes/scrolls: the indicator reflects the column nearest
  // the board's left edge.
  $effect(() => {
    const host = boardHost;
    if (!host) return;
    const region = host.querySelector<HTMLElement>('[role="region"]');
    if (!region) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const columns = columnElements();
        if (columns.length === 0) return;
        let nearest = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < columns.length; index += 1) {
          const distance = Math.abs(columns[index].offsetLeft - region.scrollLeft);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = index;
          }
        }
        currentStageIndex = nearest;
      });
    };
    region.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      region.removeEventListener("scroll", onScroll);
    };
  });

  const prefersReducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Scroll/focus the selected stage column — presentation only, no mutation. */
  function goToStage(index: number) {
    const columns = columnElements();
    const target = columns[index];
    if (!target) return;
    currentStageIndex = index;
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      inline: "start",
      block: "nearest",
    });
    target.querySelector<HTMLElement>("header")?.focus({ preventScroll: true });
  }
</script>

<section
  data-client-focus-board={companyKey}
  aria-label={`Focused client board${clientName ? ` — ${clientName}` : ""}`}
  class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
>
  <div class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1 pt-3">
    <a
      data-focus-breadcrumb
      href={allClientsHref}
      class="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none sm:min-h-8"
    ><span aria-hidden="true">←</span> All clients</a>
    {#if companyQ.isLoading}
      <span class="text-sm text-ink-muted" role="status">Loading client…</span>
    {:else if clientName}
      <span class="min-w-0 truncate text-sm font-medium text-ink">{clientName}</span>
      <span data-client-group-count class="shrink-0 text-xs text-ink-muted">· {company?.projectCount ?? 0} project{(company?.projectCount ?? 0) === 1 ? "" : "s"}</span>
      {#if newProjectHref}
        <!-- Ghost header control (design-system 2026-08-10): size-7
             rounded-full icon-only, title tooltip, muted-ink → chrome-wash
             hover. Quick-create scoped to this recorded client name. -->
        <a
          data-client-new-project
          href={newProjectHref}
          title={`New project for ${clientName}`}
          aria-label={`New project for ${clientName}`}
          class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-chrome/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none pointer-coarse:size-11"
        >
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </a>
      {/if}
    {:else}
      <span class="text-sm text-ink-muted" role="status">No recorded client name matches this link.</span>
    {/if}
  </div>
  <!-- Provenance stays visible at every viewport but compact on phones: the
       backfill notice flows inline with the qualifier below `sm` instead of
       taking its own line (live QA 2026-08-07 — first-viewport chrome). -->
  <p data-client-grouping-qualifier class="shrink-0 px-1 pb-2 text-xs text-ink-secondary">
    Grouped by recorded client name as entered on projects. Durable client records are not yet modelled.
    <span data-client-grouping-backfill-notice class="text-ink-muted sm:block">Projects created before grouping was enabled may not appear here.</span>
  </p>

  {#if projectsQ.error}
    <div class="flex flex-1 flex-col items-center justify-center p-8 text-center" role="alert">
      <h2 class="text-title text-ink">This client board could not be loaded</h2>
      <p class="mt-1 max-w-md text-sm text-ink-muted">Refresh the page and try again, or return to all clients.</p>
    </div>
  {:else if projectsQ.status === "LoadingFirstPage"}
    <div class="flex gap-2 overflow-hidden py-4" role="status" aria-label="Loading client board">
      {#each [0, 1, 2, 3] as item (item)}
        <div class="w-[320px] shrink-0">
          <div class="h-64 animate-pulse rounded-xl bg-gray-50 motion-reduce:animate-none"></div>
        </div>
      {/each}
    </div>
  {:else}
    {#if stageOptions.length > 0}
      <!-- One-column-at-a-time navigation for the mobile focused board:
           explicit position + an accessible selector. Presentation only. -->
      <nav
        data-focus-stage-nav
        aria-label="Focused board stage navigation"
        class="flex shrink-0 items-center gap-2 px-1 pb-2 md:hidden"
      >
        <span data-focus-stage-indicator class="text-data shrink-0 text-xs text-ink-muted" aria-live="polite">
          Stage {Math.min(currentStageIndex + 1, stageOptions.length)} of {stageOptions.length}
        </span>
        <label class="relative min-w-0 flex-1">
          <span class="sr-only">Go to stage</span>
          <select
            data-focus-stage-select
            value={String(currentStageIndex)}
            onchange={(event) => goToStage(Number(event.currentTarget.value))}
            class="h-11 w-full appearance-none rounded-xl border border-line bg-chrome/70 py-1 pl-3 pr-8 text-xs font-medium text-ink"
          >
            {#each stageOptions as option, index (option.id)}
              <option value={String(index)}>{option.label}</option>
            {/each}
          </select>
          <svg class="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </label>
      </nav>
    {/if}
    <div bind:this={boardHost} class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ProjectsBoard
        {rows}
        stageCounts={stageCounts ?? undefined}
        {countsApproximate}
        {hideEmpty}
        {onShowEmpty}
        newProjectClientName={unnamed ? null : clientName}
        showCardClient={false}
        regionLabel={`Client board${clientName ? ` — ${clientName}` : ""}. Scroll horizontally to review every workflow stage.`}
      />
    </div>
    {#if hasMore}
      <footer class="mt-auto flex min-h-12 shrink-0 items-center justify-center border-t border-line-soft px-4 py-2">
        <button
          type="button"
          class="min-h-11 rounded-xl px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none"
          disabled={projectsQ.status === "LoadingMore"}
          onclick={() => projectsQ.loadMore(DASHBOARD_PROJECT_PAGE_SIZE)}
        >
          {projectsQ.status === "LoadingMore" ? "Loading…" : "Show more projects"}
        </button>
      </footer>
    {/if}
  {/if}
</section>
