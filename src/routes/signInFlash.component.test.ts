import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage } from "vitest/browser";
import { goto } from "$app/navigation";
import { tick } from "svelte";
import { render } from "vitest-browser-svelte";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { afterLoginPath } from "$lib/auth/next";
import RootPage from "./+page.svelte";
import DashboardPage from "./dashboard/+page.svelte";
import MyWorkPage from "./my-work/+page.svelte";

vi.mock("$app/navigation", { spy: true });

/**
 * 2026-09-28 owner report: signing in briefly showed the very old dashboard
 * before the round 2 Home. Sign-in (and the site root) landed on /dashboard,
 * whose gate mounted the current dashboard while the rollout decision loaded,
 * then soft-navigated to /my-work. Every step of the sequence after sign-in,
 * on a cold load, a reload and a sign-in from /login, must show only the
 * round 2 shell and Home or a neutral loading state.
 *
 * A MutationObserver records the legacy dashboard the moment any of its
 * markers enters the DOM, so a single transient frame fails the test.
 */
const LEGACY_SELECTOR = [
  '[data-dashboard-experience="current"]',
  'nav[aria-label="Dashboard view"]',
  'a[aria-label="Banhall dashboard"]',
].join(", ");

let legacySeen: string[] = [];
let observer: MutationObserver | null = null;

function watchForLegacy(step: string) {
  observer?.disconnect();
  const check = () => {
    if (document.querySelector(LEGACY_SELECTOR)) legacySeen.push(step);
  };
  observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  check();
}

const gotoUrls = () => vi.mocked(goto).mock.calls.map(([url]) => String(url));

function seedHome() {
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData("users:getCurrentUser", { _id: "u-1", firstName: "Audit", lastName: "Tester", email: "a@example.test" });
  __setQueryData("changelog:unseenCount", 0);
  __setQueryData("myWork:getContinueWorking", null);
  __setPaginatedRows("myWork:listAssignedToMe", []);
  __setPaginatedRows("dashboard:listFlatProjects", []);
}

/** Settles a few frames so any transient subtree would have mounted. */
async function frames(count = 4) {
  for (let i = 0; i < count; i += 1) {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
}

describe("after sign-in the legacy dashboard never renders", () => {
  beforeEach(async () => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    localStorage.clear();
    legacySeen = [];
    vi.mocked(goto).mockClear();
    vi.mocked(goto).mockResolvedValue(undefined);
    await browserPage.viewport(1440, 900);
  });

  afterEach(() => {
    observer?.disconnect();
    observer = null;
  });

  it("sign-in from /login lands on Home's canonical URL, not the /dashboard compatibility entry", () => {
    expect(afterLoginPath(new URLSearchParams())).toBe("/my-work");
  });

  it("the site root sends a signed-in visitor straight to /my-work", async () => {
    __setPageUrl("/");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    watchForLegacy("root");
    await render(RootPage);
    await frames();
    expect(gotoUrls()).toEqual([]);

    __setAuthState({ isLoading: false, isAuthenticated: true });
    await expect.poll(() => gotoUrls()).toEqual(["/my-work"]);
    await frames();
    expect(legacySeen).toEqual([]);
  });

  it("a cold load or reload of /my-work shows a neutral state, then Home, with nothing legacy in between", async () => {
    __setPageUrl("/my-work");
    // Session still resolving (the first frame of every full page load).
    __setAuthState({ isLoading: true, isAuthenticated: false });
    watchForLegacy("my-work");
    const screen = await render(MyWorkPage);
    screen.container.style.cssText = "display:flex;flex-direction:column;min-height:100vh;";
    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="auth"]')).not.toBeNull();

    // Session live, rollout decision still loading.
    __setAuthState({ isLoading: false, isAuthenticated: true });
    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="decision"]')).not.toBeNull();
    await frames();

    // Decision arrives: Home in the round 2 shell.
    seedHome();
    __setQueryData("workspaceRollout:getAccess", { available: true });
    await expect.poll(() => document.querySelector("[data-home]")).not.toBeNull();
    expect(document.querySelector("[data-workspace-shell]")).not.toBeNull();
    await frames();
    expect(gotoUrls()).toEqual([]);
    expect(legacySeen).toEqual([]);
  });

  it("/dashboard (old bookmarks, ?next=/dashboard) holds a neutral state and redirects to Home without mounting the old dashboard", async () => {
    __setPageUrl("/dashboard");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    watchForLegacy("dashboard");
    await render(DashboardPage);
    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="auth"]')).not.toBeNull();

    __setAuthState({ isLoading: false, isAuthenticated: true });
    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="decision"]')).not.toBeNull();
    await frames();
    expect(legacySeen).toEqual([]);

    __setQueryData("workspaceRollout:getAccess", { available: true });
    await expect.poll(() => gotoUrls()).toEqual(["/my-work"]);
    await frames();
    expect(legacySeen).toEqual([]);
  });
});
