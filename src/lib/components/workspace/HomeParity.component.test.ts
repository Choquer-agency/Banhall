import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceDashboard from "./WorkspaceDashboard.svelte";
import WorkspaceRail from "./WorkspaceRail.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __activeQueryArgs,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { RECENT_PROJECTS_KEY } from "$lib/workspace/recentProjects";
import { RAIL_PREFERENCES_KEY } from "$lib/workspace/railPreferences";

/**
 * Home inside the workspace shell (ui-design-final.md section 9, boards 1.1
 * and 1.2; replaces the 2026-08-13 composer layout):
 * - Home owns one top bar (page icon, "Home", greeting, bell, New project)
 *   and one bordered panel that scrolls on its own; the shell never grows.
 * - "Recently opened" is fed by the browser-local recents list, read live
 *   through myWork.listRecentProjects.
 * - Collapsed, the rail keeps its icons and the expand control sits in
 *   Home's top bar (board 1.2).
 * - The workspace rail's Home row is exactly ONE focus stop (the link).
 */
function itemRow(id: string) {
  return {
    workItemId: id,
    version: 1,
    updatedAt: 100,
    projectUpdatedAt: Date.now() - 60_000,
    projectId: `proj-${id}`,
    projectTitle: `Project ${id}`,
    clientName: "Acme Labs",
    workflowStage: "drafting",
    stageIsFallback: false,
    kind: "draft_report",
    blocking: false,
    isCurrentHandoff: false,
    dueAt: null,
    assignee: { userId: "u-1", label: "Morgan Manager", initials: "MM" },
    assigner: { userId: "u-2", label: "Alex Lee", initials: "AL" },
    viewerCanComplete: false,
    viewerCanCompleteOthers: false,
    viewerCanManage: false,
  };
}

function seedHome() {
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData("users:getCurrentUser", {
    _id: "u-1",
    firstName: "Olivia",
    lastName: "Owner",
    email: "olivia@example.test",
  });
  __setQueryData("changelog:unseenCount", 0);
  __setQueryData("myWork:getContinueWorking", null);
  __setPaginatedRows("myWork:listAssignedToMe", [itemRow("a1")]);
  __setPaginatedRows("dashboard:listFlatProjects", []);
}

const railProps = (overrides: Record<string, unknown> = {}) => ({
  variant: "rail" as const,
  displayedView: "my_work" as const,
  myWorkAvailable: true,
  myWorkHref: "/my-work",
  projectsHref: "/projects",
  currentDashboardHref: "/dashboard?workspace=current",
  recentProjects: [],
  onFocusSearch: () => {},
  ...overrides,
});

describe("Home in the workspace shell", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("gives Home one top bar and one panel that owns the scroll inside the viewport-bound shell", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(1440, 900);
    const screen = await render(WorkspaceDashboard, { view: "my_work" });
    // Replica of +layout's auto-height flex column (see WorkspaceDashboard tests).
    screen.container.style.cssText = "display:flex;flex-direction:column;min-height:100vh;";

    await expect.poll(() => document.querySelector("[data-home-panel]")).not.toBeNull();
    const headers = document.querySelectorAll("[data-workspace-page-header]");
    expect(headers).toHaveLength(1);
    expect(headers[0].querySelector("h1")?.textContent).toBe("Home");
    const panel = document.querySelector<HTMLElement>("[data-home-panel]")!;
    expect(getComputedStyle(panel).overflowY).toBe("auto");
    expect(panel.querySelector('[data-home-table="home-with-you"]')).not.toBeNull();
    expect(panel.querySelector("[data-home-continue]")).not.toBeNull();
    // The composer, shader wash and projects card of the earlier Home are gone.
    expect(document.querySelector("[data-home-start-form]")).toBeNull();
    expect(document.querySelector("[data-home-start-wash]")).toBeNull();
    expect(document.querySelector("[data-home-recents]")).toBeNull();
    // Split desk at 1440: tables left, Continue working in a 384px column.
    const continueColumn = document.querySelector<HTMLElement>("[data-home-continue]")!.parentElement!;
    expect(Math.round(continueColumn.getBoundingClientRect().width)).toBe(384);
    const tables = document.querySelector<HTMLElement>("[data-home-tables]")!.getBoundingClientRect();
    expect(continueColumn.getBoundingClientRect().left).toBeGreaterThanOrEqual(tables.right);
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
  });

  it("reads Recently opened from browser-local recents", async () => {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify([{ id: "proj-r1", title: "Recent thermal narrative", openedAt: Date.now() - 60_000 }])
    );
    __setPageUrl("/my-work");
    seedHome();
    __setQueryData("myWork:listRecentProjects", [
      {
        projectId: "proj-r1",
        projectTitle: "Recent thermal narrative",
        clientName: "Acme Labs",
        workflowStage: "drafting",
        stageIsFallback: false,
        updatedAt: Date.now() - 120_000,
      },
    ]);
    await browserPage.viewport(1440, 900);
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect
      .poll(() => document.querySelector('[data-home-table="home-recent"] a[href="/project/proj-r1"]')?.textContent)
      .toBe("Recent thermal narrative");
    expect(__activeQueryArgs("myWork:listRecentProjects")).toEqual([{ projectIds: ["proj-r1"] }]);
    expect(document.querySelector('[data-home-table="home-recent"]')?.textContent).toContain("Recently opened");
  });

  it("keeps New project on Home's top bar and off the rail", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect.poll(() => document.querySelector("[data-home-new-project]")).not.toBeNull();
    expect(document.querySelector('[data-home-top-bar] a[href="/project/new"]')).not.toBeNull();
    expect(document.querySelectorAll('nav a[href="/project/new"]').length).toBe(0);
    expect(document.querySelector("[data-workspace-toolbar]")).toBeNull();
  });

  it("keeps mobile navigation reachable from Home's top bar", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(390, 844);
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect
      .poll(() => document.querySelector('[data-home-top-bar] button[aria-label="Open workspace navigation"]'))
      .not.toBeNull();
  });

  it("puts the expand control in the collapsed rail, not Home's top bar (round 2, A4)", async () => {
    localStorage.setItem(RAIL_PREFERENCES_KEY, JSON.stringify({ width: 240, hidden: true }));
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(1440, 900);
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect.poll(() => document.querySelector("[data-home-top-bar]")).not.toBeNull();
    expect(document.querySelector("nav[data-rail-collapsed]")).not.toBeNull();
    expect(document.querySelector('nav[data-rail-collapsed] button[data-rail-direction="expand"]')).not.toBeNull();
    expect(document.querySelector('[data-home-top-bar] button[data-rail-direction="expand"]')).toBeNull();
  });

  it("shows the round 2 identity row: name, role chip and the account menu, no sign-out icon or Flag issue row", async () => {
    __setPageUrl("/my-work");
    seedHome();
    __setQueryData("users:getCurrentUser", { _id: "u-1", firstName: "Olivia", lastName: "Owner", role: "writer" });
    await browserPage.viewport(1440, 900);
    await render(WorkspaceDashboard, { view: "my_work" });
    await expect.poll(() => document.querySelector("nav [data-rail-identity] [data-role-chip]")).not.toBeNull();
    const identity = document.querySelector<HTMLElement>("nav [data-rail-identity]")!;
    expect(identity.tagName).toBe("BUTTON");
    expect(identity.getAttribute("aria-haspopup")).toBe("menu");
    expect(document.querySelector('nav button[aria-label="Sign out"]')).toBeNull();
    expect(document.querySelector("nav [data-rail-flag-issue]")).toBeNull();
    expect(document.querySelector("nav [data-workspace-escape]")).toBeNull();
  });

  it("keeps the rail's Home row a single focus stop - the link itself, no focusable wrapper", async () => {
    await render(WorkspaceRail, railProps());
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>("nav a, nav button, nav [tabindex]")
    );
    const homeStops = focusables.filter((el) => el.textContent?.trim() === "Home");
    expect(homeStops).toHaveLength(1);
    expect(homeStops[0].tagName).toBe("A");
    // No ancestor between the link and the nav may be its own focus stop.
    let ancestor = homeStops[0].parentElement;
    while (ancestor && ancestor.tagName !== "NAV") {
      expect(ancestor.hasAttribute("tabindex")).toBe(false);
      ancestor = ancestor.parentElement;
    }
  });
});
