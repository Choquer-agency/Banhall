import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import RevokeInviteDialog from "./RevokeInviteDialog.svelte";

describe("RevokeInviteDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("asks before revoking and keeps the invite on Keep invite", async () => {
    const onConfirm = vi.fn();
    await render(RevokeInviteDialog, { open: true, email: "m.tremblay@banhall.com", onConfirm });
    await expect.poll(() => document.body.textContent).toContain(
      "Revoke the invite for m.tremblay@banhall.com?",
    );
    expect(document.body.textContent).toContain(
      "The link stops working right away. You can invite them again later.",
    );
    const revoke = page.getByRole("button", { name: "Revoke invite" });
    // C5: a filled red confirm (white text) beside the chrome Keep invite, both 36px, radius 8.
    const revokeStyle = getComputedStyle(revoke.element());
    expect(revokeStyle.backgroundColor).toBe("rgb(220, 38, 38)");
    expect(revokeStyle.color).toBe("rgb(255, 255, 255)");
    expect(revokeStyle.borderRadius).toBe("8px");
    expect(revoke.element().getBoundingClientRect().height).toBe(36);
    const keepStyle = getComputedStyle(page.getByRole("button", { name: "Keep invite" }).element());
    expect(keepStyle.backgroundColor).toBe("rgb(234, 242, 241)");
    expect(keepStyle.borderRadius).toBe("8px");
    await page.getByRole("button", { name: "Keep invite" }).click();
    await expect.poll(() => document.querySelector('[data-testid="revoke-invite-dialog"]')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("C5: sits 320px down, centres on a short window, and focuses Keep invite without a ring", async () => {
    await page.viewport(1440, 900);
    try {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await render(RevokeInviteDialog, { open: true, email: "m.tremblay@banhall.com", onConfirm: vi.fn() });
      const dialog = () => document.querySelector<HTMLElement>('[data-testid="revoke-invite-dialog"]')!;
      await expect.poll(() => dialog()?.getBoundingClientRect().top).toBe(320);
      const keep = document.querySelector<HTMLElement>("[data-keep-invite]")!;
      await expect.poll(() => document.activeElement).toBe(keep);
      // Opened from a pointer: neither Keep invite nor the close button shows a ring.
      expect(getComputedStyle(keep).boxShadow).toBe("none");
      // The keyboard brings the rings back.
      await userEvent.keyboard("{Tab}");
      const revoke = page.getByRole("button", { name: "Revoke invite" }).element();
      await expect.poll(() => document.activeElement).toBe(revoke);
      expect(getComputedStyle(revoke).boxShadow).not.toBe("none");

      await page.viewport(1440, 500);
      await expect.poll(() => {
        const box = dialog().getBoundingClientRect();
        return Math.round(box.top - (500 - box.bottom));
      }).toBe(0);
    } finally {
      await page.viewport(1280, 800);
    }
  });

  it("confirms, and shows the busy label and any error", async () => {
    const onConfirm = vi.fn();
    await render(RevokeInviteDialog, {
      open: true,
      email: "a@banhall.com",
      onConfirm,
      busy: true,
      errorMessage: "Only pending invites can be revoked",
    });
    await expect.poll(() => document.body.textContent).toContain("Revoking...");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Only pending invites");

    cleanup();
    await render(RevokeInviteDialog, { open: true, email: "a@banhall.com", onConfirm });
    await page.getByRole("button", { name: "Revoke invite" }).click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
