<script lang="ts">
  // /my-work — canonical URL of the default daily destination for flagged
  // workspace-preview users (product-domain amendment 2026-08-06; "My Work
  // remains the default destination" is unchanged — this is simply its
  // canonical URL). Non-flagged users (and `?workspace=current`) are
  // soft-redirected to the compatibility entry `/dashboard?view=my_work`,
  // preserving `layout`, `workspace`, and unknown params — never a 404,
  // never a preview flash; while the access decision loads, WorkspaceGate
  // renders a neutral loading state.
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import WorkspaceDashboard from "$lib/components/workspace/WorkspaceDashboard.svelte";
  import WorkspaceGate from "$lib/workspace/WorkspaceGate.svelte";

  const currentHref = $derived.by(() => {
    const url = new URL(page.url);
    url.searchParams.set("view", "my_work");
    return `${resolve("/dashboard")}${url.search}`;
  });
</script>

<WorkspaceGate {currentHref}>
  {#snippet preview()}
    <WorkspaceDashboard view="my_work" />
  {/snippet}
</WorkspaceGate>
