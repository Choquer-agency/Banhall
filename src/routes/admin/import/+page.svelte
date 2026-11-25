<script lang="ts">
  // The Import sheet (2026-11-11, phase 3a). The route only checks the
  // session the way /admin/ingestion does and mounts the page; the page's
  // queries are admin only and the page says so for anyone else.
  import WorkspaceLoadingShell from "$lib/components/workspace/WorkspaceLoadingShell.svelte";
  import ImportPage from "$lib/components/import/ImportPage.svelte";
  import { IconImport } from "$lib/components/icons";
  import { goToLogin } from "$lib/auth/goToLogin";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";

  const auth = useAuth();

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) goToLogin();
  });
</script>

<svelte:head><title>Import · Banhall</title></svelte:head>

{#if auth.isLoading || !auth.isAuthenticated}
  <WorkspaceLoadingShell layout="page" title="Import" icon={IconImport} />
{:else}
  <ImportPage />
{/if}
