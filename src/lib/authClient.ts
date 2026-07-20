/**
 * Better Auth browser client (better-auth-migration). Auth routes are
 * registered on the Convex HTTP router (convex/http.ts), so the client
 * talks to the Convex site URL, and the convexClient() plugin exposes
 * `authClient.convex.token()` for the Convex JWT exchange used by
 * createSvelteAuthClient / useAuth.
 */
import { createAuthClient } from "better-auth/svelte";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { PUBLIC_CONVEX_SITE_URL } from "$env/static/public";

export const authClient = createAuthClient({
  baseURL: PUBLIC_CONVEX_SITE_URL,
  plugins: [convexClient()],
});
