/**
 * `?next=` handling for the sign-in round trip: a signed-out visit to a page
 * goes to /login?next=<that page>, and a successful sign-in returns there.
 *
 * `next` is attacker-controlled (anyone can send a /login?next=... link), so
 * only same-origin relative paths are accepted. Anything else falls back to
 * the default destination, which prevents open redirects.
 */

export const LOGIN_PATH = "/login";

/** Where sign-in lands without a usable `next`. */
export const DEFAULT_AFTER_LOGIN_PATH = "/dashboard";

const NEXT_PARAM = "next";
const MAX_NEXT_LENGTH = 2048;

// Parse against a fixed placeholder origin: a value that changes the origin
// (scheme, `//host`, `/\host`, ...) is not a same-origin path.
const PLACEHOLDER_ORIGIN = "http://next.invalid";

// Pages that must never be a sign-in destination: the sign-in and sign-up
// pages themselves (loops) and raw auth API routes.
const BLOCKED_PREFIXES = [LOGIN_PATH, "/signup", "/api"];

function isBlockedPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return BLOCKED_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`));
}

/**
 * Returns `raw` as a normalized same-origin path (pathname, search and hash),
 * or `null` when it is missing, absolute, protocol-relative, malformed or
 * points at a blocked page.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return null;
  // Must be a rooted path. Rejects `https://...`, `javascript:...`, `evil.com`.
  if (!raw.startsWith("/")) return null;
  // Backslashes and control characters are either rewritten or stripped by
  // URL parsers, which is how `/\evil.com` and `/<tab>/evil.com` escape.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // Dot segments can normalize into a protocol-relative path
  // (`/..//evil.com` becomes `//evil.com`), so check the result too.
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (isBlockedPath(url.pathname)) return null;
  return path;
}

type LocationLike = Pick<URL, "pathname" | "search" | "hash">;

/**
 * The /login URL for a signed-out visit to `from`, carrying it as `next`.
 * The site root and unusable paths get a plain /login.
 */
export function loginHref(from: LocationLike | null | undefined): string {
  if (!from) return LOGIN_PATH;
  const next = safeNextPath(`${from.pathname}${from.search}${from.hash}`);
  if (!next || next === "/") return LOGIN_PATH;
  return `${LOGIN_PATH}?${new URLSearchParams({ [NEXT_PARAM]: next })}`;
}

/** Where to go after signing in, given the /login page's query string. */
export function afterLoginPath(search: URLSearchParams): string {
  return safeNextPath(search.get(NEXT_PARAM)) ?? DEFAULT_AFTER_LOGIN_PATH;
}
