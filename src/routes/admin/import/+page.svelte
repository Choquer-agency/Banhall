<script lang="ts">
  // The Import sheet (2026-11-11, phase 3a). The route only checks the
  // session the way /admin/ingestion does and mounts the page; the page's
  // queries are admin only and the page says so for anyone else.
  import WorkspaceLoadingShell from "$lib/components/workspace/WorkspaceLoadingShell.svelte";
  import ImportPage from "$lib/components/import/ImportPage.svelte";
  import { IconShield } from "$lib/components/icons";
  import { goToLogin } from "$lib/auth/goToLogin";
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";

  const auth = useAuth();

  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) goToLogin();
  });
</script>

{#if auth.isLoading || !auth.isAuthenticated}
  <WorkspaceLoadingShell layout="page" title="Import" icon={IconShield} breadcrumb={{ label: "Admin", href: resolve("/admin/house-rules") }} />
{:else}
  <ImportPage />
{/if}
