import { beforeEach, describe, expect, inject, it, vi } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import { authClient } from "$lib/authClient";
import WorkspaceChrome from "./WorkspaceChrome.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

declare module "vitest" {
  export interface ProvidedContext {
    expectedPointer: "fine" | "coarse";
  }
}

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const tallContent = createRawSnippet(() => ({
  render: () => `<div data-testid="tall-content" style="height:1800px">Utility content</div>`,
}));

describe("WorkspaceChrome pointer contexts", () => {
  beforeEach(() => {
    vi.mocked(authClient.signOut).mockReset();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setPageUrl("/settings");
    __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  });

  it("keeps actual drawer rows at their approved declared-pointer size", async () => {
    // The instance declares the expectation independently of observed media.
    const pointer = inject("expectedPointer");
    expect(["fine", "coarse"]).toContain(pointer);
    await browserPage.viewport(390, 844);
    await expect.poll(() => ({
      coarse: window.matchMedia("(pointer: coarse)").matches,
      fine: window.matchMedia("(pointer: fine)").matches,
    }), { timeout: 1_000 }).toEqual({ coarse: pointer === "coarse", fine: pointer === "fine" });
    expect(window.matchMedia(`(pointer: ${pointer})`).matches).toBe(true);
    expect(window.matchMedia(`(pointer: ${pointer === "coarse" ? "fine" : "coarse"})`).matches).toBe(false);
    await render(WorkspaceChrome, { title: "Settings", children: tallContent });
    await browserPage.getByRole("button", { name: "Open workspace navigation", exact: true }).click();
    await expect.element(browserPage.getByRole("button", { name: "Close workspace navigation", exact: true })).toBeVisible();
    const drawer = document.querySelector<HTMLElement>("[data-workspace-drawer]")!;
    const rows = Array.from(drawer.querySelectorAll<HTMLElement>(".workspace-rail-row"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await expect.poll(() => rows.map((row) => row.getBoundingClientRect().height))
      .toEqual(rows.map(() => pointer === "coarse" ? 44 : 28));
    await browserPage.getByRole("button", { name: "Close workspace navigation", exact: true }).click();
    await expect.poll(() => drawer.isConnected).toBe(false);
  });
});
