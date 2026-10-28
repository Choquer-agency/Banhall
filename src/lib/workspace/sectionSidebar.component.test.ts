import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SECTION_SIDEBAR_KEY,
  parseSectionSidebar,
  registerSectionSidebar,
  reloadSectionSidebar,
  sectionSidebar,
  setSectionSidebarCollapsed,
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

  it("toggles only while a sidebar is on screen, and remembers the choice", () => {
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
