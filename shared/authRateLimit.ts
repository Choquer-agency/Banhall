/**
 * Sign-in rate limiting (security wave 1, audit 2026-09-25 a2 P1-2, a4 #7).
 *
 * Better Auth runs inside a Convex HTTP action behind the SvelteKit proxy
 * (src/routes/api/auth/[...all]/+server.ts), so the address Convex sees is the
 * app server's, shared by every user. The proxy therefore sends the browser's
 * address in its own header, with a shared secret proving the header came from
 * the proxy. `trustedAuthRequest` (convex/auth.ts) keeps that address only
 * when the secret matches; a request that went around the proxy loses it and
 * lands in one shared bucket per path, so inventing addresses buys nothing.
 *
 * Limits are per address per path, so colleagues behind one office address
 * share them: ten sign-in attempts a minute is room for a busy morning and
 * still slows password guessing to a crawl.
 */

/** The browser's address, as the proxy saw it. */
export const AUTH_CLIENT_IP_HEADER = "x-banhall-client-ip";

/** The shared secret (AUTH_PROXY_SECRET) that vouches for the address. */
export const AUTH_PROXY_KEY_HEADER = "x-banhall-proxy-key";

/** Shortest secret treated as configured. */
export const MIN_AUTH_PROXY_SECRET_LENGTH = 32;

export type AuthRateLimitRule = { window: number; max: number } | false;

/**
 * Better Auth `rateLimit` options. Counts live in the Better Auth component's
 * `rateLimit` table ("database" storage), so every Convex isolate sees the
 * same count; the default "memory" store is per isolate and does nothing on
 * Convex. Session reads and the Convex token exchange run on every page and
 * tab, carry no password, and are left unlimited so they cost no writes.
 */
export const AUTH_RATE_LIMIT = {
  enabled: true,
  storage: "database" as const,
  window: 60,
  max: 300,
  customRules: {
    "/sign-in/email": { window: 60, max: 10 },
    "/sign-up/email": { window: 60, max: 5 },
    "/get-session": false,
    "/convex/*": false,
  } satisfies Record<string, AuthRateLimitRule>,
};

export function usableProxySecret(secret: string | undefined): string | undefined {
  const trimmed = secret?.trim();
  return trimmed && trimmed.length >= MIN_AUTH_PROXY_SECRET_LENGTH ? trimmed : undefined;
}

/** Comparison with no early exit on the first mismatched character. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The request Better Auth should see. With a configured secret the client
 * address header survives only when the proxy key matches; the key itself is
 * always removed. With no secret configured the address is taken as sent
 * (weaker: a caller that goes around the proxy can choose it), so set
 * AUTH_PROXY_SECRET on both the Convex deployment and the app.
 */
export function trustedAuthRequest(request: Request, secret: string | undefined): Request {
  const configured = usableProxySecret(secret);
  const presented = request.headers.get(AUTH_PROXY_KEY_HEADER);
  const keepAddress = configured === undefined || (presented !== null && sameSecret(presented, configured));
  if (presented === null && keepAddress) return request;
  const headers = new Headers(request.headers);
  headers.delete(AUTH_PROXY_KEY_HEADER);
  if (!keepAddress) headers.delete(AUTH_CLIENT_IP_HEADER);
  return new Request(request, { headers });
}
