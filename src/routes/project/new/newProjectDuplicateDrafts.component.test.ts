import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
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

/**
 * Duplicate from a project card (2026-09-25): the card opens
 * /project/new?from=<id>&drafts=iterative. The wizard preselects Generate PD
 * and Step by step, shows the files the copy will bring along, copies the
 * inputs only (no old report, no PD reviews outside Review PD) and then
 * starts that generation like a new project. A bad `drafts` value is
 * ignored, and the old dashboard's plain `?from=` link stays a full clone
 * that starts nothing.
 */

const radio = (group: string, label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] [role="radio"]`)].find(
    (button) => button.textContent?.trim() === label
  );
const checked = (group: string, label: string) => radio(group, label)?.getAttribute("aria-checked");

function buttonByText(text: string) {
  return [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
}

async function clickText(text: string) {
  await expect.poll(() => buttonByText(text)?.disabled).toBe(false);
  buttonByText(text)!.click();
}

/** Each copied file's tick box state, by file name. */
function fileBoxStates(section: HTMLElement) {
  return Object.fromEntries(
    [...section.querySelectorAll<HTMLElement>("[data-copied-file]")].map((row) => [
      row.querySelector("span.truncate")?.textContent?.trim(),
      row.querySelector('button[role="checkbox"]')?.getAttribute("aria-checked"),
    ])
  );
}

const fileBox = (name: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-copied-files] button[role="checkbox"][aria-label="Copy ${name}"]`
  );
const groupBox = (section: HTMLElement, label: string) =>
  section.querySelector<HTMLButtonElement>(
    `button[role="checkbox"][aria-label="Copy all ${label}"]`
  );

async function copiedSection() {
  await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
  return document.querySelector<HTMLElement>("[data-copied-files]")!;
}

function setFiscalYearEnd(value: string) {
  const field = document.querySelector<HTMLInputElement>("#fiscalYearEnd");
  if (!field) throw new Error("Missing fiscal year-end field");
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function commitFromReviewStep() {
  await clickText("Next");
  await expect
    .poll(() =>
      [...document.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Generate Report")
      )
    )
    .toBe(true);
  await clickText("Generate Report");
}

function document_(
  id: string,
  fileName: string,
  overrides: Record<string, unknown> = {}
) {
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

function seedSource(mode: "generate" | "review" = "generate") {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Alloy furnace",
    clientName: "Forgeworks Inc.",
    mode,
  });
  __setQueryData("transcripts:listTranscripts", [
    { _id: "transcript-1", label: "Kickoff.docx", position: 0, createdAt: 1, charCount: 120, wordCount: 20 },
  ]);
  __setQueryData("documents:listDocuments", [
    document_("doc-1", "Writer notes.md", { category: "writer_notes" }),
    document_("doc-2", "FY2024 report.docx", { category: "previous_pd" }),
    document_("doc-3", "Old scoping.md", { category: "scoping_notes", archived: true }),
    document_("doc-4", "Existing PD.docx", { source: "review_pd" }),
    document_("doc-5", "Chat upload.pdf", { source: "chat_upload" }),
  ]);
  __setMutationResult("projects:createProject", {
    projectId: "project-copy",
    transcriptIds: ["copied-1"],
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

describe("/project/new drafts preselection", () => {
  it("preselects Generate PD and Step by step for a card duplicate", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector<HTMLInputElement>("#title")?.value).toBe(
      "Alloy furnace (copy)"
    );
    await expect.poll(() => checked("Draft generation mode", "Step by step")).toBe("true");
    expect(checked("Project mode", "Generate PD")).toBe("true");
    expect(checked("Draft generation mode", "Compare")).toBe("false");
  });

  it.each(["Iterative", "step-by-step", "", "iterative%20"])(
    "ignores the drafts value %j",
    async (bad) => {
      seedSource();
      __setPageUrl(`/project/new?from=project-1&drafts=${bad}`);
      await render(NewProjectPage, {});
      await expect.poll(() => document.querySelector<HTMLInputElement>("#title")?.value).toBe(
        "Alloy furnace (copy)"
      );
      await expect.poll(() => checked("Draft generation mode", "Compare")).toBe("true");
      expect(checked("Draft generation mode", "Step by step")).toBe("false");
    }
  );

  it("preselects a valid mode on a new project without a source", async () => {
    __setPageUrl("/project/new?drafts=single");
    await render(NewProjectPage, {});

    await expect.poll(() => checked("Draft generation mode", "Single draft")).toBe("true");
    expect(checked("Project mode", "Generate PD")).toBe("true");
  });

  it("keeps a review project in Review PD", async () => {
    seedSource("review");
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => checked("Project mode", "Review PD")).toBe("true");
    // Drafts modes belong to Generate PD, so none is on screen.
    expect(document.querySelector('[aria-label="Draft generation mode"]')).toBeNull();
  });
});

describe("/project/new duplicate commit", () => {
  it("copies the inputs only, then starts Step by step like a new project", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => checked("Draft generation mode", "Step by step")).toBe("true");
    await commitFromReviewStep();

    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("projects:createProject")[0]).toMatchObject({
      mode: "generate",
      transcripts: [{ fromTranscriptId: "transcript-1", label: "Kickoff.docx" }],
    });
    expect(__mutationCalls("projectDuplication:copyProjectContent")).toEqual([
      {
        fromProjectId: "project-1",
        toProjectId: "project-copy",
        targetTranscriptId: "copied-1",
        includeReport: false,
        includeReviews: false,
      },
    ]);
    // The same call a new project makes: no old report means nothing to
    // confirm drafting over.
    const requested = __mutationCalls("generations:requestGeneration")[0];
    expect(requested).toMatchObject({ projectId: "project-copy", candidateMode: "iterative" });
    expect(requested).not.toHaveProperty("confirmRegeneration");
    await expect
      .poll(() => __navigationCalls.map((call) => call.url))
      .toContain("/project/project-copy");
  });

  it("runs the Drafts mode the writer switched to", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => checked("Draft generation mode", "Step by step")).toBe("true");
    radio("Draft generation mode", "Single draft")!.click();
    await expect.poll(() => checked("Draft generation mode", "Single draft")).toBe("true");
    await commitFromReviewStep();

    await expect.poll(() => __mutationCalls("generations:requestGeneration").length).toBe(1);
    expect(__mutationCalls("generations:requestGeneration")[0]).toMatchObject({
      projectId: "project-copy",
      candidateMode: "single",
    });
  });

  it("keeps the plain ?from= link a full clone that starts nothing", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector<HTMLInputElement>("#title")?.value).toBe(
      "Alloy furnace (copy)"
    );
    expect(checked("Draft generation mode", "Compare")).toBe("true");
    await commitFromReviewStep();

    await expect
      .poll(() => __navigationCalls.map((call) => call.url))
      .toContain("/project/project-copy");
    expect(__mutationCalls("projectDuplication:copyProjectContent")).toEqual([
      { fromProjectId: "project-1", toProjectId: "project-copy", targetTranscriptId: "copied-1" },
    ]);
    expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
  });

  it("treats an ignored drafts value as the plain link", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1&drafts=bogus");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector<HTMLInputElement>("#title")?.value).toBe(
      "Alloy furnace (copy)"
    );
    await commitFromReviewStep();

    await expect
      .poll(() => __navigationCalls.map((call) => call.url))
      .toContain("/project/project-copy");
    expect(__mutationCalls("projectDuplication:copyProjectContent")[0]).not.toHaveProperty(
      "includeReport"
    );
    expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
  });
});

describe("/project/new copied files", () => {
  const groupIds = (section: HTMLElement) =>
    [...section.querySelectorAll<HTMLElement>("[data-copied-files-group]")].map(
      (group) => group.dataset.copiedFilesGroup
    );

  it("lists what a card duplicate copies, by category, before creating", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    const section = document.querySelector<HTMLElement>("[data-copied-files]")!;
    await expect.poll(() => section.textContent).toContain("Files from Alloy furnace");
    expect(section.querySelector("[data-copied-files-note]")?.textContent?.trim()).toBe(
      "Ticked files are copied into the new project and read for the draft. The old report stays with the original."
    );
    // The reviewed PD stays behind on a Generate PD duplicate.
    expect(section.textContent).toContain("4 files");
    expect(section.textContent).not.toContain("Existing PD.docx");

    // Same order as the Context & files card, then files with no category.
    expect(groupIds(section)).toEqual([
      "writer_notes",
      "previous_pd",
      "scoping_notes",
      "uncategorized",
    ]);
    const groups = [...section.querySelectorAll<HTMLElement>("[data-copied-files-group]")];
    expect(groups.map((group) => group.querySelector("p")?.textContent?.trim())).toEqual([
      "Writer's notes",
      "Previous-year reports",
      "Scoping notes",
      "Chat and other uploads",
    ]);
    expect(groups[0].textContent).toContain("Writer notes.md");
    expect(groups[1].textContent).toContain("FY2024 report.docx");
    expect(groups[2].textContent).toContain("Old scoping.md");
    expect(groups[2].textContent).toContain("Archived, not read for the draft");
    expect(groups[3].textContent).toContain("Chat upload.pdf");
    // Every file and group has a tick box, ticked by default; no native inputs.
    expect(section.querySelector("input")).toBeNull();
    expect(fileBoxStates(section)).toEqual({
      "Writer notes.md": "true",
      "FY2024 report.docx": "true",
      "Old scoping.md": "true",
      "Chat upload.pdf": "true",
    });
    expect(groupBox(section, "Writer's notes")?.getAttribute("aria-checked")).toBe("true");
    expect(section.textContent).not.toMatch(/[\u2013\u2014]/);

    await clickText("Next");
    await expect.poll(() => document.body.textContent).toContain("Copied files");
    expect(document.body.textContent).toContain("4 from Alloy furnace");
  });

  it("keeps the reviewed PD in the list for a Review PD duplicate", async () => {
    seedSource("review");
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    const section = document.querySelector<HTMLElement>("[data-copied-files]")!;
    await expect.poll(() => section.textContent).toContain("Existing PD.docx");
    expect(section.textContent).toContain("5 files");
    expect(section.querySelector("[data-copied-files-note]")?.textContent?.trim()).toBe(
      "Ticked files are copied into the new project as context for the review. The old report stays with the original."
    );
    expect(groupIds(section)).toEqual([
      "writer_notes",
      "previous_pd",
      "scoping_notes",
      "review_pd",
      "uncategorized",
    ]);
    const reviewed = section.querySelector<HTMLElement>('[data-copied-files-group="review_pd"]')!;
    expect(reviewed.querySelector("p")?.textContent?.trim()).toBe("Written PDs reviewed");
    expect(reviewed.textContent).toContain("Existing PD.docx");
  });

  it("lists every file with the clone wording on the plain ?from= link", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    const section = document.querySelector<HTMLElement>("[data-copied-files]")!;
    await expect.poll(() => section.textContent).toContain("Existing PD.docx");
    expect(section.textContent).toContain("5 files");
    expect(section.querySelector("[data-copied-files-note]")?.textContent?.trim()).toBe(
      "Ticked files are copied when you create the project."
    );
  });

  it("counts copied readable files as a source when nothing else is attached", async () => {
    seedSource();
    __setQueryData("transcripts:listTranscripts", []);
    __setQueryData("documents:listDocuments", [
      document_("doc-1", "Writer notes.md", { category: "writer_notes" }),
    ]);
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    await clickText("Next");
    await expect.poll(() => buttonByText("Generate Report")?.disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Add a transcript or at least one context document first.");
  });

  it("does not count an archived or empty copy as a source", async () => {
    seedSource();
    __setQueryData("transcripts:listTranscripts", []);
    __setQueryData("documents:listDocuments", [
      document_("doc-1", "Old notes.md", { category: "writer_notes", archived: true }),
      document_("doc-2", "Scan.pdf", { category: "other", sizeChars: 0 }),
    ]);
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("[data-copied-files]")).not.toBeNull();
    await clickText("Next");
    await expect
      .poll(() => document.body.textContent)
      .toContain("Add a transcript or at least one context document first.");
    expect(buttonByText("Generate Report")?.disabled).toBe(true);
  });

  it("shows no copied files for a new project", async () => {
    __setQueryData("documents:listDocuments", [document_("doc-1", "Writer notes.md")]);
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(() => document.querySelector("#title")).not.toBeNull();
    expect(document.querySelector("[data-copied-files]")).toBeNull();
  });
});

/**
 * Owner decision 35 (2026-09-25): every copied transcript and file has a
 * tick box, ticked by default, and the wizard sends what was unticked as a
 * leave-out list. The old report is offered as last year's report only when
 * the fiscal year moves forward. A Review PD source stays Review PD.
 */
const FYE_2024 = Date.UTC(2024, 11, 31);

function seedYearSource(overrides: Record<string, unknown> = {}) {
  seedSource();
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Alloy furnace",
    clientName: "Forgeworks Inc.",
    mode: "generate",
    fiscalYearEnd: FYE_2024,
    ...overrides,
  });
  __setQueryData("projects:getDuplicateSourceReport", { version: 3, hasText: true });
}

const copyArgs = () =>
  __mutationCalls("projectDuplication:copyProjectContent")[0] as Record<string, unknown>;

/** Picks a date in the fiscal year-end calendar, paging by month. */
async function pickFiscalYearEnd(value: string, direction: "Next" | "Previous") {
  document.querySelector<HTMLButtonElement>("#fiscalYearEnd")!.click();
  const day = () =>
    document.querySelector<HTMLElement>(
      `[data-bits-day][data-value="${value}"]:not([data-outside-month])`
    );
  await expect.poll(() => document.querySelector(`button[aria-label="${direction}"]`)).not.toBeNull();
  for (let page = 0; page < 30 && !day(); page += 1) {
    document.querySelector<HTMLButtonElement>(`button[aria-label="${direction}"]`)!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  day()!.click();
  await expect.poll(() => document.querySelector("#fiscalYearEnd")?.textContent).toContain(
    value.slice(0, 4)
  );
}

async function untick(name: string) {
  await expect.poll(() => fileBox(name)).not.toBeNull();
  fileBox(name)!.click();
  await expect.poll(() => fileBox(name)?.getAttribute("aria-checked")).toBe("false");
}

describe("/project/new unticking copied files", () => {
  it("sends exactly the unticked file as the leave-out list", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    const section = await copiedSection();
    await untick("Writer notes.md");
    expect(section.querySelector("[data-copied-files-count]")?.textContent?.trim()).toBe(
      "3 of 4 files"
    );
    await commitFromReviewStep();

    await expect.poll(() => __mutationCalls("projectDuplication:copyProjectContent").length).toBe(1);
    expect(copyArgs()).toMatchObject({ excludeDocumentIds: ["doc-1"] });
    expect(copyArgs()).not.toHaveProperty("previousYearReport");
  });

  it("toggles a whole group, and shows the mixed state", async () => {
    seedSource();
    __setQueryData("documents:listDocuments", [
      document_("doc-1", "Notes A.md", { category: "writer_notes" }),
      document_("doc-2", "Notes B.md", { category: "writer_notes" }),
      document_("doc-3", "Scoping.md", { category: "scoping_notes" }),
    ]);
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    const section = await copiedSection();
    await expect.poll(() => groupBox(section, "Writer's notes")).not.toBeNull();
    await untick("Notes A.md");
    await expect
      .poll(() => groupBox(section, "Writer's notes")?.getAttribute("aria-checked"))
      .toBe("mixed");

    groupBox(section, "Writer's notes")!.click();
    await expect.poll(() => fileBox("Notes A.md")?.getAttribute("aria-checked")).toBe("true");
    expect(groupBox(section, "Writer's notes")?.getAttribute("aria-checked")).toBe("true");

    groupBox(section, "Writer's notes")!.click();
    await expect.poll(() => fileBox("Notes A.md")?.getAttribute("aria-checked")).toBe("false");
    expect(fileBox("Notes B.md")?.getAttribute("aria-checked")).toBe("false");
    expect(fileBox("Scoping.md")?.getAttribute("aria-checked")).toBe("true");

    await commitFromReviewStep();
    await expect.poll(() => __mutationCalls("projectDuplication:copyProjectContent").length).toBe(1);
    expect(copyArgs().excludeDocumentIds).toEqual(["doc-1", "doc-2"]);
  });

  it("blocks Generate when everything is unticked, until a readable file is ticked", async () => {
    seedSource();
    __setQueryData("documents:listDocuments", [
      document_("doc-1", "Writer notes.md", { category: "writer_notes" }),
    ]);
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await copiedSection();
    await expect
      .poll(() => document.querySelector('[data-transcript-item] button[aria-label="Copy Kickoff.docx"]'))
      .not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-transcript-item] button[aria-label="Copy Kickoff.docx"]')!.click();
    await untick("Writer notes.md");

    await clickText("Next");
    await expect
      .poll(() => document.body.textContent)
      .toContain("Tick a transcript or file from Alloy furnace, or add your own.");
    expect(buttonByText("Generate Report")?.disabled).toBe(true);

    buttonByText("Back")!.click();
    await expect.poll(() => fileBox("Writer notes.md")).not.toBeNull();
    fileBox("Writer notes.md")!.click();
    await clickText("Next");
    await expect.poll(() => buttonByText("Generate Report")?.disabled).toBe(false);
  });

  it("shows the ticked count on the review step", async () => {
    seedSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await copiedSection();
    await untick("Chat upload.pdf");
    await clickText("Next");
    await expect.poll(() => document.body.textContent).toContain("3 of 4 from Alloy furnace");
  });

  it("sends no leave-out list when submitted before the file list loads", async () => {
    seedSource();
    __setQueryData("documents:listDocuments", undefined);
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => checked("Draft generation mode", "Step by step")).toBe("true");
    await commitFromReviewStep();
    await expect.poll(() => __mutationCalls("projectDuplication:copyProjectContent").length).toBe(1);
    expect(copyArgs()).not.toHaveProperty("excludeDocumentIds");
  });

  it("starts a ported PD for the same year unticked, and ticks it once the year moves on", async () => {
    seedYearSource();
    __setQueryData("documents:listDocuments", [
      document_("doc-1", "Writer notes.md", { category: "writer_notes" }),
      document_("doc-2", "FY2024 PD.docx", { category: "previous_pd", source: "ingestion_port" }),
    ]);
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await copiedSection();
    await expect.poll(() => fileBox("FY2024 PD.docx")?.getAttribute("aria-checked")).toBe("false");
    expect(fileBox("FY2024 PD.docx")!.closest("li")?.textContent).toContain(
      "PD for FY 2024, the same year as this project"
    );
    expect(fileBox("Writer notes.md")?.getAttribute("aria-checked")).toBe("true");

    await pickFiscalYearEnd("2025-12-31", "Next");
    await expect.poll(() => fileBox("FY2024 PD.docx")?.getAttribute("aria-checked")).toBe("true");
  });
});

describe("/project/new last year's report", () => {
  const reportRow = () => document.querySelector<HTMLElement>("[data-previous-year-report]");

  it("is offered only once the fiscal year moves forward, ticked", async () => {
    seedYearSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await copiedSection();
    await expect.poll(() => document.querySelector("#fiscalYearEnd")?.textContent).toContain("2024");
    expect(reportRow()).toBeNull();
    expect(document.querySelector("[data-transcripts-year-note]")).toBeNull();

    await pickFiscalYearEnd("2025-12-31", "Next");
    await expect.poll(() => reportRow()).not.toBeNull();
    const row = reportRow()!;
    expect(row.closest("[data-copied-files-group]")?.getAttribute("data-copied-files-group")).toBe(
      "previous_pd"
    );
    expect(row.textContent).toContain("Alloy furnace report (FY 2024)");
    expect(row.textContent).toContain("Made from the original's latest report");
    expect(row.querySelector('button[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("[data-copied-files-count]")?.textContent?.trim()).toBe("5 files");
    expect(document.querySelector("[data-transcripts-year-note]")?.textContent?.trim()).toBe(
      "These transcripts are from FY 2024. Untick any that don't cover this year's work."
    );

    // Moving the year back hides it again.
    await pickFiscalYearEnd("2024-12-31", "Previous");
    await expect.poll(() => reportRow()).toBeNull();

    await pickFiscalYearEnd("2025-12-31", "Next");
    await expect.poll(() => reportRow()).not.toBeNull();
    await commitFromReviewStep();
    await expect.poll(() => __mutationCalls("projectDuplication:copyProjectContent").length).toBe(1);
    expect(copyArgs()).toMatchObject({ includeReport: false, previousYearReport: true });
  });

  it("is not sent when unticked", async () => {
    seedYearSource();
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await copiedSection();
    await pickFiscalYearEnd("2025-12-31", "Next");
    await expect.poll(() => reportRow()).not.toBeNull();
    reportRow()!.querySelector<HTMLButtonElement>('button[role="checkbox"]')!.click();
    await expect
      .poll(() => reportRow()?.querySelector('button[role="checkbox"]')?.getAttribute("aria-checked"))
      .toBe("false");
    await commitFromReviewStep();
    await expect.poll(() => __mutationCalls("projectDuplication:copyProjectContent").length).toBe(1);
    expect(copyArgs()).not.toHaveProperty("previousYearReport");
  });

  it("is never offered on a Review PD duplicate", async () => {
    seedYearSource({ mode: "review" });
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await copiedSection();
    await expect.poll(() => checked("Project mode", "Review PD")).toBe("true");
    await pickFiscalYearEnd("2025-12-31", "Next");
    expect(reportRow()).toBeNull();
  });
});

describe("/project/new Review PD duplicate", () => {
  async function dropPd(name: string) {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"]:not([multiple]):not([accept=".docx"])'
    );
    if (!input) throw new Error("Missing PD input");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Experimental development of a marine battery."], name));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() => document.body.textContent).toContain("words extracted");
  }

  it("keeps Review PD, never offers Step by step, and starts a review", async () => {
    seedSource("review");
    __setMutationResult("documents:uploadDocument", "review-doc");
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => checked("Project mode", "Review PD")).toBe("true");
    const generate = radio("Project mode", "Generate PD")!;
    expect(generate.getAttribute("aria-disabled")).toBe("true");
    generate.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(checked("Project mode", "Review PD")).toBe("true");
    expect(document.querySelector('[aria-label="Draft generation mode"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Step by step");

    await dropPd("Revised PD.txt");
    await clickText("Next");
    await clickText("Review PD");

    await expect.poll(() => __mutationCalls("pdReviews:startPdReview").length).toBe(1);
    expect(copyArgs()).toMatchObject({ includeReport: false, includeReviews: true });
    expect(__mutationCalls("projects:createProject")[0]).toMatchObject({ mode: "review" });
    expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
  });
});

describe("/project/new failed copy", () => {
  it("says the files were not copied, starts nothing and opens the project", async () => {
    const error = vi.spyOn(toast, "error");
    seedSource();
    __setMutationError("projectDuplication:copyProjectContent", new Error("copy failed"));
    __setPageUrl("/project/new?from=project-1&drafts=iterative");
    await render(NewProjectPage, {});

    await expect.poll(() => checked("Draft generation mode", "Step by step")).toBe("true");
    await commitFromReviewStep();

    await expect
      .poll(() => __navigationCalls.map((call) => call.url))
      .toContain("/project/project-copy");
    expect(error.mock.calls.map((call) => call[0])).toContain(
      "Some files from Alloy furnace were not copied. Duplicate again, or add them on the project page."
    );
    expect(error.mock.calls.map((call) => String(call[0])).join(" ")).not.toContain("Generate");
    expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
    error.mockRestore();
  });
});

describe("/project/new failed copy keeps the writer's own files (review D-2)", () => {
  const BASE =
    "Some files from Alloy furnace were not copied. Duplicate again, or add them on the project page.";

  async function addOwnContextFile(name: string) {
    await expect
      .poll(() => document.querySelector('[role="region"][aria-label$=" files"] button'))
      .not.toBeNull();
    document.querySelector<HTMLButtonElement>('[role="region"][aria-label$=" files"] button')!.click();
    await expect
      .poll(() => document.querySelector('[role="region"][aria-label$=" files"] input[type="file"]'))
      .not.toBeNull();
    const input = document.querySelector<HTMLInputElement>(
      '[role="region"][aria-label$=" files"] input[type="file"]'
    )!;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Notes the writer added in the wizard."], name, { type: "text/plain" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.poll(() => document.body.textContent).toContain(name);
  }

  function stubUploads() {
    __setMutationResult("documents:generateUploadUrl", "https://upload.test/own");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ storageId: "storage-own" }))
    );
  }

  it("saves the files the writer added, drafts nothing and says so", async () => {
    const error = vi.spyOn(toast, "error");
    try {
      seedSource();
      stubUploads();
      __setMutationResult("documents:uploadDocument", "own-doc");
      __setMutationError("projectDuplication:copyProjectContent", new Error("copy failed"));
      __setPageUrl("/project/new?from=project-1&drafts=iterative");
      await render(NewProjectPage, {});

      await copiedSection();
      await addOwnContextFile("My notes.txt");
      await commitFromReviewStep();

      await expect
        .poll(() => __navigationCalls.map((call) => call.url))
        .toContain("/project/project-copy");
      expect(__mutationCalls("documents:uploadDocument")).toEqual([
        expect.objectContaining({ projectId: "project-copy", fileName: "My notes.txt" }),
      ]);
      expect(error.mock.calls.map((call) => call[0])).toContain(
        `${BASE} The files you added here were saved.`
      );
      expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
    } finally {
      error.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("names the files the writer added that were not saved", async () => {
    const error = vi.spyOn(toast, "error");
    try {
      seedSource();
      stubUploads();
      __setMutationError("documents:uploadDocument", new Error("offline"));
      __setMutationError("projectDuplication:copyProjectContent", new Error("copy failed"));
      __setPageUrl("/project/new?from=project-1&drafts=iterative");
      await render(NewProjectPage, {});

      await copiedSection();
      await addOwnContextFile("My notes.txt");
      await commitFromReviewStep();

      await expect
        .poll(() => __navigationCalls.map((call) => call.url))
        .toContain("/project/project-copy");
      const messages = error.mock.calls.map((call) => call[0]);
      expect(messages).toContain(
        `${BASE} These files you added were not saved either: My notes.txt.`
      );
      // One message, not a second skipped-files toast as well.
      expect(messages.filter((message) => String(message).includes("My notes.txt"))).toHaveLength(1);
      expect(__mutationCalls("generations:requestGeneration")).toEqual([]);
    } finally {
      error.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("saves the written PD of a Review PD duplicate but starts no review", async () => {
    const error = vi.spyOn(toast, "error");
    try {
      seedSource("review");
      stubUploads();
      __setMutationResult("documents:uploadDocument", "review-doc");
      __setMutationError("projectDuplication:copyProjectContent", new Error("copy failed"));
      __setPageUrl("/project/new?from=project-1&drafts=iterative");
      await render(NewProjectPage, {});

      await expect.poll(() => checked("Project mode", "Review PD")).toBe("true");
      const input = document.querySelector<HTMLInputElement>(
        'input[type="file"]:not([multiple]):not([accept=".docx"])'
      )!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(["Experimental development of a marine battery."], "Revised PD.txt"));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await expect.poll(() => document.body.textContent).toContain("words extracted");
      await clickText("Next");
      await clickText("Review PD");

      await expect
        .poll(() => __navigationCalls.map((call) => call.url))
        .toContain("/project/project-copy");
      expect(__mutationCalls("documents:uploadDocument")).toEqual([
        expect.objectContaining({ fileName: "Revised PD.txt", source: "review_pd" }),
      ]);
      expect(__mutationCalls("pdReviews:startPdReview")).toEqual([]);
      expect(error.mock.calls.map((call) => call[0])).toContain(
        `${BASE} The files you added here were saved. Start the PD review on the project page once the missing files are added.`
      );
    } finally {
      error.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
