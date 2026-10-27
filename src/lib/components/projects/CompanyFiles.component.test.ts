import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ProjectsPage from "./ProjectsPage.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { userEvent } from "vitest/browser";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
  __setQueryDataForArgs,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * 2026-10-26 (Phase C): a company page's Files tab. Consultants see and add
 * company files; only Managers and Admins archive, restore and remove them;
 * a viewer with no role sees no tab. A company with no company row gets one
 * on its first upload. Word files preview formatted.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const CLIENTS = [
  { key: "cedarline systems", clientId: "c3", name: "Cedarline Systems", projectCount: 1 },
  { key: "acuity insights", clientId: "c1", name: "Acuity Insights", projectCount: 1 },
];

function listed(id: string, fileName: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    fileName,
    fileType: "txt",
    category: null,
    sizeChars: 1200,
    wordCount: 210,
    archived: false,
    processingStatus: "ready",
    textFormat: null,
    hasFile: true,
    url: null,
    mimeType: "text/plain",
    createdAt: Date.parse("2026-10-20T12:00:00Z"),
    addedBy: "Wendy Writer",
    labels: null,
    ...overrides,
  };
}

function seed(role: string | null, files = [listed("f1", "history.txt")]) {
  __setQueryData("users:getCurrentUser", { _id: "u-1", ...(role ? { role } : {}) });
  __setQueryData("clients:listClients", { clients: CLIENTS, truncated: false });
  __setQueryData("projects:listIndustries", []);
  __setQueryData("clients:findSimilarClients", { exact: null, similar: [] });
  __setPaginatedRows("dashboard:listCompanyProjects", []);
  __setQueryData("companyFiles:companyForKey", { clientId: "c3", name: "Cedarline Systems" });
  __setQueryDataForArgs("companyFiles:listCompanyFiles", { clientId: "c3" }, { files, truncated: false });
  __setQueryDataForArgs("companyFiles:listCompanyFiles", { clientId: "c3", archived: true }, {
    files: [listed("f9", "old-plan.txt", { archived: true })],
    truncated: false,
  });
}

async function mount() {
  __setPageUrl("/projects?client=cedarline+systems");
  await page.viewport(1440, 900);
  const screen = await render(ProjectsPage, { totalLabel: "1" });
  screen.container.style.cssText = "display:flex;height:900px;";
  return screen;
}

async function openFiles() {
  await expect.poll(() => document.querySelector('[data-client-tab="files"]')).not.toBeNull();
  document.querySelector<HTMLButtonElement>('[data-client-tab="files"]')!.click();
  await expect.poll(() => document.querySelector("[data-company-files]")).not.toBeNull();
}

function choose(...files: File[]) {
  const input = document.querySelector<HTMLInputElement>("[data-company-files-input]");
  if (!input) throw new Error("Upload input missing");
  const list = new DataTransfer();
  for (const file of files) list.items.add(file);
  input.files = list.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  __resetConvexStub();
  __resetPage();
  __resetNavigation();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ storageId: "stored-bytes" }));
});
afterEach(() => vi.restoreAllMocks());

describe("a company's Files tab", () => {
  it("shows Projects and Files tabs, the active one filled, and lists the company's files", async () => {
    seed("writer", [
      listed("f1", "history.txt", {
        labels: { documentType: "prior SR&ED report", fiscalYear: 2024, title: "History", summary: "How Cedarline seals pumps." },
      }),
      listed("f2", "scan.pdf", { fileType: "pdf", wordCount: 0, processingStatus: "could_not_read" }),
    ]);
    await mount();
    await openFiles();
    const files = document.querySelector('[data-client-tab="files"]')!;
    expect(files.getAttribute("aria-selected")).toBe("true");
    expect(files.className).toContain("bg-primary-selected");
    expect(document.querySelector('[data-client-tab="projects"]')!.className).not.toContain("bg-primary-selected");
    // The project search belongs to the Projects tab.
    expect(document.querySelector("[data-client-search]")?.closest(".hidden")).not.toBeNull();
    const rows = [...document.querySelectorAll("[data-company-file]")].map((node) => text(node));
    expect(rows[0]).toContain("history.txt");
    expect(rows[0]).toContain("How Cedarline seals pumps.");
    expect(rows[0]).toContain("Prior SR&ED report");
    expect(rows[0]).toContain("210 words");
    expect(rows[0]).toContain("Added by Wendy Writer, Oct 20, 2026");
    expect(rows[1]).toContain("No text");
    expect(document.querySelector('[data-company-file="f2"] [data-company-file-status]')).not.toBeNull();
    expect(text(document.querySelector("[data-company-files]"))).not.toMatch(/[‐-―]/);
  });

  it("a Consultant can upload but not archive or remove", async () => {
    seed("writer");
    await mount();
    await openFiles();
    expect(document.querySelector("[data-company-files-upload]")).not.toBeNull();
    await page.getByRole("button", { name: "More actions for history.txt" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Open" })).toBeVisible();
    expect(document.querySelector('[data-company-file-action="archive"]')).toBeNull();
    expect(document.querySelector('[data-company-file-action="remove"]')).toBeNull();
  });

  it("a Manager archives, restores from the archived list, and removes after confirming", async () => {
    seed("manager");
    await mount();
    await openFiles();
    await page.getByRole("button", { name: "More actions for history.txt" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:setCompanyFileArchived")).toEqual([
      { companyFileId: "f1", archived: true },
    ]);

    await page.getByRole("button", { name: "Show archived files" }).click();
    await expect.poll(() => document.querySelector("[data-company-files-archived]")).not.toBeNull();
    await page.getByRole("button", { name: "More actions for old-plan.txt" }).click();
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:setCompanyFileArchived").at(-1)).toEqual({
      companyFileId: "f9",
      archived: false,
    });

    await page.getByRole("button", { name: "More actions for history.txt" }).click();
    await page.getByRole("menuitem", { name: "Remove" }).click();
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    expect(__mutationCalls("companyFiles:removeCompanyFile")).toEqual([]);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => __mutationCalls("companyFiles:removeCompanyFile")).toEqual([{ companyFileId: "f1" }]);
  });

  it("a viewer with no role sees no Files tab", async () => {
    seed(null);
    await mount();
    await expect.poll(() => document.querySelector("[data-client-title]")).not.toBeNull();
    expect(document.querySelector("[data-client-tabs]")).toBeNull();
  });

  it("uploads each picked file to the company, reading its text in the browser", async () => {
    seed("writer");
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    await mount();
    await openFiles();
    choose(new File(["Cedarline seals pumps."], "notes.txt", { type: "text/plain" }), new File(["Second."], "more.txt", { type: "text/plain" }));
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(2);
    expect(__mutationCalls("companyFiles:addCompanyFile")[0]).toEqual(
      expect.objectContaining({ clientId: "c3", fileName: "notes.txt", content: "Cedarline seals pumps.", storageId: "stored-bytes" })
    );
    await expect.poll(() => document.querySelector("[data-company-file-uploads]")).toBeNull();
  });

  it("a company with no company row gets one on its first upload", async () => {
    seed("writer", []);
    __setQueryData("companyFiles:companyForKey", null);
    __setMutationResult("companyFiles:ensureCompanyForKey", { clientId: "c-made", name: "Cedarline Systems" });
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    await mount();
    await openFiles();
    expect(text(document.querySelector("[data-company-files-empty]"))).toContain("Cedarline Systems has no files yet.");
    choose(new File(["Text."], "first.txt", { type: "text/plain" }));
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(1);
    expect(__mutationCalls("companyFiles:ensureCompanyForKey")).toEqual([{ key: "cedarline systems" }]);
    expect(__mutationCalls("companyFiles:addCompanyFile")[0]).toEqual(expect.objectContaining({ clientId: "c-made" }));
  });

  it("says why a file was refused and lets the person dismiss it", async () => {
    seed("writer");
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationError("companyFiles:addCompanyFile", {
      data: { code: "INVALID_STATE", message: "This company was merged into Acme. Add the file there." },
    });
    await mount();
    await openFiles();
    choose(new File(["Text."], "late.txt", { type: "text/plain" }));
    await expect.element(page.getByText("This company was merged into Acme. Add the file there.")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect.poll(() => document.querySelector("[data-company-file-uploads]")).toBeNull();
  });

  it("Try again saves the same file under the same key", async () => {
    seed("writer");
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationError("companyFiles:addCompanyFile", new Error("Network lost"));
    await mount();
    await openFiles();
    choose(new File(["Text."], "notes.txt", { type: "text/plain" }));
    await expect.element(page.getByText("Network lost")).toBeVisible();
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.poll(() => document.querySelector("[data-company-file-uploads]")).toBeNull();
    const calls = __mutationCalls("companyFiles:addCompanyFile") as Array<{ attemptKey: string; fileName: string }>;
    expect(calls).toHaveLength(2);
    expect(calls[1]!.attemptKey).toBe(calls[0]!.attemptKey);
    expect(calls[0]!.attemptKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("previews a Word file formatted", async () => {
    seed("writer", [listed("f1", "plan.docx", { fileType: "docx", textFormat: "markdown" })]);
    __setQueryData("companyFiles:getCompanyFileContent", {
      fileName: "plan.docx",
      fileType: "docx",
      content: "# Plan\n\nThe seal **held**.",
      textFormat: "markdown",
    });
    await mount();
    await openFiles();
    await page.getByRole("button", { name: "plan.docx", exact: true }).click();
    const preview = page.getByTestId("company-file-preview-markdown");
    await expect.element(preview.getByRole("heading", { name: "Plan" })).toBeVisible();
    expect(preview.element().querySelector("strong")?.textContent).toBe("held");
    // Escape closes it.
    await expect.poll(() => document.activeElement?.closest("[data-company-file-preview]")).not.toBeNull();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect.poll(() => document.querySelector("[data-company-file-preview]")).toBeNull();
  });

  it("choosing another company shows its Projects, and a file still being added goes to the company it was picked for", async () => {
    seed("writer");
    __setQueryDataForArgs("companyFiles:companyForKey", { key: "acuity insights" }, { clientId: "c1", name: "Acuity Insights" });
    __setQueryDataForArgs("companyFiles:listCompanyFiles", { clientId: "c1" }, { files: [listed("a1", "acuity.txt")], truncated: false });
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    let finish: (value: unknown) => void = () => {};
    __setMutationResult("companyFiles:addCompanyFile", new Promise((resolve) => (finish = resolve)));
    await mount();
    await openFiles();
    choose(new File(["Text."], "slow.txt", { type: "text/plain" }));
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(1);

    __setPageUrl("/projects?client=acuity+insights");
    await expect.poll(() => document.querySelector('[data-client-tab="projects"]')?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector<HTMLElement>("[data-client-files-panel]")?.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-client-tab="files"]')!.click();
    await expect.poll(() => text(document.querySelector("[data-company-files-list]"))).toContain("acuity.txt");
    // The other company's upload is not shown here, and it was saved to that company.
    expect(document.querySelector("[data-company-file-uploads]")).toBeNull();
    expect(__mutationCalls("companyFiles:addCompanyFile")[0]).toEqual(expect.objectContaining({ clientId: "c3", fileName: "slow.txt" }));
    finish("f-slow");
  });

  it("the preview opened from the menu keeps focus inside and returns it to the file's name", async () => {
    seed("writer");
    __setQueryData("companyFiles:getCompanyFileContent", { fileName: "history.txt", fileType: "txt", content: "Plain text." });
    await mount();
    await openFiles();
    await page.getByRole("button", { name: "More actions for history.txt" }).click();
    await page.getByRole("menuitem", { name: "Open" }).click();
    await expect.element(page.getByText("Plain text.")).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await userEvent.keyboard("{Tab}");
      expect(document.activeElement?.closest("[data-company-file-preview]")).not.toBeNull();
    }
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-company-file-preview]")).toBeNull();
    await expect.poll(() => document.activeElement?.getAttribute("data-company-file-open")).toBe("");
    expect(text(document.activeElement)).toBe("history.txt");
  });

  it("says so when a file's text cannot be loaded", async () => {
    seed("writer");
    __setQueryError("companyFiles:getCompanyFileContent", new Error("down"));
    await mount();
    await openFiles();
    await page.getByRole("button", { name: "history.txt", exact: true }).click();
    await expect.element(page.getByText("This file's text could not be loaded.")).toBeVisible();
  });
});
