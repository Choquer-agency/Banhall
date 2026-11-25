// Final review of #48 to #51 (P2-1): /admin/brain lists the Brain copies the
// old-page send back left approved, and an Admin keeps or removes each one.
// Every title here is made up.
import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import BrainPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __activeQueryCount,
  __mutationCalls,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const LIST = "brain:listOldPageCopies";
const NOW = Date.UTC(2026, 10, 18, 12);

function copy(i: number, outcome: "unknown_origin" | "unlink_only", detail: string) {
  return {
    _id: `old-page-row-${i}` as Id<"brainOldPageCopies">,
    sourceId: `brain-source-old-${i}` as Id<"brainSources">,
    outcome,
    detail,
    title: `Made-up PD ${i}`,
    docType: "pd",
    status: "approved",
    createdAt: NOW - i * 86_400_000,
  };
}

const rows = () => [...document.querySelectorAll("[data-old-page-copy]")];

beforeEach(async () => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetAuthState();
  __resetConvexStub();
  __setPageUrl("/admin/brain");
  __setQueryData("users:getCurrentUser", { role: "admin", name: "Test Admin", isOwner: true, isAnonymous: false });
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData("brain:brainStats", { approved: 3, pending: 0, revoked: 0, byIndustry: {} });
  __setPaginatedRows("brain:listBrainSources", []);
  await page.viewport(1280, 900);
});

describe("/admin/brain Old page copies", () => {
  it("is read only on its tab, and lists each copy with why it was left", async () => {
    __setQueryData(LIST, {
      copies: [copy(1, "unknown_origin", "no_approval_time"), copy(2, "unlink_only", "made_before_this_approval")],
      more: false,
    });
    render(BrainPage);
    await expect.element(page.getByRole("tab", { name: "Old page copies" })).toBeVisible();
    expect(__activeQueryCount(LIST)).toBe(0);
    await page.getByRole("tab", { name: "Old page copies" }).click();
    await expect.poll(() => rows().length).toBe(2);
    await expect.element(page.getByText("Made-up PD 1")).toBeVisible();
    await expect.element(page.getByText(/Origin unknown: the file has no approval time/)).toBeVisible();
    await expect.element(page.getByText(/Made before the file was approved/)).toBeVisible();
    await expect.element(page.getByText(/The Brain build waits until every copy of unknown origin is decided/)).toBeVisible();
  });

  it("Keep keeps one copy; Remove asks first, then revokes it with a reason", async () => {
    __setQueryData(LIST, { copies: [copy(1, "unknown_origin", "creator_or_time_differs")], more: false });
    render(BrainPage);
    await page.getByRole("tab", { name: "Old page copies" }).click();
    await page.getByRole("button", { name: "Keep" }).click();
    await expect.poll(() => __mutationCalls("brain:keepOldPageCopy")).toEqual([{ sourceId: "brain-source-old-1" }]);

    await page.getByRole("button", { name: "Remove from the Brain" }).click();
    await expect.element(page.getByText("Remove this copy? It is erased from search.")).toBeVisible();
    expect(__mutationCalls("brain:revokeSource")).toEqual([]);
    await page.getByRole("button", { name: "Yes, remove" }).click();
    await expect
      .poll(() => __mutationCalls("brain:revokeSource"))
      .toEqual([{ sourceId: "brain-source-old-1", reason: "Old page copy removed after review" }]);
  });

  it("says when nothing waits, and when more than the first 100 wait", async () => {
    __setQueryData(LIST, { copies: [], more: false });
    render(BrainPage);
    await page.getByRole("tab", { name: "Old page copies" }).click();
    await expect.element(page.getByText("No copies wait for a decision.")).toBeVisible();
  });

  it("notes a longer list", async () => {
    __setQueryData(LIST, { copies: [copy(1, "unlink_only", "names_another_file")], more: true });
    render(BrainPage);
    await page.getByRole("tab", { name: "Old page copies" }).click();
    await expect.element(page.getByText("Showing the first 100. Decide these to see the rest.")).toBeVisible();
  });
});
