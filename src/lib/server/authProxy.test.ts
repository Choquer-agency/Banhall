import { describe, expect, it } from "vitest";
import { authProxyRequest } from "./authProxy";
import { AUTH_CLIENT_IP_HEADER, AUTH_PROXY_KEY_HEADER } from "../../../shared/authRateLimit";

// Security wave 1 (a2 P1-2, a4 #7): the auth proxy passes the browser's
// address and the secret that vouches for it, and nothing else new.

const SECRET = "k".repeat(40);

function browserRequest() {
  return new Request("https://banhall.test/api/auth/sign-in/email?x=1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.session_token=abc",
      origin: "https://banhall.test",
      "x-forwarded-for": "10.0.0.1",
      [AUTH_CLIENT_IP_HEADER]: "6.6.6.6",
      [AUTH_PROXY_KEY_HEADER]: "forged",
      "x-custom": "dropped",
    },
    body: JSON.stringify({ email: "a@b.c", password: "pw" }),
  });
}

describe("authProxyRequest", () => {
  it("targets the Convex site with the allowlisted headers, the address and the key", async () => {
    const proxied = authProxyRequest(browserRequest(), {
      convexSiteUrl: "https://happy-otter-123.convex.site",
      clientIp: "203.0.113.5",
      proxySecret: SECRET,
    });
    expect(proxied.url).toBe("https://happy-otter-123.convex.site/api/auth/sign-in/email?x=1");
    expect(proxied.method).toBe("POST");
    expect(proxied.headers.get("cookie")).toBe("better-auth.session_token=abc");
    expect(proxied.headers.get("origin")).toBe("https://banhall.test");
    expect(proxied.headers.get("x-forwarded-host")).toBe("banhall.test");
    expect(proxied.headers.get("x-better-auth-forwarded-proto")).toBe("https");
    expect(proxied.headers.get(AUTH_CLIENT_IP_HEADER)).toBe("203.0.113.5");
    expect(proxied.headers.get(AUTH_PROXY_KEY_HEADER)).toBe(SECRET);
    expect(proxied.headers.get("x-forwarded-for")).toBeNull();
    expect(proxied.headers.get("x-custom")).toBeNull();
    expect(await proxied.json()).toEqual({ email: "a@b.c", password: "pw" });
  });

  it("never forwards a browser-sent address or key", () => {
    const proxied = authProxyRequest(browserRequest(), {
      convexSiteUrl: "https://happy-otter-123.convex.site",
      clientIp: undefined,
      proxySecret: undefined,
    });
    expect(proxied.headers.get(AUTH_CLIENT_IP_HEADER)).toBeNull();
    expect(proxied.headers.get(AUTH_PROXY_KEY_HEADER)).toBeNull();
  });

  it("does not send a secret too short to count", () => {
    const proxied = authProxyRequest(browserRequest(), {
      convexSiteUrl: "https://happy-otter-123.convex.site",
      clientIp: "203.0.113.5",
      proxySecret: "short",
    });
    expect(proxied.headers.get(AUTH_PROXY_KEY_HEADER)).toBeNull();
  });
});
