import { beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import { GearSixIcon } from "phosphor-svelte";
import WorkspaceChrome from "./WorkspaceChrome.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const tallContent = createRawSnippet(() => ({
  render: () => `<div data-testid="tall-content" style="height:1800px">Utility content</div>`,
}));
const action = createRawSnippet(() => ({
  render: () => `<button type="button" data-testid="page-action">Add</button>`,
}));

const developer = { _id: "dev-1", firstName: "Johnny", lastName: "Nguyen", role: "admin", isDeveloper: true, imageUrl: null };

describe("WorkspaceChrome (round 2 frame)", () => {
  beforeEach(() => {
    // A collapsed rail persisted by an earlier suite shows icons only; start
    // from the expanded default.
    localStorage.clear();
    sessionStorage.clear();
    viewAs.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setPageUrl("/settings");
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
    __setQueryData("changelog:unseenCount", 0);
  });

  it("draws the 56px top bar with the page tile on the shell background, and the panel owns the scroll", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, { title: "Settings", subtitle: "Account", icon: GearSixIcon, children: tallContent });

    const root = document.querySelector<HTMLElement>("[data-workspace-chrome]")!;
    const header = root.querySelector<HTMLElement>("[data-page-top-bar]")!;
    const panel = root.querySelector<HTMLElement>("[data-work-panel]")!;
    const aside = root.querySelector<HTMLElement>("aside")!;
    expect(Math.round(root.getBoundingClientRect().height)).toBe(window.innerHeight);
    expect(header.getBoundingClientRect().height).toBe(56);
    expect(header.hasAttribute("data-workspace-page-header")).toBe(true);
    const tile = header.querySelector<HTMLElement>("[data-page-icon-tile]")!;
    expect(tile.getBoundingClientRect().width).toBe(26);
    expect(getComputedStyle(tile).backgroundColor).toBe("rgb(227, 244, 241)");
    expect(header.querySelector("h1")?.textContent).toBe("Settings");
    expect(header.querySelector("[data-page-subtitle]")?.textContent).toBe("Account");
    // Round 2 shell: the lighter #FAFCFB rail and frame.
    expect(getComputedStyle(aside).backgroundColor).toBe("rgb(250, 252, 251)");
    expect(getComputedStyle(panel.parentElement!).backgroundColor).toBe("rgb(250, 252, 251)");
    expect(getComputedStyle(panel).borderRadius).toBe("10px");
    expect(getComputedStyle(panel).backgroundColor).toBe("rgb(255, 255, 255)");
    // Panel inset 12px from the frame on the sides and bottom.
    const panelBox = panel.getBoundingClientRect();
    expect(Math.round(window.innerHeight - panelBox.bottom)).toBe(12);
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    panel.scrollTop = 300;
    expect(panel.scrollTop).toBeGreaterThan(0);
    expect(window.scrollY).toBe(0);
    // Padded panel: 32px top, 56px sides (Settings, Team).
    expect(getComputedStyle(panel).paddingTop).toBe("32px");
    expect(getComputedStyle(panel).paddingLeft).toBe("56px");
  });

  it("renders a breadcrumb link and puts page actions after the bell", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, {
      title: "House rules",
      breadcrumb: { label: "Admin", href: "/admin/house-rules" },
      padding: "admin",
      actions: action,
      children: tallContent,
    });
    const header = document.querySelector<HTMLElement>("[data-page-top-bar]")!;
    const crumb = header.querySelector<HTMLAnchorElement>("[data-page-breadcrumb]")!;
    expect(crumb.textContent).toBe("Admin");
    expect(crumb.getAttribute("href")).toBe("/admin/house-rules");
    expect(header.querySelector("h1")?.textContent).toBe("House rules");
    const bell = header.querySelector("[data-top-bar-bell]")!;
    const add = header.querySelector("[data-testid=page-action]")!;
    expect(bell.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const panel = document.querySelector<HTMLElement>("[data-work-panel]")!;
    expect(getComputedStyle(panel).paddingLeft).toBe("40px");
  });

  it("keeps the drawer reachable below 1024px", async () => {
    await browserPage.viewport(390, 844);
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });
    await browserPage.getByRole("button", { name: "Open workspace navigation", exact: true }).click();
    await expect.element(browserPage.getByRole("button", { name: "Close workspace navigation", exact: true })).toBeVisible();
    const drawer = document.querySelector<HTMLElement>("[data-workspace-drawer]")!;
    expect(drawer.querySelector('[data-rail-item="home"]')).not.toBeNull();
    await browserPage.getByRole("button", { name: "Close workspace navigation", exact: true }).click();
    await expect.poll(() => drawer.isConnected).toBe(false);
  });

  it("Cmd K opens the shell command palette in place, with no navigation", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await expect.poll(() => document.querySelector("[data-command-root]")).not.toBeNull();
    expect(__navigationCalls.filter((call) => call.kind === "goto")).toEqual([]);
    await userEvent.keyboard("{Escape}");
  });

  it("D3: while viewing as a role, the panel gets the amber frame and the pill sits over the top bar", async () => {
    await browserPage.viewport(1440, 900);
    __setQueryData("users:getCurrentUser", developer);
    viewAs.enter("consultant");
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });
    await expect.poll(() => document.querySelector("[data-view-as-pill]")).not.toBeNull();
    const root = document.querySelector<HTMLElement>("[data-workspace-chrome]")!;
    expect(root.dataset.viewAs).toBe("consultant");
    const panel = root.querySelector<HTMLElement>("[data-work-panel]")!;
    expect(getComputedStyle(panel).borderTopWidth).toBe("2px");
    expect(getComputedStyle(panel).borderTopColor).toBe("rgb(245, 158, 11)");
    const pill = document.querySelector<HTMLElement>("[data-view-as-pill]")!.getBoundingClientRect();
    const bar = root.querySelector<HTMLElement>("[data-page-top-bar]")!.getBoundingClientRect();
    expect(pill.height).toBe(36);
    expect(Math.abs(pill.top + pill.height / 2 - (bar.top + bar.height / 2))).toBeLessThanOrEqual(1);
    // Centred over the content column, not the whole window.
    expect(Math.abs(pill.left + pill.width / 2 - (bar.left + bar.width / 2))).toBeLessThanOrEqual(14);
  });

  it("D4: a gated page shows the hidden state in a view that cannot open it, and hides its actions", async () => {
    await browserPage.viewport(1440, 900);
    __setQueryData("users:getCurrentUser", developer);
    viewAs.enter("consultant");
    await render(WorkspaceChrome, { title: "Alerts", viewAsGate: "alerts", actions: action, children: tallContent });
    await expect.poll(() => document.querySelector("[data-view-as-hidden-page]")).not.toBeNull();
    expect(document.querySelector("[data-testid=tall-content]")).toBeNull();
    expect(document.querySelector("[data-testid=page-action]")).toBeNull();
    const hidden = document.querySelector<HTMLElement>("[data-view-as-hidden-page]")!;
    expect(hidden.querySelector("h2")?.textContent?.trim()).toBe("Alerts is hidden in Consultant view");
    expect(hidden.textContent).toContain(
      "Consultants cannot open Alerts, so this is what they would see. Exit the view to get back to it."
    );
    await browserPage.getByRole("button", { name: "Exit Consultant view" }).click();
    await expect.poll(() => document.querySelector("[data-testid=tall-content]")).not.toBeNull();
    expect(viewAs.role).toBeNull();
  });

  it("a gated page renders normally for the developer's own view", async () => {
    await browserPage.viewport(1440, 900);
    __setQueryData("users:getCurrentUser", developer);
    await render(WorkspaceChrome, { title: "Alerts", viewAsGate: "alerts", children: tallContent });
    await expect.poll(() => document.querySelector("[data-testid=tall-content]")).not.toBeNull();
    expect(document.querySelector("[data-view-as-hidden-page]")).toBeNull();
  });
});
