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
 * contract — exact qualifier copy, the interim backfill notice, "Company"
 * appearing nowhere, exact-stageCounts-only hide-empty with the Display
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

  it("renders the exact recorded-client-name qualifier and interim backfill notice", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("acme", "Acme Labs", 2)]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => region()).not.toBeNull();
    const qualifier = document.querySelector("[data-client-grouping-qualifier]");
    expect(qualifier?.textContent).toContain(
      "Grouped by recorded client name as entered on projects. Durable client records are not yet modelled."
    );
    expect(
      document.querySelector("[data-client-grouping-backfill-notice]")?.textContent
    ).toBe("Projects created before grouping was enabled may not appear here.");
  });

  it("renders one section per recorded client name, in server (A–Z index) order, with truthful counts — and never says Company", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 2),
      companyRow("borealis", "Borealis Mining", 1),
      companyRow("cormorant", "Cormorant Foods", 12),
    ]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(3);
    const headers = groupHeaders().map((button) => button.textContent?.replace(/\s+/g, " ").trim());
    // Counts render in the mono data role (2026-08-12 taste pass): the
    // number is the visible text, the unit is screen-reader-only.
    expect(headers[0]).toBe("Client Acme Labs 2 projects");
    expect(headers[1]).toBe("Client Borealis Mining 1 project");
    expect(headers[2]).toBe("Client Cormorant Foods 12 projects");
    expect(region()?.textContent).not.toMatch(/\bcompany\b/i);
  });

  it("expands a section into pipeline-ordered status sub-headers cut from the stage-ranked server order", async () => {
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

    await expect.poll(() => document.querySelectorAll("[data-stage-subgroup]").length).toBe(4);
    const subgroups = [...document.querySelectorAll<HTMLElement>("[data-stage-subgroup]")].map(
      (el) => el.getAttribute("data-stage-subgroup")
    );
    // Pipeline presentation order re-maps the frozen rank runs: delivered
    // BEFORE on_hold; the qualified legacy sub-group last.
    expect(subgroups).toEqual(["intake", "delivered", "on_hold", "legacy"]);
    expect(__isQueryActive("dashboard:listCompanyProjectsByStageRank")).toBe(true);
    const titles = [...document.querySelectorAll("[data-client-group] ul li a")].map(
      (a) => a.textContent?.trim()
    );
    expect(titles).toEqual(["Intake claim", "Delivered claim", "Paused claim", "Legacy claim"]);
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
    await expect.poll(() => document.querySelectorAll("[data-stage-subgroup]").length).toBe(1);
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
    // All ten canonical stages render; nothing is hidden without exact truth.
    await expect.poll(() => document.querySelectorAll("[data-stage-subgroup]").length).toBe(10);
    expect(document.querySelector("[data-hidden-stages-disclosure]")).toBeNull();
  });

  it("offers client-scoped creation on each section header and never a Focus drill-in (retired 2026-08-12)", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("acme", "Acme & Co", 1)]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    const create = document.querySelector<HTMLAnchorElement>("[data-client-new-project]");
    // The wizard's own `?client=` prefill param — unrelated to the retired
    // board focus param — carries the editable recorded name.
    expect(create?.getAttribute("href")).toBe(
      `/project/new?client=${encodeURIComponent("Acme & Co")}`
    );
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
      '[data-client-group="acme"] [role="region"][aria-label="Acme Labs board. Scroll horizontally to review every workflow stage."]'
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

  it("provides a collapse/expand-all control and shows the bounded empty state", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 1),
      companyRow("borealis", "Borealis Mining", 1),
    ]);
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", []);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(2);
    const toggleAll = document.querySelector<HTMLButtonElement>("[data-toggle-all-groups]");
    expect(toggleAll?.textContent).toContain("Expand all");
    toggleAll?.click();
    await expect.poll(() => groupHeaders().every((b) => b.getAttribute("aria-expanded") === "true")).toBe(true);
    await expect.poll(() =>
      document.querySelector<HTMLButtonElement>("[data-toggle-all-groups]")?.textContent
    ).toContain("Collapse all");
  });

  it("caps simultaneously expanded sections at 6 live subscriptions — expand-all, toggles, and load-more included", async () => {
    __setPaginatedRows(
      "dashboard:listCompanies",
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((key) =>
        companyRow(key, `Client ${key.toUpperCase()}`, 1)
      )
    );
    __setPaginatedRows("dashboard:listCompanyProjectsByStageRank", []);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(8);
    const toggleAll = document.querySelector<HTMLButtonElement>("[data-toggle-all-groups]");
    // Honest label: never promises an unbounded "Expand all".
    expect(toggleAll?.textContent).toContain("Expand first 6");
    expect(document.querySelector("[data-expand-cap-note]")?.textContent).toContain(
      "Up to 6 sections stay open at once"
    );
    toggleAll?.click();
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

  it("presents the blank-name section as 'No client recorded' and never prefills the em dash", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("￿", "—", 2)]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    expect(groupHeaders()[0].textContent).toContain("No client recorded");
    expect(groupHeaders()[0].textContent).not.toContain("—");
    const create = document.querySelector<HTMLAnchorElement>("[data-client-new-project]");
    // No recorded name exists, so the creation link carries no prefill.
    expect(create?.getAttribute("href")).toBe("/project/new");
  });

  it("keeps the client-scoped creation link reachable at 390px with a 44px target", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("acme", "Acme Labs", 1)]);
    await browserPage.viewport(390, 844);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(1);
    const create = document.querySelector<HTMLAnchorElement>("[data-client-new-project]");
    expect(create).not.toBeNull();
    const box = create!.getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(create!.getAttribute("href")).toBe(
      `/project/new?client=${encodeURIComponent("Acme Labs")}`
    );
    expect(create!.getAttribute("aria-label")).toBe("New project — Acme Labs");
    await browserPage.viewport(1280, 800);
  });

  it("renders a truthful client pagination footer with the loaded count", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 1),
      companyRow("borealis", "Borealis Mining", 1),
    ]);
    render(ProjectsClientGroups, {});

    await expect.poll(() => groupHeaders().length).toBe(2);
    expect(
      document.querySelector("[data-client-pagination-note]")?.textContent?.trim()
    ).toBe("Showing 2 client names");
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
