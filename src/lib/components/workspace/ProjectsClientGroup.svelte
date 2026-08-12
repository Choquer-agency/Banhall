<script lang="ts">
  // One recorded-client-name section of the Client → Status Projects views
  // (2026-08-06 second amendment; Focus drill-in retired and lanes flattened
  // 2026-08-12, owner direction). Server-backed and index-backed only:
  // projects arrive from dashboard.listCompanyProjectsByStageRank in frozen
  // stage-rank order; the pipeline-ordered sub-groups are a lossless re-map
  // of complete rank runs (stageRankGroups.ts) — never a client-side sort
  // presented as truth. This is a display grouping of free-text client
  // names, never durable Client identity: no client pages, no merge
  // affordances. Creation links are navigation into the existing wizard
  // with an editable recorded-name prefill (omitted for the "No client
  // recorded" section — there is no recorded name to prefill).
  //
  // Presentations:
  // - "list": status sub-headers inside a collapsible section (L1).
  // - "lane": the REAL stage-column board (ProjectsBoard — identical kanban
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
  import { resolve } from "$app/paths";
  import { usePaginatedQuery } from "convex-svelte";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import {
    DASHBOARD_PROJECT_PAGE_SIZE,
    DASHBOARD_UNNAMED_COMPANY_KEY,
  } from "../../../../shared/dashboardProjection";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import LegacyStatusBadge from "$lib/components/ui/LegacyStatusBadge.svelte";
  import ProjectsBoard from "$lib/components/workspace/ProjectsBoard.svelte";
  import {
    groupRowsByStageRank,
    verifiedStageCounts,
    visibleStageGroups,
  } from "$lib/workspace/stageRankGroups";
  import { toProjectsTableRow } from "$lib/workspace/projectRowMapping";

  type CompanyProjectsResult = FunctionReturnType<typeof api.dashboard.listCompanyProjectsByStageRank>;
  type ProjectRow = CompanyProjectsResult["page"][number];

  let {
    companyKey,
    clientName,
    projectCount,
    stageCounts,
    hideEmpty = true,
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
  const projectsQ = usePaginatedQuery(
    api.dashboard.listCompanyProjectsByStageRank,
    () => (open ? { companyKey } : "skip"),
    { initialNumItems: DASHBOARD_PROJECT_PAGE_SIZE }
  );
  const projects = $derived(projectsQ.results as ProjectRow[]);
  const exhausted = $derived(projectsQ.status === "Exhausted");
  const hasMore = $derived(
    projectsQ.status === "CanLoadMore" || projectsQ.status === "LoadingMore"
  );
  // Closing releases the subscription instantly (query gates on `open`,
  // subscription-cap contract unchanged) but the ≥300ms exit animation still
  // needs content to collapse over — snapshot the last loaded page while
  // open; the closed body is inert (Disclosure), never tabbable.
  let lastLoaded = $state<{ rows: ProjectRow[]; exhausted: boolean }>({
    rows: [],
    exhausted: false,
  });
  $effect(() => {
    if (open) lastLoaded = { rows: projects, exhausted };
  });
  const effectiveRows = $derived(open ? projects : lastLoaded.rows);
  const effectiveExhausted = $derived(open ? exhausted : lastLoaded.exhausted);
  const showError = $derived(open && Boolean(projectsQ.error));
  const showLoading = $derived(open && !projectsQ.error && projectsQ.status === "LoadingFirstPage");
  // H3 consumer defense: only an internally consistent record is exact.
  const usableStageCounts = $derived(verifiedStageCounts(stageCounts, projectCount));
  const stageView = $derived(
    visibleStageGroups(
      groupRowsByStageRank(effectiveRows, effectiveExhausted),
      usableStageCounts,
      hideEmpty
    )
  );
  // Per-client board count truth (same ladder the retired focused board
  // used): verified exact counts are exact; otherwise loaded-only counts
  // carry "+" qualifiers until the page exhausts, at which point loaded IS
  // complete.
  const laneCountsApproximate = $derived(
    usableStageCounts === undefined && !effectiveExhausted
  );
  // A lane with zero loaded rows still renders the board when verified
  // counts prove projects exist (BoardColumnHeader then carries the honest
  // "none loaded yet" qualifier); with no such proof it states the loaded
  // truth plainly.
  const laneCountsNonZero = $derived(
    usableStageCounts !== undefined &&
      Object.values(usableStageCounts).some((count) => count > 0)
  );
  // Honest in-place remainder for the bounded lane page: the recorded
  // projection count minus what is actually loaded. Load-more, never a
  // navigation (2026-08-12 — Focus retired).
  const laneMoreCount = $derived(Math.max(0, projectCount - effectiveRows.length));
  const newProjectHref = $derived(
    unnamed
      ? resolve("/project/new")
      : `${resolve("/project/new")}?client=${encodeURIComponent(clientName)}`
  );
</script>

{#snippet countText(count: number, countSuffix: "" | "+", unverified: boolean)}
  {count}{countSuffix}{#if unverified && count === 0}<span
      data-unverified-count
      class="block text-[0.6875rem] font-normal text-ink-muted"
    >not fully loaded</span>{/if}
{/snippet}

<!-- Band-headed section (light workspace redesign 2026-08-06; tightened
     2026-08-12): the client header is a full-width pale band and the content
     sits flush on the white plane beneath, closed by a hairline — no rounded
     outline box and no radius on the band itself (Linear group-band grammar).
     Header keeps label/name/mono count/stage chips/quick-create and 44px
     targets at every viewport. -->
<section
  data-client-group={companyKey}
  data-client-group-presentation={presentation}
  aria-labelledby={`${disclosureId}-heading`}
  class="border-b border-line-soft"
>
  <!-- Below `sm` the header is a two-row grid so the client name wins the
       full first line (live QA 2026-08-07); the quick-create link moves to a
       second action row (standard stacked-toolbar affordance, 44px targets,
       exact labels/hrefs unchanged). From `sm` up `sm:contents` dissolves
       the action wrapper and the header stays the efficient single row. -->
  <div class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center bg-gray-50 pr-1 sm:flex sm:min-h-11 sm:gap-2">
    <h3 id={`${disclosureId}-heading`} class="m-0 min-w-0 sm:flex-1">
      <button
        type="button"
        onclick={onToggle}
        aria-expanded={open}
        aria-controls={disclosureId}
        class="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
      >
        <span class="text-label shrink-0" aria-hidden="true">Client</span>
        <span class={`truncate text-sm font-medium ${open ? "text-primary-selected" : "text-ink"}`}>{displayName}</span>
        <span data-client-group-count class="text-data shrink-0 text-ink-muted">{projectCount}<span class="sr-only">{projectCount === 1 ? " project" : " projects"}</span></span>
      </button>
    </h3>
    <!-- Decorative state chevron (rule 7: right edge, down → up when open);
         the section heading button is the real disclosure control. -->
    <span class="flex h-11 w-8 shrink-0 items-center justify-center sm:order-last" aria-hidden="true">
      <DisclosureChevron {open} />
    </span>
    <!-- Client-scoped creation stays reachable at every viewport (390px
         included — live QA 2026-08-06): compact "+ New" label below sm,
         full label from sm up, 44px target either way. Quiet text action:
         opacity-only hover, no wash fill (2026-08-12 taste pass). -->
    <div class="col-span-2 flex items-center gap-2 pb-0.5 pl-1 sm:contents">
      <a
        data-client-new-project
        href={newProjectHref}
        aria-label={unnamed ? "New project" : `New project — ${displayName}`}
        class="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-xs font-medium text-ink opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
      ><span class="sm:hidden">+ New</span><span class="hidden sm:inline">+ New project</span></a>
    </div>
  </div>

  <!-- Animated enter/exit body (2026-08-08 amendment): the shared Disclosure
       primitive collapses/reveals over ≥300ms (reduced-motion instant); the
       closed body is inert and holds ZERO subscriptions (query gates on
       `open` above — the snapshot rows only feed the exit animation). -->
  <Disclosure id={disclosureId} open={open}>
    <div>
      {#if showError}
        <p class="px-4 py-6 text-center text-sm text-ink-muted" role="alert">
          This client group could not be loaded. Collapse and reopen it to retry.
        </p>
      {:else if showLoading}
        <div class="space-y-1 px-3 py-3" role="status" aria-label={`Loading ${displayName} projects`}>
          <div class="h-9 animate-pulse rounded-lg bg-chrome motion-reduce:animate-none"></div>
          <div class="h-9 animate-pulse rounded-lg bg-chrome motion-reduce:animate-none"></div>
        </div>
      {:else if effectiveRows.length === 0 && (presentation === "lane" ? !laneCountsNonZero : stageView.groups.every((group) => group.count === 0))}
        <p class="px-4 py-6 text-center text-sm text-ink-muted">No loaded projects for this client name.</p>
      {:else if presentation === "lane"}
        <!-- Lane: the real stage-column board, scoped to this client — the
             SAME kanban anatomy as the ungrouped /projects board. Hide-empty
             honors this client's own verified counts (fail honest without
             them); columns take natural height because the grouped board's
             outer vertical scroller owns the vertical axis. The section band
             already names the client, so cards drop their client line; the
             creation footers carry this client's recorded-name prefill. -->
        <div class="pt-1">
          <ProjectsBoard
            rows={effectiveRows.map(toProjectsTableRow)}
            stageCounts={usableStageCounts}
            countsApproximate={laneCountsApproximate}
            {hideEmpty}
            newProjectClientName={unnamed ? null : clientName}
            showCardClient={false}
            regionLabel={`${displayName} board. Scroll horizontally to review every workflow stage.`}
            idPrefix={`${disclosureId}-board`}
            columnHeadingLevel={4}
          />
        </div>
        {#if open && hasMore}
          <!-- Honest bounded-page remainder: loads more IN PLACE (the
               recorded count minus loaded rows), never a navigation. -->
          <div class="flex px-3 pb-2">
            <button
              type="button"
              data-lane-load-more
              disabled={projectsQ.status === "LoadingMore"}
              onclick={() => projectsQ.loadMore(DASHBOARD_PROJECT_PAGE_SIZE)}
              class="min-h-11 px-2 text-xs font-medium text-ink opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-40 motion-reduce:transition-none"
            >{projectsQ.status === "LoadingMore"
                ? "Loading…"
                : laneMoreCount > 0
                  ? `+${laneMoreCount} more`
                  : "Show more"}</button>
          </div>
        {/if}
      {:else}
        <!-- List: pipeline-ordered status sub-headers cut from the server's
             stage-rank order. Hidden empty stages simply do not render; the
             Display menu's hide-empty switch is the only control
             (2026-08-12). -->
        <div class="px-1.5 py-1.5">
          {#each stageView.groups as group (group.id)}
            <div data-stage-subgroup={group.id} class="mt-1 first:mt-0">
              <h4 class="flex min-h-8 items-center gap-2 px-2">
                {#if group.id === "legacy"}
                  <LegacyStatusBadge />
                {:else}
                  <StageBadge stage={group.id} dot />
                {/if}
                <span data-stage-subgroup-count class="text-data text-ink-muted">
                  {@render countText(group.count, group.countSuffix, group.unverified)}
                </span>
              </h4>
              {#if group.rows.length > 0}
                <ul role="list" class="flex flex-col">
                  {#each group.rows as project (project._id)}
                    <li class="rounded-lg transition-colors hover:bg-primary-wash focus-within:bg-primary-wash motion-reduce:transition-none">
                      <div class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1">
                        <a
                          href={resolve("/project/[id]", { id: project._id })}
                          data-recent-title={project.title}
                          data-recent-stage={project.workflowStage ?? undefined}
                          data-recent-client={unnamed ? undefined : clientName}
                          class="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-ink hover:text-primary-selected focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                        >{project.title}</a>
                        {#if project.fiscalYearEnd}
                          <span class="hidden shrink-0 text-xs text-ink-muted sm:inline">FY {new Date(project.fiscalYearEnd).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</span>
                        {/if}
                        {#if !project.workflowStage}
                          <span data-legacy-status-qualifier class="text-xs text-ink-muted">{project.status} · Legacy status</span>
                        {/if}
                        <span class="ml-auto shrink-0 text-xs text-ink-muted">{new Date(project.updatedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</span>
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
      {#if open && !showError && !showLoading && hasMore && presentation === "list"}
        <div class="border-t border-line-soft px-3 py-2">
          <button
            type="button"
            disabled={projectsQ.status === "LoadingMore"}
            onclick={() => projectsQ.loadMore(DASHBOARD_PROJECT_PAGE_SIZE)}
            class="min-h-11 rounded-lg px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none sm:min-h-8"
          >{projectsQ.status === "LoadingMore" ? "Loading…" : `Show more — ${displayName}`}</button>
        </div>
      {/if}
    </div>
  </Disclosure>
</section>
