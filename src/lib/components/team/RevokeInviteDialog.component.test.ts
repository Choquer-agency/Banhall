import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
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
