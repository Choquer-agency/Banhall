import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import HomeView from "./HomeView.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __activeQueryArgs,
  __isQueryActive,
  __resetConvexStub,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import type { RecentProject } from "$lib/workspace/recentProjects";

/**
 * Home (ui-design-final.md section 9, boards 1.1 and 1.2): the "With you"
 * and "Recently opened" tables, stage chips, empty states and the
 * "Continue working" column, all from real queries.
 */
const MINUTE = 60_000;

function assigned(id: string, overrides: Record<string, unknown> = {}) {
  return {
    workItemId: `w-${id}`,
    version: 1,
    updatedAt: 100,
    projectUpdatedAt: Date.now() - 60 * MINUTE,
    projectId: `proj-${id}`,
    projectTitle: `Project ${id}`,
    clientName: "Meridian Materials",
    workflowStage: "internal_review",
    stageIsFallback: false,
    kind: "internal_review",
    blocking: true,
    isCurrentHandoff: true,
    dueAt: Date.now() + 86_400_000,
    assignee: { userId: "u-1", label: "Jordan Ellis", initials: "JE" },
    assigner: { userId: "u-2", label: "Sam Chen", initials: "SC" },
    viewerCanComplete: true,
    viewerCanCompleteOthers: false,
    viewerCanManage: false,
    ...overrides,
  };
}

function live(id: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId: `proj-${id}`,
    projectTitle: `Project ${id}`,
    clientName: "Cedarline Systems",
    workflowStage: "client_review",
    stageIsFallback: false,
    updatedAt: Date.now() - 2 * 86_400_000,
    ...overrides,
  };
}

function summary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId: `proj-${id}`,
    projectTitle: `Project ${id}`,
    clientName: "Cedarline Systems",
    fiscalYearEnd: new Date(2026, 5, 30).getTime(),
    projectNumber: "01A",
    workflowStage: "drafting",
    stageIsFallback: false,
    updatedAt: Date.now() - 12 * MINUTE,
    pendingProposals: 3,
    pendingProposalsTruncated: false,
    ...overrides,
  };
}

function seed() {
  __setQueryData("users:getCurrentUser", { _id: "u-1", firstName: "Jordan", lastName: "Ellis" });
  __setQueryData("changelog:unseenCount", 0);
}

async function mount(recentProjects: RecentProject[] = []) {
  await browserPage.viewport(1440, 900);
  return await render(HomeView, {
    recentProjects,
    onToggleRail: () => {},
    onOpenNavigation: () => {},
  });
}

const table = (id: string) => document.querySelector<HTMLElement>(`[data-home-table="${id}"]`)!;
const rowTitles = (id: string) =>
  [...table(id).querySelectorAll<HTMLAnchorElement>("tbody a")].map((link) => link.textContent?.trim());

describe("Home", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setPageUrl("/my-work");
    document.body.innerHTML = "";
  });

  it("shows the top bar with Home, the greeting, the bell and New project", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", []);
    __setPaginatedRows("dashboard:listFlatProjects", []);
    await mount();

    const bar = document.querySelector<HTMLElement>("[data-home-top-bar]")!;
    expect(bar.querySelector("h1")?.textContent).toBe("Home");
    await expect
      .poll(() => bar.querySelector("[data-home-greeting]")?.textContent)
      .toMatch(/^Good (morning|afternoon|evening), Jordan$/);
    expect(bar.querySelector('a[href="/changelog"][data-top-bar-bell]')).not.toBeNull();
    const newProject = bar.querySelector<HTMLAnchorElement>("[data-home-new-project]")!;
    expect(newProject.getAttribute("href")).toBe("/project/new");
    expect(newProject.textContent?.trim()).toBe("New project");
    // Home stays simple: no search field on the dashboard.
    expect(document.querySelector('input[type="search"], [role="searchbox"]')).toBeNull();
  });

  it("lists work with you once per project with client, stage and last edited", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", [
      assigned("a"),
      assigned("b", { projectTitle: "Adaptive cold storage controls", clientName: "Cedarline Systems", workflowStage: "drafting", projectUpdatedAt: Date.now() - 12 * MINUTE }),
      assigned("a", { workItemId: "w-a2", kind: "revision" }),
    ]);
    __setPaginatedRows("dashboard:listFlatProjects", []);
    await mount();

    await expect.poll(() => rowTitles("home-with-you")).toEqual(["Project a", "Adaptive cold storage controls"]);
    const withYou = table("home-with-you");
    expect([...withYou.querySelectorAll("th")].map((cell) => cell.textContent?.trim())).toEqual([
      "Name",
      "Client",
      "Stage",
      "Last edited",
    ]);
    expect(withYou.querySelector("[data-home-table-count]")?.textContent).toBe("2");

    const second = withYou.querySelector<HTMLElement>('[data-home-row="proj-b"]')!;
    const link = second.querySelector<HTMLAnchorElement>("a")!;
    expect(link.getAttribute("href")).toBe("/project/proj-b");
    expect(link.dataset.recentTitle).toBe("Adaptive cold storage controls");
    expect(link.dataset.recentStage).toBe("drafting");
    expect(link.dataset.recentClient).toBe("Cedarline Systems");
    expect(second.querySelector("[data-home-client-mark]")?.textContent).toBe("C");
    expect(second.textContent).toContain("Cedarline Systems");
    expect(second.textContent).toContain("12 min ago");
    // The name link covers the whole row.
    const rowBox = second.getBoundingClientRect();
    const linkArea = getComputedStyle(link, "::after");
    expect(linkArea.position).toBe("absolute");
    expect(rowBox.height).toBe(44);

    // No due dates on Home, even though the work items carry one.
    expect(withYou.textContent).not.toMatch(/due|overdue/i);
  });

  it("colours each stage chip with its canonical tone", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", [
      assigned("a", { workflowStage: "internal_review" }),
      assigned("b", { workflowStage: "drafting" }),
      assigned("c", { workflowStage: "client_review" }),
      assigned("d", { workflowStage: "ready_for_delivery" }),
    ]);
    __setPaginatedRows("dashboard:listFlatProjects", []);
    await mount();

    await expect.poll(() => document.querySelectorAll("[data-home-table='home-with-you'] [data-home-stage-chip]").length).toBe(4);
    const chip = (stage: string) =>
      document.querySelector<HTMLElement>(`[data-home-table='home-with-you'] [data-home-stage-chip="${stage}"]`)!;
    expect(chip("internal_review").textContent?.trim()).toBe("Internal review");
    expect(chip("internal_review").className).toContain("bg-amber-50");
    expect(chip("drafting").className).toContain("bg-blue-50");
    expect(chip("client_review").className).toContain("bg-purple-50");
    expect(chip("ready_for_delivery").textContent?.trim()).toBe("Submitted");
    expect(getComputedStyle(chip("drafting")).fontWeight).toBe("400");
  });

  it("says plainly when nothing is with you and keeps Add new", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", []);
    __setPaginatedRows("dashboard:listFlatProjects", []);
    await mount();

    await expect
      .poll(() => table("home-with-you").querySelector("[data-home-table-empty]")?.textContent?.trim())
      .toBe("Nothing is with you right now. Projects handed to you show up here.");
    expect(table("home-with-you").querySelector("table")).toBeNull();
    expect(document.querySelector("[data-home-add-new]")?.getAttribute("href")).toBe("/project/new");
    expect(table("home-recent").querySelector("[data-home-table-empty]")?.textContent?.trim()).toBe(
      "No projects yet. Start one with New project."
    );
    expect(document.querySelector("[data-home-continue-empty]")?.textContent).toContain("Nothing to resume yet");
  });

  it("reads Recently opened live for the projects opened on this device", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", []);
    __setQueryData("myWork:listRecentProjects", [
      live("r1", { projectTitle: "Low-temperature composite bonding", workflowStage: "internal_review" }),
      live("r2", { projectTitle: "High-efficiency pump control" }),
    ]);
    __setQueryData("myWork:getContinueWorking", summary("r1"));
    await mount([
      { id: "proj-r1", title: "Old title", stage: "intake", openedAt: Date.now() - 12 * MINUTE },
      { id: "proj-r2", title: "High-efficiency pump control" },
    ]);

    await expect.poll(() => rowTitles("home-recent")).toEqual([
      "Low-temperature composite bonding",
      "High-efficiency pump control",
    ]);
    expect(__activeQueryArgs("myWork:listRecentProjects")).toEqual([{ projectIds: ["proj-r1", "proj-r2"] }]);
    expect(__isQueryActive("dashboard:listFlatProjects")).toBe(false);
    const recent = table("home-recent");
    expect(recent.querySelector("[data-home-view-chip]")?.textContent).toContain("Recently opened");
    // The live stage wins over the one recorded at click time.
    expect(recent.querySelector('[data-home-row="proj-r1"] [data-home-stage-chip]')?.textContent?.trim()).toBe(
      "Internal review"
    );
    expect(recent.textContent).toContain("2 days ago");
  });

  it("falls back to Recently edited when this device has no history", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", []);
    __setPaginatedRows("dashboard:listFlatProjects", [
      { _id: "proj-e1", title: "Edited elsewhere", clientName: "Alder Research", workflowStage: "revisions", updatedAt: Date.now() - 5 * MINUTE },
    ]);
    await mount([]);

    await expect.poll(() => rowTitles("home-recent")).toEqual(["Edited elsewhere"]);
    expect(table("home-recent").querySelector("[data-home-view-chip]")?.textContent).toContain("Recently edited");
    expect(__activeQueryArgs("dashboard:listFlatProjects")).toEqual([{ sortBy: "updated" }]);
    expect(__isQueryActive("myWork:listRecentProjects")).toBe(false);
  });

  it("offers the last opened project in Continue working", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", [assigned("a")]);
    __setQueryData("myWork:listRecentProjects", [live("r1", { projectTitle: "Adaptive cold storage controls" })]);
    __setQueryData("myWork:getContinueWorking", summary("r1", { projectTitle: "Adaptive cold storage controls" }));
    await mount([{ id: "proj-r1", title: "Adaptive cold storage controls", openedAt: Date.now() - 12 * MINUTE }]);

    await expect.poll(() => document.querySelector("[data-home-continue-card]")).not.toBeNull();
    expect(__activeQueryArgs("myWork:getContinueWorking")).toEqual([{ projectId: "proj-r1" }]);
    const card = document.querySelector<HTMLElement>("[data-home-continue-card]")!;
    expect(card.querySelector("[data-home-continue-when]")?.textContent).toBe("Opened 12 min ago");
    expect(card.textContent).toContain("Adaptive cold storage controls");
    expect(card.querySelector("[data-home-continue-meta]")?.textContent).toBe("Cedarline Systems, FY 2026, #01A");
    expect(card.querySelector("[data-home-continue-proposals]")?.textContent).toBe("3 proposals waiting to apply");
    expect(card.querySelector("[data-home-stage-chip]")?.textContent?.trim()).toBe("Drafting");
    const resume = card.querySelector<HTMLAnchorElement>("[data-home-resume]")!;
    expect(resume.getAttribute("href")).toBe("/project/proj-r1");
    expect(resume.textContent?.trim()).toBe("Resume report");
    expect(document.querySelector("#home-continue-title")?.textContent).toBe("Continue working");
  });

  it("resumes the latest edited work with you when nothing was opened here", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", [
      assigned("old", { projectUpdatedAt: Date.now() - 3 * 86_400_000 }),
      assigned("new", { projectUpdatedAt: Date.now() - 30 * MINUTE }),
    ]);
    __setPaginatedRows("dashboard:listFlatProjects", []);
    __setQueryData("myWork:getContinueWorking", summary("new", { updatedAt: Date.now() - 30 * MINUTE, pendingProposals: 0 }));
    await mount([]);

    await expect.poll(() => __activeQueryArgs("myWork:getContinueWorking")).toEqual([{ projectId: "proj-new" }]);
    await expect
      .poll(() => document.querySelector("[data-home-continue-when]")?.textContent)
      .toBe("Edited 30 min ago");
    expect(document.querySelector("[data-home-continue-proposals]")).toBeNull();
  });

  it("hides and shows a table from its view chip", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", [assigned("a")]);
    __setPaginatedRows("dashboard:listFlatProjects", []);
    await mount();

    const chip = table("home-with-you").querySelector<HTMLButtonElement>("[data-home-view-chip]")!;
    await expect.poll(() => table("home-with-you").querySelector("table")).not.toBeNull();
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    chip.click();
    await expect.poll(() => table("home-with-you").querySelector("table")).toBeNull();
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    chip.click();
    await expect.poll(() => table("home-with-you").querySelector("table")).not.toBeNull();
  });

  it("keeps Home's subscriptions to its three reads and its copy free of middle dots", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", [assigned("a")]);
    __setQueryData("myWork:listRecentProjects", [live("r1")]);
    __setQueryData("myWork:getContinueWorking", summary("r1"));
    await mount([{ id: "proj-r1", title: "Project r1", openedAt: Date.now() - MINUTE }]);

    await expect.poll(() => document.querySelector("[data-home-continue-card]")).not.toBeNull();
    expect(__isQueryActive("myWork:listAssignedToMe")).toBe(true);
    for (const released of [
      "myWork:listReviews",
      "myWork:listDueSoon",
      "myWork:listOwnedByMe",
      "myWork:listWaitingOnOthers",
      "myWork:getWaitingLaneState",
    ]) {
      expect(__isQueryActive(released)).toBe(false);
    }
    expect(document.body.textContent).not.toContain("\u00b7");
    expect(document.body.textContent).not.toMatch(/[\u2013\u2014]/);
  });

  it("stacks Continue working under the tables on a phone and hides the extra columns", async () => {
    seed();
    __setPaginatedRows("myWork:listAssignedToMe", [assigned("a")]);
    __setPaginatedRows("dashboard:listFlatProjects", []);
    await browserPage.viewport(390, 844);
    await render(HomeView, { recentProjects: [], onToggleRail: () => {}, onOpenNavigation: () => {} });

    await expect.poll(() => table("home-with-you").querySelector("table")).not.toBeNull();
    const headers = [...table("home-with-you").querySelectorAll("th")].filter(
      (cell) => getComputedStyle(cell).display !== "none"
    );
    expect(headers.map((cell) => cell.textContent?.trim())).toEqual(["Name", "Stage"]);
    const tables = document.querySelector<HTMLElement>("[data-home-tables]")!.getBoundingClientRect();
    const continueBox = document.querySelector<HTMLElement>("[data-home-continue]")!.getBoundingClientRect();
    expect(continueBox.top).toBeGreaterThanOrEqual(tables.bottom);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    expect(
      document.querySelector('[data-home-top-bar] button[aria-label="Open workspace navigation"]')
    ).not.toBeNull();
  });
});
