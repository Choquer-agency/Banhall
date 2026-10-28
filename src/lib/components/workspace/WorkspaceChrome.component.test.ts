import { beforeEach, describe, expect, it, vi } from "vitest";
import { page as browserPage, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import { IconGear } from "$lib/components/icons";
import WorkspaceChrome from "./WorkspaceChrome.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __mutationCalls, __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { readLastAccount } from "$lib/auth/lastAccount";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { board, boardPx } from "$lib/test/boardScale";
import { SECTION_SIDEBAR_KEY, reloadSectionSidebar } from "$lib/workspace/sectionSidebar.svelte";
import SidebarHarness from "$lib/test/SectionSidebarChromeHarness.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const tallContent = createRawSnippet(() => ({
  render: () => `<div data-testid="tall-content" style="height:1800px">Utility content</div>`,
}));
const action = createRawSnippet(() => ({
  render: () => `<button type="button" data-testid="page-action">Add</button>`,
}));

const developer = { _id: "dev-1", firstName: "Johnny", lastName: "Nguyen", role: "admin", isDeveloper: true, imageUrl: null };

describe("WorkspaceChrome (the page frame, 2026-10-28)", () => {
  beforeEach(() => {
    // A collapsed sidebar persisted by an earlier suite would hide it; start
    // from the expanded default.
    localStorage.clear();
    reloadSectionSidebar();
    sessionStorage.clear();
    viewAs.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setPageUrl("/settings");
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
    __setQueryData("changelog:unseenCount", 0);
  });

  it("S9 frame: the global bar, the 80px rail, one white card 4px from it and 8px from the edge and foot; the bar inside the card; the content owns the scroll", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, { title: "Settings", subtitle: "Account", icon: IconGear, children: tallContent });

    const root = document.querySelector<HTMLElement>("[data-workspace-chrome]")!;
    const header = root.querySelector<HTMLElement>("[data-page-top-bar]")!;
    const card = root.querySelector<HTMLElement>("[data-frame-card]")!;
    const main = root.querySelector<HTMLElement>("[data-chrome-main]")!;
    const bar = root.querySelector<HTMLElement>("[data-global-bar]")!.getBoundingClientRect();
    const rail = root.querySelector<HTMLElement>("[data-frame-rail]")!.getBoundingClientRect();
    expect(Math.round(root.getBoundingClientRect().height)).toBe(window.innerHeight);
    expect(getComputedStyle(root).backgroundColor).toBe("rgb(242, 242, 242)");
    expect(bar.height).toBe(board(52));
    expect(rail.width).toBe(board(80));
    expect(rail.top).toBe(bar.bottom);
    expect(card.hasAttribute("data-work-panel")).toBe(true);
    expect([getComputedStyle(card).borderRadius, getComputedStyle(card).borderTopColor, getComputedStyle(card).backgroundColor]).toEqual([
      boardPx(12),
      "rgb(218, 229, 227)",
      "rgb(255, 255, 255)",
    ]);
    const cardBox = card.getBoundingClientRect();
    expect(cardBox.top).toBe(bar.bottom);
    expect(cardBox.left - rail.right).toBe(board(4));
    expect(window.innerWidth - cardBox.right).toBe(board(8));
    expect(window.innerHeight - cardBox.bottom).toBe(board(8));
    // The page bar is inside the card: 64px, the 22/28 title 32px in.
    expect(card.contains(header)).toBe(true);
    expect(header.getBoundingClientRect().height).toBe(board(64));
    expect(header.hasAttribute("data-workspace-page-header")).toBe(true);
    const title = header.querySelector<HTMLElement>("h1")!;
    expect(title.textContent).toBe("Settings");
    expect([getComputedStyle(title).fontSize, getComputedStyle(title).lineHeight, getComputedStyle(title).fontWeight]).toEqual([
      boardPx(22),
      boardPx(28),
      "500",
    ]);
    expect(title.getBoundingClientRect().left - cardBox.left - 1).toBe(board(32));
    // Owner, 2026-10-19: the title only, no muted line or page tile beside it.
    expect(header.querySelector("[data-page-subtitle]")).toBeNull();
    expect(header.querySelector("[data-page-icon-tile]")).toBeNull();
    // The bell is in the global bar now, not the page bar.
    expect(header.querySelector("[data-top-bar-bell]")!.getBoundingClientRect().width).toBe(0);
    expect(root.querySelector("[data-global-bar-bell]")).not.toBeNull();
    // A page with no section sidebar sits in the card alone.
    expect(card.querySelector("[data-section-sidebar]")).toBeNull();
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
    main.scrollTop = 300;
    expect(main.scrollTop).toBeGreaterThan(0);
    expect(window.scrollY).toBe(0);
    // The shared content inset: 32px sides on a desktop, 4px under the bar.
    expect(getComputedStyle(main).paddingTop).toBe(boardPx(4));
    expect(getComputedStyle(main).paddingLeft).toBe(boardPx(32));
  });

  it("a section sidebar: 228px with a soft line, the 64px header with the 30px collapse button; Mod \\ and the button collapse it, the bar's expand button brings it back, and the choice is kept", async () => {
    await browserPage.viewport(1440, 900);
    __setPageUrl("/settings/notifications");
    await render(SidebarHarness, { children: tallContent });
    await expect.poll(() => document.querySelector("[data-section-sidebar='settings']")).not.toBeNull();
    const slot = () => document.querySelector<HTMLElement>("[data-section-sidebar-slot]")!;
    const header = document.querySelector<HTMLElement>("[data-section-sidebar-header]")!;
    expect(slot().getBoundingClientRect().width).toBe(board(228));
    expect([getComputedStyle(slot()).borderRightWidth, getComputedStyle(slot()).borderRightColor]).toEqual(["1px", "rgb(233, 240, 239)"]);
    expect(header.getBoundingClientRect().height).toBe(board(64));
    const sidebarTitle = header.querySelector<HTMLElement>("[data-section-sidebar-title]")!;
    expect([sidebarTitle.textContent, getComputedStyle(sidebarTitle).fontSize, getComputedStyle(sidebarTitle).fontWeight]).toEqual([
      "Settings",
      boardPx(16),
      "500",
    ]);
    const toggle = header.querySelector<HTMLButtonElement>("[data-section-sidebar-toggle]")!;
    expect(toggle.getBoundingClientRect().width).toBe(board(30));
    expect(getComputedStyle(toggle).borderRadius).toBe(boardPx(8));
    // The bar's title starts 32px from the sidebar's edge.
    const title = document.querySelector<HTMLElement>("[data-page-top-bar] h1")!;
    expect(title.getBoundingClientRect().left - slot().getBoundingClientRect().right).toBe(board(32));
    expect(document.querySelector("[data-section-sidebar-expand]")).toBeNull();

    // Mod \ collapses it (owner answer 4) and remembers the choice.
    await userEvent.keyboard("{Meta>}\\{/Meta}");
    await expect.poll(() => slot().hasAttribute("data-collapsed")).toBe(true);
    await expect.poll(() => slot().getBoundingClientRect().width).toBe(0);
    expect(getComputedStyle(slot()).visibility).toBe("hidden");
    expect(JSON.parse(localStorage.getItem(SECTION_SIDEBAR_KEY)!)).toEqual({ collapsed: true });
    const expand = document.querySelector<HTMLButtonElement>("[data-section-sidebar-expand]")!;
    expect(expand.closest("[data-page-top-bar]")).not.toBeNull();
    expect(expand.getAttribute("aria-label")).toBe("Show the sidebar");

    // The expand button brings it back and focus moves to the collapse button.
    expand.focus();
    expand.click();
    await expect.poll(() => slot().hasAttribute("data-collapsed")).toBe(false);
    await expect.poll(() => document.activeElement?.hasAttribute("data-section-sidebar-toggle")).toBe(true);
    expect(JSON.parse(localStorage.getItem(SECTION_SIDEBAR_KEY)!)).toEqual({ collapsed: false });

    // The header button collapses it too, and focus lands on the expand button.
    (document.activeElement as HTMLButtonElement).click();
    await expect.poll(() => document.activeElement?.hasAttribute("data-section-sidebar-expand")).toBe(true);
  });

  it("below 768px, where no sidebar shows, Mod \\ leaves the stored choice alone (review round 1, finding 5)", async () => {
    await browserPage.viewport(700, 900);
    __setPageUrl("/settings/notifications");
    await render(SidebarHarness, { children: tallContent });
    await expect.poll(() => document.querySelector("[data-section-sidebar='settings']")).not.toBeNull();
    expect(document.querySelector<HTMLElement>("[data-section-sidebar-slot]")!.getBoundingClientRect().width).toBe(0);
    await userEvent.keyboard("{Meta>}\\{/Meta}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(localStorage.getItem(SECTION_SIDEBAR_KEY)).toBeNull();
    expect(document.querySelector("[data-section-sidebar-slot]")!.hasAttribute("data-collapsed")).toBe(false);
  });

  it("one banner, one main and one h1: the global bar is the only top-level header, the page bar sits in the card's main", async () => {
    await browserPage.viewport(1440, 900);
    __setPageUrl("/settings/notifications");
    await render(SidebarHarness, { children: tallContent });
    await expect.poll(() => document.querySelector("[data-section-sidebar='settings']")).not.toBeNull();
    const visible = (element: Element) => element.getClientRects().length > 0;
    const banners = [...document.querySelectorAll("header")].filter((header) => visible(header) && !header.closest("main, aside, nav, section, article"));
    expect(banners).toHaveLength(1);
    expect(banners[0].hasAttribute("data-global-bar")).toBe(true);
    expect([...document.querySelectorAll("main")].filter(visible)).toHaveLength(1);
    expect(document.querySelector("main")!.contains(document.querySelector("[data-page-top-bar]"))).toBe(true);
    expect([...document.querySelectorAll("h1")].filter(visible).map((h1) => h1.textContent)).toEqual(["Notifications"]);
  });

  it("Mod \\ does nothing on a page without a section sidebar", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, { title: "What's new", children: tallContent });
    await expect.poll(() => document.querySelector("[data-page-top-bar]")).not.toBeNull();
    await userEvent.keyboard("{Meta>}\\{/Meta}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(localStorage.getItem(SECTION_SIDEBAR_KEY)).toBeNull();
  });

  it("sends the Team activity heartbeat once on mount and remembers the signed-in account (J3)", async () => {
    __setQueryData("users:getCurrentUser", { ...developer, email: "johnny@banhall.com" });
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });
    await expect.poll(() => __mutationCalls("team:markActive").length).toBe(1);
    // Focus within 5 minutes does not send another.
    window.dispatchEvent(new Event("focus"));
    expect(__mutationCalls("team:markActive")).toHaveLength(1);
    await expect.poll(() => readLastAccount()?.name).toBe("Johnny Nguyen");
    expect(readLastAccount()?.email).toBe("johnny@banhall.com");
  });

  it("sends no heartbeat for a signed-in person without a role", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u-2", firstName: "No", lastName: "Role", role: undefined });
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__mutationCalls("team:markActive")).toHaveLength(0);
  });

  it("shows the title without a trail, puts page actions at the right, and pads every panel alike", async () => {
    await browserPage.viewport(1440, 900);
    await render(WorkspaceChrome, {
      title: "House rules",
      breadcrumb: { label: "Admin", href: "/admin/house-rules" },
      padding: "admin",
      actions: action,
      children: tallContent,
    });
    const header = document.querySelector<HTMLElement>("[data-page-top-bar]")!;
    expect(header.querySelector("[data-page-breadcrumb]")).toBeNull();
    expect(header.querySelector("h1")?.textContent).toBe("House rules");
    const add = header.querySelector<HTMLElement>("[data-testid=page-action]")!;
    expect(Math.round(header.getBoundingClientRect().right - add.getBoundingClientRect().right)).toBe(Math.round(board(32)));
    const main = document.querySelector<HTMLElement>("[data-chrome-main]")!;
    expect(getComputedStyle(main).paddingLeft).toBe(boardPx(32));
  });

  it("keeps the drawer reachable below 1024px, with no global bar or rail and the card full bleed (owner answer 6)", async () => {
    await browserPage.viewport(390, 844);
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });
    expect(document.querySelector<HTMLElement>("[data-global-bar]")!.getBoundingClientRect().height).toBe(0);
    expect(document.querySelector<HTMLElement>("[data-frame-rail]")!.getBoundingClientRect().width).toBe(0);
    const card = document.querySelector<HTMLElement>("[data-frame-card]")!.getBoundingClientRect();
    expect([card.left, card.top, card.width]).toEqual([0, 0, 390]);
    // Below 1024px the page bar keeps its bell.
    expect(document.querySelector<HTMLElement>("[data-top-bar-bell]")!.getBoundingClientRect().width).toBeGreaterThan(0);
    await browserPage.getByRole("button", { name: "Open workspace navigation", exact: true }).click();
    await expect.element(browserPage.getByRole("button", { name: "Close workspace navigation", exact: true })).toBeVisible();
    const drawer = document.querySelector<HTMLElement>("[data-workspace-drawer]")!;
    expect(drawer.querySelector('[data-rail-item="home"]')).not.toBeNull();
    // Board close glyph (18 / 2) instead of the Phosphor X; board-style three lines to open.
    const close = drawer.querySelector<SVGElement>('button[aria-label="Close workspace navigation"] svg')!;
    expect(close.getAttribute("width")).toBe("18");
    expect(close.getAttribute("stroke-width")).toBe("2");
    expect(close.querySelector("path")?.getAttribute("d")).toBe("M18 6 6 18M6 6l12 12");
    const open = document.querySelector<SVGElement>('button[aria-label="Open workspace navigation"] svg')!;
    expect(open.querySelector("path")?.getAttribute("d")).toBe("M4 6h16 M4 12h16 M4 18h16");
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

  it("D3: while viewing as a role, the card gets the amber frame and the pill sits in the global bar", async () => {
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
    const bar = root.querySelector<HTMLElement>("[data-global-bar]")!.getBoundingClientRect();
    expect(pill.height).toBe(board(36));
    expect(Math.abs(pill.top + pill.height / 2 - (bar.top + bar.height / 2))).toBeLessThanOrEqual(1);
    // D3, D4: 560px from the window's left edge, as the boards draw it.
    const shell = root.getBoundingClientRect();
    expect(pill.left - shell.left).toBe(board(560));
    // Narrower than the boards, it is centred on the window instead.
    await browserPage.viewport(1100, 900);
    await expect.poll(() => {
      const narrow = document.querySelector<HTMLElement>("[data-view-as-pill]")!.getBoundingClientRect();
      const frame = root.getBoundingClientRect();
      return Math.round(narrow.left + narrow.width / 2 - (frame.left + frame.width / 2));
    }).toBe(0);
    await browserPage.viewport(1440, 900);
  });

  it("D4: a gated page shows the hidden state in a view that cannot open it, and hides its actions", async () => {
    await browserPage.viewport(1440, 900);
    __setQueryData("users:getCurrentUser", developer);
    viewAs.enter("consultant");
    __setPageUrl("/alerts");
    await render(WorkspaceChrome, { title: "Alerts", viewAsGate: "alerts", actions: action, children: tallContent });
    await expect.poll(() => document.querySelector("[data-view-as-hidden-page]")).not.toBeNull();
    expect(document.querySelector("[data-testid=tall-content]")).toBeNull();
    expect(document.querySelector("[data-testid=page-action]")).toBeNull();
    const hidden = document.querySelector<HTMLElement>("[data-view-as-hidden-page]")!;
    expect(hidden.querySelector("h2")?.textContent?.trim()).toBe("Alerts is hidden in Consultant view");
    expect(document.querySelector("[data-page-top-bar] h1")?.textContent).toBe("Alerts");
    // D4: the page's address as the muted line after the title.
    expect(document.querySelector("[data-page-top-bar] [data-page-subtitle]")?.textContent).toBe("localhost:3001/alerts");
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
