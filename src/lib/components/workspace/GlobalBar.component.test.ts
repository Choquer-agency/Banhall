import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import GlobalBar from "./GlobalBar.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { board, boardPx } from "$lib/test/boardScale";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn(async () => {}) } }));

/** The global bar (owner, 2026-10-28; Paper A1, S9): logo, bell, account. */
const BRYCE = { _id: "u-b", firstName: "Bryce", lastName: "Choquer", email: "bryce@banhall.com", role: "admin", isOwner: true, imageUrl: null };
const bar = () => document.querySelector<HTMLElement>("[data-global-bar]")!;
const style = (element: Element) => getComputedStyle(element);

describe("GlobalBar", () => {
  beforeEach(async () => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    viewAs.clear();
    document.body.innerHTML = "";
    await page.viewport(1440, 900);
  });

  it("A1 values: 52px, the 83 by 37 logo (10% larger, owner 2026-11-05) 14px in, then the bell and the account 6px apart, 20px from the edge", async () => {
    __setQueryData("users:getCurrentUser", BRYCE);
    __setQueryData("changelog:unseenCount", 0);
    const view = await render(GlobalBar, { homeHref: "/my-work" });
    view.container.style.width = "1440px";
    await expect.poll(() => document.querySelector("[data-global-bar-account-name]")?.textContent).toBe("Bryce Choquer");
    const frame = bar().getBoundingClientRect();
    expect(frame.height).toBeCloseTo(board(52), 1);
    const logoLink = document.querySelector<HTMLAnchorElement>("[data-global-bar-logo]")!;
    expect([logoLink.getAttribute("href"), logoLink.getAttribute("aria-label")]).toEqual(["/my-work", "Banhall home"]);
    const logo = logoLink.querySelector<HTMLImageElement>("img")!;
    expect(logo.getAttribute("src")).toBe("/banhall-logo-dark.png");
    expect(logo.getBoundingClientRect().height).toBeCloseTo(board(37), 1);
    expect(logo.getBoundingClientRect().left - frame.left).toBeCloseTo(board(14), 1);
    const bell = document.querySelector<HTMLAnchorElement>("[data-global-bar-bell]")!;
    expect([bell.getAttribute("href"), bell.getAttribute("aria-label")]).toEqual(["/changelog", "What's new"]);
    expect(bell.getBoundingClientRect().width).toBeCloseTo(board(30), 1);
    expect(bell.querySelector('[data-frame-icon="bell"]')!.getBoundingClientRect().width).toBeCloseTo(board(17), 1);
    expect(style(bell).color).toBe("rgb(79, 97, 93)");
    expect(bell.querySelector("[data-global-bar-bell-dot]")).toBeNull();
    const account = document.querySelector<HTMLButtonElement>("[data-global-bar-account]")!;
    expect(account.getBoundingClientRect().left - bell.getBoundingClientRect().right).toBeCloseTo(board(6), 1);
    expect(frame.right - account.getBoundingClientRect().right).toBeCloseTo(board(20), 1);
    expect([account.getBoundingClientRect().height, style(account).borderRadius, style(account).paddingLeft]).toEqual([
      board(30),
      boardPx(8),
      boardPx(8),
    ]);
    const name = document.querySelector<HTMLElement>("[data-global-bar-account-name]")!;
    expect([style(name).fontSize, style(name).fontWeight, style(name).color]).toEqual([boardPx(13), "500", "rgb(22, 33, 31)"]);
    // A unitless line height goes through float maths, so it can land just
    // off a rounding tie at the laptop root: compare it as a number.
    expect(parseFloat(style(name).lineHeight)).toBeCloseTo(board(18), 3);
    expect(account.querySelector('[data-frame-icon="chevron-down"]')!.getBoundingClientRect().width).toBeCloseTo(board(12), 1);
  });

  it("the bell carries the unseen dot and count in its name (owner answer 3)", async () => {
    __setQueryData("users:getCurrentUser", BRYCE);
    __setQueryData("changelog:unseenCount", 2);
    await render(GlobalBar, { homeHref: "/my-work" });
    await expect.poll(() => document.querySelector("[data-global-bar-bell-dot]")).not.toBeNull();
    expect(document.querySelector("[data-global-bar-bell]")!.getAttribute("aria-label")).toBe("What's new, 2 new updates");
  });

  it("the account button opens the account menu below it", async () => {
    __setQueryData("users:getCurrentUser", { ...BRYCE, isDeveloper: true });
    __setQueryData("changelog:unseenCount", 0);
    await render(GlobalBar, { homeHref: "/my-work" });
    await page.getByRole("button", { name: "Bryce Choquer, account menu" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Account" })).toBeVisible();
    const account = document.querySelector<HTMLElement>("[data-global-bar-account]")!.getBoundingClientRect();
    const menu = document.querySelector<HTMLElement>("[data-identity-menu]")!.getBoundingClientRect();
    expect(menu.top).toBeGreaterThan(account.bottom);
    // Its right edge follows the button's (bits-ui keeps it inside the window).
    expect(Math.abs(menu.right - account.right)).toBeLessThanOrEqual(8);
    expect(page.getByRole("menuitem", { name: /View as another role/ }).elements()).toHaveLength(1);
    await page.getByRole("menuitem", { name: "Account" }).click();
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/settings/account" }]);
  });
});
