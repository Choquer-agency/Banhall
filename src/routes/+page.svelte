<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import WorkspaceLoadingShell from "$lib/components/workspace/WorkspaceLoadingShell.svelte";
  import { IconHome } from "$lib/components/icons";

  const auth = useAuth();

  // Route authenticated users straight to Home's canonical URL (never via the
  // /dashboard compatibility entry) and everyone else to sign in.
  $effect(() => {
    if (auth.isLoading) return;
    void goto(resolve(auth.isAuthenticated ? "/my-work" : "/login"), {
      replaceState: true,
    });
  });
</script>

<!-- Signed-in visitors land on Home: draw its shell while the session
     settles. A signed-out visitor gets the plain canvas on the way to /login. -->
<WorkspaceLoadingShell layout="home" title="Home" icon={IconHome} />
