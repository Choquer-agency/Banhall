/**
 * Round 2 shell captures (WS1): the frame, rail, menus, View as and toasts
 * rendered with the real stylesheet, written under an ignored
 * `.vitest-attachments/` directory for review against the boards. Each
 * capture also asserts the state it shows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet, flushSync } from "svelte";
import { toast } from "svelte-sonner";
import ToastCheckIcon from "$lib/components/shell/ToastCheckIcon.svelte";
import ToastEyeIcon from "$lib/components/shell/ToastEyeIcon.svelte";
import { IconShield } from "$lib/components/icons";
import WorkspaceChrome from "$lib/components/workspace/WorkspaceChrome.svelte";
import ToastHarness from "$lib/test/ToastHarness.svelte";
import { captureOwner } from "$lib/test/captureOwner";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const captures = captureOwner("ws1-shell");
/** Let open animations finish so captures show the settled state. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 450));
const body = createRawSnippet(() => ({
  render: () => `<div style="height:400px"><p class="text-body">Page body</p></div>`,
}));

function seed(user: Record<string, unknown>) {
  __setQueryData("users:getCurrentUser", { imageUrl: null, ...user });
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData("changelog:unseenCount", 2);
  __setQueryData("errorReports:openCount", 4);
  __setQueryData("adminAttention:getAttention", { total: 1, ingestionFailed: 1 });
  __setQueryData("notifications:listRecent", []);
}

const developer = { _id: "dev-1", firstName: "Johnny", lastName: "Nguyen", email: "johnny@banhall.com", role: "admin", isDeveloper: true };

describe("round 2 shell captures", () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    viewAs.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    await page.viewport(1440, 900);
  });

  it("B2 and B3: developer admin, Admin open on House rules", async () => {
    seed(developer);
    __setPageUrl("/admin/house-rules");
    await render(WorkspaceChrome, {
      title: "House rules",
      icon: IconShield,
      breadcrumb: { label: "Admin", href: "/admin/house-rules" },
      padding: "admin",
      children: body,
    });
    await expect.poll(() => document.querySelector("[data-rail-admin-links]")).not.toBeNull();
    await settle();
    await page.screenshot({ path: await captures.path("b3-admin-house-rules") });
  });

  it("A5: collapsed developer rail with the Admin flyout", async () => {
    seed(developer);
    localStorage.setItem("banhall.workspaceRail.v2", JSON.stringify({ width: 200, hidden: true, adminOpen: false }));
    __setPageUrl("/settings");
    await render(WorkspaceChrome, { title: "Settings", children: body });
    await expect.poll(() => document.querySelector<HTMLElement>('[data-rail-item="admin"]')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-rail-item="admin"]')!.click();
    await expect.poll(() => document.querySelector("[data-admin-flyout]")).not.toBeNull();
    expect(document.querySelector("[data-admin-flyout-attention]")?.textContent).toBe("1 needs a look");
    await settle();
    await page.screenshot({ path: await captures.path("a5-collapsed-flyout") });
  });

  it("D1: identity menu", async () => {
    seed(developer);
    await render(WorkspaceChrome, { title: "Settings", children: body });
    await page.getByRole("button", { name: "Johnny Nguyen, account menu" }).click();
    await expect.element(page.getByRole("menu")).toBeVisible();
    await settle();
    await page.screenshot({ path: await captures.path("d1-identity-menu") });
  });

  it("D2: View as dialog", async () => {
    seed(developer);
    await render(WorkspaceChrome, { title: "Settings", children: body });
    viewAs.dialogOpen = true;
    flushSync();
    await expect.poll(() => document.querySelector("[data-view-as-dialog]")).not.toBeNull();
    await settle();
    await page.screenshot({ path: await captures.path("d2-view-as-dialog") });
    viewAs.dialogOpen = false;
  });

  it("D3 and D4: viewing as Consultant on an admin page", async () => {
    seed(developer);
    __setPageUrl("/admin/house-rules");
    viewAs.enter("consultant");
    await render(WorkspaceChrome, {
      title: "House rules",
      icon: IconShield,
      breadcrumb: { label: "Admin", href: "/admin/house-rules" },
      viewAsGate: "admin",
      children: body,
    });
    await expect.poll(() => document.querySelector("[data-view-as-hidden-page]")).not.toBeNull();
    await settle();
    await page.screenshot({ path: await captures.path("d3-d4-viewing-hidden") });
  });

  it("toasts: dark success and action toasts, red error toast", async () => {
    await render(ToastHarness, {});
    toast("Now viewing as Consultant. Your own access is unchanged.", {
      icon: ToastEyeIcon,
      action: { label: "Undo", onClick: () => {} },
      duration: 60_000,
    });
    toast.success("Changes saved", { duration: 60_000 });
    toast("Back to Developer view", { icon: ToastCheckIcon, duration: 60_000 });
    toast.error("Could not save your changes.", { duration: 60_000 });
    await expect.poll(() => document.querySelectorAll("[data-sonner-toast]").length).toBe(4);
    const toasts = Array.from(document.querySelectorAll<HTMLElement>("[data-sonner-toast]"));
    const byText = (text: string) => toasts.find((element) => element.textContent?.includes(text))!;
    expect(getComputedStyle(byText("Changes saved")).backgroundColor).toBe("rgb(19, 45, 42)");
    expect(getComputedStyle(byText("Now viewing")).backgroundColor).toBe("rgb(19, 45, 42)");
    expect(getComputedStyle(byText("Now viewing").querySelector("[data-button]")!).color).toBe("rgb(69, 207, 201)");
    expect(getComputedStyle(byText("Could not save")).backgroundColor).toBe("rgb(254, 242, 242)");
    // D3, D5: white 15px board icons, plain 13/19 text, 10px radius, the
    // card hugs its text, and 14px on the right when there is no action.
    const back = byText("Back to Developer view");
    const backIcon = back.querySelector<SVGElement>('[data-toast-icon="check"]')!;
    expect(backIcon.querySelector("path")?.getAttribute("d")).toBe("M20 6 9 17l-5-5");
    expect(backIcon.getAttribute("width")).toBe("15");
    expect(backIcon.getAttribute("stroke-width")).toBe("2");
    expect(getComputedStyle(backIcon).color).toBe("rgb(255, 255, 255)");
    const backTitle = back.querySelector<HTMLElement>("[data-title]")!;
    expect(getComputedStyle(backTitle).fontWeight).toBe("400");
    expect(getComputedStyle(backTitle).lineHeight).toBe("19px");
    expect(getComputedStyle(back).borderRadius).toBe("10px");
    expect(getComputedStyle(back).paddingLeft).toBe("14px");
    expect(getComputedStyle(back).paddingRight).toBe("14px");
    expect(back.getBoundingClientRect().width).toBeLessThan(300);
    const viewing = byText("Now viewing");
    expect(getComputedStyle(viewing).paddingRight).toBe("12px");
    const eye = viewing.querySelector<SVGElement>('[data-toast-icon="eye"]')!;
    expect(eye.getAttribute("stroke-width")).toBe("1.6");
    expect(getComputedStyle(eye).color).toBe("rgb(255, 255, 255)");
    const toaster = document.querySelector<HTMLElement>("[data-sonner-toaster]")!;
    expect(toaster.dataset.yPosition).toBe("bottom");
    expect(toaster.dataset.xPosition).toBe("center");
    // Expanded so every toast shows in the capture.
    toaster.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await settle();
    await page.screenshot({ path: await captures.path("toasts") });
    // Remove toasts while the Toaster is still mounted (svelte-sonner's own
    // delete timer otherwise reads a toast that is gone).
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-sonner-toast]"))) {
      element.querySelector<HTMLButtonElement>("[data-close-button]")?.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await expect.poll(() => document.querySelectorAll("[data-sonner-toast]").length, { timeout: 3000 }).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
});
