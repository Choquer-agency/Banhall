<script lang="ts">
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  const auth = useAuth();

  // Route authenticated users to their workspace and everyone else to sign in.
  $effect(() => {
    if (auth.isLoading) return;
    void goto(resolve(auth.isAuthenticated ? "/dashboard" : "/login"), {
      replaceState: true,
    });
  });
</script>

<div class="flex flex-1 items-center justify-center">
  <Spinner />
</div>
