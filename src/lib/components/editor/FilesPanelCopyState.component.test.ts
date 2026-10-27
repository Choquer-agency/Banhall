import { beforeEach, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import FilesPanel from "./FilesPanel.svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

// F2 (2026-10-27): a copied project's files while their text is being
// copied, and one that could not be copied. Records of the local test
// registry, not a Convex deployment.
const projectId = "copied-project" as Id<"projects">;

const row = (
  id: string,
  fileName: string,
  copyState: "copying" | "could_not_copy" | null,
  processingStatus: "ready" | "could_not_read" = "ready"
) => ({
  _id: id,
  fileName,
  fileType: "txt",
  source: "context_input",
  category: "other",
  createdAt: 1,
  sizeChars: 100,
  wordCount: 20,
  hasFile: false,
  mimeType: null,
  url: null,
  archived: false,
  processingStatus,
  processingDetail: null,
  copyState,
});

beforeEach(() => {
  __resetConvexStub();
  __setQueryData("documents:listDocuments", [
    // Its original's status came with it: it would be offered Replace.
    row("copying-document", "seal-notes.txt", "copying", "could_not_read"),
    row("lost-document", "trial-log.txt", "could_not_copy", "could_not_read"),
    row("ready-document", "summary.txt", null),
  ]);
  __setQueryData("transcripts:listTranscripts", []);
  __setQueryData("uploadAttempts:listUploadAttempts", []);
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
});

it("says which files are still being copied and which could not be copied, in words", async () => {
  await render(FilesPanel, { projectId, initiallyOpen: true });
  await expect.element(page.getByText("Being copied", { exact: true })).toBeVisible();
  await expect.element(page.getByText("This file is still being copied from the original project.")).toBeVisible();
  await expect.element(page.getByText("Could not copy", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(/changed or was removed in the original project while it was being copied/))
    .toBeVisible();
  await expect.element(page.getByText("Ready for AI", { exact: true })).toBeVisible();
  // A file still being copied cannot be replaced yet; one that could not be copied can.
  await expect.element(page.getByRole("button", { name: "Replace file… — trial-log.txt", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Replace file… — seal-notes.txt", exact: true })).not.toBeInTheDocument();
});
