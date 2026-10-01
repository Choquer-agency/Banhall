import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";

const scoped = vi.hoisted(() => ({ tokens: [] as Array<string | undefined> }));

vi.mock("convex-svelte/sveltekit/server", () => ({
  withServerConvexToken: (token: string | undefined, fn: () => unknown) => {
    scoped.tokens.push(token);
    return fn();
  },
}));

import { createAuthHandle, readConvexJwt, serverAuthState } from "./auth";

function jar(values: Record<string, string>) {
  return { get: (name: string) => values[name] };
}

async function runHandle(prefix: string | undefined, cookies: Record<string, string>) {
  const event = { cookies: jar(cookies), locals: {} } as unknown as RequestEvent;
  const response = new Response("ok");
  const resolve = vi.fn(async () => response);
  const handle = createAuthHandle(() => prefix);
  const result = await handle({ event, resolve });
  expect(resolve).toHaveBeenCalledWith(event);
  expect(result).toBe(response);
  return event.locals.token;
}

describe("hooks.server auth handle", () => {
  beforeEach(() => {
    scoped.tokens.length = 0;
  });

  it("reads the default Convex JWT cookie when no prefix is set", async () => {
    expect(await runHandle(undefined, { "better-auth.convex_jwt": "jwt-default" })).toBe("jwt-default");
    expect(await runHandle(undefined, { "__Secure-better-auth.convex_jwt": "jwt-secure" })).toBe("jwt-secure");
    // The token is also scoped for SSR loads.
    expect(scoped.tokens).toEqual(["jwt-default", "jwt-secure"]);
  });

  it("reads the prefixed cookie and ignores another local app's cookies", async () => {
    const cookies = {
      // Another app on localhost (default names) and this app (banhall-e2e).
      "better-auth.convex_jwt": "jwt-other-app",
      "banhall-demo.convex_jwt": "jwt-demo",
      "banhall-e2e.convex_jwt": "jwt-e2e",
    };
    expect(await runHandle("banhall-e2e", cookies)).toBe("jwt-e2e");
    expect(await runHandle("banhall-demo", cookies)).toBe("jwt-demo");
    expect(await runHandle("banhall-e2e", { "better-auth.convex_jwt": "jwt-other-app" })).toBeUndefined();
    expect(scoped.tokens).toEqual(["jwt-e2e", "jwt-demo", undefined]);
  });

  it("never treats the session cookie as a Convex JWT", () => {
    expect(readConvexJwt(jar({ "better-auth.session_token": "session" }), undefined)).toBeUndefined();
  });
});

/**
 * The first client decision on a full page load, from the cookies the browser
 * sends. Mirrors the cookie states in the 2026-09-25 sign-out report
 * (signout-repro.mjs baseline, jwtexpiry, crossport).
 *
 * - "signed-in": server state says authenticated; the page renders.
 * - "wait": no server state; the client starts in its session check
 *   (isLoading) and fetches a fresh JWT, so the page guards do not redirect.
 * - "signed-out": server state says signed out; the page guards redirect to
 *   /login at once.
 */
function firstDecision(prefix: string | undefined, cookies: Record<string, string>) {
  const reader = jar(cookies);
  const state = serverAuthState({ token: readConvexJwt(reader, prefix), cookies: reader, prefix });
  if (state === undefined) return "wait";
  return state.isAuthenticated ? "signed-in" : "signed-out";
}

describe("server auth state for a full page load", () => {
  it("is signed in while the 15-minute Convex JWT cookie is present", () => {
    expect(
      firstDecision(undefined, { "better-auth.session_token": "s", "better-auth.convex_jwt": "j" }),
    ).toBe("signed-in");
    expect(serverAuthState({ token: "j", cookies: jar({}), prefix: undefined })).toEqual({ isAuthenticated: true });
  });

  it("waits for the client refresh when only the JWT has expired", () => {
    // jwtexpiry: convex_jwt gone, 7-day session still there. Before the fix
    // this rendered as signed out and bounced through /login.
    expect(firstDecision(undefined, { "better-auth.session_token": "s" })).toBe("wait");
    expect(firstDecision(undefined, { "__Secure-better-auth.session_token": "s" })).toBe("wait");
    expect(firstDecision("banhall-e2e", { "banhall-e2e.session_token": "s" })).toBe("wait");
  });

  it("is signed out with no session cookie at all", () => {
    expect(firstDecision(undefined, {})).toBe("signed-out");
    expect(firstDecision("banhall-e2e", {})).toBe("signed-out");
  });

  it("does not wait on another local app's session cookie", () => {
    // Only the cookies named for this deployment count.
    expect(firstDecision("banhall-e2e", { "banhall-demo.session_token": "s" })).toBe("signed-out");
    expect(firstDecision("banhall-e2e", { "better-auth.session_token": "s" })).toBe("signed-out");
    expect(firstDecision(undefined, { "banhall-e2e.session_token": "s" })).toBe("signed-out");
  });
});
