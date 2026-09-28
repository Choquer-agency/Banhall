import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { createRawSnippet } from "svelte";
import { render } from "vitest-browser-svelte";
import SettingsLayout from "./+layout.svelte";
import AccountPage from "./account/+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$lib/authClient", () => ({
  authClient: {
    signOut: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ data: [], error: null })),
    getSession: vi.fn(async () => ({ data: null, error: null })),
    revokeSessions: vi.fn(async () => ({ data: { status: true }, error: null })),
  },
}));

/**
 * Lead direction 2026-09-28: on a wide screen the Settings page still fills
 * the window, but its forms keep a comfortable width: the tab content stops
 * at 64rem and every field column at 40rem.
 */
const wideChild = createRawSnippet(() => ({
  render: () => `<div data-wide-child style="width:100%;height:10px"></div>`,
}));

describe("Settings forms on a 2560px screen", () => {
  beforeEach(async () => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetAuthState();
    localStorage.clear();
    __setQueryData("workspaceRollout:getAccess", { available: true });
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
    __setQueryData("users:getCurrentUser", {
      _id: "u-1",
      firstName: "Audit",
      lastName: "Tester",
      email: "audit@banhall.com",
      role: "admin",
      imageUrl: null,
    });
    await page.viewport(2560, 1440);
  });

  it("fills the window with the panel and caps the tab content at 64rem", async () => {
    __setPageUrl("/settings/account");
    await render(SettingsLayout, { children: wideChild });
    await expect.poll(() => document.querySelector("[data-wide-child]")).not.toBeNull();

    const panel = document.querySelector<HTMLElement>("[data-work-panel]")!.getBoundingClientRect();
    expect(panel.width).toBeGreaterThan(2200);
    // The heading and tabs sit in the panel; the content column stops at 64rem.
    expect(document.querySelector<HTMLElement>("[data-settings-content]")!.getBoundingClientRect().width).toBe(1024);
    expect(document.querySelector<HTMLElement>("[data-wide-child]")!.getBoundingClientRect().width).toBe(1024);
  });

  it("keeps each Account field column at 40rem or less", async () => {
    await render(AccountPage, {});
    await expect.poll(() => document.querySelectorAll("[data-settings-field]").length).toBeGreaterThan(3);

    for (const field of document.querySelectorAll<HTMLElement>("[data-settings-field]")) {
      expect(field.getBoundingClientRect().width).toBeLessThanOrEqual(640);
    }
    const names = [...document.querySelectorAll<HTMLInputElement>("[data-settings-name-input]")];
    expect(names).toHaveLength(2);
    for (const input of names) {
      expect(input.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    }
  });
});
