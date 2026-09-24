import { beforeEach, describe, expect, it } from "vitest";
import { page as browserPage, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __navigationCalls, __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { ConvexError } from "convex/values";
import {
  __activeQueryArgs,
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import CurrentProjectPage from "./CurrentProjectPage.svelte";
import PreviewProjectPage from "./PreviewProjectPage.svelte";

// The Summary bar's primary opens the sign-off confirm (board 3.4); only the
// confirm's own primary starts sign-off.
const summarySignOffButton = () =>
  browserPage.getByRole("region", { name: "Summary review" }).getByRole("button", { name: "Sign off and generate PD", exact: true });
const signOffConfirmButton = () =>
  browserPage.getByRole("dialog").getByRole("button", { name: "Sign off and generate PD", exact: true });
async function confirmSummarySignOff() {
  await summarySignOffButton().click();
  await expect.element(browserPage.getByRole("dialog")).toBeVisible();
  await signOffConfirmButton().click();
}

const budget = {
  limit: 1_000_000,
  estimatedBytesRead: 0,
  reservedDocumentBytes: 0,
  rangesRead: 0,
  rangeLimit: 100,
  exhausted: false,
};
const frozenSettings = { lengthTarget: "standard", modelId: "claude-test", writerProfile: null };

/** A frozen Summary page as the real reader returns it for `generationId`. */
function frozenSummary(generationId: string, summaryVersionId: string, bullets: string[] = []) {
  return {
    page: bullets.map((bullet, index) => ({
      kind: "selection", seedId: `seed-frozen-${index}`, roleId: "company_context",
      subsectionKind: "standard", bullets: [bullet],
      support: "source_supported", tags: [], uncertaintySeedId: null, experimentSeedIds: [], edited: false, provenance: [],
    })),
    skippedRoleIds: [], isDone: true, continueCursor: "done", partial: false,
    frozen: true, generationId, summaryVersionId, seedStageVersion: 4,
    settings: frozenSettings, budget,
  };
}

/** The host's live Outline; readiness defaults to ready. */
function hostOutline(readiness: { ready: boolean; complete: boolean; blockingRoleIds: string[] } = { ready: true, complete: true, blockingRoleIds: [] }) {
  return {
    generationId: "generation-seed-host",
    rows: PD_SUBSECTIONS.map((definition) => ({
      ...definition,
      state: "in_progress",
      stale: false,
      staleReason: null,
      outdated: false,
      selectedCount: 0,
      selectedWordCount: 0,
      countsComplete: true,
      previewLines: [],
      pendingBatchId: null,
      shownBatchId: null,
    })),
    readiness,
    usage: { requests: 1, notice: false },
    seedStageVersion: 4,
    truncated: false,
    budget,
    canEdit: true,
    workflow: "seeds",
    frozen: {
      briefVersionId: "brief-seed-host",
      summaryVersionId: null,
      lengthTarget: "standard",
      modelId: "claude-test",
      writerProfile: null,
    },
  };
}

/**
 * Report actions and the generation cancel, per host. The frozen current page
 * shows History in its header and "Cancel iterative draft"; the preview page
 * keeps History in the top-bar More menu and names the cancel "Cancel
 * generation" (ui-design-final.md section 2 and decision 19).
 */
function reportActions(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
  return Component === PreviewProjectPage
    ? browserPage.getByRole("button", { name: "More actions", exact: true })
    : browserPage.getByRole("button", { name: "History", exact: true });
}
function cancelGeneration(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
  return browserPage.getByRole("button", {
    name: Component === PreviewProjectPage ? "Cancel generation" : "Cancel iterative draft",
    exact: true,
  });
}

/**
 * The signed-off draft's progress read (`generations:getSeedDraftProgress`).
 * The preview page writes a signed-off Step-by-step draft into the Report tab
 * from it; the frozen current page keeps the centred progress card.
 */
function seedDraftProgress() {
  return {
    phase: "drafting",
    percent: 20,
    estimatedRemainingMs: 120_000,
    currentSectionKey: "242",
    stoppedAfterSectionKey: null,
    sections: [
      { key: "242", number: "242", title: "Technological uncertainty", question: "What scientific or technological uncertainties did you attempt to overcome?", orderIndex: 0, status: "writing", paragraphs: [], startedAt: 1, completedAt: null },
      { key: "244", number: "244", title: "Work performed", question: "What work did you perform to overcome these uncertainties?", orderIndex: 1, status: "queued", paragraphs: [], startedAt: null, completedAt: null },
      { key: "246", number: "246", title: "Technological advancement", question: "What scientific or technological advancements did you achieve?", orderIndex: 2, status: "queued", paragraphs: [], startedAt: null, completedAt: null },
    ],
  };
}

/** The Seed drafting surface's heading in each host: the preview page's
 * writing view titles the draft with the project title; the current page's
 * progress card says "Generating your report". */
function seedDraftingHeading(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
  return Component === PreviewProjectPage
    ? browserPage.getByRole("region", { name: "Generation progress" }).getByRole("heading", { name: "Adaptive controller", exact: true })
    : browserPage.getByRole("heading", { name: "Generating your report", exact: true });
}

/** The host's Subsection read; `shownBatchId` is the Batch on screen. */
function hostSubsection(shownBatchId: string | null = null) {
  return {
    generationId: "generation-seed-host",
    roleId: "company_context",
    state: "in_progress",
    stale: false,
    staleReason: null,
    items: [{
      seedId: "seed-host-1",
      batchId: "batch-host-1",
      roleId: "company_context",
      bullets: ["Server workspace wording."],
      originalBullets: ["Server workspace wording."],
      tags: ["technical"],
      support: "source_supported",
      originalSupport: "source_supported",
      selected: true,
      edited: false,
      revisionOfSeedId: null,
      feedbackRequestId: null,
      uncertaintySeedId: null,
      experimentSeedIds: [],
      provenance: [],
      provenanceTruncated: false,
      outdated: null,
    }],
    feedbackGroups: [],
    shownBatchId,
    pendingBatchId: null,
    approvalChallenge: null,
    seedStageVersion: 4,
    truncated: false,
    budget,
  };
}

function seedHostQueries() {
  __setQueryData("projects:getProject", {
    _id: "project-seed-host",
    title: "Adaptive controller",
    sredTitle: "Adaptive control under load",
    clientName: "Acme Labs",
    writer: "Wren Writer",
    interviewer: "",
    interviewees: [],
    tagIds: [],
    mode: "generate",
    status: "generating",
    workflowStage: "drafting",
    industry: "manufacturing",
    scienceCode: "1.02.01",
    fiscalYearEnd: Date.UTC(2025, 11, 31),
    createdBy: "writer-1",
    ownerId: "writer-1",
    createdAt: 1,
    updatedAt: 1,
    shareToken: "seed-host-token",
    activeGenerationId: "generation-seed-host",
  });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("users:getCurrentUser", {
    _id: "writer-1",
    role: "writer",
    firstName: "Wren",
    lastName: "Writer",
    email: "writer@example.test",
  });
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getLatestGeneration", {
    _id: "generation-seed-host",
    status: "awaiting_input",
    candidateMode: "iterative",
    gatedWorkflow: "seeds",
    seedPhase: "seeding",
    seedStageVersion: 4,
    seedStageError: undefined,
    summaryVersionId: null,
    briefVersionId: "brief-seed-host",
    seedCanEdit: true,
    candidatesDone: 0,
    candidatesFailed: 0,
    totalCandidates: 1,
  });
  __setQueryData("pdReviews:getLatestPdReview", null);
  __setQueryData("reportViews:getViewSummary", null);
  __setQueryData("tags:listTags", []);
  __setQueryData("transcripts:listTranscripts", []);
  for (const name of [
    "documents:listDocuments",
    "comments:listComments",
    "pdReviews:listPdReviewEvents",
    "chatV2:listThreads",
    "chatV2:listProposals",
    "research:listSessions",
    "uploadAttempts:listUploadAttempts",
    "snapshots:listSnapshots",
  ]) __setQueryData(name, []);

  __setQueryData("generations:getSeedDraftProgress", seedDraftProgress());
  __setQueryData("seeds:getOutline", hostOutline());
  __setQueryData("seeds:getSubsection", hostSubsection());
  __setQueryData("seeds:getSummary", {
    page: [{
      kind: "selection",
      seedId: "seed-host-1",
      roleId: "company_context",
      subsectionKind: "standard",
      bullets: ["Server workspace wording."],
      support: "source_supported",
      tags: ["technical"],
      uncertaintySeedId: null,
      experimentSeedIds: [], edited: false, provenance: [],
    }],
    skippedRoleIds: [],
    isDone: true,
    continueCursor: "done",
    partial: false,
    frozen: false,
    generationId: "generation-seed-host",
    summaryVersionId: null,
    seedStageVersion: 4,
    settings: frozenSettings,
    budget,
  });
}

async function assertConnectedJourney(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
  const mounted = await render(Component, {});
  await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
  expect(document.body.textContent).not.toContain("Section-by-section draft");

  await browserPage.getByRole("button", { name: "Edit", exact: true }).click();
  await browserPage.getByRole("textbox", { name: "Bullet 1" }).fill("Workspace draft survives the Summary.");

  // A7: keyboard entry moves focus to the Summary heading after rendering.
  const reviewTrigger = browserPage.getByRole("button", { name: "Review summary", exact: true });
  (reviewTrigger.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(browserPage.getByRole("heading", { name: "Summary review", exact: true })).toBeVisible();
  await expect.poll(() => document.activeElement?.id).toBe("summary-review-title");
  expect(__navigationCalls).toContainEqual({
    kind: "pushState",
    url: "/project/project-seed-host?view=summary",
  });

  await browserPage.getByRole("button", { name: "Edit", exact: true }).click();
  await browserPage.getByRole("textbox", { name: "Bullet 1" }).fill("Summary draft survives the workspace.");

  // Browser Back/Forward provide the same focus transitions, both ways.
  const browserUrl = new URL(window.location.href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
  await expect.poll(() => document.activeElement?.id).toBe("seed-review-summary-trigger");
  browserUrl.searchParams.set("view", "summary");
  window.history.pushState({}, "", browserUrl);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.element(browserPage.getByRole("heading", { name: "Summary review", exact: true })).toBeVisible();
  await expect.poll(() => document.activeElement?.id).toBe("summary-review-title");
  await browserPage.getByRole("button", { name: "Edit", exact: true }).click();
  await expect.element(browserPage.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Summary draft survives the workspace.");
  browserUrl.searchParams.delete("view");
  window.history.replaceState({}, "", browserUrl);

  // Returning by keyboard restores focus to the recreated Review summary
  // trigger without losing either local draft.
  const backToWorkspace = browserPage.getByRole("button", { name: "Back to plan", exact: true });
  (backToWorkspace.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
  await expect.poll(() => document.activeElement?.id).toBe("seed-review-summary-trigger");
  await expect.element(browserPage.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Workspace draft survives the Summary.");

  __setQueryData("users:getCurrentUser", {
    _id: "writer-2",
    role: "writer",
    firstName: "Rae",
    lastName: "Writer",
    email: "rae@example.test",
  });
  await expect.element(browserPage.getByText("Server workspace wording.", { exact: true })).toBeVisible();
  expect(browserPage.getByRole("textbox", { name: "Bullet 1" }).elements()).toHaveLength(0);

  __setQueryData("users:getCurrentUser", {
    _id: "writer-1",
    role: "writer",
    firstName: "Wren",
    lastName: "Writer",
    email: "writer@example.test",
  });
  await expect.element(browserPage.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Workspace draft survives the Summary.");
  await browserPage.getByRole("button", { name: "Review summary", exact: true }).click();
  await browserPage.getByRole("button", { name: "Edit", exact: true }).click();
  await expect.element(browserPage.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Summary draft survives the workspace.");
  mounted.unmount();
}

describe("Seed project hosts", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    localStorage.clear();
    __resetAuthState();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    __setPageParams({ id: "project-seed-host" });
    __setPageUrl("/project/project-seed-host");
    const cleanBrowserUrl = new URL(window.location.href);
    cleanBrowserUrl.searchParams.delete("view");
    window.history.replaceState({}, "", cleanBrowserUrl);
    seedHostQueries();
    await browserPage.viewport(1366, 900);
  });

  it("reserves no Assistant panel in Seeds and records no Batch view while the preview host shows Sources", async () => {
    // Default preferences save the Assistant as open; Seeds offers none.
    await render(PreviewProjectPage, {});
    await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
    expect(document.querySelector("[data-side-panel-divider]")).toBeNull();
    const aside = document.querySelector<HTMLElement>('aside[aria-label="Side panel"]')!;
    expect(aside.hasAttribute("data-side-panel")).toBe(false);
    expect(aside.getBoundingClientRect().width).toBe(0);

    // A new Batch arrives while Sources is selected: the workspace stays
    // mounted under a hidden ancestor, so nothing is recorded as viewed.
    await browserPage.getByRole("button", { name: "Sources", exact: true }).click();
    const workspace = browserPage.getByLabelText("Seed workspace").element();
    __setQueryData("seeds:getSubsection", hostSubsection("batch-host-2"));
    await new Promise((done) => setTimeout(done, 400));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([]);
    expect(browserPage.getByLabelText("Seed workspace").element()).toBe(workspace);

    // Back on the Plan, the Batch is on screen and its view is recorded.
    await browserPage.getByRole("button", { name: /^Plan/ }).click();
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([
      { generationId: "generation-seed-host", roleId: "company_context", batchId: "batch-host-2", expectedSeedStageVersion: 4 },
    ]);
  });

  it("routes the current host from Seeds to Summary and back without the legacy stepper", async () => {
    await assertConnectedJourney(CurrentProjectPage);
  });

  it("routes the preview host from Seeds to Summary and back without the legacy stepper", async () => {
    await assertConnectedJourney(PreviewProjectPage);
  });

  async function assertOpenStepLink(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    // Board 3.3: a not-ready Summary links its open step; the workspace
    // restores that step from its own per-user, per-generation record.
    // The plan only offers "Review summary" once it is ready (or on a reopened
    // step), so a not-ready Summary is entered through its URL, as the Summary
    // tab does.
    __setQueryData("seeds:getOutline", hostOutline({ ready: false, complete: true, blockingRoleIds: ["goal_problem"] }));
    __setPageUrl("/project/project-seed-host?view=summary");
    const browserUrl = new URL(window.location.href);
    browserUrl.searchParams.set("view", "summary");
    window.history.replaceState({}, "", browserUrl);
    const mounted = await render(Component, {});
    await expect.element(summarySignOffButton()).toBeDisabled();
    await browserPage.getByRole("button", { name: "1 step still open: open Goal / Problem" }).click();
    await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
    expect(localStorage.getItem("seeds.openRole:writer-1:generation-seed-host")).toBe("goal_problem");
    await expect.poll(() => __activeQueryArgs("seeds:getSubsection")).toContainEqual(
      expect.objectContaining({ generationId: "generation-seed-host", roleId: "goal_problem" })
    );
    expect(__navigationCalls.at(-1)).toEqual({ kind: "pushState", url: "/project/project-seed-host" });
    mounted.unmount();
  }

  it("gives the preview Summary tab its own id and returns focus to the control that opened the Summary", async () => {
    await render(PreviewProjectPage, {});
    await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
    const trigger = browserPage.getByRole("button", { name: "Review summary", exact: true });
    await expect.element(trigger).toBeVisible();
    const tab = document.querySelector<HTMLButtonElement>('[data-panel-tab="summary"]')!;
    // The tab and the workspace trigger are two controls with two ids.
    expect(tab.id).toBe("seed-summary-tab");
    expect(document.querySelectorAll("#seed-summary-tab")).toHaveLength(1);
    expect(document.querySelectorAll("#seed-review-summary-trigger")).toHaveLength(1);
    expect(document.getElementById("seed-review-summary-trigger")).toBe(trigger.element());
    expect(document.querySelectorAll("#seed-signed-off-summary-trigger")).toHaveLength(0);

    // Opened from the tab: leaving the Summary returns focus to the tab.
    tab.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.activeElement?.id).toBe("summary-review-title");
    expect(document.querySelectorAll("#seed-summary-tab")).toHaveLength(1);
    await browserPage.getByRole("button", { name: "Back to plan", exact: true }).click();
    await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
    await expect.poll(() => document.activeElement?.id).toBe("seed-summary-tab");

    // Opened from the workspace trigger: focus returns to that trigger.
    (trigger.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.activeElement?.id).toBe("summary-review-title");
    await browserPage.getByRole("button", { name: "Back to plan", exact: true }).click();
    await expect.poll(() => document.activeElement?.id).toBe("seed-review-summary-trigger");
  });

  it("opens the Summary's open step in the current host's workspace", async () => {
    await assertOpenStepLink(CurrentProjectPage);
  });

  it("opens the Summary's open step in the preview host's workspace", async () => {
    await assertOpenStepLink(PreviewProjectPage);
  });

  it("removes every Seed mutation control from read-only initialization, workspace, and recovery", async () => {
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "seeding",
      seedStageVersion: 4,
      summaryVersionId: null,
      briefVersionId: "brief-seed-host",
      seedCanEdit: false,
    });
    __setQueryData("seeds:getOutline", {
      generationId: "generation-seed-host",
      rows: PD_SUBSECTIONS.map((definition) => ({
          ...definition,
          state: "in_progress",
          stale: false,
          staleReason: null,
          outdated: false,
          selectedCount: 0,
          selectedWordCount: 0,
          countsComplete: true,
          previewLines: [],
          pendingBatchId: null,
          shownBatchId: null,
        })),
      readiness: { ready: false, complete: true, blockingRoleIds: ["company_context"] },
      usage: { requests: 1, notice: false },
      seedStageVersion: 4,
      truncated: false,
      budget,
      canEdit: false,
      workflow: "seeds",
      frozen: { briefVersionId: "brief-seed-host", summaryVersionId: null, lengthTarget: "standard", modelId: "claude-test", writerProfile: null },
    });
    let mounted = await render(PreviewProjectPage, {});
    await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
    for (const name of ["Cancel iterative draft", "Edit", "Give feedback", "Regenerate", "Approve and continue", "Confirm and approve", "Cancel generation"]) {
      expect(browserPage.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    mounted.unmount();

    document.body.innerHTML = "";
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "running",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "initializing",
      seedStageError: "Seed preparation failed safely.",
      summaryVersionId: null,
      seedCanEdit: false,
    });
    mounted = await render(PreviewProjectPage, {});
    await expect.element(browserPage.getByText("Seed preparation needs attention", { exact: true })).toBeVisible();
    expect(browserPage.getByRole("button", { name: "Retry initialization", exact: true }).elements()).toHaveLength(0);
    mounted.unmount();

    document.body.innerHTML = "";
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "failed",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "draftFailed",
      summaryVersionId: "summary-frozen",
      seedCanEdit: false,
    });
    __setQueryData("seeds:getSummary", frozenSummary("generation-seed-host", "summary-frozen", ["Read-only frozen item."]));
    mounted = await render(PreviewProjectPage, {});
    await expect.element(browserPage.getByRole("heading", { name: "Summary review", exact: true })).toBeVisible();
    await expect.element(browserPage.getByText("Read-only frozen item.", { exact: true })).toBeVisible();
    expect(browserPage.getByRole("button", { name: "Retry from this Summary", exact: true }).elements()).toHaveLength(0);
    expect(__mutationCalls("generations:retryFromSummary")).toEqual([]);
    mounted.unmount();
  });

  it("opens the displayed report's frozen Summary when a newer generation exists", async () => {
    const reportContent = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Completed Seed report." }] }],
    });
    __setQueryData("reports:getLatestReport", {
      _id: "report-seed-host",
      projectId: "project-seed-host",
      generationId: "generation-report-owner",
      content: reportContent,
      version: 1,
      revisionNumber: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-newer",
      status: "completed",
      candidateMode: "single",
      gatedWorkflow: undefined,
      summaryVersionId: null,
    });
    __setQueryData("generations:getGenerationSeedView", {
      _id: "generation-report-owner",
      gatedWorkflow: "seeds",
      seedPhase: "completed",
      summaryVersionId: "summary-report-owner",
      seedCanEdit: true,
    });
    __setQueryData("seeds:getSummary", frozenSummary(
      "generation-report-owner", "summary-report-owner", ["Frozen report-owned Summary item."]
    ));
    await render(PreviewProjectPage, {});
    await expect.element(browserPage.getByText("Completed Seed report.", { exact: true })).toBeVisible();
    expect(__activeQueryArgs("generations:getGenerationSeedView")).toContainEqual({ generationId: "generation-report-owner" });
    await browserPage.getByRole("button", { name: "Signed-off Summary", exact: true }).click();
    await expect.element(browserPage.getByText("Frozen report-owned Summary item.", { exact: true })).toBeVisible();
    expect(__activeQueryArgs("seeds:getSummary")).toContainEqual({
      generationId: "generation-report-owner",
      versionId: "summary-report-owner",
      cursor: null,
      numItems: 50,
    });
    expect(document.body.textContent).not.toContain("Completed Seed report.");
  });

  it("requests an iterative run and follows the mounted host through initialization into Seeds", async () => {
    __setQueryData("generations:getLatestGeneration", null);
    __setQueryData("transcripts:listTranscripts", [{
      _id: "transcript-seed-host",
      label: "Controller interview.docx",
      position: 0,
      createdAt: 1,
      charCount: 72,
      wordCount: 11,
    }]);
    __setQueryData("transcripts:getTranscriptContent", {
      _id: "transcript-seed-host",
      label: "Controller interview.docx",
      content: "Engineer: The controller trials measured stability across three load bands.",
    });
    await render(PreviewProjectPage, {});
    await browserPage.getByRole("radio", { name: "Section by section", exact: true }).click();
    await browserPage.getByRole("button", { name: "Generate Report", exact: true }).click();
    expect(__mutationCalls("generations:requestGeneration")).toEqual([{
      projectId: "project-seed-host",
      lengthTarget: "standard",
      candidateMode: "iterative",
    }]);

    __setQueryData("generations:getGeneration", {
      _id: "generation-seed-host",
      status: "running",
      currentStep: "Preparing Seed evidence",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "running",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "initializing",
      seedStageVersion: 4,
      summaryVersionId: null,
      seedCanEdit: true,
    });
    await expect.element(browserPage.getByRole("heading", { name: "Generating your report", exact: true })).toBeVisible();

    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "seeding",
      seedStageVersion: 4,
      summaryVersionId: null,
      briefVersionId: "brief-seed-host",
      seedCanEdit: true,
    });
    await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
  });

  async function assertSignoffThroughCompletedReport(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    __setQueryData("generations:getGeneration", {
      _id: "generation-seed-host",
      status: "running",
      currentStep: "Drafting from the signed-off Summary",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    await render(Component, {});
    await browserPage.getByRole("button", { name: "Review summary", exact: true }).click();
    await confirmSummarySignOff();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([{
      generationId: "generation-seed-host",
      expectedSeedStageVersion: 4,
    }]);

    __setQueryData("reports:getLatestReport", {
      _id: "report-older",
      projectId: "project-seed-host",
      generationId: "generation-older",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Older completed report." }] }] }),
      version: 1,
      revisionNumber: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    __setQueryData("generations:getGenerationSeedView", {
      _id: "generation-older",
      gatedWorkflow: "seeds",
      seedPhase: "completed",
      summaryVersionId: "summary-older",
      seedCanEdit: true,
    });

    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "running",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "drafting",
      seedStageVersion: 4,
      summaryVersionId: "summary-frozen",
      seedCanEdit: true,
    });
    await expect.element(seedDraftingHeading(Component)).toBeVisible();
    expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Older completed report.");

    __setQueryData("seeds:getSummary", frozenSummary("generation-seed-host", "summary-frozen", ["Failed draft frozen Summary."]));
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "failed",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "draftFailed",
      seedStageVersion: 4,
      summaryVersionId: "summary-frozen",
      seedCanEdit: true,
    });
    await expect.element(browserPage.getByRole("button", { name: "Retry from this Summary", exact: true })).toBeVisible();
    await expect.element(browserPage.getByText("Failed draft frozen Summary.", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Older completed report.");
    await browserPage.getByRole("button", { name: "Retry from this Summary", exact: true }).click();
    expect(__mutationCalls("generations:retryFromSummary")).toEqual([{
      failedGenerationId: "generation-seed-host",
    }]);

    // A9: Summary recovery reserves a DISTINCT generation bound to the same
    // Summary; the host follows that recovery generation, not the failed one.
    __setQueryData("generations:getGeneration", {
      _id: "generation-recovery",
      status: "running",
      currentStep: "Drafting from the recovered Summary",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-recovery",
      status: "running",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "drafting",
      seedStageVersion: 0,
      summaryVersionId: "summary-frozen",
      originGenerationId: "generation-seed-host",
      seedCanEdit: true,
    });
    await expect.element(seedDraftingHeading(Component)).toBeVisible();
    expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    expect(browserPage.getByRole("button", { name: "Retry from this Summary", exact: true }).elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Older completed report.");

    __setQueryData("reports:getLatestReport", {
      _id: "report-recovery-complete",
      projectId: "project-seed-host",
      generationId: "generation-recovery",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Newly completed Seed report." }] }] }),
      version: 1,
      revisionNumber: 1,
      createdAt: 2,
      updatedAt: 2,
    });
    __setQueryData("generations:getGenerationSeedView", {
      _id: "generation-recovery",
      gatedWorkflow: "seeds",
      seedPhase: "completed",
      summaryVersionId: "summary-frozen",
      seedCanEdit: true,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-recovery",
      status: "completed",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "completed",
      seedStageVersion: 0,
      summaryVersionId: "summary-frozen",
      originGenerationId: "generation-seed-host",
      seedCanEdit: true,
    });
    __setQueryData("seeds:getSummary", frozenSummary("generation-recovery", "summary-frozen", ["Completed run frozen Summary."]));
    await expect.element(browserPage.getByText("Newly completed Seed report.", { exact: true })).toBeVisible();
    expect(__activeQueryArgs("generations:getGenerationSeedView")).toContainEqual({ generationId: "generation-recovery" });
    expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    await browserPage.getByRole("button", { name: "Signed-off Summary", exact: true }).click();
    await expect.element(browserPage.getByText("Completed run frozen Summary.", { exact: true })).toBeVisible();
    // The report-owned Summary is read through the recovery generation while
    // keeping the ORIGINAL Summary identity.
    expect(__activeQueryArgs("seeds:getSummary")).toContainEqual({
      generationId: "generation-recovery",
      versionId: "summary-frozen",
      cursor: null,
      numItems: 50,
    });
    expect(browserPage.getByRole("button", { name: "Sign off and generate PD", exact: true }).elements()).toHaveLength(0);
    expect(browserPage.getByRole("button", { name: "Edit", exact: true }).elements()).toHaveLength(0);
  }

  it("routes the current host from sign-off through the completed report and frozen Summary", async () => {
    await assertSignoffThroughCompletedReport(CurrentProjectPage);
  });

  it("routes the preview host from sign-off through the completed report and frozen Summary", async () => {
    await assertSignoffThroughCompletedReport(PreviewProjectPage);
  });

  async function assertClosedRunRouting(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    // A6: an unsigned run cancelled (or failed) after its Seed rows exist is
    // closed. It routes through the existing failure retry, never the workspace.
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "failed",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "closed",
      seedStageVersion: 4,
      summaryVersionId: null,
      seedCanEdit: true,
      error: "Cancelled by writer",
    });
    __setQueryData("generations:getGeneration", {
      _id: "generation-seed-host",
      status: "failed",
      currentStep: "Cancelled",
      error: "Cancelled by writer",
      startedAt: 1,
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    let mounted = await render(Component, {});
    await expect.element(browserPage.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
    for (const name of ["Edit", "Give feedback", "Regenerate", "Approve and continue", "Confirm and approve", "Review summary", "Cancel iterative draft", "Sign off and generate PD", "Cancel generation"]) {
      expect(browserPage.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    expect(__activeQueryArgs("seeds:getOutline")).toEqual([]);
    expect(__activeQueryArgs("seeds:getSubsection")).toEqual([]);
    mounted.unmount();

    document.body.innerHTML = "";
    __setQueryData("reports:getLatestReport", {
      _id: "report-older",
      projectId: "project-seed-host",
      generationId: "generation-older",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Older completed report." }] }] }),
      version: 1,
      revisionNumber: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    __setQueryData("generations:getGenerationSeedView", {
      _id: "generation-older",
      gatedWorkflow: "seeds",
      seedPhase: "completed",
      summaryVersionId: "summary-older",
      seedCanEdit: true,
    });
    mounted = await render(Component, {});
    await expect.element(browserPage.getByText("Older completed report.", { exact: true })).toBeVisible();
    expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
    for (const name of ["Edit", "Give feedback", "Regenerate", "Approve and continue", "Confirm and approve", "Review summary", "Cancel iterative draft", "Cancel generation"]) {
      expect(browserPage.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    mounted.unmount();
  }

  it("routes a closed unsigned Seed run in the current host through failure retry or the existing report", async () => {
    await assertClosedRunRouting(CurrentProjectPage);
  });

  it("routes a closed unsigned Seed run in the preview host through failure retry or the existing report", async () => {
    await assertClosedRunRouting(PreviewProjectPage);
  });

  async function assertInitializationRetry(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    __setQueryData("generations:getGeneration", {
      _id: "generation-seed-host",
      status: "running",
      currentStep: "Preparing Seed evidence",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "running",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "initializing",
      seedStageError: "Seed preparation did not complete. Retry initialization.",
      seedStageVersion: 0,
      summaryVersionId: null,
      seedCanEdit: true,
    });
    __setMutationError("generations:retryInitializeSeedStage", new ConvexError({
      code: "INVALID_STATE",
      message: "Seed preparation is already running",
    }));
    await render(Component, {});
    await expect.element(browserPage.getByText("Seed preparation needs attention", { exact: true })).toBeVisible();
    expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Section-by-section draft");
    await browserPage.getByRole("button", { name: "Retry initialization", exact: true }).click();
    await expect.element(browserPage.getByRole("alert")).toHaveTextContent("Seed preparation is already running");
    __setMutationResult("generations:retryInitializeSeedStage", null);
    await browserPage.getByRole("button", { name: "Retry initialization", exact: true }).click();
    expect(__mutationCalls("generations:retryInitializeSeedStage")).toEqual([
      { generationId: "generation-seed-host" },
      { generationId: "generation-seed-host" },
    ]);
  }

  it("retries failed Seed initialization from the current host and announces a refusal", async () => {
    await assertInitializationRetry(CurrentProjectPage);
  });

  it("retries failed Seed initialization from the preview host and announces a refusal", async () => {
    await assertInitializationRetry(PreviewProjectPage);
  });

  it("keeps an explicit legacy sections generation on the section stepper", async () => {
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "sections",
    });
    __setQueryData("generations:getIterativeState", {
      sectionRuns: [],
      currentStep: "Awaiting section review",
      progressLog: [],
      ghost: null,
    });
    await render(PreviewProjectPage, {});
    await expect.element(browserPage.getByRole("heading", { name: "Section-by-section draft", exact: true })).toBeVisible();
    expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
  });

  async function assertReportSummaryFocus(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    __setQueryData("reports:getLatestReport", {
      _id: "report-seed-host",
      projectId: "project-seed-host",
      generationId: "generation-report-owner",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Completed Seed report." }] }] }),
      version: 1,
      revisionNumber: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-report-owner",
      status: "completed",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "completed",
      summaryVersionId: "summary-report-owner",
      seedCanEdit: true,
    });
    __setQueryData("generations:getGenerationSeedView", {
      _id: "generation-report-owner",
      gatedWorkflow: "seeds",
      seedPhase: "completed",
      summaryVersionId: "summary-report-owner",
      seedCanEdit: true,
    });
    __setQueryData("seeds:getSummary", frozenSummary("generation-report-owner", "summary-report-owner", ["Frozen report-owned Summary item."]));
    await render(Component, {});
    await expect.element(browserPage.getByText("Completed Seed report.", { exact: true })).toBeVisible();

    const trigger = browserPage.getByRole("button", { name: "Signed-off Summary", exact: true });
    (trigger.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(browserPage.getByText("Frozen report-owned Summary item.", { exact: true })).toBeVisible();
    await expect.poll(() => document.activeElement?.id).toBe("summary-review-title");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const back = browserPage.getByRole("button", { name: "Back to report", exact: true });
    (back.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(browserPage.getByText("Completed Seed report.", { exact: true })).toBeVisible();
    await expect.poll(() => document.activeElement?.id).toBe("seed-signed-off-summary-trigger");

    // Browser history into the frozen Summary and back gives the same transitions.
    const browserUrl = new URL(window.location.href);
    browserUrl.searchParams.set("view", "summary");
    window.history.pushState({}, "", browserUrl);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => document.activeElement?.id).toBe("summary-review-title");
    browserUrl.searchParams.delete("view");
    window.history.pushState({}, "", browserUrl);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => document.activeElement?.id).toBe("seed-signed-off-summary-trigger");
  }

  it("moves focus between the report's Signed-off Summary trigger and the Summary heading in the current host", async () => {
    await assertReportSummaryFocus(CurrentProjectPage);
  });

  it("moves focus between the report's Signed-off Summary trigger and the Summary heading in the preview host", async () => {
    await assertReportSummaryFocus(PreviewProjectPage);
  });

  async function assertReportPreservedForOtherModes(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    // A10: only Seed phases suppress an existing report; single and compare
    // reservations and running generations keep it and its actions.
    __setQueryData("reports:getLatestReport", {
      _id: "report-seed-host",
      projectId: "project-seed-host",
      generationId: "generation-older",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Existing report stays visible." }] }] }),
      version: 1,
      revisionNumber: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    __setQueryData("generations:getGenerationSeedView", null);
    __setQueryData("generations:getGeneration", {
      _id: "generation-single",
      status: "reserved",
      currentStep: "Reserving",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-single",
      status: "reserved",
      candidateMode: "single",
      gatedWorkflow: undefined,
      summaryVersionId: null,
    });
    await render(Component, {});
    const reportText = browserPage.getByText("Existing report stays visible.", { exact: true });
    await expect.element(browserPage.getByRole("heading", { name: "Preparing report generation", exact: true })).toBeVisible();
    await expect.element(reportText).toBeVisible();
    await expect.element(reportActions(Component)).toBeVisible();

    __setQueryData("generations:getGeneration", {
      _id: "generation-compare",
      status: "running",
      currentStep: "Drafting two candidates",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 2,
      candidatesDone: 0,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-compare",
      status: "running",
      candidateMode: "compare",
      gatedWorkflow: undefined,
      summaryVersionId: null,
    });
    await expect.element(browserPage.getByRole("heading", { name: "Generating your report", exact: true })).toBeVisible();
    await expect.element(reportText).toBeVisible();
    await expect.element(reportActions(Component)).toBeVisible();

    // The existing Seed-drafting suppression witness still holds.
    __setQueryData("generations:getGeneration", {
      _id: "generation-seed-host",
      status: "running",
      currentStep: "Drafting from the signed-off Summary",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-seed-host",
      status: "running",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "drafting",
      seedStageVersion: 4,
      summaryVersionId: "summary-frozen",
      seedCanEdit: true,
    });
    await expect.element(seedDraftingHeading(Component)).toBeVisible();
    await expect.poll(() => document.body.textContent).not.toContain("Existing report stays visible.");
    expect(reportActions(Component).elements()).toHaveLength(0);
  }

  it("keeps an existing report and its actions visible through single and compare generations in the current host", async () => {
    await assertReportPreservedForOtherModes(CurrentProjectPage);
  });

  it("keeps an existing report and its actions visible through single and compare generations in the preview host", async () => {
    await assertReportPreservedForOtherModes(PreviewProjectPage);
  });

  const existingReport = (text: string) => ({
    _id: "report-seed-host",
    projectId: "project-seed-host",
    generationId: "generation-older",
    content: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }),
    version: 1,
    revisionNumber: 1,
    createdAt: 1,
    updatedAt: 1,
  });

  const generationMatrix = [
    { mode: "single", status: "reserved", heading: "Preparing report generation" },
    { mode: "single", status: "running", heading: "Generating your report" },
    { mode: "compare", status: "reserved", heading: "Preparing report generation" },
    { mode: "compare", status: "running", heading: "Generating your report" },
  ] as const;

  async function assertReportPreservedAcrossMatrix(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    // A10: each single/compare reservation and run independently keeps the
    // existing report and its actions; only Seed phases suppress them.
    for (const { mode, status, heading } of generationMatrix) {
      document.body.innerHTML = "";
      __resetConvexStub();
      seedHostQueries();
      __setQueryData("reports:getLatestReport", existingReport(`Existing report through ${mode} ${status}.`));
      __setQueryData("generations:getGenerationSeedView", null);
      __setQueryData("generations:getGeneration", {
        _id: `generation-${mode}-${status}`,
        status,
        currentStep: status === "reserved" ? "Reserving" : "Drafting",
        startedAt: Date.now(),
        estimatedMs: 60_000,
        totalCandidates: mode === "compare" ? 2 : 1,
        candidatesDone: 0,
      });
      __setQueryData("generations:getLatestGeneration", {
        _id: `generation-${mode}-${status}`,
        status,
        candidateMode: mode,
        gatedWorkflow: undefined,
        summaryVersionId: null,
      });
      const mounted = await render(Component, {});
      await expect.element(browserPage.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect.element(browserPage.getByText(`Existing report through ${mode} ${status}.`, { exact: true })).toBeVisible();
      await expect.element(reportActions(Component)).toBeVisible();
      expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
      expect(cancelGeneration(Component).elements()).toHaveLength(0);
      mounted.unmount();
    }
  }

  it("keeps an existing report through reserved and running single and compare generations in the current host", async () => {
    await assertReportPreservedAcrossMatrix(CurrentProjectPage);
  });

  it("keeps an existing report through reserved and running single and compare generations in the preview host", async () => {
    await assertReportPreservedAcrossMatrix(PreviewProjectPage);
  });

  async function assertLegacyStepperWithReport(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    // A10: a legacy section workflow with an existing report keeps its
    // pre-existing behaviour: the stepper owns the page, the report and its
    // actions wait, and the legacy cancel action stays.
    __setQueryData("reports:getLatestReport", existingReport("Existing report behind the legacy stepper."));
    __setQueryData("generations:getGenerationSeedView", null);
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-legacy",
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "sections",
    });
    __setQueryData("generations:getIterativeState", {
      sectionRuns: [],
      currentStep: "Awaiting section review",
      progressLog: [],
      ghost: null,
    });
    const mounted = await render(Component, {});
    await expect.element(browserPage.getByRole("heading", { name: "Section-by-section draft", exact: true })).toBeVisible();
    await expect.element(cancelGeneration(Component)).toBeVisible();
    expect(document.body.textContent).not.toContain("Existing report behind the legacy stepper.");
    expect(reportActions(Component).elements()).toHaveLength(0);
    expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
    expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    mounted.unmount();
  }

  it("keeps the legacy section stepper's existing report behaviour in the current host", async () => {
    await assertLegacyStepperWithReport(CurrentProjectPage);
  });

  it("keeps the legacy section stepper's existing report behaviour in the preview host", async () => {
    await assertLegacyStepperWithReport(PreviewProjectPage);
  });

  async function assertLegacyStepperOwnsSummaryUrl(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    // A10: a report-owned frozen Summary URL never renders beside an active
    // legacy stepper; it resolves normally once the stepper is gone.
    __setPageUrl("/project/project-seed-host?view=summary");
    const browserUrl = new URL(window.location.href);
    browserUrl.searchParams.set("view", "summary");
    window.history.replaceState({}, "", browserUrl);
    __setQueryData("reports:getLatestReport", {
      ...existingReport("Completed Seed report."),
      generationId: "generation-report-owner",
    });
    __setQueryData("generations:getGenerationSeedView", {
      _id: "generation-report-owner",
      gatedWorkflow: "seeds",
      seedPhase: "completed",
      summaryVersionId: "summary-report-owner",
      seedCanEdit: true,
    });
    __setQueryData("seeds:getSummary", frozenSummary("generation-report-owner", "summary-report-owner", ["Frozen report-owned Summary item."]));
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-legacy",
      status: "awaiting_input",
      candidateMode: "iterative",
      gatedWorkflow: "sections",
    });
    __setQueryData("generations:getIterativeState", {
      sectionRuns: [],
      currentStep: "Awaiting section review",
      progressLog: [],
      ghost: null,
    });
    const mounted = await render(Component, {});
    await expect.element(browserPage.getByRole("heading", { name: "Section-by-section draft", exact: true })).toBeVisible();
    expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Frozen report-owned Summary item.");
    expect(document.body.textContent).not.toContain("Completed Seed report.");
    await expect.element(cancelGeneration(Component)).toBeVisible();
    expect(reportActions(Component).elements()).toHaveLength(0);
    expect(browserPage.getByRole("button", { name: "Signed-off Summary", exact: true }).elements()).toHaveLength(0);
    expect(__activeQueryArgs("seeds:getSummary")).toEqual([]);

    // The legacy run ends: the same URL now opens the frozen Summary alone.
    __setQueryData("generations:getLatestGeneration", {
      _id: "generation-legacy",
      status: "completed",
      candidateMode: "iterative",
      gatedWorkflow: "sections",
    });
    await expect.element(browserPage.getByText("Frozen report-owned Summary item.", { exact: true })).toBeVisible();
    expect(browserPage.getByRole("heading", { name: "Section-by-section draft", exact: true }).elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Completed Seed report.");
    await browserPage.getByRole("button", { name: "Back to report", exact: true }).click();
    await expect.element(browserPage.getByText("Completed Seed report.", { exact: true })).toBeVisible();
    expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    mounted.unmount();
  }

  it("never renders a report-owned frozen Summary URL beside the active legacy stepper in the current host", async () => {
    await assertLegacyStepperOwnsSummaryUrl(CurrentProjectPage);
  });

  it("never renders a report-owned frozen Summary URL beside the active legacy stepper in the preview host", async () => {
    await assertLegacyStepperOwnsSummaryUrl(PreviewProjectPage);
  });

  async function assertSignOffFocus(
    Component: typeof CurrentProjectPage | typeof PreviewProjectPage,
    ordering: "subscription-first" | "command-first",
    progress: "loaded" | "pending" = "loaded"
  ) {
    // A7: an accepted sign-off replaces Summary Review with Seed drafting;
    // focus lands on the generation-progress heading whether the generation
    // subscription changes before or after the sign-off command resolves.
    // With the exact generation still loading (R5-15), focus first lands on
    // the progress region and moves to the heading once it renders. In the
    // preview host that heading is the writing view's draft title, and
    // "loading" is its draft-progress read.
    const exactGeneration = {
      _id: "generation-seed-host",
      status: "running",
      currentStep: "Drafting from the signed-off Summary",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    };
    if (progress === "loaded") __setQueryData("generations:getGeneration", exactGeneration);
    // The preview host's writing view reads the draft progress instead.
    else __setQueryData("generations:getSeedDraftProgress", undefined);
    let accept: ((value: unknown) => void) | undefined;
    if (ordering === "subscription-first") {
      __setMutationResult("generations:signOffSeedStage", new Promise((resolve) => { accept = resolve; }));
    } else {
      __setMutationResult("generations:signOffSeedStage", null);
    }
    const mounted = await render(Component, {});
    await browserPage.getByRole("button", { name: "Review summary", exact: true }).click();
    // By keyboard: the bar's primary opens the confirm, whose primary starts it.
    (summarySignOffButton().element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(browserPage.getByRole("dialog")).toBeVisible();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([]);
    (signOffConfirmButton().element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([{
      generationId: "generation-seed-host",
      expectedSeedStageVersion: 4,
    }]);
    const drafting = {
      _id: "generation-seed-host",
      status: "running",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      seedPhase: "drafting",
      seedStageVersion: 4,
      summaryVersionId: "summary-frozen",
      seedCanEdit: true,
    };
    if (ordering === "command-first") {
      // The accepted command closed the review first: the recreated workspace
      // trigger takes focus until drafting replaces it.
      await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();
      await expect.poll(() => document.activeElement?.id).toBe("seed-review-summary-trigger");
    }
    __setQueryData("generations:getLatestGeneration", drafting);
    if (progress === "pending") {
      // The exact generation has not arrived, so its heading does not exist:
      // focus holds on the named progress region instead of being lost.
      await expect.poll(() => document.activeElement?.id).toBe("generation-progress");
      const region = document.activeElement as HTMLElement;
      expect(region.getAttribute("role")).toBe("region");
      expect(region.getAttribute("aria-label")).toBe("Generation progress");
      expect(document.getElementById("generation-progress-heading")).toBeNull();
      expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
      expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
      __setQueryData("generations:getGeneration", exactGeneration);
      __setQueryData("generations:getSeedDraftProgress", seedDraftProgress());
    }
    await expect.element(seedDraftingHeading(Component)).toBeVisible();
    await expect.poll(() => document.activeElement?.id).toBe("generation-progress-heading");
    expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
    if (ordering === "subscription-first") {
      accept?.(null);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.activeElement?.id).toBe("generation-progress-heading");
    }
    expect(__navigationCalls.at(-1)).toEqual({ kind: "pushState", url: "/project/project-seed-host" });
    mounted.unmount();
  }

  it("moves focus to the generation progress when the subscription changes before the sign-off resolves in the current host", async () => {
    await assertSignOffFocus(CurrentProjectPage, "subscription-first");
  });

  it("moves focus to the generation progress when the subscription changes before the sign-off resolves in the preview host", async () => {
    await assertSignOffFocus(PreviewProjectPage, "subscription-first");
  });

  it("moves focus to the generation progress when the sign-off resolves before the subscription changes in the current host", async () => {
    await assertSignOffFocus(CurrentProjectPage, "command-first");
  });

  it("moves focus to the generation progress when the sign-off resolves before the subscription changes in the preview host", async () => {
    await assertSignOffFocus(PreviewProjectPage, "command-first");
  });

  it("focuses the progress region, then its heading, while the exact generation loads after a subscription-first sign-off in the current host", async () => {
    await assertSignOffFocus(CurrentProjectPage, "subscription-first", "pending");
  });

  it("focuses the progress region, then its heading, while the exact generation loads after a subscription-first sign-off in the preview host", async () => {
    await assertSignOffFocus(PreviewProjectPage, "subscription-first", "pending");
  });

  it("focuses the progress region, then its heading, while the exact generation loads after a command-first sign-off in the current host", async () => {
    await assertSignOffFocus(CurrentProjectPage, "command-first", "pending");
  });

  it("focuses the progress region, then its heading, while the exact generation loads after a command-first sign-off in the preview host", async () => {
    await assertSignOffFocus(PreviewProjectPage, "command-first", "pending");
  });

  const replacementUser = {
    _id: "writer-2",
    role: "writer",
    firstName: "Rae",
    lastName: "Writer",
    email: "rae@example.test",
  };

  async function assertDeferredFocusOwnership(
    Component: typeof CurrentProjectPage | typeof PreviewProjectPage,
    transition: "summary-return" | "sign-off-drafting",
    interruption: "host-destroyed" | "user-replaced" | "generation-replaced"
  ) {
    // A5/A7 (R5-04): a deferred focus move belongs to the host lifetime,
    // project, user, generation and transition that scheduled it. The
    // interruption lands between scheduling and the callback: the transition
    // is triggered synchronously, which queues the host's flush microtask, and
    // the interruption is queued right behind it, so it runs after the
    // effect scheduled the move and before the move's post-render callback.
    // The replacement page carries an element the obsolete callback would
    // find by its shared id; it must not receive focus.
    __setQueryData("generations:getGeneration", {
      _id: "generation-seed-host",
      status: "running",
      currentStep: "Drafting from the signed-off Summary",
      startedAt: Date.now(),
      estimatedMs: 60_000,
      totalCandidates: 1,
      candidatesDone: 0,
    });
    __setMutationResult("generations:signOffSeedStage", null);
    const mounted = await render(Component, {});
    await browserPage.getByRole("button", { name: "Review summary", exact: true }).click();
    await expect.poll(() => document.activeElement?.id).toBe("summary-review-title");

    let trigger: () => void;
    if (transition === "summary-return") {
      const back = browserPage.getByRole("button", { name: "Back to plan", exact: true }).element() as HTMLElement;
      trigger = () => back.click();
    } else {
      // The accepted command closes the review first (its return focus is
      // the ordinary, legitimate move); drafting then schedules its own.
      await confirmSummarySignOff();
      await expect.poll(() => document.activeElement?.id).toBe("seed-review-summary-trigger");
      trigger = () => __setQueryData("generations:getLatestGeneration", {
        _id: "generation-seed-host",
        status: "running",
        candidateMode: "iterative",
        gatedWorkflow: "seeds",
        seedPhase: "drafting",
        seedStageVersion: 4,
        summaryVersionId: "summary-frozen",
        seedCanEdit: true,
      });
    }

    let replacement: ReturnType<typeof render> | undefined;
    trigger();
    queueMicrotask(() => {
      if (interruption === "host-destroyed") {
        void mounted.unmount();
        replacement = render(Component, {});
      } else if (interruption === "user-replaced") {
        __setQueryData("users:getCurrentUser", replacementUser);
      } else {
        __setQueryData("generations:getLatestGeneration", transition === "summary-return"
          ? {
              _id: "generation-seed-host-next",
              status: "awaiting_input",
              candidateMode: "iterative",
              gatedWorkflow: "seeds",
              seedPhase: "seeding",
              seedStageVersion: 1,
              summaryVersionId: null,
              briefVersionId: "brief-seed-host-next",
              seedCanEdit: true,
            }
          : {
              _id: "generation-seed-host-next",
              status: "running",
              candidateMode: "iterative",
              gatedWorkflow: "seeds",
              seedPhase: "drafting",
              seedStageVersion: 1,
              summaryVersionId: "summary-frozen-next",
              seedCanEdit: true,
            });
      }
    });
    if (interruption === "host-destroyed") {
      await expect.poll(() => replacement).toBeDefined();
      await replacement;
    }

    // The replacement page renders the element the obsolete move would target.
    const target = transition === "summary-return" ? "seed-review-summary-trigger" : "generation-progress-heading";
    await expect.poll(() => document.getElementById(target)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.activeElement?.id).not.toBe(target);
    expect(document.activeElement?.id).not.toBe("generation-progress");
    expect(document.activeElement).toBe(document.body);
    expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    if (interruption === "host-destroyed") (await replacement!).unmount();
    else mounted.unmount();
  }

  const interruptions = {
    "host-destroyed": "the host is destroyed",
    "user-replaced": "the user is replaced",
    "generation-replaced": "the generation is replaced",
  } as const;
  for (const [label, Component] of [["current", CurrentProjectPage], ["preview", PreviewProjectPage]] as const) {
    for (const [interruption, phrase] of Object.entries(interruptions) as Array<[keyof typeof interruptions, string]>) {
      it(`never lets an obsolete Summary-return focus move reach a replacement page when ${phrase} before its callback in the ${label} host`, async () => {
        await assertDeferredFocusOwnership(Component, "summary-return", interruption);
      });

      it(`never lets an obsolete sign-off drafting focus move reach a replacement page when ${phrase} before its callback in the ${label} host`, async () => {
        await assertDeferredFocusOwnership(Component, "sign-off-drafting", interruption);
      });
    }
  }

  function seedTwoItemDecisions() {
    const secondSeed = {
      seedId: "seed-host-2",
      batchId: "batch-host-1",
      roleId: "company_context",
      bullets: ["Second workspace wording."],
      originalBullets: ["Second workspace wording."],
      tags: ["technical"],
      support: "source_supported",
      originalSupport: "source_supported",
      selected: true,
      edited: false,
      revisionOfSeedId: null,
      feedbackRequestId: null,
      uncertaintySeedId: null,
      experimentSeedIds: [],
      provenance: [],
      provenanceTruncated: false,
      outdated: null,
    };
    __setQueryData("seeds:getSubsection", {
      generationId: "generation-seed-host",
      roleId: "company_context",
      state: "in_progress",
      stale: false,
      staleReason: null,
      items: [{ ...secondSeed, seedId: "seed-host-1", bullets: ["Server workspace wording."], originalBullets: ["Server workspace wording."] }, secondSeed],
      feedbackGroups: [],
      shownBatchId: null,
      pendingBatchId: null,
      approvalChallenge: null,
      seedStageVersion: 4,
      truncated: false,
      budget,
    });
    const summaryItem = (seedId: string, roleId: string, bullet: string) => ({
      kind: "selection",
      seedId,
      roleId,
      subsectionKind: "standard",
      bullets: [bullet],
      support: "source_supported",
      tags: ["technical"],
      uncertaintySeedId: null,
      experimentSeedIds: [], edited: false, provenance: [],
    });
    __setQueryData("seeds:getSummary", {
      page: [
        summaryItem("seed-host-1", "company_context", "Server workspace wording."),
        summaryItem("seed-host-2", "goal_problem", "Second Summary wording."),
      ],
      skippedRoleIds: [],
      isDone: true,
      continueCursor: "done",
      partial: false,
      frozen: false,
      generationId: "generation-seed-host",
      summaryVersionId: null,
      seedStageVersion: 4,
      settings: frozenSettings,
      budget,
    });
  }

  async function assertLateSaveIsolation(Component: typeof CurrentProjectPage | typeof PreviewProjectPage) {
    // A2: a save that completes after its surface was destroyed and recreated
    // clears only its own unchanged snapshot; newer wording and independent
    // drafts typed since navigation stay, through both Seed surfaces.
    seedTwoItemDecisions();
    let finishEdit: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:edit", new Promise((resolve) => { finishEdit = resolve; }));
    const mounted = await render(Component, {});
    await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();

    // Workspace: a pending edit save, then navigate to the Summary.
    await browserPage.getByRole("button", { name: "Edit", exact: true }).first().click();
    await browserPage.getByRole("textbox", { name: "Bullet 1" }).fill("Submitted workspace wording.");
    await browserPage.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.element(browserPage.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await browserPage.getByRole("button", { name: "Review summary", exact: true }).click();
    await expect.element(browserPage.getByRole("heading", { name: "Summary review", exact: true })).toBeVisible();

    // Summary: a pending edit save, then back to the workspace.
    await browserPage.getByRole("button", { name: "Edit", exact: true }).first().click();
    await browserPage.getByRole("textbox", { name: "Bullet 1" }).fill("Submitted Summary wording.");
    await browserPage.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.element(browserPage.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await browserPage.getByRole("button", { name: "Back to plan", exact: true }).click();
    await expect.element(browserPage.getByLabelText("Seed workspace")).toBeVisible();

    // The recreated workspace: newer wording for the submitted Seed plus an
    // independent feedback draft on the other Seed.
    const bullet = browserPage.getByRole("textbox", { name: "Bullet 1" });
    await expect.element(bullet).toHaveValue("Submitted workspace wording.");
    await bullet.fill("Submitted workspace wording. Newer.");
    await browserPage.getByRole("button", { name: "Give feedback", exact: true }).last().click();
    await browserPage.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    await browserPage.getByRole("textbox", { name: "Tell it what to change" }).fill("Independent workspace instruction.");

    // The recreated Summary: newer wording plus an independent item draft.
    await browserPage.getByRole("button", { name: "Review summary", exact: true }).click();
    await browserPage.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.element(browserPage.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Submitted Summary wording.");
    await browserPage.getByRole("textbox", { name: "Bullet 1" }).fill("Submitted Summary wording. Newer.");
    await browserPage.getByRole("button", { name: "Edit", exact: true }).click();
    await browserPage.getByRole("textbox", { name: "Bullet 1" }).fill("Independent Summary wording.");

    // Both old submissions resolve now, long after their mounts were destroyed.
    finishEdit?.(undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(browserPage.getByRole("alert").elements()).toHaveLength(0);

    // Recreate both surfaces again: everything typed since remains.
    await browserPage.getByRole("button", { name: "Back to plan", exact: true }).click();
    await expect.element(browserPage.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Submitted workspace wording. Newer.");
    await expect.element(browserPage.getByRole("textbox", { name: "Tell it what to change" })).toHaveValue("Independent workspace instruction.");
    await browserPage.getByRole("button", { name: "Review summary", exact: true }).click();
    await browserPage.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.element(browserPage.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Submitted Summary wording. Newer.");
    await browserPage.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(browserPage.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Independent Summary wording.");
    expect(__mutationCalls("seeds:edit")).toHaveLength(2);
    mounted.unmount();
  }

  it("keeps newer wording and independent drafts when earlier saves resolve after navigation in the current host", async () => {
    await assertLateSaveIsolation(CurrentProjectPage);
  });

  it("keeps newer wording and independent drafts when earlier saves resolve after navigation in the preview host", async () => {
    await assertLateSaveIsolation(PreviewProjectPage);
  });

  async function assertLateSignOffScope(
    Component: typeof CurrentProjectPage | typeof PreviewProjectPage,
    replacement: "host-destroyed" | "generation-replaced" | "user-replaced"
  ) {
    // A5/A7: a sign-off that completes after this host was destroyed, or after
    // the generation or user it was submitted under was replaced, changes no
    // URL, Summary state or focus. (The same generation entering drafting
    // before the command resolves still completes: see the ordering cases.)
    let accept: ((value: unknown) => void) | undefined;
    __setMutationResult("generations:signOffSeedStage", new Promise((resolve) => { accept = resolve; }));
    const mounted = await render(Component, {});
    await browserPage.getByRole("button", { name: "Review summary", exact: true }).click();
    await confirmSummarySignOff();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([{
      generationId: "generation-seed-host",
      expectedSeedStageVersion: 4,
    }]);

    if (replacement === "host-destroyed") {
      mounted.unmount();
      expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
    } else if (replacement === "generation-replaced") {
      __setQueryData("generations:getLatestGeneration", {
        _id: "generation-seed-host-next",
        status: "awaiting_input",
        candidateMode: "iterative",
        gatedWorkflow: "seeds",
        seedPhase: "seeding",
        seedStageVersion: 1,
        summaryVersionId: null,
        briefVersionId: "brief-seed-host-next",
        seedCanEdit: true,
      });
      await expect.element(browserPage.getByRole("heading", { name: "Summary review", exact: true })).toBeVisible();
    } else {
      __setQueryData("users:getCurrentUser", {
        _id: "writer-2",
        role: "writer",
        firstName: "Rae",
        lastName: "Writer",
        email: "rae@example.test",
      });
      await expect.element(browserPage.getByRole("heading", { name: "Summary review", exact: true })).toBeVisible();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const navigationCount = __navigationCalls.length;
    const focused = document.activeElement;
    const url = window.location.href;

    accept?.(null);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(__navigationCalls).toHaveLength(navigationCount);
    expect(window.location.href).toBe(url);
    expect(document.activeElement).toBe(focused);
    if (replacement === "host-destroyed") {
      expect(browserPage.getByRole("heading", { name: "Summary review", exact: true }).elements()).toHaveLength(0);
      expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
    } else {
      // The replacement owner's Summary stays open; no Seed drafting focus move.
      await expect.element(browserPage.getByRole("heading", { name: "Summary review", exact: true })).toBeVisible();
      expect(browserPage.getByLabelText("Seed workspace").elements()).toHaveLength(0);
      expect(seedDraftingHeading(Component).elements()).toHaveLength(0);
      mounted.unmount();
    }
  }

  it("keeps a late sign-off from changing the URL, Summary or focus after the current host is destroyed", async () => {
    await assertLateSignOffScope(CurrentProjectPage, "host-destroyed");
  });

  it("keeps a late sign-off from changing the URL, Summary or focus after the preview host is destroyed", async () => {
    await assertLateSignOffScope(PreviewProjectPage, "host-destroyed");
  });

  it("keeps a late sign-off from changing the URL, Summary or focus after the generation is replaced in the current host", async () => {
    await assertLateSignOffScope(CurrentProjectPage, "generation-replaced");
  });

  it("keeps a late sign-off from changing the URL, Summary or focus after the generation is replaced in the preview host", async () => {
    await assertLateSignOffScope(PreviewProjectPage, "generation-replaced");
  });

  it("keeps a late sign-off from changing the URL, Summary or focus after the user is replaced in the current host", async () => {
    await assertLateSignOffScope(CurrentProjectPage, "user-replaced");
  });

  it("keeps a late sign-off from changing the URL, Summary or focus after the user is replaced in the preview host", async () => {
    await assertLateSignOffScope(PreviewProjectPage, "user-replaced");
  });
});
