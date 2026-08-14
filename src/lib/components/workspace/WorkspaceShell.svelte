<script lang="ts">
  import type { Snippet } from "svelte";
  import type { DashboardView } from "$lib/dashboard/viewMode";
  import WorkspaceRail from "$lib/components/workspace/WorkspaceRail.svelte";
  import WorkspaceRailResizeHandle from "$lib/components/workspace/WorkspaceRailResizeHandle.svelte";
  import CommandPalette from "$lib/components/workspace/CommandPalette.svelte";
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
     * Desktop rail collapse state. The Attio-style rail fully leaves the
     * canvas at width 0; its previous expanded width remains persisted. The
     * shell owns the
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
  // animate the rail from the default width to the stored width — the
  // "bouncing" shell (2026-08-10 live QA). One value from the first frame.
  const storedRailPrefs = loadRailPreferences();
  let railWidth = $state(storedRailPrefs.width);
  // Command palette (2026-08-13, Attio-research P0): shell-owned so ⌘K and
  // the rail search button reach one surface on every shell page. The
  // host's onFocusSearch prop remains accepted for compatibility, but the
  // rail search affordance now opens the palette.
  let commandPaletteOpen = $state(false);
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
  <div class="workspace-rail-column relative hidden min-h-0 xl:block">
    <aside
      id="workspace-rail"
      data-rail-panel
      inert={railHidden ? true : undefined}
      aria-hidden={railHidden ? "true" : undefined}
      class="workspace-rail-panel absolute inset-y-0 left-0 overflow-hidden border-r border-workspace-rail-line bg-workspace-rail"
      style="width: var(--workspace-rail-width);"
    >
      <!-- Fixed-width panel: the grid track and the panel translate travel
           together, so the rail exits intact instead of being squeezed. -->
      <div class="h-full" style="width: var(--workspace-rail-width);">
        <WorkspaceRail
          variant="rail"
          collapsed={false}
          {displayedView}
          {myWorkAvailable}
          {myWorkHref}
          {projectsHref}
          {currentDashboardHref}
          {currentExperienceLabel}
          onFocusSearch={() => (commandPaletteOpen = true)}
          onToggleRail={() => (railHidden = !railHidden)}
        />
      </div>
      <!-- Pointer/keyboard resize applies to the expanded rail only. -->
      {#if !railHidden}
        <WorkspaceRailResizeHandle width={railWidth} onResize={applyLiveWidth} onCommit={commitWidth} />
      {/if}
    </aside>
  </div>

  {@render children()}
</div>

<CommandPalette bind:open={commandPaletteOpen} {myWorkHref} {projectsHref} />

<Drawer.Root bind:open={navigationOpen} direction="left" shouldScaleBackground={false} autoFocus={true}>
  <Drawer.Content
    data-workspace-theme="light"
    class="z-[110] h-dvh w-[275px]! max-w-[86vw]! rounded-none! border-r border-workspace-rail-line bg-workspace-rail p-0 text-ink shadow-2xl xl:hidden"
  >
    <Drawer.Title class="sr-only">Workspace navigation</Drawer.Title>
    <Drawer.Description class="sr-only">{drawerDescription}</Drawer.Description>
    <Drawer.Close
      aria-label="Close workspace navigation"
      class="absolute right-2 top-1.5 z-10 flex h-11 w-11 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-workspace-rail-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none"
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
  /* Rail column: the grid tracks the expanded width or slides fully closed.
     `data-rail-hidden` is kept as the persisted-preference lineage.
     The panel translates by the same distance while the grid track closes,
     matching Attio's intact off-canvas exit instead of clipping the rail's
     right edge. Live pointer drags suspend the track transition so the edge
     follows the pointer 1:1. */
  .workspace-shell-grid {
    --workspace-rail-col: var(--workspace-rail-width, 275px);
    transition: grid-template-columns 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .workspace-rail-panel {
    transform: translate3d(0, 0, 0);
    transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
    will-change: transform;
  }

  .workspace-shell-grid[data-rail-hidden] {
    --workspace-rail-col: var(--workspace-rail-collapsed-width, 0px);
  }

  .workspace-shell-grid[data-rail-hidden] .workspace-rail-panel {
    transform: translate3d(-100%, 0, 0);
  }

  .workspace-shell-grid[data-rail-resizing] {
    transition: none;
    cursor: col-resize;
    user-select: none;
    -webkit-user-select: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .workspace-shell-grid,
    .workspace-rail-panel {
      transition: none;
    }
  }
</style>
