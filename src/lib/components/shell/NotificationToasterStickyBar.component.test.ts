import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import StickyBarToasterHarness from "$lib/test/StickyBarToasterHarness.svelte";
import NewProjectPage from "../../../routes/project/new/+page.svelte";
import ReadingInterview from "$lib/components/generation/reading/ReadingInterview.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";

/**
 * Recheck #1: on tablet (1024) and phone (390) the notification card sat on
 * the sticky action bar and hid "Start step by step" (H1, H2) and "Cancel
 * generation" (H4). The stack now rises above any sticky action bar, so the
 * bar and its primary action stay clear and clickable.
 */
const now = Date.now();
const notification = {
  _id: "n-1",
  _creationTime: now,
  kind: "invite_accepted",
  title: "Fidelity Recheck joined Banhall",
  body: "They accepted your invite as Consultant.",
  href: "/team",
  createdAt: now - 60_000,
};

function overlaps(a: DOMRect, b: DOMRect) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The card clears the bar, and the action under the bar still takes the click. */
async function expectCardClearsBar(barSelector: string, actionSelector: string) {
  await expect.poll(() => document.querySelector("[data-notification]")).not.toBeNull();
  const bar = document.querySelector<HTMLElement>(barSelector)!;
  const action = bar.querySelector<HTMLElement>(actionSelector)!;
  const barRect = bar.getBoundingClientRect();
  // The bar sits on the window's bottom edge, where the card used to be.
  expect(Math.round(barRect.bottom)).toBe(window.innerHeight);
  await expect
    .poll(() => document.querySelector<HTMLElement>("[data-notification-toaster]")!.getBoundingClientRect().bottom)
    .toBeLessThanOrEqual(barRect.top - 16 + 0.5);
  const card = document.querySelector<HTMLElement>("[data-notification]")!.getBoundingClientRect();
  expect(overlaps(card, barRect)).toBe(false);
  const target = action.getBoundingClientRect();
  const hit = document.elementFromPoint(target.left + target.width / 2, target.top + target.height / 2);
  expect(action.contains(hit)).toBe(true);
}

beforeEach(() => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setQueryData("notifications:listRecent", [notification]);
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
});

describe("Notification card above sticky action bars", () => {
  it("clears the New project start bar on a tablet (H1, 1024)", async () => {
    await page.viewport(1024, 900);
    __setPageUrl("/project/new");
    await render(StickyBarToasterHarness, { content: NewProjectPage });
    await expectCardClearsBar("[data-bottom-bar]", "[data-bottom-start]");
    // Still at the right edge, as on desktop.
    const section = document.querySelector<HTMLElement>("[data-notification-toaster]")!.getBoundingClientRect();
    expect(Math.round(window.innerWidth - section.right)).toBe(16);
  });

  it("clears the New project start bar on a phone (H2, 390)", async () => {
    await page.viewport(390, 844);
    __setPageUrl("/project/new");
    await render(StickyBarToasterHarness, { content: NewProjectPage });
    await expectCardClearsBar("[data-bottom-bar]", "[data-bottom-start]");
  });

  it("clears the Reading cancel bar on a phone (H4, 390)", async () => {
    await page.viewport(390, 844);
    __setPageUrl("/project/p-1");
    __setQueryData("seeds:getReadingFacts", {
      count: 1,
      latest: [{ seq: 1, chip: "Fact", quote: "We ran three builds over the summer.", sourceLabel: "Anika, line 7" }],
      startedAt: now - 20_000,
      expectedMs: 40_000,
      done: false,
    });
    await render(StickyBarToasterHarness, {
      content: ReadingInterview,
      contentProps: { generationId: "generation-1", layout: "phone", canEdit: true, onCancel: () => {} },
    });
    await expectCardClearsBar("[data-reading-bottom]", "[data-reading-cancel]");
  });

  it("stays 16px from the bottom when the page has no sticky bar (desktop)", async () => {
    await page.viewport(1440, 900);
    __setPageUrl("/project/new");
    await render(StickyBarToasterHarness, { content: NewProjectPage });
    await expect.poll(() => document.querySelector("[data-notification]")).not.toBeNull();
    expect(document.querySelector("[data-bottom-bar]")).toBeNull();
    const section = document.querySelector<HTMLElement>("[data-notification-toaster]")!.getBoundingClientRect();
    expect(Math.round(window.innerHeight - section.bottom)).toBe(16);
  });
});
