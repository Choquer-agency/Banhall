<script module lang="ts">
  import type { FunctionReturnType } from "convex/server";
  import type { api as apiType } from "../../../../convex/_generated/api";
  // Survives route remounts (module scope): the last resolved view config,
  // so Home ↔ Projects navigation never flashes the loading state.
  let cachedViewConfig:
    | FunctionReturnType<typeof apiType.myWork.getViewConfig>
    | undefined = undefined;
</script>

<script lang="ts">
  // Banhall workspace preview — light bounded workspace (2026-08-06
  // redesign, docs/design-system.md): a PURE WHITE content plane inside the
  // `[data-workspace-theme="light"]` scope (canvas → #FFFFFF; the opaque
  // root keeps the body ledger texture out), a branded FIR navigation rail
  // (PRODUCT.md "fir navigation surface"), and a compact in-plane toolbar
  // (title + count, centered search, New project). Lagoon stays the single
  // accent, fir carries the shell and identity surfaces, canonical stage
  // tones render as the light labelled badges. The navigation DRAWER keeps
  // the dark scope — it is a fir surface with white text. Below 1280px the
  // rail becomes a labelled overlay drawer. My Work remains the daily
  // destination (canonical URL /my-work); Projects remains the dense report
  // repository (canonical URL /projects); the shell mounts on those routes
  // via the shared WorkspaceGate. The rollout resolver, `?workspace=current`
  // escape, and every query are unchanged. Rollback for the retheme itself:
  // restore `data-workspace-theme="dark"` on the root below.
  //
  // The shell is viewport-bounded (h-dvh + pinned single grid row): the page
  // never scrolls; each view owns its scroll — My Work in its wrapper, List
  // in its region, Board horizontally with per-column vertical bodies.
  // The root must NOT be a `flex-1` item: inside +layout's auto-height
  // `flex min-h-screen flex-col`, flex-basis:0% supersedes `h-dvh` for the
  // main-axis size and the shell grows to content height (the 2026-08-06
  // live-QA containment failure). With basis:auto the h-dvh binds. The root
  // is also `relative`: absolutely-positioned descendants without a
  // positioned ancestor (e.g. sr-only labels in scrolling views) otherwise
  // resolve against the initial containing block, escape overflow clipping,
  // and grow the document.
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import MyWorkView from "$lib/components/mywork/MyWorkView.svelte";
  import ShaderBackground from "$lib/components/ui/ShaderBackground.svelte";
  import ProjectsTableView from "$lib/components/workspace/ProjectsTableView.svelte";
  import WorkspaceHeader from "$lib/components/workspace/WorkspaceHeader.svelte";
  import WorkspaceShell from "$lib/components/workspace/WorkspaceShell.svelte";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import { resolveDashboardView, type DashboardView } from "$lib/dashboard/viewMode";
  import {
    loadRecentProjects,
    persistRecentProjects,
    recordRecentProject,
    type RecentProject,
  } from "$lib/workspace/recentProjects";
  import {
    stashWorkspaceSearch,
    stashWorkspaceSearchFocus,
    takeWorkspaceSearch,
    takeWorkspaceSearchFocus,
  } from "$lib/workspace/searchContinuity";

  // The canonical routes pass the view explicitly (`/my-work` → "my_work",
  // `/projects` → "all_projects"); it wins over any `?view` param. Without
  // it (the /dashboard compatibility window) the `?view` param resolves as
  // before. Either way the kill-switch/readiness downgrade in
  // resolveDashboardView stays authoritative.
  let { view = null }: { view?: DashboardView | null } = $props();

  const auth = useAuth();
  const configQ = useQuery(api.myWork.getViewConfig, () => (auth.isAuthenticated ? {} : "skip"));
  // /my-work and /projects are separate routes, so navigating remounts this
  // component and the view-config subscription restarts at `undefined` for a
  // frame — flashing the loading state on every client-side navigation (the
  // "bouncing" shell, 2026-08-10 live QA). The last resolved config is
  // cached at module level and used as the interim value; the live
  // subscription overwrites it as soon as it re-resolves.
  const viewConfig = $derived(configQ.data ?? cachedViewConfig);
  $effect(() => {
    if (configQ.data) cachedViewConfig = configQ.data;
  });
  let navigationOpen = $state(false);
  // Desktop rail visibility — persisted by WorkspaceShell (railPreferences);
  // this host only wires the header toggle to the shell's bindable state.
  let railHidden = $state(false);
  // Search typed from My Work navigates to /projects, which remounts this
  // component (separate routes). The handoff restores the in-flight query
  // so the first keystroke is never dropped.
  const restoredSearch = takeWorkspaceSearch();
  // Focus-only handoff (chrome-less Home): search invoked on Home navigates
  // here with no query but with the intent to land in the search field.
  const restoredSearchFocus = takeWorkspaceSearchFocus();
  let search = $state(restoredSearch);
  let recents = $state<RecentProject[]>([]);
  let header: { focusSearch: (options?: { select?: boolean }) => void } | null = $state(null);

  const resolvedView = $derived.by(() => {
    if (configQ.error) return "all_projects" as const;
    const config = viewConfig;
    if (!config) return null;
    return resolveDashboardView({
      killSwitch: config.killSwitch,
      ready: config.ready,
      urlView: view ?? page.url.searchParams.get("view"),
      sessionView: null,
      configuredDefault: "my_work",
    });
  });
  const myWorkAvailable = $derived(Boolean(viewConfig?.ready && !viewConfig?.killSwitch));
  const displayedView = $derived(resolvedView);
  // Projects alone needs the bounded facet scan for its truthful header
  // count. Home releases this subscription instead of paying for unused
  // pipeline data on the daily destination.
  const facetsQ = useQuery(api.dashboard.getFacets, () =>
    auth.isAuthenticated && displayedView === "all_projects" ? {} : "skip"
  );
  // /my-work presents as Home (2026-08-08 amendment) — the canonical URL,
  // WorkspaceGate, /dashboard compatibility, and query semantics are
  // unchanged; only the presentation label moves.
  const activeLabel = $derived(displayedView === "all_projects" ? "Projects" : "Home");
  // Truthful count in the heading: exact when facets are exhaustive, `N+`
  // when bounded. My work gets no number until its groups can report one.
  const headerCount = $derived.by(() => {
    if (displayedView !== "all_projects") return null;
    const facets = facetsQ.data;
    if (!facets) return null;
    return `${facets.total}${facets.truncated ? "+" : ""}`;
  });

  // The current-dashboard escape lands on the compatibility entry with the
  // matching view so nothing about the user's context is lost.
  const currentDashboardHref = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.set("workspace", "current");
    if (displayedView) url.searchParams.set("view", displayedView);
    return `${resolve("/dashboard")}${url.search}`;
  });

  // Real typed navigation between the canonical routes: the rail renders
  // these as plain anchors (history entries, middle-click, copy-link all
  // work); `?layout` and unknown params carry through, `?view` never leaks
  // onto the canonical URLs (the path encodes the view).
  function viewHref(target: DashboardView): string {
    const url = new URL(page.url);
    url.searchParams.delete("view");
    if (target === "all_projects") {
      // Projects always opens as the client-grouped List (2026-08-19 owner
      // direction): the params ride the URL so the default view is explicit
      // and shareable, overriding any stored layout preference.
      if (!url.searchParams.has("layout")) url.searchParams.set("layout", "list");
      if (!url.searchParams.has("group")) url.searchParams.set("group", "client");
      return `${resolve("/projects")}${url.search}`;
    }
    return `${resolve("/my-work")}${url.search}`;
  }

  function selectView(target: DashboardView) {
    if (target === "my_work" && !myWorkAvailable) return;
    navigationOpen = false;
    goto(viewHref(target), {
      replaceState: true,
      noScroll: true,
      keepFocus: true,
    });
  }

  function handleSearchChange(value: string) {
    search = value;
    // Search is project discovery — typing from My work lands on Projects.
    // The navigation remounts this component, so the query rides the
    // handoff and continuity focus restores the caret after the remount.
    if (value.trim() && displayedView !== "all_projects") {
      stashWorkspaceSearch(value);
      selectView("all_projects");
    }
  }

  function focusSearch() {
    navigationOpen = false;
    // Chrome-less Home (2026-08-10 amendment) renders no search field:
    // search is project discovery, so invoking it from Home navigates to
    // Projects with a one-shot focus handoff across the remount.
    if (displayedView === "my_work" || !header) {
      stashWorkspaceSearchFocus();
      selectView("all_projects");
      return;
    }
    header.focusSearch();
  }

  // ⌘K is owned by the shell command palette (2026-08-13, Attio-research
  // P0) on every view, Home included — the earlier Home-only handler that
  // navigated to Projects search is retired so the two cannot double-fire.

  $effect(() => {
    recents = loadRecentProjects();
  });

  // Continuity focus after the /my-work → /projects search remount: put the
  // caret back at the end of the restored query (never select-all — the
  // user is mid-word and the next keystroke must append, not replace).
  // One-shot: a later header rebind must never steal focus again.
  let continuityFocused = false;
  $effect(() => {
    if ((restoredSearch || restoredSearchFocus) && header && !continuityFocused) {
      continuityFocused = true;
      header.focusSearch({ select: false });
    }
  });

  // Best-effort recency for the rail's Recent group: observe project opens
  // (clicks on /project/<id> links) anywhere in the workspace, drawer included.
  function handleWindowClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const match = /^\/project\/([^/?#]+)/.exec(anchor.getAttribute("href") ?? "");
    if (!match || match[1] === "new" || match[1] === "questionnaire") return;
    // Surfaces that render richer row data expose it as data-recent-* on the
    // anchor; the handler records exactly what the clicked surface showed.
    const title =
      anchor.dataset.recentTitle?.trim() || anchor.textContent?.trim() || "Untitled project";
    recents = recordRecentProject(recents, {
      id: match[1],
      title,
      stage: anchor.dataset.recentStage,
      client: anchor.dataset.recentClient,
      openedAt: Date.now(),
    });
    persistRecentProjects(recents);
  }

</script>

<svelte:window onclickcapture={handleWindowClick} />

<WorkspaceShell
  kind="dashboard"
  theme="light"
  bind:navigationOpen
  bind:railHidden
  {displayedView}
  {myWorkAvailable}
  myWorkHref={viewHref("my_work")}
  projectsHref={viewHref("all_projects")}
  {currentDashboardHref}
  onFocusSearch={focusSearch}
  drawerDescription="Navigate between work, projects, and project creation."
>
  <div class="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
    {#if displayedView === "all_projects"}
      <WorkspaceHeader
        bind:this={header}
        title={activeLabel}
        count={headerCount}
        searchValue={search}
        onSearchChange={handleSearchChange}
        onOpenNavigation={() => (navigationOpen = true)}
        {railHidden}
        onToggleRail={() => (railHidden = !railHidden)}
        showNewProject
      />
    {:else}
      <!-- Home's greeting already supplies the page heading. Keep only the
           controls that are necessary when the desktop rail is hidden or the
           mobile drawer is the sole navigation surface — never a duplicate
           full-width title bar. -->
      <div data-home-shell-controls class="absolute left-3 top-1 z-20 sm:left-4">
        <WorkspaceShellControls
          tone="light"
          onOpenNavigation={() => (navigationOpen = true)}
          {railHidden}
          onToggleRail={() => (railHidden = !railHidden)}
        />
      </div>
    {/if}

    {#if configQ.error}
      <p class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800" role="status">
        Home is temporarily unavailable. Projects remains available.
      </p>
    {/if}

    <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {#if displayedView === null}
        <!-- Home-shaped skeleton while the rollout decision loads: a
             refresh of /my-work keeps the chrome-less composition instead
             of flashing a toolbar or a bare spinner. -->
        <div class="min-h-0 flex-1 overflow-hidden" role="status" aria-label="Loading workspace">
          <div class="mx-auto w-full max-w-[44.75rem] px-4 pt-12 sm:px-6">
            <div class="mx-auto h-9 w-72 max-w-full animate-pulse rounded-lg bg-chrome motion-reduce:animate-none"></div>
            <div class="mx-auto mt-3 h-5 w-48 max-w-full animate-pulse rounded-md bg-chrome/70 motion-reduce:animate-none"></div>
            <div class="mt-8 h-32 animate-pulse rounded-xl border border-line-soft bg-chrome/40 motion-reduce:animate-none"></div>
          </div>
        </div>
      {:else if displayedView === "my_work"}
        <div class="relative min-h-0 flex-1 overflow-y-auto">
          <div
            data-home-start-wash
            class="pointer-events-none absolute inset-x-0 top-0 z-0 h-80 overflow-hidden opacity-40 [mask-image:linear-gradient(to_bottom,black_35%,transparent)] sm:h-[24rem]"
            aria-hidden="true"
          >
            <div class="h-[52rem] w-full -translate-y-[40%]">
              <ShaderBackground class="h-full w-full" />
            </div>
          </div>
          <div data-home-boundary class="relative mx-auto w-full max-w-[var(--container-home)]">
            <MyWorkView recentProjects={recents} />
          </div>
        </div>
      {:else}
        <ProjectsTableView externalSearch={search} />
      {/if}
    </main>
  </div>
</WorkspaceShell>
