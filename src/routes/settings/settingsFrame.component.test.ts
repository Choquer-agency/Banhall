import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet } from "svelte";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import SettingsLayout from "./+layout.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const children = createRawSnippet(() => ({ render: () => "<p data-settings-child>Section</p>" }));

describe("Settings frame (I1 to I5)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetAuthState();
    __setPageUrl("/settings/notifications");
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryData("users:getCurrentUser", { _id: "u", role: "writer", firstName: "Ana", lastName: "Ruiz" });
  });

  it("names the section in the top bar; the Settings sidebar replaces the tabs from 768px (owner answer 1)", async () => {
    await page.viewport(1440, 900);
    await render(SettingsLayout, { children });
    await expect.poll(() => document.querySelector('[data-settings-sidebar="notifications"]')).not.toBeNull();
    // No second serif title: the bar names the section.
    expect(document.querySelector("[data-settings-title]")).toBeNull();
    expect(document.querySelector("[data-page-top-bar] h1")?.textContent).toBe("Notifications");
    expect(document.querySelector("[data-page-subtitle]")).toBeNull();
    const sidebar = document.querySelector<HTMLElement>('[data-section-sidebar="settings"]')!;
    expect(sidebar.querySelector("[data-section-sidebar-title]")?.textContent).toBe("Settings");
    const rows = [...sidebar.querySelectorAll<HTMLAnchorElement>("[data-settings-sidebar]")];
    expect(rows.map((row) => [row.textContent?.trim(), row.getAttribute("href")])).toEqual([
      ["Account", "/settings/account"],
      ["Notifications", "/settings/notifications"],
      ["Shortcuts", "/settings/shortcuts"],
      ["Writing", "/settings/writing"],
    ]);
    expect(sidebar.querySelector('[data-settings-sidebar="notifications"]')?.getAttribute("aria-current")).toBe("page");
    // The tabs are for phones only now.
    expect(document.querySelector<HTMLElement>("[data-settings-tabs]")!.getBoundingClientRect().width).toBe(0);
    expect(document.querySelector("[data-settings-child]")).not.toBeNull();
  });

  it("a phone keeps the tabs, 24px above the section, and no sidebar", async () => {
    await page.viewport(390, 844);
    await render(SettingsLayout, { children });
    await expect.poll(() => document.querySelector('[data-settings-tab="notifications"]')).not.toBeNull();
    expect(document.querySelector('[data-settings-tab="notifications"]')?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector<HTMLElement>("[data-settings-tabs]")!.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(document.querySelector<HTMLElement>("[data-section-sidebar-slot]")!.getBoundingClientRect().width).toBe(0);
    const frame = document.querySelector<HTMLElement>("[data-settings-frame]")!;
    expect(getComputedStyle(frame).rowGap).toBe("24px");
  });
});
