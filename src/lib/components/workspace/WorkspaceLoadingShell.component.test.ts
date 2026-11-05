import { beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage } from "vitest/browser";
import { createRawSnippet } from "svelte";
import { render } from "vitest-browser-svelte";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import MyWorkPage from "../../../routes/my-work/+page.svelte";
import ProjectsPage from "../../../routes/projects/+page.svelte";
import SettingsLayout from "../../../routes/settings/+layout.svelte";
import AccountPage from "../../../routes/settings/account/+page.svelte";
import CompaniesRoute from "../../../routes/companies/[[key]]/+page.svelte";
import LoadingShell from "./WorkspaceLoadingShell.svelte";
import { board } from "$lib/test/boardScale";
import { reloadSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";

vi.mock("$lib/authClient", () => ({
  authClient: {
    signOut: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ data: [], error: null })),
    getSession: vi.fn(async () => ({ data: null, error: null })),
  },
}));

/**
 * Lead direction 2026-09-28, in the page frame of 2026-10-28: while a page
 * loads (the session check, the rollout decision, the page's own first data),
 * the global bar, the rail, the card with the page's section sidebar and its
 * top bar render at once, and the rest shows a quiet skeleton of the page's
 * layout. Never a lone centred spinner or "Loading" text.
 */
const spinner = () => document.querySelector(".animate-spin");
const rail = () => document.querySelector<HTMLElement>('[data-frame-rail]');
const sidebar = (section: string) => document.querySelector<HTMLElement>(`[data-section-sidebar="${section}"]`);
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
    reloadSectionSidebar();
    await browserPage.viewport(1440, 900);
  });

  it("Home: the rail, the Projects sidebar with Home marked and the Home top bar at once, table rows in the card, during the session check and the decision", async () => {
    __setPageUrl("/my-work");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    await render(MyWorkPage, {});

    await expect.poll(() => document.querySelector('[data-workspace-gate-pending="auth"]')).not.toBeNull();
    expect(rail()).not.toBeNull();
    expect(document.querySelector("[data-global-bar]")).not.toBeNull();
    // Home sits under Projects on the rail, and is the sidebar's marked row.
    expect(rail()!.querySelector('[data-rail-item="projects"]')?.getAttribute("aria-current")).toBe("page");
    expect(sidebar("projects")!.querySelector("[data-projects-sidebar-home]")?.getAttribute("aria-current")).toBe("page");
    expect(topBarTitle()).toBe("Home");
    // The standard top bar (2026-10-19) draws no page tile.
    expect(document.querySelector("[data-workspace-page-header] [data-page-icon-tile]")).toBeNull();
    expectQuietSkeleton("home", 5);
    expect(skeleton("home")!.getAttribute("aria-label")).toBe("Checking your session");
    // The sidebar's collapse button is there from the first frame.
    expect(sidebar("projects")!.querySelector("[data-section-sidebar-toggle]")).not.toBeNull();

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
    expect(sidebar("projects")!.querySelector('[data-client-row="all"]')?.getAttribute("aria-current")).toBe("page");
    expect(topBarTitle()).toBe("Projects");
    // From 768px the company header loads as the page draws it: "All projects"
    // and the 300px search, so nothing is replaced when the page arrives.
    const header = document.querySelector<HTMLElement>("[data-client-header][data-loading]")!;
    expect(header.querySelector("h1")?.textContent).toBe("All projects");
    expect(header.querySelector<HTMLInputElement>('input[type="search"]')!.disabled).toBe(true);
    // The 64px board header, at the laptop root.
    expect(header.getBoundingClientRect().height).toBeCloseTo(board(64), 0);
    expect(getComputedStyle(document.querySelector("[data-workspace-page-header] h1")!).fontWeight).toBe("500");
    expectQuietSkeleton("projects", 6);
  });

  it("Settings: the Settings sidebar, the section's bar and form blocks capped at 40rem while the session loads", async () => {
    __setPageUrl("/settings/account");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    await browserPage.viewport(2560, 1440);
    await render(SettingsLayout, { children: child });

    await expect.poll(() => skeleton("form")).not.toBeNull();
    expect(rail()).not.toBeNull();
    // The bar names the section from the address, as the loaded page does.
    expect(topBarTitle()).toBe("Account");
    expect(sidebar("settings")!.querySelector('[data-settings-sidebar="account"]')?.getAttribute("aria-current")).toBe("page");
    expectQuietSkeleton("form", 4);
    // 40rem: 640px at a 16px root, 800px at 2560 where the root is 20px.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    for (const field of skeleton("form")!.querySelectorAll<HTMLElement>("[data-skeleton-field]")) {
      expect(field.getBoundingClientRect().width).toBeLessThanOrEqual(40 * rem);
    }
  });

  it("Settings tab content: field blocks, not a spinner, while the account loads", async () => {
    await render(AccountPage, {});
    await expect.poll(() => skeleton("fields")).not.toBeNull();
    expectQuietSkeleton("fields", 4);
    expect(skeleton("fields")!.getAttribute("aria-label")).toBe("Loading your account");
  });

  it("Companies (2026-10-28): All companies loads with the Companies sidebar, New company in its place and the table's rows", async () => {
    __setAuthState({ isLoading: true, isAuthenticated: false });
    __setQueryData("users:getCurrentUser", { _id: "c", role: "writer", firstName: "Jane" });
    __setPageUrl("/companies");
    await render(CompaniesRoute);
    await expect.poll(() => sidebar("companies")).not.toBeNull();
    expect(rail()).not.toBeNull();
    expect(topBarTitle()).toBe("Companies");
    expectQuietSkeleton("companies", 4);
    const action = sidebar("companies")!.querySelector<HTMLButtonElement>("[data-section-sidebar-action]");
    // The viewer is not known during the session check: no New company yet.
    expect(action).toBeNull();
    expect(sidebar("companies")!.querySelector("[data-client-skeleton]")).not.toBeNull();
    expect(document.querySelector('[data-rail-item="companies"]')?.getAttribute("aria-current")).toBe("page");
  });

  it("Companies: once the viewer is known, New company is drawn but not usable; a company's page holds its name's place", async () => {
    __setAuthState({ isLoading: false, isAuthenticated: true });
    __setQueryData("users:getCurrentUser", { _id: "c", role: "writer", firstName: "Jane" });
    __setPageUrl("/companies");
    const list = await render(LoadingShell, { layout: "companies", title: "Companies" });
    await expect.poll(() => sidebar("companies")?.querySelector("[data-section-sidebar-action]")).not.toBeNull();
    const action = sidebar("companies")!.querySelector<HTMLButtonElement>("[data-section-sidebar-action]")!;
    expect([action.textContent?.trim(), action.disabled]).toEqual(["New company", true]);
    list.unmount();

    __setPageUrl("/companies/cedarline%20systems");
    __setPageParams({ key: "cedarline systems" });
    await render(LoadingShell, { layout: "company", title: "Companies" });
    await expect.poll(() => skeleton("company")).not.toBeNull();
    expect(document.querySelector("[data-page-title-pending]")).not.toBeNull();
    expect(document.querySelector("[data-workspace-page-header] h1")).toBeNull();
    const newProject = document.querySelector<HTMLButtonElement>("[data-top-bar-primary]")!;
    expect([newProject.textContent?.trim(), newProject.disabled]).toEqual(["New project", true]);
    expect(getComputedStyle(newProject).display).not.toBe("none");
    // 2026-11-04: a company's page has no sidebar; the bar reads "Companies /".
    expect(sidebar("companies")).toBeNull();
    expect(document.querySelector("[data-workspace-page-header]")?.textContent).toContain("Companies");
  });

  it("Admin and Team load with no sidebar until the viewer is known to be allowed (review round 1, findings 1 and 6)", async () => {
    __setAuthState({ isLoading: false, isAuthenticated: true });
    __setPageUrl("/admin/house-rules");
    const first = await render(LoadingShell, { layout: "page", title: "House rules" });
    await expect.poll(() => skeleton("page")).not.toBeNull();
    expect(document.querySelector("[data-section-sidebar]")).toBeNull();
    first.unmount();
    __setQueryData("users:getCurrentUser", { _id: "c", role: "writer", firstName: "Jane" });
    const consultant = await render(LoadingShell, { layout: "page", title: "House rules" });
    await expect.poll(() => skeleton("page")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-section-sidebar]")).toBeNull();
    consultant.unmount();
    // A Manager on Team: the sidebar with Invite people in its place, not usable yet.
    __setQueryData("users:getCurrentUser", { _id: "m", role: "manager", firstName: "Mo" });
    __setPageUrl("/team");
    await render(LoadingShell, { layout: "page", title: "Team" });
    await expect.poll(() => sidebar("team")).not.toBeNull();
    const invite = sidebar("team")!.querySelector<HTMLButtonElement>("[data-section-sidebar-action]")!;
    expect([invite.textContent?.trim(), invite.disabled]).toEqual(["Invite people", true]);
  });

  it("loading bars keep the page's main button under the loaded bar's rule: below 768px and while the sidebar is collapsed (review round 2, item 4)", async () => {
    __setAuthState({ isLoading: false, isAuthenticated: true });
    __setQueryData("users:getCurrentUser", { _id: "m", role: "manager", firstName: "Mo" });
    const visibleButton = () => {
      const button = document.querySelector<HTMLElement>("[data-page-top-bar]:not(.md\\:hidden) [data-top-bar-primary]");
      return button && button.getBoundingClientRect().width > 0 ? button.textContent?.trim() : null;
    };
    // Team at 1440 with the sidebar open: the button is the sidebar's.
    __setPageUrl("/team");
    let view = await render(LoadingShell, { layout: "page", title: "Team" });
    await expect.poll(() => sidebar("team")).not.toBeNull();
    expect(visibleButton()).toBeNull();
    view.unmount();
    // Collapsed: the bar holds Invite people, drawn but not usable yet.
    localStorage.setItem("banhall.sectionSidebar.v1", JSON.stringify({ collapsed: true }));
    reloadSectionSidebar();
    view = await render(LoadingShell, { layout: "page", title: "Team" });
    await expect.poll(visibleButton).toBe("Invite people");
    expect(document.querySelector<HTMLButtonElement>("[data-page-top-bar] [data-top-bar-primary]")!.disabled).toBe(true);
    view.unmount();
    // Projects, collapsed: the company header holds New project.
    __setPageUrl("/projects");
    view = await render(LoadingShell, { layout: "projects", title: "Projects" });
    await expect.poll(() => document.querySelector("[data-client-header][data-loading] [data-top-bar-primary]")?.textContent?.trim()).toBe("New project");
    view.unmount();
    localStorage.clear();
    reloadSectionSidebar();
    // Home on a phone: the bar holds New project.
    await browserPage.viewport(390, 844);
    __setPageUrl("/my-work");
    await render(LoadingShell, { layout: "home", title: "Home" });
    await expect.poll(visibleButton).toBe("New project");
  });

  it("the Projects loading header draws the expand button while collapsed, and the menu button and bell from 768 to 1023px, as the loaded header does (review round 3)", async () => {
    __setAuthState({ isLoading: false, isAuthenticated: true });
    __setQueryData("users:getCurrentUser", { _id: "m", role: "manager", firstName: "Mo" });
    __setPageUrl("/projects");
    const header = () => document.querySelector<HTMLElement>("[data-client-header][data-loading]");
    const shown = (selector: string) => {
      const el = header()?.querySelector<HTMLElement>(selector);
      return !!el && el.getBoundingClientRect().width > 0;
    };
    // 1440, collapsed: the expand button leads, as on the loaded header.
    localStorage.setItem("banhall.sectionSidebar.v1", JSON.stringify({ collapsed: true }));
    reloadSectionSidebar();
    let view = await render(LoadingShell, { layout: "projects", title: "Projects" });
    await expect.poll(() => shown("[data-section-sidebar-expand]")).toBe(true);
    expect(shown('[aria-label="Open workspace navigation"]')).toBe(false);
    view.unmount();
    localStorage.clear();
    reloadSectionSidebar();
    // 900: no global bar, so the header holds the menu button and the bell.
    await browserPage.viewport(900, 900);
    view = await render(LoadingShell, { layout: "projects", title: "Projects" });
    await expect.poll(() => shown('[aria-label="Open workspace navigation"]')).toBe(true);
    expect(shown("[data-top-bar-bell]")).toBe(true);
    expect(shown("[data-section-sidebar-expand]")).toBe(false);
    view.unmount();
  });

  it("a project page loads in the card with no sidebar and the project bar's back button", async () => {
    __setPageUrl("/project/p1");
    __setAuthState({ isLoading: true, isAuthenticated: false });
    await render(LoadingShell, { layout: "project", title: "Adaptive cold storage controls", label: "Loading report workspace" });
    await expect.poll(() => skeleton("project")).not.toBeNull();
    expect(document.querySelector("[data-section-sidebar]")).toBeNull();
    const bar = document.querySelector<HTMLElement>("[data-project-top-bar]")!;
    expect(bar.closest("[data-frame-card]")).not.toBeNull();
    expect(bar.querySelector("[data-top-bar-back]")?.getAttribute("href")).toBe("/projects");
    expect(bar.querySelector("h1")?.textContent).toBe("Adaptive cold storage controls");
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
