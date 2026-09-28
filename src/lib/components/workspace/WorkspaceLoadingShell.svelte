<script lang="ts">
  /**
   * The loading state of every round 2 page (lead direction 2026-09-28): the
   * real rail and a top bar render at once, and the work panel shows a quiet
   * skeleton of the page's layout. It replaces the lone centred spinner on
   * the canvas for the session check, the rollout decision and the pages'
   * own first loads.
   *
   * The shell subscribes to nothing heavy: the rail's own queries skip until
   * the session is live. A signed-out visitor being sent to sign in gets the
   * plain canvas instead, never a workspace they cannot use.
   */
  import { page } from "$app/state";
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import type { PageIcon } from "$lib/components/shell/pageIcon";
  import PageTopBar from "$lib/components/shell/PageTopBar.svelte";
  import WorkspaceShell from "$lib/components/workspace/WorkspaceShell.svelte";
  import WorkspaceShellControls from "$lib/components/workspace/WorkspaceShellControls.svelte";
  import WorkspacePanelSkeleton, {
    type PanelSkeletonLayout,
  } from "$lib/components/workspace/WorkspacePanelSkeleton.svelte";
  import type { DashboardView } from "$lib/dashboard/viewMode";

  let {
    layout,
    title,
    icon = undefined,
    breadcrumb = null,
    label = "Loading workspace",
    ...rest
  }: {
    layout: PanelSkeletonLayout;
    title: string;
    icon?: PageIcon;
    /** Parent page link shown before the title ("Admin /"). */
    breadcrumb?: { label: string; href: string } | null;
    /** Accessible name of the loading panel. */
    label?: string;
    /** Test and state hooks forwarded to the loading panel. */
    [key: `data-${string}`]: string | undefined;
  } = $props();

  const auth = useAuth();
  let navigationOpen = $state(false);

  const displayedView = $derived<DashboardView | null>(
    layout === "home" ? "my_work" : layout === "projects" ? "all_projects" : null
  );

  function destinationHref(target: DashboardView) {
    const url = new URL(page.url);
    url.searchParams.delete("view");
    url.searchParams.delete("workspace");
    return `${target === "my_work" ? resolve("/my-work") : resolve("/projects")}${url.search}`;
  }

  const currentDashboardHref = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.set("workspace", "current");
    return `${resolve("/dashboard")}${url.search}`;
  });
</script>

{#if !auth.isLoading && !auth.isAuthenticated}
  <div role="status" aria-label={label} class="flex-1 bg-canvas" {...rest}></div>
{:else}
  <WorkspaceShell
    kind="chrome"
    theme="light"
    bind:navigationOpen
    {displayedView}
    myWorkAvailable
    myWorkHref={destinationHref("my_work")}
    projectsHref={destinationHref("all_projects")}
    {currentDashboardHref}
    onFocusSearch={() => {}}
    drawerDescription="Navigate between work, projects, and account pages."
  >
    {#if layout === "projects"}
      <!-- The Projects toolbar: the same 49px bar as WorkspaceHeader. -->
      <div data-workspace-loading={layout} class="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header data-workspace-page-header class="flex h-[3.0625rem] shrink-0 items-center gap-2 border-b border-workspace-rail-line bg-canvas px-3 sm:px-4">
          <WorkspaceShellControls tone="light" onOpenNavigation={() => (navigationOpen = true)} />
          <h1 class="truncate text-sm font-medium tracking-[-0.01em] text-ink">{title}</h1>
        </header>
        <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspacePanelSkeleton {layout} {label} {...rest} />
        </main>
      </div>
    {:else}
      <!-- The round 2 frame of WorkspaceChrome and Home: the 56px top bar on
           the shell background, then the white panel inset 12px. -->
      <div data-workspace-loading={layout} class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-workspace-shell px-3 pb-3">
        <PageTopBar {title} {icon} {breadcrumb} onOpenNavigation={() => (navigationOpen = true)} />
        <main data-work-panel class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[0.625rem] border border-line bg-surface">
          <WorkspacePanelSkeleton {layout} {label} {...rest} />
        </main>
      </div>
    {/if}
  </WorkspaceShell>
{/if}
