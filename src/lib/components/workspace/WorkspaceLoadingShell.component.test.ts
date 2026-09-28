import { beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage } from "vitest/browser";
import { createRawSnippet } from "svelte";
import { render } from "vitest-browser-svelte";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub } from "$lib/test/convex-svelte-stub.svelte";
import MyWorkPage from "../../../routes/my-work/+page.svelte";
import ProjectsPage from "../../../routes/projects/+page.svelte";
import SettingsLayout from "../../../routes/settings/+layout.svelte";
import AccountPage from "../../../routes/settings/account/+page.svelte";

vi.mock("$lib/authClient", () => ({
  authClient: {
    signOut: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ data: [], error: null })),
    getSession: vi.fn(async () => ({ data: null, error: null })),
  },
}));

/**
 * Lead direction 2026-09-28: while a round 2 page loads (the session check,
 * the rollout decision, the page's own first data), the rail and a top bar
 * render at once and the panel shows a quiet skeleton of the page's layout.
 * Never a lone centred spinner or "Loading" text.
 */
const spinner = () => document.querySelector(".animate-spin");
const rail = () => document.querySelector<HTMLElement>('#workspace-rail nav[aria-label="Workspace"]');
const topBarTitle = () => document.querySelector<HTMLElement>("[data-workspace-page-header] h1")?.textContent?.trim();
const skeleton = (layout: string) => document.querySelector<HTMLElement>(`[data-panel-skeleton="${layout}"]`);
const child = createRawSnippet(() => ({ render: () => "<p data-settings-child>Section</p>" }));

function expectQuietSkeleton(layout: string, minRows: number) {
  const panel = skeleton(layout)!;
  expect(panel).not.toBeNull();
  expect(panel.getAttribute("role")).toBe("status");
  expect(panel.querySelectorAll("[data-skeleton-row]").length).toBeGreaterThanOrEqual(minRows);
  // No words: screen readers get the label, sighted users the page's shape.
  expect(panel.textContent?.trim()).toBe("");
  expect(spinner()).toBeNull();
  expect(document.body.textContent).not.toMatch(/Loading/);
}

describe("round 2 loading shell", () => {
  beforeEach(async () => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    localStorage.clear();
    await browserPage.viewport(1440, 900);
  });

  it("Home: the rail and the Home top bar at once, table rows in the panel, during the session check and the decision", async () => {
    __setPageUrl("/my-work");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    await render(MyWorkPage, {});

    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="auth"]')).not.toBeNull();
    expect(rail()).not.toBeNull();
    expect(rail()!.querySelector('[data-rail-item="home"]')?.getAttribute("aria-current")).toBe("page");
    expect(topBarTitle()).toBe("Home");
    expect(document.querySelector("[data-workspace-page-header] [data-page-icon-tile]")).not.toBeNull();
    expectQuietSkeleton("home", 5);
    expect(skeleton("home")!.getAttribute("aria-label")).toBe("Checking your session");
    // The rail's collapse control already sits in the top bar.
    expect(document.querySelector("[data-workspace-page-header] [data-rail-toggle]")).not.toBeNull();

    __setAuthState({ isLoading: false, isAuthenticated: true });
    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="decision"]')).not.toBeNull();
    expect(rail()).not.toBeNull();
    expectQuietSkeleton("home", 5);
    expect(skeleton("home")!.getAttribute("aria-label")).toBe("Loading workspace");
  });

  it("Projects: the Projects bar and list rows while the decision loads", async () => {
    __setPageUrl("/projects");
    await render(ProjectsPage, {});

    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="decision"]')).not.toBeNull();
    expect(rail()!.querySelector('[data-rail-item="projects"]')?.getAttribute("aria-current")).toBe("page");
    expect(topBarTitle()).toBe("Projects");
    expect(getComputedStyle(document.querySelector("[data-workspace-page-header] h1")!).fontWeight).toBe("500");
    expectQuietSkeleton("projects", 6);
  });

  it("Settings: the Settings bar and form blocks capped at 40rem while the session loads", async () => {
    __setPageUrl("/settings/account");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    await browserPage.viewport(2560, 1440);
    await render(SettingsLayout, { children: child });

    await expect.poll(() => skeleton("form")).not.toBeNull();
    expect(rail()).not.toBeNull();
    expect(topBarTitle()).toBe("Settings");
    expectQuietSkeleton("form", 4);
    for (const field of skeleton("form")!.querySelectorAll<HTMLElement>("[data-skeleton-field]")) {
      expect(field.getBoundingClientRect().width).toBeLessThanOrEqual(640);
    }
  });

  it("Settings tab content: field blocks, not a spinner, while the account loads", async () => {
    await render(AccountPage, {});
    await expect.poll(() => skeleton("fields")).not.toBeNull();
    expectQuietSkeleton("fields", 4);
    expect(skeleton("fields")!.getAttribute("aria-label")).toBe("Loading your account");
  });

  it("a signed-out visitor on the way to sign in gets the plain canvas, no workspace", async () => {
    __setPageUrl("/my-work");
    __setAuthState({ isLoading: false, isAuthenticated: false });
    await render(MyWorkPage, {});

    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="redirect"]')).not.toBeNull();
    expect(rail()).toBeNull();
    expect(spinner()).toBeNull();
  });
});
