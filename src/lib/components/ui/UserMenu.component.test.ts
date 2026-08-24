import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import UserMenu from "./UserMenu.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

describe("UserMenu", () => {
  beforeEach(() => {
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("turns the rail icon into a confirmed sign-out action", async () => {
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

    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Sign out"]');
    expect(trigger?.className).toContain("rounded-r-md");
    expect(trigger?.className).not.toContain("hover:bg-red-50");
    trigger?.click();
    await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.className).toContain("rounded-t-xl");
    expect(document.querySelector("[data-account-menu-identity]")).toBeNull();
    expect(document.body.textContent).toContain("Sign out?");
    expect(document.body.textContent).toContain("Sign out");
    expect(document.body.textContent).toContain("Stay signed in");
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
