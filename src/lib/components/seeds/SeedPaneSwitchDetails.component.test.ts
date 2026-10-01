/**
 * Board 3.6 on the real page: during the seed stage a narrow screen shows the
 * page's Details (i) toggle beside the Outline/Seeds switch, and the panel
 * toolbar drops its own until the panel covers the screen. The toolbar's tab
 * row stays, because tab navigation has no other way in on a phone.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetPage, __setPageParams, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import PreviewProjectPage from "$lib/components/project/PreviewProjectPage.svelte";

const budget = { limit: 1_000_000, estimatedBytesRead: 0, reservedDocumentBytes: 0, rangesRead: 0, rangeLimit: 100, exhausted: false };
const generationId = "generation-seed-host";

let n = 0;
function seed(seedId: string, tags: string[], bullets: string[], quotes: string[]) {
  return {
    seedId, batchId: "batch-shown", roleId: "company_context", bullets, originalBullets: bullets, tags,
    support: "source_supported", originalSupport: "source_supported", selected: false, edited: false,
    revisionOfSeedId: null, feedbackRequestId: null, uncertaintySeedId: null, experimentSeedIds: [],
    provenance: quotes.map((exactExcerpt) => ({
      _id: `prov-${++n}`, _creationTime: 1, projectId: "project-seed-host", generationId, seedId,
      sourceId: "source-1", sourceContentHash: "hash", exactExcerpt, startOffset: 0, endOffset: exactExcerpt.length, speaker: "Priya", line: 18,
    })),
    provenanceTruncated: false, outdated: null,
  };
}

function seedStageQueries() {
  __setQueryData("projects:getProject", {
    _id: "project-seed-host", title: "Adaptive cold storage controls", sredTitle: "Adaptive control", clientName: "Acme Labs",
    writer: "Wren Writer", interviewer: "", interviewees: [], tagIds: [], mode: "generate", status: "generating",
    workflowStage: "drafting", industry: "manufacturing", scienceCode: "1.02.01", fiscalYearEnd: Date.UTC(2025, 11, 31),
    createdBy: "writer-1", ownerId: "writer-1", createdAt: 1, updatedAt: 1, shareToken: "t", activeGenerationId: generationId,
  });
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setQueryData("users:getCurrentUser", { _id: "writer-1", role: "writer", firstName: "Wren", lastName: "Writer", email: "w@example.test" });
  __setQueryData("reports:getLatestReport", null);
  __setQueryData("generations:getLatestGeneration", {
    _id: generationId, status: "awaiting_input", candidateMode: "iterative", gatedWorkflow: "seeds", seedPhase: "seeding",
    seedStageVersion: 4, seedStageError: undefined, summaryVersionId: null, briefVersionId: "brief", seedCanEdit: true,
    candidatesDone: 0, candidatesFailed: 0, totalCandidates: 1,
  });
  __setQueryData("pdReviews:getLatestPdReview", null);
  __setQueryData("reportViews:getViewSummary", null);
  __setQueryData("tags:listTags", []);
  __setQueryData("transcripts:listTranscripts", []);
  for (const name of ["documents:listDocuments", "comments:listComments", "pdReviews:listPdReviewEvents", "chatV2:listThreads",
    "chatV2:listProposals", "research:listSessions", "uploadAttempts:listUploadAttempts", "snapshots:listSnapshots"]) __setQueryData(name, []);
  __setQueryData("seeds:getOutline", {
    generationId,
    rows: PD_SUBSECTIONS.map((definition) => ({
      ...definition, state: definition.roleId === "company_context" ? "in_progress" : "untouched", stale: false, staleReason: null,
      outdated: false, selectedCount: 0, selectedWordCount: 0, countsComplete: true, previewLines: [], pendingBatchId: null, shownBatchId: null,
    })),
    readiness: { ready: false, complete: true, blockingRoleIds: ["company_context"] }, usage: { requests: 1, notice: false },
    seedStageVersion: 4, truncated: false, budget, canEdit: true, workflow: "seeds",
    frozen: { briefVersionId: "brief", summaryVersionId: null, lengthTarget: "standard", modelId: "claude-test", writerProfile: null },
  });
  __setQueryData("seeds:getSourceAttribution", { generationId, sources: [{ sourceId: "source-1", label: "Priya interview", kind: "transcript" }], complete: true });
  __setQueryData("seeds:getSubsection", {
    generationId, roleId: "company_context", state: "in_progress", stale: false, staleReason: null,
    items: [
      seed("s1", ["conservative", "high_level"], ["Mid-size cold-chain logistics operator running four refrigerated warehouses in Ontario.", "Controls team of four maintains legacy PLC setpoint logic across all sites."], ["four refrigerated warehouses"]),
      seed("s2", ["technical", "detailed"], ["Sites run mixed compressor generations with telemetry at one-minute and fifteen-minute granularity."], ["mixed compressor generations", "one-minute and fifteen-minute"]),
      seed("s3", ["aggressive"], ["Position the company as building an adaptive control platform, not only operating warehouses."], []),
    ],
    feedbackGroups: [], shownBatchId: "batch-shown", pendingBatchId: null, approvalChallenge: null, seedStageVersion: 4, truncated: false, budget,
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetAuthState();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  __setPageParams({ id: "project-seed-host" });
  __setPageUrl("/project/project-seed-host");
  seedStageQueries();
});

const switchToggle = () => document.querySelector<HTMLElement>("[data-seed-pane-switch-end] [data-seed-details-toggle]");
const toolbarToggle = () => document.querySelector<HTMLElement>('[data-panel-toolbar] [data-panel-toggle="details"]');

describe("Seed stage Details toggle on a phone (board 3.6)", () => {
  it("sits beside the Outline/Seeds switch, opens Details, and the toolbar toggle returns while the panel covers the screen", async () => {
    await page.viewport(390, 844);
    await render(PreviewProjectPage, {});
    await expect.element(page.getByLabelText("Seed workspace")).toBeVisible();
    await expect.poll(() => switchToggle()).not.toBeNull();
    const toggle = switchToggle()!;
    expect(toggle.getAttribute("aria-label")).toBe("Details");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    // One Details toggle on screen: the toolbar drops its own.
    expect(toolbarToggle()).toBeNull();
    // The tab row stays: Plan, Summary and Sources have no other way in on a phone.
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('nav[aria-label="Project views"] [data-panel-tab]')).map((tab) => tab.dataset.panelTab);
    expect(tabs).toEqual(expect.arrayContaining(["plan", "summary", "sources"]));
    const toggleRect = toggle.getBoundingClientRect();
    const switchRect = document.querySelector<HTMLElement>('[data-seed-pane-switch] [role="group"]')!.getBoundingClientRect();
    expect(Math.round(toggleRect.width)).toBe(40);
    expect(Math.round(toggleRect.left - switchRect.right)).toBe(10);

    await page.elementLocator(toggle).click();
    const close = page.getByRole("button", { name: "Close details", exact: true });
    await expect.element(close).toBeVisible();
    // The panel covers the narrow screen; its toolbar toggle is back, pressed.
    await expect.poll(() => toolbarToggle()?.getAttribute("aria-pressed")).toBe("true");
    await page.elementLocator(toolbarToggle()!).click();
    await expect.poll(() => close.elements().length).toBe(0);
    await expect.element(page.getByLabelText("Seed workspace")).toBeVisible();
    await expect.poll(() => switchToggle()?.getAttribute("aria-pressed")).toBe("false");
    expect(toolbarToggle()).toBeNull();
  });

  it("keeps Details in the toolbar on a wide screen, where there is no pane switch", async () => {
    await page.viewport(1366, 900);
    await render(PreviewProjectPage, {});
    await expect.element(page.getByLabelText("Seed workspace")).toBeVisible();
    await expect.poll(() => toolbarToggle()).not.toBeNull();
    expect(switchToggle()).toBeNull();
    expect(document.querySelector("[data-seed-pane-switch]")).toBeNull();
  });
});
