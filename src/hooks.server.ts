import { sequence } from "@sveltejs/kit/hooks";
import { createConvexAuthHooks } from "@mmailaender/convex-auth-svelte/sveltekit/server";

// Handles all POST requests to /api/auth (sign-in, token refresh, sign-out)
// by proxying to the Convex deployment. convexUrl comes from PUBLIC_CONVEX_URL.
const { handleAuth } = createConvexAuthHooks();

export const handle = sequence(handleAuth);
