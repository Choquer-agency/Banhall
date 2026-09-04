import { beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import { authClient } from "$lib/authClient";
import WorkspaceChrome from "./WorkspaceChrome.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const tallContent = createRawSnippet(() => ({
  render: () => `<div data-testid="tall-content" style="height:1800px">Utility content</div>`,
}));

describe("WorkspaceChrome", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setPageUrl("/settings");
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  });

  it("uses the pale workspace rail and gives long utility content an internal vertical scroll owner", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });

    const root = document.querySelector<HTMLElement>("[data-workspace-chrome]")!;
    const main = root.querySelector<HTMLElement>("main")!;
    const aside = root.querySelector<HTMLElement>("aside")!;
    expect(Math.round(root.getBoundingClientRect().height)).toBe(window.innerHeight);
    expect(getComputedStyle(aside).backgroundColor).toBe("rgb(251, 251, 251)");
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
    main.scrollTop = 300;
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(window.scrollY).toBe(0);
    expect(root.textContent).toContain("Settings");
  });

  it("has no decorative title-side tick and exposes canonical workspace links", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, { title: "Alerts & requests", children: tallContent });

    const header = document.querySelector<HTMLElement>("[data-workspace-chrome] header")!;
    expect(header.hasAttribute("data-workspace-page-header")).toBe(true);
    expect(header.className).toContain("h-[49px]");
    expect(header.querySelector(".bg-primary.h-5.w-0\\.5")).toBeNull();
    expect(document.querySelector('a[href="/projects"]')).not.toBeNull();
    expect(document.querySelector('a[href="/my-work"]')).not.toBeNull();
  });

  it("rail search opens the shell command palette in place — no navigation (2026-08-13)", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });

    document
      .querySelector<HTMLButtonElement>('aside button[aria-label="Search projects"]')!
      .click();

    // The palette dialog mounts (light panel, portal outside the theme
    // scope); the SPA does not leave the page.
    await expect
      .poll(() => document.querySelector('[data-command-root]'))
      .not.toBeNull();
    expect(
      __navigationCalls.filter((call) => call.kind === "goto").map((call) => call.url)
    ).not.toContain("/projects");
  });

  it.each(["cancel", "Escape"])("layers sign-out confirmation above the drawer and restores focus on %s", async (dismiss) => {
    await browserPage.viewport(390, 844);
    __setQueryData("users:getCurrentUser", {
      _id: "admin-1",
      firstName: "Ada",
      lastName: "Admin",
      email: "ada@example.test",
      role: "admin",
    });
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });

    document.querySelector<HTMLButtonElement>('button[aria-label="Open workspace navigation"]')!.click();
    await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull();
    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("Close workspace navigation");

    const drawer = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const trigger = drawer.querySelector<HTMLButtonElement>('button[aria-label="Sign out"]')!;
    const signOut = vi.mocked(authClient.signOut);
    signOut.mockClear();
    try {
      trigger.focus();
      await userEvent.keyboard("{Enter}");
      await expect.element(browserPage.getByRole("dialog", { name: "Sign out?", exact: true })).toBeVisible();
      const confirmation = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .find((element) => element !== drawer)!;
      expect(drawer.contains(confirmation)).toBe(false);
      expect(Number.parseInt(getComputedStyle(confirmation.parentElement!).zIndex, 10))
        .toBeGreaterThan(Number.parseInt(getComputedStyle(drawer).zIndex, 10));
      const rows = Array.from(confirmation.querySelectorAll<HTMLButtonElement>("button"));
      expect(rows.map((row) => row.textContent?.trim())).toEqual(["Stay signed in", "Sign out"]);
      await expect.poll(() => rows.every((row) => row.getBoundingClientRect().height >= 44)).toBe(true);
      expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      if (dismiss === "cancel") {
        await browserPage.getByRole("button", { name: "Stay signed in", exact: true }).click();
      } else {
        await userEvent.keyboard("{Escape}");
      }
      await expect.poll(() => document.activeElement).toBe(trigger);
      await expect.poll(() => confirmation.isConnected).toBe(false);
      expect(drawer.isConnected).toBe(true);
      expect(signOut).not.toHaveBeenCalled();
      expect(__navigationCalls.filter((call) => call.kind === "goto")).toEqual([]);
      await browserPage.getByRole("button", { name: "Close workspace navigation", exact: true }).click();
      await expect.poll(() => drawer.isConnected).toBe(false);
    } finally {
      signOut.mockClear();
    }
  });
});
