import {
  AUTH_CLIENT_IP_HEADER,
  AUTH_PROXY_KEY_HEADER,
  usableProxySecret,
} from "../../../shared/authRateLimit";

/**
 * The Better Auth proxy request (src/routes/api/auth/[...all]/+server.ts).
 * Same forwarding as `createSvelteKitHandler` from
 * @mmailaender/convex-better-auth-svelte 0.8 (an allowlist of the browser's
 * headers plus the forwarded host and protocol), with two additions for the
 * sign-in rate limit (shared/authRateLimit.ts): the browser's address, and
 * the proxy secret that vouches for it.
 */

const FORWARDED_HEADERS = new Set([
  "accept",
  "authorization",
  "better-auth-cookie",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
]);

export function authProxyRequest(
  request: Request,
  options: { convexSiteUrl: string; clientIp: string | undefined; proxySecret: string | undefined }
): Request {
  const requestUrl = new URL(request.url);
  const nextUrl = `${options.convexSiteUrl}${requestUrl.pathname}${requestUrl.search}`;
  const headers = new Headers();
  for (const [name, value] of request.headers.entries()) {
    if (FORWARDED_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  headers.set("host", new URL(nextUrl).host);
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", requestUrl.protocol.replace(/:$/, ""));
  headers.set("x-better-auth-forwarded-host", requestUrl.host);
  headers.set("x-better-auth-forwarded-proto", requestUrl.protocol.replace(/:$/, ""));
  headers.set("accept-encoding", "identity");
  if (options.clientIp) headers.set(AUTH_CLIENT_IP_HEADER, options.clientIp);
  const secret = usableProxySecret(options.proxySecret);
  if (secret) headers.set(AUTH_PROXY_KEY_HEADER, secret);

  const proxied = new Request(nextUrl, request);
  for (const name of [...proxied.headers.keys()]) proxied.headers.delete(name);
  for (const [name, value] of headers.entries()) proxied.headers.set(name, value);
  return proxied;
}
