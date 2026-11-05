import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { toast } from "svelte-sonner";
import CompaniesPage from "./CompaniesPage.svelte";
import AllCompaniesTable from "./AllCompaniesTable.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __activeQueryArgs,
  __activeQueryCount,
  __queryArgsHistory,
  __setPaginatedRows,
  __setQueryData,
  __setQueryDataForArgs,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState, __setAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl, page as appPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation, __setGotoUpdatesPageUrl } from "$lib/test/app-navigation-stub";
import { viewAs } from "$lib/shell/viewAs.svelte";
import { reloadSectionSidebar, sectionSidebar, SECTION_SIDEBAR_KEY } from "$lib/workspace/sectionSidebar.svelte";
import { board } from "$lib/test/boardScale";

/**
 * The Companies section (owner, 2026-10-28): All companies, a company's
 * page, the Companies sidebar and Edit company. Paper S11 (the section
 * frame), Z8a (the company's content), Z9a, Z9c and Z9g.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const OCT_14 = Date.parse("2026-10-14T15:00:00Z");
const SEP_2 = Date.parse("2026-09-02T15:00:00Z");

const CLIENTS = [
  {
    key: "alder research",
    clientId: "c1",
    name: "Alder Research",
    projectCount: 3,
    fiscalYearEndMonth: 3,
    fiscalYearEndDay: 31,
    updatedAt: SEP_2,
  },
  {
    key: "cedarline systems",
    clientId: "c3",
    name: "Cedarline Systems",
    projectCount: 10,
    fiscalYearEndMonth: 9,
    fiscalYearEndDay: 30,
    industry: "manufacturing",
    updatedAt: OCT_14,
  },
  { key: "ironleaf farms", clientId: null, name: "Ironleaf Farms", projectCount: 0, updatedAt: OCT_14 },
];

const USERS = {
  consultant: { _id: "u-c", role: "writer" },
  manager: { _id: "u-m", role: "manager" },
  admin: { _id: "u-a", role: "admin" },
} as const;

function companyPage(key: string, extra: Record<string, unknown> = {}) {
  const client = CLIENTS.find((entry) => entry.key === key)!;
  return {
    kind: "company",
    key: client.key,
    clientId: client.clientId,
    clientUpdatedAt: client.clientId ? 1_000 : null,
    name: client.name,
    projectCount: client.projectCount,
    ...("fiscalYearEndMonth" in client ? { fiscalYearEndMonth: client.fiscalYearEndMonth, fiscalYearEndDay: client.fiscalYearEndDay } : {}),
    ...("industry" in client ? { industry: client.industry } : {}),
    fiscalYearEndFromProjects: false,
    industryFromProjects: false,
    hasProjectFiscalYearEnd: false,
    hasProjectIndustry: false,
    websiteRead: null,
    mergedNote: null,
    // 2026-11-04 (the company profile).
    clientSince: Date.parse("2025-01-14T15:00:00Z"),
    team: [] as { id: string; name: string; initials: string }[],
    summary: null,
    createdByName: "Jordan Ellis",
    updatedAt: OCT_14,
    formerNames: [] as { name: string; mergedAt?: number }[],
    ...extra,
  };
}

/** One row of the Overview table (`companyProjects.listCompanyProjects`). */
function tableRow(index: number, overrides: Record<string, unknown> = {}) {
  return {
    _id: `p${index}`,
    title: `Project ${index}`,
    projectNumber: String(index),
    stage: "drafting",
    fiscalYear: 2026,
    ownerId: "u-c",
    ownerName: "Priya Nair",
    updatedAt: OCT_14,
    ...overrides,
  };
}

function tableResult(rows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    rows,
    total: rows.length,
    all: rows.length,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    truncated: false,
    options: {
      stages: ["drafting", "client_review", "delivered"],
      fiscalYears: [2026, 2025],
      noFiscalYear: false,
      owners: [
        { id: "u-m", name: "Jordan Ellis" },
        { id: "u-c", name: "Priya Nair" },
      ],
    },
    ...extra,
  };
}

function project(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    _creationTime: 1,
    title: `Project ${id}`,
    clientName: "Cedarline Systems",
    workflowStage: "drafting",
    updatedAt: OCT_14,
    createdAt: OCT_14,
    createdBy: "u-c",
    fiscalYearEnd: Date.parse("2026-09-30T00:00:00Z"),
    ...overrides,
  };
}

function seed(role: keyof typeof USERS = "manager", clients: unknown[] = CLIENTS) {
  __setQueryData("users:getCurrentUser", USERS[role]);
  __setQueryData("clients:listClients", { clients, truncated: false });
  __setQueryData("projects:listIndustries", []);
  __setQueryData("clients:findSimilarClients", { exact: null, similar: [] });
  for (const client of CLIENTS) __setQueryDataForArgs("clients:getCompanyPage", { key: client.key }, companyPage(client.key));
  __setPaginatedRows("dashboard:listCompanyProjects", [project("p1"), project("p2", { title: "Defrost cycle prediction" })]);
  __setQueryData(
    "companyProjects:listCompanyProjects",
    tableResult([
      tableRow(1, { title: "Adaptive cold storage controls", stage: "internal_review" }),
      tableRow(2, { title: "Defrost cycle prediction", fiscalYear: 2025, ownerId: "u-m", ownerName: "Jordan Ellis" }),
    ])
  );
  __setQueryData("companyFiles:companyForKey", { clientId: "c3", name: "Cedarline Systems" });
  __setQueryData("companyFiles:listCompanyFiles", { files: [], truncated: false });
}

async function mount(companyKey: string | null, width = 1440) {
  __setPageUrl(companyKey === null ? "/companies" : `/companies/${encodeURIComponent(companyKey)}`);
  await page.viewport(width, 900);
  const screen = await render(CompaniesPage, { companyKey });
  screen.container.style.cssText = "display:flex;height:900px;";
  return screen;
}

const sidebar = () => document.querySelector<HTMLElement>('[data-section-sidebar="companies"]');
const barTitle = () => document.querySelector<HTMLElement>("[data-page-title]");
const barCount = () => document.querySelector<HTMLElement>("[data-page-count]");
const tableRows = () => [...document.querySelectorAll<HTMLElement>("[data-company-row]")];

beforeEach(() => {
  localStorage.clear();
  reloadSectionSidebar();
  __resetConvexStub();
  __resetAuthState();
  __resetPage();
  __resetNavigation();
  viewAs.exit();
  vi.spyOn(toast, "success").mockImplementation(() => "t");
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  viewAs.exit();
});

describe("All companies", () => {
  it("names the page with the count and lists every company A to Z: projects, fiscal year end, last update", async () => {
    seed("consultant");
    // Ironleaf Farms has no year end saved and no project with one.
    __setQueryDataForArgs("clients:listCompanyYearEnds", { keys: ["ironleaf farms"] }, []);
    await mount(null);
    await expect.poll(() => tableRows().length).toBe(3);
    expect(text(barTitle())).toBe("Companies");
    expect(text(barCount())).toBe("3 companies");
    const headers = [...document.querySelectorAll('[data-companies-table] [role="columnheader"]')].map((node) => text(node));
    expect(headers).toEqual(["Name", "Projects", "Fiscal year end", "Last update"]);
    expect(tableRows().map((row) => text(row))).toEqual([
      "Alder Research 3 March 31 September 2, 2026",
      "Cedarline Systems 10 September 30 October 14, 2026",
      "Ironleaf Farms 0 Not set October 14, 2026",
    ]);
    // A row opens the company page: its name's link covers the row.
    const link = document.querySelector<HTMLAnchorElement>('[data-company-link="cedarline systems"]')!;
    expect(link.getAttribute("href")).toBe("/companies/cedarline%20systems");
    const row = link.closest<HTMLElement>("[data-company-row]")!;
    const rowBox = row.getBoundingClientRect();
    const hit = document.elementFromPoint(rowBox.right - 20, rowBox.top + rowBox.height / 2);
    expect(hit).toBe(link);
    // Plain words: no em or en dashes on the page.
    expect(text(document.querySelector("[data-companies-page]"))).not.toMatch(/[\u2010-\u2015\u2212]/);
  });

  it("a company with no year end saved shows its newest project's; a saved one wins (2026-10-28)", async () => {
    seed("consultant");
    // Only Ironleaf Farms has none saved; the read is asked about it alone.
    __setQueryDataForArgs("clients:listCompanyYearEnds", { keys: ["ironleaf farms"] }, [
      { key: "ironleaf farms", fiscalYearEndMonth: 12, fiscalYearEndDay: 31 },
    ]);
    await mount(null);
    await expect.poll(() => text(document.querySelector('[data-company-row="ironleaf farms"] [data-company-year-end]'))).toBe(
      "December 31 from the newest project"
    );
    // Screen readers hear what the muted ink shows.
    expect(text(document.querySelector('[data-company-row="ironleaf farms"] [data-company-year-end] .sr-only'))).toBe(
      "from the newest project"
    );
    expect(text(document.querySelector('[data-company-row="alder research"] [data-company-year-end]'))).toBe("March 31");
    expect(text(document.querySelector('[data-company-row="cedarline systems"] [data-company-year-end]'))).toBe("September 30");
    expect(__queryArgsHistory("clients:listCompanyYearEnds")).toEqual([{ keys: ["ironleaf farms"] }]);
    // A borrowed year end reads in muted ink; a saved one does not.
    const borrowed = document.querySelector<HTMLElement>('[data-company-row="ironleaf farms"] [data-company-year-end]')!;
    expect(borrowed.hasAttribute("data-borrowed")).toBe(true);
    expect(borrowed.className).toContain("text-ink-muted");
    const saved = document.querySelector<HTMLElement>('[data-company-row="alder research"] [data-company-year-end]')!;
    expect(saved.hasAttribute("data-borrowed")).toBe(false);
    expect(saved.className).toContain("text-ink-secondary");
  });

  it("shows nothing while a borrowed year end is read, and drops one that went away", async () => {
    seed("consultant");
    await mount(null);
    await expect.poll(() => tableRows().length).toBe(3);
    // Not read yet: blank, not "Not set".
    const cellText = () => text(document.querySelector('[data-company-row="ironleaf farms"] [data-company-year-end]'));
    expect(cellText()).toBe("");
    __setQueryDataForArgs("clients:listCompanyYearEnds", { keys: ["ironleaf farms"] }, [
      { key: "ironleaf farms", fiscalYearEndMonth: 12, fiscalYearEndDay: 31 },
    ]);
    await expect.poll(cellText).toBe("December 31 from the newest project");
    // The project that gave it is gone: the read no longer has the key.
    __setQueryDataForArgs("clients:listCompanyYearEnds", { keys: ["ironleaf farms"] }, []);
    await expect.poll(cellText).toBe("Not set");
  });

  it("a year end read that fails shows Not set, not a blank cell", async () => {
    seed("consultant");
    __setQueryError("clients:listCompanyYearEnds", new Error("down"));
    await mount(null);
    await expect.poll(() => text(document.querySelector('[data-company-row="ironleaf farms"] [data-company-year-end]'))).toBe(
      "Not set"
    );
  });

  it("a year end read that will not run (no session) shows Not set; one still loading stays blank", async () => {
    __setQueryData("users:getCurrentUser", USERS.consultant);
    await page.viewport(1440, 900);
    const one = [{ key: "ironleaf farms", clientId: null, name: "Ironleaf Farms", projectCount: 0, updatedAt: OCT_14 }];
    // Still loading: blank.
    const loading = await render(AllCompaniesTable, { companies: one, root: "/" });
    await expect.poll(() => document.querySelector('[data-company-row="ironleaf farms"]')).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(text(document.querySelector('[data-company-row="ironleaf farms"] [data-company-year-end]'))).toBe("");
    loading.unmount();
    // Signed out: the read is skipped, so there is nothing to wait for.
    __setAuthState({ isLoading: false, isAuthenticated: false });
    await render(AllCompaniesTable, { companies: one, root: "/" });
    await expect.poll(() => text(document.querySelector('[data-company-row="ironleaf farms"] [data-company-year-end]'))).toBe(
      "Not set"
    );
  });

  it("a company list update keeps each chunk's read as it is", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:listCompanyYearEnds", { keys: ["ironleaf farms"] }, []);
    await mount(null);
    await expect.poll(() => __activeQueryCount("clients:listCompanyYearEnds")).toBe(1);
    const before = (__activeQueryArgs("clients:listCompanyYearEnds")[0] as { keys: string[] }).keys;
    // A new list object, new entry objects, the same companies needing a year end.
    __setQueryData("clients:listClients", {
      clients: CLIENTS.map((client) => ({ ...client, projectCount: client.projectCount + 1 })),
      truncated: false,
    });
    await expect.poll(() => text(document.querySelector('[data-company-row="ironleaf farms"] [data-company-projects]'))).toBe("1");
    expect(__activeQueryCount("clients:listCompanyYearEnds")).toBe(1);
    expect((__activeQueryArgs("clients:listCompanyYearEnds")[0] as { keys: string[] }).keys).toBe(before);
  });

  it("Not set stays only when neither the company nor a project has a year end", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:listCompanyYearEnds", { keys: ["ironleaf farms"] }, []);
    await mount(null);
    await expect.poll(() => tableRows().length).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(text(document.querySelector('[data-company-row="ironleaf farms"] [data-company-year-end]'))).toBe("Not set");
  });

  it("Search companies filters the table, ignoring case and accents", async () => {
    seed("consultant");
    await mount(null);
    await expect.poll(() => tableRows().length).toBe(3);
    const search = page.getByRole("searchbox", { name: "Search companies" });
    await userEvent.fill(search, "CEDAR");
    await expect.poll(() => tableRows().map((row) => row.dataset.companyRow)).toEqual(["cedarline systems"]);
    await userEvent.fill(search, "nobody");
    await expect.poll(() => text(document.querySelector("[data-companies-no-match]"))).toBe('No company matches "nobody".');
    // A status line beside the table, not a child of role="table".
    expect(document.querySelector("[data-companies-no-match]")!.closest('[role="table"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => tableRows().length).toBe(3);
  });

  it("shows 50 rows, then 50 more with Show more", async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      key: `company ${String(index).padStart(3, "0")}`,
      clientId: null,
      name: `Company ${String(index).padStart(3, "0")}`,
      projectCount: 1,
      updatedAt: OCT_14,
    }));
    seed("consultant", many);
    await mount(null);
    await expect.poll(() => tableRows().length).toBe(50);
    expect(text(barCount())).toBe("120 companies");
    await userEvent.click(page.getByRole("button", { name: "Show more" }));
    await expect.poll(() => tableRows().length).toBe(100);
    await userEvent.click(page.getByRole("button", { name: "Show more" }));
    await expect.poll(() => tableRows().length).toBe(120);
    expect(document.querySelector("[data-companies-show-more]")).toBeNull();
  });

  it("with no companies, says so (Paper Z9c) and offers New company to those who may create projects", async () => {
    seed("consultant", []);
    await mount(null);
    await expect.poll(() => document.querySelector("[data-companies-empty]")).not.toBeNull();
    expect(text(document.querySelector("[data-companies-empty]"))).toBe(
      "Add your first company Every project belongs to a company. Add one, then start its first project. New company"
    );
    await userEvent.click(document.querySelector<HTMLElement>("[data-companies-empty-new]")!);
    await expect.element(page.getByRole("dialog", { name: "New company" })).toBeVisible();
  });

  it("holds the table's shape while the list loads", async () => {
    __setQueryData("users:getCurrentUser", USERS.consultant);
    await mount(null);
    await expect.poll(() => document.querySelector('[data-panel-skeleton="companies-table"]')).not.toBeNull();
    expect(document.querySelector("[data-companies-table]")).toBeNull();
    expect(text(barTitle())).toBe("Companies");
  });
});

describe("the Companies sidebar", () => {
  it("has the title, New company, All companies with the count and every company, laid out as Team's", async () => {
    seed("consultant");
    await mount(null);
    await expect.poll(() => sidebar()?.querySelectorAll("[data-client-row]").length).toBe(3);
    const aside = sidebar()!;
    expect(text(aside.querySelector("[data-section-sidebar-title]"))).toBe("Companies");
    expect(text(aside.querySelector("[data-section-sidebar-action]"))).toBe("New company");
    const all = aside.querySelector<HTMLAnchorElement>('[data-companies-sidebar="all"]')!;
    expect(text(all)).toBe("All companies 3");
    expect(all.getAttribute("href")).toBe("/companies");
    expect(all.getAttribute("aria-current")).toBe("page");
    const cedar = aside.querySelector<HTMLAnchorElement>('[data-client-row="cedarline systems"]')!;
    expect(text(cedar)).toBe("Cedarline Systems 10");
    expect(cedar.getAttribute("href")).toBe("/companies/cedarline%20systems");
    // The shared sidebar: 228px with the collapse button; Consultants get no merge.
    expect(aside.parentElement!.getBoundingClientRect().width).toBeCloseTo(board(228), 0);
    expect(aside.querySelector("[data-section-sidebar-toggle]")).not.toBeNull();
    expect(aside.querySelector("[data-start-merge]")).toBeNull();
    // The bar's New company is the sidebar's while it is open.
    expect(getComputedStyle(document.querySelector("[data-top-bar-primary]")!).display).toBe("none");
  });

  it("New company opens the dialog; a made company opens its page", async () => {
    seed("consultant");
    __setMutationResult("clients:createClient", { clientId: "c-new", key: "birch foods", name: "Birch Foods" });
    await mount(null);
    await expect.poll(() => sidebar()?.querySelector("[data-section-sidebar-action]")).not.toBeNull();
    await userEvent.click(sidebar()!.querySelector<HTMLElement>("[data-section-sidebar-action]")!);
    await expect.element(page.getByRole("dialog", { name: "New company" })).toBeVisible();
    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Birch Foods");
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-create-client]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-create-client]")!);
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/companies/birch%20foods");
  });

  it("is not drawn on a company's page (2026-11-04): the switcher takes its place", async () => {
    seed("consultant");
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-company-switcher]")).not.toBeNull();
    expect(sidebar()).toBeNull();
    expect(document.querySelector("[data-section-sidebar-expand]")).toBeNull();
  });

  it("Merge companies sits at the foot for Managers and Admins; a merge opens the kept company", async () => {
    seed("manager");
    __setQueryData("clients:previewClientMerge", {
      projectCount: 13,
      movedCount: 3,
      tooMany: false,
      keptName: "Cedarline Systems",
      keptKey: "cedarline systems",
      nameConflict: null,
      numberCollisions: [],
      collisionCheckIncomplete: false,
      companyFileCount: 0,
      tooManyCompanyFiles: false,
    });
    __setMutationResult("clients:mergeClients", { moved: 3, keptKey: "cedarline systems", keptName: "Cedarline Systems", clientId: "c3" });
    await mount(null);
    await expect.poll(() => sidebar()?.querySelector("[data-start-merge]")).not.toBeNull();
    // New company is the sidebar's main action, so the foot has merge only.
    expect(sidebar()!.querySelector("[data-new-client]")).toBeNull();
    await userEvent.click(sidebar()!.querySelector<HTMLElement>("[data-start-merge]")!);
    await userEvent.click(page.getByRole("checkbox", { name: /^Alder Research 3$/ }));
    await userEvent.click(page.getByRole("checkbox", { name: /^Cedarline Systems 10$/ }));
    await userEvent.click(document.querySelector<HTMLElement>("[data-merge-open]")!);
    await expect.element(page.getByRole("dialog", { name: "Merge 2 companies" })).toBeVisible();
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-confirm-merge]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-confirm-merge]")!);
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/companies/cedarline%20systems");
    await expect.poll(() => sidebar()?.querySelector("[data-merge-bar]")).toBeNull();
  });

  it("collapses with Mod \\ like every section sidebar, and the bar then holds New company", async () => {
    seed("consultant");
    await mount(null);
    await expect.poll(() => sectionSidebar.mounted).toBeGreaterThan(0);
    await userEvent.keyboard("{Control>}\\{/Control}");
    await expect.poll(() => sectionSidebar.collapsed).toBe(true);
    expect(JSON.parse(localStorage.getItem(SECTION_SIDEBAR_KEY) ?? "{}")).toEqual({ collapsed: true });
    await expect.poll(() => getComputedStyle(document.querySelector("[data-top-bar-primary]")!).display).not.toBe("none");
    expect(text(document.querySelector("[data-top-bar-primary]"))).toBe("New company");
    // The bar's expand button brings it back.
    await userEvent.click(document.querySelector<HTMLElement>("[data-section-sidebar-expand]")!);
    await expect.poll(() => sectionSidebar.collapsed).toBe(false);
  });

  it("is hidden on a phone, where the bar keeps New company", async () => {
    seed("consultant");
    await mount(null, 390);
    await expect.poll(() => tableRows().length).toBe(3);
    expect(getComputedStyle(document.querySelector('[data-section-sidebar-slot="companies"]')!).display).toBe("none");
    expect(getComputedStyle(document.querySelector("[data-top-bar-primary]")!).display).not.toBe("none");
  });
});

describe("a company's page (2026-11-04, the company profile)", () => {
  it("has no sidebar: the bar reads Companies / <switcher> with New project, then the header and the tabs", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://www.cedarline.ca",
      team: [
        { id: "u-c", name: "Priya Nair", initials: "PN" },
        { id: "u-m", name: "Jordan Ellis", initials: "JE" },
        { id: "u-a", name: "Sam Okafor", initials: "SO" },
        { id: "u-x", name: "Kai Lee", initials: "KL" },
      ],
    }));
    await mount("cedarline systems");
    await expect.poll(() => text(barTitle())).toBe("Cedarline Systems");
    expect(sidebar()).toBeNull();
    // The bar: "Companies" links All companies, then the switcher.
    const crumbs = document.querySelector<HTMLElement>("[data-company-breadcrumb]")!;
    expect(crumbs.closest("[data-page-top-bar]")).not.toBeNull();
    expect(text(crumbs)).toBe("Companies / Cedarline Systems");
    expect(crumbs.querySelector("[data-company-breadcrumb-all]")!.getAttribute("href")).toBe("/companies");
    expect(document.querySelector("[data-company-switcher]")!.getAttribute("aria-label")).toBe("Cedarline Systems, switch company");
    const newProject = document.querySelector<HTMLAnchorElement>("[data-top-bar-primary]")!;
    expect(text(newProject)).toBe("New project");
    expect(newProject.getAttribute("href")).toBe("/project/new?client=Cedarline+Systems");
    expect(getComputedStyle(newProject).display).not.toBe("none");
    expect(document.querySelector("[data-page-count]")).toBeNull();
    // The header: the page's one h1, the website host, the industry and Client since.
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(barTitle()!.tagName).toBe("H1");
    expect(barTitle()!.closest("[data-company-header]")).not.toBeNull();
    const website = document.querySelector<HTMLAnchorElement>("[data-company-website]")!;
    expect(text(website)).toBe("cedarline.ca");
    expect(website.getAttribute("target")).toBe("_blank");
    expect(website.getAttribute("rel")).toBe("noopener noreferrer");
    expect(text(document.querySelector("[data-company-meta]"))).toBe("cedarline.ca Manufacturing Client since January 2025");
    // Up to three initials, the count naming all of them.
    expect([...document.querySelectorAll("[data-company-team-member] [aria-hidden]")].map((node) => text(node))).toEqual(["PN", "JE", "SO"]);
    expect(text(document.querySelector("[data-company-team-count]"))).toBe("4 people on this company");
    // Underlined tabs, Overview first and selected.
    const tabs = [...document.querySelectorAll<HTMLElement>('[data-company-tabs] [role="tab"]')];
    expect(tabs.map((node) => [node.dataset.companyTab, node.getAttribute("aria-selected")])).toEqual([
      ["overview", "true"],
      ["files", "false"],
      ["people", "false"],
      ["activity", "false"],
      ["details", "false"],
    ]);
    expect(tabs[0]!.querySelector("[data-company-tab-underline]")).not.toBeNull();
    expect(tabs[0]!.className).not.toContain("bg-primary-selected");
    expect(document.querySelector<HTMLElement>('[data-company-panel="overview"]')!.hidden).toBe(false);
    // Plain words: no em or en dashes on the page.
    expect(text(document.querySelector("[data-company-view]"))).not.toMatch(/[‐-―−]/);
  });

  it("hides what it does not know: no website, industry or date, and no people", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "ironleaf farms" }, companyPage("ironleaf farms", { clientSince: null }));
    await mount("ironleaf farms");
    await expect.poll(() => text(barTitle())).toBe("Ironleaf Farms");
    expect(document.querySelector("[data-company-meta]")).toBeNull();
    expect(document.querySelector("[data-company-team]")).toBeNull();
    expect(text(document.querySelector("[data-company-tab-count]"))).toBe("");
  });

  it("the tabs keep the address (?tab=): it opens on the tab named, and a change writes it without a navigation", async () => {
    seed("consultant");
    __setPageUrl("/companies/cedarline%20systems?tab=details");
    await page.viewport(1440, 900);
    await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => document.querySelector('[data-company-tab="details"]')?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector<HTMLElement>('[data-company-panel="details"]')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-company-panel="overview"]')!.hidden).toBe(true);
    await userEvent.click(document.querySelector<HTMLElement>('[data-company-tab="files"]')!);
    await expect.poll(() => document.querySelector<HTMLElement>("[data-company-files-panel]")?.hidden).toBe(false);
    expect(__navigationCalls.at(-1)).toEqual({ kind: "replaceState", url: "/companies/cedarline%20systems?tab=files" });
    expect(__navigationCalls.filter((call) => call.kind === "goto")).toEqual([]);
    // Overview drops the parameter.
    await userEvent.click(document.querySelector<HTMLElement>('[data-company-tab="overview"]')!);
    await expect.poll(() => __navigationCalls.at(-1)).toEqual({ kind: "replaceState", url: "/companies/cedarline%20systems" });
  });

  it("an unknown tab in the address opens Overview", async () => {
    seed("consultant");
    __setPageUrl("/companies/cedarline%20systems?tab=nope");
    await page.viewport(1440, 900);
    await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => document.querySelector('[data-company-tab="overview"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("the tabs are a tablist: arrow keys move and wrap, Home and End go to the ends, focus follows", async () => {
    seed("consultant");
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector('[data-company-tab="overview"]')).not.toBeNull();
    const overview = document.querySelector<HTMLElement>('[data-company-tab="overview"]')!;
    expect(overview.tabIndex).toBe(0);
    expect(document.querySelector<HTMLElement>('[data-company-tab="files"]')!.tabIndex).toBe(-1);
    expect(overview.getAttribute("aria-controls")).toBe("company-panel-overview");
    overview.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => document.activeElement?.getAttribute("data-company-tab")).toBe("files");
    expect(document.querySelector('[data-company-tab="files"]')!.getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{End}");
    await expect.poll(() => document.activeElement?.getAttribute("data-company-tab")).toBe("details");
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => document.activeElement?.getAttribute("data-company-tab")).toBe("overview");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => document.activeElement?.getAttribute("data-company-tab")).toBe("details");
    await userEvent.keyboard("{Home}");
    await expect.poll(() => document.activeElement?.getAttribute("data-company-tab")).toBe("overview");
  });

  it("another company starts on Overview", async () => {
    seed("consultant");
    const screen = await mount("cedarline systems");
    await expect.poll(() => document.querySelector('[data-company-tab="details"]')).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>('[data-company-tab="details"]')!);
    await expect.poll(() => document.querySelector('[data-company-tab="details"]')?.getAttribute("aria-selected")).toBe("true");
    __setPageUrl("/companies/alder%20research");
    await screen.rerender({ companyKey: "alder research" });
    await expect.poll(() => text(barTitle())).toBe("Alder Research");
    expect(document.querySelector('[data-company-tab="overview"]')!.getAttribute("aria-selected")).toBe("true");
  });

  it("the switcher lists recent companies, then every company; it finds one ignoring case and accents and opens it", async () => {
    seed("consultant");
    localStorage.setItem("banhall.recentCompanies.v1:u-c", JSON.stringify([{ key: "alder research", name: "Alder Research" }]));
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-company-switcher]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-company-switcher]")!);
    const panel = () => document.querySelector<HTMLElement>("[data-company-switcher-panel]");
    await expect.poll(panel).not.toBeNull();
    await expect.poll(() => document.activeElement?.hasAttribute("data-company-switcher-search")).toBe(true);
    const group = (id: string) =>
      [...panel()!.querySelectorAll<HTMLElement>(`[data-switcher-group="${id}"] [role="option"]`)].map((node) => text(node));
    expect(group("recent")).toEqual(["Alder Research 3"]);
    expect(group("all")).toEqual(["Alder Research 3", "Cedarline Systems 10", "Ironleaf Farms 0"]);
    expect(panel()!.querySelector('[data-switcher-group="all"] [data-switcher-option="cedarline systems"]')!.getAttribute("aria-selected")).toBe("true");
    expect(panel()!.querySelector<HTMLAnchorElement>("[data-switcher-all]")!.getAttribute("href")).toBe("/companies");
    expect(panel()!.querySelector("[data-switcher-new-company]")).not.toBeNull();
    // Type to find: case and accents ignored; the recent group steps aside.
    await userEvent.keyboard("ÍRONLEAF");
    await expect.poll(() => group("all")).toEqual(["Ironleaf Farms 0"]);
    expect(panel()!.querySelector('[data-switcher-group="recent"]')).toBeNull();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/companies/ironleaf%20farms");
    await expect.poll(panel).toBeNull();
  });

  it("the switcher moves with the arrow keys, says when nothing matches, and New company opens its dialog", async () => {
    seed("consultant");
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-company-switcher]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-company-switcher]")!);
    await expect.poll(() => document.querySelector("[data-company-switcher-search]")).not.toBeNull();
    const search = document.querySelector<HTMLInputElement>("[data-company-switcher-search]")!;
    await expect.poll(() => document.querySelectorAll('[data-company-switcher-panel] [role="option"]').length).toBe(3);
    await userEvent.keyboard("{ArrowDown}");
    expect(search.getAttribute("aria-activedescendant")).toBe(document.querySelector('[data-switcher-option="cedarline systems"]')!.id);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(search.getAttribute("aria-activedescendant")).toBe(document.querySelector('[data-switcher-option="ironleaf farms"]')!.id);
    await userEvent.keyboard("zzz");
    await expect.poll(() => text(document.querySelector('[data-switcher-group="all"]'))).toBe('All companies No company matches "zzz".');
    await userEvent.click(document.querySelector<HTMLElement>("[data-switcher-new-company]")!);
    await expect.element(page.getByRole("dialog", { name: "New company" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
    await expect.poll(() => document.body.style.pointerEvents).toBe("");
  });

  it("shows the company's projects as one table: #, project, stage, fiscal year, owner, last updated; a row opens the project", async () => {
    seed("consultant");
    await mount("cedarline systems");
    const rows = () => [...document.querySelectorAll<HTMLElement>("[data-company-project-row]")];
    await expect.poll(() => rows().length).toBe(2);
    const headers = [...document.querySelectorAll("[data-company-projects-table] th")].map((node) => text(node));
    expect(headers).toEqual(["Project", "Stage", "Year", "Owner", "Updated"]);
    expect(rows().map((row) => [...row.querySelectorAll("td")].map((cell) => text(cell)))).toEqual([
      ["#1 Adaptive cold storage controls", "Internal review", "FY 2026", "Priya Nair", "Oct 14, 2026"],
      ["#2 Defrost cycle prediction", "Drafting", "FY 2025", "Jordan Ellis", "Oct 14, 2026"],
    ]);
    expect(text(document.querySelector("[data-company-projects-count]"))).toBe("2");
    expect(text(document.querySelector("[data-company-projects-range]"))).toBe("1 to 2 of 2 projects");
    // One page: no page buttons.
    expect(document.querySelector("[data-company-projects-next]")).toBeNull();
    // The whole row is one link to the project (Cmd or Ctrl click opens a new tab).
    const link = document.querySelector<HTMLAnchorElement>('[data-company-project-link="p1"]')!;
    expect(link.getAttribute("href")).toBe("/project/p1");
    rows()[0]!.scrollIntoView({ block: "center" });
    const box = rows()[0]!.getBoundingClientRect();
    expect(document.elementFromPoint(box.right - 20, box.top + box.height / 2)).toBe(link);
    // The query asked for the company's first page, last updated first.
    expect(__queryArgsHistory("companyProjects:listCompanyProjects").at(-1)).toEqual({ companyKey: "cedarline systems" });
  });

  it("a row's hover changes only its background; keyboard focus adds the 2px teal ring", async () => {
    seed("consultant");
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector('[data-company-project-row="p1"]')).not.toBeNull();
    const row = document.querySelector<HTMLElement>('[data-company-project-row="p1"]')!;
    const rest = getComputedStyle(row).backgroundColor;
    await userEvent.hover(row);
    await expect.poll(() => getComputedStyle(row).backgroundColor).not.toBe(rest);
    await userEvent.unhover(row);
    document.querySelector<HTMLElement>("[data-company-projects-search]")!.focus();
    await userEvent.tab();
    // Past the filters and the sort, Tab reaches the first row's link.
    for (let step = 0; step < 6 && !document.activeElement?.hasAttribute("data-company-project-link"); step += 1) await userEvent.tab();
    expect(document.activeElement?.getAttribute("data-company-project-link")).toBe("p1");
    const ring = getComputedStyle(document.activeElement!, "::after");
    expect(ring.outlineStyle).toBe("solid");
    expect(ring.outlineWidth).toBe("2px");
    await expect.poll(() => getComputedStyle(row).backgroundColor).not.toBe(rest);
  });

  it("searches, filters by stage, fiscal year and owner, sorts, and goes back to page 1 on each change", async () => {
    seed("consultant");
    __setQueryData("companyProjects:listCompanyProjects", tableResult(Array.from({ length: 10 }, (_, index) => tableRow(index + 1)), {
      total: 24,
      all: 24,
      pageCount: 3,
    }));
    await mount("cedarline systems");
    await expect.poll(() => document.querySelectorAll("[data-company-project-row]").length).toBe(10);
    expect(text(document.querySelector("[data-company-projects-range]"))).toBe("1 to 10 of 24 projects");
    expect([...document.querySelectorAll("[data-company-projects-page]")].map((node) => text(node))).toEqual(["1", "2", "3"]);
    expect(document.querySelector<HTMLButtonElement>("[data-company-projects-previous]")!.disabled).toBe(true);
    await userEvent.click(document.querySelector<HTMLElement>('[data-company-projects-page="2"]')!);
    await expect.poll(() => __queryArgsHistory("companyProjects:listCompanyProjects").at(-1)).toEqual({ companyKey: "cedarline systems", page: 2 });

    // Stage: picking one sends it and starts again at page 1.
    await userEvent.click(document.querySelector<HTMLElement>('[data-projects-filter="stage"]')!);
    await userEvent.click(page.getByRole("menuitemradio", { name: "Delivered" }));
    await expect.poll(() => __queryArgsHistory("companyProjects:listCompanyProjects").at(-1)).toEqual({ companyKey: "cedarline systems", stage: "delivered" });
    expect(text(document.querySelector('[data-projects-filter="stage"]'))).toBe("Delivered");
    // Fiscal year and owner.
    await userEvent.click(document.querySelector<HTMLElement>('[data-projects-filter="fiscal-year"]')!);
    await userEvent.click(page.getByRole("menuitemradio", { name: "FY 2025" }));
    await userEvent.click(document.querySelector<HTMLElement>('[data-projects-filter="owner"]')!);
    await userEvent.click(page.getByRole("menuitemradio", { name: "Jordan Ellis" }));
    await expect.poll(() => __queryArgsHistory("companyProjects:listCompanyProjects").at(-1)).toEqual({
      companyKey: "cedarline systems",
      stage: "delivered",
      fiscalYear: 2025,
      ownerId: "u-m",
    });
    // The search waits for a pause in typing.
    await userEvent.fill(page.getByRole("searchbox", { name: "Search projects" }), "defrost");
    await expect.poll(() => __queryArgsHistory("companyProjects:listCompanyProjects").at(-1)).toMatchObject({ search: "defrost" });
    // Sort.
    await userEvent.click(document.querySelector<HTMLElement>("[data-company-projects-sort]")!);
    await userEvent.click(page.getByRole("menuitemradio", { name: "Name, A to Z" }));
    await expect.poll(() => __queryArgsHistory("companyProjects:listCompanyProjects").at(-1)).toMatchObject({ sort: "title" });
    // Clear puts every filter back.
    await userEvent.click(document.querySelector<HTMLElement>("[data-company-projects-clear]")!);
    await expect.poll(() => __queryArgsHistory("companyProjects:listCompanyProjects").at(-1)).toEqual({ companyKey: "cedarline systems", sort: "title" });
  });

  it("Previous and Next move a page; the last page's Next is off", async () => {
    seed("consultant");
    __setQueryData("companyProjects:listCompanyProjects", tableResult([tableRow(21)], { total: 21, all: 21, page: 3, pageCount: 3 }));
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-company-projects-next]")?.disabled).toBe(true);
    expect(text(document.querySelector("[data-company-projects-range]"))).toBe("21 to 21 of 21 projects");
    expect(document.querySelector('[data-company-projects-page="3"]')!.getAttribute("aria-current")).toBe("page");
    await userEvent.click(document.querySelector<HTMLElement>("[data-company-projects-previous]")!);
    await expect.poll(() => __queryArgsHistory("companyProjects:listCompanyProjects").at(-1)).toEqual({ companyKey: "cedarline systems", page: 2 });
  });

  it("says when no project matches, and an empty company says so (Paper Z9a) with New project for it", async () => {
    seed("consultant");
    __setQueryData("companyProjects:listCompanyProjects", tableResult([], { all: 4 }));
    const screen = await mount("cedarline systems");
    await expect.poll(() => text(document.querySelector("[data-company-projects-none]"))).toBe("No projects match these filters.");
    screen.unmount();
    __setQueryData("companyProjects:listCompanyProjects", tableResult([]));
    await mount("ironleaf farms");
    await expect.poll(() => document.querySelector("[data-client-empty]")).not.toBeNull();
    expect(text(document.querySelector("[data-client-empty]"))).toBe(
      "No projects for Ironleaf Farms yet Start a project and it will show up here. New project for Ironleaf Farms"
    );
    expect(document.querySelector("[data-client-new-project]")!.getAttribute("href")).toBe("/project/new?client=Ironleaf+Farms");
  });

  it("the summary card's footer says where the text came from (Paper 430O), each line only when true", async () => {
    seed("consultant");
    const footer = () => document.querySelector("[data-company-summary-footer]");
    const cases: [Record<string, unknown> | null, string | null][] = [
      [{ text: "Cedarline builds controls.", aiDraftedFrom: "https://cedarline.ca" }, "Drafted by AI from cedarline.ca"],
      [
        { text: "Cedarline builds controls.", aiDraftedFrom: "https://cedarline.ca", editedByName: "Jordan Ellis", editedAt: Date.parse("2026-10-03T15:00:00Z") },
        "Drafted by AI from cedarline.ca Edited by Jordan Ellis on Oct 3, 2026",
      ],
      [{ text: "Cedarline builds controls.", editedByName: "Sam Okafor", editedAt: Date.parse("2026-09-18T15:00:00Z") }, "Edited by Sam Okafor on Sep 18, 2026"],
      [{ text: "Cedarline builds controls." }, null],
    ];
    for (const [summary, expected] of cases) {
      __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", { summary }));
      const screen = await mount("cedarline systems");
      await expect.poll(() => text(document.querySelector("[data-company-summary-text]"))).toBe("Cedarline builds controls.");
      if (expected === null) expect(footer()).toBeNull();
      else expect(text(footer())).toBe(expected);
      screen.unmount();
    }
    // The AI's source opens the website.
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", { summary: cases[0]![0] }));
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-company-summary-drafted] a")).not.toBeNull();
    expect(document.querySelector("[data-company-summary-drafted] a")!.getAttribute("href")).toBe("https://cedarline.ca");
  });

  it("with no summary it says so; while the website is read it says a draft follows", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
      websiteRead: { status: "reading" },
    }));
    await mount("cedarline systems");
    await expect.poll(() => text(document.querySelector("[data-company-summary-empty]"))).toBe(
      "No summary yet. One is drafted from the website once it is read."
    );
    expect(document.querySelector("[data-company-summary-footer]")).toBeNull();
  });

  it("a Manager writes the summary from Edit; Cancel and Escape leave it as it was", async () => {
    seed("manager");
    __setMutationResult("companySummary:updateCompanySummary", null);
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      summary: { text: "Cedarline builds controls.", aiDraftedFrom: "https://cedarline.ca" },
    }));
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-company-summary-edit]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-company-summary-edit]")!);
    const input = () => document.querySelector<HTMLTextAreaElement>("[data-company-summary-input]");
    await expect.poll(() => document.activeElement === input()).toBe(true);
    expect(input()!.value).toBe("Cedarline builds controls.");
    await userEvent.keyboard("{Escape}");
    await expect.poll(input).toBeNull();
    expect(__mutationCalls("companySummary:updateCompanySummary")).toEqual([]);
    await expect.poll(() => document.activeElement?.hasAttribute("data-company-summary-edit")).toBe(true);

    await userEvent.click(document.querySelector<HTMLElement>("[data-company-summary-edit]")!);
    await userEvent.fill(page.getByRole("textbox", { name: "Company summary" }), "Cedarline builds refrigeration controls.");
    await userEvent.click(document.querySelector<HTMLElement>("[data-company-summary-save]")!);
    await expect.poll(() => __mutationCalls("companySummary:updateCompanySummary")).toEqual([
      { clientId: "c3", text: "Cedarline builds refrigeration controls." },
    ]);
    await expect.poll(input).toBeNull();
  });

  it("refuses a summary over 1,000 characters before it is sent", async () => {
    seed("admin");
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-company-summary-edit]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-company-summary-edit]")!);
    await userEvent.fill(page.getByRole("textbox", { name: "Company summary" }), "a".repeat(1_001));
    await expect.poll(() => text(document.querySelector("[data-company-summary-help]"))).toBe("At most 1,000 characters.");
    expect(document.querySelector<HTMLButtonElement>("[data-company-summary-save]")!.disabled).toBe(true);
  });

  it("a company known only by its projects has nothing to save a summary to, so no Edit", async () => {
    seed("manager");
    await mount("ironleaf farms");
    await expect.poll(() => document.querySelector("[data-company-summary]")).not.toBeNull();
    expect(document.querySelector("[data-company-summary-edit]")).toBeNull();
  });

  it("Details lists the company and its record (Paper 4AVC)", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
      websiteRead: { status: "read", finishedAt: Date.parse("2026-10-02T15:00:00Z") },
      formerNames: [{ name: "Cedarline Systems Inc", mergedAt: Date.parse("2026-10-19T15:00:00Z") }, { name: "Cedar Line" }],
    }));
    __setPageUrl("/companies/cedarline%20systems?tab=details");
    await page.viewport(1440, 900);
    await render(CompaniesPage, { companyKey: "cedarline systems" });
    const row = (id: string) => text(document.querySelector(`[data-details-row="${id}"]`));
    await expect.poll(() => row("name")).toBe("Name Cedarline Systems");
    expect(row("industry")).toBe("Industry Manufacturing");
    expect(row("year-end")).toBe("Usual year end September 30");
    expect(row("website")).toBe("Website cedarline.ca Read into files Oct 2, 2026");
    expect(row("client-since")).toBe("Client since January 14, 2025");
    expect(row("added-by")).toBe("Added by Jordan Ellis");
    expect(row("last-changed")).toBe("Last changed October 14, 2026");
    expect([...document.querySelectorAll("[data-details-former-name]")].map((node) => [...node.children].map((child) => text(child)))).toEqual([
      ["Cedarline Systems Inc", "Merged into this company Oct 19, 2026"],
      ["Cedar Line", "An earlier name"],
    ]);
    expect(text(document.querySelector('[data-details-list="company"] h3'))).toBe("Company");
    expect(text(document.querySelector('[data-details-list="record"] h3'))).toBe("Record");
  });

  it("Details says how the website read went, and Not set for what is missing", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
      websiteRead: { status: "failed", reason: "it did not answer within 10 seconds." },
    }));
    __setPageUrl("/companies/cedarline%20systems?tab=details");
    await page.viewport(1440, 900);
    const screen = await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => text(document.querySelector('[data-details-website-status="failed"]'))).toBe(
      "The website could not be read: it did not answer within 10 seconds."
    );
    screen.unmount();
    __setQueryDataForArgs("clients:getCompanyPage", { key: "ironleaf farms" }, companyPage("ironleaf farms", { createdByName: null, clientSince: null }));
    __setPageUrl("/companies/ironleaf%20farms?tab=details");
    await render(CompaniesPage, { companyKey: "ironleaf farms" });
    const row = (id: string) => text(document.querySelector(`[data-details-row="${id}"]`));
    await expect.poll(() => row("industry")).toBe("Industry Not set");
    expect(row("year-end")).toBe("Usual year end Not set");
    expect(row("website")).toBe("Website Not set");
    expect(row("client-since")).toBe("Client since Not known");
    expect(row("added-by")).toBe("Added by Not recorded");
    expect(row("former-names")).toBe("Also known as No other names");
  });

  it("Managers see a pencil on a company row's hover that opens Edit company, and Read again", async () => {
    seed("manager");
    __setMutationResult("companyWebsite:readWebsiteAgain", null);
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
      websiteRead: { status: "read", finishedAt: OCT_14 },
    }));
    __setPageUrl("/companies/cedarline%20systems?tab=details");
    await page.viewport(1440, 900);
    await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => document.querySelector('[data-details-edit="Industry"]')).not.toBeNull();
    const pencil = document.querySelector<HTMLElement>('[data-details-edit="Industry"]')!;
    expect(getComputedStyle(pencil).opacity).toBe("0");
    await userEvent.hover(document.querySelector<HTMLElement>('[data-details-row="industry"]')!);
    await expect.poll(() => getComputedStyle(pencil).opacity).toBe("1");
    // The record's rows are not edited here.
    expect(document.querySelector('[data-details-row="client-since"] [data-details-edit]')).toBeNull();
    await userEvent.click(pencil);
    await expect.element(page.getByRole("dialog", { name: "Edit company" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector('[data-testid="edit-company-dialog"]')).toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-details-read-again]")!);
    await expect.poll(() => __mutationCalls("companyWebsite:readWebsiteAgain")).toEqual([{ clientId: "c3" }]);
  });

  it("Read again is off while the website is read, and a refusal is shown", async () => {
    seed("admin");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
      websiteRead: { status: "reading" },
    }));
    __setPageUrl("/companies/cedarline%20systems?tab=details");
    await page.viewport(1440, 900);
    const screen = await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-details-read-again]")?.disabled).toBe(true);
    expect(text(document.querySelector("[data-details-read-again]"))).toBe("Reading...");
    screen.unmount();
    const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "t");
    __setMutationError("companyWebsite:readWebsiteAgain", { data: { code: "RATE_LIMITED", message: "More than 20 websites were read for you in the last hour. Try again later." } });
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
      websiteRead: { status: "read", finishedAt: OCT_14 },
    }));
    await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-details-read-again]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-details-read-again]")!);
    await expect.poll(() => errorToast.mock.calls.at(-1)?.[0]).toBe("More than 20 websites were read for you in the last hour. Try again later.");
  });

  it("a key with no company says it doesn't exist, with a link to All companies", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "nobody" }, { kind: "missing" });
    await mount("nobody");
    await expect.poll(() => document.querySelector("[data-company-missing]")).not.toBeNull();
    expect(text(document.querySelector("[data-company-missing]"))).toBe(
      "This company doesn't exist It may have been renamed, or the link may be wrong. Go to All companies"
    );
    expect(document.querySelector("[data-company-missing-back]")!.getAttribute("href")).toBe("/companies");
    expect(text(document.querySelector("[data-company-breadcrumb]"))).toBe("Companies /");
    expect(document.querySelector("[data-top-bar-primary]")).toBeNull();
  });

  it("a merged company's old key opens the company it went into, with the note once (Paper Z9g)", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems inc" }, {
      kind: "merged",
      key: "cedarline systems",
      name: "Cedarline Systems",
    });
    const screen = await mount("cedarline systems inc");
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/companies/cedarline%20systems?merged=cedarline+systems+inc");

    // The route passes the new key; the page asks for the note.
    __setPageUrl("/companies/cedarline%20systems?merged=cedarline+systems+inc");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems", mergedFrom: "cedarline systems inc" }, companyPage("cedarline systems", {
      mergedNote: { noteId: "t-1", fromName: "Cedarline Systems Inc", mergedAt: Date.parse("2026-10-03T15:00:00Z"), projectCount: 2 },
    }));
    await screen.rerender({ companyKey: "cedarline systems" });
    await expect.poll(() => text(document.querySelector("[data-merged-note]"))).toBe(
      "Cedarline Systems Inc was merged into Cedarline Systems on October 3, 2026. Its 2 projects are here now."
    );
    // Closing it must not reload the page: the read without the old key is
    // still loading, so a changed read would unmount the company view.
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, undefined);
    document.querySelector<HTMLElement>('[data-company-tab="files"]')!.click();
    const view = document.querySelector("[data-company-view]");
    const gotos = __navigationCalls.filter((call) => call.kind === "goto").length;
    await userEvent.click(page.getByRole("button", { name: "Close this note" }));
    await expect.poll(() => document.querySelector("[data-merged-note]")).toBeNull();
    expect(document.querySelector("[data-company-view]")).toBe(view);
    expect(document.querySelector('[data-company-tab="files"]')!.getAttribute("aria-selected")).toBe("true");
    expect(__queryArgsHistory("clients:getCompanyPage").at(-1)).toEqual({
      key: "cedarline systems",
      mergedFrom: "cedarline systems inc",
    });
    // The address drops the old key shallowly, with no navigation, and keeps the tab.
    expect(__navigationCalls.filter((call) => call.kind === "goto")).toHaveLength(gotos);
    expect(__navigationCalls.at(-1)).toEqual({ kind: "replaceState", url: "/companies/cedarline%20systems" });
    // Focus leaves the gone close button for the page title.
    await expect.poll(() => document.activeElement?.hasAttribute("data-page-title")).toBe(true);
    screen.unmount();

    // Closed stays closed: the same old link again shows no note.
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems"));
    __setPageUrl("/companies/cedarline%20systems?merged=cedarline+systems+inc");
    await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => document.querySelector("[data-company-view]")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-merged-note]")).toBeNull();
  });

  it("holds its place while it loads: the bar's switcher block and the company's skeleton", async () => {
    __setQueryData("users:getCurrentUser", USERS.consultant);
    __setQueryData("clients:listClients", { clients: CLIENTS, truncated: false });
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector('[data-panel-skeleton="company"]')).not.toBeNull();
    expect(document.querySelector("[data-company-breadcrumb] [data-page-title-pending]")).not.toBeNull();
    expect(document.querySelector("[data-page-title]")).toBeNull();
    expect(sidebar()).toBeNull();
  });
});

describe("Edit company (Managers and Admins)", () => {
  it("a Consultant sees no Edit company, no summary Edit, no pencils and no Read again", async () => {
    seed("consultant");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
      websiteRead: { status: "read", finishedAt: OCT_14 },
    }));
    const screen = await mount("cedarline systems");
    await expect.poll(() => text(barTitle())).toBe("Cedarline Systems");
    expect(document.querySelector("[data-edit-company]")).toBeNull();
    expect(document.querySelector("[data-company-summary-edit]")).toBeNull();
    screen.unmount();
    __setPageUrl("/companies/cedarline%20systems?tab=details");
    await render(CompaniesPage, { companyKey: "cedarline systems" });
    await expect.poll(() => document.querySelector('[data-details-row="name"]')).not.toBeNull();
    expect(document.querySelector("[data-details-edit]")).toBeNull();
    expect(document.querySelector("[data-details-read-again]")).toBeNull();
  });

  it("View as a Consultant hides it from an Admin", async () => {
    seed("admin");
    __setQueryData("users:getCurrentUser", { ...USERS.admin, isDeveloper: true });
    viewAs.enter("consultant");
    await mount("cedarline systems");
    await expect.poll(() => text(barTitle())).toBe("Cedarline Systems");
    expect(document.querySelector("[data-edit-company]")).toBeNull();
  });

  it("a Manager edits the fiscal year end and industry; the dialog opens filled from the company", async () => {
    seed("manager");
    __setMutationResult("clients:updateCompany", { clientId: "c3", key: "cedarline systems", name: "Cedarline Systems", moved: 0 });
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    const button = document.querySelector<HTMLElement>("[data-edit-company]")!;
    expect(text(button)).toBe("Edit company");
    // 2026-11-04: in the bar, a quiet button before New project.
    expect(button.closest("[data-page-top-bar]")).not.toBeNull();
    expect(button.compareDocumentPosition(document.querySelector("[data-top-bar-primary]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(button);
    const dialog = page.getByRole("dialog", { name: "Edit company" });
    await expect.element(dialog).toBeVisible();
    expect(document.querySelector<HTMLInputElement>("#edit-company-name")!.value).toBe("Cedarline Systems");
    const save = () => document.querySelector<HTMLButtonElement>("[data-edit-company-save]")!;
    expect(save().disabled).toBe(true);

    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end month" }));
    await userEvent.click(page.getByRole("option", { name: "December" }));
    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end day" }));
    await userEvent.click(page.getByRole("option", { name: "31", exact: true }));
    await expect.poll(() => save().disabled).toBe(false);
    await userEvent.click(save());
    await expect.poll(() => __mutationCalls("clients:updateCompany")).toEqual([
      {
        key: "cedarline systems",
        expectedName: "Cedarline Systems",
        expectedClientId: "c3",
        expectedUpdatedAt: 1_000,
        name: "Cedarline Systems",
        fiscalYearEndMonth: 12,
        fiscalYearEndDay: 31,
        industry: "manufacturing",
        website: "",
      },
    ]);
    await expect.poll(() => document.querySelector('[data-testid="edit-company-dialog"]')).toBeNull();
    // The key did not change, so the page stays.
    expect(__navigationCalls).toEqual([]);
  });

  it("a rename says every project takes the new name, and the page moves to the new key", async () => {
    seed("admin");
    __setMutationResult("clients:updateCompany", { clientId: "c3", key: "cedarline robotics", name: "Cedarline Robotics", moved: 10 });
    const screen = await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    const name = page.getByRole("textbox", { name: "Name" });
    await userEvent.fill(name, "Cedarline Robotics");
    await expect.poll(() => text(document.querySelector("[data-edit-company-rename-note]"))).toBe(
      "Every project of this company takes the new name."
    );
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company-save]")!);
    await expect.poll(() => __mutationCalls("clients:updateCompany").at(-1)).toMatchObject({
      key: "cedarline systems",
      expectedName: "Cedarline Systems",
      name: "Cedarline Robotics",
    });
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/companies/cedarline%20robotics");
    // The old key is no company any more: until the new address arrives the
    // page holds its shape rather than saying the company does not exist.
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, { kind: "missing" });
    await expect.poll(() => document.querySelector('[data-panel-skeleton="company"]')).not.toBeNull();
    expect(document.querySelector("[data-company-missing]")).toBeNull();
    // Once the new address is drawn, focus is on its Edit company, not lost.
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline robotics" }, {
      ...companyPage("cedarline systems"),
      key: "cedarline robotics",
      name: "Cedarline Robotics",
    });
    await screen.rerender({ companyKey: "cedarline robotics" });
    await expect.poll(() => text(barTitle())).toBe("Cedarline Robotics");
    await expect.poll(() => document.activeElement?.hasAttribute("data-edit-company")).toBe(true);
  });

  it("a rename's hold ends when the person opens another company before the new address lands", async () => {
    seed("admin");
    __setMutationResult("clients:updateCompany", { clientId: "c3", key: "cedarline robotics", name: "Cedarline Robotics", moved: 10 });
    const screen = await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Cedarline Robotics");
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company-save]")!);
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/companies/cedarline%20robotics");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, { kind: "missing" });
    await expect.poll(() => document.querySelector('[data-panel-skeleton="company"]')).not.toBeNull();

    // The person clicks Alder Research in the sidebar before the new page arrives.
    __setPageUrl("/companies/alder%20research");
    await screen.rerender({ companyKey: "alder research" });
    await expect.poll(() => text(barTitle())).toBe("Alder Research");
    expect(document.querySelector('[data-panel-skeleton="company"]')).toBeNull();
    expect(document.querySelector('[data-company-view="alder research"]')).not.toBeNull();
    // Focus is not pulled onto this page's Edit company for the rename.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement?.hasAttribute("data-edit-company")).toBe(false);
  });

  it("a rename's hold ends when the navigation never reaches the new address", async () => {
    seed("admin");
    __setMutationResult("clients:updateCompany", { clientId: "c3", key: "cedarline robotics", name: "Cedarline Robotics", moved: 10 });
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    // The navigation is aborted: the address stays on the old key.
    __setGotoUpdatesPageUrl(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Cedarline Robotics");
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company-save]")!);
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/companies/cedarline%20robotics");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, { kind: "missing" });
    // No endless skeleton: the page says what is at this address now.
    await expect.poll(() => document.querySelector("[data-company-missing]")).not.toBeNull();
    expect(document.querySelector('[data-panel-skeleton="company"]')).toBeNull();
    expect(text(document.querySelector("[data-company-breadcrumb]"))).toBe("Companies /");
  });

  /** Ironleaf Farms with nothing saved: its newest project's December 31 and Manufacturing. */
  function borrowedIronleaf() {
    __setQueryDataForArgs("clients:getCompanyPage", { key: "ironleaf farms" }, companyPage("ironleaf farms", {
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      industry: "manufacturing",
      fiscalYearEndFromProjects: true,
      industryFromProjects: true,
      hasProjectFiscalYearEnd: true,
      hasProjectIndustry: true,
    }));
    __setPaginatedRows("dashboard:listCompanyProjects", []);
  }

  async function openEdit() {
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await expect.element(page.getByRole("dialog", { name: "Edit company" })).toBeVisible();
  }

  const REFILL = "Left empty, this shows the newest project's again.";

  it("emptying a borrowed year end or industry says the newest project's shows again, and saves nothing for them", async () => {
    seed("manager");
    borrowedIronleaf();
    __setMutationResult("clients:updateCompany", { clientId: "c-made", key: "ironleaf farms", name: "Ironleaf Farms", moved: 0 });
    await mount("ironleaf farms");
    await openEdit();
    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end month" }));
    await userEvent.click(page.getByRole("option", { name: "Not set", exact: true }));
    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end day" }));
    await userEvent.click(page.getByRole("option", { name: "Not set", exact: true }));
    await expect.poll(() => text(document.querySelector("[data-edit-company-year-end-helper]"))).toBe(REFILL);
    await userEvent.click(page.getByRole("combobox", { name: "Industry" }));
    await userEvent.click(page.getByRole("option", { name: "Not set (all industries)" }));
    await expect.poll(() => text(document.querySelector("[data-edit-company-industry-helper]"))).toBe(REFILL);
    expect(text(document.querySelector('[data-testid="edit-company-dialog"]'))).not.toMatch(/[\u2010-\u2015\u2212]/);
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-edit-company-save]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company-save]")!);
    await expect.poll(() => __mutationCalls("clients:updateCompany").at(-1)).toEqual({
      key: "ironleaf farms",
      expectedName: "Ironleaf Farms",
      expectedClientId: null,
      expectedUpdatedAt: null,
      name: "Ironleaf Farms",
      website: "",
    });
  });

  it("emptying a saved value with a project's behind it says the project's will show", async () => {
    seed("manager");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      hasProjectFiscalYearEnd: true,
      hasProjectIndustry: false,
    }));
    await mount("cedarline systems");
    await openEdit();
    // Saved and unchanged: the usual line, no borrowed hint.
    expect(text(document.querySelector("[data-edit-company-year-end-helper]"))).toBe(
      "New projects for this company start with it. Projects you already have keep their own."
    );
    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end month" }));
    await userEvent.click(page.getByRole("option", { name: "Not set", exact: true }));
    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end day" }));
    await userEvent.click(page.getByRole("option", { name: "Not set", exact: true }));
    await expect.poll(() => text(document.querySelector("[data-edit-company-year-end-helper]"))).toBe(REFILL);
    // No project has an industry: emptying it says nothing more.
    await userEvent.click(page.getByRole("combobox", { name: "Industry" }));
    await userEvent.click(page.getByRole("option", { name: "Not set (all industries)" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-edit-company-industry-helper]")).toBeNull();
  });

  it("shows the newest project's year end and industry, muted, when the company has none saved", async () => {
    seed("manager");
    borrowedIronleaf();
    __setPageUrl("/companies/ironleaf%20farms?tab=details");
    await page.viewport(1440, 900);
    await render(CompaniesPage, { companyKey: "ironleaf farms" });
    const value = (id: string) => document.querySelector<HTMLElement>(`[data-details-row="${id}"] dd [data-borrowed]`);
    await expect.poll(() => text(value("year-end"))).toBe("December 31 from the newest project");
    expect(text(value("industry"))).toBe("Manufacturing from the newest project");
    expect(text(value("year-end")!.querySelector(".sr-only"))).toBe("from the newest project");
    for (const id of ["year-end", "industry"]) expect(value(id)!.className).toContain("text-ink-muted");
    // The header's industry is muted too, with the same words for screen readers.
    const industry = document.querySelector<HTMLElement>("[data-company-industry]")!;
    expect(industry.hasAttribute("data-borrowed")).toBe(true);
    expect(text(industry)).toBe("Manufacturing from the newest project");
  });

  it("Edit company marks borrowed values and a rename leaves them unsaved, so the company keeps following its projects", async () => {
    seed("manager");
    borrowedIronleaf();
    __setMutationResult("clients:updateCompany", { clientId: "c-made", key: "ironleaf farms ltd", name: "Ironleaf Farms Ltd", moved: 0 });
    await mount("ironleaf farms");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await expect.element(page.getByRole("dialog", { name: "Edit company" })).toBeVisible();
    await expect.poll(() => document.querySelector<HTMLInputElement>("#edit-company-year-end-month")?.value).toBe("December");
    expect(document.querySelector<HTMLInputElement>("#edit-company-year-end-day")!.value).toBe("31");
    expect(document.querySelector<HTMLInputElement>("#edit-company-industry")!.value).toBe("Manufacturing");
    expect(text(document.querySelector("[data-edit-company-year-end-helper]"))).toBe("From the newest project");
    expect(text(document.querySelector("[data-edit-company-industry-helper]"))).toBe("From the newest project");

    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Ironleaf Farms Ltd");
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company-save]")!);
    await expect.poll(() => __mutationCalls("clients:updateCompany").at(-1)).toEqual({
      key: "ironleaf farms",
      expectedName: "Ironleaf Farms",
      expectedClientId: null,
      expectedUpdatedAt: null,
      name: "Ironleaf Farms Ltd",
      website: "",
    });
  });

  it("a borrowed value the person changes is stored, and its hint goes; an unchanged one stays out", async () => {
    seed("manager");
    borrowedIronleaf();
    __setMutationResult("clients:updateCompany", { clientId: "c-made", key: "ironleaf farms", name: "Ironleaf Farms", moved: 0 });
    await mount("ironleaf farms");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await expect.element(page.getByRole("dialog", { name: "Edit company" })).toBeVisible();
    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end month" }));
    await userEvent.click(page.getByRole("option", { name: "June" }));
    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end day" }));
    await userEvent.click(page.getByRole("option", { name: "30", exact: true }));
    await expect.poll(() => text(document.querySelector("[data-edit-company-year-end-helper]"))).toBe(
      "New projects for this company start with it. Projects you already have keep their own."
    );
    expect(text(document.querySelector("[data-edit-company-industry-helper]"))).toBe("From the newest project");
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company-save]")!);
    await expect.poll(() => __mutationCalls("clients:updateCompany").at(-1)).toEqual({
      key: "ironleaf farms",
      expectedName: "Ironleaf Farms",
      expectedClientId: null,
      expectedUpdatedAt: null,
      name: "Ironleaf Farms",
      fiscalYearEndMonth: 6,
      fiscalYearEndDay: 30,
      website: "",
    });
  });

  it("shows the company's own industry even when no project uses it", async () => {
    seed("manager");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "alder research" }, companyPage("alder research", { industry: "quantum-optics" }));
    await mount("alder research");
    await expect.poll(() => text(document.querySelector("[data-company-industry]"))).toBe("Quantum optics");
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await expect.element(page.getByRole("dialog", { name: "Edit company" })).toBeVisible();
    await expect.poll(() => document.querySelector<HTMLInputElement>("#edit-company-industry")?.value).toBe("Quantum optics");
  });

  it("Edit company starts from the website, sends a changed one, and refuses one that is not a website", async () => {
    seed("manager");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
    }));
    __setMutationResult("clients:updateCompany", { clientId: "c3", key: "cedarline systems", name: "Cedarline Systems", moved: 0 });
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await expect.element(page.getByRole("dialog", { name: "Edit company" })).toBeVisible();
    const field = page.getByRole("textbox", { name: "Website" });
    await expect.element(field).toHaveValue("https://cedarline.ca");
    const save = () => document.querySelector<HTMLButtonElement>("[data-edit-company-save]")!;
    // The same address written another way is no change.
    await userEvent.fill(field, "Cedarline.ca/");
    await expect.poll(() => save().disabled).toBe(true);
    await userEvent.fill(field, "not a website");
    await userEvent.click(page.getByRole("textbox", { name: "Name" }));
    await expect.poll(() => text(document.querySelector("[data-company-website-error]"))).toBe("Enter a website like example.com.");
    expect(save().disabled).toBe(true);
    await userEvent.fill(field, "cedarline.ca:8080");
    await userEvent.click(page.getByRole("textbox", { name: "Name" }));
    await expect.poll(() => text(document.querySelector("[data-company-website-error]"))).toBe(
      "Enter the website without a port number, like example.com."
    );
    expect(save().disabled).toBe(true);
    await userEvent.fill(field, "cedarline.com");
    await expect.poll(() => save().disabled).toBe(false);
    await userEvent.click(save());
    await expect.poll(() => __mutationCalls("clients:updateCompany").at(-1)).toMatchObject({
      key: "cedarline systems",
      expectedClientId: "c3",
      expectedUpdatedAt: 1_000,
      website: "cedarline.com",
    });
  });

  it("emptying the website in Edit company sends an empty one, which removes it", async () => {
    seed("manager");
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems" }, companyPage("cedarline systems", {
      website: "https://cedarline.ca",
    }));
    __setMutationResult("clients:updateCompany", { clientId: "c3", key: "cedarline systems", name: "Cedarline Systems", moved: 0 });
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await userEvent.clear(page.getByRole("textbox", { name: "Website" }));
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-edit-company-save]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company-save]")!);
    await expect.poll(() => __mutationCalls("clients:updateCompany").at(-1)).toMatchObject({ website: "" });
  });

  it("shows the refusal of another company's name in the dialog", async () => {
    seed("manager");
    __setMutationError("clients:updateCompany", {
      data: { code: "CLIENT_EXISTS", message: "A company named Alder Research already exists. Merge them instead." },
    });
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await userEvent.fill(page.getByRole("textbox", { name: "Name" }), "Alder Research");
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company-save]")!);
    await expect.poll(() => text(document.querySelector("[data-edit-company-error]"))).toBe(
      "A company named Alder Research already exists. Merge them instead."
    );
    await expect.element(page.getByRole("dialog", { name: "Edit company" })).toBeVisible();
  });

  it("asks for both parts of a fiscal year end", async () => {
    seed("manager");
    await mount("ironleaf farms");
    await expect.poll(() => document.querySelector("[data-edit-company]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-company]")!);
    await userEvent.click(page.getByRole("combobox", { name: "Fiscal year end month" }));
    await userEvent.click(page.getByRole("option", { name: "June" }));
    await expect.poll(() => text(document.querySelector("[data-edit-company-year-end-helper]"))).toBe(
      "Pick both a month and a day, or leave both empty."
    );
    expect(document.querySelector<HTMLButtonElement>("[data-edit-company-save]")!.disabled).toBe(true);
  });
});
