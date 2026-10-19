import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import FilesPanel from "./FilesPanel.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import { toast } from "svelte-sonner";
import { outboxKey } from "$lib/uploads/attemptOutbox";
import { alreadyInProjectCopy } from "$lib/uploads/processingStatus";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

// Owner, 2026-10-19: the chat no longer takes files, so the files panel is
// where a writer adds supporting files to an existing project. All names here
// are fictional; they identify records in the local test registry only.
const projectId = "project-1" as Id<"projects">;
const userId = "user-1";
const addFiles = () => page.getByRole("button", { name: "Add files", exact: true });
const picker = () => page.getByRole("group", { name: /^Choose a category for/ });
const category = (name: string) => page.getByRole("button", { name, exact: true });
const filesInput = () => document.querySelector<HTMLInputElement>("input[data-add-files-input]");
const recorded = () =>
  __mutationCalls("uploadAttempts:recordUploadAttempts") as {
    projectId: string;
    attempts: { attemptKey: string; fileName: string; origin: string; failureCode?: string }[];
  }[];
const uploaded = () =>
  __mutationCalls("documents:uploadDocument") as {
    projectId: string;
    fileName: string;
    content: string;
    source: string;
    category?: string;
    attemptKey: string;
    storageId?: string;
  }[];

function choose(...files: File[]) {
  const input = filesInput();
  if (!input) throw new Error("Add files input missing");
  const list = new DataTransfer();
  for (const file of files) list.items.add(file);
  input.files = list.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function listedDocument(id: string, fileName: string) {
  return {
    _id: id,
    fileName,
    fileType: "txt",
    source: "context_input",
    category: "writer_notes",
    createdAt: 1,
    sizeChars: 20,
    archived: false,
    processingStatus: "ready",
    processingDetail: null,
  };
}

beforeEach(() => {
  __resetConvexStub();
  __resetAuthState();
  localStorage.clear();
  __setQueryData("documents:listDocuments", []);
  __setQueryData("transcripts:listTranscripts", []);
  __setQueryData("uploadAttempts:listUploadAttempts", []);
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("users:getCurrentUser", { _id: userId, role: "writer" });
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/bytes");
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ storageId: "stored-bytes" }));
});
afterEach(() => vi.restoreAllMocks());

it("adds a file under the chosen category and shows it until the list has it", async () => {
  let finish: (id: string) => void = () => {};
  __setMutationResult("documents:uploadDocument", new Promise(resolve => { finish = resolve; }));
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await expect.element(page.getByText("No supporting files yet.", { exact: true })).toBeVisible();
  await addFiles().click();
  choose(new File(["Field notes from the second trial."], "trial-notes.txt", { type: "text/plain" }));
  await expect.element(picker()).toHaveAccessibleName("Choose a category for “trial-notes.txt”.");
  // Focus moves into the question so a keyboard user can answer it.
  await expect.element(category("Writer's notes")).toHaveFocus();
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);

  await category("Writer's notes").click();
  await expect.element(picker()).not.toBeInTheDocument();
  await expect.element(addFiles()).toHaveFocus();
  await expect.element(page.getByText("Reading…", { exact: true })).toBeVisible();
  await expect.poll(() => uploaded().length).toBe(1);
  const [opened] = recorded();
  expect(opened).toEqual({
    projectId,
    attempts: [expect.objectContaining({ fileName: "trial-notes.txt", origin: "context_input" })],
  });
  expect(opened.attempts[0].failureCode).toBeUndefined();
  expect(uploaded()[0]).toEqual(expect.objectContaining({
    projectId,
    fileName: "trial-notes.txt",
    content: "Field notes from the second trial.",
    source: "context_input",
    category: "writer_notes",
    attemptKey: opened.attempts[0].attemptKey,
    storageId: "stored-bytes",
    extractionOutcome: "ok",
  }));

  finish("document-1");
  await expect.element(page.getByText("Ready for AI", { exact: true })).toBeVisible();
  // Once the list carries the file it is drawn there, once.
  __setQueryData("documents:listDocuments", [listedDocument("document-1", "trial-notes.txt")]);
  await expect.element(page.getByText("No supporting files yet.", { exact: true })).not.toBeInTheDocument();
  await expect.poll(() => page.getByText("trial-notes.txt", { exact: true }).elements().length).toBe(1);
  await expect.element(addFiles()).toBeVisible();
});

it("asks once for several files and uploads them one at a time", async () => {
  __setMutationResult("documents:uploadDocument", "document-1");
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["One"], "scoping-a.txt"), new File(["Two"], "scoping-b.txt"));
  await expect.element(picker()).toHaveAccessibleName("Choose a category for these 2 files.");
  await category("Scoping notes").click();
  await expect.poll(() => uploaded().map(call => [call.fileName, call.category])).toEqual([
    ["scoping-a.txt", "scoping_notes"],
    ["scoping-b.txt", "scoping_notes"],
  ]);
  expect(recorded()[0].attempts.map(attempt => attempt.fileName)).toEqual(["scoping-a.txt", "scoping-b.txt"]);
});

it("cancels without uploading and returns focus to Add files", async () => {
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Draft"], "draft.txt"));
  await category("Cancel").click();
  await expect.element(picker()).not.toBeInTheDocument();
  await expect.element(addFiles()).toHaveFocus();
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
});

it("retries a failed upload under the same attempt", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  __setMutationError("documents:uploadDocument", new Error("Upload refused"));
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Lab results"], "lab-results.txt"));
  await category("Background research").click();
  const retry = page.getByRole("button", { name: "Retry — lab-results.txt", exact: true });
  await expect.element(retry).toBeVisible();
  await expect.element(page.getByText("Upload failed", { exact: true })).toBeVisible();
  const attemptKey = uploaded()[0].attemptKey;
  await expect.poll(() => recorded().at(-1)).toEqual({
    projectId,
    attempts: [expect.objectContaining({ attemptKey, origin: "context_input", failureCode: "upload_failed" })],
  });

  __setMutationResult("documents:uploadDocument", "document-2");
  await retry.click();
  await expect.element(page.getByText("Ready for AI", { exact: true })).toBeVisible();
  expect(uploaded().map(call => [call.attemptKey, call.category])).toEqual([
    [attemptKey, "background"],
    [attemptKey, "background"],
  ]);
  await expect.element(retry).not.toBeInTheDocument();
});

it("removes a failed upload and dismisses its attempt", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  __setMutationError("documents:uploadDocument", new Error("Upload refused"));
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Lab results"], "lab-results.txt"));
  await category("Other supporting docs").click();
  const remove = page.getByRole("button", { name: "Remove — lab-results.txt", exact: true });
  await expect.element(remove).toBeVisible();
  const attemptKey = uploaded()[0].attemptKey;
  await remove.click();
  await expect.element(remove).not.toBeInTheDocument();
  expect(__mutationCalls("uploadAttempts:dismissUploadAttempt")).toEqual([{ projectId, attemptKey }]);
  await expect.element(page.getByText("No supporting files yet.", { exact: true })).toBeVisible();
});

it("records an unsupported file without asking for a category", async () => {
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["binary"], "bundle.zip"));
  await expect.element(page.getByText("Skipped — unsupported type", { exact: true })).toBeVisible();
  expect(picker().elements()).toHaveLength(0);
  await expect.poll(() => recorded()).toEqual([{
    projectId,
    attempts: [expect.objectContaining({ fileName: "bundle.zip", origin: "context_input", failureCode: "rejected_unsupported" })],
  }]);
  await page.getByRole("button", { name: "Remove — bundle.zip", exact: true }).click();
  await expect.element(page.getByText("bundle.zip", { exact: true })).not.toBeInTheDocument();
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
});

it("keeps a failure in this browser when the server cannot be reached", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  __setMutationError("documents:uploadDocument", new TypeError("Failed to fetch"));
  __setMutationError("uploadAttempts:recordUploadAttempts", new TypeError("Failed to fetch"));
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Lab results"], "lab-results.txt"));
  await category("Writer's notes").click();
  await expect.element(page.getByText("Upload failed", { exact: true })).toBeVisible();
  await expect.poll(() => JSON.parse(localStorage.getItem(outboxKey(userId)) ?? "[]")).toEqual([
    expect.objectContaining({
      userId,
      projectId,
      fileName: "lab-results.txt",
      origin: "context_input",
      failureCode: "upload_failed",
    }),
  ]);
});

it("discards a waiting choice when the project changes", async () => {
  const view = await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Draft"], "draft.txt"));
  await expect.element(picker()).toBeVisible();
  await view.rerender({ projectId: "project-2" as Id<"projects"> });
  await expect.element(picker()).not.toBeInTheDocument();
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
});

it.each([
  ["cannot edit the report", { canEditDetails: false }, []],
  ["edit access is still loading", undefined, []],
  ["the project's files are not visible", { canEditDetails: true }, null],
])("offers no Add files when the viewer %s", async (_case, access, attempts) => {
  __setQueryData("projects:getProjectEditAccess", access);
  __setQueryData("uploadAttempts:listUploadAttempts", attempts);
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await expect.element(page.getByRole("button", { name: "Files", exact: false }).first()).toBeVisible();
  expect(addFiles().elements()).toHaveLength(0);
  expect(filesInput()).toBeNull();
});

it("offers Add files beside existing files to someone who may edit the report", async () => {
  __setQueryData("documents:listDocuments", [listedDocument("document-1", "existing-notes.txt")]);
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await expect.element(page.getByText("existing-notes.txt", { exact: true })).toBeVisible();
  await expect.element(addFiles()).toBeVisible();
  expect(filesInput()?.multiple).toBe(true);
  expect(filesInput()?.accept).toContain(".pdf");
});

it("keeps a removed row hidden while the server dismisses it", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  __setMutationError("documents:uploadDocument", new Error("Upload refused"));
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Lab results"], "lab-results.txt"));
  await category("Writer's notes").click();
  const remove = page.getByRole("button", { name: "Remove — lab-results.txt", exact: true });
  await expect.element(remove).toBeVisible();
  const attemptKey = uploaded()[0].attemptKey;
  // The server lists the same failure under the same key.
  __setQueryData("uploadAttempts:listUploadAttempts", [{
    attemptKey, fileName: "lab-results.txt", fileSizeBytes: 11, origin: "context_input",
    failureCode: "upload_failed", createdAt: 1, displayStatus: "failed",
  }]);
  let finish: (value: null) => void = () => {};
  __setMutationResult("uploadAttempts:dismissUploadAttempt", new Promise(resolve => { finish = resolve; }));
  await remove.click();
  await expect.element(page.getByText("lab-results.txt", { exact: true })).not.toBeInTheDocument();
  await expect.element(addFiles()).toHaveFocus();
  finish(null);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(page.getByText("lab-results.txt", { exact: true }).elements()).toHaveLength(0);
});

it("shows the server's row again, with a notice, when the dismiss fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const errorToast = vi.spyOn(toast, "error");
  __setMutationError("documents:uploadDocument", new Error("Upload refused"));
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Lab results"], "lab-results.txt"));
  await category("Writer's notes").click();
  await expect.element(page.getByRole("button", { name: "Remove — lab-results.txt", exact: true })).toBeVisible();
  const attemptKey = uploaded()[0].attemptKey;
  __setQueryData("uploadAttempts:listUploadAttempts", [{
    attemptKey, fileName: "lab-results.txt", fileSizeBytes: 11, origin: "context_input",
    failureCode: "upload_failed", createdAt: 1, displayStatus: "failed",
  }]);
  __setMutationError("uploadAttempts:dismissUploadAttempt", new Error("Dismiss refused"));
  await page.getByRole("button", { name: "Remove — lab-results.txt", exact: true }).click();
  await expect.poll(() => errorToast.mock.calls.length).toBe(1);
  // Now the server's copy, which offers Replace in place of Retry.
  await expect.element(page.getByRole("button", { name: "Replace file… — lab-results.txt", exact: true })).toBeVisible();
});

it("clears this browser's queued failure when its row is removed", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  __setMutationError("documents:uploadDocument", new TypeError("Failed to fetch"));
  __setMutationError("uploadAttempts:recordUploadAttempts", new TypeError("Failed to fetch"));
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Lab results"], "lab-results.txt"));
  await category("Writer's notes").click();
  await expect.poll(() => JSON.parse(localStorage.getItem(outboxKey(userId)) ?? "[]").length).toBe(1);
  await page.getByRole("button", { name: "Remove — lab-results.txt", exact: true }).click();
  await expect.poll(() => localStorage.getItem(outboxKey(userId))).toBeNull();
  expect(__mutationCalls("uploadAttempts:dismissUploadAttempt")).toEqual([
    { projectId, attemptKey: uploaded()[0].attemptKey },
  ]);
});

it("lets a new project add files while the old project's upload is still settling", async () => {
  __setMutationResult("documents:uploadDocument", new Promise(() => {}));
  const view = await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["One"], "first.txt"));
  await category("Writer's notes").click();
  await expect.poll(() => uploaded().length).toBe(1);
  await expect.element(addFiles()).toHaveAttribute("aria-disabled", "true");

  const nextProject = "project-2" as Id<"projects">;
  await view.rerender({ projectId: nextProject });
  await expect.element(addFiles()).toHaveAttribute("aria-disabled", "false");
  await addFiles().click();
  choose(new File(["Two"], "second.txt"));
  await category("Scoping notes").click();
  await expect.poll(() => uploaded().map(call => [call.projectId, call.fileName])).toEqual([
    [projectId, "first.txt"],
    [nextProject, "second.txt"],
  ]);
});

it("retries a failed file while another batch is uploading", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  __setMutationError("documents:uploadDocument", new Error("Upload refused"));
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Lab results"], "lab-results.txt"));
  await category("Writer's notes").click();
  const retry = page.getByRole("button", { name: "Retry — lab-results.txt", exact: true });
  await expect.element(retry).toBeVisible();

  __setMutationResult("documents:uploadDocument", new Promise(() => {}));
  await addFiles().click();
  choose(new File(["Survey"], "survey.txt"));
  await category("Background research").click();
  await expect.poll(() => uploaded().length).toBe(2);
  await expect.element(addFiles()).toHaveAttribute("aria-disabled", "true");
  await expect.element(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => uploaded().map(call => call.fileName)).toEqual([
    "lab-results.txt", "survey.txt", "lab-results.txt",
  ]);
});

it("says so when an added file is already in the project", async () => {
  const infoToast = vi.spyOn(toast, "info");
  __setQueryData("documents:listDocuments", [listedDocument("document-1", "trial-notes.txt")]);
  __setMutationResult("documents:uploadDocument", "document-1");
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await addFiles().click();
  choose(new File(["Same notes"], "trial-notes.txt"));
  await category("Writer's notes").click();
  await expect.poll(() => infoToast.mock.calls).toEqual([[alreadyInProjectCopy("trial-notes.txt")]]);
  expect(page.getByText("trial-notes.txt", { exact: true }).elements()).toHaveLength(1);
});
