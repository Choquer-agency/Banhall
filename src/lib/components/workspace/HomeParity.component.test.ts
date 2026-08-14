import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceDashboard from "./WorkspaceDashboard.svelte";
import RecentProjectsRail from "./RecentProjectsRail.svelte";
import WorkspaceRail from "./WorkspaceRail.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { RECENT_PROJECTS_KEY } from "$lib/workspace/recentProjects";

/**
 * 2026-08-13 Attio-informed Home amendment:
 * - Home content sits inside a centered 716px boundary so
 *   ultrawide viewports read as a composed cluster, not an edge-to-edge
 *   stretch; the Projects repository stays exempt.
 * - The "Recently opened" rail is fed ONLY by the browser-local recents
 *   list (no queries) and renders NOTHING when no recents exist.
 * - The workspace rail's Home row is exactly ONE focus stop (the link) —
 *   the earlier tooltip wrapper span duplicated it (a11y P0).
 */
function itemRow(id: string) {
  return {
    workItemId: id,
    version: 1,
    updatedAt: 100,
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
  __setQueryData("myWork:getWaitingLaneState", { syncing: false, failed: false });
  __setQueryData("users:getCurrentUser", {
    _id: "u-1",
    firstName: "Olivia",
    lastName: "Owner",
    email: "olivia@example.test",
  });
  __setPaginatedRows("myWork:listAssignedToMe", [itemRow("a1")]);
  __setPaginatedRows("myWork:listOwnedByMe", []);
  __setPaginatedRows("myWork:listWaitingOnOthers", []);
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

describe("Home Obvious-parity presentation", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("centers Home content in the shell-token boundary while the scroll owner stays full width", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(1440, 900);
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect.poll(() => document.querySelector("[data-home-boundary]")).not.toBeNull();
    const boundary = document.querySelector<HTMLElement>("[data-home-boundary]")!;
    expect(boundary.className).toContain("mx-auto");
    expect(boundary.className).toContain("max-w-[44.75rem]");
    // The project-start Home content mounts inside the governed boundary.
    expect(boundary.querySelector("[data-home-start-form]")).not.toBeNull();
    expect(boundary.querySelector('[aria-label="Home"]')).not.toBeNull();
    // The scroll owner is the boundary's parent (full width, scrollbar at
    // the viewport edge), not the boundary itself.
    expect(boundary.parentElement?.className).toContain("overflow-y-auto");
    // The project-start shader is a restrained, non-interactive atmosphere
    // behind the governed content boundary, never part of the reading order.
    const wash = document.querySelector<HTMLElement>("[data-home-start-wash]");
    expect(wash).not.toBeNull();
    expect(wash?.getAttribute("aria-hidden")).toBe("true");
    expect(wash?.className).toContain("pointer-events-none");
    expect(wash?.className).toContain("opacity-40");
  });

  it("renders the Recently opened rail from browser-local recents only — and threads it into Home", async () => {
    localStorage.setItem(
      RECENT_PROJECTS_KEY,
      JSON.stringify([{ id: "proj-r1", title: "Recent thermal narrative" }])
    );
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(1440, 900);
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect.poll(() => document.querySelector("[data-home-recents]")).not.toBeNull();
    const recents = document.querySelector<HTMLElement>("[data-home-recents]")!;
    // Honest provenance copy — this is device-local recency, not server truth.
    expect(recents.textContent).toContain("Projects");
    expect(recents.textContent).toContain("recently opened on this device");
    expect(recents.querySelector<HTMLAnchorElement>('a[href="/projects"]')?.textContent).toContain("View all projects");
    const link = recents.querySelector<HTMLAnchorElement>('a[href="/project/proj-r1"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("Recent thermal narrative");
  });

  it("keeps one truthful repository continuation when no recents exist", async () => {
    await render(RecentProjectsRail, { recents: [] });
    const projects = document.querySelector<HTMLElement>("[data-home-recents]");
    expect(projects).not.toBeNull();
    expect(projects?.textContent).toContain("All projects");
    expect(projects?.textContent).not.toContain("recently opened on this device");
    expect(projects?.querySelector('a[href="/projects"]')).not.toBeNull();
  });

  it("removes Home's redundant context header while keeping creation anchored in the rail", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await render(WorkspaceDashboard, { view: "my_work" });

    await expect.poll(() => document.querySelector("[data-home-start-submit]")).not.toBeNull();
    expect(document.querySelector("[data-workspace-toolbar]")).toBeNull();
    expect(document.querySelector("[data-home-shell-controls]")).not.toBeNull();
    expect(document.querySelector("main h1")?.textContent).toContain("Good");
    // The rail keeps the persistent creation anchor (Obvious sidebar parity);
    // no header creation CTA exists to duplicate it.
    expect(
      document.querySelectorAll('nav a[href="/project/new"]').length
    ).toBeGreaterThanOrEqual(1);
    // The header does not duplicate the persistent rail creation action.
    expect(document.querySelector('[data-home-shell-controls] a[href="/project/new"]')).toBeNull();
  });

  it("keeps mobile navigation reachable without reintroducing the Home header", async () => {
    __setPageUrl("/my-work");
    seedHome();
    await browserPage.viewport(390, 844);
    await render(WorkspaceDashboard, { view: "my_work" });

    expect(document.querySelector("[data-workspace-toolbar]")).toBeNull();
    expect(
      document.querySelector('[data-home-shell-controls] button[aria-label="Open workspace navigation"]')
    ).not.toBeNull();
  });

  it("keeps the rail's Home row a single focus stop — the link itself, no focusable wrapper", async () => {
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
