import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ConvexClient } from "convex/browser";
import RealAuthGuardHarness from "$lib/test/RealAuthGuardHarness.svelte";
import { reactiveValue } from "$lib/test/reactiveValue.svelte";

/**
 * A full page load after the 15-minute Convex JWT cookie lapsed, with the
 * 7-day session cookie still valid. The root layout's server state
 * (serverAuthState in src/lib/server/auth.ts, unit-tested for each cookie
 * state) is fed to the real convex-svelte auth state machine, and the page
 * guard must not redirect until the session check has settled.
 */
function setup(serverState: { isAuthenticated: boolean } | undefined) {
  const onChanges: Array<(authenticated: boolean) => void> = [];
  const client = {
    setAuth: vi.fn((_fetch: unknown, onChange?: (authenticated: boolean) => void) => {
      if (onChange) onChanges.push(onChange);
    }),
    clearAuth: vi.fn(),
  } as unknown as ConvexClient;
  // Better Auth's session starts pending on every full page load.
  const session = reactiveValue({ isLoading: true, isAuthenticated: false });
  const onRedirect = vi.fn();
  render(RealAuthGuardHarness, {
    client,
    provider: () => ({ ...session.value, fetchAccessToken: async () => "fresh-jwt" }),
    getServerState: () => serverState,
    onRedirect,
  });
  const harness = () => document.querySelector<HTMLElement>("[data-auth-harness]")!;
  return { client, session, onRedirect, onChanges, harness };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("root layout auth state on a full page load", () => {
  it("waits for the session check when only the JWT has expired, then stays on the page", async () => {
    // Session cookie only: serverAuthState returns undefined.
    const { client, session, onRedirect, onChanges, harness } = setup(undefined);
    await expect.poll(() => harness()?.dataset.loading).toBe("true");
    await settle();
    expect(onRedirect).not.toHaveBeenCalled();

    // The session loads and the client fetches a fresh Convex JWT.
    session.value = { isLoading: false, isAuthenticated: true };
    await expect.poll(() => vi.mocked(client.setAuth).mock.calls.length).toBeGreaterThan(0);
    onChanges.at(-1)!(true);
    await expect.poll(() => harness().dataset.authenticated).toBe("true");
    expect(harness().dataset.loading).toBe("false");
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it("redirects once the session check finds no valid session", async () => {
    // A session cookie the backend no longer accepts (revoked or replaced).
    const { session, onRedirect, harness } = setup(undefined);
    await expect.poll(() => harness()?.dataset.loading).toBe("true");
    session.value = { isLoading: false, isAuthenticated: false };
    await expect.poll(() => onRedirect.mock.calls.length).toBeGreaterThan(0);
  });

  it("redirects at once when the server says signed out (no session cookie)", async () => {
    // This is also what every lapsed-JWT load did before the fix.
    const { onRedirect, harness } = setup({ isAuthenticated: false });
    await expect.poll(() => onRedirect.mock.calls.length).toBeGreaterThan(0);
    expect(harness().dataset.loading).toBe("false");
  });
});
