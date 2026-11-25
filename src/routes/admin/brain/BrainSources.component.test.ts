// The /admin/brain source list loads in pages (2026-11-17): the first page
// of 50, Show more for the next, the tab's status as the read's argument,
// and the counts from the stored stats.
import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import BrainPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __activeQueryArgs, __loadMoreCalls, __paginatedInitialSizes, __resetConvexStub,
  __setPaginatedRows, __setPaginatedRowsForArgs, __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const SOURCES = "brain:listBrainSources";
const STATS = "brain:brainStats";
const NOW = Date.UTC(2026, 10, 17, 12);

function row(i: number, status: "pending" | "approved" | "revoked") {
  return {
    _id: `brain-source-${status}-${i}` as Id<"brainSources">,
    title: `Fixture ${status} PD ${i}`,
    status,
    kind: "pd_pair",
    industry: "software",
    writerName: null,
    writerTier: 0.4,
    docType: "pd",
    craOutcome: null,
    scienceCode: null,
    hasEntry: status === "approved",
    createdAt: NOW - i,
  };
}

const titles = () =>
  [...document.querySelectorAll("button p.truncate")].map((el) => el.textContent?.trim());
const showMore = () => document.querySelector<HTMLButtonElement>("[data-brain-show-more]");

beforeEach(async () => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetAuthState();
  __resetConvexStub();
  __setPageUrl("/admin/brain");
  __setQueryData("users:getCurrentUser", { role: "admin", name: "Test Admin", isOwner: true, isAnonymous: false });
  __setQueryData("myWork:getViewConfig", { killSwitch: false, ready: true });
  __setQueryData(STATS, { approved: 1240, pending: 75, revoked: 3, byIndustry: { software: 1000, biotech: 240 } });
  __setPaginatedRows(SOURCES, []);
  await page.viewport(1440, 900);
});

describe("/admin/brain paged source list", () => {
  it("asks for a first page of 50 and shows Show more while more pages exist", async () => {
    __setPaginatedRowsForArgs(SOURCES, { status: "pending" }, Array.from({ length: 50 }, (_, i) => row(i, "pending")), { more: true });
    render(BrainPage);
    await expect.poll(() => titles().length).toBe(50);
    expect(titles()[0]).toBe("Fixture pending PD 0");
    expect(__paginatedInitialSizes(SOURCES)[0]).toEqual({ args: { status: "pending" }, initialNumItems: 50 });
    await expect.element(page.getByRole("button", { name: "Show more" })).toBeVisible();

    await page.getByRole("button", { name: "Show more" }).click();
    expect(__loadMoreCalls(SOURCES)).toEqual([{ args: { status: "pending" }, numItems: 50 }]);
  });

  it("hides Show more on the last page", async () => {
    __setPaginatedRowsForArgs(SOURCES, { status: "pending" }, [row(0, "pending"), row(1, "pending")]);
    render(BrainPage);
    await expect.poll(() => titles().length).toBe(2);
    expect(showMore()).toBeNull();
  });

  it("reads the tab's status and shows stored counts on the tabs and cards", async () => {
    __setPaginatedRowsForArgs(SOURCES, { status: "pending" }, [row(0, "pending")]);
    __setPaginatedRowsForArgs(SOURCES, { status: "approved" }, [row(0, "approved"), row(1, "approved")], { more: true });
    render(BrainPage);
    await expect.poll(() => titles()).toEqual(["Fixture pending PD 0"]);
    await expect.element(page.getByRole("tab", { name: "Queue · 75" })).toBeVisible();
    await expect.element(page.getByRole("tab", { name: "In the Brain · 1240" })).toBeVisible();
    expect(document.body.textContent).toContain("software (1000), biotech (240)");

    await page.getByRole("tab", { name: /^In the Brain/ }).click();
    await expect.poll(() => titles()).toEqual(["Fixture approved PD 0", "Fixture approved PD 1"]);
    expect(__activeQueryArgs(SOURCES)).toEqual([{ status: "approved" }]);
    expect(showMore()).not.toBeNull();
  });

  it("shows the empty message when a status has no sources", async () => {
    __setPaginatedRowsForArgs(SOURCES, { status: "pending" }, []);
    render(BrainPage);
    await expect.poll(() => document.body.textContent).toContain("Queue is empty");
    expect(showMore()).toBeNull();
  });
});
