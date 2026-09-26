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
    // The board bell: 16px, stroke 1.5, secondary ink.
    const bellIcon = bell.querySelector<SVGElement>("svg")!;
    expect(bellIcon.getAttribute("width")).toBe("16");
    expect(bellIcon.getAttribute("stroke-width")).toBe("1.5");
    expect(bellIcon.querySelector("path")?.getAttribute("d")).toBe("M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Z M10 21h4");
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

  it("bleed (H1): white, a soft line under it, 20px sides, and no tile or bell", async () => {
    await render(PageTopBar, {
      title: "New project",
      breadcrumb: { label: "Projects", href: "/projects" },
      icon: IconGear,
      variant: "bleed",
      onOpenNavigation: vi.fn(),
      actions,
    });
    const bar = document.querySelector<HTMLElement>("[data-page-top-bar]")!;
    const style = getComputedStyle(bar);
    expect([bar.getBoundingClientRect().height, style.paddingLeft, style.backgroundColor]).toEqual([56, "20px", "rgb(255, 255, 255)"]);
    expect(style.borderBottomWidth).toBe("1px");
    expect(style.borderBottomColor).toBe("rgb(233, 240, 239)");
    expect(bar.querySelector("[data-page-icon-tile]")).toBeNull();
    expect(bar.querySelector("[data-top-bar-bell]")).toBeNull();
    expect(bar.querySelector("nav[aria-label=Breadcrumb]")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Projects / New project");
    expect(bar.querySelector("[data-testid=act]")).not.toBeNull();
  });

  it("phone (H2): a 52px bar with the back arrow and the title only", async () => {
    const onBack = vi.fn();
    await render(PageTopBar, {
      title: "New project",
      breadcrumb: { label: "Projects", href: "/projects" },
      icon: IconGear,
      variant: "phone",
      onBack,
      onOpenNavigation: vi.fn(),
      actions,
    });
    const bar = document.querySelector<HTMLElement>("[data-page-top-bar]")!;
    expect(bar.getBoundingClientRect().height).toBe(52);
    expect([getComputedStyle(bar).paddingLeft, getComputedStyle(bar).paddingRight]).toEqual(["8px", "12px"]);
    expect(bar.querySelector('button[aria-label="Open workspace navigation"]')).toBeNull();
    expect(bar.querySelector("[data-page-icon-tile], [data-top-bar-bell], [data-page-breadcrumb]")).toBeNull();
    const back = bar.querySelector<HTMLButtonElement>("[data-page-back]")!;
    expect(back.getAttribute("aria-label")).toBe("Back");
    expect(back.getBoundingClientRect().width).toBe(44);
    const arrow = back.querySelector("svg")!;
    expect([arrow.getAttribute("width"), arrow.getAttribute("stroke-width")]).toEqual(["20", "1.8"]);
    expect(arrow.querySelector("path")?.getAttribute("d")).toBe("M19 12H5 M11 6l-6 6 6 6");
    const title = bar.querySelector("h1")!;
    expect(title.textContent).toBe("New project");
    expect([getComputedStyle(title).fontSize, getComputedStyle(title).lineHeight, getComputedStyle(title).fontWeight]).toEqual(["16px", "22px", "500"]);
    back.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
