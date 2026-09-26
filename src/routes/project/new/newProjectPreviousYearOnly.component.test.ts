import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import {
  addSupportingFiles,
  confirmButton,
  fillBasics,
  openStartDialog,
  openTranscriptPaste,
  setDocumentCategory,
  startButton,
} from "./newProjectTestSupport";

/**
 * Decision 42 (2026-09-25): a draft is never built from last year's report
 * alone. When every transcript and current file is unticked or missing and
 * only previous-year files (or the original's report brought along as last
 * year's report) remain, the start button is disabled and "Before you start"
 * carries the exact message (conflict 13). The start dialog checks the same
 * rule on what the writer leaves ticked (decision 56).
 * The server refuses the same case (convex/previousYearSourceGuard.test.ts).
 */
const MESSAGE =
  "Add a transcript or a current file. Last year's report alone can't be the source for this year's report.";
const TRANSCRIPTS_MESSAGE =
  "Add a new transcript or a current file. Last year's transcripts and report can't be the only sources for this year's report.";

function setInputValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const previousYearRow = () => document.querySelector('[data-checklist-row="previous-year"]')?.textContent?.trim();

function document_(id: string, fileName: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    fileName,
    fileType: "txt",
    source: "context_input",
    category: null,
    createdAt: 1,
    sizeChars: 120,
    hasFile: true,
    mimeType: null,
    url: null,
    archived: false,
    processingStatus: "ready",
    processingDetail: null,
    ...overrides,
  };
}

const copyBox = (name: string) =>
  document.querySelector<HTMLButtonElement>(`button[role="checkbox"][aria-label="Copy ${name}"]`);

async function untick(name: string) {
  await expect.poll(() => copyBox(name)).not.toBeNull();
  copyBox(name)!.click();
  await expect.poll(() => copyBox(name)?.getAttribute("aria-checked")).toBe("false");
}

async function tick(name: string) {
  await expect.poll(() => copyBox(name)).not.toBeNull();
  copyBox(name)!.click();
  await expect.poll(() => copyBox(name)?.getAttribute("aria-checked")).toBe("true");
}

function seedSource(fiscalYearEnd?: number) {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Alloy furnace",
    clientName: "Forgeworks Inc.",
    mode: "generate",
    ...(fiscalYearEnd ? { fiscalYearEnd } : {}),
  });
  __setQueryData("transcripts:listTranscripts", [
    { _id: "transcript-1", label: "Kickoff.docx", position: 0, createdAt: 1, charCount: 120, wordCount: 20 },
  ]);
  __setQueryData("documents:listDocuments", [
    document_("doc-1", "Writer notes.md", { category: "writer_notes" }),
    document_("doc-2", "FY2023 report.docx", { category: "previous_pd" }),
  ]);
  __setQueryData("projects:getDuplicateSourceReport", { version: 3, hasText: true });
  __setMutationResult("projects:createProject", {
    projectId: "project-copy",
    transcriptIds: [],
  });
}

/** Set the duplicate's fiscal year end to 2025-12-31 in the date picker. */
async function moveFiscalYearTo2025() {
  const field = document.querySelector<HTMLButtonElement>("#fiscalYearEnd")!;
  field.click();
  const day = () =>
    document.querySelector<HTMLElement>(
      '[data-bits-day][data-value="2025-12-31"]:not([data-outside-month])'
    );
  await expect.poll(() => document.querySelector('button[aria-label="Next"]')).not.toBeNull();
  for (let page = 0; page < 30 && !day(); page += 1) {
    document.querySelector<HTMLButtonElement>('button[aria-label="Next"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  day()!.click();
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setQueryData("users:getMyUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
});

describe("/project/new with only last year's report (decision 42)", () => {
  it("blocks a new project whose only file is a previous-year report, until a transcript is added", async () => {
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await fillBasics();

    // Last year's PD as the only supporting document.
    addSupportingFiles([new File(["Last year's project description."], "FY2024 PD.txt", { type: "text/plain" })]);
    await setDocumentCategory("FY2024 PD.txt", "Previous-year reports");

    await expect.poll(previousYearRow).toContain(MESSAGE);
    expect(startButton()!.disabled).toBe(true);
    expect(document.querySelector('[data-checklist-row="no-source"]')).toBeNull();

    // A pasted transcript is a current-year source.
    await openTranscriptPaste();
    setInputValue("#transcript", "Interviewer: What was uncertain?\nEngineer: The tracker drift.");
    await expect.poll(() => startButton()?.disabled).toBe(false);
    expect(previousYearRow()).toBeUndefined();
  });

  it("refuses in the start dialog when unticking the transcript leaves last year's report", async () => {
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});
    await fillBasics();
    addSupportingFiles([new File(["Last year's project description."], "FY2024 PD.txt", { type: "text/plain" })]);
    await setDocumentCategory("FY2024 PD.txt", "Previous-year reports");
    await openTranscriptPaste();
    setInputValue("#transcript", "Interviewer: What was uncertain?\nEngineer: The tracker drift.");

    await openStartDialog();
    const transcriptRow = [...document.querySelectorAll<HTMLElement>("[data-start-run-row]")].find(
      (row) => row.dataset.kind === "transcript"
    )!;
    transcriptRow.querySelector<HTMLElement>("[data-start-run-check]")!.click();
    await expect
      .poll(() => document.querySelector("[data-start-run-problem]")?.textContent?.trim())
      .toBe(MESSAGE);
    expect(confirmButton()!.disabled).toBe(true);
    transcriptRow.querySelector<HTMLElement>("[data-start-run-check]")!.click();
    await expect.poll(() => confirmButton()?.disabled).toBe(false);
  });

  it("blocks a card duplicate left with only last year's files and report, until a current file is ticked", async () => {
    seedSource(Date.UTC(2024, 11, 31));
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    // Move the fiscal year forward so the old report comes along as last
    // year's report, then untick the transcript and the current file.
    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    await moveFiscalYearTo2025();
    await expect.poll(() => document.querySelector("[data-previous-year-report]")).not.toBeNull();

    await untick("Kickoff.docx");
    await untick("Writer notes.md");
    expect(copyBox("FY2023 report.docx")?.getAttribute("aria-checked")).toBe("true");

    await expect.poll(previousYearRow).toContain(MESSAGE);
    expect(startButton()!.disabled).toBe(true);

    await tick("Writer notes.md");
    await expect.poll(() => startButton()?.disabled).toBe(false);
    expect(previousYearRow()).toBeUndefined();
    await openStartDialog();
    confirmButton()!.click();
    await expect.poll(() => __mutationCalls("projects:createProject").length).toBe(1);
  });

  // Lead note of 2026-09-25 (audit a4 #12): a year on, the transcripts
  // copied from the original are last year's too.
  it("blocks a card duplicate a year on with only last year's transcript and report, until a current file is ticked", async () => {
    seedSource(Date.UTC(2024, 11, 31));
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    await moveFiscalYearTo2025();
    await expect.poll(() => document.querySelector("[data-previous-year-report]")).not.toBeNull();
    await untick("Writer notes.md");
    expect(copyBox("Kickoff.docx")?.getAttribute("aria-checked")).toBe("true");

    await expect.poll(previousYearRow).toContain(TRANSCRIPTS_MESSAGE);
    expect(startButton()!.disabled).toBe(true);

    await tick("Writer notes.md");
    await expect.poll(() => startButton()?.disabled).toBe(false);
    expect(previousYearRow()).toBeUndefined();
  });

  it("lets a same-year card duplicate draft from its copied transcript", async () => {
    seedSource(Date.UTC(2024, 11, 31));
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    await untick("Writer notes.md");
    await expect.poll(() => startButton()?.disabled).toBe(false);
    expect(previousYearRow()).toBeUndefined();
  });

  it("blocks a plain ?from= copy in Write a new PD whose only ticked file is a previous-year report", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    await untick("Kickoff.docx");
    await untick("Writer notes.md");

    await expect.poll(previousYearRow).toContain(MESSAGE);
    expect(startButton()!.disabled).toBe(true);
    expect(__mutationCalls("projects:createProject")).toHaveLength(0);
  });
});
