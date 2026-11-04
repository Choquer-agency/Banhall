<script lang="ts">
  import "@fontsource-variable/geist";
  import "@fontsource-variable/geist-mono";
  import "./layout.css";
  import favicon from "$lib/assets/favicon.svg";
  import { setupConvex } from "convex-svelte";
  import { onDestroy } from "svelte";
  import { installQueryKeepAlive } from "$lib/convex/queryKeepAlive";
  import { createSvelteAuthClient } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { authClient } from "$lib/authClient";
  import { updated } from "$app/state";
  import { beforeNavigate } from "$app/navigation";
  import { shouldReloadForUpdate } from "$lib/workspace/saveHold";
  import { PUBLIC_CONVEX_URL } from "$env/static/public";
  import PageErrorBoundary from "$lib/components/errors/PageErrorBoundary.svelte";
  import ErrorMonitor from "$lib/components/errors/ErrorMonitor.svelte";
  import AppToaster from "$lib/components/shell/AppToaster.svelte";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import { startProjectPrefetch } from "$lib/prefetch/project";
  import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
  import geistMonoLatin from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";

  let { children, data } = $props();

  // One shared ConvexClient: convex-svelte owns queries/mutations, the auth
  // adapter drives setAuth/clearAuth on the same instance.
  const client = setupConvex(PUBLIC_CONVEX_URL);
  const queryKeepAlive = installQueryKeepAlive(client);
  createSvelteAuthClient({
    authClient,
    convexClient: client,
    getServerState: () => data.authState,
  });

  // The auth adapter may refresh its token without changing the user. Clear
  // held results only when the settled session identity changes. A brief null
  // session during navigation is ignored if the same session returns.
  if (typeof window !== "undefined") {
    let identity: string | null | undefined;
    let pendingSignOut: ReturnType<typeof setTimeout> | undefined;
    const unsubscribeSession = authClient.useSession().subscribe((session) => {
      if (session.isPending || session.isRefetching) return;
      const user = session.data?.user;
      const next = user?.id && session.data?.session?.id
        ? JSON.stringify([user.id, session.data.session.id])
        : null;
      if (pendingSignOut) clearTimeout(pendingSignOut);
      if (next === null) {
        pendingSignOut = setTimeout(() => {
          if (identity !== undefined && identity !== null) queryKeepAlive.clear();
          identity = null;
          pendingSignOut = undefined;
        }, 200);
      } else {
        if (identity !== next) queryKeepAlive.clear();
        identity = next;
      }
    });
    onDestroy(() => {
      if (pendingSignOut) clearTimeout(pendingSignOut);
      unsubscribeSession();
    });
  }

  const auth = useAuth();
  $effect(() => {
    if (!auth.isAuthenticated) return;
    return startProjectPrefetch();
  });

  // Deploy skew: after a new Vercel deployment the old build's hashed chunks
  // 404. When a new app version is detected, turn the next client-side
  // navigation into a full-page load so the browser picks up fresh HTML.
  // Not while a page holds navigation for a save (review D-3): that page
  // cancels the navigation, and a full load would leave anyway.
  beforeNavigate((navigation) => {
    if (shouldReloadForUpdate(updated.current, navigation) && navigation.to) {
      location.href = navigation.to.url.href;
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
  <link rel="preload" href={geistLatin} as="font" type="font/woff2" crossorigin="anonymous" />
  <link rel="preload" href={geistMonoLatin} as="font" type="font/woff2" crossorigin="anonymous" />
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
    <!-- Round 2 (C1, D3, D5): one dark toast at the bottom centre; errors stay red. -->
    <AppToaster />
  </div>
</Tooltip.Provider>
