/**
 * Better Auth browser client (better-auth-migration). Requests go to THIS
 * app's origin (/api/auth/[...all]), which proxies to the Convex HTTP router
 * (convex/http.ts registerRoutes) — same-origin, so no CORS and the session
 * cookie stays first-party. The convexClient() plugin exposes
 * `authClient.convex.token()` for the Convex JWT exchange used by
 * createSvelteAuthClient / useAuth.
 *
 * Do NOT set baseURL to PUBLIC_CONVEX_SITE_URL: the Convex site is a
 * different origin and its auth routes don't emit CORS headers, so every
 * browser call fails with "Failed to fetch" (surfaced as "invalid email or
 * password" on the login form).
 */
import { createAuthClient } from "better-auth/svelte";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [convexClient()],
});
