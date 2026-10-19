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

  it("renders the standard frame: the title alone in the top bar, the action there, the description in the panel", async () => {
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
    // The standard top bar (owner, 2026-10-19): 64px, the title only, no tile or trail.
    expect(bar.getBoundingClientRect().height).toBe(64);
    expect(bar.querySelector("[data-page-icon-tile]")).toBeNull();
    expect(bar.querySelector("[data-page-breadcrumb]")).toBeNull();
    expect(bar.querySelector("h1")?.textContent).toBe("Models");
    expect(bar.querySelector("[data-testid=admin-action]")).not.toBeNull();
    // No second serif title in the panel; the description stays, 14/20 muted.
    expect(root.querySelector("[data-admin-page-heading] h2")).toBeNull();
    const description = root.querySelector<HTMLElement>("[data-admin-page-description]")!;
    expect(description.textContent).toBe("Operational model evidence.");
    expect(getComputedStyle(description).fontSize).toBe("14px");
    expect(getComputedStyle(description).lineHeight).toBe("20px");
    expect(getComputedStyle(description).color).toBe("rgb(107, 127, 123)");
    // The shared panel inset: 20px top, 32px bottom (sides are 16px on this
    // narrow test frame, 24px from 640px up); radius 12.
    const panel = root.querySelector<HTMLElement>("[data-work-panel]")!;
    expect(getComputedStyle(panel).paddingTop).toBe("20px");
    expect(getComputedStyle(panel).paddingBottom).toBe("32px");
    expect(["16px", "24px"]).toContain(getComputedStyle(panel).paddingLeft);
    expect(getComputedStyle(panel).borderRadius).toBe("12px");
    expect(root.querySelector("[data-work-panel] [data-testid=route-content]")).not.toBeNull();
    expect(root.querySelector('a[href="/my-work"]')).not.toBeNull();
    // Full width: the width prop remains data for the ?workspace=current branch.
    const adminContent = root.querySelector("[data-admin-content-width=compact]");
    expect(adminContent?.className).toContain("w-full");
    expect(adminContent?.className).not.toContain("max-w-");
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
    // D4 top bar: "Admin" on its own, no breadcrumb (and, since 2026-10-19, no tile).
    const bar = document.querySelector<HTMLElement>("[data-page-top-bar]")!;
    expect(bar.querySelector("h1")?.textContent).toBe("Admin");
    expect(bar.querySelector("[data-page-breadcrumb]")).toBeNull();
    expect(bar.querySelector("[data-page-icon-tile]")).toBeNull();
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
