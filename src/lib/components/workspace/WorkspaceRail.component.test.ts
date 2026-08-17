import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkspaceRail from "./WorkspaceRail.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/**
 * The Attio-informed pale rail: quiet fir selection wash, real typed links
 * for the canonical routes, and the fir-filtered Banhall wordmark.
 */
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    variant: "rail" as const,
    displayedView: "all_projects" as const,
    myWorkAvailable: true,
    myWorkHref: "/my-work?layout=board",
    projectsHref: "/projects?layout=board",
    currentDashboardHref: "/dashboard?workspace=current",
    recentProjects: [],
    onFocusSearch: () => {},
    ...overrides,
  };
}

const navLink = (label: string) =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>("nav a")).find(
    (anchor) => anchor.textContent?.trim() === label
  );

describe("WorkspaceRail", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("renders Home and Projects as real links to the canonical routes, params carried through", async () => {
    await render(WorkspaceRail, baseProps());

    // 2026-08-08 amendment: the daily destination presents as "Home"; its
    // canonical URL stays /my-work.
    expect(navLink("Home")?.getAttribute("href")).toBe("/my-work?layout=board");
    expect(navLink("Projects")?.getAttribute("href")).toBe("/projects?layout=board");
  });

  it("marks the active view with the quiet fir wash and aria-current", async () => {
    await render(WorkspaceRail, baseProps({ displayedView: "all_projects" }));

    const projects = navLink("Projects");
    const myWork = navLink("Home");
    expect(projects?.getAttribute("aria-current")).toBe("page");
    expect(projects?.className).toContain("bg-workspace-rail-selected");
    expect(projects?.className).toContain("font-semibold");
    expect(projects?.className).toContain("text-ink");
    expect(projects?.className).toContain("rounded-md");
    expect(projects?.className).not.toContain("text-primary");
    expect(myWork?.getAttribute("aria-current")).toBeNull();
    expect(myWork?.className).toContain("text-ink");
    expect(myWork?.className).not.toContain("font-semibold");
  });

  it("renders the Attio-style workspace identity and collapse control", async () => {
    __setQueryData("users:getCurrentUser", {
      role: "admin",
      name: "Admin Writer",
    });
    const onToggleRail = vi.fn();
    await render(WorkspaceRail, baseProps({ onToggleRail }));

    const identity = document.querySelector<HTMLAnchorElement>('a[aria-label="Admin Writer dashboard"]');
    expect(identity?.textContent).toContain("Admin Writer");
    expect(identity?.textContent).toContain("Admin");
    expect(identity?.textContent).not.toContain("Banhall");

    const toggle = document.querySelector<HTMLButtonElement>("[data-rail-toggle]");
    expect(toggle?.getAttribute("aria-label")).toBe("Collapse navigation rail");
    expect(toggle?.getAttribute("aria-controls")).toBe("workspace-rail");
    expect(toggle?.getAttribute("data-rail-direction")).toBe("collapse");
    // Live Attio calibration: a transparent square target inside the 8px
    // rail gutter, with no hover tile competing with the icon choreography.
    expect(toggle?.className).toContain("h-6");
    expect(toggle?.className).toContain("w-6");
    expect(toggle?.className).toContain("p-0");
    expect(toggle?.className).not.toContain("rounded-md");
    expect(toggle?.className).not.toContain("hover:bg-");
    expect(navLink("Home")?.parentElement?.className).toContain("px-2");
    // Resting sidebar glyph + directional hover glyph are both real icons;
    // CSS crossfades/translates them without custom SVG geometry.
    expect(toggle?.querySelectorAll("svg")).toHaveLength(2);
    toggle?.click();
    expect(onToggleRail).toHaveBeenCalledOnce();
  });

  it("does not render the desktop collapse control inside the mobile drawer", async () => {
    await render(WorkspaceRail, baseProps({ variant: "drawer", onToggleRail: () => {} }));
    expect(document.querySelector("[data-rail-toggle]")).toBeNull();
  });

  it("keeps the drawer chrome fixed, scrolls only its links, and starts Admin compact", async () => {
    __setQueryData("users:getCurrentUser", { role: "admin", name: "Admin Writer" });
    await render(WorkspaceRail, baseProps({ variant: "drawer" }));

    expect(document.querySelector("[data-rail-drawer-header]")?.className).toContain("shrink-0");
    expect(document.querySelector("[data-rail-scroll]")?.className).toContain("overflow-y-auto");
    expect(document.querySelector("[data-admin-group-toggle]")?.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("#workspace-admin-links")).toBeNull();
  });

  it("presents Admin as an Attio-style left-chevron group with distinct icon colours", async () => {
    __setQueryData("users:getCurrentUser", { role: "admin", name: "Admin Writer" });
    await render(WorkspaceRail, baseProps());

    const group = document.querySelector<HTMLButtonElement>("[data-admin-group-toggle]");
    expect(group?.textContent).toContain("Admin");
    expect(group?.getAttribute("aria-expanded")).toBe("true");
    expect(group?.firstElementChild?.tagName).toBe("svg");

    const iconTiles = Array.from(document.querySelectorAll<HTMLElement>("[data-admin-icon-tone]"));
    expect(iconTiles).toHaveLength(7);
    expect(new Set(iconTiles.map((tile) => tile.className.match(/bg-[a-z]+-500/)?.[0])).size).toBe(7);
    expect(document.querySelector('[data-admin-icon-tone="ingestion"] svg')).not.toBeNull();
    expect(document.querySelector("#workspace-admin-links")?.className).toContain("gap-1");

    group?.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(group?.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("#workspace-admin-links")).toBeNull();
  });

  it("shows only What's new from the utility links for non-developers", async () => {
    __setQueryData("users:getCurrentUser", {
      role: "admin",
      name: "Admin Writer",
      isDeveloper: false,
    });
    await render(WorkspaceRail, baseProps());

    expect(document.querySelector("[data-developer-group-toggle]")).toBeNull();
    expect(document.querySelector('nav a[href="/alerts"]')).toBeNull();
    expect(document.querySelector('nav a[href="/requests"]')).toBeNull();
    expect(document.querySelector('nav a[href="/changelog"]')).not.toBeNull();
    expect(document.querySelector("[data-workspace-escape]")).toBeNull();
    expect(document.querySelector("[data-rail-flag-issue]")).toBeNull();
    expect(document.querySelector('button[aria-label="Settings menu"]')).not.toBeNull();
  });

  it("shows developer utilities directly for flagged accounts without an accordion", async () => {
    __setQueryData("users:getCurrentUser", {
      role: "admin",
      name: "Admin Writer",
      isDeveloper: true,
    });
    __setQueryData("errorReports:openCount", 6);
    __setQueryData("changelog:unseenCount", 2);
    await render(WorkspaceRail, baseProps());

    expect(document.querySelector("[data-developer-group-toggle]")).toBeNull();
    expect(document.querySelector("[data-rail-utilities]")?.textContent).not.toContain("Developer");
    expect(document.querySelector('nav a[href="/alerts"]')).not.toBeNull();
    expect(document.querySelector('nav a[href="/requests"]')).not.toBeNull();
    expect(document.querySelector('nav a[href="/changelog"]')).not.toBeNull();
    expect(document.querySelector("[data-workspace-escape]")).not.toBeNull();
    expect(document.querySelector("[data-rail-flag-issue]")).not.toBeNull();
  });

  it("moves the Admin records group below the primary workspace links", async () => {
    __setQueryData("users:getCurrentUser", { role: "admin", name: "Admin Writer" });
    await render(WorkspaceRail, baseProps());

    expect(document.querySelector("[data-rail-admin]")?.className).toContain("mt-5");
  });

  it("shares the compact rail rhythm with fine-pointer drawers without shrinking touch targets", async () => {
    __setQueryData("users:getCurrentUser", { role: "admin", name: "Admin Writer" });
    await render(WorkspaceRail, baseProps({ variant: "drawer" }));

    const home = navLink("Home");
    expect(home?.className).toContain("workspace-rail-row");
    expect(home?.className).toContain("min-h-11");
    expect(home?.className).toContain("duration-300");
    expect(document.querySelector("[data-rail-admin]")?.className).toContain("mt-5");
  });

  it("keeps the component expanded because full collapse is owned by WorkspaceShell", async () => {
    __setQueryData("users:getCurrentUser", { role: "admin", name: "Admin Writer" });
    await render(WorkspaceRail, baseProps({ collapsed: true, onToggleRail: () => {} }));

    expect(document.querySelector('a[aria-label="Admin Writer dashboard"]')?.textContent).toContain("Admin Writer");
    const toggle = document.querySelector<HTMLButtonElement>("[data-rail-toggle]");
    expect(toggle?.getAttribute("aria-label")).toBe("Collapse navigation rail");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    const projects = navLink("Projects");
    expect(projects?.querySelector("span")?.className).not.toContain("sr-only");
  });

  it("ignores collapsed inside the mobile drawer — the drawer instance always renders expanded", async () => {
    __setQueryData("users:getCurrentUser", { role: "admin", name: "Admin Writer" });
    await render(WorkspaceRail, baseProps({ variant: "drawer", collapsed: true }));

    expect(document.querySelector('a[aria-label="Admin Writer dashboard"]')?.textContent).toContain("Admin Writer");
    const projects = navLink("Projects");
    expect(projects?.getAttribute("title")).toBeNull();
    expect(projects?.querySelector("span")?.className).not.toContain("sr-only");
  });

  /**
   * Anchor activation would really navigate the test iframe, so a window
   * capture listener records whether the COMPONENT prevented the click and
   * then always cancels the default action itself.
   */
  function clickRecordingPrevention(anchor: HTMLAnchorElement | undefined) {
    let preventedByComponent: boolean | null = null;
    const guard = (event: Event) => {
      preventedByComponent = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener("click", guard);
    try {
      anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    } finally {
      window.removeEventListener("click", guard);
    }
    return preventedByComponent;
  }

  it("blocks Home navigation while unavailable and reports the disabled state", async () => {
    const onNavigate = vi.fn();
    await render(WorkspaceRail, baseProps({ myWorkAvailable: false, onNavigate }));

    const myWork = navLink("Home");
    expect(myWork?.getAttribute("aria-disabled")).toBe("true");
    expect(clickRecordingPrevention(myWork)).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("navigates (and closes the drawer) when Home is available", async () => {
    const onNavigate = vi.fn();
    await render(WorkspaceRail, baseProps({ variant: "drawer", onNavigate }));

    const myWork = navLink("Home");
    expect(clickRecordingPrevention(myWork)).toBe(false);
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
