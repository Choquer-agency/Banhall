import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";

const scoped = vi.hoisted(() => ({ tokens: [] as Array<string | undefined> }));

vi.mock("convex-svelte/sveltekit/server", () => ({
  withServerConvexToken: (token: string | undefined, fn: () => unknown) => {
    scoped.tokens.push(token);
    return fn();
  },
}));

import { createAuthHandle, readConvexJwt } from "./auth";

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
