import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { userEvent } from "vitest/browser";
import ProjectsClientGroup from "./ProjectsClientGroup.svelte";
import {
  __resetConvexStub,
  __setPaginatedRows,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Per-client board truth for one client section (Focus retired 2026-08-12;
 * lanes render the STANDARD stage-column board scoped to the client). The
 * board's column headers carry the honest count ladder: verified exact
 * stageCounts are exact ("none loaded yet" when nothing is loaded), and the
 * preview cap, the Focus remainder link, and the inline hidden-stages
 * disclosure no longer exist.
 */

function projectRow(id: string, title: string, workflowStage: string | null = "drafting") {
  return {
    _id: id,
    title,
    clientName: "Acme Labs",
    ...(workflowStage ? { workflowStage } : {}),
    status: "draft",
    fiscalYearEnd: Date.UTC(2025, 11, 31),
    updatedAt: 1753747200000,
    ownerId: "user-1",
    ownerLabel: "Olivia Owner",
  };
}

const boardRegion = () =>
  document.querySelector<HTMLElement>(
    '[role="region"][aria-label="Acme Labs, Fiscal 2025 board. Scroll horizontally to review every workflow stage."]'
  );
const draftingHeader = () =>
  [...document.querySelectorAll("header")].find((header) =>
    header.getAttribute("aria-label")?.startsWith("Drafting")
  );

describe("ProjectsClientGroup lane presentation (per-client stage-column board)", () => {
  beforeEach(() => {
    __resetConvexStub();
  });

  it("states the loaded truth when a client page has no rows", async () => {
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", []);
    render(ProjectsClientGroup, {
      companyKey: "acme",
      clientName: "Acme Labs",
      projectCount: 2,
      stageCounts: { drafting: 2 },
      hideEmpty: true,
      presentation: "lane" as const,
      open: true,
      onToggle: () => {},
    });

    await expect.poll(() => document.querySelector("[data-client-group-body]")?.textContent).toContain(
      "No loaded projects for this client name."
    );
    // The compact repository header does not repeat the project total.
    expect(document.querySelector("[data-client-group-count]")).toBeNull();
  });

  it("keeps exact loaded lane counts unqualified", async () => {
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Drafted claim"),
    ]);
    render(ProjectsClientGroup, {
      companyKey: "acme",
      clientName: "Acme Labs",
      projectCount: 1,
      stageCounts: { drafting: 1 },
      hideEmpty: true,
      presentation: "lane" as const,
      open: true,
      onToggle: () => {},
    });

    await expect.poll(() => draftingHeader()).not.toBeUndefined();
    expect(draftingHeader()?.getAttribute("aria-label")).toBe("Drafting, 1 projects");
    expect(draftingHeader()?.textContent).not.toContain("none loaded yet");
    expect(draftingHeader()?.textContent).not.toContain("not fully loaded");
  });

  it("renders the standard stage-column board with ALL loaded cards, per-client hide-empty, and the client-prefilled creation footer", async () => {
    __setPaginatedRows(
      "dashboard:listCompanyProjectsByStageRank",
      [1, 2, 3, 4, 5].map((n) => projectRow(`p${n}`, `Drafted claim ${n}`))
    );
    render(ProjectsClientGroup, {
      companyKey: "acme",
      clientName: "Acme Labs",
      projectCount: 5,
      stageCounts: { drafting: 5 },
      hideEmpty: true,
      presentation: "lane" as const,
      open: true,
      onToggle: () => {},
    });

    expect(document.querySelector('[data-fiscal-year-group="2025"]')?.textContent).toContain("Fiscal 2025");
    // Same kanban anatomy as the ungrouped board, nested inside fiscal year.
    await expect.poll(() => boardRegion()).not.toBeNull();
    expect(boardRegion()?.className).toContain("scrollbar-hidden");
    expect(boardRegion()?.className).toContain("snap-x");
    // Hide-empty honors THIS client's verified counts: only drafting renders
    // and its column holds every loaded card (the 3-card preview is retired).
    const columns = document.querySelectorAll("[data-board-column]");
    expect(columns).toHaveLength(1);
    expect(columns[0].getAttribute("data-board-column")).toBe("drafting");
    await expect.poll(() => document.querySelectorAll("article").length).toBe(5);
    // The section band names the client, so cards drop the client line; the
    // column chip carries stage identity (no per-card stage badge needed).
    expect(document.querySelector('article [data-card-field="client"]')).toBeNull();
    expect(document.querySelector('article [data-card-field="stage"]')).toBeNull();
    expect(document.querySelector('article [data-card-fiscal-year]')).toBeNull();
    // The creation footer navigates to the wizard with this client's
    // recorded-name prefill (the wizard's own param — not the retired board
    // focus param).
    const footer = document.querySelector<HTMLAnchorElement>('[data-add-new-project="drafting"]');
    expect(footer?.getAttribute("href")).toBe(
      `/project/new?client=${encodeURIComponent("Acme Labs")}`
    );
    expect(footer?.getAttribute("aria-label")).toContain("Acme Labs");
    // Focus and the inline hidden-stages disclosure are fully retired; the
    // exhausted page offers no in-place load-more.
    expect(document.querySelector("[data-client-focus]")).toBeNull();
    expect(document.querySelector("[data-lane-more]")).toBeNull();
    expect(document.querySelector("[data-hidden-stages-disclosure]")).toBeNull();
    expect(document.querySelector("[data-lane-load-more]")).toBeNull();
  });

  it("collapses fiscal-year folders independently while keeping the client open", async () => {
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Current claim"),
      {
        ...projectRow("p2", "Older claim"),
        fiscalYearEnd: Date.UTC(2024, 11, 31),
      },
      {
        ...projectRow("p3", "Year pending"),
        fiscalYearEnd: undefined,
      },
    ]);
    render(ProjectsClientGroup, {
      companyKey: "acme",
      clientName: "Acme Labs",
      projectCount: 3,
      stageCounts: { drafting: 3 },
      presentation: "list" as const,
      open: true,
      onToggle: () => {},
    });

    const currentToggle = document.querySelector<HTMLButtonElement>(
      '[data-fiscal-year-toggle="2025"]'
    );
    await expect.poll(() => currentToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-fiscal-year-body="2025"]')).not.toBeNull();
    expect(document.querySelector('[data-fiscal-year-body="2024"]')).not.toBeNull();
    const unrecorded = document.querySelector<HTMLElement>(
      '[data-fiscal-year-group="unrecorded"]'
    );
    expect(unrecorded?.getAttribute("data-fiscal-year-kind")).toBe("unrecorded");
    expect(unrecorded?.classList.contains("border-l")).toBe(false);
    expect(unrecorded?.className).toContain("border-dashed");
    expect(unrecorded?.textContent).toContain("Fiscal year not set");
    expect(currentToggle?.lastElementChild?.hasAttribute("data-disclosure-chevron")).toBe(true);
    expect(currentToggle?.className).toContain("grid-cols-[1rem_minmax(0,1fr)_1rem]");
    expect(currentToggle?.className).toContain("sm:min-h-8");
    expect(currentToggle?.className).not.toContain("sm:min-h-10");
    expect(currentToggle?.className).toContain("bg-chrome/70");
    expect(currentToggle?.className).not.toContain("bg-primary-wash");
    expect(currentToggle?.querySelector("[data-disclosure-chevron]")?.getAttribute("class")).toContain(
      "text-ink-secondary"
    );
    expect(document.querySelector('article [data-card-fiscal-year]')).toBeNull();
    const currentDisclosure = currentToggle
      ?.closest("[data-fiscal-year-group]")
      ?.querySelector<HTMLElement>("[data-disclosure]");
    expect(getComputedStyle(currentDisclosure!).transitionProperty).toContain("grid-template-rows");

    await userEvent.click(currentToggle!);
    expect(currentToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(currentToggle?.getAttribute("aria-label")).toBe("Expand Fiscal 2025");
    const closingBody = document.querySelector<HTMLElement>('[data-fiscal-year-body="2025"]');
    if (closingBody) expect(closingBody.closest("[inert]")).not.toBeNull();
    await expect.poll(
      () => document.querySelector('[data-fiscal-year-body="2025"]'),
      { timeout: 2000 }
    ).toBeNull();
    expect(document.querySelector('[data-fiscal-year-body="2024"]')).not.toBeNull();
    expect(document.querySelector('[data-client-group-trigger]')?.getAttribute("aria-expanded")).toBe(
      "true"
    );
    expect(document.querySelector('[data-client-group-trigger]')?.className).toContain("min-h-11");
    expect(document.querySelector('[data-client-group-trigger]')?.className).toContain("sm:min-h-10");

    await userEvent.click(currentToggle!);
    expect(currentToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-fiscal-year-body="2025"]')).not.toBeNull();
  });

  it("keeps the first client load visually quiet, then reveals the real fiscal hierarchy", async () => {
    render(ProjectsClientGroup, {
      companyKey: "acme",
      clientName: "Acme Labs",
      projectCount: 1,
      stageCounts: { drafting: 1 },
      presentation: "list" as const,
      open: true,
      onToggle: () => {},
    });

    const loading = document.querySelector<HTMLElement>("[data-client-projects-loading]");
    expect(loading?.className).toContain("sr-only");
    expect(document.querySelector(".animate-pulse")).toBeNull();
    expect(document.querySelector("[data-fiscal-year-group]")).toBeNull();

    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Current claim"),
    ]);

    await expect.poll(() => document.querySelector("[data-client-projects-resolved]")).not.toBeNull();
    await expect.poll(() => document.querySelector('[data-fiscal-year-group="2025"]')).not.toBeNull();
    expect(document.querySelector("[data-client-projects-loading]")).toBeNull();
  });

  it("fails honest without verified counts: nothing hides and loaded-only counts carry qualifiers", async () => {
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Drafted claim"),
    ]);
    render(ProjectsClientGroup, {
      companyKey: "acme",
      clientName: "Acme Labs",
      projectCount: 3,
      // Sum (1) disagrees with projectCount (3): treated as not backfilled.
      stageCounts: { drafting: 1 },
      hideEmpty: true,
      presentation: "lane" as const,
      open: true,
      onToggle: () => {},
    });

    // An exhausted fiscal group derives exact stage counts from its complete
    // client page, so hide-empty leaves only Drafting.
    await expect.poll(() => document.querySelectorAll("[data-board-column]").length).toBe(1);
    expect(document.querySelectorAll("article")).toHaveLength(1);
  });
});
