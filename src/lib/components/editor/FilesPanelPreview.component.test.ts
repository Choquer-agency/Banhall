import { beforeEach, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import FilesPanel from "./FilesPanel.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/**
 * 2026-10-26 (owner): a Word file stored as Markdown is previewed formatted,
 * with its headings, bold, italic and tables; other text stays as it is.
 */

// These identify records in the local test registry, not a Convex deployment.
const projectId = "preview-project" as Id<"projects">;

function listed(fileName: string, fileType: string) {
  return {
    _id: `doc-${fileName}`,
    fileName,
    fileType,
    source: "chat_upload",
    category: null,
    createdAt: 1,
    sizeChars: 100,
    archived: false,
    processingStatus: "ready",
    processingDetail: "text_extracted",
  };
}

beforeEach(() => {
  __resetConvexStub();
  __setQueryData("transcripts:listTranscripts", []);
  __setQueryData("uploadAttempts:listUploadAttempts", []);
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
});

it("shows a Word file's Markdown formatted", async () => {
  __setQueryData("documents:listDocuments", [listed("trials.docx", "docx")]);
  __setQueryData("documents:getDocumentContent", {
    fileName: "trials.docx",
    fileType: "docx",
    content: "# Seal trials\n\nThe seal **held** at *4.2 bar*.\n\n| Trial | Pressure |\n| --- | --- |\n| 2 | 4.2 bar |",
    textFormat: "markdown",
  });
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await page.getByTitle("Preview").click();
  const preview = page.getByTestId("file-preview-markdown");
  await expect.element(preview.getByRole("heading", { name: "Seal trials" })).toBeVisible();
  await expect.element(preview.getByText("held", { exact: true })).toBeVisible();
  expect(preview.element().querySelector("strong")?.textContent).toBe("held");
  expect(preview.element().querySelector("em")?.textContent).toBe("4.2 bar");
  expect(preview.element().querySelector("table")).not.toBeNull();
  expect(preview.element().textContent).not.toContain("**");
});

it("never loads an image from a file's Markdown", async () => {
  __setQueryData("documents:listDocuments", [listed("probe.docx", "docx")]);
  __setQueryData("documents:getDocumentContent", {
    fileName: "probe.docx",
    fileType: "docx",
    content: "A ![probe](//example.invalid/pixel) and ![local](/favicon.png).",
    textFormat: "markdown",
  });
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await page.getByTitle("Preview").click();
  await expect.element(page.getByText("[Image blocked: probe]")).toBeVisible();
  expect(document.querySelector("[data-testid=file-preview-markdown] img")).toBeNull();
});

it("shows plain text as it is", async () => {
  __setQueryData("documents:listDocuments", [listed("notes.txt", "txt")]);
  __setQueryData("documents:getDocumentContent", {
    fileName: "notes.txt",
    fileType: "txt",
    content: "Rig *B* ran **twice**.",
  });
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await page.getByTitle("Preview").click();
  await expect.element(page.getByText("Rig *B* ran **twice**.")).toBeVisible();
  await expect.element(page.getByTestId("file-preview-markdown")).not.toBeInTheDocument();
});
