import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import InviteDialog from "./InviteDialog.svelte";

const dialog = () => document.querySelector<HTMLElement>('[data-testid="invite-dialog"]');
const sendButton = () => document.querySelector<HTMLButtonElement>("[data-send-invites]");
const chips = (kind: "valid" | "invalid") =>
  [...document.querySelectorAll(`[data-email-chip="${kind}"]`)].map((el) => el.textContent?.trim().split(/\s/)[0]);

async function typeEmails(value: string) {
  const input = page.getByLabelText("Email addresses");
  await input.click();
  await userEvent.keyboard(value);
}

describe("InviteDialog", () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.body.innerHTML = "";
    writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it("turns typed and pasted text into chips, flags invalid ones and collapses duplicates", async () => {
    await render(InviteDialog, { open: true, canInviteAdmin: false, onSend: vi.fn() });
    await expect.poll(dialog).not.toBeNull();
    expect(sendButton()?.disabled).toBe(true);
    expect(sendButton()?.textContent).toBe("Send invite");

    await typeEmails("k.osei@banhall.com,d.cole@banhall.com ");
    await typeEmails("oops{Enter}");
    await typeEmails("K.Osei@Banhall.com,");
    await expect.poll(() => chips("valid")).toEqual(["k.osei@banhall.com", "d.cole@banhall.com"]);
    expect(chips("invalid")).toEqual(["oops"]);
    expect(document.querySelector('[data-email-chip="invalid"]')?.textContent).toContain("Check this address");
    expect(sendButton()?.textContent).toBe("Send 2 invites");
    expect(sendButton()?.disabled).toBe(false);

    await page.getByRole("button", { name: "Remove oops" }).click();
    await expect.poll(() => chips("invalid")).toEqual([]);
  });

  it("offers Admin only to viewers who may invite Admins, defaulting to Consultant", async () => {
    await render(InviteDialog, { open: true, canInviteAdmin: false, onSend: vi.fn() });
    await expect.poll(dialog).not.toBeNull();
    const roles = () => [...document.querySelectorAll("[data-role-option]")].map((el) => el.getAttribute("data-role-option"));
    expect(roles()).toEqual(["writer", "manager"]);
    expect(dialog()?.textContent).toContain("Writes PDs, sees every project");
    expect(dialog()?.textContent).toContain("Also invites Consultants and Managers");
    expect(dialog()?.textContent).not.toContain("Note");
    expect(document.querySelector<HTMLInputElement>('input[value="writer"]')?.checked).toBe(true);

    cleanup();
    await render(InviteDialog, { open: true, canInviteAdmin: true, onSend: vi.fn() });
    await expect.poll(roles).toEqual(["writer", "manager", "admin"]);
    expect(dialog()?.textContent).toContain("Also runs Admin and changes roles");
  });

  it("sends every address with the chosen role and shows links to copy and failures", async () => {
    const onSend = vi.fn(async () => [
      { email: "k.osei@banhall.com", status: "created" as const, token: "tok-k" },
      { email: "member@banhall.com", status: "already_member" as const },
      { email: "waiting@banhall.com", status: "already_invited" as const },
      { email: "d.cole@banhall.com", status: "created" as const, token: "tok-d" },
    ]);
    await render(InviteDialog, { open: true, canInviteAdmin: true, origin: "https://banhall.app", onSend });
    await typeEmails("k.osei@banhall.com member@banhall.com waiting@banhall.com d.cole@banhall.com ");
    await page.getByText("Manager", { exact: true }).click();
    await userEvent.click(sendButton()!);

    await expect.poll(() => onSend.mock.calls.length).toBe(1);
    expect(onSend).toHaveBeenCalledWith(
      ["k.osei@banhall.com", "member@banhall.com", "waiting@banhall.com", "d.cole@banhall.com"],
      "manager",
    );
    await expect.poll(() => dialog()?.textContent).toContain("2 invites ready");
    expect(dialog()?.textContent).toContain("Copy each link and send it to the person. Each link works for 7 days.");
    expect(dialog()?.textContent).toContain("https://banhall.app/signup/tok-k");
    expect(dialog()?.textContent).toContain("Already has an account");
    expect(dialog()?.textContent).toContain("Already invited. Use Resend on the Team page.");
    expect(writeText).not.toHaveBeenCalled();

    const copyButtons = page.getByRole("button", { name: "Copy link" });
    await copyButtons.first().click();
    await expect.poll(() => writeText.mock.calls).toEqual([["https://banhall.app/signup/tok-k"]]);
    await expect.poll(() => dialog()?.textContent).toContain("Copied");
    await page.getByRole("button", { name: "Done" }).click();
    await expect.poll(dialog).toBeNull();
  });

  it("copies a single new link straight away and shows the typed address when it is still in the field", async () => {
    const onSend = vi.fn(async () => [{ email: "solo@banhall.com", status: "created" as const, token: "tok-solo" }]);
    await render(InviteDialog, { open: true, canInviteAdmin: false, origin: "https://banhall.app", onSend });
    await typeEmails("solo@banhall.com");
    await page.getByText("Role", { exact: true }).click();
    await expect.poll(() => sendButton()?.textContent).toBe("Send invite");
    await userEvent.click(sendButton()!);
    await expect.poll(() => writeText.mock.calls).toEqual([["https://banhall.app/signup/tok-solo"]]);
    expect(dialog()?.textContent).toContain("1 invite ready");
  });

  it("keeps the form and shows the error when sending fails", async () => {
    const onSend = vi.fn(async () => {
      throw new Error("Only an Admin can invite Admins");
    });
    await render(InviteDialog, { open: true, canInviteAdmin: false, onSend });
    await typeEmails("x@banhall.com ");
    await userEvent.click(sendButton()!);
    await expect.poll(() => document.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(dialog()?.textContent).toContain("Invite people");
  });

  it("draws C3 with the board scrim, role cards, chips and footer buttons", async () => {
    await page.viewport(1440, 900);
    await render(InviteDialog, { open: true, canInviteAdmin: true, onSend: vi.fn() });
    await expect.poll(dialog).not.toBeNull();
    const scrim = document.querySelector<HTMLElement>("[data-team-dialog-scrim]")!;
    expect(getComputedStyle(scrim).backgroundColor).toBe("rgba(1, 5, 5, 0.35)");
    expect(getComputedStyle(dialog()!).borderRadius).toBe("16px");
    const close = page.getByRole("button", { name: "Close" }).element();
    expect(close.querySelector("svg")?.getAttribute("width")).toBe("18");
    expect(close.querySelector("svg")?.getAttribute("stroke-width")).toBe("2");
    expect(close.querySelector("path")?.getAttribute("d")).toBe("M18 6 6 18M6 6l12 12");

    const card = (role: string) => document.querySelector<HTMLElement>(`[data-role-option="${role}"]`)!;
    expect(getComputedStyle(card("writer")).backgroundColor).toBe("rgb(247, 252, 251)");
    // 1.5px on the board; Chromium snaps it to device pixels, so check the class.
    expect(card("writer").className).toContain("border-[1.5px]");
    expect(getComputedStyle(card("writer")).borderTopColor).toBe("rgb(8, 122, 117)");
    expect(getComputedStyle(card("manager")).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(card("manager")).paddingTop).toBe("10px");
    expect(getComputedStyle(card("manager")).borderRadius).toBe("10px");
    expect(getComputedStyle(card("manager").querySelector<HTMLElement>("[data-role-chip]")!).borderRadius).toBe("4px");

    await typeEmails("k.osei@banhall.com ");
    await expect.poll(() => chips("valid")).toEqual(["k.osei@banhall.com"]);
    const chip = document.querySelector<HTMLElement>('[data-email-chip="valid"]')!;
    expect(chip.getBoundingClientRect().height).toBe(26);
    expect(getComputedStyle(chip).borderRadius).toBe("6px");
    const remove = chip.querySelector<HTMLElement>("button")!;
    expect(getComputedStyle(remove).color).toBe("rgb(147, 165, 161)");
    expect(remove.querySelector("svg")?.getAttribute("stroke-width")).toBe("1.8");
    const field = document.querySelector<HTMLElement>("[data-invite-email-chips]")!;
    expect(getComputedStyle(field).borderRadius).toBe("8px");

    const cancel = page.getByRole("button", { name: "Cancel" }).element() as HTMLElement;
    expect(getComputedStyle(cancel).backgroundColor).toBe("rgb(254, 226, 226)");
    expect(getComputedStyle(cancel).color).toBe("rgb(185, 28, 28)");
    expect(getComputedStyle(cancel).borderRadius).toBe("8px");
    expect(cancel.getBoundingClientRect().height).toBe(36);
    expect(getComputedStyle(sendButton()!).backgroundColor).toBe("rgb(10, 58, 56)");
    expect(getComputedStyle(sendButton()!).borderRadius).toBe("8px");
    await page.viewport(1280, 800);
  });
});
