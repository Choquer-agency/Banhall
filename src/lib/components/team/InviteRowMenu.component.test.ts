import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import InviteRowMenu from "./InviteRowMenu.svelte";

function props(overrides: Record<string, unknown> = {}) {
  return {
    email: "ana@banhall.com",
    role: "manager" as const,
    canInviteAdmin: false,
    onCopy: vi.fn(),
    onChangeRole: vi.fn(),
    onResend: vi.fn(),
    onRevoke: vi.fn(),
    ...overrides,
  };
}

async function open() {
  await userEvent.click(document.querySelector<HTMLElement>("[data-invite-menu]")!);
  await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
}

describe("InviteRowMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists the C4 items in order with Revoke last", async () => {
    await render(InviteRowMenu, props());
    await open();
    const items = [...document.querySelectorAll("[data-menu-item]")].map((el) => el.textContent?.trim());
    expect(items).toEqual(["Copy invite link", "Change role", "Resend invite", "Revoke invite"]);
  });

  it("copies and resends through the callbacks", async () => {
    const p = props();
    await render(InviteRowMenu, p);
    await open();
    await page.getByRole("menuitem", { name: "Copy invite link" }).click();
    expect(p.onCopy).toHaveBeenCalledOnce();
    await open();
    await page.getByRole("menuitem", { name: "Resend invite" }).click();
    expect(p.onResend).toHaveBeenCalledOnce();
    await open();
    await page.getByRole("menuitem", { name: "Revoke invite" }).click();
    expect(p.onRevoke).toHaveBeenCalledOnce();
  });

  it("offers Invite as Consultant or Manager with a check on the current role, Admin only for Admins", async () => {
    const p = props();
    await render(InviteRowMenu, p);
    await open();
    await page.getByRole("menuitem", { name: "Change role" }).hover();
    await expect.poll(() => document.querySelectorAll("[data-role-choice]").length).toBe(2);
    expect(document.body.textContent).toContain("Invite as");
    const current = document.querySelector('[data-role-choice="manager"]');
    expect(current?.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(document.querySelector<HTMLElement>('[data-role-choice="writer"]')!);
    expect(p.onChangeRole).toHaveBeenCalledWith("writer");

    cleanup();
    await render(InviteRowMenu, props({ canInviteAdmin: true }));
    await open();
    await page.getByRole("menuitem", { name: "Change role" }).hover();
    await expect.poll(() =>
      [...document.querySelectorAll("[data-role-choice]")].map((el) => el.getAttribute("data-role-choice")),
    ).toEqual(["writer", "manager", "admin"]);
  });

  it("draws the C4 menu with the board icons, sizes and the red Revoke", async () => {
    await render(InviteRowMenu, props());
    const trigger = document.querySelector<HTMLElement>("[data-invite-menu]")!;
    expect(trigger.getBoundingClientRect().width).toBe(28);
    expect(trigger.querySelector("path")?.getAttribute("d")).toBe("M6 12h.01 M12 12h.01 M18 12h.01");
    expect(trigger.querySelector("svg")?.getAttribute("stroke-width")).toBe("3");
    await open();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.offsetWidth).toBe(220);
    expect(getComputedStyle(menu).borderRadius).toBe("12px");
    expect(getComputedStyle(menu).paddingTop).toBe("6px");
    const item = (key: string) => document.querySelector<HTMLElement>(`[data-menu-item="${key}"]`)!;
    const path = (key: string) => item(key).querySelector("path")?.getAttribute("d");
    expect(path("copy")).toBe("M5 4.5h10.5a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z M5 17.5a3 3 0 0 1 3-3h10.5");
    expect(path("change-role")).toBe("M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2 21a7 7 0 0 1 14 0 M16 3.5a4 4 0 0 1 0 7 M18 14a7 7 0 0 1 4 7");
    expect(path("resend")).toBe("M19 12H5 M11 6l-6 6 6 6");
    expect(path("revoke")).toBe("M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4 M10 16l-4-4 4-4 M6 12h10");
    expect(item("copy").querySelector("svg")?.getAttribute("width")).toBe("15");
    expect(item("copy").offsetHeight).toBe(32);
    expect(getComputedStyle(item("copy")).fontSize).toBe("13px");
    expect(getComputedStyle(item("copy")).color).toBe("rgb(22, 33, 31)");
    expect(getComputedStyle(item("revoke")).color).toBe("rgb(220, 38, 38)");

    await page.getByRole("menuitem", { name: "Change role" }).hover();
    await expect.poll(() => document.querySelector('[data-role-choice="manager"] svg')).not.toBeNull();
    const check = document.querySelector<SVGElement>('[data-role-choice="manager"] svg')!;
    expect(check.getAttribute("width")).toBe("14");
    expect(check.getAttribute("stroke-width")).toBe("2.2");
    expect(getComputedStyle(check).color).toBe("rgb(8, 122, 117)");
    const chip = document.querySelector<HTMLElement>('[data-role-choice="manager"] [data-role-chip]')!;
    expect(getComputedStyle(chip).borderRadius).toBe("4px");
    expect(document.querySelector<HTMLElement>('[data-role-choice="manager"]')!.offsetHeight).toBe(34);
  });
});
