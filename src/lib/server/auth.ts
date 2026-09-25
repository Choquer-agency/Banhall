import type { Handle } from "@sveltejs/kit";
import { withServerConvexToken } from "convex-svelte/sveltekit/server";
import {
  authCookieNames,
  readFirstCookie,
  type CookieReader,
} from "../../../shared/authCookies";

/**
 * Server side of the Better Auth + Convex cookie contract. These functions take
 * the raw BETTER_AUTH_COOKIE_PREFIX value so the cookie names always match the
 * ones convex/auth.ts writes (see shared/authCookies.ts).
 */

/** The Convex JWT (15-minute cookie) for this request, if the browser still has it. */
export function readConvexJwt(
  cookies: CookieReader,
  prefix: string | undefined,
): string | undefined {
  return readFirstCookie(cookies, authCookieNames(prefix).convexJwt);
}

/**
 * SvelteKit handle that reads the Convex JWT cookie and scopes it for SSR
 * loads. Cookie-only: it never constructs createAuth in the SvelteKit runtime.
 */
export function createAuthHandle(readPrefix: () => string | undefined): Handle {
  return async ({ event, resolve }) => {
    const token = readConvexJwt(event.cookies, readPrefix());
    event.locals.token = token;
    return withServerConvexToken(token, () => resolve(event));
  };
}
