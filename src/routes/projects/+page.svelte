<script lang="ts">
  // /projects is the canonical project repository. Current overrides and
  // access errors soft-redirect to /dashboard?view=all_projects, preserving
  // other params. WorkspaceGate stays neutral while access is loading.
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import WorkspaceDashboard from "$lib/components/workspace/WorkspaceDashboard.svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";

  const currentHref = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.set("view", "all_projects");
    return `${resolve("/dashboard")}${url.search}`;
  });
</script>

<WorkspaceGate {currentHref}>
  {#snippet preview()}
    <WorkspaceDashboard view="all_projects" />
  {/snippet}
</WorkspaceGate>
