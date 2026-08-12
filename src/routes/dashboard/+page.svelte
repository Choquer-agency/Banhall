<script lang="ts">
  // /dashboard — the PERMANENT compatibility entry (bookmarks, emails, the
  // rollback target; PRODUCT.md: "same canonical routes"). The current
  // experience branch is unchanged forever: unflagged users, `?workspace=
  // current`, load, and error states all mount the current dashboard
  // immediately, exactly as before. Only the preview branch changed: instead
  // of mounting the workspace here, flagged users soft-navigate
  // (replaceState) to their canonical URL — /projects when
  // `?view=all_projects`, otherwise /my-work — preserving `layout`,
  // `workspace`, and any unknown params. All gating lives in the shared
  // WorkspaceGate.
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
