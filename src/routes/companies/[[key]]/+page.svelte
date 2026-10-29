<script lang="ts">
  // The Companies section (owner, 2026-10-28): `/companies` (All companies)
  // and `/companies/<key>` (one company's page) are one route, so moving
  // between them keeps the frame and the sidebar in place. Everything lives
  // in CompaniesPage so the component suite can mount it; the route only adds
  // the sign-in redirect, the loading frame and the title.
  import { page } from "$app/state";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { goToLogin } from "$lib/auth/goToLogin";
  import CompaniesPage from "$lib/components/companies/CompaniesPage.svelte";
  import WorkspaceLoadingShell from "$lib/components/workspace/WorkspaceLoadingShell.svelte";

  const auth = useAuth();
  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) void goToLogin();
  });

  const companyKey = $derived(page.params.key || null);
  let documentTitle = $state("Companies");
</script>

<svelte:head>
  <title>{documentTitle} - Banhall</title>
</svelte:head>

{#if auth.isLoading || !auth.isAuthenticated}
  <WorkspaceLoadingShell layout={companyKey === null ? "companies" : "company"} title="Companies" label="Loading companies" />
{:else}
  <CompaniesPage {companyKey} bind:documentTitle />
{/if}
