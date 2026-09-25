import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import PreviewProjectPage from "./PreviewProjectPage.svelte";
import { __resetPage, __setPageParams } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __activeQueryArgs,
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setPaginatedRows,
  __setQueryData,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import { __resetQaSeenMemory } from "$lib/qa/qaSeen";

/**
 * The preview report page around a signed-off Step-by-step draft
 * (ui-design-final.md sections 6 and 7): the writing view in the Report tab,
 * Stop, the Not drafted banner with Draft the rest, the Draft ready toast and
 * the QA finished notice.
 */
const GENERATION = "gen-seed";

type SectionStatus = "queued" | "writing" | "done" | "not_drafted";
function progress(phase: string, statuses: [SectionStatus, SectionStatus, SectionStatus], percent = 40) {
  const heads = [
    ["242", "Technological uncertainty", "What scientific or technological uncertainties did you attempt to overcome?"],
    ["244", "Work performed", "What work did you perform to overcome these uncertainties?"],
    ["246", "Technological advancement", "What scientific or technological advancements did you achieve?"],
  ];
  return {
    phase,
    percent,
    estimatedRemainingMs: phase === "drafting" ? 60_000 : null,
    currentSectionKey: heads[statuses.indexOf("writing")]?.[0] ?? null,
    stoppedAfterSectionKey: null,
    sections: heads.map(([key, title, question], index) => ({
      key,
      number: key,
      title,
      question,
      orderIndex: index,
      status: statuses[index],
      paragraphs: statuses[index] === "done" ? [`Drafted ${key} paragraph.`] : [],
      startedAt: statuses[index] === "queued" ? null : 1,
      completedAt: statuses[index] === "done" ? 2 : null,
    })),
  };
}

function reportDoc(bodies: Record<"242" | "244" | "246", string>) {
  const content = (["242", "244", "246"] as const).flatMap((line) => [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: `Line ${line}` }] },
    { type: "paragraph", content: [{ type: "text", text: bodies[line] }] },
  ]);
  return JSON.stringify({ type: "doc", content });
}

function seedDrafting() {
  __setQueryData("projects:getProject", {
    _id: "project-1",
    title: "Adaptive cold storage controls",
    clientName: "Cedarline Systems",
    writer: "Writer",
    interviewer: "",
    interviewees: [],
    tagIds: [],
    mode: "generate",
    status: "generating",
    workflowStage: "drafting",
    createdBy: "user-1",
    ownerId: "user-1",
    createdAt: 1,
    updatedAt: 1,
  });
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Jordan", lastName: "Ellis", email: "jordan@example.test" });
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getGenerationSeedView", null);
  __setQueryData("generations:getLatestGeneration", {
    _id: GENERATION,
    status: "running",
    candidateMode: "iterative",
    gatedWorkflow: "seeds",
    seedPhase: "drafting",
    seedStageVersion: 4,
    summaryVersionId: "summary-1",
    seedCanEdit: true,
  });
  __setQueryData("generations:getSeedDraftProgress", progress("drafting", ["done", "writing", "queued"]));
  for (const name of ["pdReviews:getLatestPdReview", "reportViews:getViewSummary"]) __setQueryData(name, null);
  for (const name of ["documents:listDocuments", "tags:listTags", "comments:listComments", "chatV2:listThreads", "chatV2:listTurns", "chatV2:listProposals", "research:listSessions", "uploadAttempts:listUploadAttempts", "transcripts:listTranscripts"]) __setQueryData(name, []);
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("projects:getProjectDetailsPanel", {
    stage: "drafting",
    workflowVersion: 3,
    industry: null,
    fiscalYearEnd: null,
    scienceCode: null,
    projectNumber: null,
    owner: { userId: "user-1", label: "Jordan Ellis", initials: "JE", isYou: true },
    createdAt: 1,
    editedAt: 1,
    currentHandoff: null,
    permissions: { canEditDetails: true, canChangeStage: true, canHandOff: true },
  });
  __setQueryData("chatV2:listMessages", { streams: { kind: "list", messages: [] } });
  __setPaginatedRows("chatV2:listMessages", []);
}

/** The run completes: the report exists and belongs to the same generation. */
function completeRun(content: string, generation: Record<string, unknown> = {}) {
  __setQueryData("reports:getLatestReport", {
    _id: "report-1",
    projectId: "project-1",
    generationId: GENERATION,
    version: 1,
    revisionNumber: 1,
    content,
    createdAt: 2,
    updatedAt: 2,
  });
  __setQueryData("generations:getGenerationSeedView", {
    _id: GENERATION,
    gatedWorkflow: "seeds",
    seedPhase: "completed",
    summaryVersionId: "summary-1",
    seedCanEdit: true,
  });
  __setQueryData("generations:getLatestGeneration", {
    _id: GENERATION,
    status: "completed",
    candidateMode: "iterative",
    gatedWorkflow: "seeds",
    seedPhase: "completed",
    seedStageVersion: 4,
    summaryVersionId: "summary-1",
    seedCanEdit: true,
    ...generation,
  });
}

const exportButton = () => page.getByRole("button", { name: "Export .docx", exact: true });
const sendForReview = () => page.getByRole("button", { name: "Send for review", exact: true });

describe("PreviewProjectPage writing a signed-off Step-by-step draft", () => {
  beforeEach(async () => {
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __resetQaSeenMemory();
    localStorage.clear();
    document.body.innerHTML = "";
    __setPageParams({ id: "project-1" });
    localStorage.setItem("banhall_chat_open", "0");
    await page.viewport(1440, 900);
  });

  it("writes into the Report tab with the pill, and Stop asks first", async () => {
    seedDrafting();
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Writing section 244", { exact: true })).toBeVisible();
    expect(__activeQueryArgs("generations:getSeedDraftProgress")).toEqual([{ generationId: GENERATION }]);
    // The writing view replaces the centred progress card for this run.
    expect(page.getByRole("heading", { name: "Generating your report", exact: true }).elements()).toHaveLength(0);
    expect(document.getElementById("generation-progress-heading")?.textContent).toBe("Adaptive cold storage controls");
    await expect.element(page.getByText("Drafted 242 paragraph.", { exact: true })).toBeVisible();
    expect(document.querySelector('[data-panel-tab="report"]')?.getAttribute("aria-current")).toBe("page");
    // No top-bar cancel and no report actions while writing.
    expect(page.getByRole("button", { name: "Cancel generation", exact: true }).elements()).toHaveLength(0);
    expect(exportButton().elements()).toHaveLength(0);
    expect(sendForReview().elements()).toHaveLength(0);

    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "Stop writing the draft?", exact: true })).toBeVisible();
    expect(document.body.textContent).toContain("Section 244 finishes first, then writing stops.");
    expect(__mutationCalls("generations:stopOrderedGeneration")).toEqual([]);
    await page.getByRole("button", { name: "Keep writing", exact: true }).click();
    expect(__mutationCalls("generations:stopOrderedGeneration")).toEqual([]);
    await expect.poll(() => document.querySelector("[data-stop-drafting-dialog]")).toBeNull();

    document.querySelector<HTMLButtonElement>("[data-pill-stop]")!.click();
    __setMutationResult("generations:stopOrderedGeneration", null);
    await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(() => __mutationCalls("generations:stopOrderedGeneration")).toEqual([{ generationId: GENERATION }]);
    await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
  });

  it("keeps the centred progress card when the progress read does not recognise the run or fails", async () => {
    seedDrafting();
    __setQueryData("generations:getGeneration", {
      _id: GENERATION,
      status: "running",
      currentStep: "Drafting from the signed-off Summary",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    __setQueryData("generations:getSeedDraftProgress", null);
    await render(PreviewProjectPage);
    await expect.element(page.getByRole("heading", { name: "Generating your report", exact: true })).toBeVisible();
    expect(document.querySelector("[data-seed-drafting-view]")).toBeNull();

    __setQueryData("generations:getSeedDraftProgress", progress("drafting", ["done", "writing", "queued"]));
    await expect.element(page.getByText("Writing section 244", { exact: true })).toBeVisible();
    __setQueryError("generations:getSeedDraftProgress", new Error("progress read failed"));
    await expect.element(page.getByRole("heading", { name: "Generating your report", exact: true })).toBeVisible();
    expect(document.querySelector("[data-seed-drafting-view]")).toBeNull();
  });

  it("keeps the Stop dialog open with the reason when every Section is already drafted", async () => {
    seedDrafting();
    __setMutationError(
      "generations:stopOrderedGeneration",
      new ConvexError({ code: "INVALID_STATE", message: "Every Section is already drafted; the report is being finished", reason: "DRAFT_COMPLETE" })
    );
    await render(PreviewProjectPage);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
    await expect
      .element(page.getByText("Every section is already drafted. The report is being put together, so there is nothing left to stop.", { exact: true }))
      .toBeVisible();
    expect(page.getByRole("dialog").elements()).toHaveLength(1);
  });

  it("shows Draft ready when a run this page watched completes, and brings back Export and Send for review", async () => {
    seedDrafting();
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Writing section 244", { exact: true })).toBeVisible();

    __setQueryData("generations:getSeedDraftProgress", progress("completed", ["done", "done", "done"], 100));
    completeRun(reportDoc({ "242": "Final 242.", "244": "Final 244.", "246": "Final 246." }), { postQaStatus: "running" });
    await expect.element(page.getByText("Your draft is ready", { exact: true })).toBeVisible();
    expect(document.querySelector("[data-draft-ready-toast]")?.textContent).toContain("QA is checking it");
    await expect.element(exportButton()).toBeVisible();
    await expect.element(sendForReview()).toBeVisible();
    await expect.element(page.getByText("Final 244.", { exact: true })).toBeVisible();
    // Top centre of the Report tab, over the report.
    const host = document.querySelector<HTMLElement>("[data-draft-ready-host]")!;
    const main = document.querySelector<HTMLElement>("[data-project-main]")!;
    expect(host.parentElement).toBe(main);
    const toast = document.querySelector<HTMLElement>("[data-draft-ready-toast]")!.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    expect(Math.abs(toast.left + toast.width / 2 - (mainRect.left + mainRect.width / 2))).toBeLessThan(2);
    expect(toast.top - mainRect.top).toBeLessThan(40);
    // QA running: the toolbar toggle shows the spinner, no chip.
    expect(document.querySelector('[data-panel-toggle="qa"]')?.getAttribute("data-qa-state")).toBe("running");

    document.querySelector<HTMLButtonElement>("[data-toast-close]")!.click();
    await expect.poll(() => document.querySelector("[data-draft-ready-toast]")).toBeNull();
  });

  it("never shows Draft ready for a report it did not watch being written", async () => {
    seedDrafting();
    __setQueryData("generations:getSeedDraftProgress", progress("completed", ["done", "done", "done"], 100));
    completeRun(reportDoc({ "242": "Final 242.", "244": "Final 244.", "246": "Final 246." }));
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Final 244.", { exact: true })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector("[data-draft-ready-toast]")).toBeNull();
  });

  it("marks a stopped report's missing Sections and drafts only those with Draft the rest", async () => {
    seedDrafting();
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Writing section 244", { exact: true })).toBeVisible();

    __setQueryData("generations:getSeedDraftProgress", progress("stopped", ["done", "not_drafted", "not_drafted"], 40));
    completeRun(reportDoc({ "242": "Final 242.", "244": "[NOT GENERATED]", "246": "[NOT GENERATED]" }), { stopRequestedAt: 5, stoppedAfterSection: "242" });
    await expect.element(page.getByText("Writing stopped. Sections 244 and 246 were not drafted.", { exact: true })).toBeVisible();
    // A stopped run gets the banner, not the Draft ready toast.
    expect(document.querySelector("[data-draft-ready-toast]")).toBeNull();
    // The editor marks each placeholder paragraph "Not drafted" in place.
    await expect.poll(() => document.querySelectorAll('.ProseMirror p[data-not-drafted="true"]').length).toBe(2);
    const marker = document.querySelector<HTMLElement>('.ProseMirror p[data-not-drafted="true"]')!;
    expect(getComputedStyle(marker, "::before").content).toBe('"Not drafted"');

    __setMutationError("generations:redraftMissingSections", new ConvexError({ code: "GENERATION_ACTIVE", message: "A generation is already active for this project" }));
    await page.getByRole("button", { name: "Draft the rest", exact: true }).click();
    await expect
      .element(page.getByText("Another draft is running for this project. Try again when it finishes.", { exact: true }))
      .toBeVisible();

    __setMutationResult("generations:redraftMissingSections", { status: "started", sections: ["244", "246"] });
    await page.getByRole("button", { name: "Draft the rest", exact: true }).click();
    await expect.poll(() => __mutationCalls("generations:redraftMissingSections")).toEqual([
      { generationId: GENERATION },
      { generationId: GENERATION },
    ]);
    // The redraft is live: the banner shows it pending.
    __setQueryData("generations:getSeedDraftProgress", progress("drafting", ["done", "writing", "queued"], 50));
    await expect.element(page.getByRole("button", { name: "Drafting…", exact: true })).toBeDisabled();

    // The redraft fills the same report: the banner goes and Draft ready shows.
    __setQueryData("generations:getSeedDraftProgress", progress("completed", ["done", "done", "done"], 100));
    completeRun(reportDoc({ "242": "Final 242.", "244": "Redrafted 244.", "246": "Redrafted 246." }));
    await expect.element(page.getByText("Redrafted 246.", { exact: true })).toBeVisible();
    await expect.poll(() => document.querySelector("[data-not-drafted-banner]")).toBeNull();
    await expect.element(page.getByText("Your draft is ready", { exact: true })).toBeVisible();
  });

  it("saves typing before Draft the rest and keeps the report read-only until the filled Sections are in", async () => {
    seedDrafting();
    __setQueryData("generations:getSeedDraftProgress", progress("stopped", ["done", "not_drafted", "not_drafted"], 40));
    completeRun(reportDoc({ "242": "Final 242.", "244": "[NOT GENERATED]", "246": "[NOT GENERATED]" }), { stopRequestedAt: 5, stoppedAfterSection: "242" });
    __setMutationResult("reports:updateReportContent", 2);
    await render(PreviewProjectPage);
    await expect.element(page.getByRole("button", { name: "Draft the rest", exact: true })).toBeVisible();
    const prose = () => document.querySelector<HTMLElement>(".ProseMirror")!;

    // Typing inside the editor schedules a debounced autosave.
    await page.getByText("Final 242.", { exact: true }).click();
    await userEvent.keyboard("{End} Typed before.");
    await expect.poll(() => prose().textContent).toContain("Typed before.");

    let resolveRedraft!: (value: unknown) => void;
    __setMutationResult("generations:redraftMissingSections", new Promise((done) => (resolveRedraft = done)));
    await page.getByRole("button", { name: "Draft the rest", exact: true }).click();
    // The pending save is flushed before the redraft starts.
    await expect.poll(() => __mutationCalls("generations:redraftMissingSections")).toHaveLength(1);
    const saves = __mutationCalls("reports:updateReportContent") as Array<{ content: string }>;
    expect(saves.at(-1)?.content).toContain("Typed before.");
    // Read-only from the click, with a quiet reason.
    await expect.poll(() => prose().getAttribute("contenteditable")).toBe("false");
    await expect
      .element(page.getByText("Drafting the missing sections. Editing resumes when they are in.", { exact: true }))
      .toBeVisible();

    // The request resolves and the redraft is live: still read-only.
    __setQueryData("generations:getSeedDraftProgress", progress("drafting", ["done", "writing", "queued"], 50));
    resolveRedraft({ status: "started", sections: ["244", "246"] });
    await new Promise((done) => setTimeout(done, 50));
    expect(prose().getAttribute("contenteditable")).toBe("false");
    // Typing during the attempt changes nothing and saves nothing.
    prose().focus();
    await userEvent.keyboard(" Typed during.");
    await new Promise((done) => setTimeout(done, 1300));
    expect(prose().textContent).not.toContain("Typed during.");
    const savedBefore = __mutationCalls("reports:updateReportContent").length;

    // The server merge keeps the saved edit and fills the missing Sections.
    __setQueryData("generations:getSeedDraftProgress", progress("completed", ["done", "done", "done"], 100));
    completeRun(reportDoc({ "242": "Final 242. Typed before.", "244": "Redrafted 244.", "246": "Redrafted 246." }));
    await expect.element(page.getByText("Redrafted 246.", { exact: true })).toBeVisible();
    await expect.poll(() => prose().getAttribute("contenteditable")).toBe("true");
    expect(prose().textContent).toContain("Final 242. Typed before.");
    expect(document.querySelector("[data-redraft-status]")).toBeNull();
    await new Promise((done) => setTimeout(done, 1300));
    const later = __mutationCalls("reports:updateReportContent") as Array<{ content: string }>;
    expect(later).toHaveLength(savedBefore);
    expect(later.some((save) => save.content.includes("Typed during."))).toBe(false);
  });

  it("shows a redraft that failed after it started, with a retry", async () => {
    seedDrafting();
    completeRun(reportDoc({ "242": "Final 242.", "244": "[NOT GENERATED]", "246": "[NOT GENERATED]" }), { stopRequestedAt: 5, stoppedAfterSection: "242" });
    __setQueryData("generations:getSeedDraftProgress", {
      ...progress("stopped", ["done", "not_drafted", "not_drafted"], 40),
      redraft: { status: "running", error: null, attemptId: "attempt-1" },
    });
    await render(PreviewProjectPage);
    await expect.element(page.getByRole("button", { name: "Draft the rest", exact: true })).toBeVisible();

    // The worker fails: the progress read reports the attempt's failure.
    __setQueryData("generations:getSeedDraftProgress", {
      ...progress("stopped", ["done", "not_drafted", "not_drafted"], 40),
      redraft: { status: "failed", error: "The model did not respond in time.", attemptId: "attempt-1" },
    });
    await expect
      .element(page.getByText("Drafting the missing sections did not finish. The model did not respond in time.", { exact: true }))
      .toBeVisible();
    __setMutationResult("generations:redraftMissingSections", { status: "started", sections: ["244", "246"] });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect.poll(() => __mutationCalls("generations:redraftMissingSections")).toEqual([{ generationId: GENERATION }]);

    // A new attempt runs: the failure makes way for it.
    __setQueryData("generations:getSeedDraftProgress", {
      ...progress("drafting", ["done", "writing", "queued"], 50),
      redraft: { status: "running", error: null, attemptId: "attempt-2" },
    });
    await expect.element(page.getByRole("button", { name: "Drafting…", exact: true })).toBeDisabled();
    expect(document.querySelector("[data-redraft-failed]")).toBeNull();
  });

  it("shows QA finished bottom right until QA is opened, and keeps the dot after Later", async () => {
    seedDrafting();
    completeRun(reportDoc({ "242": "Final 242.", "244": "Final 244.", "246": "Final 246." }), {
      postQaStatus: "done",
      postQaCompletedAt: 1_000,
      agentOutputs: JSON.stringify({ qa: { overall_score: 78, section_scores: { "242": { score: 86 }, "244": { score: 62 }, "246": { score: 84 } } } }),
    });
    __setQueryData("generations:getSeedDraftProgress", progress("completed", ["done", "done", "done"], 100));
    const screen = await render(PreviewProjectPage);
    await expect.element(page.getByRole("heading", { name: "QA finished", exact: true })).toBeVisible();
    const notice = document.querySelector<HTMLElement>("[data-qa-finished-notice]")!;
    const rect = notice.getBoundingClientRect();
    // Board 4.5: 24px inside the report panel's bottom right corner.
    const panel = document.querySelector<HTMLElement>("[data-project-main]")!.getBoundingClientRect();
    expect(panel.right - rect.right).toBe(24);
    expect(panel.bottom - rect.bottom).toBe(24);
    expect(Array.from(notice.querySelectorAll("[data-qa-section-row]")).map((row) => row.getAttribute("data-qa-section-row"))).toEqual(["242", "244", "246"]);
    const toggle = () => document.querySelector<HTMLElement>('[data-panel-toggle="qa"]')!;
    expect(toggle().querySelector("[data-qa-unseen-dot]")).not.toBeNull();

    // Later: the notice goes, the dot stays until QA is opened.
    await page.getByRole("button", { name: "Later", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-qa-finished-notice]")).toBeNull();
    expect(toggle().querySelector("[data-qa-unseen-dot]")).not.toBeNull();
    expect(localStorage.getItem(`banhall_qa_seen:${GENERATION}:1000`)).toBe("dismissed");

    // A reload keeps the dismissal: no notice, dot still there.
    screen.unmount();
    document.body.innerHTML = "";
    await render(PreviewProjectPage);
    await expect.element(page.getByText("Final 244.", { exact: true })).toBeVisible();
    expect(document.querySelector("[data-qa-finished-notice]")).toBeNull();
    expect(toggle().querySelector("[data-qa-unseen-dot]")).not.toBeNull();
    await page.getByRole("button", { name: "QA score 78, new result", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-side-panel]")?.getAttribute("data-side-panel")).toBe("qa");
    await expect.poll(() => toggle().querySelector("[data-qa-unseen-dot]")).toBeNull();
    expect(localStorage.getItem(`banhall_qa_seen:${GENERATION}:1000`)).toBe("seen");
  });

  it("opens the QA score panel from the notice and marks the result seen", async () => {
    seedDrafting();
    completeRun(reportDoc({ "242": "Final 242.", "244": "Final 244.", "246": "Final 246." }), {
      postQaStatus: "done",
      postQaCompletedAt: 2_000,
      agentOutputs: JSON.stringify({ qa: { overall_score: 91, section_scores: { "242": { score: 90 } } } }),
    });
    __setQueryData("generations:getSeedDraftProgress", progress("completed", ["done", "done", "done"], 100));
    await render(PreviewProjectPage);
    await expect.element(page.getByRole("heading", { name: "QA finished", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open QA", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-side-panel]")?.getAttribute("data-side-panel")).toBe("qa");
    // Board 2.2 names the panel "QA score".
    await expect.element(page.getByRole("button", { name: "Close QA score", exact: true })).toBeVisible();
    await expect.poll(() => document.querySelector("[data-qa-finished-notice]")).toBeNull();
    expect(document.querySelector('[data-panel-toggle="qa"] [data-qa-unseen-dot]')).toBeNull();
    expect(localStorage.getItem(`banhall_qa_seen:${GENERATION}:2000`)).toBe("seen");
  });
});
