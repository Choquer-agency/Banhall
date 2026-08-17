import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsClientGroups from "./ProjectsClientGroups.svelte";
import {
  __activeQueryCount,
  __isQueryActive,
  __resetConvexStub,
  __setPaginatedRows,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * Client → Status container (2026-08-06 second amendment; Focus drill-in
 * retired and lanes flattened 2026-08-12): truthful, server-backed sections
 * keyed by recorded client name; inside a section, pipeline-ordered status
 * sub-headers cut from the stage-ranked server order (list) or one
 * horizontal snap row of ALL loaded project cards (lane). Pins the honesty
 * contract — grouping/backfill truth remains available to assistive
 * technology without adding visible explanatory chrome, "Company" appearing
 * nowhere, exact-stageCounts-only hide-empty with the Display
 * menu switch as the only reveal control (no inline disclosure), and lazy
 * per-section subscriptions.
 */

function companyRow(
  key: string,
  name: string,
  count: number,
  stageCounts?: Record<string, number>
) {
  return {
    companyKey: key,
    clientName: name,
    projectCount: count,
    ...(stageCounts ? { stageCounts } : {}),
    updatedAt: 1753747200000,
  };
}

function projectRow(
  id: string,
  title: string,
  updatedAt: number,
  workflowStage: string | null = "drafting"
) {
  return {
    _id: id,
    title,
    clientName: "Northline Labs",
    ...(workflowStage ? { workflowStage } : {}),
    status: "draft",
    fiscalYearEnd: Date.UTC(2025, 11, 31),
    updatedAt,
    ownerId: "user-1",
    ownerLabel: "Olivia Owner",
  };
}

const region = () =>
  document.querySelector<HTMLElement>('[role="region"][aria-label^="Projects"]');
const groupHeaders = () =>
  [...document.querySelectorAll<HTMLButtonElement>("[data-client-group] button[aria-expanded]")];

describe("ProjectsClientGroups", () => {
  beforeEach(() => {
    __resetConvexStub();
  });

  it("keeps grouping truth for assistive technology without visible qualifier chrome", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("acme", "Acme Labs", 2)]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => region()).not.toBeNull();
    const description = document.getElementById("client-grouping-description");
    expect(description?.className).toContain("sr-only");
    expect(description?.textContent).toContain(
      "Grouped by recorded client name as entered on projects. Durable client records are not yet modelled."
    );
    expect(description?.textContent).toContain(
      "Projects created before grouping was enabled may not appear here."
    );
    expect(document.querySelector("[data-client-grouping-qualifier]")).toBeNull();
    expect(document.querySelector("[data-client-grouping-backfill-notice]")).toBeNull();
  });

  it("renders one quiet section per recorded client name in server order and never says Company", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 2),
      companyRow("borealis", "Borealis Mining", 1),
      companyRow("cormorant", "Cormorant Foods", 12),
    ]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(3);
    const headers = groupHeaders().map((button) => button.textContent?.replace(/\s+/g, " ").trim());
    expect(headers).toEqual(["Acme Labs", "Borealis Mining", "Cormorant Foods"]);
    expect(document.querySelector("[data-client-group-count]")).toBeNull();
    expect(document.querySelector("[data-client-table-header]")).toBeNull();
    expect(region()?.textContent).not.toMatch(/\bcompany\b/i);
  });

  it("keeps project totals and stage summaries out of collapsed rows without opening subscriptions", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 4, { intake: 2, drafting: 1, internal_review: 1 }),
    ]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    const headerText = groupHeaders()[0].textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(headerText).toBe("Acme Labs");
    expect(headerText).not.toContain("4 projects");
    expect(headerText).not.toContain("Intake");
    expect(headerText).not.toContain("Drafting");
    expect(headerText).not.toContain("Internal review");
    expect(__isQueryActive("dashboard:listCompanyProjectsByStageRank")).toBe(false);
  });

  it("opens from the full client row and closes without a disclosure animation delay", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 1, { drafting: 1 }),
    ]);
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Drafting claim", 300, "drafting"),
    ]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    const chevron = document.querySelector<HTMLButtonElement>("[data-client-group-chevron]")!;
    expect(chevron.getAttribute("aria-label")).toBe("Expand Acme Labs");
    expect(document.querySelector("[data-client-group-body]")).toBeNull();

    chevron.click();
    await expect.poll(() => groupHeaders()[0].getAttribute("aria-expanded")).toBe("true");
    await expect.poll(() => document.querySelector("[data-fiscal-year-group]")).not.toBeNull();
    expect(chevron.getAttribute("aria-label")).toBe("Collapse Acme Labs");
    expect(chevron.className).toContain("duration-[325ms]");
    expect(chevron.className).not.toContain("hover:bg-workspace-rail-hover");
    expect(chevron.lastElementChild?.hasAttribute("data-disclosure-chevron")).toBe(true);
    expect(chevron.className).toContain("grid-cols-[minmax(0,1fr)_1.25rem]");
    expect(chevron.children).toHaveLength(2);
    expect(chevron.firstElementChild?.textContent).toBe("Acme Labs");
    const clientGroup = chevron.closest<HTMLElement>("[data-client-group]");
    expect(clientGroup?.className).toContain("border-primary/40");
    expect(clientGroup?.firstElementChild?.className).toContain("bg-primary-wash/75");
    expect(document.querySelector("[data-client-projects-resolved]")).not.toBeNull();
    expect(document.querySelector("[data-client-group-body] .animate-pulse")).toBeNull();
    const fiscalGroup = document.querySelector<HTMLElement>("[data-fiscal-year-group]");
    const fiscalToggle = fiscalGroup?.querySelector<HTMLButtonElement>("button");
    expect(fiscalGroup?.classList.contains("border-l")).toBe(false);
    expect(fiscalGroup?.className).toContain("border-line");
    expect(fiscalToggle?.className).toContain("bg-chrome/70");
    expect(fiscalToggle?.className).not.toContain("bg-primary-wash");
    expect(fiscalToggle?.className).toContain("duration-[240ms]");
    expect(fiscalToggle?.className).not.toContain("hover:bg-workspace-rail-hover");
    expect(fiscalToggle?.lastElementChild?.hasAttribute("data-disclosure-chevron")).toBe(true);

    chevron.click();
    await expect.poll(() => document.querySelector("[data-client-group-body]")).toBeNull();
    expect(groupHeaders()[0].getAttribute("aria-expanded")).toBe("false");
    expect(chevron.className).toContain("hover:bg-workspace-rail-hover");
    expect(__isQueryActive("dashboard:listCompanyProjectsByStageRank")).toBe(false);
  });

  it("expands a section into fiscal-year folders with stage-labelled cards", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 4, { intake: 1, on_hold: 1, delivered: 1, legacy: 1 }),
    ]);
    // Server order = frozen persisted ranks: intake(0) → on_hold(7) →
    // delivered(8) → legacy(1000).
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Intake claim", 300, "intake"),
      projectRow("p2", "Paused claim", 100, "on_hold"),
      projectRow("p3", "Delivered claim", 900, "delivered"),
      projectRow("p4", "Legacy claim", 50, null),
    ]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    // Collapsed sections hold zero project subscriptions.
    expect(__isQueryActive("dashboard:listCompanyProjectsByStageRank")).toBe(false);
    groupHeaders()[0].click();

    await expect.poll(() => document.querySelectorAll("[data-fiscal-year-group]").length).toBe(1);
    expect(document.querySelector("[data-fiscal-year-group]")?.textContent).toContain("Fiscal 2025");
    expect(__isQueryActive("dashboard:listCompanyProjectsByStageRank")).toBe(true);
    const titles = [...document.querySelectorAll("[data-client-group] [data-project-board-card] a")].map(
      (a) => a.textContent?.trim()
    );
    expect(titles).toEqual(["Delivered claim", "Intake claim", "Legacy claim", "Paused claim"]);
    const firstIdentity = document.querySelector<HTMLElement>('[data-card-field="identity"]');
    expect(firstIdentity?.querySelector("[data-stage-badge]")).not.toBeNull();
    expect(firstIdentity?.querySelector("[data-card-project-type]")).not.toBeNull();
    // Legacy rows carry the qualifier.
    expect(document.querySelector("[data-legacy-status-qualifier]")?.textContent).toContain(
      "Legacy status"
    );
  });

  it("hides empty statuses only from exact stageCounts, with no inline disclosure (2026-08-12: the Display menu switch is the only control)", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 1, { drafting: 1 }),
    ]);
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Drafting claim", 300, "drafting"),
    ]);
    render(ProjectsClientGroups, { hideEmpty: true });

    await expect.poll(() => groupHeaders().length).toBe(1);
    groupHeaders()[0].click();
    await expect.poll(() => document.querySelectorAll("[data-fiscal-year-group]").length).toBe(1);
    expect(document.querySelector("[data-hidden-stages-disclosure]")).toBeNull();
  });

  it("fails honest before backfill: no stageCounts means nothing hidden and loaded-only counts", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("acme", "Acme Labs", 1)]);
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Drafting claim", 300, "drafting"),
    ]);
    render(ProjectsClientGroups, { hideEmpty: true });

    await expect.poll(() => groupHeaders().length).toBe(1);
    groupHeaders()[0].click();
    await expect.poll(() => document.querySelectorAll("[data-fiscal-year-group]").length).toBe(1);
    expect(document.querySelector("[data-hidden-stages-disclosure]")).toBeNull();
  });

  it("keeps creation out of client rows and never restores the retired Focus drill-in", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("acme", "Acme & Co", 1)]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    expect(document.querySelector("[data-client-new-project]")).toBeNull();
    expect(document.querySelector("[data-client-focus]")).toBeNull();
  });

  it("lane presentation renders the standard stage-column board once per auto-expanded client", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 1, { drafting: 1 }),
      companyRow("borealis", "Borealis Mining", 1, { intake: 1 }),
    ]);
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", [
      projectRow("p1", "Drafting claim", 300, "drafting"),
    ]);
    render(ProjectsClientGroups, { presentation: "lanes" });

    // First lanes auto-expand (subscription policy: 1 + K, K ≤ 5).
    await expect.poll(
      () => document.querySelectorAll('[data-client-group-presentation="lane"]').length
    ).toBe(2);
    await expect.poll(() => groupHeaders()[0]?.getAttribute("aria-expanded")).toBe("true");
    // Each lane is the REAL board: a per-client horizontal snap region of
    // same-tone stage columns (identical anatomy to the ungrouped board).
    const laneBoard = document.querySelector<HTMLElement>(
      '[data-client-group="acme"] [role="region"][aria-label="Acme Labs, Fiscal 2025 board. Scroll horizontally to review every workflow stage."]'
    );
    expect(laneBoard).not.toBeNull();
    expect(laneBoard?.className).toContain("scrollbar-hidden");
    expect(laneBoard?.className).toContain("snap-x");
    const laneColumn = document.querySelector<HTMLElement>(
      '[data-client-group="acme"] [data-board-column="drafting"]'
    );
    expect(laneColumn).not.toBeNull();
    expect(laneColumn?.className).toContain("bg-canvas");
    // Hide-empty honors each client's own verified counts: Acme shows only
    // its drafting column.
    expect(
      document.querySelectorAll('[data-client-group="acme"] [data-board-column]')
    ).toHaveLength(1);
    // The card renders inside its stage column; the column chip carries
    // stage identity, so no per-card stage badge is added.
    expect(
      document.querySelector('[data-client-group-presentation="lane"] article a')?.textContent
    ).toContain("Drafting claim");
    expect(
      document.querySelector('[data-client-group-presentation="lane"] article [data-card-field="stage"]')
    ).toBeNull();
    // Redundant header stage-count chips were dropped with the rework.
    expect(document.querySelector("[data-client-stage-chips]")).toBeNull();
    // Creation footer carries the client prefill (wizard's own param).
    expect(
      document
        .querySelector<HTMLAnchorElement>('[data-client-group="acme"] [data-add-new-project="drafting"]')
        ?.getAttribute("href")
    ).toBe(`/project/new?client=${encodeURIComponent("Acme Labs")}`);
  });

  it("keeps expansion local to each client and removes the global expander", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 1),
      companyRow("borealis", "Borealis Mining", 1),
    ]);
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", []);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(2);
    expect(document.querySelector("[data-toggle-all-groups]")).toBeNull();
    groupHeaders()[0].click();
    await expect.poll(() => groupHeaders()[0].getAttribute("aria-expanded")).toBe("true");
    expect(groupHeaders()[1].getAttribute("aria-expanded")).toBe("false");
  });

  it("caps simultaneously expanded sections at 6 live subscriptions through local toggles", async () => {
    __setPaginatedRows(
      "dashboard:listCompanies",
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((key) =>
        companyRow(key, `Client ${key.toUpperCase()}`, 1)
      )
    );
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", []);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(8);
    expect(document.querySelector("[data-toggle-all-groups]")).toBeNull();
    expect(document.querySelector("[data-expand-cap-note]")).toBeNull();
    for (const header of groupHeaders().slice(0, 6)) header.click();
    await expect.poll(
      () => groupHeaders().filter((b) => b.getAttribute("aria-expanded") === "true").length
    ).toBe(6);
    expect(__activeQueryCount("dashboard:listCompanyProjectsByStageRank")).toBeLessThanOrEqual(6);

    // Opening a 7th section evicts the least-recently-opened one: the total
    // of live per-section subscriptions never exceeds the cap.
    groupHeaders()[7].click();
    await expect.poll(() => groupHeaders()[7].getAttribute("aria-expanded")).toBe("true");
    expect(
      groupHeaders().filter((b) => b.getAttribute("aria-expanded") === "true")
    ).toHaveLength(6);
    expect(__activeQueryCount("dashboard:listCompanyProjectsByStageRank")).toBeLessThanOrEqual(6);
  });

  it("renders ALL loaded projects in the lane — the 3-card preview and the Focus remainder link are retired", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 5, { drafting: 5 }),
    ]);
    __setPaginatedRows(
      "dashboard:listCompanyProjectsByStageRank",
      [1, 2, 3, 4, 5].map((n) => projectRow(`p${n}`, `Drafting claim ${n}`, n * 100, "drafting"))
    );
    render(ProjectsClientGroups, { presentation: "lanes" });

    await expect.poll(
      () =>
        document.querySelectorAll('[data-client-group-presentation="lane"] article').length
    ).toBe(5);
    // Never a navigation out of the lane: no Focus remainder link. The
    // in-place "+N more" control appears only while the server page is
    // bounded (this stubbed page is exhausted).
    expect(document.querySelector("[data-lane-more]")).toBeNull();
    expect(document.querySelector("[data-client-focus]")).toBeNull();
    expect(document.querySelector("[data-lane-load-more]")).toBeNull();
  });

  it("presents the blank-name section as 'No client recorded' without a row action", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("￿", "—", 2)]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    expect(groupHeaders()[0].textContent).toContain("No client recorded");
    expect(groupHeaders()[0].textContent).not.toContain("—");
    expect(document.querySelector("[data-client-new-project]")).toBeNull();
  });

  it("keeps the unified client disclosure reachable at 390px with a 44px target", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("acme", "Acme Labs", 1)]);
    await browserPage.viewport(390, 844);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    const chevron = document.querySelector<HTMLButtonElement>("[data-client-group-chevron]");
    expect(chevron).not.toBeNull();
    const chevronBox = chevron!.getBoundingClientRect();
    expect(chevronBox.height).toBeGreaterThanOrEqual(44);
    expect(chevronBox.width).toBeGreaterThan(200);
    expect(chevron!.getAttribute("aria-label")).toBe("Expand Acme Labs");
    await browserPage.viewport(1280, 800);
  });

  it("removes the loaded-count footer from the client repository", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 1),
      companyRow("borealis", "Borealis Mining", 1),
    ]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(2);
    expect(document.querySelector("[data-client-pagination-note]")).toBeNull();
  });

  it("shows the bounded empty state with the backfill notice when no groups are loaded", async () => {
    __setPaginatedRows("dashboard:listCompanies", []);
    render(ProjectsClientGroups, {});

    await expect.poll(() => region()).not.toBeNull();
    expect(region()?.textContent).toContain("No client name groups to show");
    expect(region()?.textContent).toContain(
      "Projects created before grouping was enabled may not appear here."
    );
  });
});
