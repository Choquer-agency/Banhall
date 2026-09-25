<script lang="ts">
  // Runs the REAL convex-svelte auth state machine (the component config
  // aliases the bare `convex-svelte` specifier to a stub, so import the dist
  // file directly) with the server state the root layout would send, plus the
  // page guard every signed-in route uses. Lets a component test prove that a
  // lapsed Convex JWT with a live session waits instead of redirecting.
  import { untrack } from "svelte";
  import type { ConvexClient } from "convex/browser";
  import {
    setConvexClientContext,
    setupAuth,
    useAuth,
  } from "../../../node_modules/convex-svelte/dist/client.svelte.js";
  import type { ServerAuthState } from "$lib/server/auth";

  type Props = {
    client: ConvexClient;
    provider: () => { isLoading: boolean; isAuthenticated: boolean; fetchAccessToken: () => Promise<string | null> };
    getServerState: () => ServerAuthState;
    onRedirect: () => void;
  };
  const props: Props = $props();

  // The same wiring as createSvelteAuthClient in
  // @mmailaender/convex-better-auth-svelte (dist/svelte/client.svelte.js):
  // no server state means no initialState.
  // Setup runs once, like the root layout.
  setConvexClientContext(untrack(() => props.client));
  const serverState = untrack(() => props.getServerState());
  setupAuth(
    () => props.provider(),
    serverState ? { initialState: { isAuthenticated: serverState.isAuthenticated } } : undefined,
  );
  const auth = useAuth();

  // The page guard (WorkspaceGate, project pages, admin pages).
  $effect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) props.onRedirect();
  });
</script>

<p data-auth-harness data-loading={String(auth.isLoading)} data-authenticated={String(auth.isAuthenticated)}></p>
