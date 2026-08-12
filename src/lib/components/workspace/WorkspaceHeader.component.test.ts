import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceHeader from "./WorkspaceHeader.svelte";
import { searchShortcutHint } from "$lib/workspace/searchContinuity";

/**
 * The in-plane workspace toolbar. The decorative left title tick was removed
 * 2026-08-06 (docs/design-system.md): the title stands alone; lagoon appears
 * only on focus and the primary action.
 */
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    title: "Projects",
    count: "30+",
    searchValue: "",
    onSearchChange: () => {},
    onOpenNavigation: () => {},
    ...overrides,
  };
}

describe("WorkspaceHeader", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the title with its truthful count and no decorative tick before it", async () => {
    await render(WorkspaceHeader, baseProps());

    const heading = document.querySelector("header h1");
    expect(heading?.textContent).toBe("Projects");
    // The heading opens its group: no decorative sibling precedes it.
    expect(heading?.previousElementSibling).toBeNull();
    // No aria-hidden lagoon tick anywhere in the bar.
    expect(document.querySelector('header [aria-hidden="true"].bg-primary')).toBeNull();
    expect(heading?.parentElement?.textContent).toContain("30+");
  });

  it("omits the count node entirely when no truthful count exists", async () => {
    await render(WorkspaceHeader, baseProps({ count: null }));

    const heading = document.querySelector("header h1");
    expect(heading?.textContent).toBe("Projects");
    expect(heading?.parentElement?.textContent?.trim()).toBe("Projects");
  });

  it("shows the platform's own search shortcut, never a mixed ⌃K/⌘K pair", async () => {
    await render(WorkspaceHeader, baseProps());

    const hint = document.querySelector("kbd");
    // Platform-truthful: the single shared helper decides the glyph.
    expect(hint?.textContent).toBe(searchShortcutHint());
    expect(["⌘K", "Ctrl K"]).toContain(hint?.textContent);
  });

  it("leaves the expanded-state collapse control to the sidebar", async () => {
    await render(
      WorkspaceHeader,
      baseProps({ railHidden: false, onToggleRail: () => {} })
    );

    expect(document.querySelector("[data-rail-toggle]")).toBeNull();
  });

  it("reports the expand affordance while the rail is collapsed and omits the control when unwired", async () => {
    await render(WorkspaceHeader, baseProps({ railHidden: true, onToggleRail: () => {} }));
    expect(
      document.querySelector("[data-rail-toggle]")?.getAttribute("aria-label")
    ).toBe("Expand navigation rail");
    expect(document.querySelector("[data-rail-toggle]")?.getAttribute("aria-expanded")).toBe(
      "false"
    );

    document.body.innerHTML = "";
    await render(WorkspaceHeader, baseProps());
    expect(document.querySelector("[data-rail-toggle]")).toBeNull();
  });

  it("reveals the mobile search row through the animated disclosure with a correct aria wire", async () => {
    await render(WorkspaceHeader, baseProps());

    const searchToggle = document.querySelector<HTMLButtonElement>(
      'button[aria-controls="workspace-mobile-search"]'
    );
    expect(searchToggle?.getAttribute("aria-expanded")).toBe("false");
    // Closed: the disclosure body is unmounted — nothing tabbable.
    expect(document.getElementById("workspace-mobile-search")).toBeNull();

    searchToggle?.click();
    await expect.poll(() => searchToggle?.getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => document.getElementById("workspace-mobile-search")).not.toBeNull();
    // The reveal rides the shared ≥300ms disclosure transition — the row
    // never snaps in while only state flips.
    const wrapper = document.querySelector<HTMLElement>("[data-disclosure]");
    const style = getComputedStyle(wrapper!);
    expect(style.transitionProperty).toContain("grid-template-rows");
    expect(Number.parseFloat(style.transitionDuration)).toBeGreaterThanOrEqual(0.3);
  });

  it("restores focus to the ⌘K invoker on Escape instead of dropping it on body", async () => {
    // Live Obvious evidence (2026-08-08): its search dialog returns focus on
    // Escape. The inline field mirrors that continuity for INVOKED focus.
    await browserPage.viewport(1280, 800);
    await render(WorkspaceHeader, baseProps());
    const invoker = document.createElement("button");
    invoker.textContent = "external invoker";
    document.body.appendChild(invoker);
    invoker.focus();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true })
    );
    const input = document.querySelector<HTMLInputElement>('input[type="search"]');
    await expect.poll(() => document.activeElement).toBe(input);

    input?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
    await expect.poll(() => document.activeElement).toBe(invoker);
  });

  it("hands focus back to the mobile search toggle when Escape closes the revealed row", async () => {
    await browserPage.viewport(390, 844);
    await render(WorkspaceHeader, baseProps());

    const toggle = document.querySelector<HTMLButtonElement>(
      'button[aria-controls="workspace-mobile-search"]'
    )!;
    toggle.focus();
    toggle.click();
    await expect
      .poll(() => (document.activeElement as HTMLInputElement | null)?.type)
      .toBe("search");

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
    // Focus returns to the toggle — never lost to <body> as the row inerts.
    await expect.poll(() => document.activeElement).toBe(toggle);
    await expect.poll(() => toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("can omit the duplicate New project action on Home", async () => {
    await render(WorkspaceHeader, baseProps({ showNewProject: false }));

    expect(document.querySelector('a[href="/project/new"]')).toBeNull();
  });

  it("uses the AA lagoon pair on the New project action (light plane, 2026-08-06)", async () => {
    await render(WorkspaceHeader, baseProps());

    // `primary-selected` (#087A75) was minted for white text ≥4.5:1; plain
    // lagoon under white or fir text measures below AA at this size.
    const newProject = document.querySelector<HTMLAnchorElement>('a[href="/project/new"]');
    expect(newProject?.className).toContain("bg-primary-selected");
    expect(newProject?.className).toContain("text-white");
    expect(newProject?.className).not.toContain("text-navy");
  });
});
