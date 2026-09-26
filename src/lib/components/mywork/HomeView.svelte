<!--
  Home (ui-design-final.md section 9, boards 1.1 and 1.2). Top bar: page
  icon, "Home", the greeting, the bell and New project. One panel splits into
  two tables on the left and "Continue working" on the right.

  Data:
  - "With you": open work items assigned to the viewer
    (myWork.listAssignedToMe), one row per project, due first.
  - "Recently opened": the projects this viewer opened on this device
    (browser-local list), read live through myWork.listRecentProjects so
    stage, client and edit time are current. With no local history there is
    no second table (round 2 J7, decision 55: the "Recently edited" fallback
    is retired).
  - "Continue working": the last project opened on this device, otherwise the
    latest edited project with the viewer (myWork.getContinueWorking).
  Home stays simple: no due dates, no agenda, no search.
-->
<script lang="ts">
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { usePaginatedQuery, useQuery } from "convex-svelte";
  import { IconBell, IconHome, IconPlus, IconPlusSmall } from "$lib/components/icons";
  import { api } from "../../../../convex/_generated/api";
  import HomeContinueCard from "$lib/components/mywork/HomeContinueCard.svelte";
  import HomeProjectTable from "$lib/components/mywork/HomeProjectTable.svelte";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import { greetingForHour, greetingName } from "$lib/mywork/homeGreeting";
  import { continueTarget, liveProjectRows, withYouRows } from "$lib/mywork/homeRows";
  import type { RecentProject } from "$lib/workspace/recentProjects";

  const WITH_YOU_PAGE = 10;

  let {
    recentProjects = [],
    railHidden = false,
    onToggleRail,
    onOpenNavigation,
  }: {
    recentProjects?: RecentProject[];
    railHidden?: boolean;
    onToggleRail: () => void;
    onOpenNavigation: () => void;
  } = $props();

  const auth = useAuth();
  let now = $state(Date.now());

  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);
  const greeting = $derived.by(() => {
    const name = greetingName(userQ.data);
    return `${greetingForHour(new Date(now).getHours())}${name ? `, ${name}` : ""}`;
  });

  const assignedQ = usePaginatedQuery(
    api.myWork.listAssignedToMe,
    () => (auth.isAuthenticated ? {} : "skip"),
    { initialNumItems: WITH_YOU_PAGE }
  );
  const withYouLoading = $derived(assignedQ.status === "LoadingFirstPage");
  const withYou = $derived(withYouLoading ? undefined : withYouRows(assignedQ.results));
  const withYouMore = $derived(
    assignedQ.status === "CanLoadMore" || assignedQ.status === "LoadingMore"
  );

  const recentIds = $derived(recentProjects.map((recent) => recent.id));
  const hasLocalRecents = $derived(recentIds.length > 0);
  const recentQ = useQuery(api.myWork.listRecentProjects, () =>
    auth.isAuthenticated && recentIds.length > 0 ? { projectIds: recentIds } : "skip"
  );
  const recentRows = $derived.by(() => {
    if (!hasLocalRecents) return [];
    if (recentQ.error) return [];
    return recentQ.data ? liveProjectRows(recentQ.data) : undefined;
  });

  const target = $derived.by(() => {
    if (withYou === undefined) return undefined;
    if (hasLocalRecents && recentRows === undefined) return undefined;
    const openedAt = new Map(recentProjects.map((recent) => [recent.id, recent.openedAt ?? null]));
    const opened = hasLocalRecents
      ? (recentRows ?? []).map((row) => ({ projectId: row.projectId, openedAt: openedAt.get(row.projectId) ?? null }))
      : [];
    return continueTarget(opened, withYou);
  });

  const iconButton =
    "flex size-9 shrink-0 items-center justify-center rounded-[7px] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11";
</script>

<svelte:window onfocus={() => (now = Date.now())} />

<div data-home class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-workspace-shell">
  <header data-workspace-page-header data-home-top-bar class="flex h-14 shrink-0 items-center gap-2.5 px-3 sm:px-5">
    <WorkspaceShellControls tone="light" {onOpenNavigation} {railHidden} {onToggleRail} />
    <span aria-hidden="true" data-home-page-icon class="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-workspace-page-icon text-primary">
      <IconHome size={15} strokeWidth={1.8} />
    </span>
    <h1 class="shrink-0 text-sm font-medium leading-5 text-ink">Home</h1>
    <p data-home-greeting class="min-w-0 truncate text-xs leading-[18px] text-ink-muted max-sm:hidden">{greeting}</p>
    <div class="flex-1"></div>
    <a
      href={resolve("/changelog")}
      data-top-bar-bell
      aria-label={unseen > 0 ? `Notifications, ${unseen} new update${unseen === 1 ? "" : "s"}` : "Notifications"}
      class={`relative ${iconButton}`}
    >
      <IconBell size={16} strokeWidth={1.5} />
      {#if unseen > 0}
        <span aria-hidden="true" data-top-bar-bell-dot class="absolute right-2.5 top-2 size-1.5 rounded-full bg-primary"></span>
      {/if}
    </a>
    <a
      href={resolve("/project/new")}
      data-home-new-project
      class="inline-flex h-[30px] shrink-0 items-center gap-[5px] rounded-[7px] bg-primary-selected pl-2.5 pr-3 text-[13px] leading-[18px] font-medium text-white transition-colors hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11"
    >
      <IconPlusSmall size={12} strokeWidth={1.5} class="shrink-0" />
      New project
    </a>
  </header>

  <main
    data-home-panel
    data-work-panel
    class="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[10px] border border-line bg-surface"
  >
    <div class="flex flex-1 flex-col gap-10 px-4 pb-6 pt-5 sm:px-6 xl:flex-row xl:gap-8">
      <div data-home-tables class="min-w-0 flex-1">
        <HomeProjectTable
          id="home-with-you"
          label="With you"
          icon="table"
          first
          rows={withYou}
          count={withYou ? `${withYou.length}${withYouMore ? "+" : ""}` : null}
          bounded={withYouMore}
          {now}
          emptyLayout="block"
        >
          {#snippet empty()}
            <p class="text-sm font-medium leading-5 text-ink">No projects with you yet</p>
            <p class="text-[13px] leading-[18px] text-ink-muted">Start one, or a Manager can hand one to you.</p>
          {/snippet}
          {#snippet footer()}
            <div class="flex flex-wrap items-center gap-4">
              <a
                href={resolve("/project/new")}
                data-home-add-new
                class={`inline-flex items-center gap-2 rounded-md pl-7 pr-2 text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none ${withYou?.length === 0 ? "h-10 text-[13px] leading-[18px]" : "h-9 text-xs leading-4"}`}
              >
                {#if withYou?.length === 0}
                  <IconPlus size={14} strokeWidth={2} class="shrink-0" />
                {:else}
                  <IconPlusSmall size={12} strokeWidth={1.3} class="shrink-0" />
                {/if}
                {withYou?.length === 0 ? "New project" : "Add new"}
              </a>
              {#if withYouMore}
                <button
                  type="button"
                  data-home-show-more
                  disabled={assignedQ.status === "LoadingMore"}
                  onclick={() => assignedQ.loadMore(WITH_YOU_PAGE)}
                  class="inline-flex h-9 items-center rounded-md px-2 text-xs text-ink-muted transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir disabled:opacity-50 motion-reduce:transition-none"
                >
                  {assignedQ.status === "LoadingMore" ? "Loading..." : "Show more"}
                </button>
              {/if}
            </div>
          {/snippet}
        </HomeProjectTable>

        {#if hasLocalRecents}
          <HomeProjectTable
            id="home-recent"
            label="Recently opened"
            icon="clock"
            rows={recentRows}
            count={recentRows ? String(recentRows.length) : null}
            {now}
          >
            {#snippet empty()}
              The projects you opened here are no longer available.
            {/snippet}
          </HomeProjectTable>
        {/if}
      </div>

      <div class="min-w-0 xl:w-[384px] xl:shrink-0 xl:border-l xl:border-line-soft xl:pl-8">
        <HomeContinueCard {target} {now} />
      </div>
    </div>
  </main>
</div>
