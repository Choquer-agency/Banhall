import type { Handle } from "@sveltejs/kit";
import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { withServerConvexToken } from "convex-svelte/sveltekit/server";

// Auth routes themselves are served by src/routes/api/auth/[...all]/+server.ts
// (proxied to the Convex HTTP router). This hook only extracts the Better Auth
// Convex JWT from cookies — cookie-only overload, never constructs createAuth
// in the SvelteKit runtime — and scopes it for SSR loads.
export const handle: Handle = async ({ event, resolve }) => {
  const token = getToken(event.cookies);
  event.locals.token = token;
  return withServerConvexToken(token, () => resolve(event));
};
