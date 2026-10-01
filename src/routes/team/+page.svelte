<script lang="ts">
  // Round 2 Team page (C1-C5). Everything lives in TeamPage so the component
  // suite can mount it; the route only adds the sign-in redirect.
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { goToLogin } from "$lib/auth/goToLogin";
  import TeamPage from "$lib/components/team/TeamPage.svelte";

  const auth = useAuth();
  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) void goToLogin();
  });
</script>

<svelte:head>
  <title>Team - Banhall</title>
</svelte:head>

<TeamPage />
