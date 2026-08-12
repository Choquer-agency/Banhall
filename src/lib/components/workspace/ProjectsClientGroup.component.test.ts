import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
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
    '[role="region"][aria-label="Acme Labs board. Scroll horizontally to review every workflow stage."]'
  );
const draftingHeader = () =>
  [...document.querySelectorAll("header")].find((header) =>
    header.getAttribute("aria-label")?.startsWith("Drafting")
  );

describe("ProjectsClientGroup lane presentation (per-client stage-column board)", () => {
  beforeEach(() => {
    __resetConvexStub();
  });

  it("marks a verified non-zero stage with no loaded rows as 'none loaded yet'", async () => {
    // Exhausted server page with zero rows while the verified stageCounts
    // record still reports two drafting projects (sum === projectCount).
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

    await expect
      .poll(() => document.querySelector("[data-none-loaded]"))
      .not.toBeNull();
    expect(draftingHeader()?.getAttribute("aria-label")).toBe(
      "Drafting, 2 projects — none loaded yet"
    );
    expect(draftingHeader()?.textContent).toContain("none loaded yet");
    // Header band total stays the exact recorded-projection count in the
    // mono data role.
    expect(
      document.querySelector("[data-client-group-count]")?.textContent?.replace(/\s+/g, " ").trim()
    ).toBe("2 projects");
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

    // Same kanban anatomy as the ungrouped board: a horizontal snap region
    // of same-tone stage columns, labelled per client.
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

    // All ten canonical stages render — hide-empty is inert without exact
    // per-client truth.
    await expect.poll(() => document.querySelectorAll("[data-board-column]").length).toBe(10);
    expect(document.querySelectorAll("article")).toHaveLength(1);
  });
});
