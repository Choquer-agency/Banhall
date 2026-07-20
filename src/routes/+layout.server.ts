import { getAuthState } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import type { LayoutServerLoad } from "./$types";

/** Seed client-side auth with the cookie-derived server state (no flash).
 * Sync read — the token was scoped by hooks.server.ts. */
export const load: LayoutServerLoad = async () => {
  return { authState: getAuthState() };
};
