import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsPage from "./ProjectsPage.svelte";
import { page as appPage, __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __activeQueryArgs,
  __isQueryActive,
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * The Projects page (2026-10-14 amendment; Paper W1, V1, V4, W5, W6): the
 * client list with its URL selection, New client and merge, and the client
 * area with fiscal year groups, search, the card menu and select mode.
 */
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const DASHES = /[\u2010-\u2015\u00b7]/;

const CLIENTS = [
  { key: "acuity insights", clientId: "c1", name: "Acuity Insights", projectCount: 4 },
  { key: "acuity insights inc", clientId: null, name: "Acuity Insights Inc", projectCount: 2 },
  { key: "cedarline systems", clientId: "c3", name: "Cedarline Systems", projectCount: 6 },
  { key: "societe generale", clientId: "c4", name: "Société Générale", projectCount: 1 },
];

function project(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: day("2026-01-01"),
    title: `Project ${id}`,
    clientName: "Cedarline Systems",
    workflowStage: "drafting",
    status: "draft",
    ownerId: "u-1",
    ownerLabel: "Jordan Ellis",
    createdBy: "u-1",
    generationActivity: null,
    createdAt: day("2026-01-01"),
    updatedAt: day("2026-09-16"),
    dashboardCompanyKey: "cedarline systems",
    ...overrides,
  };
}

const CEDARLINE = [
  project("p4", { title: "Adaptive cold storage controls", projectNumber: "4", fiscalYearEnd: day("2026-09-30") }),
  project("p5", { title: "High-efficiency pump control", projectNumber: "5", fiscalYearEnd: day("2026-09-30") }),
  project("p6", { title: "Defrost cycle prediction", projectNumber: "6", fiscalYearEnd: day("2026-09-30") }),
  project("p1", { title: "Evaporator coil frost sensing", projectNumber: "1", fiscalYearEnd: day("2025-09-30") }),
  project("p2", { title: "Refrigerant leak detection", projectNumber: "2", fiscalYearEnd: day("2025-03-31") }),
  project("pa", { title: "Compressor vibration damping", projectNumber: "A" }),
];

function seed(role = "manager") {
  __setQueryData("users:getCurrentUser", { _id: "u-1", role });
  __setQueryData("clients:listClients", { clients: CLIENTS, truncated: false });
  __setQueryData("projects:listIndustries", []);
  __setQueryData("clients:findSimilarClients", { exact: null, similar: [] });
}

async function mount(url = "/projects", props: Record<string, unknown> = {}, width = 1440) {
  __setPageUrl(url);
  await page.viewport(width, 900);
  const screen = await render(ProjectsPage, { totalLabel: "13", ...props });
  screen.container.style.cssText = "display:flex;height:900px;";
  return screen;
}

const row = (key: string) => document.querySelector<HTMLAnchorElement>(`[data-client-row="${key}"]`);
const title = () => document.querySelector<HTMLElement>("[data-client-title]");
const fyHeaders = () => [...document.querySelectorAll("[data-fy-header]")].map((node) => text(node));
const selectionCount = () => text(document.querySelector("[data-selection-count]"));

beforeEach(() => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  seed();
});

describe("Projects page client list", () => {
  it("lists All clients with the total and one row per client with its count", async () => {
    await mount();
    await expect.poll(() => row("cedarline systems")).not.toBeNull();
    expect(text(row("all"))).toBe("All clients 13");
    expect(text(row("cedarline systems"))).toBe("Cedarline Systems 6");
    expect(row("all")?.getAttribute("aria-current")).toBe("page");
    expect(row("cedarline systems")?.getAttribute("href")).toBe("/projects?client=cedarline+systems");
    expect(document.querySelector('nav[aria-label="Clients"]')).not.toBeNull();
  });

  it("filters the loaded list ignoring case and accents", async () => {
    await mount();
    await userEvent.fill(page.getByRole("searchbox", { name: "Find a client" }), "SOCIETE");
    await expect.poll(() => row("acuity insights")).toBeNull();
    expect(text(row("societe generale"))).toBe("Société Générale 1");
    await userEvent.fill(page.getByRole("searchbox", { name: "Find a client" }), "zzz");
    await expect.poll(() => text(document.querySelector("[data-client-list] [role='status']"))).toBe(
      'No client matches "zzz".'
    );
  });

  it("selects a client through the URL with a soft navigation, and back to All clients", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", CEDARLINE);
    await mount();
    await userEvent.click(row("cedarline systems")!);
    await expect.poll(() => appPage.url.searchParams.get("client")).toBe("cedarline systems");
    expect(__navigationCalls.at(-1)).toEqual({ kind: "goto", url: "/projects?client=cedarline+systems" });
    await expect.poll(() => text(title())).toBe("Cedarline Systems");
    expect(row("cedarline systems")?.getAttribute("aria-current")).toBe("page");
    expect(row("all")?.getAttribute("aria-current")).toBeNull();
    expect(__activeQueryArgs("dashboard:listCompanyProjects")).toEqual([
      { companyKey: "cedarline systems" },
    ]);

    await userEvent.click(row("all")!);
    await expect.poll(() => text(title())).toBe("All clients");
    expect(appPage.url.search).toBe("");
  });

  it("notes a cut list quietly at the end", async () => {
    __setQueryData("clients:listClients", { clients: CLIENTS, truncated: true });
    await mount();
    await expect.poll(() => document.querySelector("[data-clients-truncated]")).not.toBeNull();
  });

  it("offers New client to project creators, opens the dialog and selects the created client", async () => {
    seed("writer");
    __setMutationResult("clients:createClient", { clientId: "c9", key: "northlake robotics", name: "Northlake Robotics" });
    await mount();
    await expect.poll(() => document.querySelector("[data-new-client]")).not.toBeNull();
    // Consultants may create clients but not merge them.
    expect(document.querySelector("[data-start-merge]")).toBeNull();

    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client]")!);
    await expect.element(page.getByRole("dialog", { name: "New client" })).toBeVisible();
    await userEvent.fill(document.querySelector<HTMLInputElement>("#new-client-name")!, "Northlake Robotics");
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-create-client]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-create-client]")!);

    await expect.poll(() => __mutationCalls("clients:createClient")).toEqual([{ name: "Northlake Robotics" }]);
    await expect.poll(() => appPage.url.searchParams.get("client")).toBe("northlake robotics");
    // Not in the list yet: the title uses the created name, not the key.
    await expect.poll(() => text(title())).toBe("Northlake Robotics");
  });

  it("shows no New client or merge actions to a viewer who may do neither", async () => {
    __setQueryData("users:getCurrentUser", { _id: "u-1", role: "financial" });
    await mount();
    await expect.poll(() => row("cedarline systems")).not.toBeNull();
    expect(document.querySelector("[data-new-client]")).toBeNull();
    expect(document.querySelector("[data-start-merge]")).toBeNull();
  });
});

describe("Merging clients", () => {
  const PREVIEW = {
    projectCount: 6,
    movedCount: 2,
    tooMany: false,
    keptName: "Acuity Insights",
    keptKey: "acuity insights",
    nameConflict: null,
    numberCollisions: [],
  };

  async function openMerge() {
    __setQueryData("clients:previewClientMerge", PREVIEW);
    await mount();
    await expect.poll(() => document.querySelector("[data-start-merge]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-start-merge]")!);
    const merge = () => document.querySelector<HTMLButtonElement>("[data-merge-open]")!;
    expect(text(document.querySelector("[data-merge-header]"))).toBe("Select clients to merge Done");
    expect(merge().disabled).toBe(true);
    await userEvent.click(page.getByRole("checkbox", { name: /Acuity Insights Inc/ }));
    expect(text(document.querySelector("[data-merge-bar]"))).toBe("1 selected Merge");
    expect(merge().disabled).toBe(true);
    await userEvent.click(page.getByRole("checkbox", { name: /^Acuity Insights 4$/ }));
    expect(text(document.querySelector("[data-merge-bar]"))).toBe("2 selected Merge");
    expect(merge().disabled).toBe(false);
    await userEvent.click(merge());
    await expect.element(page.getByRole("dialog", { name: "Merge 2 clients" })).toBeVisible();
  }

  const dialogText = () => text(document.querySelector('[data-testid="merge-clients-dialog"]'));
  const confirm = () => document.querySelector<HTMLButtonElement>("[data-confirm-merge]")!;

  it("keeps the client with the most projects by default and states the outcome", async () => {
    await openMerge();
    expect(dialogText()).toContain("Pick the name to keep. All 6 projects move to it.");
    expect(document.querySelector('[data-merge-keep="acuity insights"]')?.getAttribute("aria-checked")).toBe("true");
    // Focus lands on the kept name, not the close button.
    await expect.poll(() => document.activeElement?.getAttribute("data-merge-keep")).toBe("acuity insights");
    await expect.poll(() => text(document.querySelector("[data-merge-summary]"))).toBe(
      "6 projects will show under Acuity Insights. Their fiscal years stay as they are. The other name is removed from the client list."
    );
    expect(__activeQueryArgs("clients:previewClientMerge")).toEqual([
      { keepKey: "acuity insights", mergeKeys: ["acuity insights inc"] },
    ]);
    expect(confirm().disabled).toBe(false);
    expect(dialogText()).not.toMatch(DASHES);
  });

  it("switches the kept name with the radio choice", async () => {
    await openMerge();
    await userEvent.click(document.querySelector<HTMLElement>('[data-merge-keep="acuity insights inc"]')!);
    await expect.poll(() => __activeQueryArgs("clients:previewClientMerge")).toEqual([
      { keepKey: "acuity insights inc", mergeKeys: ["acuity insights"] },
    ]);
  });

  it("lists project numbers that now appear twice", async () => {
    __setQueryData("clients:previewClientMerge", {
      ...PREVIEW,
      numberCollisions: [{ fiscalYear: 2025, projectNumber: "1", titles: ["Coil sensing", "Leak detection"] }],
    });
    await openMerge();
    __setQueryData("clients:previewClientMerge", {
      ...PREVIEW,
      numberCollisions: [{ fiscalYear: 2025, projectNumber: "1", titles: ["Coil sensing", "Leak detection"] }],
    });
    await expect.poll(() => text(document.querySelector("[data-merge-collisions]"))).toBe(
      "Project number 1 appears twice in FY 2025: Coil sensing, Leak detection. Change one after the merge."
    );
    expect(confirm().disabled).toBe(false);
  });

  it("uses a different name, and refuses one that another client has", async () => {
    await openMerge();
    await userEvent.click(document.querySelector<HTMLElement>("[data-merge-other-name]")!);
    expect(document.querySelector('[data-merge-keep="other"]')?.getAttribute("aria-checked")).toBe("true");
    __setQueryData("clients:previewClientMerge", { ...PREVIEW, keptName: "Cedarline Systems", nameConflict: "Cedarline Systems" });
    await userEvent.fill(document.querySelector<HTMLInputElement>("[data-merge-other-name]")!, "Cedarline Systems");
    await expect.poll(() => __activeQueryArgs("clients:previewClientMerge")).toEqual([
      { keepKey: "acuity insights", mergeKeys: ["acuity insights inc"], name: "Cedarline Systems" },
    ]);
    await expect.poll(() => text(document.querySelector('[data-merge-error="name"]'))).toBe(
      "Cedarline Systems is already a client. Select it in the client list to merge into it, or type another name."
    );
    expect(confirm().disabled).toBe(true);
  });

  it("refuses a merge over 200 projects", async () => {
    __setQueryData("clients:previewClientMerge", { ...PREVIEW, tooMany: true });
    await openMerge();
    __setQueryData("clients:previewClientMerge", { ...PREVIEW, tooMany: true });
    await expect.poll(() => document.querySelector('[data-merge-error="too-many"]')).not.toBeNull();
    expect(confirm().disabled).toBe(true);
  });

  it("merges, leaves select mode and opens the kept client", async () => {
    __setMutationResult("clients:mergeClients", {
      moved: 2,
      keptKey: "acuity insights renamed",
      keptName: "Acuity Insights Renamed",
      clientId: "c1",
    });
    await openMerge();
    await userEvent.click(document.querySelector<HTMLElement>("[data-merge-other-name]")!);
    __setQueryData("clients:previewClientMerge", { ...PREVIEW, keptName: "Acuity Insights Renamed", keptKey: "acuity insights renamed" });
    await userEvent.fill(document.querySelector<HTMLInputElement>("[data-merge-other-name]")!, "Acuity Insights Renamed");
    await expect.poll(() => confirm().disabled).toBe(false);
    await userEvent.click(confirm());
    await expect.poll(() => __mutationCalls("clients:mergeClients")).toEqual([
      { keepKey: "acuity insights", mergeKeys: ["acuity insights inc"], name: "Acuity Insights Renamed" },
    ]);
    await expect.poll(() => appPage.url.searchParams.get("client")).toBe("acuity insights renamed");
    expect(document.querySelector("[data-merge-bar]")).toBeNull();
    await expect.poll(() => text(title())).toBe("Acuity Insights Renamed");
  });
});

describe("Projects page client area", () => {
  it("titles the client with no subtext and groups by fiscal year, short year tagged, no fiscal year last", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", CEDARLINE);
    await mount("/projects?client=cedarline+systems");
    await expect.poll(() => fyHeaders().length).toBe(4);
    expect(text(title())).toBe("Cedarline Systems");
    expect(getComputedStyle(title()!).fontFamily).toContain("Georgia");
    // The header holds the title and its controls, nothing under the title.
    const header = document.querySelector("[data-client-header]")!;
    expect(header.querySelectorAll("p")).toHaveLength(0);
    expect(fyHeaders()).toEqual([
      "FY 2026 ended Sep 30, 2026 3 projects",
      "FY 2025 ended Sep 30, 2025 Short year, 6 months 1 project",
      "FY 2025 ended Mar 31, 2025 1 project",
      "No fiscal year 1 project",
    ]);
    const firstGroup = document.querySelector('[data-fy-group="fy-2026-2026-09-30"]')!;
    expect(
      [...firstGroup.querySelectorAll("[data-project-board-card] a")].map((link) => text(link))
    ).toEqual(["Adaptive cold storage controls", "High-efficiency pump control", "Defrost cycle prediction"]);
    // Client-scoped cards leave the client line to the title.
    expect(firstGroup.querySelector('[data-card-field="client"]')).toBeNull();
    expect(text(document.querySelector('[data-projects-page]'))).not.toMatch(DASHES);
  });

  it("searches inside the client and clears back to the groups", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", CEDARLINE);
    __setPaginatedRows("dashboard:searchProjects", CEDARLINE.slice(0, 2));
    await mount("/projects?client=cedarline+systems");
    const search = page.getByRole("searchbox", { name: "Search Cedarline Systems" });
    await expect.element(search).toBeVisible();
    await userEvent.fill(search, "pump");
    await expect.poll(() => __activeQueryArgs("dashboard:searchProjects")).toEqual([
      { search: "pump", companyKey: "cedarline systems" },
    ]);
    expect(__isQueryActive("dashboard:listCompanyProjects")).toBe(false);
    await expect.poll(() => text(document.querySelector("#projects-search-results"))).toBe("2 projects match");
    expect(document.querySelectorAll("[data-search-results] [data-project-board-card]")).toHaveLength(2);
    await userEvent.click(document.querySelector<HTMLElement>("[data-search-clear]")!);
    await expect.poll(() => fyHeaders().length).toBe(4);
  });

  it("puts a card menu on each card, reachable from the keyboard, with Open, Edit details, Duplicate and Delete", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", CEDARLINE);
    const onEditDetails = vi.fn();
    await mount("/projects?client=cedarline+systems", { onEditDetails });
    await expect.poll(() => document.querySelector('[data-card-menu="p5"]')).not.toBeNull();
    const trigger = document.querySelector<HTMLButtonElement>('[data-card-menu="p5"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("More actions for High-efficiency pump control");
    // Hidden until hover or focus, never removed from the tab order.
    expect(getComputedStyle(trigger).opacity).toBe("0");
    const link = page.getByRole("link", { name: "High-efficiency pump control" });
    (link.element() as HTMLElement).focus();
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(trigger);
    await expect.poll(() => getComputedStyle(trigger).opacity).toBe("1");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.querySelector('[data-card-menu-content="p5"]')).not.toBeNull();
    const items = [...document.querySelectorAll("[data-card-menu-item]")].map((item) => text(item));
    expect(items).toEqual(["Open", "Edit details", "Duplicate", "Delete"]);
    expect(document.querySelector('[data-card-menu-item="open"]')?.getAttribute("href")).toBe("/project/p5");
    await userEvent.click(document.querySelector<HTMLElement>('[data-card-menu-item="edit"]')!);
    expect(onEditDetails).toHaveBeenCalledWith("p5");
  });

  it("opens the delete confirmation from the menu, and hides Delete from someone who may not", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", [
      ...CEDARLINE.slice(0, 1),
      project("other", { title: "Someone else's project", createdBy: "u-2", fiscalYearEnd: day("2026-09-30") }),
    ]);
    await mount("/projects?client=cedarline+systems");
    await expect.poll(() => document.querySelector('[data-card-menu="other"]')).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>('[data-card-menu="other"]')!);
    await expect.poll(() => document.querySelector('[data-card-menu-item="edit"]')).not.toBeNull();
    expect(document.querySelector('[data-card-menu-item="delete"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector('[data-card-menu-content="other"]')).toBeNull();

    await userEvent.click(document.querySelector<HTMLElement>('[data-card-menu="p4"]')!);
    await userEvent.click(document.querySelector<HTMLElement>('[data-card-menu-item="delete"]')!);
    await expect.element(page.getByRole("dialog", { name: "Delete Adaptive cold storage controls?" })).toBeVisible();
  });

  it("selects cards with a bottom bar, opens bulk edit, and leaves on Escape", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", CEDARLINE);
    const onBulkEdit = vi.fn();
    await mount("/projects?client=cedarline+systems", { onBulkEdit });
    await expect.poll(() => document.querySelector("[data-select-start]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-select-start]")!);
    expect(selectionCount()).toBe("0 selected");
    expect(document.querySelector<HTMLButtonElement>("[data-selection-edit]")?.disabled).toBe(true);
    // The search gives way to Select all and Done, as V4 draws it.
    expect(document.querySelector("[data-client-search]")).toBeNull();

    await userEvent.click(page.getByRole("checkbox", { name: "High-efficiency pump control" }));
    await userEvent.click(page.getByRole("checkbox", { name: "Compressor vibration damping" }));
    expect(selectionCount()).toBe("2 selected");
    expect(document.querySelector('[data-card-select="p5"]')?.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(document.querySelector<HTMLElement>("[data-selection-edit]")!);
    expect(onBulkEdit).toHaveBeenCalledTimes(1);
    expect(onBulkEdit.mock.calls[0][0].map((r: { _id: string }) => r._id)).toEqual(["p5", "pa"]);

    await userEvent.click(document.querySelector<HTMLElement>("[data-selection-clear]")!);
    expect(selectionCount()).toBe("0 selected");
    await userEvent.click(page.getByText("Select all 6"));
    expect(selectionCount()).toBe("6 selected");

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-selection-bar]")).toBeNull();
    expect(document.querySelector("[data-client-search]")).not.toBeNull();
  });

  it("opens the bulk edit side panel by default", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", CEDARLINE);
    await mount("/projects?client=cedarline+systems");
    await expect.poll(() => document.querySelector("[data-select-start]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-select-start]")!);
    await userEvent.click(page.getByRole("checkbox", { name: "Defrost cycle prediction" }));
    await userEvent.click(document.querySelector<HTMLElement>("[data-selection-edit]")!);
    await expect.element(page.getByRole("dialog", { name: "Edit 1 project" })).toBeVisible();
    // The side panel (Paper W3), not the old centered BulkEditDialog.
    expect(document.querySelector('[data-testid="bulk-edit-panel"]')?.getAttribute("data-projects-panel")).toBe("side");
  });

  it("says when a client has no projects, with New project for that client", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", []);
    await mount("/projects?client=societe+generale");
    await expect.poll(() => text(document.querySelector("[data-client-empty] p"))).toBe(
      "Société Générale has no projects yet."
    );
    expect(document.querySelector("[data-client-new-project]")?.getAttribute("href")).toBe(
      "/project/new?client=Soci%C3%A9t%C3%A9+G%C3%A9n%C3%A9rale"
    );
  });

  it("keeps the card geometry while loading and offers Try again on an error", async () => {
    await mount("/projects?client=cedarline+systems");
    await expect.element(page.getByRole("status", { name: "Loading projects" })).toBeVisible();
    expect(document.querySelectorAll("[data-projects-loading] .h-40")).toHaveLength(6);

    __setQueryError("dashboard:listCompanyProjects", new Error("boom"));
    await expect.poll(() => text(document.querySelector("[data-projects-error]"))).toBe(
      "Projects could not be loaded. Try again"
    );
  });
});

describe("All clients view", () => {
  it("shows recently edited projects across clients, each card naming its client", async () => {
    __setPaginatedRows("dashboard:listFlatProjects", [
      project("x1", { title: "Pump control", clientName: "Cedarline Systems", fiscalYearEnd: day("2026-09-30") }),
      project("x2", { title: "Coil sensing", clientName: "Acuity Insights" }),
    ]);
    await mount();
    await expect.poll(() => text(title())).toBe("All clients");
    expect(__activeQueryArgs("dashboard:listFlatProjects")).toEqual([{ sortBy: "updated" }]);
    expect(text(document.querySelector("#projects-recent"))).toBe("Recently edited");
    const clientsShown = [...document.querySelectorAll('[data-recent-projects] [data-card-field="client"]')].map((n) =>
      text(n)
    );
    expect(clientsShown).toEqual(["Client Cedarline Systems", "Client Acuity Insights"]);
    await expect.element(page.getByRole("searchbox", { name: "Search all projects" })).toBeVisible();
  });

  it("searches every client without a client key", async () => {
    __setPaginatedRows("dashboard:listFlatProjects", []);
    __setPaginatedRows("dashboard:searchProjects", []);
    await mount();
    await userEvent.fill(page.getByRole("searchbox", { name: "Search all projects" }), "coil");
    await expect.poll(() => __activeQueryArgs("dashboard:searchProjects")).toEqual([{ search: "coil" }]);
    await expect.poll(() => text(document.querySelector("#projects-search-results"))).toBe('No projects match "coil".');
  });

  it("seeds the search handed over from Home", async () => {
    __setPaginatedRows("dashboard:searchProjects", []);
    await mount("/projects", { initialSearch: "pump" });
    await expect.poll(() => __activeQueryArgs("dashboard:searchProjects")).toEqual([{ search: "pump" }]);
  });
});

describe("Small screens", () => {
  it("shows the client list full width, then the client with a back link", async () => {
    __setPaginatedRows("dashboard:listCompanyProjects", CEDARLINE);
    await mount("/projects", {}, 600);
    await expect.poll(() => row("cedarline systems")).not.toBeNull();
    const area = () => document.querySelector<HTMLElement>("[data-client-area]");
    const list = document.querySelector<HTMLElement>('aside[aria-label="Clients"]')!;
    expect(Math.round(list.getBoundingClientRect().width)).toBe(600);
    expect(area()?.offsetParent).toBeNull();

    await userEvent.click(row("cedarline systems")!);
    await expect.poll(() => area()?.offsetParent).not.toBeNull();
    expect(list.offsetParent).toBeNull();
    const back = page.getByRole("button", { name: "All clients" });
    await expect.element(back).toBeVisible();
    await userEvent.click(back);
    await expect.poll(() => list.offsetParent).not.toBeNull();
    expect(appPage.url.search).toBe("");
  });
});
