import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import WorkspaceRail from "$lib/components/workspace/WorkspaceRail.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

async function mountCollapsed(failed = 1) {
  __setQueryData("users:getCurrentUser", { _id: "a", firstName: "Ada", lastName: "Admin", role: "admin" });
  __setQueryData("changelog:unseenCount", 0);
  __setQueryData("adminAttention:getAttention", { total: failed > 0 ? 1 : 0, ingestionFailed: failed });
  await render(WorkspaceRail, {
    variant: "rail",
    collapsed: true,
    displayedView: null,
    myWorkAvailable: true,
    myWorkHref: "/my-work",
    projectsHref: "/projects",
    onFocusSearch: () => {},
  });
  await expect.poll(() => document.querySelector('[data-rail-item="admin"]')).not.toBeNull();
  return document.querySelector<HTMLButtonElement>('[data-rail-item="admin"]')!;
}

const flyout = () => document.querySelector<HTMLElement>("[data-admin-flyout]");

describe("AdminFlyout (A5)", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
  });

  it("opens on hover after the intent delay, grouped as on the board, with the attention lines", async () => {
    const admin = await mountCollapsed(1);
    await userEvent.hover(admin);
    await expect.poll(flyout).not.toBeNull();
    const panel = flyout()!;
    await expect.poll(() => panel.getBoundingClientRect().width).toBe(252);
    expect(panel.querySelector("[data-admin-flyout-attention]")?.textContent).toBe("1 needs a look");
    const headings = Array.from(panel.querySelectorAll('[role="group"] > :first-child')).map((el) => el.textContent?.trim());
    expect(headings).toEqual(["Writing", "AI and quality", "Spend"]);
    const items = Array.from(panel.querySelectorAll<HTMLElement>("[data-admin-flyout-item]")).map((el) =>
      el.textContent?.replace(/\s+/g, " ").trim()
    );
    expect(items).toEqual([
      "House rules",
      "Project tags",
      "The Brain",
      "OneDrive import 1 failed",
      "Models",
      "QA reviews",
      "Learning health",
      "AI usage and cost",
    ]);
    expect(panel.querySelector("[data-admin-flyout-open]")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Open Admin G then A"
    );
    // A hover preview leaves focus where it was.
    expect(panel.contains(document.activeElement)).toBe(false);
  });

  it("no attention line when nothing failed", async () => {
    const admin = await mountCollapsed(0);
    admin.click();
    await expect.poll(flyout).not.toBeNull();
    expect(flyout()!.querySelector("[data-admin-flyout-attention]")).toBeNull();
    expect(flyout()!.textContent).not.toContain("failed");
  });

  it("opens from the keyboard, arrows move, Esc closes and returns focus to the Admin icon", async () => {
    const admin = await mountCollapsed(1);
    admin.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(flyout).not.toBeNull();
    await expect.poll(() => flyout()!.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{ArrowDown}");
    expect(flyout()!.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(flyout).toBeNull();
    await expect.poll(() => document.activeElement).toBe(admin);
  });

  it("items and Open Admin navigate", async () => {
    const admin = await mountCollapsed(1);
    admin.click();
    await page.getByRole("menuitem", { name: /OneDrive import/ }).click();
    await expect.poll(() => __navigationCalls.map((call) => call.url)).toEqual(["/admin/ingestion"]);
    admin.click();
    await page.getByRole("menuitem", { name: /Open Admin/ }).click();
    await expect.poll(() => __navigationCalls.map((call) => call.url)).toEqual(["/admin/ingestion", "/admin/house-rules"]);
  });
});
