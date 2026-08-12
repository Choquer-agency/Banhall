<script lang="ts">
  // One recorded-client-name section of the Client → Status Projects views
  // (2026-08-06 second amendment). Server-backed and index-backed only:
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
  // - "lane": one horizontal snap row of same-tone stage mini-columns with
  //   natural height (no inner vertical scroll — the page's outer vertical
  //   scroller owns that axis in grouped board mode). Each lane column
  //   previews at most LANE_PREVIEW_CARDS cards; the truthful remainder is
  //   one click away in the focused board ("Show N more in Focus") so a
  //   busy stage can never stack a viewport-tall lane (live QA 2026-08-06).
  //
  // Hide-empty inside a section uses ONLY the VERIFIED exact per-client
  // stageCounts (absent or sum-divergent = not backfilled = nothing hidden,
  // loaded-only counts with + / explicit not-fully-loaded markers).
  import { resolve } from "$app/paths";
  import { usePaginatedQuery } from "convex-svelte";
  import type { FunctionReturnType } from "convex/server";
  import { api } from "../../../../convex/_generated/api";
  import {
    DASHBOARD_PROJECT_PAGE_SIZE,
    DASHBOARD_UNNAMED_COMPANY_KEY,
  } from "../../../../shared/dashboardProjection";
  import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import LegacyStatusBadge from "$lib/components/ui/LegacyStatusBadge.svelte";
  import BoardColumnHeader from "$lib/components/workspace/BoardColumnHeader.svelte";
  import ProjectBoardCard from "$lib/components/workspace/ProjectBoardCard.svelte";
  import {
    groupRowsByStageRank,
    verifiedStageCounts,
    visibleStageGroups,
  } from "$lib/workspace/stageRankGroups";
  import { toProjectsTableRow } from "$lib/workspace/projectRowMapping";

  type CompanyProjectsResult = FunctionReturnType<typeof api.dashboard.listCompanyProjectsByStageRank>;
  type ProjectRow = CompanyProjectsResult["page"][number];

  /** Lane columns preview at most this many cards (density bound). */
  const LANE_PREVIEW_CARDS = 3;

  let {
    companyKey,
    clientName,
    projectCount,
    stageCounts,
    hideEmpty = true,
    presentation = "list",
    open,
    onToggle,
    focusHref = null,
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
    /** Focused single-client board URL (board drill-in), when offered. */
    focusHref?: string | null;
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
  // Per-section reveal of hidden empty stages (the disclosure's "Show").
  let showHiddenStages = $state(false);
  // Reset the reveal when the section collapses or the hide-empty
  // preference changes — a stale reveal would silently defeat a freshly
  // re-enabled preference.
  $effect(() => {
    void open;
    void hideEmpty;
    showHiddenStages = false;
  });
  // H3 consumer defense: only an internally consistent record is exact.
  const usableStageCounts = $derived(verifiedStageCounts(stageCounts, projectCount));
  const stageView = $derived(
    visibleStageGroups(
      groupRowsByStageRank(effectiveRows, effectiveExhausted),
      usableStageCounts,
      hideEmpty && !showHiddenStages
    )
  );
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

<!-- Band-headed section (light workspace redesign 2026-08-06): the client
     header is a full-width pale band and the content sits flush on the white
     plane beneath, closed by a hairline — no rounded outline box (Linear
     group-band grammar; the box-in-box framing was a dark-theme necessity,
     not a contract). Header keeps label/name/count/New/Focus/disclosure and
     44px targets at every viewport. -->
<section
  data-client-group={companyKey}
  data-client-group-presentation={presentation}
  aria-labelledby={`${disclosureId}-heading`}
  class="border-b border-line-soft"
>
  <!-- Below `sm` the header is a two-row grid so the client name wins the
       full first line (live QA 2026-08-07: names truncated to "3GA Mari…"
       while + New / Focus kept their width); the same links move to a
       second action row (standard stacked-toolbar affordance, 44px targets,
       exact labels/hrefs unchanged). From `sm` up `sm:contents` dissolves
       the action wrapper and the header stays the efficient single row. -->
  <div class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg bg-gray-50 pr-1 sm:flex sm:min-h-11 sm:gap-1">
    <h3 id={`${disclosureId}-heading`} class="m-0 min-w-0 sm:flex-1">
      <button
        type="button"
        onclick={onToggle}
        aria-expanded={open}
        aria-controls={disclosureId}
        class="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
      >
        <span class="text-label shrink-0" aria-hidden="true">Client</span>
        <span class={`truncate text-sm font-medium ${open ? "text-primary-selected" : "text-ink"}`}>{displayName}</span>
        <span data-client-group-count class="shrink-0 text-xs text-ink-muted">· {projectCount} project{projectCount === 1 ? "" : "s"}</span>
      </button>
    </h3>
    <!-- Decorative state chevron (rule 7: right edge, down → up when open);
         the section heading button is the real disclosure control. -->
    <span class="flex h-11 w-8 shrink-0 items-center justify-center sm:order-last" aria-hidden="true">
      <DisclosureChevron {open} />
    </span>
    <!-- Client-scoped creation stays reachable at every viewport (390px
         included — live QA 2026-08-06): compact "+ New" label below sm,
         full label from sm up, 44px target either way. -->
    <div class="col-span-2 flex items-center gap-1 pb-0.5 pl-1 sm:contents">
      <a
        data-client-new-project
        href={newProjectHref}
        aria-label={unnamed ? "New project" : `New project — ${displayName}`}
        class="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
      ><span class="sm:hidden">+ New</span><span class="hidden sm:inline">+ New project</span></a>
      {#if focusHref}
        <a
          data-client-focus
          href={focusHref}
          class="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
        >Focus</a>
      {/if}
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
      {:else if effectiveRows.length === 0 && stageView.groups.every((group) => group.count === 0)}
        <p class="px-4 py-6 text-center text-sm text-ink-muted">No loaded projects for this client name.</p>
      {:else if presentation === "lane"}
        <!-- Lane: one horizontal snap row of same-tone stage mini-columns.
             Columns take natural height (no inner vertical scroll); the
             grouped board's outer vertical scroller owns that axis. Card
             previews are bounded (LANE_PREVIEW_CARDS) with a truthful
             remainder link into the focused board. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          role="region"
          aria-label={`${displayName} stage columns. Scroll horizontally.`}
          tabindex="0"
          class="scrollbar-hidden snap-x snap-proximity overflow-x-auto px-2 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy"
        >
          <div class="flex w-max items-start gap-2 pr-4">
            {#each stageView.groups as group (group.id)}
              {@const previewRows = group.rows.slice(0, LANE_PREVIEW_CARDS)}
              {@const moreCount = group.count - previewRows.length}
              <section
                class="flex w-[320px] max-w-[calc(100vw-3.5rem)] shrink-0 snap-start flex-col rounded-xl border-none bg-canvas shadow-none"
                aria-labelledby={`${disclosureId}-lane-${group.id}`}
              >
                <BoardColumnHeader
                  id={`${disclosureId}-lane-${group.id}`}
                  label={group.id === "legacy" ? "Legacy status" : WORKFLOW_STAGE_LABELS[group.id]}
                  stage={group.id === "legacy" ? null : group.id}
                  count={group.count}
                  countSuffix={group.countSuffix}
                  noneLoaded={group.count > 0 && group.rows.length === 0}
                  unverified={group.unverified}
                  headingLevel={4}
                />
                <div class="space-y-3 p-2 pt-0">
                  {#each previewRows as project (project._id)}
                    <!-- The section band already names the client — the card
                         drops its client line inside client-scoped lanes. -->
                    <ProjectBoardCard row={toProjectsTableRow(project)} showClient={false} />
                  {/each}
                  {#if moreCount > 0 && focusHref}
                    <!-- Truthful bounded-preview remainder: the exact (or
                         loaded-only +) count continues in the focused board;
                         the lane itself never grows a vertical scroller or a
                         viewport-tall stack. -->
                    <a
                      data-lane-more={group.id}
                      href={focusHref}
                      class="flex min-h-11 items-center px-2 text-xs font-normal text-ink-muted opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
                    >Show {moreCount}{group.countSuffix} more in Focus</a>
                  {/if}
                  <a
                    data-add-new-project={group.id}
                    data-intake-new-project={group.id === "intake" ? "" : undefined}
                    href={newProjectHref}
                    aria-label={`Add new project${unnamed ? "" : ` for ${displayName}`}. New projects begin in Intake.`}
                    class="flex min-h-11 items-center gap-1.5 px-2 text-xs font-normal text-ink-muted opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
                  ><span aria-hidden="true" class="text-sm leading-none">+</span> Add new</a>
                </div>
              </section>
            {/each}
            {#if stageView.hiddenCount > 0}
              <div class="flex shrink-0 snap-start items-start pt-2">
                <button
                  type="button"
                  data-hidden-stages-disclosure
                  onclick={() => (showHiddenStages = true)}
                  class="min-h-11 rounded-lg px-3 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
                >{stageView.hiddenCount} empty {stageView.hiddenCount === 1 ? "stage" : "stages"} hidden · Show</button>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <!-- List: pipeline-ordered status sub-headers cut from the server's
             stage-rank order. -->
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
          {#if stageView.hiddenCount > 0}
            <button
              type="button"
              data-hidden-stages-disclosure
              onclick={() => (showHiddenStages = true)}
              class="mt-1 min-h-11 rounded-lg px-2 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
            >{stageView.hiddenCount} empty {stageView.hiddenCount === 1 ? "stage" : "stages"} hidden · Show</button>
          {/if}
        </div>
      {/if}
      {#if open && !showError && !showLoading && hasMore}
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
