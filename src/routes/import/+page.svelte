<script lang="ts">
  // Top-level Import route (/import): mounts ImportPage after verifying the
  // session. Server queries enforce admin-only access and the page handles
  // non-admins cleanly.
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
