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
});
