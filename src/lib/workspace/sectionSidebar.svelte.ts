/**
 * The inner section sidebar's collapse (the page frame, owner 2026-10-28):
 * one browser-local choice shared by every section sidebar (Projects, Team,
 * Admin, Settings). Mod \ and the sidebar's own header button toggle it; a
 * collapsed sidebar comes back from the expand button at the start of the
 * page top bar. Presentation only, never a server or domain concern, and it
 * fails closed to expanded.
 */
import { tick, untrack } from "svelte";

export const SECTION_SIDEBAR_KEY = "banhall.sectionSidebar.v1";

/** Fail-closed read of the stored choice: anything but `{ collapsed: true }` is expanded. */
export function parseSectionSidebar(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && (parsed as { collapsed?: unknown }).collapsed === true;
  } catch {
    return false;
  }
}

function load(): boolean {
  try {
    return parseSectionSidebar(localStorage.getItem(SECTION_SIDEBAR_KEY));
  } catch {
    // Storage blocked (private mode, embedded contexts, server render).
    return false;
  }
}

class SectionSidebarState {
  collapsed = $state(load());
  /** How many section sidebars are on screen; Mod \ does nothing without one. */
  mounted = $state(0);
}

export const sectionSidebar = new SectionSidebarState();

/** Read the stored choice again (a new signed-in tab, or a test reset). */
export function reloadSectionSidebar(): void {
  sectionSidebar.collapsed = load();
}

export function setSectionSidebarCollapsed(collapsed: boolean): void {
  sectionSidebar.collapsed = collapsed;
  try {
    localStorage.setItem(SECTION_SIDEBAR_KEY, JSON.stringify({ collapsed }));
  } catch {
    // Storage blocked: the choice still holds for this session.
  }
}

/** Section sidebars show from 768px (`md`); below that none is on screen. */
export const SECTION_SIDEBAR_MEDIA = "(min-width: 48rem)";

/**
 * Collapse or expand the section sidebar. Returns false when none is on
 * screen (the project page, New project, or any page below 768px, where the
 * sidebars are hidden), so the choice never changes out of sight. When focus was in the sidebar or on the expand button, it moves to
 * the control in its new place, since the old one goes away.
 */
export function toggleSectionSidebar(): boolean {
  if (sectionSidebar.mounted === 0) return false;
  if (typeof window !== "undefined" && !window.matchMedia(SECTION_SIDEBAR_MEDIA).matches) return false;
  const active = typeof document === "undefined" ? null : document.activeElement;
  const fromControl =
    active instanceof HTMLElement &&
    (active.closest("[data-section-sidebar]") !== null || active.hasAttribute("data-section-sidebar-expand"));
  setSectionSidebarCollapsed(!sectionSidebar.collapsed);
  if (fromControl) {
    void tick().then(() => {
      const selector = sectionSidebar.collapsed ? "[data-section-sidebar-expand]" : "[data-section-sidebar-toggle]";
      document.querySelector<HTMLElement>(selector)?.focus();
    });
  }
  return true;
}

/** A section sidebar mounting; the returned function unregisters it. */
export function registerSectionSidebar(): () => void {
  // Untracked: an effect that registers must not depend on the count it changes.
  untrack(() => (sectionSidebar.mounted += 1));
  return () => {
    untrack(() => (sectionSidebar.mounted = Math.max(0, sectionSidebar.mounted - 1)));
  };
}
