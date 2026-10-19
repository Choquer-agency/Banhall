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
 * The Projects page dialogs (Paper Z7m to Z7p, 2026-10-19; amending the
 * 2026-10-14 "Edit details panel" and "Select and bulk edit"): edit one
 * project from its card menu, bulk edit a selection straight from "No
 * change", and selection hygiene when cards leave the visible set.
 */
const sonner = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast: sonner }));

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
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

describe("Edit details dialog (Z7o)", () => {
  it("opens from the card menu prefilled, titled Edit details, with no owner, stage or Delete", async () => {
    await mount();
    await openEdit();
    await expect.element(page.getByRole("dialog", { name: "Edit details" })).toBeVisible();
    expect(editPanel()!.hasAttribute("data-form-dialog")).toBe(true);
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    expect(document.activeElement).toBe(field("title"));
    expect(field("sredTitle")?.value).toBe("Variable-speed pumping under transient load");
    expect(page.getByRole("combobox", { name: "Company" }).element()).toHaveProperty("value", "Cedarline Systems");
    expect(text(field<HTMLButtonElement>("fiscalYearEnd"))).toBe("September 30, 2026 FY 2026");
    expect(field("projectNumber")?.value).toBe("5");
    expect(editPanel()!.querySelector<HTMLInputElement>("#edit-project-industry")?.value).toBe("Manufacturing");
    expect(text(field<HTMLButtonElement>("scienceCode"))).toBe("2.03.01 Mechanical engineering");
    expect(text(editPanel()!.querySelector("[data-tag-chip]"))).toBe("Controls");
    expect(text(editPanel())).not.toContain("Owner");
    expect(text(editPanel())).not.toContain("Client review");
    // Delete stays in the card menu.
    expect(editPanel()!.querySelector("[data-edit-delete]")).toBeNull();
    // Nothing changed yet; Cancel and Save sit together on the right.
    expect(saveButton().disabled).toBe(true);
    expect([...editPanel()!.querySelectorAll("[data-form-dialog-footer] button")].map((node) => text(node))).toEqual([
      "Cancel",
      "Save changes",
    ]);
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

  it("writes the client picked when Save was clicked, with every field read only while saving", async () => {
    let release: (value: null) => void = () => {};
    __setMutationResult("projects:updateProjectTitles", new Promise((resolve) => (release = resolve)));
    __setMutationResult("projects:updateProjectClientName", null);
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(field("title")!, "Pump control under load");
    const client = page.getByRole("combobox", { name: "Company" });
    await userEvent.fill(client, "acuity insights");
    await userEvent.click(saveButton());
    await expect.poll(() => text(saveButton())).toBe("Saving...");

    // The title write is still running: nothing in the form can change.
    const input = client.element() as HTMLInputElement;
    const disabled = (node: Element | null | undefined) => node?.matches(":disabled") ?? false;
    expect(disabled(input)).toBe(true);
    expect(disabled(field("title"))).toBe(true);
    expect(disabled(field("sredTitle"))).toBe(true);
    expect(disabled(field("projectNumber"))).toBe(true);
    expect(disabled(field("fiscalYearEnd"))).toBe(true);
    expect(disabled(field("scienceCode"))).toBe(true);
    expect(disabled(editPanel()?.querySelector("#edit-project-industry"))).toBe(true);
    expect([...(field<HTMLElement>("tagIds")?.querySelectorAll("button") ?? [])].every(disabled)).toBe(true);
    // Even a change that slips through lands after the values were read.
    input.value = "Cedarline Systems";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    release(null);
    await expect.poll(() => editPanel()).toBeNull();
    expect(__mutationCalls("projects:updateProjectClientName")).toEqual([
      { projectId: "p5", clientName: "Acuity Insights" },
    ]);
  });

  it("checks the project number and the client before writing anything", async () => {
    await mount();
    await openEdit();
    await expect.poll(() => field("projectNumber")?.value).toBe("5");
    await userEvent.fill(field("projectNumber")!, "99");
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "Nobody Ltd");
    await userEvent.click(saveButton());
    await expect.poll(() => text(document.querySelector('[data-edit-error="projectNumber"]'))).toBe(
      "Use 1 to 20, a letter A to Z, or both, like 2A."
    );
    expect(text(document.querySelector('[data-edit-error="clientName"]'))).toBe(
      "Pick a company from the list, or add it as a new company."
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
    await expect.poll(() => text(field<HTMLButtonElement>("fiscalYearEnd"))).toBe("September 30, 2026 FY 2026");
    await userEvent.click(field<HTMLButtonElement>("fiscalYearEnd")!);
    await userEvent.click(page.getByRole("button", { name: "Mar 31" }));
    await expect.poll(() => text(field<HTMLButtonElement>("fiscalYearEnd"))).toBe("March 31, 2026 FY 2026");
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
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "acuity insights");
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
    const client = page.getByRole("combobox", { name: "Company" });
    await userEvent.fill(client, "Nobody Ltd");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);
    await expect.element(page.getByRole("dialog", { name: "New company" })).toBeVisible();
    await expect.poll(() => document.querySelector<HTMLInputElement>("#new-client-name")?.value).toBe("Nobody Ltd");
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-create-client]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-create-client]")!);
    await expect.poll(() => (client.element() as HTMLInputElement).value).toBe("Nobody Limited");
    await userEvent.click(saveButton());
    await expect.poll(() => __mutationCalls("projects:updateProjectClientName")).toEqual([
      { projectId: "p5", clientName: "Nobody Limited" },
    ]);
  });

  it("shows the look-alike client picked with Use that company", async () => {
    __setQueryDataForArgs("clients:findSimilarClients", { name: "Acuity Insights Ltd" }, {
      exact: null,
      similar: [{ key: "acuity insights", name: "Acuity Insights", projectCount: 4 }],
    });
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    const client = page.getByRole("combobox", { name: "Company" });
    await userEvent.fill(client, "Acuity Insights Ltd");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);
    await userEvent.click(page.getByRole("button", { name: "Use that company" }));
    await expect.poll(() => (client.element() as HTMLInputElement).value).toBe("Acuity Insights");
    await userEvent.click(saveButton());
    await expect.poll(() => __mutationCalls("projects:updateProjectClientName")).toEqual([
      { projectId: "p5", clientName: "Acuity Insights" },
    ]);
  });

  it("never fills an existing project's fiscal year end or industry from the client New client makes", async () => {
    __setQueryData("projects:getProject", { ...P5_DOC, fiscalYearEnd: undefined, industry: undefined });
    __setMutationResult("clients:createClient", { clientId: "c9", key: "nobody limited", name: "Nobody Limited" });
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "Nobody Limited");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);
    await expect.element(page.getByRole("dialog", { name: "New company" })).toBeVisible();
    await userEvent.click(document.querySelector<HTMLElement>("#new-client-year-end-month")!);
    await userEvent.click(page.getByRole("option", { name: "September", exact: true }));
    await userEvent.click(document.querySelector<HTMLElement>("#new-client-year-end-day")!);
    await userEvent.click(page.getByRole("option", { name: "30", exact: true }));
    await userEvent.click(document.querySelector<HTMLElement>("#new-client-industry")!);
    await userEvent.click(page.getByRole("option", { name: "Manufacturing", exact: true }));
    await userEvent.click(document.querySelector<HTMLElement>("[data-create-client]")!);

    await expect.poll(() => (page.getByRole("combobox", { name: "Company" }).element() as HTMLInputElement).value).toBe(
      "Nobody Limited"
    );
    expect(text(field("fiscalYearEnd"))).toBe("Choose the year end");
    expect(editPanel()?.querySelector<HTMLInputElement>("#edit-project-industry")?.value).toBe("Not set (all industries)");
    await userEvent.click(saveButton());
    await expect.poll(() => editPanel()).toBeNull();
    expect(__mutationCalls("projects:updateProjectClientName")).toEqual([{ projectId: "p5", clientName: "Nobody Limited" }]);
    expect(__mutationCalls("projects:updateProjectFiscalYear")).toEqual([]);
    expect(__mutationCalls("projects:updateProjectIndustry")).toEqual([]);
  });

  it("never fills them from the listed client that Use that client picks", async () => {
    __setQueryData("clients:listClients", {
      clients: [{ ...CLIENTS[0], fiscalYearEndMonth: 6, fiscalYearEndDay: 30, industry: "software" }, CLIENTS[1]],
      truncated: false,
    });
    __setQueryData("projects:getProject", { ...P5_DOC, fiscalYearEnd: undefined, industry: undefined });
    __setQueryDataForArgs("clients:findSimilarClients", { name: "Acuity Insights Ltd" }, {
      exact: null,
      similar: [{ key: "acuity insights", name: "Acuity Insights", projectCount: 4 }],
    });
    await mount();
    await openEdit();
    await expect.poll(() => field("title")?.value).toBe("High-efficiency pump control");
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "Acuity Insights Ltd");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);
    await userEvent.click(page.getByRole("button", { name: "Use that company" }));
    await expect.poll(() => (page.getByRole("combobox", { name: "Company" }).element() as HTMLInputElement).value).toBe(
      "Acuity Insights"
    );
    expect(text(field("fiscalYearEnd"))).toBe("Choose the year end");
    expect(editPanel()?.querySelector<HTMLInputElement>("#edit-project-industry")?.value).toBe("Not set (all industries)");
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
    expect(editPanel()?.querySelector<HTMLButtonElement>("[data-form-dialog-close]")?.disabled).toBe(true);
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

});

/** Ticks the first card with its checkbox; the rest toggle from anywhere on the card. */
async function selectCards(...titles: string[]) {
  const [first, ...rest] = titles;
  await expect.poll(() => document.querySelector("[data-card-select-box]")).not.toBeNull();
  await userEvent.click(page.getByRole("checkbox", { name: `Select ${first}` }));
  for (const title of rest) await userEvent.click(page.getByRole("checkbox", { name: title, exact: true }));
}

async function openBulk(...titles: string[]) {
  await selectCards(...titles);
  await userEvent.click(document.querySelector<HTMLElement>("[data-selection-edit]")!);
  await settled(bulkPanel);
}

const applyButton = () => document.querySelector<HTMLButtonElement>("[data-bulk-apply]")!;
const resets = () => [...(bulkPanel()?.querySelectorAll("[data-bulk-reset]") ?? [])].map((node) => node.getAttribute("data-bulk-reset"));

async function clearOnEvery(trigger: "[data-bulk-date]" | "[data-bulk-science]") {
  await userEvent.click(bulkPanel()!.querySelector<HTMLElement>(trigger)!);
  await userEvent.click(page.getByRole("button", { name: "Clear on every project" }));
}

async function pickIndustry(label: string) {
  await userEvent.click(bulkPanel()!.querySelector<HTMLElement>("#bulk-edit-industry")!);
  await userEvent.click(page.getByRole("option", { name: label, exact: true }));
}

describe("Bulk edit dialog (Z7p)", () => {
  it("starts every field at No change, with Cancel and Apply on the right", async () => {
    await mount();
    await openBulk("High-efficiency pump control", "Evaporator coil frost sensing", "Compressor vibration damping");
    await expect.element(page.getByRole("dialog", { name: "Edit 3 projects" })).toBeVisible();
    expect(page.getByRole("combobox", { name: "Company" }).element()).toHaveProperty("placeholder", "No change");
    expect(text(bulkPanel()!.querySelector("[data-bulk-date]"))).toBe("No change");
    expect(bulkPanel()!.querySelector<HTMLInputElement>("#bulk-edit-industry")?.value).toBe("No change");
    expect(text(bulkPanel()!.querySelector("[data-bulk-science]"))).toBe("No change");
    expect(resets()).toEqual([]);
    expect(bulkPanel()!.querySelector("[data-changed]")).toBeNull();
    expect(applyButton().disabled).toBe(true);
    expect([...bulkPanel()!.querySelectorAll("[data-form-dialog-footer] button")].map((node) => text(node))).toEqual([
      "Cancel",
      "Apply to 3 projects",
    ]);
    // No "Now:" lines and no review step.
    expect(text(bulkPanel())).not.toContain("Now:");
    expect(text(bulkPanel())).not.toMatch(DASHES);
    expect(text(bulkPanel()).toLowerCase()).not.toContain("undo");
  });

  it("marks a changed field with the lagoon line and a Reset under it that puts it back", async () => {
    await mount();
    await openBulk("High-efficiency pump control", "Evaporator coil frost sensing");
    await clearOnEvery("[data-bulk-date]");
    await expect.poll(() => text(bulkPanel()!.querySelector("[data-bulk-date]"))).toBe("Not set");
    expect(bulkPanel()!.querySelector("[data-bulk-date]")?.hasAttribute("data-changed")).toBe(true);
    await pickIndustry("Not set");
    await expect.poll(resets).toEqual(["fiscalYearEnd", "industry"]);
    expect(applyButton().disabled).toBe(false);

    await userEvent.click(bulkPanel()!.querySelector<HTMLElement>('[data-bulk-reset="industry"]')!);
    await expect.poll(resets).toEqual(["fiscalYearEnd"]);
    expect(bulkPanel()!.querySelector<HTMLInputElement>("#bulk-edit-industry")?.value).toBe("No change");
    await userEvent.click(bulkPanel()!.querySelector<HTMLElement>('[data-bulk-reset="fiscalYearEnd"]')!);
    await expect.poll(() => text(bulkPanel()!.querySelector("[data-bulk-date]"))).toBe("No change");
    expect(applyButton().disabled).toBe(true);
  });

  it("applies straight away with one call, then clears the selection on the same client", async () => {
    __setMutationResult("projects:bulkUpdateProjects", { updated: 2, skipped: 0 });
    await mount();
    await openBulk("High-efficiency pump control", "Evaporator coil frost sensing", "Compressor vibration damping");
    await clearOnEvery("[data-bulk-date]");
    await userEvent.click(page.getByRole("button", { name: "Apply to 3 projects" }));

    await expect.poll(() => bulkPanel()).toBeNull();
    expect(__mutationCalls("projects:bulkUpdateProjects")).toEqual([
      { projectIds: ["p5", "p1", "pa"], fiscalYearEnd: null },
    ]);
    expect(sonner.success).toHaveBeenCalledWith("Updated 2 projects.");
    await expect.poll(() => document.querySelector("[data-selection-bar]")).toBeNull();
    expect(appPage.url.searchParams.get("client")).toBe("cedarline systems");
  });

  it("sets a date and a client", async () => {
    __setMutationResult("projects:bulkUpdateProjects", { updated: 2, skipped: 0 });
    await mount();
    await openBulk("High-efficiency pump control", "Evaporator coil frost sensing");
    await userEvent.fill(page.getByRole("combobox", { name: "Company" }), "Acuity Insights");
    await userEvent.click(bulkPanel()!.querySelector<HTMLElement>("[data-bulk-date]")!);
    await userEvent.click(page.getByRole("button", { name: "Sep 30" }));
    const year = new Date().getFullYear();
    await expect.poll(() => text(bulkPanel()!.querySelector("[data-bulk-date]"))).toBe(`September 30, ${year} FY ${year}`);
    await expect.poll(resets).toEqual(["clientName", "fiscalYearEnd"]);
    await userEvent.click(applyButton());
    await expect.poll(() => __mutationCalls("projects:bulkUpdateProjects")).toEqual([
      { projectIds: ["p5", "p1"], clientName: "Acuity Insights", fiscalYearEnd: Date.UTC(year, 8, 30) },
    ]);
  });

  it("tells a writer which projects are not theirs, applies once, and says what was skipped", async () => {
    seed("writer");
    __setMutationResult("projects:bulkUpdateProjects", { updated: 2, skipped: 1 });
    await mount();
    await openBulk("High-efficiency pump control", "Defrost cycle prediction", "Evaporator coil frost sensing");
    await expect.poll(() => text(document.querySelector("[data-bulk-skip-note]"))).toBe(
      "You can only change projects you own. 1 of these is not yours and will be skipped."
    );
    await pickIndustry("Not set");
    await userEvent.click(page.getByRole("button", { name: "Apply to 3 projects" }));
    await expect.poll(() => __mutationCalls("projects:bulkUpdateProjects")).toEqual([
      { projectIds: ["p5", "p6", "p1"], industry: null },
    ]);
    await expect.poll(() => sonner.success.mock.calls).toEqual([["Updated 2 projects, skipped 1 you don't own."]]);
  });

  it("keeps the dialog and the edits when the apply fails", async () => {
    __setMutationError("projects:bulkUpdateProjects", new ConvexError({ code: "INVALID_INPUT", message: "Select a valid CRA science code" }));
    await mount();
    await openBulk("High-efficiency pump control");
    await clearOnEvery("[data-bulk-science]");
    await userEvent.click(page.getByRole("button", { name: "Apply to 1 project" }));
    await expect.poll(() => text(document.querySelector("[data-bulk-apply-error]"))).toBe("Select a valid CRA science code");
    expect(bulkPanel()).not.toBeNull();
    expect(text(bulkPanel()!.querySelector("[data-bulk-science]"))).toBe("Not set");
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
    await pickIndustry("Not set");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => text(document.querySelector("[data-bulk-escape-note]"))).toBe(
      "Apply the changes, or use Cancel to discard them."
    );
    expect(bulkPanel()).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Apply to 1 project" }));
    await expect.poll(() => text(applyButton())).toBe("Applying...");
    await userEvent.keyboard("{Escape}");
    expect(bulkPanel()).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-bulk-cancel]")?.disabled).toBe(true);
    release({ updated: 1, skipped: 0 });
    await expect.poll(() => bulkPanel()).toBeNull();
  });

  it("shows the client New client created in the bulk Client field", async () => {
    __setMutationResult("clients:createClient", { clientId: "c9", key: "nobody limited", name: "Nobody Limited" });
    await mount();
    await openBulk("High-efficiency pump control");
    const client = page.getByRole("combobox", { name: "Company" });
    await userEvent.fill(client, "Nobody Ltd");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-create-client]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-create-client]")!);
    await expect.poll(() => (client.element() as HTMLInputElement).value).toBe("Nobody Limited");
    await expect.poll(() => applyButton().disabled).toBe(false);
  });

  it("closes on Escape and keeps the selection", async () => {
    await mount();
    await openBulk("High-efficiency pump control");
    await expect.poll(() => bulkPanel()?.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => bulkPanel()).toBeNull();
    expect(document.querySelector("[data-selection-bar]")).not.toBeNull();
    expect(text(document.querySelector("[data-selection-count]"))).toBe("1 selected of 5");
    await expect.poll(() => document.activeElement?.hasAttribute("data-selection-edit")).toBe(true);
  });
});

describe("Selection hygiene", () => {
  it("drops a selected project that leaves the visible set, so bulk edit never touches it", async () => {
    await mount();
    await selectCards("High-efficiency pump control", "Defrost cycle prediction");
    expect(text(document.querySelector("[data-selection-count]"))).toBe("2 selected of 5");
    // Defrost cycle prediction moves to another client.
    __setPaginatedRows(
      "dashboard:listCompanyProjects",
      CEDARLINE.filter((row) => row._id !== "p6")
    );
    await expect.poll(() => text(document.querySelector("[data-selection-count]"))).toBe("1 selected of 4");
    await userEvent.click(document.querySelector<HTMLElement>("[data-selection-edit]")!);
    await expect.element(page.getByRole("dialog", { name: "Edit 1 project" })).toBeVisible();
  });

  it("takes a project that leaves the selection out of an open bulk edit, keeping the edits", async () => {
    __setMutationResult("projects:bulkUpdateProjects", { updated: 1, skipped: 0 });
    await mount();
    await openBulk("High-efficiency pump control", "Defrost cycle prediction");
    await pickIndustry("Not set");
    // Defrost cycle prediction moves to another client while the dialog is open.
    __setPaginatedRows(
      "dashboard:listCompanyProjects",
      CEDARLINE.filter((row) => row._id !== "p6")
    );
    await expect.element(page.getByRole("dialog", { name: "Edit 1 project" })).toBeVisible();
    expect(resets()).toEqual(["industry"]);
    await userEvent.click(page.getByRole("button", { name: "Apply to 1 project" }));
    await expect.poll(() => __mutationCalls("projects:bulkUpdateProjects")).toEqual([
      { projectIds: ["p5"], industry: null },
    ]);
  });

  it("closes an open bulk edit once none of its projects is still selected", async () => {
    await mount();
    await openBulk("Defrost cycle prediction");
    await pickIndustry("Not set");
    __setPaginatedRows(
      "dashboard:listCompanyProjects",
      CEDARLINE.filter((row) => row._id !== "p6")
    );
    await expect.poll(() => bulkPanel()).toBeNull();
    expect(__mutationCalls("projects:bulkUpdateProjects")).toEqual([]);
  });

  it("keeps a search's selection to its results as they change", async () => {
    __setPaginatedRows("dashboard:searchProjects", CEDARLINE.slice(0, 2));
    await mount();
    await userEvent.fill(page.getByRole("searchbox", { name: "Search projects" }), "control");
    await expect.poll(() => text(document.querySelector("#projects-search-results"))).toBe("2 projects match");
    await selectCards("Adaptive cold storage controls", "High-efficiency pump control");
    expect(text(document.querySelector("[data-selection-count]"))).toBe("2 selected of 2");
    __setPaginatedRows("dashboard:searchProjects", CEDARLINE.slice(1, 2));
    await expect.poll(() => text(document.querySelector("[data-selection-count]"))).toBe("1 selected of 1");
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
    await expect.element(page.getByRole("dialog", { name: "Merge 3 companies" })).toBeVisible();
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-confirm-merge]")?.disabled).toBe(false);
    await userEvent.click(document.querySelector<HTMLElement>("[data-confirm-merge]")!);

    // The list updates before the mutation's answer arrives.
    __setQueryData("clients:listClients", { clients: [three[0], three[3]], truncated: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release({ moved: 3, keptKey: "acuity insights", keptName: "Acuity Insights", clientId: "c1" });

    await expect.poll(() => sonner.success.mock.calls).toEqual([["Merged 3 companies into Acuity Insights."]]);
    await expect.poll(() => appPage.url.searchParams.get("client")).toBe("acuity insights");
    await expect.poll(() => document.activeElement?.getAttribute("data-client-row")).toBe("acuity insights");
  });
});
