<script lang="ts">
  import type { Snippet } from "svelte";
  import { IconClose } from "$lib/components/icons";
  import type { DashboardView } from "$lib/dashboard/viewMode";
  import WorkspaceRail from "$lib/components/workspace/WorkspaceRail.svelte";
  import GlobalBar from "$lib/components/workspace/GlobalBar.svelte";
  import FrameRail from "$lib/components/workspace/FrameRail.svelte";
  import CommandPalette from "$lib/components/workspace/CommandPalette.svelte";
  import * as Drawer from "$lib/components/ui/drawer/index.js";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import ViewAsPill from "$lib/components/shell/ViewAsPill.svelte";
  import ViewAsDialog from "$lib/components/shell/ViewAsDialog.svelte";
  import ShortcutHost from "$lib/components/shell/ShortcutHost.svelte";
  import NotificationToaster from "$lib/components/shell/NotificationToaster.svelte";
  import { canSeeAdmin } from "$lib/shell/navigation";
  import { createActivityHeartbeat } from "$lib/shell/activityHeartbeat";
  import { rememberAccount } from "$lib/auth/lastAccount";
  import { effectiveViewer, viewAs } from "$lib/shell/viewAs.svelte";
  import { toggleSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";

  /**
   * The page frame (owner, 2026-10-28; Paper S9, S11, A1; the 2026-10-28
   * (eighth) amendment in docs/product-domain.md). From 1024px: the 52px
   * global bar across the top, then the fixed 80px labelled rail and the
   * page's one white card, 4px apart, with 8px to the window's right edge and
   * foot, all on the plain `frame` gray. The page draws the card
   * (`FrameCard`) as this shell's last grid cell. Below 1024px the bar and
   * rail go away and the slide-out drawer stays as before; each page bar
   * keeps its hamburger.
   *
   * The rail no longer resizes or collapses; Mod \ collapses the page's
   * section sidebar instead (`sectionSidebar`, remembered in this browser).
   */
  let {
    kind,
    theme,
    navigationOpen = $bindable(false),
    displayedView,
    myWorkAvailable,
    myWorkHref,
    projectsHref,
    currentDashboardHref,
    currentExperienceLabel = "Current dashboard",
    drawerDescription,
    children,
  }: {
    kind: "dashboard" | "chrome";
    theme: "light" | "dark";
    navigationOpen?: boolean;
    displayedView: DashboardView | null;
    myWorkAvailable: boolean;
    myWorkHref: string;
    projectsHref: string;
    currentDashboardHref: string;
    currentExperienceLabel?: string;
    /** @deprecated The drawer's search opens the command palette (2026-08-13). */
    onFocusSearch: () => void;
    drawerDescription: string;
    children: Snippet;
  } = $props();

  // Command palette (2026-08-13, Attio-research P0): shell-owned so Mod K
  // and the drawer's search button reach one surface on every shell page.
  let commandPaletteOpen = $state(false);

  // View as (D1 to D5) is presentation only: the shell frames the work panel
  // and shows the pill while a developer views another role.
  const auth = useAuth();
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const realDeveloper = $derived(userQ.data?.isDeveloper === true);
  const viewer = $derived(effectiveViewer(userQ.data));
  const viewing = $derived(viewer.viewing);

  // Team "Last active" (C1): one heartbeat on mount and on window focus, at
  // most every 5 minutes per tab, only for internal users (markActive
  // refuses anyone else).
  const markActive = useMutation(api.team.markActive);
  const heartbeat = createActivityHeartbeat(() => markActive({}));
  const internalUser = $derived(Boolean(userQ.data?.role) && userQ.data?.isAnonymous !== true);
  $effect(() => {
    if (!internalUser) return;
    heartbeat.ping();
    const onFocus = () => heartbeat.ping();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  // J3: keep the returning-user greeting's name current. Only the signed-in
  // person's own name and email are stored; explicit sign-out forgets them.
  $effect(() => {
    const user = userQ.data;
    if (user?.email) rememberAccount(user);
  });

  // The drawer is for small screens: it closes when the window reaches 1024px.
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
  data-workspace-shell={kind === "dashboard" ? "" : undefined}
  data-workspace-chrome={kind === "chrome" ? "" : undefined}
  data-workspace-theme={theme}
  data-view-as={viewing ?? undefined}
  class="relative grid h-dvh grid-rows-[minmax(0,1fr)] overflow-hidden bg-frame text-ink lg:grid-rows-[3.25rem_minmax(0,1fr)]"
>
  <GlobalBar homeHref={myWorkHref} class="max-lg:hidden" />
  <div
    data-frame-body
    class="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] lg:grid-cols-[5rem_minmax(0,1fr)] lg:gap-1 lg:pb-2 lg:pr-2"
  >
    <FrameRail {projectsHref} class="max-lg:hidden" />
    {@render children()}
  </div>

  {#if viewing}
    <!-- D3, D4: the pill is centred on the window, inside the 52px global
         bar; below 1024px a full-width strip under the page bar. -->
    <div
      data-view-as-layer
      class="pointer-events-none absolute z-[60] flex items-center justify-center max-lg:inset-x-3 max-lg:top-16 lg:inset-x-0 lg:top-0 lg:h-[3.25rem]"
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
  onToggleSidebar={() => toggleSectionSidebar()}
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
      <IconClose size={18} strokeWidth={2} />
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
