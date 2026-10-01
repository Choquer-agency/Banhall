/**
 * Browser security policy for the SvelteKit app (security wave 1, audit
 * 2026-09-25 a2 P2-1 and a4 #6). Two halves:
 *
 * - `cspDirectives` feeds SvelteKit's `csp` option (vite.config.ts), which adds
 *   a per-response nonce to its own scripts. It allows only what the app loads:
 *   its own origin, the Convex deployment (HTTPS queries, the WebSocket sync,
 *   stored-file URLs for previews) and the Convex site URL. Images may come
 *   from any HTTPS host because chat sources show site icons.
 * - `securityHeaders` is set on every response by the `handle` hook
 *   (src/hooks.server.ts).
 *
 * Pure so vite.config.ts, the hook and tests share one definition.
 */

export type CspSource = string;
export type CspDirectiveMap = Record<string, CspSource[] | true>;

/** Fallback when the build has no Convex URLs (typecheck, tests, previews). */
const CONVEX_WILDCARDS = {
  http: "https://*.convex.cloud",
  ws: "wss://*.convex.cloud",
  site: "https://*.convex.site",
};

function origin(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * The Convex origins the browser talks to. A real deployment URL narrows the
 * policy to that deployment; a missing or placeholder value falls back to any
 * Convex deployment so builds without the environment still load.
 */
export function convexSources(convexUrl: string | undefined, convexSiteUrl: string | undefined) {
  const cloud = origin(convexUrl);
  const site = origin(convexSiteUrl);
  const usable = (url: URL | null) => url !== null && !url.hostname.startsWith("placeholder.");
  return {
    http: usable(cloud) ? cloud!.origin : CONVEX_WILDCARDS.http,
    ws: usable(cloud)
      ? `${cloud!.protocol === "http:" ? "ws" : "wss"}://${cloud!.host}`
      : CONVEX_WILDCARDS.ws,
    site: usable(site) ? site!.origin : CONVEX_WILDCARDS.site,
  };
}

export function cspDirectives(options: {
  convexUrl: string | undefined;
  convexSiteUrl: string | undefined;
  dev: boolean;
}): CspDirectiveMap {
  const convex = convexSources(options.convexUrl, options.convexSiteUrl);
  return {
    "default-src": ["self"],
    // SvelteKit adds the nonce for its own scripts.
    "script-src": ["self"],
    // Svelte transitions, the editor and toasts set inline styles.
    "style-src": ["self", "unsafe-inline"],
    "img-src": ["self", "data:", "blob:", "https:"],
    "font-src": ["self", "data:"],
    "connect-src": ["self", convex.http, convex.ws, convex.site],
    // The spreadsheet and PDF readers run in same-origin workers.
    "worker-src": ["self", "blob:"],
    // The file preview shows stored PDFs from the Convex deployment.
    "frame-src": ["self", "blob:", convex.http],
    "frame-ancestors": ["none"],
    "object-src": ["none"],
    "base-uri": ["self"],
    "form-action": ["self"],
    // Local dev runs over plain HTTP (localhost, Tailscale addresses).
    ...(options.dev ? {} : { "upgrade-insecure-requests": true as const }),
  };
}

/** Pages whose address carries a client-review share token. */
export function isShareTokenPath(pathname: string): boolean {
  return pathname === "/review" || pathname.startsWith("/review/");
}

export function securityHeaders(pathname: string, options: { dev: boolean }): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    // Older browsers that ignore CSP frame-ancestors.
    "X-Frame-Options": "DENY",
    // A share-token page never sends its address (and the token) onward.
    "Referrer-Policy": isShareTokenPath(pathname) ? "no-referrer" : "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    // HSTS only means something over HTTPS; local dev is plain HTTP.
    ...(options.dev ? {} : { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" }),
  };
}

/**
 * The response with `securityHeaders` set. A response passed straight through
 * from fetch (the auth proxy) has read-only headers, so it is copied first.
 */
export function withSecurityHeaders(
  response: Response,
  pathname: string,
  options: { dev: boolean }
): Response {
  const headers = Object.entries(securityHeaders(pathname, options));
  try {
    for (const [name, value] of headers) response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
    for (const [name, value] of headers) copy.headers.set(name, value);
    return copy;
  }
}
