/**
 * Review g2 B8 and B9 on the real page during the seed stage, narrow screens:
 * a Details toggle is always reachable, and keyboard focus follows the toggle
 * between the Outline/Seeds switch and the panel toolbar. (Fixture shared in
 * shape with seeds/SeedPaneSwitchDetails.component.test.ts.)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
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

describe("Seed stage Details toggle host (review g2)", () => {
  it("keeps the toolbar Details toggle on the Sources tab", async () => {
    await page.viewport(390, 844);
    await render(PreviewProjectPage);
    await expect.poll(() => switchToggle()).not.toBeNull();
    (document.querySelector('[data-panel-tab="sources"]') as HTMLElement).click();
    await expect.poll(() => toolbarToggle()).not.toBeNull();
  });

  it("keeps the toolbar Details toggle while the Outline loads", async () => {
    __setQueryData("seeds:getOutline", undefined);
    await page.viewport(390, 844);
    await render(PreviewProjectPage);
    await expect.poll(() => toolbarToggle()).not.toBeNull();
    expect(switchToggle()).toBeNull();
  });

  it("moves keyboard focus with the toggle between the switch and the toolbar", async () => {
    await page.viewport(390, 844);
    await render(PreviewProjectPage);
    await expect.poll(() => switchToggle()).not.toBeNull();
    switchToggle()!.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.activeElement).toBe(toolbarToggle());
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => switchToggle()).not.toBeNull();
    await expect.poll(() => document.activeElement).toBe(switchToggle());
  });
});
