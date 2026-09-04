<script lang="ts">
  // /my-work — canonical URL of the default daily destination
  // (product-domain amendment 2026-08-06, amended 2026-09-03; "My Work
  // remains the default destination" is unchanged — this is simply its
  // canonical URL). A decision of `current` (`?workspace=current`, or a
  // failed access query) soft-redirects to the compatibility entry
  // `/dashboard?view=my_work`, preserving `layout`, `workspace`, and unknown
  // params — never a 404, never a preview flash; while the access decision
  // loads, WorkspaceGate renders a neutral loading state.
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
