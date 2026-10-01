/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { components } from "./_generated/api";
import schema from "./schema";
import {
  AUTH_CLIENT_IP_HEADER,
  AUTH_PROXY_KEY_HEADER,
  AUTH_RATE_LIMIT,
} from "../shared/authRateLimit";

const modules = import.meta.glob("./**/*.ts");

// Security wave 1 (audit 2026-09-25, a2 P1-2, a4 #7). These go through the
// real stack: convex/http.ts's auth routes, Better Auth, the Convex adapter
// and the Better Auth component's rateLimit table, the way the SvelteKit
// proxy calls them.

const SECRET = "s".repeat(40);
const SIGN_IN_MAX = (AUTH_RATE_LIMIT.customRules["/sign-in/email"] as { max: number }).max;

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://app.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "b".repeat(40));
  vi.stubEnv("AUTH_PROXY_SECRET", "");
});

function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
}

async function rateLimitKeys(t: ReturnType<typeof setup>): Promise<string[]> {
  const page = (await t.run((ctx) =>
    ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "rateLimit",
      paginationOpts: { numItems: 100, cursor: null },
    })
  )) as { page: Array<{ key: string }> };
  return page.page.map((row) => row.key);
}

async function signIn(
  t: ReturnType<typeof setup>,
  headers: Record<string, string>
): Promise<number> {
  const response = await t.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: process.env.SITE_URL!, ...headers },
    body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password-123" }),
  });
  return response.status;
}

describe("sign-in rate limit", () => {
  it("refuses a browser address past the limit and leaves other addresses alone", async () => {
    // Local development: no secret, and the address is taken as sent.
    vi.stubEnv("SITE_URL", "http://localhost:3001");
    const t = setup();
    const office = { [AUTH_CLIENT_IP_HEADER]: "203.0.113.5" };
    for (let i = 0; i < SIGN_IN_MAX; i += 1) expect(await signIn(t, office)).toBe(401);
    expect(await signIn(t, office)).toBe(429);
    expect(await signIn(t, { [AUTH_CLIENT_IP_HEADER]: "198.51.100.7" })).toBe(401);
  });

  it("ignores the address header without the proxy's key once a secret is set", async () => {
    vi.stubEnv("AUTH_PROXY_SECRET", SECRET);
    const t = setup();
    // A caller going around the proxy invents a new address each time: all
    // of them count against one shared bucket.
    for (let i = 0; i < SIGN_IN_MAX; i += 1) {
      expect(await signIn(t, { [AUTH_CLIENT_IP_HEADER]: `192.0.2.${i + 1}` })).toBe(401);
    }
    expect(await signIn(t, { [AUTH_CLIENT_IP_HEADER]: "192.0.2.200" })).toBe(429);
    expect(
      await signIn(t, { [AUTH_CLIENT_IP_HEADER]: "192.0.2.201", [AUTH_PROXY_KEY_HEADER]: "wrong".padEnd(40, "x") })
    ).toBe(429);
    // Through the proxy (the right key), each address has its own count.
    expect(
      await signIn(t, { [AUTH_CLIENT_IP_HEADER]: "203.0.113.5", [AUTH_PROXY_KEY_HEADER]: SECRET })
    ).toBe(401);
  });

  // Review r1 P2-1 / r2 P2-4 (2026-09-25): with no secret on a production
  // deployment a caller could invent an address per request. Now every
  // request there shares one count per path, and each one logs an error.
  it("shares one count per path and logs an error on production without a usable secret", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const secret of ["", "too-short-secret"]) {
        vi.stubEnv("AUTH_PROXY_SECRET", secret);
        errors.mockClear();
        const t = setup();
        for (let i = 0; i < SIGN_IN_MAX; i += 1) {
          expect(await signIn(t, { [AUTH_CLIENT_IP_HEADER]: `192.0.2.${i + 1}` })).toBe(401);
        }
        expect(await signIn(t, { [AUTH_CLIENT_IP_HEADER]: "192.0.2.200" })).toBe(429);
        // Other paths keep their own count.
        const signUp = await t.fetch("/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://app.test" },
          body: JSON.stringify({ email: "new@example.com", password: "long-enough-password", name: "N" }),
        });
        expect(signUp.status).not.toBe(429);
        const logged = errors.mock.calls.map((call) => String(call[0]));
        const proxyErrors = logged.filter((line) => line.includes("AUTH_PROXY_SECRET"));
        expect(proxyErrors.length).toBeGreaterThanOrEqual(SIGN_IN_MAX + 2);
        for (const line of proxyErrors) {
          if (secret) expect(line).not.toContain(secret);
        }
      }
    } finally {
      errors.mockRestore();
    }
  });

  it("logs nothing about the secret in local development or once it is set", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.stubEnv("AUTH_PROXY_SECRET", SECRET);
      await signIn(setup(), {});
      vi.stubEnv("AUTH_PROXY_SECRET", "");
      vi.stubEnv("SITE_URL", "http://localhost:3001");
      await signIn(setup(), {});
      const logged = errors.mock.calls.map((call) => String(call[0]));
      expect(logged.filter((line) => line.includes("AUTH_PROXY_SECRET"))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it("never counts session reads", async () => {
    vi.stubEnv("SITE_URL", "http://localhost:3001");
    const t = setup();
    for (let i = 0; i < 30; i += 1) {
      const response = await t.fetch("/api/auth/get-session", {
        headers: { origin: process.env.SITE_URL!, [AUTH_CLIENT_IP_HEADER]: "203.0.113.5" },
      });
      expect(response.status).toBe(200);
    }
    expect(await rateLimitKeys(t)).toEqual([]);
    await signIn(t, { [AUTH_CLIENT_IP_HEADER]: "203.0.113.5" });
    // The count lives in the component's table, keyed by address and path.
    const keys = await rateLimitKeys(t);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("203.0.113.5");
    expect(keys[0]).toContain("/sign-in/email");
  });
});
