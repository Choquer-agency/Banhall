import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceDashboard from "./WorkspaceDashboard.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import {
  RAIL_COLLAPSED_WIDTH,
  RAIL_DEFAULT_WIDTH,
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  RAIL_PREFERENCES_KEY,
} from "$lib/workspace/railPreferences";

/**
 * Desktop rail ergonomics (2026-08-08 amendment; 2026-08-11: collapse
 * renders the 64px icon-only mini rail, never width 0): pointer + keyboard
 * resize on the WAI-ARIA window-splitter separator, persistent
 * collapse/expand from the rail-owned toggle, width/hidden persistence
 * (the `hidden` key now means "collapsed"), and expanded-width restore.
 * Mounted through the REAL WorkspaceDashboard host at a desktop viewport.
 */
function seedQueries() {
  __setQueryData("myWork:getViewConfig", { killSwitch: true, ready: false });
  __setQueryData("dashboard:getFacets", { total: 1, truncated: false, stageCounts: {} });
  __setPaginatedRows("dashboard:listFlatProjects", []);
}

async function mountShell() {
  __setPageUrl("/projects?layout=list");
  seedQueries();
  await browserPage.viewport(1440, 900);
  const screen = await render(WorkspaceDashboard, { view: "all_projects" });
  screen.container.style.cssText = "display:flex;flex-direction:column;min-height:100vh;";
  await new Promise((resolve) => setTimeout(resolve, 0));
  return screen;
}

const shellRoot = () => document.querySelector<HTMLElement>("div[data-workspace-shell]");
const railAside = () => document.getElementById("workspace-rail");
const handle = () => document.querySelector<HTMLElement>("[data-rail-resize-handle]");
const railToggle = () =>
  [...document.querySelectorAll<HTMLButtonElement>("[data-rail-toggle]")].find(
    (button) => button.getClientRects().length > 0
  ) ?? null;

function storedPrefs() {
  const raw = localStorage.getItem(RAIL_PREFERENCES_KEY);
  return raw ? (JSON.parse(raw) as { width: number; hidden: boolean }) : null;
}

function pointer(type: string, x: number, pointerId = 1) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: 300,
    pointerId,
    button: 0,
    pointerType: "mouse",
  });
}

describe("Workspace rail resize + hide/show", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("exposes a keyboard separator with truthful aria values and ±8/±32/Home/End steps that persist", async () => {
    await mountShell();
    await expect.poll(() => handle()).not.toBeNull();

    const separator = handle()!;
    expect(separator.getAttribute("role")).toBe("separator");
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-valuemin")).toBe(String(RAIL_MIN_WIDTH));
    expect(separator.getAttribute("aria-valuemax")).toBe(String(RAIL_MAX_WIDTH));
    expect(separator.getAttribute("aria-valuenow")).toBe(String(RAIL_DEFAULT_WIDTH));

    separator.focus();
    expect(document.activeElement).toBe(separator);

    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await expect.poll(() => handle()?.getAttribute("aria-valuenow")).toBe(String(RAIL_DEFAULT_WIDTH + 8));
    separator.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true })
    );
    await expect.poll(() => handle()?.getAttribute("aria-valuenow")).toBe(String(RAIL_DEFAULT_WIDTH + 8 - 32));
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await expect.poll(() => handle()?.getAttribute("aria-valuenow")).toBe(String(RAIL_MAX_WIDTH));
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    await expect.poll(() => handle()?.getAttribute("aria-valuenow")).toBe(String(RAIL_MIN_WIDTH));

    // Every keyboard commit persists the clamped preference.
    expect(storedPrefs()).toEqual({ width: RAIL_MIN_WIDTH, hidden: false });
    // The grid variable follows the committed width.
    expect(shellRoot()?.style.getPropertyValue("--workspace-rail-width").trim()).toBe(
      `${RAIL_MIN_WIDTH}px`
    );
  });

  it("resizes by pointer drag with live CSS-variable updates, suspended transition, and clamped commit", async () => {
    await mountShell();
    await expect.poll(() => handle()).not.toBeNull();
    const separator = handle()!;
    const root = shellRoot()!;

    separator.dispatchEvent(pointer("pointerdown", 255));
    separator.dispatchEvent(pointer("pointermove", 305));
    // During the drag the shell suspends the grid transition (1:1 tracking)…
    await expect.poll(() => root.hasAttribute("data-rail-resizing")).toBe(true);
    expect(getComputedStyle(root).transitionProperty).toBe("none");
    // …and the live width lands on the CSS custom property directly.
    expect(root.style.getPropertyValue("--workspace-rail-width").trim()).toBe("305px");

    // Overshoot far past max: the live width clamps.
    separator.dispatchEvent(pointer("pointermove", 900));
    expect(root.style.getPropertyValue("--workspace-rail-width").trim()).toBe(
      `${RAIL_MAX_WIDTH}px`
    );

    separator.dispatchEvent(pointer("pointerup", 900));
    await expect.poll(() => root.hasAttribute("data-rail-resizing")).toBe(false);
    expect(storedPrefs()).toEqual({ width: RAIL_MAX_WIDTH, hidden: false });
    await expect.poll(() => handle()?.getAttribute("aria-valuenow")).toBe(String(RAIL_MAX_WIDTH));
  });

  it("collapses to the 64px icon-only mini rail and expands back, restoring the expanded width", async () => {
    // Seed a custom persisted width to prove restore-after-expand.
    localStorage.setItem(RAIL_PREFERENCES_KEY, JSON.stringify({ width: 320, hidden: false }));
    await mountShell();
    await expect.poll(() => railToggle()).not.toBeNull();
    const root = shellRoot()!;

    // Persisted width applied on mount.
    await expect
      .poll(() => root.style.getPropertyValue("--workspace-rail-width").trim())
      .toBe("320px");

    const toggle = railToggle()!;
    expect(toggle.getAttribute("aria-label")).toBe("Collapse navigation rail");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-controls")).toBe("workspace-rail");

    toggle.click();
    await expect.poll(() => root.hasAttribute("data-rail-hidden")).toBe(true);
    // Collapsed rail: still interactive (2026-08-11 mini rail — never
    // inert), preference persisted under the compatible `hidden` key, and
    // the rail-owned toggle reports the expand affordance.
    expect(railAside()?.hasAttribute("inert")).toBe(false);
    expect(storedPrefs()).toEqual({ width: 320, hidden: true });
    await expect
      .poll(() => railToggle()?.getAttribute("aria-label"))
      .toBe("Expand navigation rail");
    // The collapse/expand state change animates ≥300ms on the grid columns
    // (suspended only during live drags).
    const transition = getComputedStyle(root);
    expect(transition.transitionProperty).toContain("grid-template-columns");
    expect(Number.parseFloat(transition.transitionDuration)).toBeGreaterThanOrEqual(0.3);
    // The rail column settles at the fixed mini-rail width, never zero.
    await expect
      .poll(() => railAside()!.getBoundingClientRect().width, { timeout: 2000 })
      .toBe(RAIL_COLLAPSED_WIDTH);
    // No resize separator while collapsed — the mini rail is fixed-width.
    expect(handle()).toBeNull();

    railToggle()!.click();
    await expect.poll(() => root.hasAttribute("data-rail-hidden")).toBe(false);
    // Expanding restores the PREVIOUS expanded width, not the default.
    expect(storedPrefs()).toEqual({ width: 320, hidden: false });
    await expect
      .poll(() => railAside()!.getBoundingClientRect().width, { timeout: 2000 })
      .toBeGreaterThanOrEqual(319);
  });

  it("restores persisted collapsed state on mount (preference survives reload)", async () => {
    localStorage.setItem(RAIL_PREFERENCES_KEY, JSON.stringify({ width: 280, hidden: true }));
    await mountShell();

    const root = shellRoot()!;
    await expect.poll(() => root.hasAttribute("data-rail-hidden")).toBe(true);
    // The mini rail stays interactive from the first frame.
    expect(railAside()?.hasAttribute("inert")).toBe(false);
    await expect
      .poll(() => railToggle()?.getAttribute("aria-label"))
      .toBe("Expand navigation rail");
    await expect
      .poll(() => railAside()!.getBoundingClientRect().width, { timeout: 2000 })
      .toBe(RAIL_COLLAPSED_WIDTH);
    // No resize separator while collapsed.
    expect(handle()).toBeNull();
  });
});
