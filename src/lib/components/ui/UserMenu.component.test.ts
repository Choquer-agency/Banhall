import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import UserMenu from "./UserMenu.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

describe("UserMenu", () => {
  beforeEach(() => {
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("turns the rail trigger into a focused Settings and sign-out menu", async () => {
    __setQueryData("users:getCurrentUser", {
      firstName: "Admin",
      lastName: "Writer",
      email: "admin@example.com",
      role: "admin",
    });
    await render(UserMenu, {
      tone: "light",
      menuTheme: "light",
      triggerVariant: "rail",
    });

    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Settings menu"]');
    expect(trigger?.className).toContain("rounded-md");
    expect(trigger?.className).not.toContain("rounded-lg");
    trigger?.click();
    await expect.poll(() => document.querySelector('[data-menu-layer="app"]')).not.toBeNull();

    const menu = document.querySelector<HTMLElement>('[data-menu-layer="app"]');
    expect(menu?.className).toContain("rounded-lg");
    expect(menu?.className).not.toContain("rounded-xl");
    expect(document.querySelector("[data-account-menu-identity]")).toBeNull();
    expect(document.body.textContent).toContain("Open Settings");
    expect(document.body.textContent).toContain("Sign out");
    expect(document.body.textContent).not.toContain("Administration");
    expect(document.body.textContent).not.toContain("The Brain");
  });

  it("keeps signed-in identity in the app-bar avatar menu", async () => {
    __setQueryData("users:getCurrentUser", {
      firstName: "Admin",
      lastName: "Writer",
      email: "admin@example.com",
      role: "admin",
    });
    await render(UserMenu, { tone: "light", menuTheme: "light" });

    document.querySelector<HTMLButtonElement>('button[aria-label="Account menu"]')?.click();
    await expect.poll(() => document.querySelector("[data-account-menu-identity]")).not.toBeNull();
    expect(document.querySelector("[data-account-menu-identity]")?.textContent).toContain("Admin Writer");
    expect(document.body.textContent).not.toContain("Open Settings");
  });
});
