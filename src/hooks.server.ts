import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";
import type { Handle } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import { createAuthHandle } from "$lib/server/auth";
import { withSecurityHeaders } from "../shared/securityHeaders";

// Auth routes themselves are served by src/routes/api/auth/[...all]/+server.ts
// (proxied to the Convex HTTP router). This hook only extracts the Better Auth
// Convex JWT from cookies and scopes it for SSR loads. The cookie names follow
// BETTER_AUTH_COOKIE_PREFIX, which must match the Convex deployment's value
// (shared/authCookies.ts); unset keeps the default `better-auth.*` names.
const authHandle = createAuthHandle(() => env.BETTER_AUTH_COOKIE_PREFIX);

/**
 * Security headers on every response SvelteKit serves (security wave 1, a2
 * P2-1, a4 #6). The Content Security Policy itself comes from the `csp`
 * option in vite.config.ts; see shared/securityHeaders.ts.
 */
const securityHeadersHandle: Handle = async ({ event, resolve }) =>
  withSecurityHeaders(await resolve(event), event.url.pathname, { dev });

export const handle = sequence(authHandle, securityHeadersHandle);
