import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { resolve } from "$app/paths";
import { goto } from "$app/navigation";
import { toast } from "svelte-sonner";
import { authClient } from "$lib/authClient";
import { clearAllOutboxes } from "$lib/uploads/attemptOutbox";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import UserMenu from "./UserMenu.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$app/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/test/app-navigation-stub")>();
  return { ...actual, goto: vi.fn(actual.goto) };
});

vi.mock("$lib/uploads/attemptOutbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/uploads/attemptOutbox")>();
  return { ...actual, clearAllOutboxes: vi.fn() };
});

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn(async () => {}) } }));

describe("UserMenu", () => {
  beforeEach(() => {
    __resetConvexStub();
    __resetNavigation();
    __resetPage();
    vi.mocked(goto).mockReset();
    vi.mocked(authClient.signOut).mockReset().mockResolvedValue(undefined);
    vi.mocked(clearAllOutboxes).mockClear();
    document.body.innerHTML = "";
  });

  afterEach(() => vi.restoreAllMocks());

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
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.className).toContain("rounded-t-xl");
    expect(document.querySelector("[data-account-menu-identity]")).toBeNull();
    expect(document.body.textContent).toContain("Sign out?");
    expect(document.body.textContent).toContain("Sign out");
    expect(document.body.textContent).toContain("Stay signed in");
    expect(page.getByRole("menuitem", { name: "Settings", exact: true }).elements()).toHaveLength(0);
    await page.getByRole("button", { name: "Stay signed in", exact: true }).click();
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger);
    expect(authClient.signOut).not.toHaveBeenCalled();
    expect(__navigationCalls).toEqual([]);
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
    await expect.element(page.getByRole("menuitem", { name: "Sign out", exact: true })).toBeVisible();
    await expect.poll(() => getComputedStyle(page.getByRole("menu").element()).opacity).toBe("1");
    await page.screenshot({ path: "../../../../.vitest-attachments/Q6/avatar-current.png" });
  });

  describe.each(["writer", "manager", "admin"])("%s avatar navigation", (role) => {
    it.each(["pointer", "keyboard"])("opens Settings once using %s and closes the menu", async (input) => {
      __setQueryData("users:getCurrentUser", {
        firstName: "Account",
        lastName: "Writer",
        email: "writer@example.com",
        role,
      });
      if (role === "writer" && input === "pointer") await page.viewport(333, 720);
      await render(UserMenu, { tone: "light", menuTheme: "light" });
      const trigger = page.getByRole("button", { name: "Account menu", exact: true });
      if (input === "keyboard") {
        const button = trigger.element();
        if (!(button instanceof HTMLButtonElement)) throw new Error("Missing account trigger");
        button.focus();
        await userEvent.keyboard(role === "writer" ? "{Enter}" : role === "manager" ? " " : "{ArrowDown}");
      } else {
        await trigger.click();
      }
      const settings = page.getByRole("menuitem", { name: "Settings", exact: true });
      await expect.element(settings, { timeout: 1000 }).toBeVisible();
      expect(settings.elements()).toHaveLength(1);
      expect(document.querySelector("[data-account-menu-identity]")?.textContent).toContain("Account Writer");
      await expect.element(page.getByRole("menuitem", { name: "Sign out", exact: true })).toBeVisible();
      expect(__navigationCalls).toEqual([]);
      if (role === "writer" && input === "pointer") {
        await expect.poll(() => getComputedStyle(page.getByRole("menu").element()).opacity).toBe("1");
        await page.screenshot({ path: "../../../../.vitest-attachments/Q6/avatar-account-writer-after.png" });
      }
      if (input === "keyboard") {
        await userEvent.keyboard("{Home}");
        await expect.element(settings).toHaveFocus();
        await userEvent.keyboard("{ArrowDown}");
        await expect.element(page.getByRole("menuitem", { name: "Sign out", exact: true })).toHaveFocus();
        await userEvent.keyboard("{ArrowUp}");
        await expect.element(settings).toHaveFocus();
        await userEvent.keyboard("{Escape}");
        await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
        await expect.element(trigger).toHaveFocus();
        expect(__navigationCalls).toEqual([]);
        expect(authClient.signOut).not.toHaveBeenCalled();
        await userEvent.keyboard("{ArrowDown}");
        await expect.element(settings).toHaveFocus();
        await userEvent.keyboard("{Enter}");
      } else {
        await settings.click();
      }
      await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: resolve("/settings") }]);
      await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
      await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
      expect(authClient.signOut).not.toHaveBeenCalled();
    });
  });

  it("reports rejected Settings navigation and allows a real-menu retry", async () => {
    __setQueryData("users:getCurrentUser", { firstName: "Account", lastName: "Writer", role: "writer" });
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "q6-toast");
    vi.mocked(goto).mockRejectedValueOnce(new Error("Route unavailable"));
    await render(UserMenu, { tone: "light", menuTheme: "light" });
    const trigger = page.getByRole("button", { name: "Account menu", exact: true });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await expect.poll(() => errorToast.mock.calls, { timeout: 1000 }).toEqual([
      ["Settings could not open. Please try again."],
    ]);
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith("/settings");
    expect(__navigationCalls).toEqual([]);
    expect(authClient.signOut).not.toHaveBeenCalled();
    await trigger.click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/settings" }]);
    expect(goto).toHaveBeenCalledTimes(2);
    expect(errorToast).toHaveBeenCalledTimes(1);
  });

  it("keeps avatar sign-out single-flight until the existing login navigation completes", async () => {
    __setQueryData("users:getCurrentUser", { firstName: "Account", lastName: "Writer", role: "writer" });
    let finishSignOut: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finishSignOut = resolve; });
    vi.mocked(authClient.signOut).mockReturnValueOnce(pending);
    await render(UserMenu, { tone: "light", menuTheme: "light" });
    const trigger = page.getByRole("button", { name: "Account menu", exact: true });
    await trigger.click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
    expect(clearAllOutboxes).not.toHaveBeenCalled();
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
    expect(__navigationCalls).toEqual([]);
    await trigger.click();
    const busyItem = page.getByRole("menuitem", { name: "Signing out…", exact: true });
    await expect.element(busyItem).toHaveAttribute("aria-disabled", "true");
    // Deliberately dispatch on the disabled real item; pointer tooling refuses
    // disabled elements before their own handler can be exercised.
    busyItem.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
    expect(__navigationCalls).toEqual([]);
    if (!finishSignOut) throw new Error("Missing sign-out completion");
    finishSignOut();
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/login" }]);
    expect(clearAllOutboxes).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith("/login", { replaceState: true, invalidateAll: true });
    await expect.element(page.getByRole("menuitem", { name: "Sign out", exact: true })).not.toHaveAttribute("aria-disabled", "true");
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
  });

});
