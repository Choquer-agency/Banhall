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
    const description = root.querySelector<HTMLElement>("[data-admin-page-heading] p")!;
    expect(description.textContent).toBe("Operational model evidence.");
    expect(getComputedStyle(description).fontSize).toBe("15px");
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
