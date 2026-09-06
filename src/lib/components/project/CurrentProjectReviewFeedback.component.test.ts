import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import CurrentProjectPage from "./CurrentProjectPage.svelte";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __activeQueryCount, __mutationCalls, __resetConvexStub, __setQueryData,
  __setMutationError, __setMutationResult,
} from "$lib/test/convex-svelte-stub.svelte";
import type { PdReviewResultParsed } from "../../../../shared/pdReview";

const draft = "The comparison draft preserves the writer's thermal investigation evidence.";
const summary = "The PD identifies thermal uncertainty but needs clearer experimental evidence.";
const suggestion = "Connect each temperature trial to its measured result and technical conclusion.";
const feedback = {
  summary, qualitative_score: 72, score_rationale: "The investigation needs more measurable detail.",
  strengths: ["The technical uncertainty is clearly identified."],
  risks: ["The trial outcomes are not quantified."], suggested_strengthening: [suggestion],
} satisfies PdReviewResultParsed;
const content = JSON.stringify({ type: "doc", content: [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "242 - Technological uncertainties" }] },
  { type: "paragraph", content: [{ type: "text", text: draft }] },
] });
const now = Date.UTC(2026, 8, 5, 12);
type ReviewState = "completed" | "running" | "failed" | "unreadable" | "absent";

function seed({ mode = "review", report = true, transcript = true, review = "completed" }: {
  mode?: "review" | "generate"; report?: boolean; transcript?: boolean; review?: ReviewState;
} = {}) {
  __setQueryData("projects:getProject", {
    _id: "project-q4", title: "Thermal investigation", sredTitle: "", clientName: "Acme Labs",
    writer: "Wren Writer", interviewer: "", interviewees: [], tagIds: [], mode,
    status: report ? "review" : "draft", workflowStage: report ? "drafting" : "intake",
    createdBy: "writer-q4", ownerId: "writer-q4", createdAt: now, updatedAt: now,
    shareToken: "q4-fixture-token",
  });
  __setQueryData("users:getCurrentUser", {
    _id: "writer-q4", role: "writer", firstName: "Wren", lastName: "Writer", email: "writer@example.test",
  });
  __setQueryData("reports:getLatestReport", report ? {
    _id: "report-q4", projectId: "project-q4", content, version: 2, revisionNumber: 4,
    createdAt: now, updatedAt: now, sourceTranscriptId: "transcript-q4",
  } : null);
  // An existing report alone must require confirmation, even without a generation row.
  __setQueryData("generations:getLatestGeneration", null);
  __setQueryData("pdReviews:getLatestPdReview", review === "absent" ? null : {
    _id: "review-q4", projectId: "project-q4", documentId: "document-q4",
    sourceFileName: "Thermal-PD.docx", status: review === "unreadable" ? "completed" : review,
    createdAt: now, completedAt: review === "completed" ? now : undefined,
    result: review === "completed" ? JSON.stringify(feedback) : review === "unreadable" ? "{}" : undefined,
    error: review === "failed" ? "The review could not complete." : undefined,
  });
  __setQueryData("transcripts:listTranscripts", transcript ? [{
    _id: "transcript-q4", label: "Thermal interview.docx", position: 0,
    createdAt: now, charCount: 66, wordCount: 10,
  }] : []);
  __setQueryData("transcripts:getTranscriptContent", {
    _id: "transcript-q4", label: "Thermal interview.docx", content: "Engineer: The thermal trials tested heat transfer under varying flow.",
  });
  for (const name of ["documents:listDocuments", "tags:listTags", "comments:listComments",
    "pdReviews:listPdReviewEvents", "chatV2:listThreads", "chatV2:listProposals",
    "research:listSessions", "uploadAttempts:listUploadAttempts", "snapshots:listSnapshots"]) {
    __setQueryData(name, []);
  }
  __setQueryData("reportViews:getViewSummary", null);
}

function editor() {
  const node = document.querySelector<HTMLElement>(".tiptap[contenteditable=true]");
  if (!node) throw new Error("The real editable report did not mount");
  return node;
}
function scrollPane() {
  const node = editor().closest<HTMLElement>(".overflow-y-auto");
  if (!node) throw new Error("Report scroll pane missing");
  return node;
}
function headings() {
  return Array.from(document.querySelectorAll("h2")).filter((h) => h.textContent === "AI PD review");
}
async function mount(options: Parameters<typeof seed>[0] = {}, width = 1440) {
  seed(options);
  await page.viewport(width, 1000);
  await render(CurrentProjectPage);
  if (options.report !== false) await expect.poll(() => editor().textContent).toContain(draft);
}
async function readElement(element: Element) {
  element.scrollIntoView({ block: "center" });
  await expect.element(page.elementLocator(element)).toBeVisible();
  const box = element.getBoundingClientRect();
  const pane = scrollPane().getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(pane.top - 1);
  expect(box.bottom).toBeLessThanOrEqual(pane.bottom + 1);
  expect(box.left).toBeGreaterThanOrEqual(pane.left - 1);
  expect(box.right).toBeLessThanOrEqual(pane.right + 1);
}
const viewedEvents = () => __mutationCalls("pdReviews:logPdReviewEvent").filter(
  (args) => typeof args === "object" && args !== null && "action" in args && args.action === "review_viewed"
);
const requests = () => __mutationCalls("generations:requestGeneration");
const generationEvents = () => __mutationCalls("pdReviews:logPdReviewEvent").filter(
  (args) => typeof args === "object" && args !== null && "action" in args && args.action === "generate_from_review"
);

beforeEach(() => {
  __resetAuthState(); __resetPage(); __resetNavigation(); __resetConvexStub();
  localStorage.clear();
  __setPageUrl("/project/project-q4?workspace=current");
  __setPageParams({ id: "project-q4" });
});

describe("Current project comparison review feedback", () => {
  for (const width of [390, 1440]) {
    it(`keeps the real draft and feedback readable at ${width}px`, async () => {
      await mount({}, width);
      const phase = headings().length ? "after" : "before";
      await page.screenshot({ path: `../../../../.vitest-attachments/Q4/${width}-default-${phase}.png` });
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await expect.poll(() => document.querySelector("aside")?.getBoundingClientRect().width).toBeLessThan(1);
      await readElement(editor().querySelector("p") ?? editor());
      await page.screenshot({ path: `../../../../.vitest-attachments/Q4/${width}-editor-${phase}.png` });
      const pane = scrollPane();
      console.info("Q4 geometry", JSON.stringify({ width, phase, documentWidth: document.documentElement.scrollWidth,
        paneWidth: pane.clientWidth, paneScrollWidth: pane.scrollWidth }));
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1);
      // Capture the baseline supporting area before deliberately failing the regression assertion.
      pane.scrollTop = pane.scrollHeight;
      await page.screenshot({ path: `../../../../.vitest-attachments/Q4/${width}-supporting-${phase}.png` });
      await expect.poll(() => headings().length).toBe(1);
      await readElement(headings()[0]);
      expect(headings()).toHaveLength(1);
      for (const text of ["Thermal-PD.docx", summary, suggestion]) {
        await readElement(page.getByText(text, { exact: true }).element());
        if (text !== "Thermal-PD.docx") {
          await page.screenshot({ path: `../../../../.vitest-attachments/Q4/${width}-${text === summary ? "summary" : "suggestion"}-${phase}.png` });
        }
      }
      const panel = page.getByRole("region", { name: "Suggested strengthening" }).element();
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      expect(editor().textContent).toContain(draft);
      expect(requests()).toEqual([]);
      expect(__mutationCalls("reports:updateReportContent")).toEqual([]);
      // This is the current subscription count, not a historical fetch trace.
      expect(__activeQueryCount("transcripts:getTranscriptContent")).toBe(0);
    });
  }

  it("keeps comparison disabled without transcripts and never requests generation", async () => {
    await mount({ transcript: false });
    const button = page.getByRole("button", { name: "Generate PD for comparison", exact: true });
    await expect.element(button).toBeDisabled();
    button.element().scrollIntoView();
    await expect.element(button).toBeVisible();
    // Native disabled activation must not invoke the callback.
    const disabledButton = button.element();
    if (!(disabledButton instanceof HTMLButtonElement)) throw new Error("Expected a native button");
    disabledButton.click();
    expect(requests()).toEqual([]);
    expect(generationEvents()).toEqual([]);
    await expect.element(page.getByRole("dialog", { name: "This project already has a generated test" })).not.toBeInTheDocument();
  });

  it("preserves confirmation and cancellation, surfaces failure, and retries generation", async () => {
    await mount();
    const button = page.getByRole("button", { name: "Generate PD for comparison", exact: true });
    await button.click();
    const dialog = page.getByRole("dialog", { name: "This project already has a generated test" });
    await expect.element(dialog).toBeVisible();
    expect(requests()).toEqual([]);
    expect(generationEvents()).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(requests()).toEqual([]);
    expect(generationEvents()).toEqual([]);
    const expectedRequest = { projectId: "project-q4", lengthTarget: "standard",
      candidateMode: "compare", confirmRegeneration: true };
    const expectedEvent = { projectId: "project-q4", reviewId: "review-q4", action: "generate_from_review" };
    __setMutationError("generations:requestGeneration", new Error("Generation is temporarily unavailable."));
    await button.click();
    await dialog.getByRole("button", { name: "Re-run generation", exact: true }).click();
    await expect.poll(requests).toEqual([expectedRequest]);
    await expect.element(page.getByRole("alert")).toHaveTextContent("Generation is temporarily unavailable.");
    expect(generationEvents()).toEqual([expectedEvent]);
    expect(editor().textContent).toContain(draft);
    expect(__mutationCalls("reports:updateReportContent")).toEqual([]);

    __setMutationResult("generations:requestGeneration", null);
    await button.click();
    await expect.element(dialog).toBeVisible();
    expect(requests()).toEqual([expectedRequest]);
    expect(generationEvents()).toEqual([expectedEvent]);
    await dialog.getByRole("button", { name: "Re-run generation", exact: true }).click();
    await expect.poll(requests).toEqual([expectedRequest, expectedRequest]);
    expect(generationEvents()).toEqual([expectedEvent, expectedEvent]);
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    expect(editor().textContent).toContain(draft);
    expect(__mutationCalls("reports:updateReportContent")).toEqual([]);
  });

  it("keeps one current feedback panel as intake becomes a draft and its review changes", async () => {
    await mount({ report: false });
    const originalView = { projectId: "project-q4", reviewId: "review-q4", action: "review_viewed" };
    await expect.poll(viewedEvents).toEqual([originalView]);
    expect(headings()).toHaveLength(1);
    expect(document.querySelector(".tiptap[contenteditable=true]")).toBeNull();

    __setQueryData("reports:getLatestReport", {
      _id: "report-q4", projectId: "project-q4", content, version: 2, revisionNumber: 4,
      generatedAt: now, updatedAt: now, sourceTranscriptId: "transcript-q4",
    });
    await expect.poll(() => editor().textContent).toContain(draft);
    // Intake and editor are different component mounts. Existing semantics
    // deliberately log the completed review once for each mount.
    await expect.poll(viewedEvents).toEqual([originalView, originalView]);
    expect(headings()).toHaveLength(1);
    await page.getByRole("button", { name: "Close assistant", exact: true }).click();

    const currentView = { projectId: "project-q4", reviewId: "review-current", action: "review_viewed" };
    const currentSummary = "The replacement PD now explains the measured thermal limits.";
    for (const state of ["running", "failed", "unreadable", "completed"] satisfies ReviewState[]) {
      __setQueryData("pdReviews:getLatestPdReview", {
        _id: "review-current", projectId: "project-q4", documentId: "document-current",
        sourceFileName: "Replacement-PD.docx",
        status: state === "unreadable" ? "completed" : state,
        createdAt: now + 1000,
        ...(state === "completed" || state === "unreadable" ? { completedAt: now + 2000 } : {}),
        ...(state === "completed" ? { result: JSON.stringify({ ...feedback, summary: currentSummary }) }
          : state === "unreadable" ? { result: "{}" }
          : state === "failed" ? { error: "The current review could not complete." } : {}),
      });
      const expectedText = state === "running" ? "Reviewing the written PD…"
        : state === "failed" ? "The review failed."
        : state === "unreadable" ? "This review finished, but its result couldn’t be read." : currentSummary;
      await expect.element(page.getByText(expectedText, { exact: true })).toBeInTheDocument();
      await readElement(page.getByText(expectedText, { exact: true }).element());
      await readElement(page.getByText("Replacement-PD.docx", { exact: true }).element());
      expect(headings()).toHaveLength(1);
      await expect.element(page.getByText("Thermal-PD.docx", { exact: true })).not.toBeInTheDocument();
      await expect.element(page.getByText(summary, { exact: true })).not.toBeInTheDocument();
      expect(editor().textContent).toContain(draft);
      // A completed but unreadable payload still logs a view; repairing that
      // same review's payload must not log a second view in the same mount.
      await expect.poll(viewedEvents).toEqual(state === "running" || state === "failed"
        ? [originalView, originalView] : [originalView, originalView, currentView]);
    }
    expect(requests()).toEqual([]);
    expect(generationEvents()).toEqual([]);
    expect(__mutationCalls("reports:updateReportContent")).toEqual([]);
  });

  it("adds no panel to an ordinary generate-mode report", async () => {
    await mount({ mode: "generate" });
    expect(headings()).toHaveLength(0);
    expect(__activeQueryCount("pdReviews:listPdReviewEvents")).toBe(0);
    expect(requests()).toEqual([]);
  });
  it("adds no panel when the review row is absent", async () => {
    await mount({ review: "absent" });
    expect(headings()).toHaveLength(0);
    expect(requests()).toEqual([]);
  });
  for (const state of ["completed", "running", "failed", "unreadable"] satisfies ReviewState[]) {
    it(`preserves the single ${state} intake panel without a report`, async () => {
      await mount({ report: false, review: state });
      await expect.element(page.getByRole("heading", { name: "AI PD review", exact: true })).toBeVisible();
      expect(headings()).toHaveLength(1);
      expect(document.querySelector(".tiptap[contenteditable=true]")).toBeNull();
      const text = state === "completed" ? summary : state === "running" ? "Reviewing the written PD…"
        : state === "failed" ? "The review failed." : "This review finished, but its result couldn’t be read.";
      await expect.element(page.getByText(text, { exact: true })).toBeVisible();
      expect(requests()).toEqual([]);
      expect(generationEvents()).toEqual([]);
    });
  }
});
