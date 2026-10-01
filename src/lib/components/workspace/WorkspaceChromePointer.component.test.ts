import { beforeEach, describe, expect, inject, it, vi } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import { authClient } from "$lib/authClient";
import WorkspaceChrome from "./WorkspaceChrome.svelte";
import ProjectBoardCard from "./ProjectBoardCard.svelte";
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
      .toEqual(rows.map(() => pointer === "coarse" ? 44 : 32));
    await browserPage.getByRole("button", { name: "Close workspace navigation", exact: true }).click();
    await expect.poll(() => drawer.isConnected).toBe(false);
  });
});

// Duplicate on a project card (2026-09-25): touch screens have no hover, so
// the coarse-pointer instance must show it without one and give it a 44px
// hit area; fine pointers keep it hidden until hover or focus.
describe("Duplicate on a project card, per pointer", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setQueryData("users:getCurrentUser", { _id: "u-1", role: "writer" });
  });

  it("is always shown with a 44px target on touch, hidden until hover otherwise", async () => {
    const pointer = inject("expectedPointer");
    await browserPage.viewport(390, 844);
    await render(ProjectBoardCard, {
      row: {
        id: "p1",
        title: "Northline Labs narrative",
        clientName: "Northline Labs",
        workflowStage: "drafting",
        legacyStatus: "draft",
        owner: { kind: "canonical", label: "Olivia Owner" },
        generationActivity: null,
        updatedDate: "Jul 29, 2026",
      },
    });
    await expect.poll(() => document.querySelector("[data-duplicate-project]")).not.toBeNull();
    const button = document.querySelector<HTMLElement>("[data-duplicate-project]")!;
    await expect.poll(() => getComputedStyle(button).opacity).toBe(pointer === "coarse" ? "1" : "0");
    const hitArea = getComputedStyle(button, "::before");
    const box = button.getBoundingClientRect();
    if (pointer === "coarse") {
      expect(hitArea.position).toBe("absolute");
      expect(box.width + 2 * -parseFloat(hitArea.left)).toBe(44);
      expect(box.height + 2 * -parseFloat(hitArea.top)).toBe(44);
    } else {
      expect(hitArea.content).toBe("none");
    }
  });
});
