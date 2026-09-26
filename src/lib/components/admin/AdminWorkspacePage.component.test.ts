import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import AdminWorkspacePage from "./AdminWorkspacePage.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { viewAs } from "$lib/shell/viewAs.svelte";

const content = createRawSnippet(() => ({
  render: () => '<section data-testid="route-content"><h2>Route-owned content</h2></section>',
}));

const actions = createRawSnippet(() => ({
  render: () => '<button data-testid="admin-action" type="button">Admin action</button>',
}));

describe("AdminWorkspacePage", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    viewAs.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  });

  it("B3: renders the round 2 frame with the Admin breadcrumb, serif heading and the action in the top bar", async () => {
    __setPageUrl("/admin/models");
    await render(AdminWorkspacePage, {
      title: "Models",
      description: "Operational model evidence.",
      width: "compact",
      children: content,
      actions,
    });

    const root = document.querySelector<HTMLElement>("[data-workspace-chrome]")!;
    expect(root.getAttribute("data-workspace-theme")).toBe("light");
    expect(root.querySelectorAll("main")).toHaveLength(1);
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    const bar = root.querySelector<HTMLElement>("[data-page-top-bar]")!;
    expect(bar.getBoundingClientRect().height).toBe(56);
    expect(bar.querySelector("[data-page-icon-tile]")).not.toBeNull();
    const crumb = bar.querySelector<HTMLAnchorElement>("[data-page-breadcrumb]")!;
    expect(crumb.textContent).toBe("Admin");
    expect(crumb.getAttribute("href")).toBe("/admin/house-rules");
    expect(bar.querySelector("h1")?.textContent).toBe("Models");
    expect(bar.querySelector("[data-testid=admin-action]")).not.toBeNull();
    const heading = root.querySelector<HTMLElement>("[data-admin-page-heading] h2")!;
    expect(heading.textContent).toBe("Models");
    expect(getComputedStyle(heading).fontFamily).toContain("Georgia");
    expect(getComputedStyle(heading).lineHeight).toBe("34px");
    expect(getComputedStyle(heading).fontSize).toBe("28px");
    expect(getComputedStyle(heading).fontWeight).toBe("400");
    expect(getComputedStyle(heading).letterSpacing).toBe("normal");
    // B3: the description is 14/20 in muted ink (the board, not the spec).
    const description = root.querySelector<HTMLElement>("[data-admin-page-heading] p")!;
    expect(description.textContent).toBe("Operational model evidence.");
    expect(getComputedStyle(description).fontSize).toBe("14px");
    expect(getComputedStyle(description).lineHeight).toBe("20px");
    expect(getComputedStyle(description).color).toBe("rgb(107, 127, 123)");
    // B3 panel: 28px top and bottom, 10px radius.
    const panel = root.querySelector<HTMLElement>("[data-work-panel]")!;
    expect(getComputedStyle(panel).paddingTop).toBe("28px");
    expect(getComputedStyle(panel).paddingBottom).toBe("28px");
    expect(getComputedStyle(panel).borderRadius).toBe("10px");
    // B3 breadcrumb: "Admin /" is one muted run, 10px before the page name.
    const trail = bar.querySelector<HTMLElement>("nav[aria-label=Breadcrumb]")!;
    expect(getComputedStyle(trail).columnGap).toBe("10px");
    expect(trail.firstElementChild?.textContent).toBe("Admin /");
    expect(getComputedStyle(trail.firstElementChild!).color).toBe("rgb(107, 127, 123)");
    expect(root.querySelector("[data-work-panel] [data-testid=route-content]")).not.toBeNull();
    expect(root.querySelector('a[href="/my-work"]')).not.toBeNull();
    // Full width: the width prop remains data for the ?workspace=current branch.
    const adminContent = root.querySelector("[data-admin-content-width=compact]");
    expect(adminContent?.className).toContain("w-full");
    expect(adminContent?.className).not.toContain("max-w-");
    expect(root.querySelector("[data-work-panel]")?.getAttribute("data-work-panel-padding")).toBe("admin");
  });

  it("D4: shows the hidden state while a developer views as a role without Admin", async () => {
    __setPageUrl("/admin/models");
    __setQueryData("users:getCurrentUser", { _id: "dev", role: "admin", isDeveloper: true, firstName: "Dev" });
    viewAs.enter("manager");
    await render(AdminWorkspacePage, { title: "Models", children: content, actions });
    await expect.poll(() => document.querySelector("[data-view-as-hidden-page]")).not.toBeNull();
    expect(document.querySelector("[data-view-as-hidden-page] h2")?.textContent?.trim()).toBe(
      "Admin is hidden in Manager view"
    );
    expect(document.querySelector("[data-testid=route-content]")).toBeNull();
    expect(document.querySelector("[data-testid=admin-action]")).toBeNull();
    // D4 top bar: the shield tile and "Admin" on its own, no breadcrumb.
    const bar = document.querySelector<HTMLElement>("[data-page-top-bar]")!;
    expect(bar.querySelector("h1")?.textContent).toBe("Admin");
    expect(bar.querySelector("[data-page-breadcrumb]")).toBeNull();
    expect(bar.querySelector("[data-page-icon-tile] path")?.getAttribute("d")).toBe(
      "M12 3 5 6v5.5c0 4.3 3 7.7 7 9.5 4-1.8 7-5.2 7-9.5V6Z"
    );
    // D4 body: the 20px eye at stroke 1.6 in warning ink, 36px buttons at radius 8.
    const hidden = document.querySelector<HTMLElement>("[data-view-as-hidden-page]")!;
    const eye = hidden.querySelector<SVGElement>("svg")!;
    expect(eye.getAttribute("width")).toBe("20");
    expect(eye.getAttribute("stroke-width")).toBe("1.6");
    expect(getComputedStyle(eye).color).toBe("rgb(146, 64, 14)");
    for (const selector of ["[data-view-as-home]", "[data-view-as-exit]"]) {
      const button = hidden.querySelector<HTMLElement>(selector)!;
      expect(getComputedStyle(button).borderRadius).toBe("8px");
      expect(button.getBoundingClientRect().height).toBe(36);
    }
  });

  it("keeps the page for a developer viewing as Owner or Admin", async () => {
    __setPageUrl("/admin/models");
    __setQueryData("users:getCurrentUser", { _id: "dev", role: "admin", isDeveloper: true, firstName: "Dev" });
    viewAs.enter("owner");
    await render(AdminWorkspacePage, { title: "Models", children: content });
    await expect.poll(() => document.querySelector("[data-testid=route-content]")).not.toBeNull();
    expect(document.querySelector("[data-view-as-hidden-page]")).toBeNull();
  });

  it("uses ?workspace=current as a UI-only legacy presentation branch with the same single content subtree", async () => {
    __setPageUrl("/admin/models?workspace=current&range=30d");
    await render(AdminWorkspacePage, {
      title: "Model A/B preferences",
      description: "Operational model evidence.",
      children: content,
      actions,
    });

    const current = document.querySelector<HTMLElement>('[data-admin-presentation="current"]')!;
    expect(current).not.toBeNull();
    expect(document.querySelector("[data-workspace-chrome]")).toBeNull();
    expect(current.querySelectorAll("main")).toHaveLength(1);
    expect(current.querySelectorAll("h1")).toHaveLength(1);
    expect(current.querySelectorAll("[data-testid=route-content]")).toHaveLength(1);
    expect(current.querySelector("[data-testid=admin-action]")).not.toBeNull();
  });
});
