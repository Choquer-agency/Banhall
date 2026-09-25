/**
 * Better Auth cookie names, shared by the Convex auth config (convex/auth.ts)
 * and the SvelteKit server (src/lib/server/auth.ts).
 *
 * Browsers scope cookies by host, not by port, so every Banhall app served on
 * `localhost` shares one cookie jar. With the default names, signing in to
 * one local app (say the demo on :5175) overwrites or deletes the session of
 * another (say :5173). Setting `BETTER_AUTH_COOKIE_PREFIX` gives a deployment
 * its own names. It must hold the same value on the Convex deployment (which
 * writes the cookies) and in the SvelteKit app's env (which reads them).
 *
 * Unset, blank or invalid values resolve to Better Auth's default prefix, so
 * production keeps today's names (`better-auth.session_token`,
 * `better-auth.convex_jwt`, each with `__Secure-` over https) and nobody is
 * signed out when this ships.
 */

/** Better Auth's built-in cookie prefix (better-auth/dist/cookies). */
export const DEFAULT_AUTH_COOKIE_PREFIX = "better-auth";

/** Env var read by both runtimes. */
export const AUTH_COOKIE_PREFIX_ENV = "BETTER_AUTH_COOKIE_PREFIX";

/** Better Auth adds this to every cookie name when the base URL is https. */
const SECURE_COOKIE_PREFIX = "__Secure-";

/** Session cookie (7 days) written by Better Auth. */
const SESSION_TOKEN_COOKIE = "session_token";

/** Convex JWT cookie (15 minutes), JWT_COOKIE_NAME in @convex-dev/better-auth. */
const CONVEX_JWT_COOKIE = "convex_jwt";

// Cookie-name token characters only, starting with a letter or digit so a
// value can never smuggle in its own `__Secure-` or `__Host-` prefix.
const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * The custom prefix to hand Better Auth, or `undefined` to keep its default.
 * Returning `undefined` for the default path means convex/auth.ts passes no
 * `advanced` option at all, exactly as before this setting existed.
 */
export function customAuthCookiePrefix(raw: string | null | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || !PREFIX_PATTERN.test(value)) return undefined;
  if (value === DEFAULT_AUTH_COOKIE_PREFIX) return undefined;
  return value;
}

/** The prefix Better Auth will actually use for this env value. */
export function resolveAuthCookiePrefix(raw: string | null | undefined): string {
  return customAuthCookiePrefix(raw) ?? DEFAULT_AUTH_COOKIE_PREFIX;
}

export type AuthCookieNames = {
  /** Secure (https) name first, then the plain http name. */
  sessionToken: readonly [string, string];
  convexJwt: readonly [string, string];
};

function namesFor(prefix: string, cookie: string): readonly [string, string] {
  const name = `${prefix}.${cookie}`;
  return [`${SECURE_COOKIE_PREFIX}${name}`, name];
}

/** Every name a Better Auth session or Convex JWT cookie can have for this env value. */
export function authCookieNames(raw: string | null | undefined): AuthCookieNames {
  const prefix = resolveAuthCookiePrefix(raw);
  return {
    sessionToken: namesFor(prefix, SESSION_TOKEN_COOKIE),
    convexJwt: namesFor(prefix, CONVEX_JWT_COOKIE),
  };
}

/** Minimal cookie reader, satisfied by SvelteKit's `event.cookies`. */
export type CookieReader = { get(name: string): string | undefined };

/** First non-empty value among `names`. */
export function readFirstCookie(cookies: CookieReader, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = cookies.get(name);
    if (value) return value;
  }
  return undefined;
}
