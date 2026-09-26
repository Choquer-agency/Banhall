import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import { IconGear } from "$lib/components/icons";
import PageTopBar from "./PageTopBar.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

const actions = createRawSnippet(() => ({ render: () => `<button type="button" data-testid="act">Add rule</button>` }));
const status = createRawSnippet(() => ({ render: () => `<span data-testid="status">Saved</span>` }));

describe("PageTopBar", () => {
  beforeEach(() => {
    __resetPage();
    __resetConvexStub();
  });

  it("shows a title with a muted subtitle, the tile and the unseen dot on the bell", async () => {
    __setQueryData("changelog:unseenCount", 2);
    await render(PageTopBar, { title: "Settings", subtitle: "Account", icon: IconGear, onOpenNavigation: vi.fn() });
    const bar = document.querySelector<HTMLElement>("[data-page-top-bar]")!;
    expect(bar.getBoundingClientRect().height).toBe(56);
    expect(bar.querySelector("h1")?.textContent).toBe("Settings");
    expect(getComputedStyle(bar.querySelector("h1")!).fontWeight).toBe("500");
    expect(bar.querySelector("[data-page-subtitle]")?.textContent).toBe("Account");
    expect(bar.querySelector("[data-page-breadcrumb]")).toBeNull();
    const bell = bar.querySelector<HTMLAnchorElement>("[data-top-bar-bell]")!;
    expect(bell.getAttribute("href")).toBe("/changelog");
    expect(bell.getBoundingClientRect().width).toBe(36);
    await expect.poll(() => bell.querySelector("span.bg-primary")).not.toBeNull();
    expect(bell.getAttribute("aria-label")).toBe("What's new, 2 new updates");
  });

  it("shows a breadcrumb instead of a subtitle, then status, bell and actions in that order", async () => {
    await render(PageTopBar, {
      title: "House rules",
      subtitle: "ignored",
      breadcrumb: { label: "Admin", href: "/admin/house-rules" },
      onOpenNavigation: vi.fn(),
      status,
      actions,
    });
    const bar = document.querySelector<HTMLElement>("[data-page-top-bar]")!;
    const crumb = bar.querySelector<HTMLAnchorElement>("[data-page-breadcrumb]")!;
    expect(crumb.textContent).toBe("Admin");
    expect(bar.querySelector("nav[aria-label=Breadcrumb]")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Admin / House rules"
    );
    expect(bar.querySelector("[data-page-subtitle]")).toBeNull();
    const order = ["[data-testid=status]", "[data-top-bar-bell]", "[data-testid=act]"].map(
      (selector) => bar.querySelector(selector)!
    );
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
