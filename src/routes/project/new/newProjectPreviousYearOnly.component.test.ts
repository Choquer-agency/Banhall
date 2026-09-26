import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
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

/**
 * Decision 42 (2026-09-25): a draft is never built from last year's report
 * alone. When every transcript and current file is unticked or missing and
 * only previous-year files (or the original's report brought along as last
 * year's report) remain, Generate Report is disabled with a plain message.
 * The server refuses the same case (convex/previousYearSourceGuard.test.ts).
 */
const MESSAGE =
  "Add a transcript or a current file. Last year's report alone can't be the source for this year's report.";

function buttonByText(text: string) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
}

async function clickText(text: string) {
  await expect.poll(() => buttonByText(text)?.disabled).toBe(false);
  buttonByText(text)!.click();
}

async function generateButton() {
  await expect.poll(() => buttonByText("Generate Report")).not.toBeUndefined();
  return buttonByText("Generate Report")!;
}

function setInputValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

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

beforeEach(() => {
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

    await expect.poll(() => document.querySelector("#title")).not.toBeNull();
    setInputValue("#title", "Solar tracker");
    setInputValue("#clientName", "Acme Labs");

    // Open the Previous-year reports group and drop last year's PD into it.
    const header = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Previous-year reports")
    );
    header!.click();
    await expect
      .poll(() => document.querySelector('[role="region"][aria-label^="Files for fiscal"]'))
      .not.toBeNull();
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Last year's project description."], "FY2024 PD.txt", { type: "text/plain" }));
    document
      .querySelector('[role="region"][aria-label^="Files for fiscal"]')!
      .dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    await expect.poll(() => document.body.textContent).toContain("FY2024 PD.txt");

    await clickText("Next");
    await expect.poll(() => document.body.textContent).toContain(MESSAGE);
    expect((await generateButton()).disabled).toBe(true);
    expect(document.body.textContent).not.toContain(
      "Add a transcript or at least one context document first."
    );

    // A pasted transcript is a current-year source.
    buttonByText("Back")!.click();
    await clickText("Paste text");
    await expect.poll(() => document.querySelector("#transcript")).not.toBeNull();
    setInputValue("#transcript", "Interviewer: What was uncertain?\nEngineer: The tracker drift.");
    await clickText("Next");
    await expect.poll(async () => (await generateButton()).disabled).toBe(false);
    expect(document.body.textContent).not.toContain(MESSAGE);
  });

  it("blocks a card duplicate left with only last year's files and report, until a current file is ticked", async () => {
    seedSource(Date.UTC(2024, 11, 31));
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    // Move the fiscal year forward so the old report comes along as last
    // year's report, then untick the transcript and the current file.
    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
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
    await expect.poll(() => document.querySelector("[data-previous-year-report]")).not.toBeNull();

    await untick("Kickoff.docx");
    await untick("Writer notes.md");
    expect(copyBox("FY2023 report.docx")?.getAttribute("aria-checked")).toBe("true");

    await clickText("Next");
    await expect.poll(() => document.body.textContent).toContain(MESSAGE);
    expect((await generateButton()).disabled).toBe(true);

    buttonByText("Back")!.click();
    await tick("Writer notes.md");
    await clickText("Next");
    await expect.poll(async () => (await generateButton()).disabled).toBe(false);
    expect(document.body.textContent).not.toContain(MESSAGE);
    (await generateButton()).click();
    await expect.poll(() => __mutationCalls("projects:createProject").length).toBe(1);
  });

  it("blocks a plain ?from= copy in Generate PD whose only ticked file is a previous-year report", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    await untick("Kickoff.docx");
    await untick("Writer notes.md");

    await clickText("Next");
    await expect.poll(() => document.body.textContent).toContain(MESSAGE);
    expect((await generateButton()).disabled).toBe(true);
    expect(__mutationCalls("projects:createProject")).toHaveLength(0);
  });
});
