import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  SECTION_SIDEBAR_KEY,
  parseSectionSidebar,
  registerSectionSidebar,
  reloadSectionSidebar,
  sectionSidebar,
  setSectionSidebarCollapsed,
  sidebarHoldsAction,
  toggleSectionSidebar,
} from "./sectionSidebar.svelte";

/** The section sidebar's collapse (the page frame, owner 2026-10-28). */
describe("sectionSidebar", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sectionSidebar.collapsed = false;
    sectionSidebar.mounted = 0;
  });

  it("reads only a stored { collapsed: true } as collapsed", () => {
    expect(parseSectionSidebar(null)).toBe(false);
    expect(parseSectionSidebar("not json")).toBe(false);
    expect(parseSectionSidebar('{"collapsed":"yes"}')).toBe(false);
    expect(parseSectionSidebar('{"collapsed":true}')).toBe(true);
  });

  it("does nothing below 768px, where no sidebar shows (review round 1, finding 5)", async () => {
    await page.viewport(700, 900);
    const unregister = registerSectionSidebar();
    expect(toggleSectionSidebar()).toBe(false);
    expect(sectionSidebar.collapsed).toBe(false);
    expect(localStorage.getItem(SECTION_SIDEBAR_KEY)).toBeNull();
    unregister();
  });

  it("toggles only while a sidebar is on screen, and remembers the choice", async () => {
    await page.viewport(1440, 900);
    expect(toggleSectionSidebar()).toBe(false);
    expect(sectionSidebar.collapsed).toBe(false);
    const unregister = registerSectionSidebar();
    expect(sectionSidebar.mounted).toBe(1);
    expect(toggleSectionSidebar()).toBe(true);
    expect(sectionSidebar.collapsed).toBe(true);
    expect(localStorage.getItem(SECTION_SIDEBAR_KEY)).toBe('{"collapsed":true}');
    unregister();
    expect(sectionSidebar.mounted).toBe(0);
    sectionSidebar.collapsed = false;
    reloadSectionSidebar();
    expect(sectionSidebar.collapsed).toBe(true);
    setSectionSidebarCollapsed(false);
    expect(localStorage.getItem(SECTION_SIDEBAR_KEY)).toBe('{"collapsed":false}');
  });

  it("an open sidebar holds the page's main button, and on the server before any sidebar registers (review round 3)", () => {
    // In the browser, only once a sidebar is on screen and open.
    expect(sidebarHoldsAction()).toBe(false);
    const unregister = registerSectionSidebar();
    expect(sidebarHoldsAction()).toBe(true);
    setSectionSidebarCollapsed(true);
    expect(sidebarHoldsAction()).toBe(false);
    setSectionSidebarCollapsed(false);
    unregister();
    // The server draws the sidebar open before it registers, so the server
    // bar leaves the button to it: a reload never shows the button twice.
    expect(sidebarHoldsAction(true)).toBe(true);
  });

  it("stays expanded when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    reloadSectionSidebar();
    expect(sectionSidebar.collapsed).toBe(false);
    expect(() => setSectionSidebarCollapsed(true)).not.toThrow();
    expect(sectionSidebar.collapsed).toBe(true);
  });
});
