/**
 * 2026-09-27 (fourth): the project pages start through the same dialog as
 * New project ("Choose what the ideas come from"), every file ticked with
 * its type chip and word count, and the model line. Unticked files are left
 * out of the run (the leave-out lists reach requestGeneration), each change
 * of ticks asks for a matching head start, Cancel clears it, and a
 * Step-by-step Start sends the final list with `confirm` just before the
 * run. Existing refusals still show on the page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import CurrentProjectPage from "./CurrentProjectPage.svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __callOrder,
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const now = Date.UTC(2026, 8, 27, 12);

function seed() {
  __setQueryData("projects:getProject", {
    _id: "project-start", title: "Cold seal", sredTitle: "", clientName: "Acme Seals",
    writer: "Wren Writer", interviewer: "", interviewees: [], tagIds: [], mode: "generate",
    status: "draft", workflowStage: "intake", createdBy: "writer-start", ownerId: "writer-start",
    createdAt: now, updatedAt: now, shareToken: "start-fixture-token",
  });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("users:getCurrentUser", {
    _id: "writer-start", role: "writer", firstName: "Wren", lastName: "Writer", email: "writer@example.test",
  });
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getLatestGeneration", null);
  __setQueryData("pdReviews:getLatestPdReview", null);
  __setQueryData("reportViews:getViewSummary", null);
  __setQueryData("providerReadiness:getCapabilities", {
    models: [
      { id: "claude-writer", label: "Writer Model", provider: "anthropic", gateway: "anthropic", description: "", available: true },
    ],
    defaultModel: "claude-writer",
    planningModelLabel: "Planner Model",
  });
  __setQueryData("transcripts:listTranscripts", [
    { _id: "transcript-1", label: "Priya interview.docx", position: 0, createdAt: now, charCount: 9000, wordCount: 1520 },
  ]);
  __setQueryData("transcripts:getTranscriptContent", {
    _id: "transcript-1", label: "Priya interview.docx", content: "Interviewer: What did you try first?",
  });
  __setQueryData("documents:listDocuments", [
    {
      _id: "document-later", fileName: "later-notes.pdf", fileType: "pdf", source: "context_input", category: "background",
      createdAt: now + 2, sizeChars: 400, wordCount: 64, hasFile: true, mimeType: null, url: null, archived: false,
      processingStatus: "extracted", processingDetail: null,
    },
    {
      _id: "document-cold", fileName: "cold-soak.txt", fileType: "txt", source: "context_input", category: "writer_notes",
      createdAt: now + 1, sizeChars: 300, wordCount: 48, hasFile: true, mimeType: null, url: null, archived: false,
      processingStatus: "extracted", processingDetail: null,
    },
    {
      _id: "document-archived", fileName: "old-draft.txt", fileType: "txt", source: "context_input", category: "other",
      createdAt: now, sizeChars: 30, wordCount: 5, hasFile: true, mimeType: null, url: null, archived: true,
      processingStatus: "extracted", processingDetail: null,
    },
  ]);
  for (const name of ["tags:listTags", "comments:listComments", "pdReviews:listPdReviewEvents", "chatV2:listThreads",
    "chatV2:listProposals", "research:listSessions", "uploadAttempts:listUploadAttempts", "snapshots:listSnapshots"]) {
    __setQueryData(name, []);
  }
}

const selections = () => __mutationCalls("briefPreparations:setProjectStartSelection");
const requests = () => __mutationCalls("generations:requestGeneration");
const dialog = () => page.getByRole("dialog", { name: "Choose what the ideas come from" });

beforeEach(async () => {
  __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub();
  document.body.innerHTML = "";
  localStorage.clear();
  __setPageUrl("/project/project-start");
  __setPageParams({ id: "project-start" });
  seed();
  await page.viewport(1366, 900);
});

for (const [name, Page] of [["preview", PreviewProjectPage], ["current", CurrentProjectPage]] as const) {
  describe(`${name} project page start`, () => {
    async function openDialog() {
      await render(Page, {});
      await page.getByRole("radio", { name: "Step by step", exact: true }).click();
      await page.getByRole("button", { name: "Generate Report", exact: true }).click();
      await expect.element(dialog()).toBeVisible();
    }

    it("opens the New project dialog with every file ticked, its chips, word counts and the model line", async () => {
      await openDialog();
      await expect.element(dialog().getByText("Untick anything you do not want used this time. Files lock once you start.")).toBeVisible();
      const rows = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")];
      expect(rows.map((row) => row.querySelector("[data-start-run-name]")?.textContent)).toEqual([
        "Priya interview.docx", "cold-soak.txt", "later-notes.pdf",
      ]);
      expect(rows.map((row) => row.querySelector("[data-start-run-chip]")?.textContent?.trim())).toEqual([
        "Transcript", "Writer's notes", "Background research",
      ]);
      expect(rows.map((row) => row.querySelector("[data-start-run-meta]")?.textContent?.trim())).toEqual([
        "1,520 words", "48 words", "64 words",
      ]);
      expect(rows.every((row) => row.dataset.ticked === "true")).toBe(true);
      expect(document.querySelector("[data-start-run-model-title]")?.textContent).toBe("Planner Model");
      expect(document.querySelector("[data-start-run-model-line]")?.textContent).toBe("Writes the ideas. Writer Model writes the report.");
      await expect.element(dialog().getByRole("button", { name: "Start with 3 files", exact: true })).toBeVisible();
      // Opening with every file ticked asks for nothing.
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(selections()).toEqual([]);
      expect(requests()).toEqual([]);
    });

    it("an untick asks for a matching head start, and Start sends the leave-out list with the run, confirm first", async () => {
      await openDialog();
      await dialog().getByRole("checkbox", { name: "Use later-notes.pdf", exact: true }).click();
      await expect.poll(selections).toEqual([
        { projectId: "project-start", excludedTranscriptIds: [], excludedDocumentIds: ["document-later"] },
      ]);
      await dialog().getByRole("button", { name: "Start with 2 files", exact: true }).click();
      await expect.poll(requests).toEqual([{
        projectId: "project-start",
        lengthTarget: "standard",
        candidateMode: "iterative",
        excludeDocumentIds: ["document-later"],
      }]);
      expect(selections()[1]).toEqual({
        projectId: "project-start", excludedTranscriptIds: [], excludedDocumentIds: ["document-later"], confirm: true,
      });
      const order = __callOrder().filter(
        (call) => call === "briefPreparations:setProjectStartSelection" || call === "generations:requestGeneration"
      );
      expect(order).toEqual([
        "briefPreparations:setProjectStartSelection",
        "briefPreparations:setProjectStartSelection",
        "generations:requestGeneration",
      ]);
    });

    it("Cancel ends the head start for the unticked files, and nothing is started", async () => {
      await openDialog();
      await dialog().getByRole("checkbox", { name: "Use Priya interview.docx", exact: true }).click();
      await expect.poll(() => selections().length).toBe(1);
      await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
      await expect.element(dialog()).not.toBeInTheDocument();
      await expect.poll(selections).toEqual([
        { projectId: "project-start", excludedTranscriptIds: ["transcript-1"], excludedDocumentIds: [] },
        { projectId: "project-start", excludedTranscriptIds: [], excludedDocumentIds: [], cancel: true },
      ]);
      expect(requests()).toEqual([]);
    });

    it("Cancel with nothing unticked asks nothing", async () => {
      await openDialog();
      await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
      await expect.element(dialog()).not.toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(selections()).toEqual([]);
    });

    it("keeps the page's refusals: a rate limit shows its message, and a head start that fails never blocks the run", async () => {
      __setMutationError("briefPreparations:setProjectStartSelection", new Error("offline"));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      __setMutationError(
        "generations:requestGeneration",
        new ConvexError({
          code: "RATE_LIMITED",
          message: "You have started a lot of runs in the last hour. Try again in 5 minutes.",
          retryAfter: 300,
        })
      );
      await openDialog();
      await dialog().getByRole("button", { name: "Start with 3 files", exact: true }).click();
      await expect.poll(() => requests().length).toBe(1);
      await expect
        .element(page.getByText("You have started a lot of runs in the last hour. Try again in 5 minutes.", { exact: true }))
        .toBeVisible();
      quiet.mockRestore();
    });

    it("a compare run asks for no head start and keeps its leave-out list", async () => {
      await render(Page, {});
      await page.getByRole("radio", { name: "Compare two drafts", exact: true }).click();
      await page.getByRole("button", { name: "Generate Report", exact: true }).click();
      const compare = page.getByRole("dialog", { name: "Choose what the drafts come from" });
      await expect.element(compare).toBeVisible();
      await compare.getByRole("checkbox", { name: "Use cold-soak.txt", exact: true }).click();
      await compare.getByRole("button", { name: "Write 2 drafts", exact: true }).click();
      await expect.poll(requests).toEqual([{
        projectId: "project-start",
        lengthTarget: "standard",
        candidateMode: "compare",
        excludeDocumentIds: ["document-cold"],
      }]);
      await new Promise((resolve) => setTimeout(resolve, 450));
      // Its ticks never ask for a head start: that run would not use one.
      expect(selections()).toEqual([]);
    });

    it("unticked files are carried through the Re-run generation confirmation", async () => {
      // A finished run: a re-run asks first.
      __setQueryData("generations:getLatestGeneration", {
        _id: "generation-done", status: "completed", candidateMode: "single", startedAt: now, completedAt: now,
      });
      await openDialog();
      await dialog().getByRole("checkbox", { name: "Use cold-soak.txt", exact: true }).click();
      await dialog().getByRole("button", { name: "Start with 2 files", exact: true }).click();
      const rerun = page.getByRole("dialog", { name: "This project already has a report" });
      await expect.element(rerun).toBeVisible();
      expect(requests()).toEqual([]);
      await rerun.getByRole("button", { name: "Re-run generation", exact: true }).click();
      await expect.poll(requests).toEqual([{
        projectId: "project-start",
        lengthTarget: "standard",
        candidateMode: "iterative",
        excludeDocumentIds: ["document-cold"],
        confirmRegeneration: true,
      }]);
      expect(selections().at(-1)).toEqual({
        projectId: "project-start", excludedTranscriptIds: [], excludedDocumentIds: ["document-cold"], confirm: true,
      });
    });

    for (const [code, message] of [
      ["GENERATION_ACTIVE", "A run is already going on this project. Try again when it finishes."],
      ["PROJECT_SETTING_UP", "This project is still being set up. Try again in a moment."],
    ] as const) {
      it(`shows the ${code} refusal on the page after the dialog`, async () => {
        __setMutationError("generations:requestGeneration", new ConvexError({ code, message }));
        await openDialog();
        await dialog().getByRole("button", { name: "Start with 3 files", exact: true }).click();
        await expect.poll(() => requests().length).toBe(1);
        await expect.element(page.getByText(message, { exact: true })).toBeVisible();
        await expect.element(dialog()).not.toBeInTheDocument();
      });
    }
  });
}
