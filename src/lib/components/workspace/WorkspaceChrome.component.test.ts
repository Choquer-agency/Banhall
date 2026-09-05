import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import WorkspaceChrome from "./WorkspaceChrome.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

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

  /**
   * The drawer footer is a Settings link plus a confirmed sign-out (66f131b
   * replaced the account dropdown). The nested Sign out dialog has to clear
   * the z-110 drawer, keep 44px controls, and hand focus back on cancel.
   */
  it("autofocuses the modal drawer and layers its confirmed sign-out above it", async () => {
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
    await expect.poll(() => document.querySelector("[data-workspace-drawer]")).not.toBeNull();
    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("Close workspace navigation");

    const drawer = document.querySelector<HTMLElement>("[data-workspace-drawer]")!;
    const drawerLayer = Number.parseInt(getComputedStyle(drawer).zIndex, 10);
    const settings = await browserPage
      .elementLocator(drawer)
      .getByRole("link", { name: "Settings" })
      .element();
    expect(settings.getAttribute("href")).toBe("/settings");

    const signOutTrigger = await browserPage
      .elementLocator(drawer)
      .getByRole("button", { name: "Sign out" })
      .element();
    await browserPage.elementLocator(signOutTrigger).click();

    const confirm = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find((node) =>
        node.textContent?.includes("Sign out?")
      );
    await expect.poll(confirm).toBeTruthy();

    const dialog = confirm()!;
    expect(dialog.getBoundingClientRect().height).toBeGreaterThan(0);
    // The portalled wrapper carries the layer; the panel itself is unstacked.
    const layer = Number.parseInt(getComputedStyle(dialog.parentElement!).zIndex, 10);
    expect(layer).toBeGreaterThan(drawerLayer);

    // Measure after the sanctioned scale/fade settles; transformed in-flight
    // bounds are intentionally smaller than the layout box.
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
    expect(controls.length).toBeGreaterThan(1);
    await expect
      .poll(() => controls.every((control) => control.getBoundingClientRect().height >= 44))
      .toBe(true);

    // Cancel only: confirming would sign a real session out.
    await browserPage.elementLocator(dialog).getByRole("button", { name: "Stay signed in" }).click();
    await expect.poll(confirm).toBeUndefined();
    await expect.poll(() => document.activeElement).toBe(signOutTrigger);
    expect(__navigationCalls.filter((call) => call.kind === "goto")).toHaveLength(0);
  });
});
