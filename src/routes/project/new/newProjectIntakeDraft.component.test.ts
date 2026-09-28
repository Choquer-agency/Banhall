import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConvexError } from "convex/values";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __callOrder,
  __clientQueryCalls,
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import {
  INTAKE_DRAFT_STORAGE_KEY,
  intakePolling,
  MAX_PROMOTION_STEPS,
  PROMOTION_POLL_MS,
} from "$lib/components/project-new/intakeDraft.svelte";
import { START_MARKS, START_MEASURES } from "$lib/perf/startTimings";
import {
  addSupportingFiles,
  confirmButton,
  fillBasics,
  openStartDialog,
  chooseMode,
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

  it("tells the draft how many files are still being read, leaving out unticked ones, and zero once they are saved", async () => {
    __setMutationResult("intakeDrafts:reportIntakePendingReads", null);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ storageId: "storage-1" })));
    const counts = () =>
      (__mutationCalls("intakeDrafts:reportIntakePendingReads") as Array<{ draftId: string; count: number }>).map(
        (call) => call.count
      );
    try {
      await render(NewProjectPage, {});
      await fillBasics("Cold seal", "Acme Seals");
      await pasteTranscript();
      await expect.poll(() => saves().length).toBe(1);
      // A file whose reading the test holds open.
      let finishReading!: (value: string) => void;
      const slow = new File(["Rig log."], "Rig log.txt", { type: "text/plain" });
      Object.defineProperty(slow, "text", {
        value: () => new Promise<string>((resolve) => (finishReading = resolve)),
      });
      addSupportingFiles([slow]);
      await expect.poll(() => counts().at(-1)).toBe(1);
      expect(__mutationCalls("intakeDrafts:reportIntakePendingReads").at(-1)).toEqual({ draftId: "draft-1", count: 1 });

      // Unticked in the start dialog, the file no longer holds the head start.
      await openStartDialog();
      const row = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")].find(
        (item) => item.dataset.kind === "document"
      )!;
      row.querySelector<HTMLElement>("[data-start-run-check]")!.click();
      await expect.poll(() => counts().at(-1)).toBe(0);
      // Ticked again, it counts again.
      row.querySelector<HTMLElement>("[data-start-run-check]")!.click();
      await expect.poll(() => counts().at(-1)).toBe(1);

      // Read and saved: the count drops to zero.
      finishReading("Rig log: 400 cycles at minus 30 degrees.");
      await expect.poll(() => saves().filter((call) => call.kind === "document").length).toBe(1);
      await expect.poll(() => counts().at(-1)).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("counts a transcript file still being parsed (P3-9)", async () => {
    __setMutationResult("intakeDrafts:reportIntakePendingReads", null);
    const counts = () =>
      (__mutationCalls("intakeDrafts:reportIntakePendingReads") as Array<{ count: number }>).map((call) => call.count);
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    let finishParsing!: (value: string) => void;
    const slow = new File(["held"], "Second interview.txt", { type: "text/plain" });
    Object.defineProperty(slow, "text", {
      value: () => new Promise<string>((resolve) => (finishParsing = resolve)),
    });
    const transfer = new DataTransfer();
    transfer.items.add(slow);
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept=".docx,.vtt,.srt,.txt"]')!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() => counts().at(-1)).toBe(1);
    finishParsing("Interviewer: What changed?\nEngineer: The seal held at minus 30 degrees.");
    await expect.poll(() => saves().filter((call) => call.kind === "transcript").length).toBe(2);
    await expect.poll(() => counts().at(-1)).toBe(0);
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

  it("a reload whose draft could not be brought back discards it (this page holds its lock) and starts fresh", async () => {
    sessionStorage.setItem(INTAKE_DRAFT_STORAGE_KEY, "draft-left-over");
    __setQueryData("intakeDrafts:restoreIntakeDraft", null);
    await render(NewProjectPage, {});
    await expect.poll(() => __clientQueryCalls("intakeDrafts:restoreIntakeDraft")).toEqual([{ draftId: "draft-left-over" }]);
    await expect.poll(() => sessionStorage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBeNull();
    await expect.poll(() => __mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([{ draftId: "draft-left-over" }]);
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    expect(__mutationCalls("intakeDrafts:createIntakeDraft")).toHaveLength(1);
  });
});

describe("a reload brings the draft back (2026-09-27, fourth)", () => {
  const NOTES = "Cold soak log: 400 cycles at minus 30 degrees.";
  const REPORT = "Last year's 242 section.";
  const REPORT_TEXT = `[Previous-year report \u2014 fiscal 2024]\nNote: Claim cut by 20%\n\n${REPORT}`;
  const VIEW = {
    clientName: "Acme Seals",
    interviewerUserId: null,
    interviewees: ["Priya Raman"],
    excludedSourceKeys: ["document-key-soak"],
    pendingReads: 0,
    sources: [
      { sourceKey: "transcript-key-1", kind: "transcript", position: 0, label: "Morning interview.docx", contentLength: TRANSCRIPT.length, sourceFormat: "txt", hasOriginal: true },
      { sourceKey: "document-key-soak", kind: "document", position: 1001, label: "Soak.pdf", contentLength: NOTES.length, fileType: "pdf", category: "background", intake: "file", extractionOutcome: "ok", hasOriginal: true },
      { sourceKey: "document-key-report", kind: "document", position: 1000, label: "FY2024 PD.docx", contentLength: REPORT_TEXT.length, fileType: "docx", category: "previous_pd", intake: "file", extractionOutcome: "ok", fiscalYear: 2024, hasOriginal: false },
    ],
  };

  function seedDraft(draftId = "draft-left") {
    sessionStorage.setItem(INTAKE_DRAFT_STORAGE_KEY, draftId);
    __setQueryDataForArgs("intakeDrafts:restoreIntakeDraft", { draftId }, VIEW);
    const texts: Record<string, string> = {
      "transcript-key-1": TRANSCRIPT,
      "document-key-soak": NOTES,
      "document-key-report": REPORT_TEXT,
    };
    for (const [sourceKey, content] of Object.entries(texts)) {
      __setQueryDataForArgs("intakeDrafts:getIntakeSourceText", { draftId, sourceKey }, { content });
    }
  }

  it("shows the saved files with their chips and word counts, the names and the file choice, and sends nothing again", async () => {
    __setMutationResult("intakeDrafts:reportIntakePendingReads", null);
    seedDraft();
    await render(NewProjectPage, {});
    await expect.poll(() => text(document.querySelector("[data-intake-restored]"))).toContain("Your setup is back");
    const transcript = document.querySelector("[data-transcript-item]");
    expect(text(transcript)).toContain("Morning interview.docx");
    expect(text(transcript)).toContain(`${TRANSCRIPT.trim().split(/\s+/).length} words`);
    const cards = [...document.querySelectorAll<HTMLElement>("[data-supporting-card]")];
    // In SR&ED weight order, as they were saved.
    expect(cards.map((card) => text(card.querySelector("[data-supporting-name]")))).toEqual(["FY2024 PD.docx", "Soak.pdf"]);
    expect(cards.map((card) => text(card.querySelector("[data-category-chip]")))).toEqual([
      "Previous-year reports",
      "Background research",
    ]);
    expect(text(cards[1])).toContain("9 words");
    expect(text(cards[0])).toContain("4 words");
    expect(document.querySelector<HTMLInputElement>("#clientName")!.value).toBe("Acme Seals");
    expect(text(document.body)).toContain("Priya Raman");
    // Fields the draft does not hold stay empty.
    expect(document.querySelector<HTMLInputElement>("#title")!.value).toBe("");
    // The year's note came back from the report's header.
    expect([...document.querySelectorAll<HTMLInputElement>("[data-year-notes] input")].map((input) => input.value)).toEqual([
      "Claim cut by 20%",
    ]);
    // Saved files show nothing extra, and nothing is saved or uploaded again;
    // the report saved without its original says so.
    expect(document.querySelector('[data-save-receipt]:not([data-save-receipt="original-missing"])')).toBeNull();
    expect(text(cards[0])).toContain("Original not saved; the text is kept");
    expect(text(cards[1])).not.toContain("Original not saved");
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(saves()).toEqual([]);
    expect(__mutationCalls("intakeDrafts:createIntakeDraft")).toEqual([]);
    expect(__mutationCalls("intakeDrafts:updateIntakeContext")).toEqual([]);
    expect(__mutationCalls("intakeDrafts:attachIntakeOriginal")).toEqual([]);
    expect(__mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([]);
    expect(sessionStorage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBe("draft-left");

    // The file choice is kept: the left-out file opens unticked, and
    // opening sends nothing, since the draft already holds that choice.
    setInputValue("#title", "Cold seal");
    await openStartDialog();
    const rows = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")];
    expect(rows.map((row) => [row.querySelector("[data-start-run-name]")?.textContent, row.dataset.ticked])).toEqual([
      ["Morning interview.docx", "true"],
      ["FY2024 PD.docx", "true"],
      ["Soak.pdf", "false"],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(__mutationCalls("intakeDrafts:setIntakeSelection")).toEqual([]);

    // Confirming promotes the same draft, the choice confirmed first.
    __setMutationResult("intakeDrafts:setIntakeSelection", null);
    __setMutationResult("intakeDrafts:promoteIntakeDraft", {
      projectId: "project-back",
      complete: true,
      sources: [
        { sourceKey: "transcript-key-1", kind: "transcript", transcriptId: "transcript-back" },
        { sourceKey: "document-key-soak", kind: "document", projectDocumentId: "document-soak" },
        { sourceKey: "document-key-report", kind: "document", projectDocumentId: "document-report" },
      ],
    });
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("intakeDrafts:setIntakeSelection")).toEqual([
      { draftId: "draft-left", excludedSourceKeys: ["document-key-soak"], confirm: true },
    ]);
    expect(__mutationCalls("intakeDrafts:promoteIntakeDraft")).toEqual([
      expect.objectContaining({
        draftId: "draft-left",
        sourceKeys: ["transcript-key-1", "document-key-report", "document-key-soak"],
        project: { title: "Cold seal", clientName: "Acme Seals", interviewees: ["Priya Raman"] },
      }),
    ]);
    const order = __callOrder().filter((name) => name === "intakeDrafts:setIntakeSelection" || name === "intakeDrafts:promoteIntakeDraft");
    expect(order).toEqual(["intakeDrafts:setIntakeSelection", "intakeDrafts:promoteIntakeDraft"]);
    expect(__mutationCalls("generations:requestGeneration")[0]).toEqual({
      projectId: "project-back",
      candidateMode: "iterative",
      excludeDocumentIds: ["document-soak"],
    });
    expect(__mutationCalls("projects:createProject")).toEqual([]);
    expect(__mutationCalls("documents:uploadDocument")).toEqual([]);
  });

  it("a second tab with the same draft id starts its own draft and never touches the other tab's", async () => {
    seedDraft("draft-other-tab");
    // The first tab holds the draft's lock for as long as it lives.
    let letGo!: () => void;
    const holding = new Promise<void>((resolve) => (letGo = resolve));
    await new Promise<void>((granted) => {
      void navigator.locks.request("banhall:intake-draft:draft-other-tab", async () => {
        granted();
        await holding;
      });
    });
    try {
      await render(NewProjectPage, {});
      await expect.poll(() => sessionStorage.getItem(INTAKE_DRAFT_STORAGE_KEY), { timeout: 4_000 }).toBeNull();
      expect(__clientQueryCalls("intakeDrafts:restoreIntakeDraft")).toEqual([]);
      expect(document.querySelector("[data-intake-restored]")).toBeNull();
      await fillBasics("Cold seal", "Acme Seals");
      await pasteTranscript();
      await expect.poll(() => saves().length).toBe(1);
      expect(saves()[0]).toMatchObject({ draftId: "draft-1" });
      expect(__mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([]);
      expect(sessionStorage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBe("draft-1");
    } finally {
      letGo();
    }
  });

  it("says how many files were still being read, sends this page's own count, and shows files whose original was not saved", async () => {
    __setMutationResult("intakeDrafts:reportIntakePendingReads", null);
    seedDraft();
    __setQueryDataForArgs("intakeDrafts:restoreIntakeDraft", { draftId: "draft-left" }, {
      ...VIEW,
      pendingReads: 2,
      sources: VIEW.sources.map((source) => ({ ...source, hasOriginal: source.sourceKey === "document-key-report" })),
    });
    await render(NewProjectPage, {});
    await expect.poll(() => text(document.querySelector("[data-intake-restored]"))).toContain(
      "Your setup is back Check the files below before you start. 2 files were still being read when the page reloaded. Add them again."
    );
    // The old page's count is not this page's: a fresh zero goes out (review P3-2).
    await expect.poll(() => __mutationCalls("intakeDrafts:reportIntakePendingReads")).toEqual([{ draftId: "draft-left", count: 0 }]);
    // A file and a transcript saved without their originals say so; the report had its original.
    const missing = [...document.querySelectorAll('[data-save-receipt="original-missing"]')].map((node) => text(node));
    expect(missing).toEqual(["Original not saved; the text is kept", "Original not saved; the text is kept"]);
    expect(text(document.querySelector("[data-transcript-item]"))).toContain("Original not saved; the text is kept");
    expect(saves()).toEqual([]);
  });

  it("an empty previous-year report keeps its year and the year's note, and nothing is removed from the draft (review P3-1)", async () => {
    sessionStorage.setItem(INTAKE_DRAFT_STORAGE_KEY, "draft-empty-report");
    const draftId = "draft-empty-report";
    __setQueryDataForArgs("intakeDrafts:restoreIntakeDraft", { draftId }, {
      clientName: "Acme Seals", interviewerUserId: null, interviewees: [], excludedSourceKeys: [], pendingReads: 0,
      sources: [
        { sourceKey: "transcript-key-1", kind: "transcript", position: 0, label: "Morning interview.docx", contentLength: TRANSCRIPT.length, sourceFormat: "txt", hasOriginal: true },
        { sourceKey: "report-key-empty", kind: "document", position: 1000, label: "FY2023 scan.pdf", contentLength: 0, fileType: "pdf", category: "previous_pd", intake: "file", extractionOutcome: "ok", fiscalYear: 2023, hasOriginal: true },
        { sourceKey: "prevyear-note-2023", kind: "document", position: 1001, label: "Previous-year note (FY 2023)", contentLength: 40, fileType: "txt", category: "previous_pd", intake: "pasted", hasOriginal: false },
      ],
    });
    __setQueryDataForArgs("intakeDrafts:getIntakeSourceText", { draftId, sourceKey: "transcript-key-1" }, { content: TRANSCRIPT });
    __setQueryDataForArgs("intakeDrafts:getIntakeSourceText", { draftId, sourceKey: "report-key-empty" }, { content: "" });
    __setQueryDataForArgs("intakeDrafts:getIntakeSourceText", { draftId, sourceKey: "prevyear-note-2023" }, {
      content: "[Previous-year note \u2014 fiscal 2023]\n\nThe rig was retired.",
    });
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-intake-restored]")).not.toBeNull();
    await expect.poll(() => [...document.querySelectorAll<HTMLInputElement>("[data-year-notes] input")].map((input) => input.value)).toEqual([
      "The rig was retired.",
    ]);
    expect(text(document.querySelector("[data-year-notes]"))).toContain("FY 2023");
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(__mutationCalls("intakeDrafts:removeIntakeSource")).toEqual([]);
    expect(saves()).toEqual([]);
  });

  it("a Single draft dialog asks for no head start while it is open, and Start sends no confirm (review P3-5)", async () => {
    __setMutationResult("intakeDrafts:setIntakeSelection", null);
    seedDraft();
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-intake-restored]")).not.toBeNull();
    setInputValue("#title", "Cold seal");
    await page.getByRole("radio", { name: /Single draft/ }).click();
    await openStartDialog();
    const rows = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")];
    rows.find((row) => row.dataset.kind === "transcript")!.querySelector<HTMLElement>("[data-start-run-check]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(__mutationCalls("intakeDrafts:setIntakeSelection")).toEqual([]);
  });

  it("Start over discards the draft and empties the page", async () => {
    seedDraft();
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("[data-intake-restored]")).not.toBeNull();
    const startOver = [...document.querySelectorAll<HTMLButtonElement>("[data-intake-restored] button")].find(
      (button) => button.textContent?.trim() === "Start over"
    )!;
    startOver.click();
    await expect.poll(() => __mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([{ draftId: "draft-left" }]);
    await expect.poll(() => document.querySelector("[data-transcript-item]")).toBeNull();
    expect(document.querySelectorAll("[data-supporting-card]")).toHaveLength(0);
    expect(document.querySelector<HTMLInputElement>("#clientName")!.value).toBe("");
    expect(document.querySelector("[data-intake-restored]")).toBeNull();
    expect(sessionStorage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBeNull();
    // What is added next goes to a new draft.
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    expect(saves()[0]).toMatchObject({ draftId: "draft-1" });
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

describe("a draft that is gone, and a confirm that cannot promote (review fixes)", () => {
  const gone = () => new ConvexError({ code: "INTAKE_DRAFT_GONE", message: "This setup is no longer available" });

  it("an expired draft (idle for a day) ends quietly and confirming takes the old path", async () => {
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    __setMutationError("intakeDrafts:saveIntakeSource", gone());
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    // No "Not saved yet": the draft is gone, not the file.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector("[data-save-receipt]")).toBeNull();
    expect(sessionStorage.getItem(INTAKE_DRAFT_STORAGE_KEY)).toBeNull();
    await openStartDialog();
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("intakeDrafts:promoteIntakeDraft")).toEqual([]);
    expect(__mutationCalls("projects:createProject")).toHaveLength(1);
  });

  it("a draft another tab discarded ends at its next call, and nothing more is sent to it", async () => {
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    __setMutationError("intakeDrafts:updateIntakeContext", gone());
    setInputValue("#clientName", "Acme Seals Ltd");
    await expect.poll(() => __mutationCalls("intakeDrafts:updateIntakeContext").length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 700));
    addSupportingFiles([new File(["Scoping notes for the rig."], "Scoping.txt")]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(saves()).toHaveLength(1);
    await openStartDialog();
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("projects:createProject")).toHaveLength(1);
  });

  it("a first promote call that fails made no project: the draft is discarded and the old path creates it", async () => {
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    __setMutationError("intakeDrafts:promoteIntakeDraft", new Error("network"));
    await openStartDialog();
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("intakeDrafts:promoteIntakeDraft")).toHaveLength(1);
    expect(__mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([{ draftId: "draft-1" }]);
    expect(__mutationCalls("projects:createProject")).toHaveLength(1);
    // The old path's receipts are its own: no stale draft receipt stays.
    expect(document.querySelector("[data-save-receipt]")).toBeNull();
  });

  it("a promotion that takes several steps is polled until the project is set up, then the run starts", async () => {
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    const transcriptKey = saves()[0].sourceKey;
    __setMutationResult("intakeDrafts:promoteIntakeDraft", { projectId: "project-new", complete: false, sources: [] });
    await openStartDialog();
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("intakeDrafts:promoteIntakeDraft").length).toBeGreaterThan(1);
    expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
    __setMutationResult("intakeDrafts:promoteIntakeDraft", {
      projectId: "project-new",
      complete: true,
      sources: [{ sourceKey: transcriptKey, kind: "transcript", transcriptId: "transcript-new" }],
    });
    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("generations:requestGeneration")[0]).toMatchObject({ projectId: "project-new" });
    expect(__mutationCalls("projects:createProject")).toEqual([]);
  });

  it("switching to Review a written PD discards the draft", async () => {
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect.poll(() => saves().length).toBe(1);
    await chooseMode("Review a written PD");
    await expect.poll(() => __mutationCalls("intakeDrafts:discardIntakeDraft")).toEqual([{ draftId: "draft-1" }]);
  });
});

describe("re-check fixes (2026-09-26)", () => {
  it("polls at least as long as the server waits for turn builds", () => {
    // The server waits up to 3 minutes for a promotion's turn builds.
    expect(PROMOTION_POLL_MS * MAX_PROMOTION_STEPS).toBeGreaterThanOrEqual(3 * 60 * 1000);
  });

  it("a promotion still being set up after the page's polling drops no file and still starts the run with the writer's choices (P2-B)", async () => {
    intakePolling.pollMs = 20;
    intakePolling.maxSteps = 2;
    try {
      await render(NewProjectPage, {});
      await fillBasics("Cold seal", "Acme Seals");
      await pasteTranscript();
      await expect.poll(() => saves().length).toBe(1);
      const transcriptKey = saves()[0].sourceKey;
      // The next file never reaches the draft (a failed save): it is saved
      // the normal way once the project exists.
      __setMutationError("intakeDrafts:saveIntakeSource", new Error("offline"));
      addSupportingFiles([new File(["Scoping notes for the rig."], "Scoping.txt")]);
      await expect.poll(() => document.querySelector('[data-save-receipt="failed"]')).not.toBeNull();
      __setMutationResult("intakeDrafts:promoteIntakeDraft", { projectId: "project-new", complete: false, sources: [] });
      document.querySelector<HTMLElement>('[data-write-mode="single"]')!.click();
      await openStartDialog();
      confirmButton()!.click();
      await expect.poll(() => __navigationCalls.map((call) => call.url)).toContain("/project/project-new");
      expect(__mutationCalls("documents:uploadDocument")).toEqual([
        expect.objectContaining({ projectId: "project-new", fileName: "Scoping.txt" }),
      ]);
      expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
      expect(__mutationCalls("projects:createProject")).toEqual([]);
      // Once the project is ready the run starts with the writer's choices.
      __setMutationResult("intakeDrafts:promoteIntakeDraft", {
        projectId: "project-new",
        complete: true,
        sources: [{ sourceKey: transcriptKey, kind: "transcript", transcriptId: "transcript-new" }],
      });
      await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
      expect(__mutationCalls("generations:requestGeneration")[0]).toMatchObject({
        projectId: "project-new",
        candidateMode: "single",
      });
    } finally {
      intakePolling.pollMs = PROMOTION_POLL_MS;
      intakePolling.maxSteps = MAX_PROMOTION_STEPS;
    }
  });

  it("a cap says why in plain words on the file, and the day's draft cap says files are saved when you start (P3-1)", async () => {
    __setMutationError(
      "intakeDrafts:saveIntakeSource",
      new ConvexError({
        code: "INTAKE_TEXT_LIMIT",
        message: "A new project takes at most 3,000k characters of supporting document text. Remove a file to add this one.",
      })
    );
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    addSupportingFiles([new File(["Scoping notes for the rig."], "Scoping.txt")]);
    await expect
      .poll(() => text(document.querySelector('[data-supporting-card] [data-save-receipt="failed"]')))
      .toBe("A new project takes at most 3,000k characters of supporting document text. Remove a file to add this one.");
  });

  it("the day's draft cap keeps no draft and says so in plain words (P3-1)", async () => {
    __setMutationError(
      "intakeDrafts:createIntakeDraft",
      new ConvexError({
        code: "INTAKE_DRAFT_LIMIT",
        message: "You have started a lot of new projects today, so files are saved when you start instead.",
      })
    );
    await render(NewProjectPage, {});
    await fillBasics("Cold seal", "Acme Seals");
    await pasteTranscript();
    await expect
      .poll(() => text(document.querySelector("[data-intake-notice]")))
      .toBe("You have started a lot of new projects today, so files are saved when you start instead.");
    expect(document.querySelector("[data-save-receipt]")).toBeNull();
    await openStartDialog();
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("projects:createProject")).toHaveLength(1);
  });
});
