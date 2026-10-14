import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import ProjectsPage from "./ProjectsPage.svelte";
import { __resetPage, __setPageUrl, page as appPage } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __callOrder,
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * The Projects page side panels (2026-10-14 amendment, "Edit details panel"
 * and "Select and bulk edit"; Paper W2, W3 and W4): edit one project from
 * its card menu, bulk edit a selection with a review step, and selection
 * hygiene when cards leave the visible set.
 */
const sonner = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Rendered text, with table cells and block lines kept apart. */
const shown = (node: Element | null | undefined) => ((node as HTMLElement | null)?.innerText ?? "").replace(/\s+/g, " ").trim();
const DASHES = /[\u2010-\u2015\u00b7]/;

const CLIENTS = [
  { key: "acuity insights", clientId: "c1", name: "Acuity Insights", projectCount: 4 },
  { key: "cedarline systems", clientId: "c3", name: "Cedarline Systems", projectCount: 6 },
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
  project("p4", { title: "Adaptive cold storage controls", projectNumber: "4", fiscalYearEnd: day("2026-09-30"), industry: "manufacturing", scienceCode: "2.03.01" }),
  project("p5", { title: "High-efficiency pump control", projectNumber: "5", fiscalYearEnd: day("2026-09-30"), industry: "manufacturing", scienceCode: "2.03.01" }),
  project("p6", { title: "Defrost cycle prediction", projectNumber: "6", fiscalYearEnd: day("2026-09-30"), industry: "manufacturing", ownerId: "u-2" }),
  project("p1", { title: "Evaporator coil frost sensing", projectNumber: "1", fiscalYearEnd: day("2025-03-31"), industry: "manufacturing" }),
  project("pa", { title: "Compressor vibration damping", projectNumber: "A" }),
];

/** The full project doc `projects.getProject` returns for p5. */
const P5_DOC = {
  _id: "p5",
  title: "High-efficiency pump control",
  sredTitle: "Variable-speed pumping under transient load",
  clientName: "Cedarline Systems",
  // UTC midnight, as the cards, the fiscal year groups and bulk edit read it.
  fiscalYearEnd: day("2026-09-30"),
  projectNumber: "5",
  industry: "manufacturing",
  scienceCode: "2.03.01",
  tagIds: ["t1"],
  createdBy: "u-1",
};

function detailsPanel(canEditDetails = true) {
  return {
    stage: "client_review",
    workflowVersion: 3,
    industry: "manufacturing",
    fiscalYearEnd: P5_DOC.fiscalYearEnd,
    scienceCode: "2.03.01",
    projectNumber: "5",
    owner: { userId: "u-1", label: "Jordan Ellis", initials: "JE", isYou: true },
    createdAt: day("2026-01-01"),
    editedAt: day("2026-09-16"),
    currentHandoff: null,
    permissions: { canEditDetails, canChangeStage: canEditDetails, canHandOff: canEditDetails },
  };
}

function seed(role = "manager") {
  __setQueryData("users:getCurrentUser", { _id: "u-1", role });
  __setQueryData("clients:listClients", { clients: CLIENTS, truncated: false });
  __setQueryData("projects:listIndustries", []);
  __setQueryData("clients:findSimilarClients", { exact: null, similar: [] });
  __setQueryData("projects:getProject", P5_DOC);
  __setQueryData("projects:getProjectDetailsPanel", detailsPanel());
  __setQueryData("tags:listTags", [
    { _id: "t1", name: "Controls" },
    { _id: "t2", name: "Returning client" },
  ]);
  __setPaginatedRows("dashboard:listCompanyProjects", CEDARLINE);
}

async function mount(url = "/projects?client=cedarline+systems") {
  __setPageUrl(url);
  await page.viewport(1440, 900);
  const screen = await render(ProjectsPage, { totalLabel: "13" });
  screen.container.style.cssText = "display:flex;height:900px;";
  return screen;
}

beforeEach(() => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  vi.clearAllMocks();
  seed();
});

const editPanel = () => document.querySelector<HTMLElement>('[data-testid="project-edit-panel"]');
const bulkPanel = () => document.querySelector<HTMLElement>('[data-testid="bulk-edit-panel"]');
const field = <T extends HTMLElement = HTMLInputElement>(name: string) =>
  editPanel()?.querySelector<T>(`[data-edit-field="${name}"]`) ?? null;
const saveButton = () => document.querySelector<HTMLButtonElement>("[data-edit-save]")!;

async function openEdit(projectId = "p5") {
  await expect.poll(() => document.querySelector(`[data-card-menu="${projectId}"]`)).not.toBeNull();
  await userEvent.click(document.querySelector<HTMLElement>(`[data-card-menu="${projectId}"]`)!);
  await expect.poll(() => document.querySelector('[data-card-menu-item="edit"]')).not.toBeNull();
  await userEvent.click(document.querySelector<HTMLElement>('[data-card-menu-item="edit"]')!);
  await settled(editPanel);
}

/**
 * Waits out the dialog's 300ms scale-in, so a picker opened from the panel
 * is not anchored to a field that is still growing.
 */
async function settled(panel: () => HTMLElement | null) {
  await expect.poll(() => panel()).not.toBeNull();
  await expect.poll(() => panel()!.getAnimations().length).toBe(0);
}

describe("Edit details panel (W2)", () => {
  it("opens from the card menu prefilled, with owner and stage read only", async () => {
    await mount();
    await openEdit();
    await expect.element(page.getByRole("dialog", { name: "Edit project #5" })).toBeVisible();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    expect(document.activeElement).toBe(field("title"));
    expect(field("sredTitle")?.value).toBe("Variable-speed pumping under transient load");
    expect(page.getByRole("combobox", { name: "Client" }).element()).toHaveProperty("value", "Cedarline Systems");
    expect(text(field<HTMLButtonElement>("fiscalYearEnd"))).toBe("Sep 30, 2026 FY 2026");
    expect(field("projectNumber")?.value).toBe("5");
    expect(editPanel()!.querySelector<HTMLInputElement>("#edit-project-industry")?.value).toBe("Manufacturing");
    expect(text(field<HTMLButtonElement>("scienceCode"))).toBe("2.03.01 Mechanical engineering");
    expect(text(editPanel()!.querySelector("[data-tag-chip]"))).toBe("Controls");
    expect(text(editPanel()!.querySelector("[data-edit-owner]"))).toBe("Owner Jordan Ellis (you)");
    expect(text(editPanel()!.querySelector("[data-edit-stage]"))).toBe("Stage Client review Changed inside the project");
    // Nothing changed yet.
    expect(saveButton().disabled).toBe(true);
    // Delete reuses the card menu's permission; the creator sees it.
    expect(editPanel()!.querySelector("[data-edit-delete]")).not.toBeNull();
    expect(text(editPanel())).not.toMatch(DASHES);
  });

  it("saves only the changed fields, in order, with one toast", async () => {
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(field("title")!, "Pump control under load");
    await userEvent.fill(field("projectNumber")!, "7");
    expect(saveButton().disabled).toBe(false);
    await userEvent.click(saveButton());

    await expect.poll(() => editPanel()).toBeNull();
    expect(__callOrder()).toEqual(["projects:updateProjectTitles", "projects:setProjectNumber"]);
    expect(__mutationCalls("projects:updateProjectTitles")).toEqual([{ projectId: "p5", title: "Pump control under load" }]);
    expect(__mutationCalls("projects:setProjectNumber")).toEqual([{ projectId: "p5", projectNumber: "7" }]);
    expect(sonner.success).toHaveBeenCalledTimes(1);
    expect(sonner.success).toHaveBeenCalledWith("Project details saved.");
  });

  it("shows a failed save under its field, keeps the edits, and does not repeat saved fields", async () => {
    __setMutationError(
      "projects:setProjectNumber",
      new ConvexError({ code: "INVALID_INPUT", message: "Project number 7 is already used in FY 2026." })
    );
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(field("title")!, "Pump control under load");
    await userEvent.fill(field("projectNumber")!, "7");
    await userEvent.click(saveButton());

    await expect.poll(() => text(document.querySelector('[data-edit-error="projectNumber"]'))).toBe(
      "Project number 7 is already used in FY 2026."
    );
    expect(editPanel()).not.toBeNull();
    expect(field("title")?.value).toBe("Pump control under load");
    expect(field("projectNumber")?.value).toBe("7");
    expect(sonner.success).not.toHaveBeenCalled();

    // Try again: the title was saved, so only the number is written.
    __setMutationResult("projects:setProjectNumber", null);
    await userEvent.fill(field("projectNumber")!, "8");
    await userEvent.click(saveButton());
    await expect.poll(() => editPanel()).toBeNull();
    expect(__mutationCalls("projects:updateProjectTitles")).toHaveLength(1);
    expect(__mutationCalls("projects:setProjectNumber")).toEqual([
      { projectId: "p5", projectNumber: "7" },
      { projectId: "p5", projectNumber: "8" },
    ]);
  });

  it("checks the project number and the client before writing anything", async () => {
    await mount();
    await openEdit();
    await expect.poll(() => field("projectNumber")?.value).toBe("5");
    await userEvent.fill(field("projectNumber")!, "99");
    await userEvent.fill(page.getByRole("combobox", { name: "Client" }), "Nobody Ltd");
    await userEvent.click(saveButton());
    await expect.poll(() => text(document.querySelector('[data-edit-error="projectNumber"]'))).toBe(
      "Use 1 to 20, a letter A to Z, or both, like 2A."
    );
    expect(text(document.querySelector('[data-edit-error="clientName"]'))).toBe(
      "Pick a client from the list, or add it as a new client."
    );
    expect(__callOrder()).toEqual([]);
  });

  it("is read only, with the reason, for someone who may not edit the details", async () => {
    __setQueryData("projects:getProjectDetailsPanel", detailsPanel(false));
    await mount();
    await openEdit();
    await expect.poll(() => text(document.querySelector("[data-edit-read-only]"))).toBe(
      "You can view these details but not change them. Only the owner, someone with open work on this project, a manager or an admin can edit them."
    );
    expect(document.querySelector("[data-edit-form]")).toBeNull();
    expect(document.querySelector("[data-edit-save]")).toBeNull();
    expect(text(document.querySelector('[data-edit-readonly="title"]'))).toBe("Title High-efficiency pump control");
    expect(text(document.querySelector('[data-edit-readonly="tagIds"]'))).toBe("Tags Controls");
  });

  it("turns read only when the server refuses, keeping what was typed", async () => {
    __setMutationError(
      "projects:updateProjectTitles",
      new ConvexError({ code: "NOT_AUTHORIZED", message: "You cannot edit this project's details." })
    );
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(field("title")!, "Typed title");
    await userEvent.click(saveButton());
    await expect.poll(() => document.querySelector("[data-edit-read-only]")).not.toBeNull();
    expect(text(document.querySelector('[data-edit-readonly="title"]'))).toBe("Title Typed title");
    expect(editPanel()).not.toBeNull();
  });

  it("writes the fiscal year end as UTC midnight and reads it back in UTC", async () => {
    // Regression: the panel read and wrote local time while the cards and
    // bulk edit use UTC date parts, so a date could shift a day.
    await mount();
    await openEdit();
    await expect.poll(() => text(field<HTMLButtonElement>("fiscalYearEnd"))).toBe("Sep 30, 2026 FY 2026");
    await userEvent.click(field<HTMLButtonElement>("fiscalYearEnd")!);
    await userEvent.click(page.getByRole("button", { name: "Mar 31" }));
    await expect.poll(() => text(field<HTMLButtonElement>("fiscalYearEnd"))).toBe("Mar 31, 2026 FY 2026");
    await userEvent.click(saveButton());
    await expect.poll(() => __mutationCalls("projects:updateProjectFiscalYear")).toEqual([
      { projectId: "p5", fiscalYearEnd: Date.UTC(2026, 2, 31) },
    ]);
  });

  it("saves a client typed in another case under the listed client's own name", async () => {
    // Regression: "cedarline systems" was stored lowercase and relabelled the company row.
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(page.getByRole("combobox", { name: "Client" }), "acuity insights");
    await userEvent.click(saveButton());
    await expect.poll(() => __mutationCalls("projects:updateProjectClientName")).toEqual([
      { projectId: "p5", clientName: "Acuity Insights" },
    ]);
  });

  it("shows and saves the name New client created, even when it differs from the typed text", async () => {
    __setMutationResult("clients:createClient", { clientId: "c9", key: "nobody limited", name: "Nobody Limited" });
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    const client = page.getByRole("combobox", { name: "Client" });
    await userEvent.fill(client, "Nobody Ltd");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);
    await expect.element(page.getByRole("dialog", { name: "New client" })).toBeVisible();
    await expect.poll(() => document.querySelector<HTMLInputElement>("#new-client-name")?.value).toBe("Nobody Ltd");
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-create-client]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-create-client]")!);
    await expect.poll(() => (client.element() as HTMLInputElement).value).toBe("Nobody Limited");
    await userEvent.click(saveButton());
    await expect.poll(() => __mutationCalls("projects:updateProjectClientName")).toEqual([
      { projectId: "p5", clientName: "Nobody Limited" },
    ]);
  });

  it("shows the look-alike client picked with Use that client", async () => {
    __setQueryDataForArgs("clients:findSimilarClients", { name: "Acuity Insights Ltd" }, {
      exact: null,
      similar: [{ key: "acuity insights", name: "Acuity Insights", projectCount: 4 }],
    });
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    const client = page.getByRole("combobox", { name: "Client" });
    await userEvent.fill(client, "Acuity Insights Ltd");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);
    await userEvent.click(page.getByRole("button", { name: "Use that client" }));
    await expect.poll(() => (client.element() as HTMLInputElement).value).toBe("Acuity Insights");
    await userEvent.click(saveButton());
    await expect.poll(() => __mutationCalls("projects:updateProjectClientName")).toEqual([
      { projectId: "p5", clientName: "Acuity Insights" },
    ]);
  });

  it("keeps unsaved edits on Escape and says how to leave; Cancel discards", async () => {
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(field("title")!, "Typed title");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => text(document.querySelector("[data-edit-escape-note]"))).toBe(
      "Save your changes, or use Cancel to discard them."
    );
    expect(editPanel()).not.toBeNull();
    expect(field("title")?.value).toBe("Typed title");
    await userEvent.click(document.querySelector<HTMLElement>("[data-edit-cancel]")!);
    await expect.poll(() => editPanel()).toBeNull();
    expect(__callOrder()).toEqual([]);
  });

  it("cannot be closed while a save is running", async () => {
    let release: (value: null) => void = () => {};
    __setMutationResult("projects:updateProjectTitles", new Promise<null>((resolve) => (release = resolve)));
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(field("title")!, "Typed title");
    await userEvent.click(saveButton());
    await expect.poll(() => text(saveButton())).toBe("Saving...");
    await userEvent.keyboard("{Escape}");
    expect(editPanel()).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-edit-cancel]")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>("[data-edit-close]")?.disabled).toBe(true);
    release(null);
    await expect.poll(() => editPanel()).toBeNull();
  });

  it("closes on Escape and returns focus to the card menu trigger", async () => {
    await mount();
    await openEdit();
    await expect.poll(() => document.activeElement).toBe(field("title"));
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => editPanel()).toBeNull();
    await expect.poll(() => document.activeElement?.getAttribute("data-card-menu")).toBe("p5");
  });

  it("hands Delete project to the card menu's Delete dialog", async () => {
    await mount();
    await openEdit();
    await expect.poll(() => editPanel()?.querySelector("[data-edit-delete]")).not.toBeNull();
    await userEvent.click(editPanel()!.querySelector<HTMLElement>("[data-edit-delete]")!);
    await expect.element(page.getByRole("dialog", { name: "Delete High-efficiency pump control?" })).toBeVisible();
    await expect.poll(() => editPanel()).toBeNull();
  });
});

async function selectCards(...titles: string[]) {
  await expect.poll(() => document.querySelector("[data-select-start]")).not.toBeNull();
  await userEvent.click(document.querySelector<HTMLElement>("[data-select-start]")!);
  for (const title of titles) await userEvent.click(page.getByRole("checkbox", { name: title }));
}

async function openBulk(...titles: string[]) {
  await selectCards(...titles);
  await userEvent.click(document.querySelector<HTMLElement>("[data-selection-edit]")!);
  await settled(bulkPanel);
}

const now = (name: string) => text(bulkPanel()?.querySelector(`[data-bulk-now="${name}"]`));
const segment = (group: string, label: string) =>
  page.getByRole("radiogroup", { name: group }).getByRole("radio", { name: label });

describe("Bulk edit panel (W3, W4)", () => {
  it("starts every field at No change and sums up what the selection holds now", async () => {
    await mount();
    await openBulk("High-efficiency pump control", "Evaporator coil frost sensing", "Compressor vibration damping");
    await expect.element(page.getByRole("dialog", { name: "Edit 3 projects" })).toBeVisible();
    expect(text(bulkPanel())).toContain("Only the fields you change are applied.");
    expect(now("clientName")).toBe("Now: Cedarline Systems");
    expect(now("fiscalYearEnd")).toBe(
      "Now: FY 2026 ended Sep 30, 2026 (1), FY 2025 ended Mar 31, 2025 (1), not set (1)"
    );
    expect(now("industry")).toBe("Now: Manufacturing (2), not set (1)");
    expect(now("scienceCode")).toBe("Now: not set (2), 2.03.01 Mechanical engineering (1)");
    expect(page.getByRole("combobox", { name: "Client" }).element()).toHaveProperty("placeholder", "No change");
    expect(text(document.querySelector("[data-bulk-count]"))).toBe("No changes yet");
    expect(document.querySelector<HTMLButtonElement>("[data-bulk-review]")!.disabled).toBe(true);
    for (const group of ["Fiscal year end", "Industry", "Science code"]) {
      await expect.element(segment(group, "No change")).toHaveAttribute("aria-checked", "true");
    }
    expect(text(bulkPanel())).not.toMatch(DASHES);
    expect(text(bulkPanel()).toLowerCase()).not.toContain("undo");
  });

  it("switches fields with the segmented control and counts the changed fields", async () => {
    await mount();
    await openBulk("High-efficiency pump control", "Evaporator coil frost sensing");
    await userEvent.click(segment("Fiscal year end", "Set date"));
    await expect.poll(() => bulkPanel()?.querySelector("[data-bulk-date]")).not.toBeNull();
    // Set date without a date is not a change yet.
    expect(text(document.querySelector("[data-bulk-count]"))).toBe("No changes yet");
    await userEvent.click(segment("Fiscal year end", "Clear"));
    expect(bulkPanel()?.querySelector("[data-bulk-date]")).toBeNull();
    await userEvent.click(segment("Industry", "Clear"));
    await expect.poll(() => text(document.querySelector("[data-bulk-count]"))).toBe("2 fields changed");
    expect(document.querySelector<HTMLButtonElement>("[data-bulk-review]")!.disabled).toBe(false);
    await userEvent.click(segment("Industry", "No change"));
    await expect.poll(() => text(document.querySelector("[data-bulk-count]"))).toBe("1 field changed");
  });

  it("reviews each project's current and new values, No change where one already matches, then applies once", async () => {
    __setMutationResult("projects:bulkUpdateProjects", { updated: 2, skipped: 0 });
    await mount();
    await openBulk("High-efficiency pump control", "Evaporator coil frost sensing", "Compressor vibration damping");
    await userEvent.click(segment("Fiscal year end", "Clear"));
    await userEvent.click(document.querySelector<HTMLElement>("[data-bulk-review]")!);

    await expect.element(page.getByRole("dialog", { name: "Review changes to 3 projects" })).toBeVisible();
    expect(document.querySelector('[data-projects-panel="center"]')).not.toBeNull();
    expect(text(document.querySelector("[data-bulk-summary]"))).toBe(
      "Fiscal year end cleared. 2 projects will change, 1 already matches."
    );
    const rows = [...document.querySelectorAll("[data-bulk-review-row]")].map((row) => shown(row));
    expect(rows).toEqual([
      "#5 High-efficiency pump control FY 2026, Sep 30, 2026 Not set",
      "#1 Evaporator coil frost sensing FY 2025, Mar 31, 2025 Not set",
      "#A Compressor vibration damping Not set No change",
    ]);
    expect(document.querySelector("[data-bulk-skip-note]")).toBeNull();
    expect(text(bulkPanel()).toLowerCase()).not.toContain("undo");
    expect(text(bulkPanel())).not.toMatch(DASHES);

    // Back keeps the edits.
    await userEvent.click(document.querySelector<HTMLElement>("[data-bulk-back]")!);
    await expect.element(segment("Fiscal year end", "Clear")).toHaveAttribute("aria-checked", "true");
    await userEvent.click(document.querySelector<HTMLElement>("[data-bulk-review]")!);
    await userEvent.click(page.getByRole("button", { name: "Apply to 3 projects" }));

    await expect.poll(() => bulkPanel()).toBeNull();
    expect(__mutationCalls("projects:bulkUpdateProjects")).toEqual([
      { projectIds: ["p5", "p1", "pa"], fiscalYearEnd: null },
    ]);
    expect(sonner.success).toHaveBeenCalledWith("Updated 2 projects.");
    // Out of select mode, on the same client.
    await expect.poll(() => document.querySelector("[data-selection-bar]")).toBeNull();
    expect(appPage.url.searchParams.get("client")).toBe("cedarline systems");
  });

  it("sets a date and a client, with one sentence each", async () => {
    await mount();
    await openBulk("High-efficiency pump control", "Evaporator coil frost sensing");
    await userEvent.fill(page.getByRole("combobox", { name: "Client" }), "Acuity Insights");
    await userEvent.click(segment("Fiscal year end", "Set date"));
    await userEvent.click(bulkPanel()!.querySelector<HTMLElement>("[data-bulk-date]")!);
    await userEvent.click(page.getByRole("button", { name: "Sep 30" }));
    await expect.poll(() => text(document.querySelector("[data-bulk-count]"))).toBe("2 fields changed");
    await userEvent.click(document.querySelector<HTMLElement>("[data-bulk-review]")!);
    const year = new Date().getFullYear();
    await expect.poll(() => text(document.querySelector("[data-bulk-summary]"))).toContain(
      `Client set to Acuity Insights. Fiscal year end set to Sep 30, ${year}.`
    );
    // Two changed fields: each cell names its field.
    expect(shown(document.querySelector('[data-bulk-review-row="p1"] [data-bulk-after-cell]'))).toBe(
      `Client: Acuity Insights Fiscal year end: FY ${year}, Sep 30, ${year}`
    );
  });

  it("tells a writer which projects are not theirs, applies once, and says what was skipped", async () => {
    seed("writer");
    __setMutationResult("projects:bulkUpdateProjects", { updated: 2, skipped: 1 });
    await mount();
    await openBulk("High-efficiency pump control", "Defrost cycle prediction", "Evaporator coil frost sensing");
    await userEvent.click(segment("Industry", "Clear"));
    await userEvent.click(document.querySelector<HTMLElement>("[data-bulk-review]")!);
    await expect.poll(() => text(document.querySelector("[data-bulk-skip-note]"))).toBe(
      "You can only change projects you own. 1 of these is not yours and will be skipped."
    );
    expect(text(document.querySelector('[data-bulk-review-row="p6"] [data-bulk-after-cell]'))).toBe("Skipped, not yours");
    await userEvent.click(page.getByRole("button", { name: "Apply to 3 projects" }));
    await expect.poll(() => __mutationCalls("projects:bulkUpdateProjects")).toEqual([
      { projectIds: ["p5", "p6", "p1"], industry: null },
    ]);
    await expect.poll(() => sonner.success.mock.calls).toEqual([["Updated 2 projects, skipped 1 you don't own."]]);
  });

  it("keeps the panel and the edits when the apply fails", async () => {
    __setMutationError("projects:bulkUpdateProjects", new ConvexError({ code: "INVALID_INPUT", message: "Select a valid CRA science code" }));
    await mount();
    await openBulk("High-efficiency pump control");
    await userEvent.click(segment("Science code", "Clear"));
    await userEvent.click(document.querySelector<HTMLElement>("[data-bulk-review]")!);
    await userEvent.click(page.getByRole("button", { name: "Apply to 1 project" }));
    await expect.poll(() => text(document.querySelector("[data-bulk-apply-error]"))).toBe("Select a valid CRA science code");
    expect(bulkPanel()).not.toBeNull();
    expect(document.querySelector("[data-selection-bar]")).not.toBeNull();
  });

  it("keeps bulk changes on Escape, and blocks closing while applying", async () => {
    let release: (value: { updated: number; skipped: number }) => void = () => {};
    __setMutationResult(
      "projects:bulkUpdateProjects",
      new Promise((resolve) => (release = resolve))
    );
    await mount();
    await openBulk("High-efficiency pump control");
    await userEvent.click(segment("Industry", "Clear"));
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => text(document.querySelector("[data-bulk-escape-note]"))).toBe(
      "Review the changes, or use Cancel to discard them."
    );
    expect(bulkPanel()).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-bulk-review]")!);
    await userEvent.click(page.getByRole("button", { name: "Apply to 1 project" }));
    await expect.poll(() => text(document.querySelector("[data-bulk-apply]"))).toBe("Applying...");
    await userEvent.keyboard("{Escape}");
    expect(bulkPanel()).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-bulk-back]")?.disabled).toBe(true);
    release({ updated: 1, skipped: 0 });
    await expect.poll(() => bulkPanel()).toBeNull();
  });

  it("shows the client New client created in the bulk Client field", async () => {
    __setMutationResult("clients:createClient", { clientId: "c9", key: "nobody limited", name: "Nobody Limited" });
    await mount();
    await openBulk("High-efficiency pump control");
    const client = page.getByRole("combobox", { name: "Client" });
    await userEvent.fill(client, "Nobody Ltd");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-create-client]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-create-client]")!);
    await expect.poll(() => (client.element() as HTMLInputElement).value).toBe("Nobody Limited");
    await expect.poll(() => text(document.querySelector("[data-bulk-count]"))).toBe("1 field changed");
  });

  it("closes on Escape without leaving select mode", async () => {
    await mount();
    await openBulk("High-efficiency pump control");
    await expect.poll(() => bulkPanel()?.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => bulkPanel()).toBeNull();
    expect(document.querySelector("[data-selection-bar]")).not.toBeNull();
    expect(text(document.querySelector("[data-selection-count]"))).toBe("1 selected");
    await expect.poll(() => document.activeElement?.hasAttribute("data-selection-edit")).toBe(true);
  });
});

describe("Selection hygiene", () => {
  it("drops a selected project that leaves the visible set, so bulk edit never touches it", async () => {
    await mount();
    await selectCards("High-efficiency pump control", "Defrost cycle prediction");
    expect(text(document.querySelector("[data-selection-count]"))).toBe("2 selected");
    // Defrost cycle prediction moves to another client.
    __setPaginatedRows(
      "dashboard:listCompanyProjects",
      CEDARLINE.filter((row) => row._id !== "p6")
    );
    await expect.poll(() => text(document.querySelector("[data-selection-count]"))).toBe("1 selected");
    await userEvent.click(document.querySelector<HTMLElement>("[data-selection-edit]")!);
    await expect.element(page.getByRole("dialog", { name: "Edit 1 project" })).toBeVisible();
  });

  it("keeps a search's selection to its results as they change", async () => {
    __setPaginatedRows("dashboard:searchProjects", CEDARLINE.slice(0, 2));
    await mount();
    await userEvent.fill(page.getByRole("searchbox", { name: "Search Cedarline Systems" }), "control");
    await expect.poll(() => text(document.querySelector("#projects-search-results"))).toBe("2 projects match");
    await selectCards("Adaptive cold storage controls", "High-efficiency pump control");
    expect(text(document.querySelector("[data-selection-count]"))).toBe("2 selected");
    __setPaginatedRows("dashboard:searchProjects", CEDARLINE.slice(1, 2));
    await expect.poll(() => text(document.querySelector("[data-selection-count]"))).toBe("1 selected");
  });
});

describe("Merge result", () => {
  it("counts the merged clients from before the list updates, and puts focus on the kept client", async () => {
    const three = [
      { key: "acuity insights", clientId: "c1", name: "Acuity Insights", projectCount: 4 },
      { key: "acuity insights inc", clientId: null, name: "Acuity Insights Inc", projectCount: 2 },
      { key: "acuity inc", clientId: null, name: "Acuity Inc", projectCount: 1 },
      { key: "cedarline systems", clientId: "c3", name: "Cedarline Systems", projectCount: 6 },
    ];
    __setQueryData("clients:listClients", { clients: three, truncated: false });
    __setQueryData("clients:previewClientMerge", {
      projectCount: 7,
      movedCount: 3,
      tooMany: false,
      keptName: "Acuity Insights",
      keptKey: "acuity insights",
      nameConflict: null,
      numberCollisions: [],
    });
    let release: (value: unknown) => void = () => {};
    __setMutationResult("clients:mergeClients", new Promise((resolve) => (release = resolve)));
    await mount("/projects");
    await expect.poll(() => document.querySelector("[data-start-merge]")).not.toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>("[data-start-merge]")!);
    for (const name of [/^Acuity Insights 4$/, /^Acuity Insights Inc 2$/, /^Acuity Inc 1$/]) {
      await userEvent.click(page.getByRole("checkbox", { name }));
    }
    await userEvent.click(document.querySelector<HTMLElement>("[data-merge-open]")!);
    await expect.element(page.getByRole("dialog", { name: "Merge 3 clients" })).toBeVisible();
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-confirm-merge]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-confirm-merge]")!);

    // The list updates before the mutation's answer arrives.
    __setQueryData("clients:listClients", { clients: [three[0], three[3]], truncated: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release({ moved: 3, keptKey: "acuity insights", keptName: "Acuity Insights", clientId: "c1" });

    await expect.poll(() => sonner.success.mock.calls).toEqual([["Merged 3 clients into Acuity Insights."]]);
    await expect.poll(() => appPage.url.searchParams.get("client")).toBe("acuity insights");
    await expect.poll(() => document.activeElement?.getAttribute("data-client-row")).toBe("acuity insights");
  });
});
