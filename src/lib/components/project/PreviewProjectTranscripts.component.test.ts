import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { toast } from "svelte-sonner";
import { ConvexError } from "convex/values";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetQaSeenMemory } from "$lib/qa/qaSeen";
import { transcriptContentHash } from "$lib/transcriptUpload";

/**
 * The project page's transcript intake on the Sources tab (2026-09-24, the
 * transcript method): the page reads the file, refuses a duplicate before
 * anything is uploaded, uploads the original, calls Add or Replace, and
 * releases the uploaded original again when the server refuses the change.
 */
const EXISTING_TEXT = "Dana Whitfield: What did you build?\n\nPriya Shah: A predictive controller.";
const NEW_TEXT = "Dana Whitfield: What failed?\n\nPriya Shah: The forecast on cloudy days.";

async function seed({ generationStatus = "completed" }: { generationStatus?: string } = {}) {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Adaptive cold storage controls",
    clientName: "Cedarline Systems",
    writer: "Writer",
    interviewer: "",
    interviewees: [],
    tagIds: [],
    mode: "generate",
    status: "review",
    workflowStage: "drafting",
    createdBy: "user-1",
    ownerId: "user-1",
    createdAt: 1,
    updatedAt: 1,
  });
  __setQueryData("users:getCurrentUser", {
    _id: "user-1",
    role: "writer",
    firstName: "Jordan",
    lastName: "Ellis",
    email: "jordan@example.test",
  });
  __setQueryData("reports:getLatestReport", {
    _id: "report-1",
    projectId: "project-1",
    generationId: "gen-1",
    version: 1,
    revisionNumber: 1,
    content: JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Evidence from thermal trials." }] }],
    }),
    createdAt: 1,
    updatedAt: 1,
  });
  __setQueryData("generations:getLatestGeneration", {
    _id: "gen-1",
    status: generationStatus,
    candidateMode: "single",
    summaryVersionId: null,
    postQaStatus: "done",
  });
  __setQueryData("generations:getGenerationSeedView", null);
  for (const name of ["pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of [
    "documents:listDocuments",
    "tags:listTags",
    "comments:listComments",
    "chatV2:listThreads",
    "chatV2:listTurns",
    "chatV2:listProposals",
    "research:listSessions",
    "uploadAttempts:listUploadAttempts",
  ]) {
    __setQueryData(name, []);
  }
  __setQueryData("transcripts:listTranscripts", [
    {
      _id: "t-1",
      label: "Interview with Priya",
      position: 0,
      createdAt: 1,
      charCount: EXISTING_TEXT.length,
      wordCount: 12,
      contentHash: await transcriptContentHash(EXISTING_TEXT),
      sourceFormat: "txt",
    },
  ]);
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/transcript");
  __setMutationResult("transcripts:addTranscript", "t-2");
  __setMutationResult("transcripts:replaceTranscript", "t-3");
  __setMutationResult("transcripts:discardTranscriptOriginals", null);
}

async function openSources() {
  await render(PreviewProjectPage);
  await page.getByRole("button", { name: /^Sources/ }).click();
  await expect.element(page.getByText("Interview with Priya", { exact: true })).toBeVisible();
}

function pickFile(file: File) {
  const input = document.querySelector<HTMLInputElement>("[data-transcript-file-input]")!;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function chooseRowAction(action: "replace" | "remove", id = "t-1") {
  await userEvent.click(document.querySelector<HTMLElement>(`[data-transcript-menu="${id}"]`)!);
  await vi.waitFor(() => expect(document.querySelector(`[data-transcript-${action}="${id}"]`)).not.toBeNull());
  await userEvent.click(document.querySelector<HTMLElement>(`[data-transcript-${action}="${id}"]`)!);
}

describe("project page transcript intake", () => {
  let upload: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetQaSeenMemory();
    localStorage.clear();
    document.body.innerHTML = "";
    __setPageParams({ id: "project-1" });
    await page.viewport(1440, 900);
    upload = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ storageId: "storage-1" }));
    vi.stubGlobal("fetch", upload);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("refuses a transcript already on the project before uploading anything", async () => {
    await seed();
    const error = vi.spyOn(toast, "error");
    await openSources();
    pickFile(new File([EXISTING_TEXT], "again.txt", { type: "text/plain" }));
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("This transcript is already added (Interview with Priya).")
    );
    expect(upload).not.toHaveBeenCalled();
    expect(__mutationCalls("documents:generateUploadUrl")).toEqual([]);
    expect(__mutationCalls("transcripts:addTranscript")).toEqual([]);
  });

  it("adds a new transcript with its format and its original file", async () => {
    await seed();
    const success = vi.spyOn(toast, "success");
    await openSources();
    const file = new File([NEW_TEXT], "Follow up.txt", { type: "text/plain" });
    pickFile(file);
    await vi.waitFor(() => expect(__mutationCalls("transcripts:addTranscript").length).toBe(1));
    expect(__mutationCalls("transcripts:addTranscript")[0]).toEqual({
      projectId: "project-1",
      content: NEW_TEXT,
      label: "Follow up.txt",
      sourceFormat: "txt",
      originalStorageId: "storage-1",
    });
    expect(upload.mock.calls[0]?.[0]).toBe("https://upload.test/transcript");
    expect(upload.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: file });
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith("Added Follow up.txt"));
    expect(__mutationCalls("transcripts:discardTranscriptOriginals")).toEqual([]);
  });

  it("releases the uploaded original and shows the server's reason when Add is refused", async () => {
    await seed();
    __setMutationError(
      "transcripts:addTranscript",
      new ConvexError({ code: "INVALID_INPUT", message: "Combined transcript text is too large" })
    );
    const error = vi.spyOn(toast, "error");
    const success = vi.spyOn(toast, "success");
    await openSources();
    pickFile(new File([NEW_TEXT], "Follow up.txt", { type: "text/plain" }));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("Combined transcript text is too large"));
    expect(__mutationCalls("transcripts:discardTranscriptOriginals")).toEqual([{ storageIds: ["storage-1"] }]);
    // Security wave 1: the upload is claimed first, so the server lets this
    // user (and only this user) release it.
    expect(__mutationCalls("documents:claimUpload")).toEqual([{ storageId: "storage-1" }]);
    expect(success).not.toHaveBeenCalled();
    // The list is usable again: Add is not left busy.
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLButtonElement>("[data-add-transcript]")?.disabled).toBe(false)
    );
  });

  it("lets a transcript be replaced with its own text", async () => {
    await seed();
    const error = vi.spyOn(toast, "error");
    await openSources();
    await chooseRowAction("replace");
    pickFile(new File([EXISTING_TEXT], "Interview with Priya (original).txt", { type: "text/plain" }));
    await vi.waitFor(() => expect(__mutationCalls("transcripts:replaceTranscript").length).toBe(1));
    expect(__mutationCalls("transcripts:replaceTranscript")[0]).toMatchObject({
      transcriptId: "t-1",
      content: EXISTING_TEXT,
      originalStorageId: "storage-1",
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("says why transcripts can't change while a report is generating", async () => {
    await seed({ generationStatus: "running" });
    await openSources();
    const add = document.querySelector<HTMLButtonElement>("[data-add-transcript]")!;
    expect(add.disabled).toBe(true);
    expect(document.querySelector("[data-transcripts-blocked]")?.textContent).toContain(
      "Transcripts can't change while a report is generating."
    );
    await userEvent.click(document.querySelector<HTMLElement>('[data-transcript-menu="t-1"]')!);
    await vi.waitFor(() => expect(document.querySelector('[data-transcript-remove="t-1"]')).not.toBeNull());
    expect(document.querySelector('[data-transcript-remove="t-1"]')?.hasAttribute("data-disabled")).toBe(true);
    expect(document.querySelector('[data-transcript-replace="t-1"]')?.hasAttribute("data-disabled")).toBe(true);
  });

  it("removes a transcript only after the writer confirms", async () => {
    await seed();
    __setMutationResult("transcripts:removeTranscript", null);
    const success = vi.spyOn(toast, "success");
    await openSources();
    await chooseRowAction("remove");
    await vi.waitFor(() => expect(document.querySelector("[data-remove-transcript-dialog]")).not.toBeNull());
    expect(__mutationCalls("transcripts:removeTranscript")).toEqual([]);
    await userEvent.click(document.querySelector<HTMLElement>("[data-remove-transcript-confirm]")!);
    await vi.waitFor(() => expect(__mutationCalls("transcripts:removeTranscript")).toEqual([{ transcriptId: "t-1" }]));
    await vi.waitFor(() => expect(success).toHaveBeenCalledWith("Transcript removed"));
  });
});
