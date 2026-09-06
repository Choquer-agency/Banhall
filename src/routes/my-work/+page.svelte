<script lang="ts">
  // /my-work is the canonical daily workspace destination. Current overrides
  // and access errors soft-redirect to /dashboard?view=my_work, preserving
  // other params. WorkspaceGate stays neutral while access is loading.
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
