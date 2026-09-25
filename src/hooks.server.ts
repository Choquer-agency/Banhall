import { env } from "$env/dynamic/private";
import { createAuthHandle } from "$lib/server/auth";

// Auth routes themselves are served by src/routes/api/auth/[...all]/+server.ts
// (proxied to the Convex HTTP router). This hook only extracts the Better Auth
// Convex JWT from cookies and scopes it for SSR loads. The cookie names follow
// BETTER_AUTH_COOKIE_PREFIX, which must match the Convex deployment's value
// (shared/authCookies.ts); unset keeps the default `better-auth.*` names.
export const handle = createAuthHandle(() => env.BETTER_AUTH_COOKIE_PREFIX);
