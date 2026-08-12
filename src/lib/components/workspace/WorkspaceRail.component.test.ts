import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import WorkspaceRail from "./WorkspaceRail.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub } from "$lib/test/convex-svelte-stub.svelte";

/**
 * The branded fir rail: quiet white selection capsule (fir shell contrast is
 * recorded in docs/design-system.md), real typed links for the canonical
 * routes, and the white-on-fir wordmark (the AppNav brand treatment — the
 * raw wordmark's navy strokes vanish on fir, so `brightness-0 invert` is a
 * recorded decision, not an accident).
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

  it("marks the active view with the quiet white capsule and aria-current, never a lagoon-tinted row", async () => {
    await render(WorkspaceRail, baseProps({ displayedView: "all_projects" }));

    const projects = navLink("Projects");
    const myWork = navLink("Home");
    expect(projects?.getAttribute("aria-current")).toBe("page");
    expect(projects?.className).toContain("bg-white/10");
    expect(projects?.className).toContain("text-white");
    expect(projects?.className).not.toContain("text-primary");
    expect(myWork?.getAttribute("aria-current")).toBeNull();
    expect(myWork?.className).toContain("text-white/65");
  });

  it("keeps the wordmark white-on-fir and places the collapse control in the desktop rail", async () => {
    const onToggleRail = vi.fn();
    await render(WorkspaceRail, baseProps({ onToggleRail }));

    const logo = document.querySelector<HTMLImageElement>('img[alt="Banhall"]');
    expect(logo).not.toBeNull();
    expect(logo?.className).toContain("brightness-0");
    expect(logo?.className).toContain("invert");

    const toggle = document.querySelector<HTMLButtonElement>("[data-rail-toggle]");
    expect(toggle?.getAttribute("aria-label")).toBe("Collapse navigation rail");
    expect(toggle?.getAttribute("aria-controls")).toBe("workspace-rail");
    toggle?.click();
    expect(onToggleRail).toHaveBeenCalledOnce();
  });

  it("does not render the desktop collapse control inside the mobile drawer", async () => {
    await render(WorkspaceRail, baseProps({ variant: "drawer", onToggleRail: () => {} }));
    expect(document.querySelector("[data-rail-toggle]")).toBeNull();
  });

  it("collapses to the icon-only mini rail: labels sr-only with title tooltips, wordmark gone, expand toggle present", async () => {
    // 2026-08-11 amendment: collapsing renders a 64px icon rail, never a
    // fully hidden one. Accessible names survive as sr-only text.
    await render(WorkspaceRail, baseProps({ collapsed: true, onToggleRail: () => {} }));

    // Wide wordmark leaves the collapsed layout.
    expect(document.querySelector('img[alt="Banhall"]')).toBeNull();

    // The rail-owned toggle now reports the expand affordance.
    const toggle = document.querySelector<HTMLButtonElement>("[data-rail-toggle]");
    expect(toggle?.getAttribute("aria-label")).toBe("Expand navigation rail");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    // Nav rows keep their names (sr-only) and gain title tooltips.
    const projects = navLink("Projects");
    expect(projects?.getAttribute("title")).toBe("Projects");
    expect(projects?.querySelector("span")?.className).toContain("sr-only");
    const home = navLink("Home");
    expect(home?.querySelector("span")?.className).toContain("sr-only");

    // New project collapses to the plus icon button; the label stays sr-only.
    const newProject = document.querySelector<HTMLAnchorElement>('a[href="/project/new"]');
    expect(newProject?.getAttribute("title")).toBe("New project");
    expect(newProject?.querySelector("span")?.className).toContain("sr-only");

    // Bottom utility rows are icon-only too.
    const flagIssue = document.querySelector<HTMLButtonElement>("[data-rail-flag-issue]");
    expect(flagIssue?.getAttribute("title")).toBe("Flag issue");
    expect(flagIssue?.querySelector("span")?.className).toContain("sr-only");
    const escape = document.querySelector<HTMLButtonElement>("[data-workspace-escape]");
    expect(escape?.getAttribute("title")).toBe("Current dashboard");
    expect(escape?.querySelector("span")?.className).toContain("sr-only");
  });

  it("ignores collapsed inside the mobile drawer — the drawer instance always renders expanded", async () => {
    await render(WorkspaceRail, baseProps({ variant: "drawer", collapsed: true }));

    expect(document.querySelector('img[alt="Banhall"]')).not.toBeNull();
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
