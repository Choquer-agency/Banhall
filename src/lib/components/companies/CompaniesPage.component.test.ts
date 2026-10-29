import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import { toast } from "svelte-sonner";
import CompaniesPage from "./CompaniesPage.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetPage, __setPageUrl, page as appPage } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
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
    name: client.name,
    projectCount: client.projectCount,
    ...("fiscalYearEndMonth" in client ? { fiscalYearEndMonth: client.fiscalYearEndMonth, fiscalYearEndDay: client.fiscalYearEndDay } : {}),
    ...("industry" in client ? { industry: client.industry } : {}),
    mergedNote: null,
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

  it("Search companies filters the table, ignoring case and accents", async () => {
    seed("consultant");
    await mount(null);
    await expect.poll(() => tableRows().length).toBe(3);
    const search = page.getByRole("searchbox", { name: "Search companies" });
    await userEvent.fill(search, "CEDAR");
    await expect.poll(() => tableRows().map((row) => row.dataset.companyRow)).toEqual(["cedarline systems"]);
    await userEvent.fill(search, "nobody");
    await expect.poll(() => text(document.querySelector("[data-companies-no-match]"))).toBe('No company matches "nobody".');
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

  it("marks the open company, and a row click opens its page in place", async () => {
    seed("consultant");
    await mount("cedarline systems");
    await expect.poll(() => sidebar()?.querySelector('[data-client-row="cedarline systems"]')?.getAttribute("aria-current")).toBe("page");
    expect(sidebar()!.querySelector('[data-companies-sidebar="all"]')!.getAttribute("aria-current")).toBeNull();
    await userEvent.click(sidebar()!.querySelector<HTMLElement>('[data-client-row="alder research"]')!);
    await expect.poll(() => __navigationCalls.at(-1)?.url).toBe("/companies/alder%20research");
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

describe("a company's page", () => {
  it("names the company with its project count, New project for it, the facts row and the Projects tab", async () => {
    seed("consultant");
    await mount("cedarline systems");
    await expect.poll(() => text(barTitle())).toBe("Cedarline Systems");
    expect(text(barCount())).toBe("10 projects");
    const newProject = document.querySelector<HTMLAnchorElement>("[data-top-bar-primary]")!;
    expect(text(newProject)).toBe("New project");
    expect(newProject.getAttribute("href")).toBe("/project/new?client=Cedarline+Systems");
    expect(getComputedStyle(newProject).display).not.toBe("none");
    const facts = [...document.querySelectorAll("[data-company-fact]")].map((node) => text(node));
    expect(facts).toEqual(["Fiscal year ends September 30", "Industry Manufacturing", "Projects 10"]);
    // The fiscal year sections and cards of the Projects page's company view.
    await expect.poll(() => document.querySelectorAll("[data-fy-group]").length).toBe(1);
    expect(text(document.querySelector("[data-fy-header]"))).toContain("FY 2026");
    expect(document.querySelectorAll("[data-fy-group] li")).toHaveLength(2);
    // The listing has no header or search of its own on this page.
    expect(document.querySelector("[data-client-header]")).toBeNull();
    expect(document.querySelector("[data-client-search]")).toBeNull();
    const tabs = [...document.querySelectorAll('[data-company-tabs] [role="tab"]')].map((node) => [text(node), node.getAttribute("aria-selected")]);
    expect(tabs).toEqual([["Projects", "true"], ["Files", "false"]]);
  });

  it("says Not set for a missing fiscal year end or industry", async () => {
    seed("consultant");
    __setPaginatedRows("dashboard:listCompanyProjects", []);
    await mount("ironleaf farms");
    await expect.poll(() => text(barTitle())).toBe("Ironleaf Farms");
    expect([...document.querySelectorAll("[data-company-fact] dd")].map((node) => text(node))).toEqual(["Not set", "Not set", "0"]);
    expect(text(barCount())).toBe("0 projects");
  });

  it("an empty company says so (Paper Z9a) with New project for it", async () => {
    seed("consultant");
    __setPaginatedRows("dashboard:listCompanyProjects", []);
    await mount("ironleaf farms");
    await expect.poll(() => document.querySelector("[data-client-empty]")).not.toBeNull();
    expect(text(document.querySelector("[data-client-empty]"))).toBe(
      "No projects for Ironleaf Farms yet Start a project and it will show up here, grouped by fiscal year. New project for Ironleaf Farms"
    );
    expect(document.querySelector("[data-client-new-project]")!.getAttribute("href")).toBe("/project/new?client=Ironleaf+Farms");
  });

  it("the tabs move with the arrow keys and Files shows the company's files", async () => {
    seed("consultant");
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector('[data-company-tab="projects"]')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-company-tab="projects"]')!.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => document.activeElement?.getAttribute("data-company-tab")).toBe("files");
    expect(document.querySelector('[data-company-tab="files"]')!.getAttribute("aria-selected")).toBe("true");
    await expect.poll(() => document.querySelector<HTMLElement>("[data-company-files-panel]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-company-projects-panel]")?.hidden).toBe(true);
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => document.activeElement?.getAttribute("data-company-tab")).toBe("projects");
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
    expect(text(barTitle())).toBe("Companies");
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
    __setQueryDataForArgs("clients:getCompanyPage", { key: "cedarline systems", mergedFrom: "cedarline systems inc" }, companyPage("cedarline systems", {
      mergedNote: { noteId: "t-1", fromName: "Cedarline Systems Inc", mergedAt: Date.parse("2026-10-03T15:00:00Z"), projectCount: 2 },
    }));
    await screen.rerender({ companyKey: "cedarline systems" });
    await expect.poll(() => text(document.querySelector("[data-merged-note]"))).toBe(
      "Cedarline Systems Inc was merged into Cedarline Systems on October 3, 2026. Its 2 projects are here now."
    );
    await userEvent.click(page.getByRole("button", { name: "Close this note" }));
    await expect.poll(() => document.querySelector("[data-merged-note]")).toBeNull();
    expect(appPage.url.searchParams.get("merged")).toBeNull();
    // Closed stays closed: the same old link again shows no note.
    __setPageUrl("/companies/cedarline%20systems?merged=cedarline+systems+inc");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-merged-note]")).toBeNull();
  });

  it("holds its place while it loads: the bar's title block and the company's skeleton", async () => {
    __setQueryData("users:getCurrentUser", USERS.consultant);
    __setQueryData("clients:listClients", { clients: CLIENTS, truncated: false });
    await mount("cedarline systems");
    await expect.poll(() => document.querySelector('[data-panel-skeleton="company"]')).not.toBeNull();
    expect(document.querySelector("[data-page-title-pending]")).not.toBeNull();
    expect(document.querySelector("[data-page-title]")).toBeNull();
  });
});

describe("Edit company (Managers and Admins)", () => {
  it("a Consultant sees no Edit company and no merge", async () => {
    seed("consultant");
    await mount("cedarline systems");
    await expect.poll(() => text(barTitle())).toBe("Cedarline Systems");
    expect(document.querySelector("[data-edit-company]")).toBeNull();
    expect(sidebar()!.querySelector("[data-start-merge]")).toBeNull();
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
    // On the right of the facts row, a secondary bar button.
    expect(button.className).toContain("border-line");
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
        name: "Cedarline Systems",
        fiscalYearEndMonth: 12,
        fiscalYearEndDay: 31,
        industry: "manufacturing",
      },
    ]);
    await expect.poll(() => document.querySelector('[data-testid="edit-company-dialog"]')).toBeNull();
    // The key did not change, so the page stays.
    expect(__navigationCalls).toEqual([]);
  });

  it("a rename says every project takes the new name, and the page moves to the new key", async () => {
    seed("admin");
    __setMutationResult("clients:updateCompany", { clientId: "c3", key: "cedarline robotics", name: "Cedarline Robotics", moved: 10 });
    await mount("cedarline systems");
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
