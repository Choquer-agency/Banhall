import { env } from "$env/dynamic/private";
import { serverAuthState } from "$lib/server/auth";
import type { LayoutServerLoad } from "./$types";

/** Seed client-side auth with the cookie-derived server state (no flash).
 * A lapsed Convex JWT with a live session returns no state, so the client
 * waits for its token refresh instead of treating the visit as signed out. */
export const load: LayoutServerLoad = async ({ cookies, locals }) => {
  return {
    authState: serverAuthState({
      token: locals.token,
      cookies,
      prefix: env.BETTER_AUTH_COOKIE_PREFIX,
    }),
  };
};
