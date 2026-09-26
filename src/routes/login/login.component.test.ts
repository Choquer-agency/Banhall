import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import { __resetConvexStub } from "$lib/test/convex-svelte-stub.svelte";
import { page } from "vitest/browser";
import { LAST_ACCOUNT_KEY, readLastAccount, rememberAccount } from "$lib/auth/lastAccount";

const signInEmail = vi.hoisted(() => vi.fn());

// The real client talks to /api/auth; the page only needs signIn.email.
vi.mock("$lib/authClient", () => ({ authClient: { signIn: { email: signInEmail } } }));

import LoginPage from "./+page.svelte";

function setInputValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(email: string | null, password: string) {
  await expect.poll(() => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  if (email !== null) setInputValue("#email", email);
  setInputValue("#password", password);
  document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
}

const invalid = (selector: string) =>
  document.querySelector(selector)?.closest("[data-auth-input]")?.getAttribute("data-invalid") === "true";
const wrongCredentials = {
  data: null,
  error: { status: 401, statusText: "Unauthorized", code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
};

const alertText = () => document.querySelector('[role="alert"]')?.textContent?.trim();

describe("/login", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetAuthState();
    __setAuthState({ isLoading: false, isAuthenticated: false });
    __setPageUrl("/login");
    __resetConvexStub();
    localStorage.removeItem(LAST_ACCOUNT_KEY);
    signInEmail.mockReset();
  });

  it("tells people on an untrusted address to use the usual address, not to check their password", async () => {
    // Signing in from 127.0.0.1 or a LAN address: Better Auth answers 403.
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 403, statusText: "Forbidden", code: "INVALID_ORIGIN", message: "Invalid origin" },
    });
    render(LoginPage);
    await submit("writer@banhall.com", "correct horse battery");

    await expect.poll(alertText).toBe("Open Banhall at its usual address to sign in.");
    expect(document.body.textContent).not.toContain("email address and password");
    expect(__navigationCalls).toEqual([]);
  });

  it("marks both fields and never says which was wrong (J2)", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, statusText: "Unauthorized", code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    });
    render(LoginPage);
    await submit("writer@banhall.com", "wrong password");

    await expect.poll(alertText).toBe("Wrong email or password. Check both and try again.");
    // J2: both fields go red and the one message describes both.
    expect(invalid("#email")).toBe(true);
    expect(invalid("#password")).toBe(true);
    expect(document.querySelector("#email")?.getAttribute("aria-describedby")).toBe("sign-in-error");
    expect(document.querySelector("#password")?.getAttribute("aria-describedby")).toContain("sign-in-error");
  });

  it("returns a signed-in visitor to the page in next", async () => {
    __setPageUrl("/login?next=%2Fproject%2Fp1%3Ftab%3Dreport");
    __setAuthState({ isAuthenticated: true });
    render(LoginPage);

    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/project/p1?tab=report" }]);
  });

  it("ignores a foreign next and goes to the dashboard", async () => {
    __setPageUrl("/login?next=https%3A%2F%2Fevil.example%2Fphish");
    __setAuthState({ isAuthenticated: true });
    render(LoginPage);

    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/dashboard" }]);
  });

  it("goes to the dashboard without next, and not while the session is still loading", async () => {
    __setAuthState({ isLoading: true, isAuthenticated: false });
    render(LoginPage);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__navigationCalls).toEqual([]);

    __setAuthState({ isLoading: false, isAuthenticated: true });
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/dashboard" }]);
  });

  it("shows the J1 layout and copy without the old brand panel", async () => {
    render(LoginPage);
    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("Sign in");
    expect(document.body.textContent).toContain("Use your @banhall.com email.");
    expect(document.body.textContent).toContain("Banhall Consulting Ltd.");
    expect(document.body.textContent).toContain("Need access? Ask your team for an invite.");
    expect(document.querySelector("#email")?.getAttribute("placeholder")).toBe("you@banhall.com");
    expect(document.querySelector("#password")?.getAttribute("placeholder")).toBe("Enter your password");
    expect(document.querySelector('[data-auth-column]')?.getAttribute("style")).toContain("max-width: 360px");
    expect(document.body.textContent).not.toContain("The interview is the evidence");
    expect(document.querySelector("[data-account-card]")).toBeNull();
  });

  it("shows and hides the password", async () => {
    render(LoginPage);
    await expect.poll(() => document.querySelector<HTMLInputElement>("#password")?.type).toBe("password");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect.poll(() => document.querySelector<HTMLInputElement>("#password")?.type).toBe("text");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect.poll(() => document.querySelector<HTMLInputElement>("#password")?.type).toBe("password");
  });

  it("toggles the Forgot password note without sending anything", async () => {
    render(LoginPage);
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect.poll(() => document.querySelector("[data-forgot-note]")?.textContent?.trim()).toBe(
      "Ask an Admin to set a temporary password for you. You can change it in Settings after you sign in.",
    );
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect.poll(() => document.querySelector("[data-forgot-note]")).toBeNull();
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("greets a returning account and signs in with its email and only a password (J3)", async () => {
    rememberAccount({ email: "ana.ruiz@banhall.com", firstName: "Ana", lastName: "Ruiz" });
    signInEmail.mockResolvedValue({ data: {}, error: null });
    render(LoginPage);

    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("Welcome back, Ana");
    expect(document.body.textContent).toContain("You were signed out. Sign back in to keep going.");
    const card = document.querySelector("[data-account-card]")!;
    expect(card.textContent).toContain("Ana Ruiz");
    expect(card.textContent).toContain("ana.ruiz@banhall.com");
    expect(document.querySelector("#email")).toBeNull();
    const username = document.querySelector<HTMLInputElement>("[data-hidden-username]");
    expect(username?.autocomplete).toBe("username");
    expect(username?.value).toBe("ana.ruiz@banhall.com");
    await expect.poll(() => document.activeElement?.id).toBe("password");

    await submit(null, "correct horse battery");
    await expect.poll(() => signInEmail.mock.calls[0]?.[0]).toEqual({
      email: "ana.ruiz@banhall.com",
      password: "correct horse battery",
    });
  });

  it("blames only the password for a known account (J4)", async () => {
    rememberAccount({ email: "ana.ruiz@banhall.com", firstName: "Ana", lastName: "Ruiz" });
    signInEmail.mockResolvedValue(wrongCredentials);
    render(LoginPage);
    await expect.poll(() => document.querySelector("[data-account-card]")).not.toBeNull();
    await submit(null, "wrong password");

    await expect.poll(alertText).toBe("Wrong password. Try again.");
    expect(invalid("#password")).toBe(true);
    expect(document.querySelector("#email")).toBeNull();
  });

  it("forgets the stored account on Use another account and shows J1 empty", async () => {
    rememberAccount({ email: "ana.ruiz@banhall.com", firstName: "Ana", lastName: "Ruiz" });
    render(LoginPage);
    await page.getByRole("button", { name: "Use another account" }).click();

    await expect.poll(() => document.querySelector("h1")?.textContent).toBe("Sign in");
    expect(readLastAccount()).toBeNull();
    expect(document.querySelector<HTMLInputElement>("#email")?.value).toBe("");
    await expect.poll(() => document.activeElement?.id).toBe("email");
  });

  it("remembers the email after a successful sign-in", async () => {
    signInEmail.mockResolvedValue({ data: {}, error: null });
    render(LoginPage);
    await submit(" Sam@Banhall.com ", "correct horse battery");
    await expect.poll(() => readLastAccount()?.email).toBe("sam@banhall.com");
    await expect.poll(() => document.body.textContent).toContain("Signing you in...");
  });

  it("keeps the rate-limit and offline messages in the same slot without marking the fields", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 429, statusText: "Too Many Requests", message: "Too many requests" },
    });
    render(LoginPage);
    await submit("writer@banhall.com", "correct horse battery");
    await expect.poll(alertText).toBe("Too many sign-in attempts. Wait a minute, then try again.");
    expect(invalid("#email")).toBe(false);
    expect(invalid("#password")).toBe(false);

    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    signInEmail.mockResolvedValue(wrongCredentials);
    await submit("writer@banhall.com", "correct horse battery");
    await expect.poll(alertText).toBe("You're offline. Reconnect and try signing in again.");
    onLine.mockRestore();
  });

  it("fills the phone width and keeps only the invite line in the footer (J8)", async () => {
    await page.viewport(390, 844);
    try {
      render(LoginPage);
      await expect.poll(() => document.querySelector("h1")?.textContent).toBe("Sign in");
      const column = document.querySelector<HTMLElement>("[data-auth-column]")!;
      expect(Math.round(column.getBoundingClientRect().width)).toBe(390 - 48);
      const footer = [...document.querySelectorAll("footer span")].filter(
        (el) => getComputedStyle(el).display !== "none",
      );
      expect(footer.map((el) => el.textContent)).toEqual(["Need access? Ask your team for an invite."]);
    } finally {
      await page.viewport(1280, 800);
    }
  });
});
