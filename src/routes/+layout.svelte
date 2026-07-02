<script lang="ts">
  import "@fontsource-variable/dm-sans";
  import "./layout.css";
  import favicon from "$lib/assets/favicon.svg";
  import { setupConvex } from "convex-svelte";
  import { setupConvexAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { PUBLIC_CONVEX_URL } from "$env/static/public";
  import PageErrorBoundary from "$lib/components/errors/PageErrorBoundary.svelte";
  import ErrorMonitor from "$lib/components/errors/ErrorMonitor.svelte";

  let { children, data } = $props();

  // One shared ConvexClient: convex-svelte owns queries/mutations, the auth
  // adapter drives setAuth/clearAuth on the same instance.
  const client = setupConvex(PUBLIC_CONVEX_URL);
  setupConvexAuth({ client, getServerState: () => data.authState });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Banhall — SR&amp;ED Report Generator</title>
  <meta
    name="description"
    content="Generate structured SR&ED project description reports from interview transcripts."
  />
</svelte:head>

<div class="flex min-h-screen flex-col font-sans antialiased">
  <PageErrorBoundary>
    {@render children()}
  </PageErrorBoundary>
  <ErrorMonitor />
</div>
