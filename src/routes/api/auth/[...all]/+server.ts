import { env } from "$env/dynamic/private";
import { PUBLIC_CONVEX_SITE_URL } from "$env/static/public";
import type { RequestHandler } from "@sveltejs/kit";
import { authProxyRequest } from "$lib/server/authProxy";

// Proxies all Better Auth requests (sign-in/up/out, session, convex/token)
// to the Convex deployment's auth routes (convex/http.ts registerRoutes),
// keeping auth cookies first-party on the app origin. It also passes the
// browser's address and the AUTH_PROXY_SECRET that vouches for it, so the
// sign-in rate limit counts per browser address (shared/authRateLimit.ts).
const proxy: RequestHandler = async (event) => {
  if (!PUBLIC_CONVEX_SITE_URL) {
    throw new Error("PUBLIC_CONVEX_SITE_URL environment variable is not set");
  }
  let clientIp: string | undefined;
  try {
    clientIp = event.getClientAddress();
  } catch {
    clientIp = undefined;
  }
  const request = authProxyRequest(event.request, {
    convexSiteUrl: PUBLIC_CONVEX_SITE_URL,
    clientIp,
    proxySecret: env.AUTH_PROXY_SECRET,
  });
  return fetch(request, { method: event.request.method, redirect: "manual" });
};

export const GET = proxy;
export const POST = proxy;
