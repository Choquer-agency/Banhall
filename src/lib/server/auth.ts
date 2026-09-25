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

/** SSR hint for createSvelteAuthClient; `undefined` means "let the client decide". */
export type ServerAuthState = { isAuthenticated: boolean } | undefined;

/** The Convex JWT (15-minute cookie) for this request, if the browser still has it. */
export function readConvexJwt(
  cookies: CookieReader,
  prefix: string | undefined,
): string | undefined {
  return readFirstCookie(cookies, authCookieNames(prefix).convexJwt);
}

/** Whether the request carries a Better Auth session cookie (7 days). */
export function hasSessionCookie(cookies: CookieReader, prefix: string | undefined): boolean {
  return readFirstCookie(cookies, authCookieNames(prefix).sessionToken) !== undefined;
}

/**
 * What the server tells the client about auth before it hydrates.
 *
 * - Convex JWT present: signed in.
 * - No JWT but a session cookie: the JWT simply lapsed (it lasts 15 minutes,
 *   the session 7 days). Claim nothing, so the client shows its session check
 *   and fetches a fresh JWT instead of rendering signed out and bouncing the
 *   page through /login.
 * - Neither cookie: signed out.
 */
export function serverAuthState({
  token,
  cookies,
  prefix,
}: {
  token: string | undefined;
  cookies: CookieReader;
  prefix: string | undefined;
}): ServerAuthState {
  if (token) return { isAuthenticated: true };
  if (hasSessionCookie(cookies, prefix)) return undefined;
  return { isAuthenticated: false };
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
