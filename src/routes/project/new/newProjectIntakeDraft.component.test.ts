import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import { INTAKE_DRAFT_STORAGE_KEY } from "$lib/components/project-new/intakeDraft.svelte";
import { START_MARKS, START_MEASURES } from "$lib/perf/startTimings";
import {
  addSupportingFiles,
  confirmButton,
  fillBasics,
  openStartDialog,
  openTranscriptPaste,
  setInputValue,
} from "./newProjectTestSupport";

/**
 * Decision 65, stage 2: New project saves what it reads to a private intake
 * draft while the writer sets up (text, then the original file), with the
 * names the placeholders need, so the Brief can be prepared ahead.
 * Confirming promotes the draft instead of creating the project and
 * uploading again, and maps the leave-out lists by the exact receipt. A
 * file that did not reach the draft stays in view with Try again; leaving
 * New project discards the draft.
 */
const TRANSCRIPT = "Interviewer: What was uncertain?\nEngineer: The seal cracked at minus 30 degrees.";

type SaveCall = { sourceKey: string; kind: string; position: number; label: string; content: string };
const saves = () => __mutationCalls("intakeDrafts:saveIntakeSource") as SaveCall[];
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

async function pasteTranscript() {
  await openTranscriptPaste();
  setInputValue("#transcript", TRANSCRIPT);
  const add = () => [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Add transcript");
  await expect.poll(() => add()?.disabled).toBe(false);
  add()!.click();
  await expect.poll(() => document.querySelector("[data-transcript-item]")).not.toBeNull();
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  localStorage.clear();
  sessionStorage.clear();
  performance.clearMarks();
  performance.clearMeasures();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
  __setQueryData("providerReadiness:getCapabilities", {
    models: [{ id: "claude-sonnet-5", label: "Sonnet 5", provider: "Anthropic", gateway: "anthropic", description: "", available: true }],
    defaultModel: "claude-sonnet-5",
    defaultModelLabel: "Sonnet 5",
    planningModel: "claude-sonnet-5",
    planningModelLabel: "Sonnet 5",
  });
  __setMutationResult("intakeDrafts:createIntakeDraft", "draft-1");
  __setMutationResult("intakeDrafts:saveIntakeSource", null);
  __setMutationResult("intakeDrafts:attachIntakeOriginal", true);
  __setMutationResult("documents:generateUploadUrl", "https://upload.test/url");
  __setMutationResult("projects:createProject", { projectId: "project-old-way", transcriptIds: ["transcript-old-way"] });
  __setMutationResult("documents:uploadDocument", "document-old-way");
});

describe("saved while the writer sets up", () => {
  it("saves each transcript and file to a private draft, then the names, and tells the writer why", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ storageId: "storage-1" })));
    try {
      await render(NewProjectPage, {});
      // The line near the Interview section, in plain words.
      await expect.poll(() => text(document.querySelector("[data-intake-note]"))).toBe(
        "Files are read while you finish setting up. Setups you don't finish are deleted after 24 hours."
      );
      expect(__mutationCalls("intakeDrafts:createIntakeDraft")).toHaveLength(0);
      await fillBasics("Cold seal", "Acme Seals");
      await pasteTranscript();
      await expect.poll(() => saves().length).toBe(1);
      expect(__mutationCalls("intakeDrafts:createIntakeDraft")).toHaveLength(1);
      expect(saves()[0]).toMatchObject({ draftId: "draft-1", kind: "transcript", position: 0, content: TRANSCRIPT });
      // Only the opaque id is kept in the browser, for this tab.
      expect(sessionStorage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBe("draft-1");
      expect(JSON.stringify(sessionStorage)).not.toContain("seal cracked");
      await expect
        .poll(() => __mutationCalls("intakeDrafts:updateIntakeContext").at(-1))
        .toEqual({ draftId: "draft-1", clientName: "Acme Seals", interviewees: [] });

      addSupportingFiles([new File(["Cold soak log: 400 cycles."], "Soak.txt", { type: "text/plain" })]);
      await expect.poll(() => saves().filter((call) => call.kind === "document").length).toBe(1);
      expect(saves().find((call) => call.kind === "document")).toMatchObject({
        label: "Soak.txt",
        content: "Cold soak log: 400 cycles.",
        category: "other",
        intake: "file",
        position: 1000,
      });
      // The original follows its saved text.
      await expect.poll(() => __mutationCalls("intakeDrafts:attachIntakeOriginal").length).toBe(1);
      expect(__mutationCalls("intakeDrafts:attachIntakeOriginal")[0]).toMatchObject({
        draftId: "draft-1",
        storageId: "storage-1",
        mimeType: "text/plain",
      });
      // Saved files show nothing extra.
      expect(document.querySelector("[data-save-receipt]")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a file that did not reach the draft in view with Try again", async () => {
    __setMutationError("intakeDrafts:saveIntakeSource", new Error("offline"));
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => document.querySelector('[data-save-receipt="failed"]')).not.toBeNull();
    const row = document.querySelector("[data-transcript-item]")!;
    expect(text(row)).toContain("Not saved yet");
    __setMutationResult("intakeDrafts:saveIntakeSource", null);
    row.querySelector<HTMLButtonElement>("[data-save-retry]")!.click();
    await expect.poll(() => document.querySelector("[data-save-receipt]")).toBeNull();
    expect(saves()).toHaveLength(2);
  });

  it("leaving New project discards the draft", async () => {
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    document.querySelector<HTMLButtonElement>("[data-new-project-cancel]")!.click();
    await expect.poll(() => __mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([{ draftId: "draft-1" }]);
    expect(sessionStorage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("discards a draft an earlier visit left open (a reload)", async () => {
    sessionStorage.setItem(INTAKE_DRAFT_STORAGE_KEY, "draft-left-over");
    await render(NewProjectPage, {});
    await expect.poll(() => __mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([{ draftId: "draft-left-over" }]);
  });
});

describe("confirming promotes the draft", () => {
  it("creates the project from the draft with nothing uploaded on the way, and maps the leave-out list by receipt", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ storageId: "storage-1" })));
    try {
      await render(NewProjectPage, {});
      await fillBasics("Cold seal", "Acme Seals");
      await pasteTranscript();
      addSupportingFiles([new File(["Scoping notes for the rig."], "Scoping.txt")]);
      await expect.poll(() => saves().length).toBe(2);
      const transcriptKey = saves().find((call) => call.kind === "transcript")!.sourceKey;
      const documentKey = saves().find((call) => call.kind === "document")!.sourceKey;
      __setMutationResult("intakeDrafts:promoteIntakeDraft", {
        projectId: "project-new",
        complete: true,
        sources: [
          { sourceKey: transcriptKey, kind: "transcript", transcriptId: "transcript-new" },
          { sourceKey: documentKey, kind: "document", projectDocumentId: "document-new" },
        ],
      });

      await openStartDialog();
      const rows = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")];
      rows.find((row) => row.dataset.kind === "document")!.querySelector<HTMLElement>("[data-start-run-check]")!.click();
      // While the dialog is open, the draft prepares for exactly these files.
      await expect
        .poll(() => __mutationCalls("intakeDrafts:setIntakeSelection").at(-1))
        .toEqual({ draftId: "draft-1", excludedSourceKeys: [documentKey] });
      await expect.poll(() => text(confirmButton())).toBe("Start with 1 file");
      confirmButton()!.click();

      await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
      expect(__mutationCalls("intakeDrafts:promoteIntakeDraft")).toEqual([
        expect.objectContaining({
          draftId: "draft-1",
          sourceKeys: [transcriptKey, documentKey],
          project: { title: "Cold seal", clientName: "Acme Seals" },
        }),
      ]);
      // No project creation, no transcript or file upload on the way.
      expect(__mutationCalls("projects:createProject")).toEqual([]);
      expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
      expect(__mutationCalls("generations:requestGeneration")[0]).toEqual({
        projectId: "project-new",
        candidateMode: "iterative",
        excludeDocumentIds: ["document-new"],
      });
      await expect.poll(() => __navigationCalls.map((call) => call.url)).toContain("/project/project-new");
      // The draft became the project: nothing discards it on the way out.
      expect(__mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([]);
      // The confirm-to-reservation span is marked for measuring.
      expect(performance.getEntriesByName(START_MARKS.confirmed, "mark")).toHaveLength(1);
      expect(performance.getEntriesByName(START_MEASURES.toReservation, "measure")).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a transcript that never reached the draft falls back to creating the project the old way", async () => {
    __setMutationError("intakeDrafts:saveIntakeSource", new Error("offline"));
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => document.querySelector('[data-save-receipt="failed"]')).not.toBeNull();
    await openStartDialog();
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("intakeDrafts:promoteIntakeDraft")).toEqual([]);
    expect(__mutationCalls("projects:createProject")).toEqual([
      expect.objectContaining({ transcripts: [expect.objectContaining({ content: TRANSCRIPT })] }),
    ]);
    // The draft this path does not use is discarded with its preparation.
    expect(__mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([{ draftId: "draft-1" }]);
  });

  it("Review a written PD and duplicates keep no draft", async () => {
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    __setQueryData("projects:getProject", { _id: "project-1", title: "Alloy furnace", clientName: "Acme", mode: "generate" });
    __setQueryData("transcripts:listTranscripts", []);
    __setQueryData("documents:listDocuments", []);
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("#title")).not.toBeNull();
    await pasteTranscript();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(__mutationCalls("intakeDrafts:createIntakeDraft")).toEqual([]);
    expect(document.querySelector("[data-intake-note]")).toBeNull();
  });
});
