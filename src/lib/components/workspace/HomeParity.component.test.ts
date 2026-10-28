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
import { SECTION_SIDEBAR_KEY, reloadSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";
import { board } from "$lib/test/boardScale";

/**
 * Home inside the workspace shell (ui-design-final.md section 9, boards 1.1
 * and 1.2; replaces the 2026-08-13 composer layout):
 * - Home sits in the page frame's white card (owner, 2026-10-28) with the
 *   Projects sidebar (Home marked, New project) and one top bar ("Home",
 *   greeting); its content scrolls on its own and the shell never grows.
 * - "Recently opened" is fed by the browser-local recents list, read live
 *   through myWork.listRecentProjects.
 * - Mod \ collapses the sidebar; the bar's expand button brings it back.
 * - The drawer's Home row is exactly ONE focus stop (the link).
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
  variant: "drawer" as const,
  displayedView: "my_work" as const,
  myWorkAvailable: true,
  myWorkHref: "/my-work",
  projectsHref: "/projects",
  onFocusSearch: () => {},
  ...overrides,
});

describe("Home in the workspace shell", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadSectionSidebar();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("gives Home one top bar in the card and content that owns the scroll inside the viewport-bound shell", async () => {
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
    // The page frame: the card holds the Projects sidebar and the page.
    const card = document.querySelector<HTMLElement>("[data-home][data-frame-card]")!;
    expect(card.contains(headers[0])).toBe(true);
    expect(card.querySelector('[data-section-sidebar="projects"]')).not.toBeNull();
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
    expect(continueColumn.getBoundingClientRect().width).toBeCloseTo(board(384), 0);
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

  it("puts New project in Home's sidebar, off the rail, and the bar's copy below 768px only", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(1440, 900);
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect.poll(() => document.querySelector('[data-section-sidebar="projects"] [data-section-sidebar-action]')).not.toBeNull();
    expect(document.querySelector('[data-section-sidebar="projects"] a[href="/project/new"]')?.textContent?.trim()).toBe("New project");
    expect(document.querySelectorAll('[data-frame-rail] a[href="/project/new"]').length).toBe(0);
    expect(document.querySelector<HTMLElement>("[data-home] [data-top-bar-primary]")!.getBoundingClientRect().width).toBe(0);
    expect(document.querySelector("[data-workspace-toolbar]")).toBeNull();
  });

  it("keeps mobile navigation reachable from Home's top bar, with New project there", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(390, 844);
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect
      .poll(() => document.querySelector('[data-home] [data-page-top-bar] button[aria-label="Open workspace navigation"]'))
      .not.toBeNull();
    expect(document.querySelector<HTMLElement>("[data-home] [data-top-bar-primary]")!.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(document.querySelector<HTMLElement>('[data-section-sidebar-slot="projects"]')!.getBoundingClientRect().width).toBe(0);
  });

  it("Mod \\ collapses Home's sidebar, the bar leads with the expand button, and the choice is saved (owner answer 4)", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(1440, 900);
    await render(WorkspaceDashboard, { view: "my_work" });
    await expect.poll(() => document.querySelector("[data-section-sidebar-toggle]")).not.toBeNull();
    const bar = document.querySelector<HTMLElement>("[data-home] [data-page-top-bar]")!;
    const visible = () =>
      [...bar.querySelectorAll<HTMLElement>("button, a, h1")].filter((element) => element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0);
    // Expanded: the bar leads with the title, no page tile.
    expect(visible()[0]).toBe(bar.querySelector("h1"));
    expect(bar.querySelector("[data-home-page-icon]")).toBeNull();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", metaKey: true, ctrlKey: true, bubbles: true }));
    await expect.poll(() => document.querySelector("[data-section-sidebar-slot]")?.hasAttribute("data-collapsed")).toBe(true);
    expect(JSON.parse(localStorage.getItem(SECTION_SIDEBAR_KEY)!)).toEqual({ collapsed: true });
    await expect.poll(() => visible()[0]?.hasAttribute("data-section-sidebar-expand")).toBe(true);
    const expand = bar.querySelector<HTMLButtonElement>("[data-section-sidebar-expand]")!;
    expand.focus();
    await expect.poll(() => document.querySelector("[data-tooltip-hint]")?.textContent).toBeTruthy();
    expect(document.body.textContent).toContain("Show the sidebar");
    expand.click();
    await expect.poll(() => document.querySelector("[data-section-sidebar-slot]")?.hasAttribute("data-collapsed")).toBe(false);
  });

  it("the frame's rail and global bar replace the old rail identity: the account menu sits behind the name in the global bar", async () => {
    __setPageUrl("/my-work");
    seedHome();
    __setQueryData("users:getCurrentUser", { _id: "u-1", firstName: "Olivia", lastName: "Owner", role: "writer" });
    await browserPage.viewport(1440, 900);
    await render(WorkspaceDashboard, { view: "my_work" });
    await expect.poll(() => document.querySelector("[data-global-bar-account-name]")?.textContent).toBe("Olivia Owner");
    const account = document.querySelector<HTMLElement>("[data-global-bar-account]")!;
    expect(account.tagName).toBe("BUTTON");
    expect(account.getAttribute("aria-haspopup")).toBe("menu");
    expect(document.querySelector("[data-frame-rail] [data-rail-identity]")).toBeNull();
    expect(document.querySelector('[data-frame-rail] button[aria-label="Sign out"]')).toBeNull();
    // Home has no checkboxes.
    expect(document.querySelector('[data-home-panel] input[type="checkbox"], [data-home-panel] [role="checkbox"]')).toBeNull();
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
