import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import AdminWorkspacePage from "./AdminWorkspacePage.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

const content = createRawSnippet(() => ({
  render: () => '<section data-testid="route-content"><h2>Route-owned content</h2></section>',
}));

const actions = createRawSnippet(() => ({
  render: () => '<button data-testid="admin-action" type="button">Admin action</button>',
}));

describe("AdminWorkspacePage", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  });

  it("renders the light workspace shell with one main/h1, canonical links, compact width, and route action", async () => {
    __setPageUrl("/admin/models");
    await render(AdminWorkspacePage, {
      title: "Model A/B preferences",
      description: "Operational model evidence.",
      width: "compact",
      children: content,
      actions,
    });

    const root = document.querySelector<HTMLElement>("[data-workspace-chrome]")!;
    expect(root.getAttribute("data-workspace-theme")).toBe("light");
    expect(root.querySelectorAll("main")).toHaveLength(1);
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector("h1")?.textContent).toBe("Model A/B preferences");
    expect(root.querySelector('a[href="/my-work"]')).not.toBeNull();
    expect(root.querySelector('a[href="/projects"]')).not.toBeNull();
    expect(root.querySelector("header [data-testid=admin-action]")).not.toBeNull();
    // Full-width workspace presentation (2026-08-10): no centered max-width;
    // the width prop remains data for the ?workspace=current branch.
    const adminContent = root.querySelector("[data-admin-content-width=compact]");
    expect(adminContent?.className).toContain("w-full");
    expect(adminContent?.className).not.toContain("max-w-");
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
