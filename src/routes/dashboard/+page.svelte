<script lang="ts">
  // /dashboard is the permanent compatibility entry. Current overrides,
  // loading, and access errors mount the current dashboard immediately.
  // Successful access soft-navigates to /projects for view=all_projects,
  // otherwise /my-work, preserving all other params via WorkspaceGate.
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import CurrentDashboard from "$lib/components/dashboard/CurrentDashboard.svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";

  const previewHref = $derived.by(() => {
    const url = new URL(page.url);
    const view = url.searchParams.get("view");
    url.searchParams.delete("view");
    const path = view === "all_projects" ? resolve("/projects") : resolve("/my-work");
    return `${path}${url.search}`;
  });
</script>

<WorkspaceGate {previewHref}>
  {#snippet current()}
    <CurrentDashboard />
  {/snippet}
</WorkspaceGate>
