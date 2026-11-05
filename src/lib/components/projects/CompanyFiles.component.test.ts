import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CompanyFiles from "./CompanyFiles.svelte";
import ToastHarness from "$lib/test/ToastHarness.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
  __setQueryDataForArgs,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import { MAX_COMPANY_FILE_BYTES } from "$lib/uploads/storeCompanyFile";

/**
 * A company's Files tab (2026-10-26, Phase C; redesigned 2026-11-04 with
 * the company profile). The list in groups (could not read, by fiscal
 * year, no fiscal year, archived), the row menu by role, Edit details in
 * the row, Archive with Undo and Delete after asking, Select and Download
 * (one file as itself, several as a zip), Add files with progress and the
 * 50 MB refusal, the page drop and the drop on a row (Replace file), and the
 * full-screen preview with arrows, Esc and focus going back.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const ORIGINAL_XHR = globalThis.XMLHttpRequest;

function listed(id: string, fileName: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    url: `https://files.test/${id}`,
    mimeType: "text/plain",
    createdAt: Date.parse("2026-10-20T12:00:00Z"),
    addedBy: "Wendy Writer",
    fromWebsite: false,
    bytes: 1000,
    labels: null,
    ...overrides,
  };
}

const LABELS_2025 = { documentType: "prior SR&ED report", fiscalYear: 2025, title: "Claim", summary: "Last year's claim." };

function defaultFiles() {
  return [
    listed("f1", "claim 2025.pdf", { fileType: "pdf", labels: LABELS_2025, wordCount: 6840 }),
    listed("f2", "time logs.xlsx", { fileType: "xlsx", fiscalYear: 2026, category: "scoping_notes", wordCount: 3904 }),
    listed("f3", "org chart.pdf", { fileType: "pdf", wordCount: 0, processingStatus: "could_not_read" }),
    listed("f4", "Website: example.com", { fileType: "txt", category: "background", wordCount: 1280 }),
  ];
}

function seed(files = defaultFiles(), archived = [listed("f9", "old plan.docx", { archived: true, fileType: "docx" })]) {
  __setQueryData("companyFiles:companyForKey", { clientId: "c3", name: "Cedarline Systems" });
  __setQueryDataForArgs("companyFiles:listCompanyFiles", { clientId: "c3" }, { files, truncated: false });
  __setQueryDataForArgs("companyFiles:listCompanyFiles", { clientId: "c3", archived: true }, { files: archived, truncated: false });
}

type Role = "writer" | "manager" | "viewer";
async function mount(role: Role = "writer", extra: Record<string, unknown> = {}) {
  await page.viewport(1440, 900);
  return await render(CompanyFiles, {
    companyKey: "cedarline systems",
    companyName: "Cedarline Systems",
    active: true,
    canAdd: role !== "viewer",
    canManage: role === "manager",
    ...extra,
  });
}

function rowOf(id: string) {
  return document.querySelector<HTMLElement>(`[data-company-file="${id}"]`);
}

function fileList(...files: File[]) {
  const list = new DataTransfer();
  for (const file of files) list.items.add(file);
  return list;
}

function chooseIn(container: Element, ...files: File[]) {
  const input = container.querySelector<HTMLInputElement>("[data-drop-zone-input]");
  if (!input) throw new Error("Drop zone input missing");
  input.files = fileList(...files).files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function drag(type: "dragenter" | "dragover" | "dragleave" | "drop", target: EventTarget, files: File[]) {
  const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: fileList(...files) });
  target.dispatchEvent(event);
  return event;
}

function bigFile(name: string) {
  const file = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: MAX_COMPANY_FILE_BYTES + 1 });
  return file;
}

let objectUrls: Blob[] = [];

beforeEach(() => {
  __resetConvexStub();
  objectUrls = [];
  // The original's upload reports progress through XMLHttpRequest; without
  // it the upload goes through fetch, stubbed here.
  vi.stubGlobal("XMLHttpRequest", undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (init?.method === "POST") return Response.json({ storageId: "stored-bytes" });
    return new Response(new Blob([`bytes of ${String(input)}`], { type: "application/octet-stream" }));
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    objectUrls.push(blob as Blob);
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.XMLHttpRequest = ORIGINAL_XHR;
  vi.restoreAllMocks();
});

describe("the list", () => {
  it("groups files: could not read, then fiscal years newest first, then no fiscal year, then archived", async () => {
    seed();
    const onCount = vi.fn();
    await mount("manager", { onCount });
    await expect.poll(() => document.querySelectorAll("[data-company-files-group]").length).toBe(4);
    const groups = [...document.querySelectorAll("[data-company-files-group]")].map((node) => node.getAttribute("data-company-files-group"));
    expect(groups).toEqual(["unread", "fy-2026", "fy-2025", "no-year"]);
    expect(text(document.querySelector('[data-company-files-group="unread"]'))).toContain("No text could be read. Drafts can name it but not quote it.");
    // A person's category wins over the AI's kind; else the AI's kind.
    expect(text(rowOf("f2"))).toContain("Scoping notes, 3,904 words");
    expect(text(rowOf("f1"))).toContain("Prior SR&ED report, 6,840 words");
    expect(text(rowOf("f1"))).toContain("Added Oct 20, 2026");
    expect(text(document.querySelector("[data-company-files-archived]"))).toContain("old plan.docx");
    expect(document.querySelector('[data-company-file="f9"] [data-company-file-action="restore"]')).not.toBeNull();
    // The frame's tab count: files not archived.
    await expect.poll(() => onCount.mock.calls.at(-1)?.[0]).toBe(4);
    expect(text(document.querySelector("[data-company-files]"))).not.toMatch(/[‐-―]/);
  });

  it("Find a file filters by name", async () => {
    seed();
    await mount();
    await expect.poll(() => rowOf("f1")).not.toBeNull();
    await page.getByRole("searchbox", { name: "Find a file" }).fill("logs");
    await expect.poll(() => rowOf("f1")).toBeNull();
    expect(rowOf("f2")).not.toBeNull();
    await page.getByRole("searchbox", { name: "Find a file" }).fill("nothing like this");
    await expect.element(page.getByText('No file matches "nothing like this".')).toBeVisible();
  });

  it("says a company has no files yet, and reports a count of 0", async () => {
    seed([], []);
    const onCount = vi.fn();
    await mount("writer", { onCount });
    await expect.element(page.getByText("Cedarline Systems has no files yet.", { exact: false })).toBeVisible();
    await expect.poll(() => onCount.mock.calls.at(-1)?.[0]).toBe(0);
  });
});

describe("the row menu by role", () => {
  it("a Consultant may edit details and download, not replace, archive or delete", async () => {
    seed();
    await mount("writer");
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Edit details" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Download original" })).toBeVisible();
    expect(document.querySelector('[data-company-file-action="replace"]')).toBeNull();
    expect(document.querySelector('[data-company-file-action="archive"]')).toBeNull();
    expect(document.querySelector('[data-company-file-action="delete"]')).toBeNull();
    expect(document.querySelector('[data-company-file="f9"] [data-company-file-action="restore"]')).toBeNull();
  });

  it("a Manager sees Edit details, Download original, Replace file, Archive and Delete, in that order", async () => {
    seed();
    await mount("manager");
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    const items = [...document.querySelectorAll("[data-company-file-action]")]
      .filter((node) => node.closest("[role=menu]"))
      .map((node) => text(node));
    expect(items).toEqual(["Edit details", "Download original", "Replace file", "Archive", "Delete"]);
  });

  it("someone who may not add files gets Download original only, and no Add files or page drop", async () => {
    seed();
    await mount("viewer");
    expect(document.querySelector("[data-company-files-add]")).toBeNull();
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Download original" })).toBeVisible();
    expect(document.querySelector('[data-company-file-action="edit"]')).toBeNull();
    drag("dragenter", document.body, [new File(["x"], "a.txt", { type: "text/plain" })]);
    expect(document.querySelector("[data-company-files-drop-overlay]")).toBeNull();
  });
});

describe("Edit details, Archive and Delete", () => {
  it("Edit details opens the category and fiscal year in the row and saves them", async () => {
    seed();
    await mount("writer");
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await page.getByRole("menuitem", { name: "Edit details" }).click();
    await expect.element(page.getByLabelText("Category of claim 2025.pdf")).toBeVisible();
    // The year starts at the AI label's year.
    expect(text(document.querySelector("[data-file-details-year]"))).toBe("FY 2025");
    await page.getByLabelText("Category of claim 2025.pdf").click();
    await page.getByRole("option", { name: "Prior SR&ED report" }).click();
    await page.getByLabelText("Fiscal year of claim 2025.pdf").click();
    await page.getByRole("option", { name: "FY 2024" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:updateCompanyFileDetails")).toEqual([
      { companyFileId: "f1", category: "previous_pd", fiscalYear: 2024 },
    ]);
    await expect.poll(() => document.querySelector('[data-file-details="f1"]')).toBeNull();
  });

  it("Archive happens at once; Delete asks first with the file's name", async () => {
    seed();
    await mount("manager");
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:setCompanyFileArchived")).toEqual([{ companyFileId: "f1", archived: true }]);

    await page.getByRole("button", { name: "Restore old plan.docx" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:setCompanyFileArchived").at(-1)).toEqual({ companyFileId: "f9", archived: false });

    await page.getByRole("button", { name: "More actions for time logs.xlsx" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toBeVisible();
    expect(text(dialog.element())).toContain("Delete time logs.xlsx?");
    expect(text(dialog.element())).toContain("It's removed for good. Drafts already written keep what they used.");
    expect(__mutationCalls("companyFiles:removeCompanyFile")).toEqual([]);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => __mutationCalls("companyFiles:removeCompanyFile")).toEqual([{ companyFileId: "f2" }]);
  });
});

describe("Select and download", () => {
  it("ticks files for the dark bar; Download saves several as one zip, and Clear ends it", async () => {
    seed();
    await mount("writer");
    await page.getByRole("button", { name: "Select" }).click();
    await page.getByRole("checkbox", { name: "Select claim 2025.pdf" }).click();
    await page.getByRole("checkbox", { name: "Select time logs.xlsx" }).click();
    const bar = page.getByRole("toolbar", { name: "Selected files" });
    await expect.element(bar).toBeVisible();
    expect(text(bar.element())).toContain("2 files selected");
    // A Consultant may move them to a fiscal year; Download is the last action before Clear.
    const buttons = [...bar.element().querySelectorAll("button")].map((node) => node.getAttribute("aria-label") ?? text(node));
    expect(buttons).toEqual(["Move to fiscal year", "Download", "Clear selection"]);
    await page.getByRole("button", { name: "Download", exact: true }).click();
    await expect.poll(() => objectUrls.length).toBe(1);
    expect(objectUrls[0]!.type).toBe("application/zip");
    const fetched = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(fetched).toEqual(expect.arrayContaining(["https://files.test/f1", "https://files.test/f2"]));
    await page.getByRole("button", { name: "Clear selection" }).click();
    await expect.poll(() => document.querySelector("[data-company-files-selection-bar]")).toBeNull();
    expect(document.querySelector("[data-company-file-select]")).toBeNull();
  });

  it("Download original saves one file as itself", async () => {
    seed();
    await mount("writer");
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await page.getByRole("menuitem", { name: "Download original" }).click();
    await expect.poll(() => objectUrls.length).toBe(1);
    expect(objectUrls[0]!.type).not.toBe("application/zip");
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input))).toContain("https://files.test/f1");
  });
});

describe("Add files", () => {
  it("adds picked files with their progress, refuses one over 50 MB before sending it, and lists them in Just added", async () => {
    seed();
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    await mount("writer");
    await page.getByRole("button", { name: "Add files" }).click();
    const dialog = document.querySelector("[data-company-files-add-dialog]")!;
    expect(text(dialog)).toContain("Up to 50 MB each");
    chooseIn(dialog, new File(["Cedarline seals pumps."], "notes.txt", { type: "text/plain" }), bigFile("drawings.pdf"));
    await expect.element(page.getByText("Too large, up to 50 MB").first()).toBeVisible();
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(1);
    expect(__mutationCalls("companyFiles:addCompanyFile")[0]).toEqual(
      expect.objectContaining({ clientId: "c3", fileName: "notes.txt", content: "Cedarline seals pumps.", storageId: "stored-bytes" })
    );
    // Nothing of the large file was read, uploaded or saved.
    expect(__mutationCalls("companyFiles:generateCompanyUploadUrl")).toHaveLength(1);
    await page.getByRole("button", { name: "Add files", exact: true }).last().click();
    await expect.poll(() => document.querySelector("[data-company-files-add-dialog]")).toBeNull();

    // The saved file waits in Just added for its details to be confirmed.
    seed([listed("f-new", "notes.txt", { createdAt: Date.now() - 5 * 60_000, labels: LABELS_2025 }), ...defaultFiles()]);
    await expect.poll(() => document.querySelector("[data-company-file-just-added]")).not.toBeNull();
    expect(text(document.querySelector("[data-company-files-just-added]"))).toContain("drawings.pdf");
    await page.getByRole("button", { name: "Confirm" }).click();
    // Confirming what the AI picked writes nothing; the file joins its group.
    await expect.poll(() => document.querySelector("[data-company-file-just-added]")).toBeNull();
    expect(__mutationCalls("companyFiles:updateCompanyFileDetails")).toEqual([]);
    expect(document.querySelector('[data-company-files-group="fy-2025"] [data-company-file="f-new"]')).not.toBeNull();
  });

  it("a company with no company row gets one on its first upload", async () => {
    seed([], []);
    __setQueryData("companyFiles:companyForKey", null);
    __setMutationResult("companyFiles:ensureCompanyForKey", { clientId: "c-made", name: "Cedarline Systems" });
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    await mount("writer");
    await page.getByRole("button", { name: "Add files" }).click();
    chooseIn(document.querySelector("[data-company-files-add-dialog]")!, new File(["Text."], "first.txt", { type: "text/plain" }));
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(1);
    expect(__mutationCalls("companyFiles:ensureCompanyForKey")).toEqual([{ key: "cedarline systems" }]);
    expect(__mutationCalls("companyFiles:addCompanyFile")[0]).toEqual(expect.objectContaining({ clientId: "c-made" }));
  });

  it("says why a file was refused, and Try again saves it under the same key", async () => {
    seed();
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationError("companyFiles:addCompanyFile", {
      data: { code: "INVALID_STATE", message: "This company was merged into Acme. Add the file there." },
    });
    await mount("writer");
    await page.getByRole("button", { name: "Add files" }).click();
    chooseIn(document.querySelector("[data-company-files-add-dialog]")!, new File(["Text."], "late.txt", { type: "text/plain" }));
    await expect.element(page.getByText("This company was merged into Acme. Add the file there.").first()).toBeVisible();
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    // The dialog's own row (the page lists it too, under the dialog).
    await page.getByRole("button", { name: "Try late.txt again" }).last().click();
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(2);
    const calls = __mutationCalls("companyFiles:addCompanyFile") as Array<{ attemptKey: string }>;
    expect(calls[1]!.attemptKey).toBe(calls[0]!.attemptKey);
    expect(calls[0]!.attemptKey).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("dropping files on the page", () => {
  it("shows the overlay and its bar while files are dragged, and adds them on drop", async () => {
    seed();
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    await mount("writer");
    await expect.poll(() => rowOf("f1")).not.toBeNull();
    const files = [new File(["One."], "one.txt", { type: "text/plain" }), new File(["%PDF"], "two.pdf", { type: "application/pdf" })];
    drag("dragenter", document.body, files);
    await expect.poll(() => document.querySelector("[data-company-files-drop-overlay]")).not.toBeNull();
    expect(text(document.querySelector("[data-company-files-drop-overlay]"))).toBe("Drop to add 2 files to Cedarline Systems Up to 50 MB each");
    // File names are not known until the drop: only their types.
    expect(text(document.querySelector("[data-company-files-drop-preview]"))).toBe("Text file Ready to add PDF file Ready to add");
    const dropped = drag("drop", document.body, files);
    expect(dropped.defaultPrevented).toBe(true);
    await expect.poll(() => document.querySelector("[data-company-files-drop-overlay]")).toBeNull();
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(2);
    expect((__mutationCalls("companyFiles:addCompanyFile") as Array<{ fileName: string }>).map((call) => call.fileName)).toEqual(["one.txt", "two.pdf"]);
  });

  it("leaving the page clears the overlay", async () => {
    seed();
    await mount("writer");
    const files = [new File(["One."], "one.txt", { type: "text/plain" })];
    drag("dragenter", document.body, files);
    await expect.poll(() => document.querySelector("[data-company-files-drop-overlay]")).not.toBeNull();
    drag("dragleave", document.body, files);
    await expect.poll(() => document.querySelector("[data-company-files-drop-overlay]")).toBeNull();
  });

  it("a Manager dropping one file on a row replaces that file", async () => {
    seed();
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    await mount("manager");
    await expect.poll(() => rowOf("f2")).not.toBeNull();
    const files = [new File(["New logs."], "time logs v2.xlsx", { type: "text/plain" })];
    drag("dragenter", document.body, files);
    drag("dragover", rowOf("f2")!, files);
    await expect.poll(() => text(rowOf("f2")?.querySelector("[data-company-file-drop-replace]"))).toBe("Drop to replace this file");
    expect(text(document.querySelector("[data-company-files-drop-overlay]"))).toContain("Drop on a file to replace it");
    drag("drop", rowOf("f2")!, files);
    await expect.poll(() => document.querySelector("[data-company-file-replace-dialog]")).not.toBeNull();
    expect(text(document.querySelector("[data-replace-target]"))).toBe("time logs.xlsx");
    await expect.element(page.getByText("Uploaded and read")).toBeVisible();
    expect(__mutationCalls("companyFiles:addCompanyFile")).toEqual([]);
    await page.getByRole("button", { name: "Replace file" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:replaceCompanyFile")).toEqual([
      expect.objectContaining({ companyFileId: "f2", fileName: "time logs v2.xlsx", storageId: "stored-bytes", extractionOutcome: "ok" }),
    ]);
    await expect.poll(() => document.querySelector("[data-company-file-replace-dialog]")).toBeNull();
  });

  it("a Consultant dropping a file on a row adds it instead", async () => {
    seed();
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    await mount("writer");
    await expect.poll(() => rowOf("f2")).not.toBeNull();
    const files = [new File(["New logs."], "time logs v2.xlsx", { type: "text/plain" })];
    drag("dragenter", document.body, files);
    drag("dragover", rowOf("f2")!, files);
    expect(rowOf("f2")!.querySelector("[data-company-file-drop-replace]")).toBeNull();
    drag("drop", rowOf("f2")!, files);
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(1);
    expect(document.querySelector("[data-company-file-replace-dialog]")).toBeNull();
  });
});

describe("Replace file from the menu", () => {
  it("opens at the drop step, refuses a file over 50 MB, then swaps in the new version", async () => {
    seed();
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    await mount("manager");
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await page.getByRole("menuitem", { name: "Replace file" }).click();
    const dialog = document.querySelector("[data-company-file-replace-dialog]")!;
    await expect.element(page.getByText("One file, up to 50 MB", { exact: true })).toBeVisible();
    chooseIn(dialog, bigFile("claim v2.pdf"));
    await expect.element(page.getByText("Too large, up to 50 MB")).toBeVisible();
    expect(__mutationCalls("companyFiles:generateCompanyUploadUrl")).toEqual([]);
    expect(page.getByRole("button", { name: "Replace file" }).element().hasAttribute("disabled")).toBe(true);
    await page.getByRole("button", { name: "Dismiss claim v2.pdf" }).click();
    chooseIn(document.querySelector("[data-company-file-replace-dialog]")!, new File(["New claim."], "claim 2025 v2.txt", { type: "text/plain" }));
    await expect.element(page.getByText("Uploaded and read")).toBeVisible();
    await page.getByRole("button", { name: "Replace file" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:replaceCompanyFile")).toEqual([
      expect.objectContaining({ companyFileId: "f1", fileName: "claim 2025 v2.txt", content: "New claim.", storageId: "stored-bytes" }),
    ]);
  });

  it("keeps the dialog open and says so when the swap is refused", async () => {
    seed();
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationError("companyFiles:replaceCompanyFile", { data: { code: "INVALID_STATE", message: "Restore this file before replacing it." } });
    await mount("manager");
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await page.getByRole("menuitem", { name: "Replace file" }).click();
    chooseIn(document.querySelector("[data-company-file-replace-dialog]")!, new File(["New."], "claim.txt", { type: "text/plain" }));
    await expect.element(page.getByText("Uploaded and read")).toBeVisible();
    await page.getByRole("button", { name: "Replace file" }).click();
    await expect.element(page.getByText("Restore this file before replacing it.")).toBeVisible();
    expect(document.querySelector("[data-company-file-replace-dialog]")).not.toBeNull();
  });
});

describe("the preview", () => {
  it("opens full screen on the file, moves with the arrows and the arrow keys, and Esc closes it back to the row", async () => {
    seed(defaultFiles().map((file) => ({ ...file, url: null, hasFile: false })));
    __setQueryData("companyFiles:getCompanyFileContent", { fileName: "x", fileType: "txt", content: "Plain text of the file." });
    await mount("writer");
    await expect.poll(() => rowOf("f2")).not.toBeNull();
    await page.getByRole("button", { name: "Preview time logs.xlsx" }).click();
    const preview = () => document.querySelector("[data-company-file-preview]");
    await expect.poll(() => preview()).not.toBeNull();
    // The list's order: could not read, FY 2026, FY 2025, no fiscal year.
    await expect.poll(() => text(document.querySelector("[data-preview-title]"))).toBe("time logs.xlsx");
    expect(text(document.querySelector("[data-preview-position]"))).toContain("2 of 4");
    expect(document.querySelector('[data-preview-dot="1"]')!.getAttribute("aria-current")).toBe("true");
    expect(document.querySelector('[data-preview-dot="1"]')!.className).toContain("bg-primary");
    await expect.element(page.getByText("Plain text of the file.")).toBeVisible();
    await page.getByRole("button", { name: "Next file" }).click();
    await expect.poll(() => text(document.querySelector("[data-preview-title]"))).toBe("claim 2025.pdf");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => text(document.querySelector("[data-preview-title]"))).toBe("time logs.xlsx");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => text(document.querySelector("[data-preview-title]"))).toBe("org chart.pdf");
    expect(page.getByRole("button", { name: "Previous file" }).element().hasAttribute("disabled")).toBe(true);
    // Focus stays inside.
    for (let i = 0; i < 6; i++) {
      await userEvent.keyboard("{Tab}");
      expect(document.activeElement?.closest("[data-company-file-preview]")).not.toBeNull();
    }
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => preview()).toBeNull();
    await expect.poll(() => document.activeElement?.closest("[data-company-file]")?.getAttribute("data-company-file")).toBe("f2");
    expect(document.activeElement?.hasAttribute("data-company-file-open")).toBe(true);
  });

  it("shows a Word file's text formatted in Text the AI reads", async () => {
    seed([listed("f1", "plan.docx", { fileType: "docx", textFormat: "markdown" })], []);
    __setQueryData("companyFiles:getCompanyFileContent", {
      fileName: "plan.docx",
      fileType: "docx",
      content: "# Plan\n\nThe seal **held**.",
      textFormat: "markdown",
    });
    await mount("writer");
    await page.getByRole("button", { name: "plan.docx", exact: true }).click();
    await page.getByRole("button", { name: "Text the AI reads" }).click();
    const markdown = page.getByTestId("company-file-preview-markdown");
    await expect.element(markdown.getByRole("heading", { name: "Plan" })).toBeVisible();
    expect(markdown.element().querySelector("strong")?.textContent).toBe("held");
  });

  it("says so when a file's text cannot be loaded", async () => {
    seed([listed("f1", "history.txt", { url: null, hasFile: false })], []);
    __setQueryError("companyFiles:getCompanyFileContent", new Error("down"));
    await mount("writer");
    await page.getByRole("button", { name: "history.txt", exact: true }).click();
    await expect.element(page.getByText("This file's text could not be loaded.")).toBeVisible();
  });
});

describe("the selection bar's bulk actions", () => {
  async function selectTwo() {
    await page.getByRole("button", { name: "Select" }).click();
    await page.getByRole("checkbox", { name: "Select claim 2025.pdf" }).click();
    await page.getByRole("checkbox", { name: "Select time logs.xlsx" }).click();
    await expect.element(page.getByRole("toolbar", { name: "Selected files" })).toBeVisible();
  }

  it("a Manager sees Move to fiscal year, Archive, Delete, Download and Clear, in that order", async () => {
    seed();
    await mount("manager");
    await selectTwo();
    const bar = page.getByRole("toolbar", { name: "Selected files" }).element();
    expect([...bar.querySelectorAll("button")].map((node) => node.getAttribute("aria-label") ?? text(node))).toEqual([
      "Move to fiscal year",
      "Archive",
      "Delete",
      "Download",
      "Clear selection",
    ]);
    expect(bar.querySelector("[data-company-files-delete]")!.className).toContain("text-danger-border");
    expect(bar.querySelector("[data-company-files-download]")!.className).toContain("bg-primary-selected");
  });

  it("someone who may not add files sees only Download and Clear", async () => {
    seed();
    await mount("viewer");
    await selectTwo();
    const bar = page.getByRole("toolbar", { name: "Selected files" }).element();
    expect([...bar.querySelectorAll("button")].map((node) => node.getAttribute("aria-label") ?? text(node))).toEqual(["Download", "Clear selection"]);
  });

  it("Move to fiscal year files every selected file under the year in one call, then clears the selection", async () => {
    seed();
    __setMutationResult("companyFiles:setCompanyFilesFiscalYear", { changed: 2 });
    await mount("writer");
    await selectTwo();
    await page.getByRole("button", { name: "Move to fiscal year" }).click();
    await page.getByRole("menuitem", { name: "FY 2024" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:setCompanyFilesFiscalYear")).toEqual([
      { clientId: "c3", companyFileIds: ["f1", "f2"], fiscalYear: 2024 },
    ]);
    await expect.poll(() => document.querySelector("[data-company-files-selection-bar]")).toBeNull();
  });

  it("Archive takes the selection at once, and one Undo restores the batch", async () => {
    seed();
    __setMutationResult("companyFiles:setCompanyFilesArchived", { changed: ["f1", "f2"] });
    await render(ToastHarness);
    await mount("manager");
    await selectTwo();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect.poll(() => __mutationCalls("companyFiles:setCompanyFilesArchived")).toEqual([
      { clientId: "c3", companyFileIds: ["f1", "f2"], archived: true },
    ]);
    await expect.element(page.getByText("2 files archived")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => __mutationCalls("companyFiles:setCompanyFilesArchived").at(-1)).toEqual({
      clientId: "c3",
      companyFileIds: ["f1", "f2"],
      archived: false,
    });
    expect(__mutationCalls("companyFiles:setCompanyFilesArchived")).toHaveLength(2);
  });

  it("Delete asks once for the whole selection, then removes them", async () => {
    seed();
    __setMutationResult("companyFiles:removeCompanyFiles", { removed: 2 });
    await mount("manager");
    await selectTwo();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toBeVisible();
    expect(text(dialog.element())).toContain("Delete 2 files?");
    expect(text(dialog.element())).toContain("They're removed for good. Drafts already written keep what they used.");
    expect(__mutationCalls("companyFiles:removeCompanyFiles")).toEqual([]);
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect.poll(() => __mutationCalls("companyFiles:removeCompanyFiles")).toEqual([{ clientId: "c3", companyFileIds: ["f1", "f2"] }]);
    await expect.poll(() => document.querySelector("[data-company-files-selection-bar]")).toBeNull();
  });
});

describe("captures", () => {
  // Written to the ignored .vitest-attachments/files-worker/ for review.
  const shot = (name: string) => page.screenshot({ path: `../../../../.vitest-attachments/files-worker/${name}.png` });

  it("the list, the selection bar, the add dialog, the drop overlay and a preview", async () => {
    seed();
    __setQueryData("companyFiles:getCompanyFileContent", { fileName: "x", fileType: "txt", content: "Dana,\n\nAgreed on running the sensor in both test rooms." });
    await mount("manager");
    await expect.poll(() => rowOf("f4")).not.toBeNull();
    await shot("list");

    await page.getByRole("button", { name: "Select" }).click();
    await page.getByRole("checkbox", { name: "Select claim 2025.pdf" }).click();
    await page.getByRole("checkbox", { name: "Select Website: example.com" }).click();
    await shot("selection-bar");
    await page.getByRole("button", { name: "Clear selection" }).click();

    const files = [new File(["x"], "a.pdf", { type: "application/pdf" }), new File(["x"], "b.txt", { type: "text/plain" })];
    drag("dragenter", document.body, files);
    await expect.poll(() => document.querySelector("[data-company-files-drop-overlay]")).not.toBeNull();
    await shot("drop-overlay");
    drag("dragleave", document.body, files);
    await expect.poll(() => document.querySelector("[data-company-files-drop-overlay]")).toBeNull();

    await page.getByRole("button", { name: "Add files" }).click();
    chooseIn(document.querySelector("[data-company-files-add-dialog]")!, bigFile("Full drawing set, scanned.pdf"));
    await expect.element(page.getByText("Too large, up to 50 MB").last()).toBeVisible();
    await shot("add-dialog");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-company-files-add-dialog]")).toBeNull();

    // The first, a middle and the last file: each sits centred.
    await page.getByRole("button", { name: "Preview org chart.pdf" }).click();
    await page.getByRole("button", { name: "Text the AI reads" }).click();
    await expect.element(page.getByText("Agreed on running the sensor", { exact: false })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 400));
    await shot("preview-first");
    await page.getByRole("button", { name: "Next file" }).click();
    await page.getByRole("button", { name: "Next file" }).click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await shot("preview-middle");
    await page.getByRole("button", { name: "Next file" }).click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    await shot("preview");
    await shot("preview-last");
  });
});

describe("review fixes", () => {
  it("the website file has no Replace file, and a file dropped on it is added", async () => {
    seed(defaultFiles().map((file) => (file._id === "f4" ? { ...file, fromWebsite: true } : file)));
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationResult("companyFiles:addCompanyFile", "f-new");
    await mount("manager");
    await page.getByRole("button", { name: "More actions for Website: example.com" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
    expect(document.querySelector('[role=menu] [data-company-file-action="replace"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    const files = [new File(["New."], "site.txt", { type: "text/plain" })];
    drag("dragenter", document.body, files);
    drag("dragover", rowOf("f4")!, files);
    expect(rowOf("f4")!.querySelector("[data-company-file-drop-replace]")).toBeNull();
    drag("drop", rowOf("f4")!, files);
    await expect.poll(() => __mutationCalls("companyFiles:addCompanyFile").length).toBe(1);
    expect(document.querySelector("[data-company-file-replace-dialog]")).toBeNull();
  });

  it("a Delete that fails part way says how many went and keeps the rest selected", async () => {
    const many = Array.from({ length: 60 }, (_, i) => listed(`m${i}`, `file ${i}.txt`, { fiscalYear: 2026 }));
    seed(many, []);
    let calls = 0;
    __setMutationResult("companyFiles:removeCompanyFiles", {
      then(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
        calls += 1;
        if (calls === 1) resolve({ removed: 50 });
        else reject({ data: { code: "INVALID_STATE", message: "The server is busy. Try again." } });
      },
    });
    await render(ToastHarness);
    await mount("manager");
    await page.getByRole("button", { name: "Select" }).click();
    for (const box of document.querySelectorAll<HTMLButtonElement>("[data-company-file-select]")) box.click();
    await expect.poll(() => text(document.querySelector("[data-company-files-selection-bar]"))).toContain("60 files selected");
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    expect(text(page.getByRole("alertdialog").element())).toContain("Delete 60 files?");
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect.element(page.getByText("Deleted 50 of 60 files. The rest could not be deleted: The server is busy. Try again.")).toBeVisible();
    const sent = __mutationCalls("companyFiles:removeCompanyFiles") as Array<{ companyFileIds: string[] }>;
    expect(sent.map((call) => call.companyFileIds.length)).toEqual([50, 10]);
    await expect.poll(() => text(document.querySelector("[data-company-files-selection-bar]"))).toContain("10 files selected");
    expect(document.querySelector('[data-company-file-select="m59"]')?.getAttribute("data-state")).toBe("checked");
    expect(document.querySelector('[data-company-file-select="m0"]')?.getAttribute("data-state")).toBe("unchecked");
  });

  it("no more than 200 files can be selected at once", async () => {
    seed(Array.from({ length: 201 }, (_, i) => listed(`s${i}`, `file ${i}.txt`)), []);
    await mount("writer");
    await page.getByRole("button", { name: "Select" }).click();
    for (const box of document.querySelectorAll<HTMLButtonElement>("[data-company-file-select]")) box.click();
    await expect.poll(() => text(document.querySelector("[data-company-files-selection-bar]"))).toContain("200 files selected, the most at once");
    expect(document.querySelectorAll('[data-company-file-select][data-state="checked"]')).toHaveLength(200);
    expect(document.querySelector('[data-company-file-select][data-state="unchecked"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("while a replacement saves, the dialog cannot be closed", async () => {
    seed();
    __setMutationResult("companyFiles:generateCompanyUploadUrl", "https://upload.test/bytes");
    __setMutationResult("companyFiles:replaceCompanyFile", new Promise(() => {}));
    await mount("manager");
    await page.getByRole("button", { name: "More actions for claim 2025.pdf" }).click();
    await page.getByRole("menuitem", { name: "Replace file" }).click();
    chooseIn(document.querySelector("[data-company-file-replace-dialog]")!, new File(["New."], "claim.txt", { type: "text/plain" }));
    await expect.element(page.getByText("Uploaded and read")).toBeVisible();
    await page.getByRole("button", { name: "Replace file" }).click();
    await expect.element(page.getByRole("button", { name: "Replacing..." })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector("[data-company-file-replace-dialog]")).not.toBeNull();
    expect(page.getByRole("button", { name: "Cancel" }).element().hasAttribute("disabled")).toBe(true);
    expect(page.getByRole("button", { name: "Close" }).element().hasAttribute("disabled")).toBe(true);
  });

  it("moving to another file stops the original's download", async () => {
    seed();
    const signals: AbortSignal[] = [];
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      if (String(input) === "https://files.test/f2" && init?.signal) signals.push(init.signal);
      // Never answers: the preview is still loading when it moves on.
      return await new Promise<Response>(() => {});
    });
    await mount("writer");
    await page.getByRole("button", { name: "Preview time logs.xlsx" }).click();
    await expect.poll(() => signals.length).toBe(1);
    expect(signals[0]!.aborted).toBe(false);
    await page.getByRole("button", { name: "Next file" }).click();
    await expect.poll(() => signals[0]!.aborted).toBe(true);
  });

  it("fits the file and the toolbar on a phone", async () => {
    seed(defaultFiles().map((file) => ({ ...file, url: null, hasFile: false })));
    __setQueryData("companyFiles:getCompanyFileContent", { fileName: "x", fileType: "txt", content: "Text." });
    await mount("writer");
    await page.viewport(390, 844);
    await page.getByRole("button", { name: "Preview Website: example.com" }).click();
    await expect.poll(() => text(document.querySelector("[data-preview-title]"))).toBe("Website: example.com");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const slide = document.querySelector('[data-preview-slide="f4"]')!.getBoundingClientRect();
    expect(slide.left).toBeGreaterThanOrEqual(0);
    expect(slide.right).toBeLessThanOrEqual(390);
    const toolbar = document.querySelector("[data-preview-toolbar]")!;
    for (const child of toolbar.children) expect(child.getBoundingClientRect().right).toBeLessThanOrEqual(390);
    expect(document.querySelector("[data-preview-title]")!.getBoundingClientRect().width).toBeGreaterThan(100);
  });

  it("the last file sits centred, with its neighbour peeking", async () => {
    seed(defaultFiles().map((file) => ({ ...file, url: null, hasFile: false })));
    __setQueryData("companyFiles:getCompanyFileContent", { fileName: "x", fileType: "txt", content: "Text." });
    await mount("writer");
    await page.getByRole("button", { name: "Preview Website: example.com" }).click();
    await expect.poll(() => text(document.querySelector("[data-preview-title]"))).toBe("Website: example.com");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const viewport = document.querySelector("[data-preview-viewport]")!.getBoundingClientRect();
    const slide = document.querySelector('[data-preview-slide="f4"]')!.getBoundingClientRect();
    expect(Math.abs(slide.left + slide.width / 2 - (viewport.left + viewport.width / 2))).toBeLessThan(4);
    const before = document.querySelector('[data-preview-slide="f1"]')!.getBoundingClientRect();
    expect(before.right).toBeGreaterThan(viewport.left);
  });
});
