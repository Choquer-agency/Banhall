import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import MemberRowMenu from "./MemberRowMenu.svelte";

function props(overrides: Record<string, unknown> = {}) {
  return {
    name: "Larry Moss",
    userId: "u-larry",
    role: "writer" as const,
    isSelf: false,
    onChangeRole: vi.fn(),
    onSetPassword: vi.fn(),
    ...overrides,
  };
}

async function open() {
  await userEvent.click(document.querySelector<HTMLElement>("[data-member-menu]")!);
  await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
}

describe("MemberRowMenu", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("changes a role from the submenu with a check on the current role", async () => {
    const p = props();
    await render(MemberRowMenu, p);
    await open();
    await page.getByRole("menuitem", { name: "Change role" }).hover();
    await expect.poll(() => document.querySelectorAll("[data-role-choice]").length).toBe(3);
    expect(document.querySelector('[data-role-choice="writer"]')?.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(document.querySelector<HTMLElement>('[data-role-choice="manager"]')!);
    expect(p.onChangeRole).toHaveBeenCalledWith("manager");
  });

  it("sets a temporary password and links to writing preferences", async () => {
    const p = props();
    await render(MemberRowMenu, p);
    await open();
    expect(document.querySelector<HTMLAnchorElement>('[data-menu-item="writing"]')?.getAttribute("href")).toBe(
      "/admin/users?user=u-larry",
    );
    await page.getByRole("menuitem", { name: "Set a temporary password" }).click();
    expect(p.onSetPassword).toHaveBeenCalledOnce();
  });

  it("never offers a temporary password for yourself", async () => {
    await render(MemberRowMenu, props({ isSelf: true }));
    await open();
    expect(document.querySelector('[data-menu-item="password"]')).toBeNull();
  });
});
