import { describe, expect, it } from "vitest";
import {
  AUTH_COOKIE_PREFIX_ENV,
  DEFAULT_AUTH_COOKIE_PREFIX,
  authCookieNames,
  customAuthCookiePrefix,
  readFirstCookie,
  resolveAuthCookiePrefix,
} from "./authCookies";

function jar(values: Record<string, string>) {
  return { get: (name: string) => values[name] };
}

describe("auth cookie names", () => {
  it("keeps Better Auth's default names when the prefix is unset", () => {
    // Production leaves BETTER_AUTH_COOKIE_PREFIX unset. These are the exact
    // names Better Auth and @convex-dev/better-auth write today, so a deploy
    // must not change them or everyone is signed out.
    expect(authCookieNames(undefined)).toEqual({
      sessionToken: ["__Secure-better-auth.session_token", "better-auth.session_token"],
      convexJwt: ["__Secure-better-auth.convex_jwt", "better-auth.convex_jwt"],
    });
    expect(DEFAULT_AUTH_COOKIE_PREFIX).toBe("better-auth");
    expect(AUTH_COOKIE_PREFIX_ENV).toBe("BETTER_AUTH_COOKIE_PREFIX");
  });

  it("passes no custom prefix to Better Auth on the default path", () => {
    // convex/auth.ts only adds `advanced.cookiePrefix` for a custom value, so
    // an unset, blank, invalid or explicit default value leaves the config
    // exactly as it was before this setting existed.
    for (const raw of [undefined, null, "", "   ", "better-auth", " better-auth "]) {
      expect(customAuthCookiePrefix(raw)).toBeUndefined();
      expect(resolveAuthCookiePrefix(raw)).toBe("better-auth");
    }
  });

  it("names both cookies after a custom per-deployment prefix", () => {
    expect(customAuthCookiePrefix("banhall-e2e")).toBe("banhall-e2e");
    expect(authCookieNames("banhall-e2e")).toEqual({
      sessionToken: ["__Secure-banhall-e2e.session_token", "banhall-e2e.session_token"],
      convexJwt: ["__Secure-banhall-e2e.convex_jwt", "banhall-e2e.convex_jwt"],
    });
    expect(authCookieNames(" banhall-demo ").convexJwt).toEqual([
      "__Secure-banhall-demo.convex_jwt",
      "banhall-demo.convex_jwt",
    ]);
  });

  it("ignores values that are not a safe cookie-name prefix", () => {
    // Both runtimes resolve the same value, so an ignored value still gives
    // matching names on the Convex side and the SvelteKit side.
    for (const raw of ["banhall e2e", "__Secure-x", "__Host-x", "-lead", "a;b", "a=b", "x".repeat(65)]) {
      expect(customAuthCookiePrefix(raw)).toBeUndefined();
      expect(authCookieNames(raw)).toEqual(authCookieNames(undefined));
    }
  });

  it("reads the first non-empty cookie in order", () => {
    const names = authCookieNames("banhall-e2e").convexJwt;
    expect(readFirstCookie(jar({ "banhall-e2e.convex_jwt": "plain" }), names)).toBe("plain");
    expect(
      readFirstCookie(jar({ "__Secure-banhall-e2e.convex_jwt": "secure", "banhall-e2e.convex_jwt": "plain" }), names),
    ).toBe("secure");
    expect(readFirstCookie(jar({ "__Secure-banhall-e2e.convex_jwt": "", "banhall-e2e.convex_jwt": "plain" }), names)).toBe(
      "plain",
    );
    expect(readFirstCookie(jar({ "better-auth.convex_jwt": "other app" }), names)).toBeUndefined();
  });
});
