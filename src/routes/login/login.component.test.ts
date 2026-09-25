import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";

const signInEmail = vi.hoisted(() => vi.fn());

// The real client talks to /api/auth; the page only needs signIn.email.
vi.mock("$lib/authClient", () => ({ authClient: { signIn: { email: signInEmail } } }));

import LoginPage from "./+page.svelte";

function setInputValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(email: string, password: string) {
  await expect.poll(() => document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  setInputValue("#email", email);
  setInputValue("#password", password);
  document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
}

const alertText = () => document.querySelector('[role="alert"]')?.textContent?.trim();

describe("/login", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetAuthState();
    __setAuthState({ isLoading: false, isAuthenticated: false });
    __setPageUrl("/login");
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

  it("keeps the password message for wrong credentials", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, statusText: "Unauthorized", code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    });
    render(LoginPage);
    await submit("writer@banhall.com", "wrong password");

    await expect.poll(alertText).toBe("Check your @banhall.com email address and password.");
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
});
