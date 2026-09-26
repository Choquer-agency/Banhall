import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet } from "svelte";
import { render } from "vitest-browser-svelte";
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

  it("titles the page with the 28/34 serif Settings, 14px above the tabs and 24px above the section", async () => {
    await render(SettingsLayout, { children });
    await expect.poll(() => document.querySelector("[data-settings-title]")).not.toBeNull();
    const title = document.querySelector<HTMLElement>("[data-settings-title]")!;
    const style = getComputedStyle(title);
    expect([style.fontSize, style.lineHeight, style.fontWeight, style.letterSpacing]).toEqual([
      "28px",
      "34px",
      "400",
      "normal",
    ]);
    expect(style.fontFamily).toContain("Georgia");
    expect(style.color).toBe("rgb(22, 33, 31)");
    expect(getComputedStyle(title.parentElement!).rowGap).toBe("14px");
    const frame = document.querySelector<HTMLElement>("[data-settings-frame]")!;
    expect(getComputedStyle(frame).rowGap).toBe("24px");
    expect(document.querySelector('[data-settings-tab="notifications"]')?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector("[data-settings-child]")).not.toBeNull();
  });
});
