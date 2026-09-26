import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { __resetPage, __setPageParams } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { LAST_ACCOUNT_KEY, readLastAccount, rememberAccount } from "$lib/auth/lastAccount";

const signUpEmail = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const replaceLocation = vi.hoisted(() => vi.fn());

vi.mock("$lib/authClient", () => ({ authClient: { signUp: { email: signUpEmail }, signOut } }));
vi.mock("$lib/auth/replaceLocation", () => ({ replaceLocation }));
vi.mock("$lib/uploads/attemptOutbox", () => ({ clearAllOutboxes: vi.fn() }));

import SignupPage from "./+page.svelte";

const SENT = Date.parse("2026-09-25T18:00:00Z");
const EXPIRES = Date.parse("2026-10-02T18:00:00Z");

const PENDING = {
  state: "pending",
  email: "ana.ruiz@banhall.com",
  firstName: "Ana",
  lastName: "Ruiz",
  role: "writer",
  inviter: { name: "Bryce Choquer", initials: "BC" },
  sentAt: SENT,
  expiresAt: EXPIRES,
};

function setInputValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const createButton = () => document.querySelector<HTMLButtonElement>("[data-create-account]");
const text = () => document.body.textContent ?? "";

describe("/signup/[token]", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetAuthState();
    __setAuthState({ isLoading: false, isAuthenticated: false });
    __setPageParams({ token: "tok-ana" });
    localStorage.removeItem(LAST_ACCOUNT_KEY);
    signUpEmail.mockReset();
    signOut.mockReset().mockResolvedValue(undefined);
    replaceLocation.mockReset();
  });

  it("welcomes a pending invitee with the banner, names and email (J5)", async () => {
    __setQueryData("invites:getInviteByToken", PENDING);
    render(SignupPage);

    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("Welcome to Banhall, Ana");
    expect(text()).toContain("You will sign in with ana.ruiz@banhall.com.");
    const banner = document.querySelector("[data-invite-banner]")!;
    expect(banner.textContent).toContain("Bryce Choquer invited you to join as");
    expect(banner.textContent).toContain("Consultant");
    expect(banner.textContent).toContain("Join by Friday, Oct 2.");
    expect(document.querySelector<HTMLInputElement>("#firstName")?.value).toBe("Ana");
    expect(document.querySelector<HTMLInputElement>("#lastName")?.value).toBe("Ruiz");
    expect(createButton()?.disabled).toBe(true);
    expect(createButton()?.textContent).toBe("Create account and join");
  });

  it("asks for names when the invite has none (decision 51)", async () => {
    __setQueryData("invites:getInviteByToken", { ...PENDING, firstName: null, lastName: null });
    render(SignupPage);

    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("Welcome to Banhall");
    expect(document.querySelector<HTMLInputElement>("#firstName")?.value).toBe("");
    setInputValue("#password", "long enough");
    await expect.poll(() => createButton()?.disabled).toBe(true);
    setInputValue("#firstName", "Ana");
    setInputValue("#lastName", "Ruiz");
    await expect.poll(() => createButton()?.disabled).toBe(false);
  });

  it("shows the live password rule", async () => {
    __setQueryData("invites:getInviteByToken", PENDING);
    render(SignupPage);
    await expect.poll(() => document.querySelector("[data-password-rule]")?.getAttribute("data-password-rule")).toBe("unmet");
    expect(document.querySelector("[data-password-rule]")?.textContent).toContain("At least 8 characters");
    setInputValue("#password", "1234567");
    await expect.poll(() => createButton()?.disabled).toBe(true);
    setInputValue("#password", "12345678");
    await expect.poll(() => document.querySelector("[data-password-rule]")?.getAttribute("data-password-rule")).toBe("met");
    expect(createButton()?.disabled).toBe(false);
  });

  it("confirms trimmed names before signing up, then remembers the account and opens Home", async () => {
    __setQueryData("invites:getInviteByToken", PENDING);
    let confirmedBeforeSignUp = false;
    signUpEmail.mockImplementation(async () => {
      confirmedBeforeSignUp = __mutationCalls("invites:confirmInviteNames").length === 1;
      return { data: {}, error: null };
    });
    render(SignupPage);
    await expect.poll(() => document.querySelector("#firstName")).not.toBeNull();
    setInputValue("#firstName", "  Ana ");
    setInputValue("#lastName", " Ruiz-Lopez ");
    setInputValue("#password", "correct horse");
    await expect.poll(() => createButton()?.disabled).toBe(false);
    createButton()!.click();

    await expect.poll(() => replaceLocation.mock.calls).toEqual([["/my-work"]]);
    expect(__mutationCalls("invites:confirmInviteNames")).toEqual([
      { token: "tok-ana", firstName: "Ana", lastName: "Ruiz-Lopez" },
    ]);
    expect(confirmedBeforeSignUp).toBe(true);
    expect(signUpEmail.mock.calls[0]?.[0]).toMatchObject({
      email: "ana.ruiz@banhall.com",
      password: "correct horse",
      name: "Ana Ruiz-Lopez",
      fetchOptions: { body: { inviteToken: "tok-ana" } },
    });
    expect(readLastAccount()).toMatchObject({ email: "ana.ruiz@banhall.com", name: "Ana Ruiz-Lopez", firstName: "Ana" });
    await expect.poll(text).toContain("Account created");
  });

  it("shows the server's message above the button when joining fails", async () => {
    __setQueryData("invites:getInviteByToken", PENDING);
    __setMutationError("invites:confirmInviteNames", new Error("This invite has expired"));
    render(SignupPage);
    await expect.poll(() => document.querySelector("#password")).not.toBeNull();
    setInputValue("#password", "correct horse");
    await expect.poll(() => createButton()?.disabled).toBe(false);
    createButton()!.click();
    await expect.poll(() => document.querySelector('[role="alert"]')).not.toBeNull();
    expect(signUpEmail).not.toHaveBeenCalled();
    expect(replaceLocation).not.toHaveBeenCalled();
  });

  it("explains an expired invite and offers a mailto to the inviter (J6)", async () => {
    __setQueryData("invites:getInviteByToken", {
      state: "expired",
      role: "writer",
      inviter: { name: "Bryce Choquer", firstName: "Bryce", email: "bryce@banhall.com" },
      sentAt: SENT,
      expiresAt: EXPIRES,
    });
    render(SignupPage);

    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("Your invite has expired");
    expect(text()).toContain("Invites last 7 days. Ask Bryce to send you a new one.");
    expect(text()).toContain("Bryce Choquer invited you");
    expect(text()).toContain("Sent Sep 25. Expired Oct 2.");
    const mail = document.querySelector<HTMLAnchorElement>("[data-email-inviter]")!;
    expect(mail.textContent).toBe("Email Bryce for a new invite");
    const href = new URL(mail.href);
    expect(href.protocol).toBe("mailto:");
    expect(href.pathname).toBe("bryce@banhall.com");
    expect(href.searchParams.get("subject")).toBe("New Banhall invite");
    expect(href.searchParams.get("body")).toBe(
      "Hi Bryce, my Banhall invite has expired. Could you send me a new link?",
    );
    expect(page.getByRole("link", { name: "Sign in" }).element().getAttribute("href")).toBe("/login");
  });

  it("asks for an Admin when the expired invite has no inviter email", async () => {
    __setQueryData("invites:getInviteByToken", {
      state: "expired",
      role: "writer",
      inviter: null,
      sentAt: SENT,
      expiresAt: EXPIRES,
    });
    render(SignupPage);
    await expect.poll(text).toContain("Invites last 7 days. Ask an Admin to send you a new one.");
    expect(document.querySelector("[data-email-inviter]")).toBeNull();
  });

  it("keeps the invalid-link state for revoked, replaced and used links", async () => {
    __setQueryData("invites:getInviteByToken", { state: "unavailable" });
    render(SignupPage);
    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("This invite link isn't valid");
    expect(text()).toContain(
      "It may have been revoked, replaced by a newer link, or already used. Ask your team for a new invite.",
    );
    expect(document.querySelector("[data-invite-banner]")).toBeNull();
  });

  it("asks a signed-in visitor to sign out first and forgets the remembered account", async () => {
    __setAuthState({ isAuthenticated: true });
    rememberAccount({ email: "someone@banhall.com", name: "Someone Else" });
    __setQueryData("invites:getInviteByToken", PENDING);
    render(SignupPage);
    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("You're already signed in");
    expect(text()).toContain("Sign out first to accept this invite for ana.ruiz@banhall.com.");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.poll(() => signOut.mock.calls.length).toBe(1);
    await expect.poll(() => readLastAccount()).toBeNull();
  });

  it("wraps the banner onto two lines on a phone (J9)", async () => {
    await page.viewport(390, 844);
    try {
      __setQueryData("invites:getInviteByToken", PENDING);
      render(SignupPage);
      await expect.poll(() => document.querySelector("[data-invite-banner]")).not.toBeNull();
      const visible = [...document.querySelectorAll("[data-invite-banner] p")].filter(
        (el) => getComputedStyle(el).display !== "none",
      );
      expect(visible.map((el) => el.textContent?.replace(/\s+/g, " ").trim())).toEqual([
        "Bryce Choquer invited you as Consultant",
        "Join by Friday, Oct 2.",
      ]);
      const column = document.querySelector<HTMLElement>("[data-auth-column]")!;
      // J9: 20px sides; the 52px logo 40px under the banner, 24px above the column.
      expect(Math.round(column.getBoundingClientRect().width)).toBe(390 - 40);
      const banner = document.querySelector<HTMLElement>("[data-invite-banner]")!.getBoundingClientRect();
      const logo = document.querySelector<HTMLImageElement>("[data-banhall-logo]")!.getBoundingClientRect();
      expect(Math.round(logo.height)).toBe(52);
      expect(Math.round(logo.top - banner.bottom)).toBe(40);
      expect(Math.round(column.getBoundingClientRect().top - logo.bottom)).toBe(24);
      expect(document.querySelector("[data-auth-footer]")).toBeNull();
    } finally {
      await page.viewport(1280, 800);
    }
  });

  it("draws the J5 banner and password rule in the board colours", async () => {
    __setQueryData("invites:getInviteByToken", PENDING);
    render(SignupPage);
    await expect.poll(() => document.querySelector("[data-invite-banner]")).not.toBeNull();
    const banner = document.querySelector<HTMLElement>("[data-invite-banner]")!;
    expect(banner.getBoundingClientRect().height).toBe(48);
    expect(getComputedStyle(banner).backgroundColor).toBe("rgb(227, 244, 241)");
    const avatar = banner.querySelector<HTMLElement>("[data-avatar]")!;
    expect(getComputedStyle(avatar).backgroundColor).toBe("rgb(46, 119, 114)");
    expect(getComputedStyle(avatar).fontWeight).toBe("500");
    expect(getComputedStyle(avatar).fontSize).toBe("10px");
    const joinBy = [...banner.querySelectorAll<HTMLElement>("[data-invite-join-by]")].find(
      (el) => el.offsetParent !== null,
    )!;
    expect(getComputedStyle(joinBy).color).toBe("rgb(51, 96, 91)");
    // J5 has no footer.
    expect(document.querySelector("[data-auth-footer]")).toBeNull();

    setInputValue("#password", "long enough");
    const rule = () => document.querySelector<HTMLElement>("[data-password-rule]")!;
    await expect.poll(() => rule().dataset.passwordRule).toBe("met");
    const mark = rule().querySelector<HTMLElement>("[data-password-rule-mark]")!;
    expect(getComputedStyle(mark).backgroundColor).toBe("rgb(220, 252, 231)");
    const check = mark.querySelector("svg")!;
    expect(check.getAttribute("width")).toBe("9");
    expect(check.getAttribute("stroke-width")).toBe("3.2");
    expect(getComputedStyle(check).color).toBe("rgb(22, 101, 52)");
    expect(getComputedStyle(rule().querySelector("span:last-child")!).color).toBe("rgb(22, 101, 52)");
  });

  it("fades the expired inviter to the board grey-teal and uses the amber Expired chip (J6)", async () => {
    __setQueryData("invites:getInviteByToken", {
      state: "expired",
      role: "writer",
      inviter: { name: "Bryce Choquer", firstName: "Bryce", email: "bryce@banhall.com" },
      sentAt: SENT,
      expiresAt: EXPIRES,
    });
    render(SignupPage);
    await expect.poll(() => document.querySelector("[data-invite-expired] [data-avatar]")).not.toBeNull();
    const avatar = document.querySelector<HTMLElement>("[data-invite-expired] [data-avatar]")!;
    expect(getComputedStyle(avatar).backgroundColor).toBe("rgb(185, 207, 203)");
    expect(getComputedStyle(avatar).opacity).toBe("1");
    const chip = [...document.querySelectorAll<HTMLElement>("[data-invite-expired] span")].find(
      (el) => el.textContent === "Expired",
    )!;
    expect(getComputedStyle(chip).backgroundColor).toBe("rgb(254, 243, 199)");
    expect(getComputedStyle(chip).color).toBe("rgb(146, 64, 14)");
    expect(document.querySelector("[data-auth-footer]")).toBeNull();
  });
});
