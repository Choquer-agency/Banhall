import { describe, expect, it } from "vitest";
import {
  AUTH_CLIENT_IP_HEADER,
  AUTH_PROXY_KEY_HEADER,
  AUTH_RATE_LIMIT,
  authProxySecretProblem,
  isLocalSiteUrl,
  trustedAuthRequest,
} from "./authRateLimit";

const SECRET = "p".repeat(40);

function request(headers: Record<string, string>) {
  return new Request("https://x.convex.site/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
}

describe("trustedAuthRequest", () => {
  it("keeps the address and drops the key when the key matches", async () => {
    const out = trustedAuthRequest(
      request({ [AUTH_CLIENT_IP_HEADER]: "203.0.113.5", [AUTH_PROXY_KEY_HEADER]: SECRET }),
      SECRET
    );
    expect(out.headers.get(AUTH_CLIENT_IP_HEADER)).toBe("203.0.113.5");
    expect(out.headers.get(AUTH_PROXY_KEY_HEADER)).toBeNull();
    expect(await out.text()).toBe("{}");
  });

  it("drops the address when the key is missing or wrong", () => {
    for (const key of [undefined, "wrong", SECRET.slice(1)]) {
      const out = trustedAuthRequest(
        request({ [AUTH_CLIENT_IP_HEADER]: "203.0.113.5", ...(key ? { [AUTH_PROXY_KEY_HEADER]: key } : {}) }),
        SECRET
      );
      expect(out.headers.get(AUTH_CLIENT_IP_HEADER)).toBeNull();
    }
  });

  it("takes the address as sent while no usable secret is configured", () => {
    for (const secret of [undefined, "", "short"]) {
      const out = trustedAuthRequest(request({ [AUTH_CLIENT_IP_HEADER]: "203.0.113.5" }), secret);
      expect(out.headers.get(AUTH_CLIENT_IP_HEADER)).toBe("203.0.113.5");
    }
  });
});

describe("a production deployment without a usable secret (review r1 P2-1)", () => {
  it("drops the address as sent, so the limit is per path", () => {
    for (const secret of [undefined, "", "short"]) {
      const out = trustedAuthRequest(request({ [AUTH_CLIENT_IP_HEADER]: "203.0.113.5" }), secret, {
        requireSecret: true,
      });
      expect(out.headers.get(AUTH_CLIENT_IP_HEADER)).toBeNull();
    }
    // A usable secret still decides on its own.
    const proxied = trustedAuthRequest(
      request({ [AUTH_CLIENT_IP_HEADER]: "203.0.113.5", [AUTH_PROXY_KEY_HEADER]: SECRET }),
      SECRET,
      { requireSecret: true }
    );
    expect(proxied.headers.get(AUTH_CLIENT_IP_HEADER)).toBe("203.0.113.5");
  });

  it("reports a missing or short secret only outside local development, never its value", () => {
    expect(authProxySecretProblem(undefined, "https://banhall.vercel.app")).toMatch(/is not set/);
    expect(authProxySecretProblem("  ", "https://banhall.vercel.app")).toMatch(/is not set/);
    const short = authProxySecretProblem("short-secret-value", "https://banhall.vercel.app");
    expect(short).toMatch(/shorter than 32 characters/);
    expect(short).not.toContain("short-secret-value");
    expect(authProxySecretProblem(SECRET, "https://banhall.vercel.app")).toBeNull();
    for (const local of [undefined, "", "http://localhost:3001", "http://127.0.0.1:5173", "http://app.localhost", "http://[::1]:3001"]) {
      expect(isLocalSiteUrl(local), String(local)).toBe(true);
      expect(authProxySecretProblem(undefined, local)).toBeNull();
    }
    expect(isLocalSiteUrl("https://banhall.vercel.app")).toBe(false);
    expect(isLocalSiteUrl("https://localhost.example.com")).toBe(false);
  });
});

describe("AUTH_RATE_LIMIT", () => {
  it("stores counts in the database and limits password endpoints, not session reads", () => {
    expect(AUTH_RATE_LIMIT.enabled).toBe(true);
    expect(AUTH_RATE_LIMIT.storage).toBe("database");
    expect(AUTH_RATE_LIMIT.customRules["/sign-in/email"]).toEqual({ window: 60, max: 10 });
    expect(AUTH_RATE_LIMIT.customRules["/get-session"]).toBe(false);
    expect(AUTH_RATE_LIMIT.customRules["/convex/*"]).toBe(false);
  });
});
