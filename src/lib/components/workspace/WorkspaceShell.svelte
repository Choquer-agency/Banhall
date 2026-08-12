<script lang="ts">
  import type { Snippet } from "svelte";
  import type { DashboardView } from "$lib/dashboard/viewMode";
  import WorkspaceRail from "$lib/components/workspace/WorkspaceRail.svelte";
  import WorkspaceRailResizeHandle from "$lib/components/workspace/WorkspaceRailResizeHandle.svelte";
  import * as Drawer from "$lib/components/ui/drawer/index.js";
  import {
    RAIL_COLLAPSED_WIDTH,
    clampRailWidth,
    loadRailPreferences,
    persistRailPreferences,
  } from "$lib/workspace/railPreferences";

  let {
    kind,
    theme,
    navigationOpen = $bindable(false),
    railHidden = $bindable(false),
    displayedView,
    myWorkAvailable,
    myWorkHref,
    projectsHref,
    currentDashboardHref,
    currentExperienceLabel = "Current dashboard",
    onFocusSearch,
    drawerDescription,
    children,
  }: {
    kind: "dashboard" | "chrome";
    theme: "light" | "dark";
    navigationOpen?: boolean;
    /**
     * Desktop rail collapse state (2026-08-08 amendment; 2026-08-11: the
     * collapsed rail presents as a 64px icon-only mini rail — Obvious
     * parity — never width 0. The name and persisted `hidden` key are kept
     * for compatibility and read as "collapsed"). The shell owns the
     * persisted preference; hosts bind this so their header toggle stays a
     * plain prop wire. The mobile drawer is independent and unchanged.
     */
    railHidden?: boolean;
    displayedView: DashboardView | null;
    myWorkAvailable: boolean;
    myWorkHref: string;
    projectsHref: string;
    currentDashboardHref: string;
    currentExperienceLabel?: string;
    onFocusSearch: () => void;
    drawerDescription: string;
    children: Snippet;
  } = $props();

  // Rail ergonomics preferences: width is the persisted EXPANDED width and
  // survives collapse/expand (expanding restores the previous expanded width).
  // Loaded SYNCHRONOUSLY at init (loadRailPreferences fails closed to the
  // default off-browser): an after-mount load made every route change
  // animate the rail from the 255px default to the stored width — the
  // "bouncing" shell (2026-08-10 live QA). One value from the first frame.
  const storedRailPrefs = loadRailPreferences();
  let railWidth = $state(storedRailPrefs.width);
  let root: HTMLDivElement | null = $state(null);
  let resizing = $state(false);
  // eslint-disable-next-line svelte/no-side-effects-in-init -- one-shot sync of the bindable from storage
  railHidden = storedRailPrefs.hidden;

  $effect(() => {
    persistRailPreferences({ width: railWidth, hidden: railHidden });
  });

  // Live drag writes the CSS custom property straight onto the root node —
  // no Svelte state churn per pointermove; the committed width lands in
  // state (and storage) once on release.
  function applyLiveWidth(width: number) {
    resizing = true;
    root?.style.setProperty("--workspace-rail-width", `${width}px`);
  }

  function commitWidth(width: number) {
    resizing = false;
    railWidth = clampRailWidth(width);
    root?.style.setProperty("--workspace-rail-width", `${railWidth}px`);
  }

  $effect(() => {
    const desktop = window.matchMedia("(min-width: 80rem)");
    const closeDrawer = () => {
      if (desktop.matches) navigationOpen = false;
    };
    desktop.addEventListener("change", closeDrawer);
    closeDrawer();
    return () => desktop.removeEventListener("change", closeDrawer);
  });
</script>

<div
  bind:this={root}
  data-workspace-shell={kind === "dashboard" ? "" : undefined}
  data-workspace-chrome={kind === "chrome" ? "" : undefined}
  data-workspace-theme={theme}
  data-rail-hidden={railHidden ? "" : undefined}
  data-rail-resizing={resizing ? "" : undefined}
  style={`--workspace-rail-width: ${railWidth}px; --workspace-rail-collapsed-width: ${RAIL_COLLAPSED_WIDTH}px;`}
  class="workspace-shell-grid relative grid h-dvh grid-rows-[minmax(0,1fr)] overflow-hidden bg-canvas text-ink xl:grid-cols-[var(--workspace-rail-col)_minmax(0,1fr)]"
>
  <!-- Collapsed = 64px icon-only mini rail (2026-08-11 amendment): the rail
       stays visible and interactive, so it is never inert and keeps its
       border in both states. -->
  <aside
    id="workspace-rail"
    class="relative hidden min-h-0 overflow-hidden border-r border-shell-line bg-shell xl:block"
  >
    <!-- Fixed-width inner track: during the collapse/expand animation the
         rail slides within the shrinking/growing column instead of squashing
         its rows. Width is SYNCHRONOUS with the collapse state on the first
         frame (same convention as the stored-width load above). -->
    <div
      class="h-full"
      style={`width: ${railHidden ? `${RAIL_COLLAPSED_WIDTH}px` : "var(--workspace-rail-width)"};`}
    >
      <WorkspaceRail
        variant="rail"
        collapsed={railHidden}
        {displayedView}
        {myWorkAvailable}
        {myWorkHref}
        {projectsHref}
        {currentDashboardHref}
        {currentExperienceLabel}
        {onFocusSearch}
        onToggleRail={() => (railHidden = !railHidden)}
      />
    </div>
    <!-- Pointer/keyboard resize applies to the EXPANDED width only; the
         collapsed mini rail is fixed at 64px, so the handle unmounts. -->
    {#if !railHidden}
      <WorkspaceRailResizeHandle width={railWidth} onResize={applyLiveWidth} onCommit={commitWidth} />
    {/if}
  </aside>

  {@render children()}
</div>

<Drawer.Root bind:open={navigationOpen} direction="left" shouldScaleBackground={false} autoFocus={true}>
  <Drawer.Content
    data-workspace-theme="dark"
    class="z-[110] h-dvh w-[255px]! max-w-[86vw]! rounded-none! border-r border-shell-line bg-shell p-0 text-white shadow-2xl xl:hidden"
  >
    <Drawer.Title class="sr-only">Workspace navigation</Drawer.Title>
    <Drawer.Description class="sr-only">{drawerDescription}</Drawer.Description>
    <Drawer.Close
      aria-label="Close workspace navigation"
      class="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/8 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light motion-reduce:transition-none"
    >
      <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
    </Drawer.Close>
    <WorkspaceRail
      variant="drawer"
      {displayedView}
      {myWorkAvailable}
      {myWorkHref}
      {projectsHref}
      {currentDashboardHref}
      {currentExperienceLabel}
      {onFocusSearch}
      onNavigate={() => (navigationOpen = false)}
    />
  </Drawer.Content>
</Drawer.Root>

<style>
  /* Rail column: the grid tracks the expanded width normally and the fixed
     64px icon-only mini rail while collapsed (data-rail-hidden kept as the
     attribute name for the persisted-pref lineage; it means "collapsed").
     Collapse/expand is a MOTIVATED state transition (design-system rule 8:
     ≥300ms, restrained ease-out, reduced-motion instant); live pointer drags
     suspend the transition so the edge tracks the pointer 1:1. */
  .workspace-shell-grid {
    --workspace-rail-col: var(--workspace-rail-width, 255px);
    transition: grid-template-columns 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .workspace-shell-grid[data-rail-hidden] {
    --workspace-rail-col: var(--workspace-rail-collapsed-width, 64px);
  }
  .workspace-shell-grid[data-rail-resizing] {
    transition: none;
    cursor: col-resize;
    user-select: none;
    -webkit-user-select: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .workspace-shell-grid {
      transition: none;
    }
  }
</style>
