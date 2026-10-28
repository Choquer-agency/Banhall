<script lang="ts">
  /**
   * The loading state of every page (lead direction 2026-09-28, in the page
   * frame of 2026-10-28): the global bar, the rail and the white card render
   * at once, with the section sidebar the page will draw (read from the
   * address, `frameSectionForPath`) and the page's own top bar; the rest of
   * the card shows a quiet skeleton of the page's layout. It replaces the
   * lone centred spinner for the session check, the rollout decision and the
   * pages' own first loads.
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
  import FrameCard from "$lib/components/workspace/FrameCard.svelte";
  import ProjectTopBar from "$lib/components/project/shell/ProjectTopBar.svelte";
  import ProjectsSectionSidebar from "$lib/components/projects/ProjectsSectionSidebar.svelte";
  import TeamSidebar from "$lib/components/workspace/sidebars/TeamSidebar.svelte";
  import AdminSidebar from "$lib/components/workspace/sidebars/AdminSidebar.svelte";
  import SettingsSidebar from "$lib/components/workspace/sidebars/SettingsSidebar.svelte";
  import { frameSectionForPath, type FrameSection } from "$lib/shell/navigation";
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

  // Home and Projects always draw the Projects sidebar; other pages follow the address.
  const section = $derived<FrameSection | null>(
    layout === "home" || layout === "projects" ? "projects" : layout === "project" ? null : frameSectionForPath(page.url.pathname)
  );

  const currentDashboardHref = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.set("workspace", "current");
    return `${resolve("/dashboard")}${url.search}`;
  });
</script>

{#snippet sectionSidebar()}
  {#if section === "projects"}
    <ProjectsSectionSidebar current={layout === "home" ? "home" : "projects"} homeHref={destinationHref("my_work")} />
  {:else if section === "team"}
    <TeamSidebar />
  {:else if section === "admin"}
    <AdminSidebar />
  {:else if section === "settings"}
    <SettingsSidebar />
  {/if}
{/snippet}

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
    {#if layout === "project"}
      <!-- The project page: no sidebar, its 52px bar inside the card. -->
      <FrameCard data-workspace-loading={layout}>
        <ProjectTopBar
          {title}
          projectsHref={destinationHref("all_projects")}
          onOpenNavigation={() => (navigationOpen = true)}
        />
        <WorkspacePanelSkeleton {layout} {label} {...rest} />
      </FrameCard>
    {:else}
      <FrameCard data-workspace-loading={layout} sidebar={section ? sectionSidebar : undefined}>
        <!-- The same bar the loaded page draws: the title only (2026-10-19). -->
        <PageTopBar {title} sidebarToggle={section !== null} onOpenNavigation={() => (navigationOpen = true)} />
        <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspacePanelSkeleton {layout} {label} {...rest} />
        </main>
      </FrameCard>
    {/if}
  </WorkspaceShell>
{/if}
