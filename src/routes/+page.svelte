<script lang="ts">
  import { goto } from "$app/navigation";
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  const auth = useAuth();

  // Send everyone to /login which auto-authenticates as the demo user
  $effect(() => {
    if (auth.isLoading) return;
    goto(auth.isAuthenticated ? "/dashboard" : "/login", { replaceState: true });
  });
</script>

<div class="flex flex-1 items-center justify-center">
  <Spinner />
</div>
