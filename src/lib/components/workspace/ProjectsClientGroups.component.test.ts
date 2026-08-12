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
 * Client → Status container (2026-08-06 second amendment): truthful,
 * server-backed sections keyed by recorded client name; inside a section,
 * pipeline-ordered status sub-headers cut from the stage-ranked server
 * order. Pins the honesty contract — exact qualifier copy, the interim
 * backfill notice, "Company" appearing nowhere, exact-stageCounts-only
 * hide-empty with a visible disclosure, lazy per-section subscriptions, and
 * lane presentation for the grouped board.
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
    expect(headers[0]).toBe("Client Acme Labs · 2 projects");
    expect(headers[1]).toBe("Client Borealis Mining · 1 project");
    expect(headers[2]).toBe("Client Cormorant Foods · 12 projects");
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

  it("hides empty statuses only from exact stageCounts, with a visible per-section disclosure", async () => {
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
    const disclosure = document.querySelector<HTMLButtonElement>("[data-hidden-stages-disclosure]");
    expect(disclosure?.textContent).toContain("9 empty stages hidden · Show");
    disclosure?.click();
    await expect.poll(() => document.querySelectorAll("[data-stage-subgroup]").length).toBe(10);
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

  it("offers client-scoped creation and focus links on each section header", async () => {
    __setPaginatedRows("dashboard:listCompanies", [companyRow("acme", "Acme & Co", 1)]);
    render(ProjectsClientGroups, {
      focusHref: (companyKey: string) => `/projects?layout=board&group=client&client=${encodeURIComponent(companyKey)}`,
    });

    await expect.poll(() => groupHeaders().length).toBe(1);
    const create = document.querySelector<HTMLAnchorElement>("[data-client-new-project]");
    expect(create?.getAttribute("href")).toBe(
      `/project/new?client=${encodeURIComponent("Acme & Co")}`
    );
    const focus = document.querySelector<HTMLAnchorElement>("[data-client-focus]");
    expect(focus?.getAttribute("href")).toBe("/projects?layout=board&group=client&client=acme");
  });

  it("lane presentation renders stacked client mini-boards with auto-expanded lanes and natural-height columns", async () => {
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
    // Lane columns: same-tone, no inner vertical scroll (natural height).
    const laneColumn = document.querySelector<HTMLElement>(
      '[data-client-group-presentation="lane"] section[aria-labelledby*="-lane-"]'
    );
    expect(laneColumn).not.toBeNull();
    expect(laneColumn?.className).not.toContain("overflow-y-auto");
    expect(laneColumn?.className).toContain("bg-canvas");
    // Lane body carries the intake creation footer only via visible groups;
    // the drafting lane column renders the card.
    expect(
      document.querySelector('[data-client-group-presentation="lane"] article a')?.textContent
    ).toContain("Drafting claim");
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

  it("bounds each lane stage column to a 3-card preview with a truthful remainder link into Focus", async () => {
    __setPaginatedRows("dashboard:listCompanies", [
      companyRow("acme", "Acme Labs", 5, { drafting: 5 }),
    ]);
    __setPaginatedRows(
      "dashboard:listCompanyProjectsByStageRank",
      [1, 2, 3, 4, 5].map((n) => projectRow(`p${n}`, `Drafting claim ${n}`, n * 100, "drafting"))
    );
    render(ProjectsClientGroups, {
      presentation: "lanes",
      focusHref: (companyKey: string) => `/projects?layout=board&group=client&client=${companyKey}`,
    });

    await expect.poll(
      () =>
        document.querySelectorAll('[data-client-group-presentation="lane"] article').length
    ).toBe(3);
    // 320px governed column width (2026-08-10 owner direction, was 360px).
    const laneColumn = document.querySelector<HTMLElement>(
      '[data-client-group-presentation="lane"] section[aria-labelledby*="-lane-"]'
    );
    expect(laneColumn?.className).toContain("w-[320px]");
    expect(laneColumn?.className).not.toContain("overflow-y-auto");
    // Truthful remainder: exact count minus the preview, linking to Focus.
    const more = document.querySelector<HTMLAnchorElement>('[data-lane-more="drafting"]');
    expect(more?.textContent?.trim()).toBe("Show 2 more in Focus");
    expect(more?.getAttribute("href")).toBe("/projects?layout=board&group=client&client=acme");
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
