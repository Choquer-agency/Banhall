import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
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
      "Files from Alloy furnace are copied into this new project, then the report is generated from them. The old report is not copied."
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
      "Other project files",
    ]);
    expect(groups[0].textContent).toContain("Writer notes.md");
    expect(groups[1].textContent).toContain("FY2024 report.docx");
    expect(groups[2].textContent).toContain("Old scoping.md");
    expect(groups[2].textContent).toContain("Archived");
    expect(groups[3].textContent).toContain("Chat upload.pdf");
    // Read-only: nothing to remove or replace.
    expect(section.querySelector("button, input")).toBeNull();
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
      "Files from Alloy furnace are copied into this new project, then the review runs on the PD you upload. The old report is not copied."
    );
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
      "Copied from Alloy furnace when you create the project."
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
