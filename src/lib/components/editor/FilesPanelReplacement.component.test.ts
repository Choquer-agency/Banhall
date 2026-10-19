import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { toast } from "svelte-sonner";
import FilesPanel from "./FilesPanel.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import { spreadsheetFixture } from "$lib/test/spreadsheetFixtures";
import { REPLACE_UNCHANGED_COPY } from "$lib/uploads/processingStatus";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

// These identify records in the local test registry, not a Convex deployment.
const originalProjectId = "original-project" as Id<"projects">;
const nextProjectId = "next-project" as Id<"projects">;

beforeEach(() => {
  __resetConvexStub();
  __setQueryData("documents:listDocuments", [{
    _id: "original-document",
    fileName: "original.txt",
    fileType: "txt",
    source: "chat_upload",
    category: null,
    createdAt: 1,
    sizeChars: 0,
    archived: false,
    processingStatus: "could_not_read",
    processingDetail: null,
  }]);
  __setQueryData("transcripts:listTranscripts", []);
  __setQueryData("uploadAttempts:listUploadAttempts", []);
  // Replace file is offered only to people who may edit the report.
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/original");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ storageId: "original-bytes" }));
});
afterEach(() => vi.restoreAllMocks());

async function chooseReplacement(file = new File(["Replacement evidence."], "replacement.txt")) {
  await page.getByRole("button", { name: "Replace file… — original.txt", exact: true }).click();
  const input = document.querySelector('input[type="file"][aria-hidden="true"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing replacement file input");
  const files = new DataTransfer();
  files.items.add(file);
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function replace(file?: File) {
  await chooseReplacement(file);
  await page.getByRole("button", { name: "Replace file", exact: true }).click();
}

it("discards a staged replacement confirmation when its project changes", async () => {
  const view = await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
  await chooseReplacement();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await view.rerender({ projectId: originalProjectId });
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await view.rerender({ projectId: nextProjectId });
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
  expect(__mutationCalls("documents:deleteDocument")).toEqual([]);
});

it("continues a pending replacement after a same-owner rerender", async () => {
  let finish: (value: string) => void = () => {};
  __setMutationResult("documents:uploadDocument", new Promise(resolve => { finish = resolve; }));
  const view = await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
  await replace();
  await expect.poll(() => __mutationCalls("documents:uploadDocument").length).toBe(1);
  await view.rerender({ projectId: originalProjectId });
  finish("replacement-document");
  await expect.poll(() => __mutationCalls("documents:deleteDocument")).toEqual([{ documentId: "original-document" }]);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

for (const change of ["owner change", "unmount"]) {
  it.each(["resolve", "reject"])(`stops replacement side effects after ${change} when its final upload %s`, async outcome => {
    let finish: (value: string) => void = () => {};
    let fail: (error: Error) => void = () => {};
    __setMutationResult("documents:uploadDocument", new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }));
    const errorToast = vi.spyOn(toast, "error");
    const view = await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
    await replace();
    await expect.poll(() => __mutationCalls("documents:uploadDocument").length).toBe(1);
    if (change === "owner change") await view.rerender({ projectId: nextProjectId });
    else await view.unmount();
    if (outcome === "resolve") finish("replacement-document");
    else fail(new Error("Late upload failure"));
    await new Promise(resolve => setTimeout(resolve, 100));
    if (change === "owner change") {
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    }
    expect(__mutationCalls("documents:deleteDocument")).toEqual([]);
    expect(__mutationCalls("uploadAttempts:failUploadAttempt")).toEqual([]);
    expect(errorToast).not.toHaveBeenCalled();
  });

  it(`terminates the replacement workbook worker after ${change} and ignores its late file read`, async () => {
    const workbook = spreadsheetFixture("xlsx");
    const bytes = await workbook.arrayBuffer();
    let finishRead: (value: ArrayBuffer) => void = () => {};
    const read = vi.spyOn(File.prototype, "arrayBuffer").mockImplementationOnce(() => new Promise(resolve => {
      finishRead = resolve;
    }));
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    const errorToast = vi.spyOn(toast, "error");
    const view = await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
    await replace(workbook);
    await expect.poll(() => read.mock.calls.length).toBe(1);
    if (change === "owner change") await view.rerender({ projectId: nextProjectId });
    else await view.unmount();
    await expect.poll(() => terminate.mock.calls.length).toBe(1);
    finishRead(bytes);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(__mutationCalls("documents:generateUploadUrl")).toEqual([]);
    expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
    expect(__mutationCalls("documents:deleteDocument")).toEqual([]);
    expect(__mutationCalls("uploadAttempts:failUploadAttempt")).toEqual([]);
    expect(errorToast).not.toHaveBeenCalled();
  });
}

it.each(["replacement-document", "original-document"])("preserves successful replacement and deduplication when upload returns %s", async documentId => {
  __setMutationResult("documents:uploadDocument", documentId);
  const infoToast = vi.spyOn(toast, "info");
  await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
  await replace();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(__mutationCalls("documents:uploadDocument")).toEqual([expect.objectContaining({
    projectId: originalProjectId,
    fileName: "replacement.txt",
    content: "Replacement evidence.",
    storageId: "original-bytes",
  })]);
  expect(__mutationCalls("documents:deleteDocument")).toEqual(documentId === "original-document"
    ? [] : [{ documentId: "original-document" }]);
  if (documentId === "original-document") expect(infoToast).toHaveBeenCalledWith(REPLACE_UNCHANGED_COPY);
  expect(__mutationCalls("uploadAttempts:failUploadAttempt")).toEqual([]);
});

const failedAttempt = {
  attemptKey: "22222222-2222-4222-8222-222222222222",
  fileName: "failed.txt",
  fileSizeBytes: 12,
  origin: "context_input",
  failureCode: "upload_failed",
  createdAt: 1,
  displayStatus: "failed",
};

it.each([
  ["cannot edit the report", { canEditDetails: false }],
  ["edit access is still loading", undefined],
])("offers no Replace file when the viewer %s, and its advice does not name one", async (_case, access) => {
  __setQueryData("projects:getProjectEditAccess", access);
  __setQueryData("uploadAttempts:listUploadAttempts", [failedAttempt]);
  await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
  await expect.element(page.getByText("original.txt", { exact: true })).toBeVisible();
  await expect.element(page.getByText("failed.txt", { exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /^Replace file/ }).elements()).toHaveLength(0);
  expect(document.body.textContent).not.toContain("Replace file");
  // Nor does it tell this viewer to add a file themselves.
  expect(document.body.textContent).not.toContain("from the Files panel");
  expect(document.body.textContent).toContain("Someone who can edit this report can add a text-based version.");
  expect(document.body.textContent).toContain("Someone who can edit this report can upload it again.");
  // Remove a failed row needs no edit access, so it stays.
  await expect.element(page.getByRole("button", { name: "Remove — failed.txt", exact: true })).toBeVisible();
});

it("offers no Replace file when the project's files cannot be seen", async () => {
  __setQueryData("uploadAttempts:listUploadAttempts", null);
  await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
  await expect.element(page.getByText("You don't have permission to view this project's files.", { exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /^Replace file/ }).elements()).toHaveLength(0);
});

it("offers Replace file on a file and on a failed upload to someone who may edit the report", async () => {
  __setQueryData("uploadAttempts:listUploadAttempts", [failedAttempt]);
  await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
  await expect.element(page.getByRole("button", { name: "Replace file… — original.txt", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Replace file… — failed.txt", exact: true })).toBeVisible();
});

it("closes a staged replacement when edit access is withdrawn", async () => {
  await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
  await chooseReplacement();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: false });
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
});

async function replaceFailedUpload(file: File, attempt = failedAttempt) {
  __setQueryData("uploadAttempts:listUploadAttempts", [attempt]);
  await render(FilesPanel, { projectId: originalProjectId, initiallyOpen: true });
  const button = page.getByRole("button", { name: `Replace file… — ${attempt.fileName}`, exact: true });
  await button.click();
  const input = button.element().closest("li")?.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Missing row replacement input");
  const files = new DataTransfer();
  files.items.add(file);
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

it("asks for the category before replacing a failed upload, so it keeps its weight", async () => {
  __setMutationResult("documents:uploadDocument", "replacement-document");
  await replaceFailedUpload(new File(["Interview direction."], "notes-again.txt"));
  const picker = page.getByRole("group", { name: "Choose a category for “notes-again.txt”." });
  await expect.element(picker).toBeVisible();
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
  await page.getByRole("button", { name: "Writer's notes", exact: true }).click();
  await expect.element(picker).not.toBeInTheDocument();
  await expect.poll(() => __mutationCalls("documents:uploadDocument")).toEqual([expect.objectContaining({
    projectId: originalProjectId,
    fileName: "notes-again.txt",
    source: "context_input",
    category: "writer_notes",
    attemptKey: failedAttempt.attemptKey,
  })]);
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([{
    projectId: originalProjectId,
    attempts: [expect.objectContaining({ attemptKey: failedAttempt.attemptKey, origin: "context_input" })],
  }]);
});

it("saves nothing when the category question is cancelled", async () => {
  await replaceFailedUpload(new File(["Interview direction."], "notes-again.txt"));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.element(page.getByRole("group", { name: /^Choose a category/ })).not.toBeInTheDocument();
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
});

it("replaces a failed PD under review without a category question", async () => {
  __setMutationResult("documents:uploadDocument", "replacement-document");
  await replaceFailedUpload(new File(["Project description."], "pd-again.txt"), {
    ...failedAttempt, fileName: "pd.txt", origin: "review_pd",
  });
  await expect.poll(() => __mutationCalls("documents:uploadDocument").length).toBe(1);
  expect(page.getByRole("group", { name: /^Choose a category/ }).elements()).toHaveLength(0);
  const [saved] = __mutationCalls("documents:uploadDocument") as Record<string, unknown>[];
  expect(saved).toMatchObject({ source: "review_pd", fileName: "pd-again.txt" });
  expect(saved).not.toHaveProperty("category");
});
