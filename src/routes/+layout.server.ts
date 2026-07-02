import { createConvexAuthHandlers } from "@mmailaender/convex-auth-svelte/sveltekit/server";
import type { LayoutServerLoad } from "./$types";

const { getAuthState } = createConvexAuthHandlers();

/** Seed client-side auth with the cookie-derived server state (no flash). */
export const load: LayoutServerLoad = async (event) => {
  return { authState: await getAuthState(event) };
};
