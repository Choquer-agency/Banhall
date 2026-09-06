import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { Id } from "../../../../convex/_generated/dataModel";
import AgentChatPanel from "./AgentChatPanel.svelte";
import { ATTEMPT_BATCH_LIMIT } from "$lib/uploads/outboxFlush";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { spreadsheetFixture } from "$lib/test/spreadsheetFixtures";
import { __resetConvexStub, __setQueryData, __setPaginatedRows, __setMutationResult, __setMutationError, __mutationCalls } from "$lib/test/convex-svelte-stub.svelte";
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  __resetConvexStub(); __resetAuthState(); localStorage.clear();
  for (const name of ["chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions"]) __setQueryData(name, []);
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
});
function selectFile(file: File) {
  const input = document.querySelector('input[type="file"][multiple]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Upload input missing");
  const files = new DataTransfer();
  files.items.add(file);
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return input;
}
async function attach(file: File) {
  selectFile(file);
  await page.getByRole("button", { name: "Writer's notes", exact: true }).click();
}
const owner = { projectId: "project-before" as Id<"projects">, reportId: "report-before" as Id<"reports"> };
it("does not register later upload batches after the owning project changes", async () => {
  let finish: (value: null) => void = () => {};
  __setMutationResult("uploadAttempts:recordUploadAttempts", new Promise(resolve => { finish = resolve; }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const view = await render(AgentChatPanel, { projectId: "project-before" as Id<"projects">, reportId: "report-before" as Id<"reports"> });
  const input = document.querySelector('input[type="file"][multiple]');
  if (!(input instanceof HTMLInputElement)) throw new Error("Upload input missing");
  const files = new DataTransfer();
  for (let index = 0; index <= ATTEMPT_BATCH_LIMIT; index++) files.items.add(new File(["text"], `notes-${index}.txt`));
  input.files = files.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  await page.getByRole("button", { name: "Writer's notes", exact: true }).click();
  await expect.poll(() => __mutationCalls("uploadAttempts:recordUploadAttempts").length).toBe(1);
  await view.rerender({ projectId: "project-after" as Id<"projects">, reportId: "report-after" as Id<"reports"> });
  finish(null);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toHaveLength(1);
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
  expect(__mutationCalls("documents:generateUploadUrl")).toEqual([]);
  await expect.element(page.getByRole("region", { name: "Uploads", exact: true })).not.toBeInTheDocument();
});

it.each(["registration", "spreadsheet read"])("clears canceled receipts when the report changes during %s", async stage => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const file = spreadsheetFixture("xlsx");
  const bytes = await file.arrayBuffer();
  let finishRegistration: (value: null) => void = () => {};
  let finishRead: (value: ArrayBuffer) => void = () => {};
  if (stage === "registration") {
    __setMutationResult("uploadAttempts:recordUploadAttempts", new Promise(resolve => { finishRegistration = resolve; }));
  }
  const read = vi.spyOn(File.prototype, "arrayBuffer");
  if (stage === "spreadsheet read") read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const terminate = vi.spyOn(Worker.prototype, "terminate");
  const view = await render(AgentChatPanel, owner);
  const composer = page.getByRole("textbox", { name: "Message the report assistant" });
  await composer.fill("Keep this draft");
  await attach(file);
  await expect.poll(() => stage === "registration"
    ? __mutationCalls("uploadAttempts:recordUploadAttempts").length
    : read.mock.calls.length).toBe(1);
  await expect.element(page.getByRole("region", { name: "Uploads", exact: true })).toHaveTextContent(file.name);
  await view.rerender({ ...owner, reportId: "report-after" as Id<"reports"> });
  finishRegistration(null);
  finishRead(bytes);
  if (stage === "spreadsheet read") await expect.poll(() => terminate.mock.calls.length).toBe(1);
  await expect.element(page.getByRole("region", { name: "Uploads", exact: true })).not.toBeInTheDocument();
  await expect.element(composer).toHaveValue("Keep this draft");
  expect(__mutationCalls("documents:generateUploadUrl")).toEqual([]);
  expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toHaveLength(1);
});

it("retains same-owner receipts but removes canceled retries before another report can use them", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ storageId: "original-bytes" }));
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/original");
  __setMutationResult("documents:uploadDocument", "stored-document");
  const view = await render(AgentChatPanel, owner);
  await attach(new File(["Saved evidence"], "completed.txt"));
  const receipt = page.getByRole("region", { name: "Uploads", exact: true });
  await expect.element(receipt).toHaveTextContent("Ready for AI");
  await view.rerender({ ...owner, pendingHighlight: { from: 1, to: 3, text: "Selection" } });
  await expect.element(receipt).toHaveTextContent("completed.txt");
  __setMutationError("documents:uploadDocument", new Error("Upload failed"));
  await attach(new File(["Retry evidence"], "retry.txt"));
  const retry = page.getByRole("button", { name: "Retry — retry.txt", exact: true });
  await expect.element(retry).toBeVisible();
  await expect.element(receipt).toHaveTextContent("completed.txt");
  let finish: (value: null) => void = () => {};
  __setMutationResult("uploadAttempts:recordUploadAttempts", new Promise(resolve => { finish = resolve; }));
  const previousRegistrations = __mutationCalls("uploadAttempts:recordUploadAttempts").length;
  await retry.click();
  await expect.poll(() => __mutationCalls("uploadAttempts:recordUploadAttempts").length).toBe(previousRegistrations + 1);
  await view.rerender({ ...owner, reportId: "report-after" as Id<"reports"> });
  finish(null);
  await expect.element(receipt).not.toBeInTheDocument();
  await expect.element(retry).not.toBeInTheDocument();
  expect(__mutationCalls("documents:uploadDocument")).toHaveLength(2);
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toHaveLength(previousRegistrations + 1);
});

it("discards a file selected before its category when the owner changes", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ storageId: "original-bytes" }));
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/original");
  __setMutationResult("documents:uploadDocument", "stored-document");
  const view = await render(AgentChatPanel, owner);
  const composer = page.getByRole("textbox", { name: "Message the report assistant" });
  await composer.fill("Keep my text draft");
  const picker = selectFile(new File(["Old owner evidence"], "old-selection.txt"));
  const category = page.getByRole("button", { name: "Writer's notes", exact: true });
  await expect.element(category).toBeVisible();
  const nextOwner = { projectId: "project-after" as Id<"projects">, reportId: "report-after" as Id<"reports"> };
  await view.rerender(nextOwner);
  await expect.element(category).not.toBeInTheDocument();
  expect(picker.files?.length).toBe(0);
  await expect.element(composer).toHaveValue("Keep my text draft");
  expect(__mutationCalls("uploadAttempts:recordUploadAttempts")).toEqual([]);
  await attach(new File(["New owner evidence"], "new-selection.txt"));
  await expect.element(page.getByRole("region", { name: "Uploads", exact: true })).toHaveTextContent("Ready for AI");
  expect(__mutationCalls("documents:uploadDocument")).toEqual([expect.objectContaining({ ...nextOwner, fileName: "new-selection.txt" })]);
});

it("clears old-project attachment pills without clearing the text draft", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ storageId: "original-bytes" }));
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/original");
  __setMutationResult("documents:uploadDocument", "stored-document");
  const view = await render(AgentChatPanel, owner);
  const composer = page.getByRole("textbox", { name: "Message the report assistant" });
  await composer.fill("Keep my text draft");
  await attach(new File(["Old owner evidence"], "old-context.txt"));
  await expect.element(page.getByRole("region", { name: "Uploads", exact: true })).toHaveTextContent("Ready for AI");
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  const attachment = page.getByText("Project context", { exact: true });
  await view.rerender({ ...owner, pendingHighlight: { from: 1, to: 3, text: "Selection" } });
  await expect.element(attachment).toBeVisible();
  await view.rerender({ projectId: "project-after" as Id<"projects">, reportId: "report-after" as Id<"reports"> });
  await expect.element(attachment).not.toBeInTheDocument();
  await expect.element(composer).toHaveValue("Keep my text draft");
  expect(__mutationCalls("documents:uploadDocument")).toHaveLength(1);
});
