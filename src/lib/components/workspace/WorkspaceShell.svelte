<script lang="ts">
  import type { Snippet } from "svelte";
  import { XIcon } from "phosphor-svelte";
  import type { DashboardView } from "$lib/dashboard/viewMode";
  import WorkspaceRail from "$lib/components/workspace/WorkspaceRail.svelte";
  import WorkspaceRailResizeHandle from "$lib/components/workspace/WorkspaceRailResizeHandle.svelte";
  import CommandPalette from "$lib/components/workspace/CommandPalette.svelte";
  import * as Drawer from "$lib/components/ui/drawer/index.js";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import ViewAsPill from "$lib/components/shell/ViewAsPill.svelte";
  import ViewAsDialog from "$lib/components/shell/ViewAsDialog.svelte";
  import ShortcutHost from "$lib/components/shell/ShortcutHost.svelte";
  import NotificationToaster from "$lib/components/shell/NotificationToaster.svelte";
  import { canSeeAdmin } from "$lib/shell/navigation";
  import { effectiveViewer, viewAs } from "$lib/shell/viewAs.svelte";
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
     * Desktop rail collapse state. Collapsed, the rail keeps an icons-only
     * column (ui-design-final.md section 2, board 1.2); its expanded width
     * stays persisted. The shell owns the persisted preference; hosts bind
     * this so their header toggle stays a plain prop wire. The mobile drawer
     * is independent and unchanged.
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

  // View as (D1 to D5) is presentation only: the shell frames the work panel
  // and shows the pill while a developer views another role.
  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const realDeveloper = $derived(userQ.data?.isDeveloper === true);
  const viewer = $derived(effectiveViewer(userQ.data));
  const viewing = $derived(viewer.viewing);

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

  // Tablet widths (1024 to 1279px) keep the icons-only rail on screen
  // (ui-design-final.md section 3, board 3.5); the preference applies from
  // 1280px up.
  let tablet = $state(false);
  $effect(() => {
    const media = window.matchMedia("(min-width: 64rem) and (max-width: 79.98rem)");
    const update = () => (tablet = media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });
  const railCollapsed = $derived(railHidden || tablet);
  // At tablet widths the rail is always icons-only, so there is nothing to expand.
  const toggleRail = $derived(tablet ? null : () => (railHidden = !railHidden));

  $effect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
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
  data-view-as={viewing ?? undefined}
  style={`--workspace-rail-width: ${railWidth}px; --workspace-rail-collapsed-width: ${RAIL_COLLAPSED_WIDTH}px;`}
  class="workspace-shell-grid relative grid h-dvh grid-rows-[minmax(0,1fr)] overflow-hidden bg-workspace-shell text-ink lg:grid-cols-[var(--workspace-rail-collapsed-width)_minmax(0,1fr)] xl:grid-cols-[var(--workspace-rail-col)_minmax(0,1fr)]"
>
  <div class="workspace-rail-column relative hidden min-h-0 lg:block">
    <aside
      id="workspace-rail"
      data-rail-panel
      class="workspace-rail-panel absolute inset-y-0 left-0 overflow-hidden bg-workspace-shell"
      style={`width: ${railCollapsed ? "var(--workspace-rail-collapsed-width)" : "var(--workspace-rail-width)"};`}
    >
      <div class="h-full" style={`width: ${railCollapsed ? "var(--workspace-rail-collapsed-width)" : "var(--workspace-rail-width)"};`}>
        <WorkspaceRail
          variant="rail"
          collapsed={railCollapsed}
          {displayedView}
          {myWorkAvailable}
          {myWorkHref}
          {projectsHref}
          onFocusSearch={() => (commandPaletteOpen = true)}
          onToggleRail={toggleRail}
        />
      </div>
      <!-- Pointer/keyboard resize applies to the expanded rail only. -->
      {#if !railCollapsed}
        <WorkspaceRailResizeHandle width={railWidth} onResize={applyLiveWidth} onCommit={commitWidth} />
      {/if}
    </aside>
  </div>

  {@render children()}

  {#if viewing}
    <!-- D3: centred over the 56px top bar of the content column; below 1024px
         a full-width strip under the top bar (not designed, proposed). -->
    <div
      data-view-as-layer
      class="view-as-layer pointer-events-none absolute z-[60] flex items-center justify-center max-lg:inset-x-3 max-lg:top-14 lg:right-0 lg:top-0 lg:h-14"
    >
      <ViewAsPill role={viewing} />
    </div>
  {/if}
</div>

<CommandPalette
  bind:open={commandPaletteOpen}
  {myWorkHref}
  {projectsHref}
  {currentDashboardHref}
  {currentExperienceLabel}
/>
<ViewAsDialog bind:open={viewAs.dialogOpen} />
<NotificationToaster />
<ShortcutHost
  onToggleRail={() => {
    if (!tablet) railHidden = !railHidden;
  }}
  canOpenAdmin={canSeeAdmin(viewer)}
  canViewAs={realDeveloper}
  onOpenViewAs={() => (viewAs.dialogOpen = true)}
/>

<Drawer.Root bind:open={navigationOpen} direction="left" shouldScaleBackground={false} autoFocus={true}>
  <Drawer.Content
    data-workspace-drawer
    data-workspace-theme="light"
    class="z-[110] h-dvh w-[min(19rem,calc(100vw-2.5rem))]! max-w-none! rounded-none! border-r border-workspace-rail-line bg-workspace-shell p-0 text-ink shadow-workspace-drawer lg:hidden"
  >
    <Drawer.Title class="sr-only">Workspace navigation</Drawer.Title>
    <Drawer.Description class="sr-only">{drawerDescription}</Drawer.Description>
    <Drawer.Close
      aria-label="Close workspace navigation"
      class="absolute right-2 top-[max(0.375rem,env(safe-area-inset-top))] z-10 flex h-11 w-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-workspace-rail-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none"
    >
      <XIcon size={20} weight="regular" aria-hidden="true" />
    </Drawer.Close>
    <WorkspaceRail
      variant="drawer"
      {displayedView}
      {myWorkAvailable}
      {myWorkHref}
      {projectsHref}
      onFocusSearch={() => {
        navigationOpen = false;
        commandPaletteOpen = true;
      }}
      onNavigate={() => (navigationOpen = false)}
    />
  </Drawer.Content>
</Drawer.Root>

<style>
  /* Rail column: the grid tracks the expanded width or the icons-only
     collapsed width. `data-rail-hidden` is kept as the persisted-preference
     lineage (it now means "collapsed"). Live pointer drags suspend the track
     transition so the edge follows the pointer 1:1. */
  .workspace-shell-grid {
    --workspace-rail-col: var(--workspace-rail-width, 275px);
    transition: grid-template-columns 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .workspace-rail-panel {
    transition: width 300ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .workspace-shell-grid[data-rail-hidden] {
    --workspace-rail-col: var(--workspace-rail-collapsed-width, 56px);
  }

  /* The pill spans the content column: from the rail's edge to the right. */
  @media (min-width: 64rem) {
    .view-as-layer {
      left: var(--workspace-rail-collapsed-width, 56px);
    }
  }
  @media (min-width: 80rem) {
    .view-as-layer {
      left: var(--workspace-rail-col);
    }
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
