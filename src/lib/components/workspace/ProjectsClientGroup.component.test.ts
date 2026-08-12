import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ProjectsClientGroup from "./ProjectsClientGroup.svelte";
import {
  __resetConvexStub,
  __setPaginatedRows,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Lane-header truth for one client section (2026-08-06 second amendment):
 * a verified exact stage count with zero loaded rows must present the
 * "none loaded yet" qualifier — never a bare number that implies the loaded
 * page is complete, and never a false exact zero.
 */
describe("ProjectsClientGroup lane header truth", () => {
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
      focusHref: "/projects?client=acme",
    });

    await expect
      .poll(() => document.querySelector("[data-none-loaded]"))
      .not.toBeNull();
    const draftingHeader = [...document.querySelectorAll("header")].find((header) =>
      header.getAttribute("aria-label")?.startsWith("Drafting")
    );
    expect(draftingHeader?.getAttribute("aria-label")).toBe(
      "Drafting, 2 projects — none loaded yet"
    );
    expect(draftingHeader?.textContent).toContain("none loaded yet");
  });

  it("keeps exact loaded lane counts unqualified", async () => {
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      {
        _id: "p1",
        title: "Drafted claim",
        clientName: "Acme Labs",
        workflowStage: "drafting",
        status: "draft",
        fiscalYearEnd: Date.UTC(2025, 11, 31),
        updatedAt: 1753747200000,
        ownerId: "user-1",
        ownerLabel: "Olivia Owner",
      },
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
      focusHref: "/projects?client=acme",
    });

    await expect
      .poll(() =>
        [...document.querySelectorAll("header")].find((header) =>
          header.getAttribute("aria-label")?.startsWith("Drafting")
        )
      )
      .not.toBeUndefined();
    const draftingHeader = [...document.querySelectorAll("header")].find((header) =>
      header.getAttribute("aria-label")?.startsWith("Drafting")
    );
    expect(draftingHeader?.getAttribute("aria-label")).toBe("Drafting, 1 projects");
    expect(draftingHeader?.textContent).not.toContain("none loaded yet");
    expect(draftingHeader?.textContent).not.toContain("not fully loaded");
  });
});
