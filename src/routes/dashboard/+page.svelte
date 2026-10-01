<script lang="ts">
  import { IconHome } from "$lib/components/icons";
  // /dashboard is the permanent compatibility entry. Current overrides and
  // access errors mount the current dashboard. While the access decision
  // loads (and in the server render) the gate shows its neutral loading
  // state, so a user bound for Home never sees the old dashboard on the way
  // (2026-09-28 sign-in flash). Successful access soft-navigates to
  // /projects for view=all_projects, otherwise /my-work, preserving all other
  // params via WorkspaceGate.
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import CurrentDashboard from "$lib/components/dashboard/CurrentDashboard.svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";

  // While pending, draw the shell of the page the user is headed to.
  const toProjects = $derived(page.url.searchParams.get("view") === "all_projects");
  const previewHref = $derived.by(() => {
    const url = new URL(page.url);
    const view = url.searchParams.get("view");
    url.searchParams.delete("view");
    const path = view === "all_projects" ? resolve("/projects") : resolve("/my-work");
    return `${path}${url.search}`;
  });
</script>

<WorkspaceGate
  {previewHref}
  currentWhileLoading={false}
  pendingLayout={toProjects ? "projects" : "home"}
  pendingTitle={toProjects ? "Projects" : "Home"}
  pendingIcon={toProjects ? undefined : IconHome}
>
  {#snippet current()}
    <CurrentDashboard />
  {/snippet}
</WorkspaceGate>
