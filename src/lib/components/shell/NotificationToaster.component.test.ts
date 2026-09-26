import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import NotificationToaster from "./NotificationToaster.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

vi.mock("$lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));

const now = Date.now();
function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: now,
    kind: "handoff",
    title: `Project ${id} is with you`,
    body: "Drafting. Handed off by Mo Reyes.",
    href: `/project/${id}`,
    createdAt: now - 60_000,
    ...overrides,
  };
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-notification]"));

describe("NotificationToaster (I3, F6 card)", () => {
  beforeEach(() => {
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setPageUrl("/my-work");
  });

  it("shows unseen notifications from the last day, newest first, at most three", async () => {
    __setQueryData("notifications:listRecent", [
      row("a"),
      row("b", { kind: "ideas_ready", title: "Ideas are ready for Uncertainty", body: "Acme. Opens the Plan tab on that step." }),
      row("c"),
      row("d"),
      row("seen", { seenAt: now - 1000 }),
      row("old", { createdAt: now - 25 * 60 * 60 * 1000 }),
    ]);
    await render(NotificationToaster, {});
    await expect.poll(() => cards().length).toBe(3);
    const titles = cards().map((card) => card.querySelector("[data-notification-open] span")?.textContent);
    expect(titles).toEqual(["Project a is with you", "Ideas are ready for Uncertainty", "Project c is with you"]);
    // AI kinds carry the Aurora mark; a handoff does not.
    expect(cards()[1].querySelector("[data-ai-mark]")).not.toBeNull();
    expect(cards()[0].querySelector("[data-ai-mark]")).toBeNull();
    const box = cards()[0];
    expect(getComputedStyle(box).borderRadius).toBe("12px");
    expect(getComputedStyle(box).padding).toBe("16px");
    const section = document.querySelector<HTMLElement>("[data-notification-toaster]")!.getBoundingClientRect();
    expect(Math.round(window.innerWidth - section.right)).toBe(16);
  });

  it("closing marks the notification seen and hides it at once", async () => {
    __setQueryData("notifications:listRecent", [row("a")]);
    await render(NotificationToaster, {});
    await page.getByRole("button", { name: "Dismiss: Project a is with you" }).click();
    await expect.poll(() => cards().length).toBe(0);
    expect(__mutationCalls("notifications:markSeen")).toEqual([{ ids: ["a"] }]);
    expect(__navigationCalls).toEqual([]);
  });

  it("clicking opens the page and marks it seen", async () => {
    __setQueryData("notifications:listRecent", [row("a")]);
    await render(NotificationToaster, {});
    await page.getByRole("button", { name: /Project a is with you/ }).first().click();
    await expect.poll(() => __navigationCalls).toEqual([{ kind: "goto", url: "/project/a" }]);
    expect(__mutationCalls("notifications:markSeen")).toEqual([{ ids: ["a"] }]);
  });

  it("marks a notification about the current page seen without showing it", async () => {
    __setPageUrl("/project/a");
    __setQueryData("notifications:listRecent", [row("a"), row("b")]);
    await render(NotificationToaster, {});
    await expect.poll(() => __mutationCalls("notifications:markSeen")).toEqual([{ ids: ["a"] }]);
    expect(cards().map((card) => card.textContent)).toHaveLength(1);
    expect(cards()[0].textContent).toContain("Project b is with you");
  });
});
