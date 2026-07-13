<script lang="ts">
  import "@fontsource-variable/dm-sans";
  import "./layout.css";
  import favicon from "$lib/assets/favicon.svg";
  import { setupConvex } from "convex-svelte";
  import { setupConvexAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { updated } from "$app/state";
  import { beforeNavigate } from "$app/navigation";
  import { PUBLIC_CONVEX_URL } from "$env/static/public";
  import PageErrorBoundary from "$lib/components/errors/PageErrorBoundary.svelte";
  import ErrorMonitor from "$lib/components/errors/ErrorMonitor.svelte";
  import { Toaster } from "svelte-sonner";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";

  let { children, data } = $props();

  // One shared ConvexClient: convex-svelte owns queries/mutations, the auth
  // adapter drives setAuth/clearAuth on the same instance.
  const client = setupConvex(PUBLIC_CONVEX_URL);
  setupConvexAuth({ client, getServerState: () => data.authState });

  // Deploy skew: after a new Vercel deployment the old build's hashed chunks
  // 404. When a new app version is detected, turn the next client-side
  // navigation into a full-page load so the browser picks up fresh HTML.
  beforeNavigate(({ willUnload, to }) => {
    if (updated.current && !willUnload && to?.url) {
      location.href = to.url.href;
    }
  });

  // Fallback: a chunk vanished mid-session (deploy landed between page load
  // and navigation). Reload once to recover instead of a dead white screen.
  if (typeof window !== "undefined") {
    window.addEventListener("vite:preloadError", () => {
      const key = "chunk-reload-at";
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(key, String(Date.now()));
        location.reload();
      }
    });
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Banhall — SR&amp;ED Report Generator</title>
  <meta
    name="description"
    content="Generate structured SR&ED project description reports from interview transcripts."
  />
</svelte:head>

<Tooltip.Provider delayDuration={300}>
  <div class="flex min-h-screen flex-col font-sans antialiased">
    <PageErrorBoundary>
      {@render children()}
    </PageErrorBoundary>
    <ErrorMonitor />
    <Toaster richColors closeButton position="top-right" toastOptions={{ class: "font-sans" }} />
  </div>
</Tooltip.Provider>
