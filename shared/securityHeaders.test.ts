import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  convexSources,
  cspDirectives,
  isShareTokenPath,
  securityHeaders,
  withSecurityHeaders,
} from "./securityHeaders";

// Security wave 1 (audit 2026-09-25, a2 P2-1, a4 #6).

const DEPLOYMENT = {
  convexUrl: "https://happy-otter-123.convex.cloud",
  convexSiteUrl: "https://happy-otter-123.convex.site",
};

describe("cspDirectives", () => {
  const production = cspDirectives({ ...DEPLOYMENT, dev: false });

  it("refuses framing, plugins and foreign form posts", () => {
    expect(production["frame-ancestors"]).toEqual(["none"]);
    expect(production["object-src"]).toEqual(["none"]);
    expect(production["base-uri"]).toEqual(["self"]);
    expect(production["form-action"]).toEqual(["self"]);
  });

  it("runs only same-origin scripts, never eval or inline script", () => {
    expect(production["script-src"]).toEqual(["self"]);
    const all = Object.values(production).flatMap((value) => (value === true ? [] : value));
    expect(all).not.toContain("unsafe-eval");
    expect(production["script-src"]).not.toContain("unsafe-inline");
  });

  it("connects only to this app and this Convex deployment", () => {
    expect(production["connect-src"]).toEqual([
      "self",
      "https://happy-otter-123.convex.cloud",
      "wss://happy-otter-123.convex.cloud",
      "https://happy-otter-123.convex.site",
    ]);
    expect(production["frame-src"]).toContain("https://happy-otter-123.convex.cloud");
  });

  it("upgrades insecure requests in production only", () => {
    expect(production["upgrade-insecure-requests"]).toBe(true);
    expect(cspDirectives({ ...DEPLOYMENT, dev: true })).not.toHaveProperty("upgrade-insecure-requests");
  });
});

describe("convexSources", () => {
  it("falls back to any Convex deployment when the build has placeholders or nothing", () => {
    for (const urls of [
      { convexUrl: "https://placeholder.convex.cloud", convexSiteUrl: "https://placeholder.convex.site" },
      { convexUrl: undefined, convexSiteUrl: undefined },
      { convexUrl: "not a url", convexSiteUrl: "" },
    ]) {
      expect(convexSources(urls.convexUrl, urls.convexSiteUrl)).toEqual({
        http: "https://*.convex.cloud",
        ws: "wss://*.convex.cloud",
        site: "https://*.convex.site",
      });
    }
  });

  it("uses a plain WebSocket for a local HTTP backend", () => {
    expect(convexSources("http://127.0.0.1:3210", "http://127.0.0.1:3211")).toEqual({
      http: "http://127.0.0.1:3210",
      ws: "ws://127.0.0.1:3210",
      site: "http://127.0.0.1:3211",
    });
  });
});

describe("securityHeaders", () => {
  it("sets the standard headers, with HSTS outside dev", () => {
    const headers = securityHeaders("/project/abc", { dev: false });
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);
    expect(securityHeaders("/project/abc", { dev: true })).not.toHaveProperty("Strict-Transport-Security");
  });

  it("sends no referrer from a share-token page", () => {
    expect(isShareTokenPath("/review/tok123")).toBe(true);
    expect(isShareTokenPath("/reviews")).toBe(false);
    expect(securityHeaders("/review/tok123", { dev: false })["Referrer-Policy"]).toBe("no-referrer");
  });
});

describe("withSecurityHeaders", () => {
  it("sets headers on an ordinary response", () => {
    const response = withSecurityHeaders(new Response("ok"), "/", { dev: false });
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("copies a response whose headers are read-only, keeping status, body and cookies", async () => {
    const original = Response.redirect("https://app.test/login", 302);
    expect(() => original.headers.set("x-test", "1")).toThrow();
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");
    const proxied = new Response('{"ok":true}', { status: 201, headers });
    Object.defineProperty(proxied, "headers", {
      value: new Proxy(proxied.headers, {
        get(target, prop, receiver) {
          if (prop === "set") {
            return () => {
              throw new TypeError("immutable");
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
    const result = withSecurityHeaders(proxied, "/api/auth/get-session", { dev: false });
    expect(result).not.toBe(proxied);
    expect(result.status).toBe(201);
    expect(await result.text()).toBe('{"ok":true}');
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
    expect(result.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });
});

describe("wiring", () => {
  it("passes the CSP to SvelteKit and the headers through the server hook", () => {
    const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(viteConfig).toMatch(/cspDirectives\(/);
    expect(viteConfig).toMatch(/^\s+csp,$/m);
    const hooks = readFileSync(new URL("../src/hooks.server.ts", import.meta.url), "utf8");
    expect(hooks).toMatch(/sequence\(authHandle, securityHeadersHandle\)/);
  });
});
