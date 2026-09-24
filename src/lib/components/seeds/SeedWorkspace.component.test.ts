import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";
import {
  __activeQueryArgs,
  __clientQueryCalls,
  __mutationCalls,
  __queryArgsHistory,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
  __setQueryDataForArgs,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import { captureOwner } from "$lib/test/captureOwner";
import SeedWorkspace from "./SeedWorkspace.svelte";
import SeedSubsectionPane from "./SeedSubsectionPane.svelte";
import SeedCard from "./SeedCard.svelte";
import type { SeedCardData, SeedDraftUpdate, SeedLocalDraft, SeedSubsectionData } from "./types";

const generationId = "generation-seeds" as Id<"generations">;
const otherGenerationId = "generation-seeds-next" as Id<"generations">;
const projectId = "project-seeds" as Id<"projects">;
// Verification (R5-09): this invocation's captures land in a directory it
// reserved exclusively, never on a fixed path that a later run would overwrite.
const captures = captureOwner("seed-workspace");
// One browser record per unsaved Seed, under the owner's prefix (A2).
const draftPrefix = (generation: Id<"generations"> = generationId) => `seeds.draft:writer-1:${generation}:`;

const budget = {
  limit: 1_000_000,
  estimatedBytesRead: 0,
  reservedDocumentBytes: 0,
  rangesRead: 0,
  rangeLimit: 100,
  exhausted: false,
};

function outline(canEdit = true) {
  return {
    generationId,
    rows: PD_SUBSECTIONS.map((definition) => ({
      ...definition,
      state: "in_progress",
      stale: false,
      staleReason: null,
      outdated: false,
      selectedCount: 1,
      selectedWordCount: 6,
      countsComplete: true,
      previewLines: definition.order === 1 ? ["Control loop evidence"] : [],
      pendingBatchId: null,
      shownBatchId: `batch-${definition.order}`,
    })),
    readiness: { ready: false, complete: true, blockingRoleIds: ["goal_problem"] },
    usage: { requests: 41, notice: true },
    seedStageVersion: 7,
    truncated: false,
    budget,
    canEdit,
    workflow: "seeds",
    frozen: {
      briefVersionId: "brief-1",
      summaryVersionId: null,
      lengthTarget: "standard",
      modelId: "claude-test",
      writerProfile: { state: "selected", source: "upload", fileName: "voice.docx" },
    },
  };
}

function seed(overrides: Partial<SeedCardData> = {}): SeedCardData {
  return {
    seedId: "seed-1" as Id<"seeds">,
    batchId: "batch-1" as Id<"seedBatches">,
    roleId: "company_context" as const,
    bullets: ["The control loop stabilized output.", "Tests covered three load bands."],
    originalBullets: ["The control loop stabilized output.", "Tests covered three load bands."],
    tags: ["technical"],
    support: "source_supported" as const,
    originalSupport: "source_supported" as const,
    selected: true,
    edited: false,
    revisionOfSeedId: null,
    feedbackRequestId: null,
    uncertaintySeedId: null,
    experimentSeedIds: [],
    provenance: [{
      _id: "provenance-1" as Id<"seedProvenance">,
      _creationTime: 1,
      projectId,
      generationId,
      seedId: "seed-1" as Id<"seeds">,
      sourceId: "source-1" as Id<"generationSources">,
      sourceContentHash: "source-hash",
      exactExcerpt: "Measured output remained stable.",
      startOffset: 0,
      endOffset: 32,
    }],
    provenanceTruncated: false,
    outdated: null,
    ...overrides,
  };
}

function subsection(overrides: Partial<SeedSubsectionData> = {}): SeedSubsectionData {
  return {
    generationId,
    roleId: "company_context" as const,
    state: "in_progress" as const,
    stale: false,
    staleReason: null,
    items: [seed()],
    feedbackGroups: [],
    shownBatchId: "batch-1" as Id<"seedBatches">,
    pendingBatchId: null,
    approvalChallenge: {
      approvalChallenge: "challenge-exact",
      carriedSeedIds: ["seed-carried" as Id<"seeds">],
      exclusionEntryIds: ["exclusion-exact" as Id<"generationBriefEntries">],
      changedRoleIds: ["goal_problem"],
      shownBatchOutdated: true,
      exclusions: [{
        entryId: "exclusion-exact" as Id<"generationBriefEntries">,
        text: "Marketing work is excluded.",
        seedIds: ["seed-carried" as Id<"seeds">],
      }],
      contributionHashes: [{ roleId: "goal_problem", contributionHash: "hash-a" }],
    },
    seedStageVersion: 7,
    truncated: false,
    budget,
    ...overrides,
  };
}

function paneProps(data: SeedSubsectionData, overrides: Record<string, unknown> = {}) {
  return {
    generationId: data.generationId,
    title: "Company / Context",
    objective: "Describe the context.",
    kind: "standard" as const,
    data,
    canEdit: true,
    drafts: {},
    onDraftChange: vi.fn(),
    ...overrides,
  };
}

function historicalSeed(seedId: string, original: string, final: string, excerpt: string, sourceId = "source-history") {
  return {
    _id: seedId as Id<"seeds">,
    _creationTime: 1,
    projectId,
    generationId,
    batchId: `${seedId}-batch` as Id<"seedBatches">,
    roleId: "company_context" as const,
    order: 0,
    bullets: [original],
    finalBullets: [final],
    tags: ["technical"],
    support: "source_supported" as const,
    originalSupport: "source_supported" as const,
    selection: null,
    provenance: [{
      _id: `${seedId}-citation` as Id<"seedProvenance">,
      _creationTime: 1,
      projectId,
      generationId,
      seedId: seedId as Id<"seeds">,
      sourceId: sourceId as Id<"generationSources">,
      sourceContentHash: "history-hash",
      exactExcerpt: excerpt,
      startOffset: 0,
      endOffset: excerpt.length,
    }],
  };
}

/** Every stored draft of one owner, assembled from its per-item records. */
function storedDrafts(generation: Id<"generations"> = generationId): Record<string, SeedLocalDraft> {
  const prefix = draftPrefix(generation);
  const result: Record<string, SeedLocalDraft> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)!;
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = JSON.parse(localStorage.getItem(key)!);
  }
  return result;
}

/** Seeds stored drafts as the workspace persists them: one record per Seed. */
function storeDrafts(drafts: Record<string, SeedLocalDraft>, generation: Id<"generations"> = generationId) {
  for (const [seedId, draft] of Object.entries(drafts)) {
    localStorage.setItem(`${draftPrefix(generation)}${seedId}`, JSON.stringify(draft));
  }
}

function workspaceProps(overrides: Record<string, unknown> = {}) {
  return { generationId, projectId, userId: "writer-1", onReviewSummary: vi.fn(), ...overrides };
}

/** A lazily rejecting read: it fails only when awaited, so a seeded refusal
 * never surfaces as an unhandled rejection before the component asks for it. */
const rejecting = (error: unknown) => ({
  then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
    reject(error);
  },
});

const historyReview = (approvalChallenge: string) => ({
  approvalChallenge: {
    approvalChallenge,
    carriedSeedIds: [],
    exclusionEntryIds: [],
    changedRoleIds: [],
    shownBatchOutdated: false,
    exclusions: [],
    contributionHashes: [],
  },
  selectedCount: 1,
  seedStageVersion: 7,
});

beforeEach(async () => {
  document.body.innerHTML = "";
  localStorage.clear();
  __resetConvexStub();
  await page.viewport(1366, 900);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const persistenceNotice = () => document.querySelector<HTMLElement>('[data-workspace-persistence="unavailable"]');
const twoSeeds = () => [seed(), seed({ seedId: "seed-2" as Id<"seeds">, bullets: ["Second Seed wording."] })];
const citation = (index: number, sourceId: string) => ({
  _id: `provenance-many-${index}` as Id<"seedProvenance">,
  _creationTime: 1,
  projectId,
  generationId,
  seedId: "seed-1" as Id<"seeds">,
  sourceId: sourceId as Id<"generationSources">,
  sourceContentHash: "source-hash",
  exactExcerpt: `Excerpt ${index}.`,
  startOffset: 0,
  endOffset: 10,
});

describe("Seed workspace", () => {
  it("renders all thirteen roles, supports bounded keyboard resizing, and switches one pane on narrow screens", async () => {
    await page.viewport(1366, 900);
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({
      items: Array.from({ length: 12 }, (_, index) => seed({
        seedId: `seed-layout-${index}` as Id<"seeds">,
        bullets: [`Layout Seed ${index + 1} records a distinct supported technical observation.`],
      })),
    }));
    const { container } = await render(SeedWorkspace, workspaceProps());
    container.style.width = "1000px";
    container.style.height = "800px";
    const workspace = page.getByLabelText("Seed workspace");
    const workspaceElement = workspace.elements()[0];
    if (!(workspaceElement instanceof HTMLElement)) throw new Error("Seed workspace did not render");
    expect(Math.round(workspaceElement.getBoundingClientRect().width)).toBe(1000);
    expect(Math.round(workspaceElement.getBoundingClientRect().height)).toBe(800);

    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();
    expect(page.getByRole("navigation", { name: "PD subsections" }).getByRole("button").elements()).toHaveLength(13);
    await expect.element(page.getByText("41 seed requests", { exact: true })).toBeVisible();
    // The active Outline row is primary fill with white text, title included.
    const activeRow = container.querySelector<HTMLElement>('nav[aria-label="PD subsections"] button[aria-current="step"]')!;
    expect(getComputedStyle(activeRow.querySelector<HTMLElement>(".text-body")!).color).toBe("rgb(255, 255, 255)");

    // R3-12: the value is a horizontal width, adjusted with Left/Right, Home
    // and End inside the 24–55% bounds, and the control keeps focus.
    const splitter = page.getByRole("slider", { name: "Resize Seed outline" });
    await expect.element(splitter).toHaveAttribute("aria-orientation", "horizontal");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "32");
    await splitter.click();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "30");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "32");
    await userEvent.keyboard("{Home}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "24");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "24");
    expect(localStorage.getItem("seeds.splitRatio")).toBe("0.24");
    await userEvent.keyboard("{End}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "55");
    expect(localStorage.getItem("seeds.splitRatio")).toBe("0.55");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "55");
    expect(document.activeElement).toBe(splitter.element());
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "53");
    await userEvent.keyboard("{End}");

    await workspace.screenshot({
      path: await captures.path("seed-workspace-desktop-initial"),
    });
    const desktopScrollOwner = Array.from(container.querySelectorAll<HTMLElement>(".overflow-y-auto"))
      .find((element) => element.offsetParent !== null && element.scrollHeight > element.clientHeight)!;
    const actionFooter = container.querySelector<HTMLElement>("footer")!;
    const desktopDocumentScroll = window.scrollY;
    desktopScrollOwner.scrollTop = desktopScrollOwner.scrollHeight;
    await Promise.resolve();
    expect(window.scrollY).toBe(desktopDocumentScroll);
    expect(actionFooter.getBoundingClientRect().bottom).toBeLessThanOrEqual(workspaceElement.getBoundingClientRect().bottom + 1);
    await workspace.screenshot({
      path: await captures.path("seed-workspace-desktop-scrolled"),
    });
    desktopScrollOwner.scrollTop = 0;

    await page.viewport(390, 844);
    container.style.width = "390px";
    container.style.height = "844px";
    expect(Math.round(workspaceElement.getBoundingClientRect().width)).toBe(390);
    expect(Math.round(workspaceElement.getBoundingClientRect().height)).toBe(844);
    const outlineSwitch = page.getByRole("button", { name: "Outline", exact: true });
    const workSwitch = page.getByRole("button", { name: "Work", exact: true });
    await expect.element(workSwitch).toHaveAttribute("aria-pressed", "true");
    await outlineSwitch.click();
    await expect.element(outlineSwitch).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();
    expect(getComputedStyle(container.querySelector("nav")!).overflowY).toBe("auto");
    const outlinePane = container.querySelector<HTMLElement>('[aria-label="Seed outline"]')!.parentElement!;
    expect(Math.abs(outlinePane.getBoundingClientRect().width - container.getBoundingClientRect().width)).toBeLessThan(2);
    const splitterElement = container.querySelector('[role="slider"]');
    if (!(splitterElement instanceof HTMLElement)) throw new Error("Seed workspace splitter did not render");
    const workPane = splitterElement.nextElementSibling;
    if (!(workPane instanceof HTMLElement)) throw new Error("Seed work pane did not render");
    expect(getComputedStyle(workPane).display).toBe("none");
    await workspace.screenshot({
      path: await captures.path("seed-workspace-narrow-outline"),
    });
    await workSwitch.click();
    expect(getComputedStyle(outlinePane).display).toBe("none");
    expect(getComputedStyle(workPane).display).toBe("flex");
    const scrollOwner = Array.from(container.querySelectorAll<HTMLElement>(".overflow-y-auto"))
      .find((element) => element.offsetParent !== null && element.scrollHeight > element.clientHeight)!;
    expect(scrollOwner).toBeDefined();
    const documentScroll = window.scrollY;
    scrollOwner.scrollTop = scrollOwner.scrollHeight;
    await Promise.resolve();
    expect(window.scrollY).toBe(documentScroll);
    expect(actionFooter.getBoundingClientRect().bottom).toBeLessThanOrEqual(container.getBoundingClientRect().bottom + 1);
    await expect.element(workSwitch).toHaveAttribute("aria-pressed", "true");
    await workspace.screenshot({
      path: await captures.path("seed-workspace-narrow-work-scrolled"),
    });
  });

  it("sends exact version fences and approval acknowledgments, and keeps edit text after a conflict", async () => {
    const stale = new ConvexError({
      code: "STALE_REVISION",
      message: "Seed decisions changed; refresh and retry",
    });
    __setMutationError("seeds:edit", stale);
    const view = await render(SeedSubsectionPane, paneProps(subsection()));

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const firstBullet = page.getByRole("textbox", { name: "Bullet 1" });
    await firstBullet.fill("A locally preserved edit.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Seed decisions changed; refresh and retry");
    await expect.element(firstBullet).toHaveValue("A locally preserved edit.");
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-1",
      bullets: ["A locally preserved edit.", "Tests covered three load bands."],
      expectedSeedStageVersion: 7,
    }]);

    const approve = page.getByRole("button", { name: "Confirm and approve", exact: true });
    await expect.element(approve).toBeDisabled();
    expect(view.container.textContent).toContain("seed-carried");
    expect(view.container.textContent).toContain("goal_problem");
    expect(view.container.textContent).toContain("Marketing work is excluded.");
    await page.getByRole("checkbox", { name: /I acknowledge 1 carried/ }).click();
    await view.rerender(paneProps(subsection({
      approvalChallenge: {
        ...subsection().approvalChallenge!,
        approvalChallenge: "challenge-replaced",
        carriedSeedIds: ["seed-different" as Id<"seeds">],
      },
    })));
    await expect.element(approve).toBeDisabled();
    await page.getByRole("checkbox", { name: /I acknowledge 1 carried/ }).click();
    await approve.click();
    expect(__mutationCalls("seeds:approve")).toEqual([{
      generationId,
      roleId: "company_context",
      expectedSeedStageVersion: 7,
      approvalChallenge: "challenge-replaced",
      acknowledgedCarriedSeedIds: ["seed-different"],
      acknowledgedExclusionEntryIds: ["exclusion-exact"],
    }]);
  });

  it("restores a local draft after the card is destroyed and recreated, while read-only mode exposes no mutation controls", async () => {
    let savedDraft: SeedLocalDraft | undefined;
    const editableProps = {
      generationId: String(generationId),
      roleId: "company_context",
      seedStageVersion: 7,
      item: seed(),
      canEdit: true,
      onSelect: vi.fn(async () => true),
      onEdit: vi.fn(async () => false),
      onRestore: vi.fn(async () => true),
      onFeedback: vi.fn(async () => false),
      onDraftChange: (update: SeedDraftUpdate) => {
        savedDraft = update(savedDraft) ?? undefined;
      },
    };
    const first = await render(SeedCard, editableProps);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Draft survives navigation.");
    first.unmount();

    await render(SeedCard, { ...editableProps, draft: savedDraft });
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Draft survives navigation.");
    expect(savedDraft).toEqual({
      ownerGenerationId: generationId,
      ownerRoleId: "company_context",
      edit: {
        bulletOne: "Draft survives navigation.",
        bulletTwo: "Tests covered three load bands.",
        baseSeedStageVersion: 7,
      },
      feedback: null,
    });

    document.body.innerHTML = "";
    await render(SeedSubsectionPane, paneProps(subsection(), { canEdit: false }));
    for (const name of ["Edit", "Give feedback", "Regenerate", "Confirm and approve"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
  });

  it("opens the saved role and records the displayed Batch once", async () => {
    localStorage.setItem(`seeds.openRole:writer-1:${generationId}`, "hypothesis");
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ roleId: "hypothesis", shownBatchId: "batch-h" as Id<"seedBatches"> }));
    await render(SeedWorkspace, workspaceProps());

    await expect.poll(() => __activeQueryArgs("seeds:getSubsection")).toContainEqual({
      generationId,
      roleId: "hypothesis",
    });
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([{
      generationId,
      roleId: "hypothesis",
      batchId: "batch-h",
      expectedSeedStageVersion: 7,
    }]);
  });

  it("loads every history page with omitted wording and provenance, then restores through the current role/version fence", async () => {
    __setQueryData("seeds:listBatches", {
      page: [{
        batch: { _id: "batch-old-1", operation: "initial", status: "superseded" },
        seeds: [{
          ...historicalSeed("seed-old-1", "Original historical wording.", "Edited historical wording.", "Archived source excerpt one."),
          selection: { selected: false, editedBullets: ["Edited historical wording."] },
        }],
      }],
      isDone: false,
      continueCursor: "history-2",
      truncated: false,
      budget,
    });
    __setQueryDataForArgs("seeds:listBatches", {
      generationId,
      roleId: "company_context",
      cursor: "history-2",
      numItems: 20,
    }, {
      page: [{
        batch: { _id: "batch-old-2", operation: "feedback", status: "superseded" },
        seeds: [historicalSeed("seed-old-2", "Second original.", "Second omitted Seed.", "Archived source excerpt two.")],
      }],
      isDone: true,
      continueCursor: "history-done",
      truncated: false,
      budget,
    });
    __setQueryData("seeds:getApprovalReview", {
      approvalChallenge: {
        approvalChallenge: "history-challenge",
        carriedSeedIds: [],
        exclusionEntryIds: [],
        changedRoleIds: [],
        shownBatchOutdated: false,
        exclusions: [],
        contributionHashes: [],
      },
      selectedCount: 1,
      seedStageVersion: 7,
    });
    const view = await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));

    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.element(page.getByText("Second omitted Seed.", { exact: true })).toBeVisible();
    expect(view.container.textContent).toContain("Original wording: Original historical wording.");
    await page.getByRole("button", { name: "Evidence", exact: true }).nth(1).click();
    await page.getByRole("button", { name: "Evidence", exact: true }).nth(2).click();
    expect(view.container.textContent).toContain("Archived source excerpt one.");
    expect(view.container.textContent).toContain("Archived source excerpt two.");
    expect(page.getByText("Available from full history", { exact: true }).elements()).toHaveLength(2);
    await page.getByRole("checkbox", { name: "Select seed", exact: true }).last().click();
    expect(__mutationCalls("seeds:select")).toContainEqual({
      generationId,
      roleId: "company_context",
      seedId: "seed-old-2",
      selected: true,
      expectedSeedStageVersion: 7,
    });
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    expect(__mutationCalls("seeds:approve")).toContainEqual({
      generationId,
      roleId: "company_context",
      expectedSeedStageVersion: 7,
      approvalChallenge: "history-challenge",
      acknowledgedCarriedSeedIds: [],
      acknowledgedExclusionEntryIds: [],
    });
    await page.getByRole("button", { name: "Restore this Batch", exact: true }).first().click();
    expect(__mutationCalls("seeds:restoreBatch")[0]).toEqual({
      generationId,
      roleId: "company_context",
      batchId: "batch-old-1",
      expectedSeedStageVersion: 7,
    });
  });

  it("dispatches the reversible decision controls with the current role/version", async () => {
    const view = await render(SeedSubsectionPane, paneProps(subsection({
      roleId: "prior_year_status",
      items: [seed({ roleId: "prior_year_status", edited: true })],
      feedbackGroups: [{
        requestId: "feedback-1" as Id<"seedFeedbackRequests">,
        targetSeedId: "seed-1" as Id<"seeds">,
        targetWording: ["The control loop stabilized output."],
        instruction: "Make the evidence more specific.",
        status: "active",
        batchId: null,
        revisedSeedIds: [],
      }],
    }), { title: "Previous-year status", objective: "Describe prior-year status.", kind: "optional" }));

    await page.getByRole("checkbox", { name: "Deselect seed" }).click();
    await page.getByRole("button", { name: "Restore original wording", exact: true }).click();
    await page.getByRole("button", { name: "Give feedback", exact: true }).click();
    await page.getByRole("textbox", { name: "Revision instruction" }).fill("Focus on measured stability.");
    await page.getByRole("button", { name: "Request revision", exact: true }).click();
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await page.getByRole("button", { name: "Regenerate", exact: true }).click();
    await page.getByRole("button", { name: "Skip", exact: true }).click();

    expect(__mutationCalls("seeds:select")[0]).toMatchObject({ roleId: "prior_year_status", seedId: "seed-1", selected: false, expectedSeedStageVersion: 7 });
    expect(__mutationCalls("seeds:restoreWording")[0]).toMatchObject({ roleId: "prior_year_status", seedId: "seed-1", expectedSeedStageVersion: 7 });
    expect(__mutationCalls("seeds:giveFeedback")[0]).toMatchObject({ roleId: "prior_year_status", seedId: "seed-1", instruction: "Focus on measured stability.", expectedSeedStageVersion: 7 });
    expect(__mutationCalls("seeds:withdrawFeedback")[0]).toMatchObject({ roleId: "prior_year_status", feedbackRequestId: "feedback-1", expectedSeedStageVersion: 7 });
    expect(__mutationCalls("seeds:regenerate")[0]).toMatchObject({ roleId: "prior_year_status", expectedSeedStageVersion: 7 });
    expect(__mutationCalls("seeds:skip")[0]).toMatchObject({ roleId: "prior_year_status", expectedSeedStageVersion: 7 });

    await view.rerender(paneProps(subsection({ roleId: "prior_year_status", state: "skipped", items: [] }), {
      title: "Previous-year status",
      objective: "Describe prior-year status.",
      kind: "optional",
    }));
    await page.getByRole("button", { name: "Restore subsection", exact: true }).click();
    expect(__mutationCalls("seeds:unskip")[0]).toMatchObject({ roleId: "prior_year_status", expectedSeedStageVersion: 7 });
  });

  it("discards a history response when the role/version scope changes while it is loading", async () => {
    let release: ((value: unknown) => void) | undefined;
    const delayed = new Promise<unknown>((resolve) => { release = resolve; });
    __setQueryData("seeds:listBatches", delayed);
    const view = await render(SeedSubsectionPane, paneProps(subsection()));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await view.rerender(paneProps(subsection({ roleId: "goal_problem", seedStageVersion: 8, items: [] }), {
      title: "Goal / Problem",
      objective: "Describe the goal.",
    }));
    release?.({
      page: [{
        batch: { _id: "stale-batch", operation: "initial", status: "superseded" },
        seeds: [{ _id: "stale-seed", finalBullets: ["Do not show stale history."], selection: null, provenance: [] }],
      }],
      isDone: true,
      continueCursor: "done",
      truncated: false,
      budget,
    });
    await Promise.resolve();
    expect(view.container.textContent).not.toContain("Do not show stale history.");
    expect(page.getByRole("button", { name: "Load Batch history", exact: true }).elements()).toHaveLength(1);
  });

  it("discards a late history response when the generation changes at the same role and version", async () => {
    let release: ((value: unknown) => void) | undefined;
    const delayed = new Promise<unknown>((resolve) => { release = resolve; });
    __setQueryData("seeds:listBatches", delayed);
    const view = await render(SeedSubsectionPane, paneProps(subsection()));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.poll(() => __clientQueryCalls("seeds:listBatches")).toEqual([{
      generationId,
      roleId: "company_context",
      cursor: null,
      numItems: 20,
    }]);
    await view.rerender(paneProps(subsection({
      generationId: otherGenerationId,
      items: [seed({ seedId: "seed-next" as Id<"seeds">, bullets: ["Next generation wording."] })],
    })));
    release?.({
      page: [{
        batch: { _id: "old-generation-batch", operation: "initial", status: "superseded" },
        seeds: [historicalSeed("old-generation-seed", "Old generation original.", "Old generation history must not show.", "Old excerpt.")],
      }],
      isDone: true,
      continueCursor: "done",
      truncated: false,
      budget,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.container.textContent).not.toContain("Old generation history must not show.");
    await expect.element(page.getByText("Next generation wording.", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Load Batch history", exact: true }).elements()).toHaveLength(1);
    expect(__clientQueryCalls("seeds:listBatches")).toHaveLength(1);
  });

  it("discards a late approval review when the role/version scope changes", async () => {
    let releaseReview: ((value: unknown) => void) | undefined;
    const delayedReview = new Promise<unknown>((resolve) => { releaseReview = resolve; });
    __setQueryData("seeds:listBatches", {
      page: [], isDone: true, continueCursor: "done", truncated: false, budget,
    });
    __setQueryData("seeds:getApprovalReview", delayedReview);
    const view = await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.poll(() => __clientQueryCalls("seeds:getApprovalReview")).toEqual([{
      generationId,
      roleId: "company_context",
      expectedSeedStageVersion: 7,
    }]);
    await view.rerender(paneProps(
      subsection({ roleId: "goal_problem", seedStageVersion: 8, truncated: true, approvalChallenge: null, items: [] }),
      { title: "Goal / Problem", objective: "Describe the goal." }
    ));
    releaseReview?.({
      approvalChallenge: subsection().approvalChallenge,
      selectedCount: 1,
      seedStageVersion: 7,
    });
    await Promise.resolve();
    expect(view.container.textContent).not.toContain("Full decision review loaded.");
    await expect.element(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  });

  it("labels a server processing refusal and keeps approval unavailable", async () => {
    let refuseReview: ((reason: unknown) => void) | undefined;
    const refusedReview = new Promise<unknown>((_resolve, reject) => { refuseReview = reject; });
    __setQueryData("seeds:listBatches", {
      page: [], isDone: true, continueCursor: "done", truncated: false, budget,
    });
    __setQueryData("seeds:getApprovalReview", refusedReview);
    await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.poll(() => __clientQueryCalls("seeds:getApprovalReview")).toHaveLength(1);
    refuseReview?.(new ConvexError({
      code: "INVALID_INPUT",
      reason: "SEED_PROCESSING_LIMIT",
      roleId: "company_context",
      message: "Seed approval exceeds the read budget",
    }));
    await expect.element(page.getByText("The server could not form a complete approval decision within its safe processing limit. Approval remains unavailable.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  });

  it("stops a nonadvancing history cursor with a bounded refusal and keeps approval unavailable", async () => {
    __setQueryData("seeds:listBatches", {
      page: [], isDone: false, continueCursor: "stuck-cursor", truncated: true, budget,
    });
    await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent(
      "Batch history stopped because one Batch exceeds the safe server processing limit."
    );
    expect(__clientQueryCalls("seeds:listBatches")).toEqual([
      { generationId, roleId: "company_context", cursor: null, numItems: 20 },
      { generationId, roleId: "company_context", cursor: "stuck-cursor", numItems: 20 },
    ]);
    expect(__clientQueryCalls("seeds:getApprovalReview")).toEqual([]);
    await expect.element(page.getByText("History is incomplete.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Retry Batch history", exact: true })).toBeEnabled();
  });

  it("completes page-local history truncation through advancing cursors before requesting the approval review", async () => {
    const historyArgs = (cursor: string | null) => ({ generationId, roleId: "company_context", cursor, numItems: 20 });
    __setQueryDataForArgs("seeds:listBatches", historyArgs(null), {
      page: [{
        batch: { _id: "batch-truncated-1", operation: "initial", status: "superseded" },
        seeds: [historicalSeed("seed-truncated-1", "First original.", "First truncated-page Seed.", "Excerpt one.")],
      }],
      isDone: false,
      continueCursor: "resume-1",
      truncated: true,
      budget,
    });
    __setQueryDataForArgs("seeds:listBatches", historyArgs("resume-1"), {
      page: [{
        batch: { _id: "batch-truncated-2", operation: "regenerate", status: "superseded" },
        seeds: [historicalSeed("seed-truncated-2", "Second original.", "Second truncated-page Seed.", "Excerpt two.")],
      }],
      isDone: false,
      continueCursor: "resume-2",
      truncated: true,
      budget,
    });
    __setQueryDataForArgs("seeds:listBatches", historyArgs("resume-2"), {
      page: [], isDone: true, continueCursor: "done", truncated: false, budget,
    });
    __setQueryData("seeds:getApprovalReview", {
      approvalChallenge: {
        approvalChallenge: "complete-history-challenge",
        carriedSeedIds: [],
        exclusionEntryIds: [],
        changedRoleIds: [],
        shownBatchOutdated: false,
        exclusions: [],
        contributionHashes: [],
      },
      selectedCount: 1,
      seedStageVersion: 7,
    });
    await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.element(page.getByText("Second truncated-page Seed.", { exact: true })).toBeVisible();
    await expect.element(page.getByText("First truncated-page Seed.", { exact: true })).toBeVisible();
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("History is incomplete.");
    await expect.element(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
    expect(__clientQueryCalls("seeds:listBatches").map((call) => (call as { cursor: string | null }).cursor))
      .toEqual([null, "resume-1", "resume-2"]);
  });

  it("saves a long card edit with a soft note, never a word limit", async () => {
    await render(SeedSubsectionPane, paneProps(subsection()));
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await bullet.fill("Six weeks of baseline logging fixed a load profile.");
    expect(page.getByText("Long for a seed", { exact: true }).elements()).toHaveLength(0);
    const longWording = `${Array.from({ length: 30 }, () => "word").join(" ")}.`;
    await bullet.fill(longWording);
    await expect.element(page.getByText("Long for a seed", { exact: true })).toBeVisible();
    const save = page.getByRole("button", { name: "Save wording", exact: true });
    await expect.element(save).toBeEnabled();
    await save.click();
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-1",
      bullets: [longWording, "Tests covered three load bands."],
      expectedSeedStageVersion: 7,
    }]);
  });

  it("keeps unsaved wording on its own base version after a remote update and requires explicit review before saving", async () => {
    const view = await render(SeedSubsectionPane, paneProps(subsection()));
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await bullet.fill("Wording typed against version seven.");

    await view.rerender(paneProps(subsection({
      seedStageVersion: 8,
      items: [seed({ bullets: ["Remote wording from another session."] })],
    })));
    const save = page.getByRole("button", { name: "Save wording", exact: true });
    await expect.element(save).toBeDisabled();
    await expect.element(bullet).toHaveValue("Wording typed against version seven.");
    await expect.element(page.getByText("Current wording: Remote wording from another session.", { exact: true })).toBeVisible();
    expect(__mutationCalls("seeds:edit")).toEqual([]);
    await page.getByRole("button", { name: "Use current decision version", exact: true }).click();
    await expect.element(save).toBeEnabled();
    await save.click();
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-1",
      bullets: ["Wording typed against version seven.", "Tests covered three load bands."],
      expectedSeedStageVersion: 8,
    }]);

    await page.getByRole("button", { name: "Give feedback", exact: true }).click();
    await page.getByRole("textbox", { name: "Revision instruction" }).fill("Name the measured load bands.");
    await view.rerender(paneProps(subsection({
      seedStageVersion: 9,
      items: [seed({ bullets: ["Remote wording from another session."] })],
    })));
    const request = page.getByRole("button", { name: "Request revision", exact: true });
    await expect.element(request).toBeDisabled();
    await expect.element(page.getByRole("textbox", { name: "Revision instruction" })).toHaveValue("Name the measured load bands.");
    expect(__mutationCalls("seeds:giveFeedback")).toEqual([]);
    await page.getByRole("button", { name: "Use current decision version", exact: true }).click();
    await request.click();
    expect(__mutationCalls("seeds:giveFeedback")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      instruction: "Name the measured load bands.",
      expectedSeedStageVersion: 9,
    })]);
  });

  it("clears only unchanged submitted card text and keeps independent buffers while saves are pending", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({
      items: [seed(), seed({ seedId: "seed-2" as Id<"seeds">, bullets: ["Second Seed wording."] })],
    }));
    let finishEdit: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:edit", new Promise((resolve) => { finishEdit = resolve; }));
    let finishFeedback: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:giveFeedback", new Promise((resolve) => { finishFeedback = resolve; }));
    await render(SeedWorkspace, workspaceProps());

    await page.getByRole("button", { name: "Give feedback", exact: true }).last().click();
    const instruction = page.getByRole("textbox", { name: "Revision instruction" });
    await instruction.fill("Keep the second Seed's instruction.");
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await bullet.fill("Submitted wording.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    await bullet.fill("Submitted wording. Typed while saving.");
    finishEdit?.(undefined);
    await expect.element(page.getByRole("button", { name: "Save wording", exact: true })).toBeEnabled();
    await expect.element(bullet).toHaveValue("Submitted wording. Typed while saving.");
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Submitted wording. Typed while saving.");
    expect(storedDrafts()["seed-2"].feedback?.instruction).toBe("Keep the second Seed's instruction.");

    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);
    expect(storedDrafts()["seed-1"]).toBeUndefined();
    expect(storedDrafts()["seed-2"].feedback?.instruction).toBe("Keep the second Seed's instruction.");
    expect(__mutationCalls("seeds:edit").map((call) => (call as { bullets: string[] }).bullets[0])).toEqual([
      "Submitted wording.",
      "Submitted wording. Typed while saving.",
    ]);

    await page.getByRole("button", { name: "Request revision", exact: true }).click();
    await instruction.fill("Keep the second Seed's instruction. Added while requesting.");
    finishFeedback?.(undefined);
    await expect.element(page.getByRole("button", { name: "Request revision", exact: true })).toBeEnabled();
    await expect.element(instruction).toHaveValue("Keep the second Seed's instruction. Added while requesting.");
    expect(storedDrafts()["seed-2"].feedback?.instruction).toBe("Keep the second Seed's instruction. Added while requesting.");
  });

  it("suppresses every card mutation path for restored drafts and live revocation while keeping the text", async () => {
    storeDrafts({
      "seed-1": {
        ownerGenerationId: generationId,
        ownerRoleId: "company_context",
        edit: { bulletOne: "Restored unsaved wording.", bulletTwo: "", baseSeedStageVersion: 7 },
        feedback: { instruction: "Restored instruction.", baseSeedStageVersion: 7 },
      },
    });
    __setQueryData("seeds:getOutline", outline(false));
    __setQueryData("seeds:getSubsection", subsection());
    await render(SeedWorkspace, workspaceProps());

    await expect.element(page.getByText(/Your unsaved text for this Seed is kept on this device/)).toBeVisible();
    for (const name of ["Edit", "Give feedback", "Save wording", "Request revision", "Regenerate", "Approve", "Confirm and approve", "Restore original wording"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    await expect.element(page.getByRole("checkbox", { name: "Deselect seed" })).toBeDisabled();
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([]);

    __setQueryData("seeds:getOutline", outline(true));
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Restored unsaved wording.");
    await expect.element(page.getByRole("textbox", { name: "Revision instruction" })).toHaveValue("Restored instruction.");
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Typed before revocation.");

    __setQueryData("seeds:getOutline", outline(false));
    await expect.poll(() => page.getByRole("textbox").elements().length).toBe(0);
    for (const name of ["Save wording", "Request revision", "Edit", "Give feedback"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Typed before revocation.");
    expect(storedDrafts()["seed-1"].feedback?.instruction).toBe("Restored instruction.");

    __setQueryData("seeds:getOutline", outline(true));
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Typed before revocation.");
    expect(__mutationCalls("seeds:edit")).toEqual([]);
    expect(__mutationCalls("seeds:giveFeedback")).toEqual([]);
  });

  it("announces workspace read failures, retries by resubscribing, and keeps stored drafts", async () => {
    storeDrafts({
      "seed-1": {
        ownerGenerationId: generationId,
        ownerRoleId: "company_context",
        edit: { bulletOne: "Unsaved before the failure.", bulletTwo: "", baseSeedStageVersion: 7 },
        feedback: null,
      },
    });
    __setQueryError("seeds:getOutline", new ConvexError({
      code: "INVALID_STATE",
      message: "Seed decisions are temporarily unavailable",
    }));
    await render(SeedWorkspace, workspaceProps());

    const outlineAlert = page.getByRole("alert");
    await expect.element(outlineAlert).toHaveTextContent("The Seed workspace could not load.");
    await expect.element(outlineAlert).toHaveTextContent("Seed decisions are temporarily unavailable");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getOutline")).toEqual([
      { generationId },
      "skip",
      { generationId },
    ]);
    await expect.element(page.getByRole("alert")).toHaveTextContent("The Seed workspace could not load.");
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Unsaved before the failure.");

    __setQueryError("seeds:getSubsection", new ConvexError({
      code: "INVALID_STATE",
      message: "Subsection read failed",
    }));
    __setQueryData("seeds:getOutline", outline());
    await expect.element(page.getByRole("alert")).toHaveTextContent("Company / Context could not load.");
    await expect.element(page.getByRole("alert")).toHaveTextContent("Subsection read failed");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getSubsection")).toContainEqual("skip");
    __setQueryData("seeds:getSubsection", subsection());
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Unsaved before the failure.");
    expect(page.getByRole("alert").elements()).toHaveLength(0);
  });

  it("withholds a retained prior-role Subsection while the selected role loads", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "goal_problem" }, undefined);
    await render(SeedWorkspace, workspaceProps());
    await expect.element(page.getByText("The control loop stabilized output.", { exact: true })).toBeVisible();
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    await page.getByRole("navigation", { name: "PD subsections" }).getByRole("button", { name: /Goal \/ Problem/ }).click();
    await expect.element(page.getByText("Loading subsection…", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("The control loop stabilized output.");
    expect(page.getByRole("button", { name: "Edit", exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole("checkbox").elements()).toHaveLength(0);
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "goal_problem" }, subsection({
      roleId: "goal_problem",
      items: [seed({ seedId: "seed-goal" as Id<"seeds">, roleId: "goal_problem", bullets: ["Goal Seed wording."] })],
      shownBatchId: "batch-goal" as Id<"seedBatches">,
    }));
    await expect.element(page.getByText("Goal Seed wording.", { exact: true })).toBeVisible();
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([
      { generationId, roleId: "company_context", batchId: "batch-1", expectedSeedStageVersion: 7 },
      { generationId, roleId: "goal_problem", batchId: "batch-goal", expectedSeedStageVersion: 7 },
    ]);
  });

  it("resets owner state before hydrating an empty destination generation and keeps old-owner drafts on their own key", async () => {
    storeDrafts({
      "seed-1": {
        ownerGenerationId: generationId,
        ownerRoleId: "company_context",
        edit: { bulletOne: "Generation A unsaved wording.", bulletTwo: "", baseSeedStageVersion: 7 },
        feedback: null,
      },
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryDataForArgs("seeds:getOutline", { generationId: otherGenerationId }, undefined);
    __setQueryDataForArgs("seeds:getSubsection", { generationId: otherGenerationId, roleId: "company_context" }, undefined);
    const view = await render(SeedWorkspace, workspaceProps());
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Generation A unsaved wording.");

    await view.rerender(workspaceProps({ generationId: otherGenerationId }));
    await expect.element(page.getByText("Loading Seed workspace…", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("The control loop stabilized output.");
    expect(page.getByRole("textbox").elements()).toHaveLength(0);

    __setQueryDataForArgs("seeds:getOutline", { generationId: otherGenerationId }, { ...outline(), generationId: otherGenerationId });
    __setQueryDataForArgs("seeds:getSubsection", { generationId: otherGenerationId, roleId: "company_context" }, subsection({
      generationId: otherGenerationId,
      items: [seed({ seedId: "seed-b" as Id<"seeds">, bullets: ["Generation B wording."] })],
      shownBatchId: "batch-b" as Id<"seedBatches">,
    }));
    await expect.element(page.getByText("Generation B wording.", { exact: true })).toBeVisible();
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    expect(storedDrafts(otherGenerationId)).toEqual({});

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Generation B unsaved wording.");
    expect(storedDrafts(otherGenerationId)).toEqual({
      "seed-b": {
        ownerGenerationId: otherGenerationId,
        ownerRoleId: "company_context",
        edit: { bulletOne: "Generation B unsaved wording.", bulletTwo: "", baseSeedStageVersion: 7 },
        feedback: null,
      },
    });
    expect(storedDrafts()).toEqual({
      "seed-1": {
        ownerGenerationId: generationId,
        ownerRoleId: "company_context",
        edit: { bulletOne: "Generation A unsaved wording.", bulletTwo: "", baseSeedStageVersion: 7 },
        feedback: null,
      },
    });
  });

  it("opens the Brief in the shared drawer with focus inside, Escape closes it, and focus returns to the trigger", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryData("briefs:getBrief", {
      _id: "brief-1",
      version: 3,
      storylineText: "The team pursued a custom control loop.",
      storylineOrigin: "derived",
      editedSinceGeneration: true,
      canEdit: true,
      runBriefVersion: 2,
      appliesToNextGeneration: true,
      regenerationDisabled: true,
      entries: [],
    });
    __setQueryData("writerProfiles:getGenerationWriterSettings", null);
    __setQueryData("generations:getContextInclusion", {
      recorded: true, cap: 12, documentsInContext: 0, documentsTotal: 0, rows: [],
    });
    await render(SeedWorkspace, workspaceProps());
    await expect.element(page.getByText("The control loop stabilized output.", { exact: true })).toBeVisible();

    const trigger = page.getByRole("button", { name: "Brief", exact: true });
    const triggerElement = trigger.element() as HTMLElement;
    triggerElement.focus();
    await userEvent.keyboard("{Enter}");
    const dialog = page.getByRole("dialog", { name: "Brief" });
    await expect.element(dialog).toBeVisible();
    const dialogElement = dialog.element() as HTMLElement;
    await expect.poll(() => dialogElement.contains(document.activeElement)).toBe(true);
    await expect.element(dialog.getByText("This generation uses Brief v2.")).toBeVisible();
    await expect.element(dialog.getByText("Your newer Brief edits apply to the next generation.")).toBeVisible();
    for (let step = 0; step < 4; step += 1) {
      await userEvent.keyboard("{Tab}");
      expect(dialogElement.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    // The drawer's exit animation runs before removal; the margin covers a
    // loaded machine without weakening what is asserted.
    await expect.poll(() => dialogElement.isConnected, { timeout: 3000 }).toBe(false);
    await expect.poll(() => document.activeElement).toBe(triggerElement);

    await trigger.click();
    await page.getByRole("button", { name: "Close Brief", exact: true }).click();
    await expect.poll(() => document.querySelector('[role="dialog"]'), { timeout: 3000 }).toBeNull();
    await expect.poll(() => document.activeElement).toBe(triggerElement);
  });

  it("moves focus into the displayed Work pane when a narrow Outline selection hides the Outline", async () => {
    await page.viewport(390, 844);
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "hypothesis" }, subsection({
      roleId: "hypothesis",
      items: [seed({ seedId: "seed-h" as Id<"seeds">, roleId: "hypothesis", bullets: ["Hypothesis Seed wording."] })],
      shownBatchId: "batch-h" as Id<"seedBatches">,
    }));
    const { container } = await render(SeedWorkspace, workspaceProps());
    container.style.width = "390px";
    container.style.height = "844px";
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    const roleButton = page.getByRole("navigation", { name: "PD subsections" }).getByRole("button", { name: /Hypothesis/ });
    (roleButton.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");

    const heading = page.getByRole("heading", { name: "Hypothesis", exact: true });
    await expect.element(heading).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(heading.element());
    const focused = document.activeElement as HTMLElement;
    expect(focused.offsetParent).not.toBeNull();
    await expect.element(page.getByRole("button", { name: "Work", exact: true })).toHaveAttribute("aria-pressed", "true");

    const outlineSwitch = page.getByRole("button", { name: "Outline", exact: true });
    (outlineSwitch.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(outlineSwitch).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();
    expect(document.activeElement).toBe(outlineSwitch.element());
  });

  it("names each frozen cited source beside its exact excerpt in cards and history", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryData("seeds:getSourceAttribution", {
      generationId,
      sources: [
        { sourceId: "source-1", label: "Controller interview.docx", kind: "transcript" },
        { sourceId: "source-history", label: "engineering:load-test-report.pdf", kind: "project_document" },
      ],
      complete: true,
    });
    __setQueryData("seeds:listBatches", {
      page: [{
        batch: { _id: "batch-1", operation: "initial", status: "shown" },
        seeds: [historicalSeed("seed-1", "The control loop stabilized output.", "The control loop stabilized output.", "Load bands held within tolerance.")],
      }],
      isDone: true,
      continueCursor: "done",
      truncated: false,
      budget,
    });
    await render(SeedWorkspace, workspaceProps());

    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    const cardEvidence = document.querySelector<HTMLElement>('[data-seed-id="seed-1"] figure')!;
    expect(cardEvidence.querySelector("figcaption")?.textContent).toBe("Controller interview.docx");
    expect(cardEvidence.querySelector("blockquote")?.textContent?.trim()).toBe("Measured output remained stable.");

    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    const history = page.getByRole("region", { name: "Batch history" });
    await expect.element(history.getByText("load-test-report.pdf", { exact: true })).toBeVisible();
    await expect.element(history.getByText("Load bands held within tolerance.", { exact: true })).toBeVisible();
  });

  it("issues no further history or approval-review query after the keyed pane is destroyed during a delayed page", async () => {
    let release: ((value: unknown) => void) | undefined;
    __setQueryData("seeds:listBatches", new Promise<unknown>((resolve) => { release = resolve; }));
    __setQueryData("seeds:getApprovalReview", historyReview("after-destruction"));
    const view = await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.poll(() => __clientQueryCalls("seeds:listBatches")).toHaveLength(1);
    view.unmount();

    release?.({ page: [], isDone: false, continueCursor: "history-2", truncated: false, budget });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__clientQueryCalls("seeds:listBatches")).toHaveLength(1);
    expect(__clientQueryCalls("seeds:getApprovalReview")).toEqual([]);
  });

  it("drops a challenge that resolves after the pane is destroyed without publishing it", async () => {
    let releaseReview: ((value: unknown) => void) | undefined;
    __setQueryData("seeds:listBatches", { page: [], isDone: true, continueCursor: "done", truncated: false, budget });
    __setQueryData("seeds:getApprovalReview", new Promise<unknown>((resolve) => { releaseReview = resolve; }));
    const view = await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.poll(() => __clientQueryCalls("seeds:getApprovalReview")).toHaveLength(1);
    view.unmount();

    releaseReview?.(historyReview("late-challenge"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.body.textContent).not.toContain("Full decision review loaded.");
    expect(page.getByRole("button", { name: "Approve", exact: true }).elements()).toHaveLength(0);
    expect(__clientQueryCalls("seeds:getApprovalReview")).toHaveLength(1);
    expect(__mutationCalls("seeds:approve")).toEqual([]);
  });

  it("accepts a terminal 200th history page and refuses a nonterminal one before a 201st query", async () => {
    const historyArgs = (cursor: string | null) => ({ generationId, roleId: "company_context", cursor, numItems: 20 });
    const seedBoundaryPages = (terminal: boolean) => {
      for (let index = 0; index < 200; index += 1) {
        const last = index === 199;
        __setQueryDataForArgs("seeds:listBatches", historyArgs(index === 0 ? null : `h-${index}`), {
          page: last
            ? [{
                batch: { _id: "batch-200", operation: "initial", status: "superseded" },
                seeds: [historicalSeed("seed-200", "Two hundredth original.", "Two hundredth page Seed.", "Excerpt two hundred.")],
              }]
            : [],
          isDone: last && terminal,
          continueCursor: `h-${index + 1}`,
          truncated: false,
          budget,
        });
      }
    };

    __setQueryData("seeds:getApprovalReview", historyReview("boundary-challenge"));
    seedBoundaryPages(true);
    let view = await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.element(page.getByText("Two hundredth page Seed.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("History is incomplete.");
    expect(__clientQueryCalls("seeds:listBatches")).toHaveLength(200);
    expect(__clientQueryCalls("seeds:getApprovalReview")).toHaveLength(1);
    view.unmount();

    document.body.innerHTML = "";
    __resetConvexStub();
    __setQueryData("seeds:getApprovalReview", historyReview("boundary-challenge"));
    seedBoundaryPages(false);
    view = await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent(
      "Batch history stopped because one Batch exceeds the safe server processing limit."
    );
    expect(__clientQueryCalls("seeds:listBatches")).toHaveLength(200);
    expect(__clientQueryCalls("seeds:getApprovalReview")).toEqual([]);
    await expect.element(page.getByText("History is incomplete.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
    view.unmount();
  });

  it("invalidates a history-derived approval review when a replacement review fails, and restores it only after a successful retry", async () => {
    const completeHistory = { page: [], isDone: true, continueCursor: "done", truncated: false, budget };
    __setQueryData("seeds:listBatches", completeHistory);
    __setQueryData("seeds:getApprovalReview", historyReview("history-challenge"));
    await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    const loaded = page.getByText(/Full decision review loaded\./);
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.element(loaded).toBeVisible();
    await expect.element(approve).toBeEnabled();

    // Replacement 1: the history read fails.
    __setQueryData("seeds:listBatches", rejecting(new ConvexError({ code: "INVALID_STATE", message: "History read failed" })));
    await page.getByRole("button", { name: "Refresh Batch history", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("History read failed");
    expect(document.body.textContent).not.toContain("Full decision review loaded.");
    await expect.element(approve).toBeDisabled();
    __setQueryData("seeds:listBatches", completeHistory);
    await page.getByRole("button", { name: "Retry Batch history", exact: true }).click();
    await expect.element(loaded).toBeVisible();
    await expect.element(approve).toBeEnabled();

    // Replacement 2: the cursor stops advancing.
    __setQueryData("seeds:listBatches", { page: [], isDone: false, continueCursor: "stuck", truncated: true, budget });
    await page.getByRole("button", { name: "Refresh Batch history", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Batch history stopped");
    expect(document.body.textContent).not.toContain("Full decision review loaded.");
    await expect.element(approve).toBeDisabled();
    __setQueryData("seeds:listBatches", completeHistory);
    await page.getByRole("button", { name: "Retry Batch history", exact: true }).click();
    await expect.element(loaded).toBeVisible();
    await expect.element(approve).toBeEnabled();

    // Replacement 3: the server refuses the replacement challenge.
    __setQueryData("seeds:getApprovalReview", rejecting(new ConvexError({
      code: "INVALID_INPUT",
      reason: "SEED_PROCESSING_LIMIT",
      roleId: "company_context",
      message: "Seed approval exceeds the read budget",
    })));
    await page.getByRole("button", { name: "Refresh Batch history", exact: true }).click();
    await expect.element(page.getByText("The server could not form a complete approval decision within its safe processing limit. Approval remains unavailable.", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Full decision review loaded.");
    await expect.element(approve).toBeDisabled();
    expect(__mutationCalls("seeds:approve")).toEqual([]);
    __setQueryData("seeds:getApprovalReview", historyReview("history-challenge"));
    await page.getByRole("button", { name: "Refresh Batch history", exact: true }).click();
    await expect.element(loaded).toBeVisible();
    await expect.element(approve).toBeEnabled();
    await approve.click();
    expect(__mutationCalls("seeds:approve")).toEqual([expect.objectContaining({ approvalChallenge: "history-challenge" })]);
  });

  it("keeps a complete card-projection challenge valid while a Batch-history refresh fails", async () => {
    __setQueryData("seeds:listBatches", rejecting(new ConvexError({ code: "INVALID_STATE", message: "History read failed" })));
    await render(SeedSubsectionPane, paneProps(subsection({
      approvalChallenge: {
        ...subsection().approvalChallenge!,
        carriedSeedIds: [],
        exclusionEntryIds: [],
        changedRoleIds: [],
        shownBatchOutdated: false,
        exclusions: [],
      },
    })));
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await expect.element(approve).toBeEnabled();
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("History read failed");
    await expect.element(approve).toBeEnabled();
    await approve.click();
    expect(__mutationCalls("seeds:approve")).toEqual([expect.objectContaining({ approvalChallenge: "challenge-exact" })]);
  });

  it("retries refused viewed-event bookkeeping against the current Batch without another subscription update", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setMutationError("seeds:markBatchViewed", new ConvexError({ code: "INVALID_STATE", message: "Temporarily refused" }));
    await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toHaveLength(1);
    const subscriptions = __queryArgsHistory("seeds:getSubsection").length;

    __setMutationResult("seeds:markBatchViewed", null);
    const viewed = { generationId, roleId: "company_context", batchId: "batch-1", expectedSeedStageVersion: 7 };
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed"), { timeout: 3000 }).toEqual([viewed, viewed]);
    expect(__queryArgsHistory("seeds:getSubsection")).toHaveLength(subscriptions);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(2);
  });

  it("stops an obsolete viewed-event retry when the owner changes", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryDataForArgs("seeds:getOutline", { generationId: otherGenerationId }, undefined);
    __setQueryDataForArgs("seeds:getSubsection", { generationId: otherGenerationId, roleId: "company_context" }, undefined);
    __setMutationError("seeds:markBatchViewed", new ConvexError({ code: "INVALID_STATE", message: "Temporarily refused" }));
    const view = await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    __setMutationResult("seeds:markBatchViewed", null);
    await view.rerender(workspaceProps({ generationId: otherGenerationId }));
    await expect.element(page.getByText("Loading Seed workspace…", { exact: true })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(1);
  });

  it("distinguishes attribution loading and failure, retries explicitly, and never presents a missing name as attributed", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    await render(SeedWorkspace, workspaceProps());
    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    const caption = () => document.querySelector<HTMLElement>('[data-seed-id="seed-1"] figcaption');
    await expect.poll(() => caption()?.textContent).toBe("Source name loading…");
    expect(caption()?.dataset.attributed).toBe("false");

    __setQueryError("seeds:getSourceAttribution", new ConvexError({ code: "INVALID_STATE", message: "Attribution read failed" }));
    await expect.poll(() => caption()?.textContent).toBe("Source name unavailable");
    const notice = () => document.querySelector<HTMLElement>('[data-source-attribution="error"]');
    await expect.poll(() => notice()?.textContent ?? "").toContain("Source names could not be loaded.");
    await expect.element(page.getByText("Measured output remained stable.", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Retry source names", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getSourceAttribution")).toEqual([{ generationId }, "skip", { generationId }]);
    __setQueryData("seeds:getSourceAttribution", {
      generationId,
      sources: [{ sourceId: "source-1", label: "Controller interview.docx", kind: "transcript" }],
      complete: true,
    });
    await expect.poll(() => caption()?.textContent).toBe("Controller interview.docx");
    expect(caption()?.dataset.attributed).toBe("true");
    expect(notice()).toBeNull();
  });

  it("recovers names an incomplete attribution read left out through the bounded path, refuses honestly when it fails, and retries explicitly", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryData("seeds:getSourceAttribution", {
      generationId,
      sources: [{ sourceId: "source-other", label: "Other.docx", kind: "transcript" }],
      complete: false,
    });
    __setQueryData("seeds:getSourceAttributionByIds", rejecting(new ConvexError({ code: "INVALID_INPUT", message: "Recovery read failed" })));
    await render(SeedWorkspace, workspaceProps());
    await page.getByRole("button", { name: "Evidence", exact: true }).click();
    const caption = () => document.querySelector<HTMLElement>('[data-seed-id="seed-1"] figcaption');
    await expect.poll(() => __clientQueryCalls("seeds:getSourceAttributionByIds")).toEqual([{ generationId, sourceIds: ["source-1"] }]);
    await expect.poll(() => caption()?.textContent).toBe("Source name not retrieved");
    expect(caption()?.dataset.attributed).toBe("false");
    const notice = () => document.querySelector<HTMLElement>('[data-source-attribution="incomplete"]');
    await expect.poll(() => notice()?.textContent ?? "").toContain("Recovery read failed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Bounded: one attempt per source until the writer retries.
    expect(__clientQueryCalls("seeds:getSourceAttributionByIds")).toHaveLength(1);

    __setQueryData("seeds:getSourceAttributionByIds", {
      generationId,
      sources: [{ sourceId: "source-1", label: "Controller interview.docx", kind: "transcript" }],
      complete: true,
    });
    await page.getByRole("button", { name: "Retry source names", exact: true }).click();
    await expect.poll(() => __clientQueryCalls("seeds:getSourceAttributionByIds")).toHaveLength(2);
    await expect.poll(() => caption()?.textContent).toBe("Controller interview.docx");
    expect(caption()?.dataset.attributed).toBe("true");
    expect(notice()).toBeNull();
  });

  it("issues no second viewed mutation after the workspace is destroyed during a retry delay", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setMutationError("seeds:markBatchViewed", new ConvexError({ code: "INVALID_STATE", message: "Temporarily refused" }));
    const view = await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toHaveLength(1);
    // The retry would succeed now, but the workspace is gone before its delay ends.
    __setMutationResult("seeds:markBatchViewed", null);
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(1);
  });

  it("requests no next attribution chunk and publishes nothing after the workspace is destroyed during a delayed chunk", async () => {
    // 33 cited sources without names: two bounded recovery chunks (32 + 1).
    const sourceIds = Array.from({ length: 33 }, (_, index) => `source-missing-${index}`);
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({
      items: [seed({ provenance: sourceIds.map((sourceId, index) => citation(index, sourceId)) })],
    }));
    __setQueryData("seeds:getSourceAttribution", { generationId, sources: [], complete: false });
    let release: ((value: unknown) => void) | undefined;
    __setQueryData("seeds:getSourceAttributionByIds", new Promise((resolve) => { release = resolve; }));
    const view = await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __clientQueryCalls("seeds:getSourceAttributionByIds")).toHaveLength(1);
    const firstChunk = __clientQueryCalls("seeds:getSourceAttributionByIds")[0] as { sourceIds: string[] };
    expect(firstChunk.sourceIds).toHaveLength(32);
    view.unmount();

    release?.({
      generationId,
      sources: sourceIds.slice(0, 32).map((sourceId) => ({ sourceId, label: `Recovered ${sourceId}`, kind: "transcript" })),
      complete: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__clientQueryCalls("seeds:getSourceAttributionByIds")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Recovered source-missing-0");
  });

  it("records a Batch as viewed only once it is rendered on the displayed Work surface, including after a responsive change", async () => {
    await page.viewport(390, 844);
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ shownBatchId: null }));
    const { container } = await render(SeedWorkspace, workspaceProps());
    container.style.width = "390px";
    container.style.height = "844px";
    await expect.element(page.getByText("The control loop stabilized output.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();

    // A Batch arriving while the narrow Outline is displayed is not yet viewed.
    __setQueryData("seeds:getSubsection", subsection({ shownBatchId: "batch-arrived" as Id<"seedBatches"> }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([]);

    // Displaying Work records it, once.
    await page.getByRole("button", { name: "Work", exact: true }).click();
    const arrived = { generationId, roleId: "company_context", batchId: "batch-arrived", expectedSeedStageVersion: 7 };
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([arrived]);
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([arrived]);

    // A second Batch under the hidden Work pane waits for desktop visibility.
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    __setQueryData("seeds:getSubsection", subsection({ shownBatchId: "batch-second" as Id<"seedBatches"> }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([arrived]);
    await page.viewport(1366, 900);
    container.style.width = "1000px";
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([
      arrived,
      { generationId, roleId: "company_context", batchId: "batch-second", expectedSeedStageVersion: 7 },
    ]);
  });

  it("stops a viewed retry when Work is hidden during its delay and records again once Work is displayed", async () => {
    await page.viewport(390, 844);
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    let refuse: ((reason: unknown) => void) | undefined;
    __setMutationResult("seeds:markBatchViewed", new Promise((_resolve, reject) => { refuse = reject; }));
    const { container } = await render(SeedWorkspace, workspaceProps());
    container.style.width = "390px";
    container.style.height = "844px";
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    // Work is hidden before the refused attempt's retry delay ends.
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    __setMutationResult("seeds:markBatchViewed", null);
    refuse?.(new ConvexError({ code: "INVALID_STATE", message: "Temporarily refused" }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    await page.getByRole("button", { name: "Work", exact: true }).click();
    const viewed = { generationId, roleId: "company_context", batchId: "batch-1", expectedSeedStageVersion: 7 };
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([viewed, viewed]);
  });

  it("keeps workspace drafts usable in memory and announces unavailable retention when storage is blocked from the start", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ items: twoSeeds() }));
    const view = await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("This device cannot keep it across navigation or reload.");

    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await bullet.fill("Typed without storage.");
    await page.getByRole("button", { name: "Give feedback", exact: true }).last().click();
    await page.getByRole("textbox", { name: "Revision instruction" }).fill("Instruction without storage.");
    await expect.element(bullet).toHaveValue("Typed without storage.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      bullets: ["Typed without storage.", "Tests covered three load bands."],
      expectedSeedStageVersion: 7,
    })]);
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);
    await expect.element(page.getByRole("textbox", { name: "Revision instruction" })).toHaveValue("Instruction without storage.");

    // Navigation with an unsaved draft: retention was announced as unavailable,
    // and the recreated workspace truthfully starts without it.
    view.unmount();
    await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("This device cannot keep it across navigation or reload.");
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    expect(__mutationCalls("seeds:giveFeedback")).toEqual([]);
  });

  it("announces retention loss when storage writes fail after a successful hydration and keeps editing from memory", async () => {
    storeDrafts({
      "seed-1": {
        ownerGenerationId: generationId,
        ownerRoleId: "company_context",
        edit: { bulletOne: "Hydrated wording.", bulletTwo: "", baseSeedStageVersion: 7 },
        feedback: null,
      },
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ items: twoSeeds() }));
    await render(SeedWorkspace, workspaceProps());
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await expect.element(bullet).toHaveValue("Hydrated wording.");
    expect(persistenceNotice()).toBeNull();
    await expect.element(page.getByRole("button", { name: "Give feedback", exact: true }).last()).toBeVisible();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await bullet.fill("Hydrated wording. Typed after storage failed.");
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("Unsaved Seed text stays in this open workspace only.");
    await page.getByRole("button", { name: "Give feedback", exact: true }).last().click();
    await page.getByRole("textbox", { name: "Revision instruction" }).fill("Feedback in memory.");
    await expect.element(bullet).toHaveValue("Hydrated wording. Typed after storage failed.");

    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    // The hydrated draft's second bullet is empty, so one bullet is submitted.
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      bullets: ["Hydrated wording. Typed after storage failed."],
      expectedSeedStageVersion: 7,
    })]);
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);
    await expect.element(page.getByRole("textbox", { name: "Revision instruction" })).toHaveValue("Feedback in memory.");
    // The saved Seed's own record was removed on its own key (removal is not
    // what the device refuses), the feedback draft was never mirrored, and no
    // other item's record was touched: the notice truthfully stays.
    expect(storedDrafts()["seed-1"]).toBeUndefined();
    expect(storedDrafts()["seed-2"]).toBeUndefined();
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("Unsaved Seed text stays in this open workspace only.");

    // Once the device accepts writes again, the next write mirrors every
    // pending item and the notice clears.
    vi.restoreAllMocks();
    await page.getByRole("textbox", { name: "Revision instruction" }).fill("Feedback in memory, now mirrored.");
    await expect.poll(() => persistenceNotice()).toBeNull();
    expect(storedDrafts()["seed-2"].feedback?.instruction).toBe("Feedback in memory, now mirrored.");
    expect(storedDrafts()["seed-1"]).toBeUndefined();
  });

  it("removes a saved Seed's own record even while another Seed's refused write is queued ahead of it", async () => {
    storeDrafts({
      "seed-1": {
        ownerGenerationId: generationId,
        ownerRoleId: "company_context",
        edit: { bulletOne: "Hydrated wording.", bulletTwo: "", baseSeedStageVersion: 7 },
        feedback: null,
      },
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ items: twoSeeds() }));
    const first = await render(SeedWorkspace, workspaceProps());
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Hydrated wording.");

    // The other Seed's write is refused first, so it is queued ahead.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await page.getByRole("button", { name: "Give feedback", exact: true }).last().click();
    await page.getByRole("textbox", { name: "Revision instruction" }).fill("Feedback queued first.");
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("Unsaved Seed text stays in this open workspace only.");

    // Saving the hydrated Seed still removes its own stored record.
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      bullets: ["Hydrated wording."],
      expectedSeedStageVersion: 7,
    })]);
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);
    expect(storedDrafts()["seed-1"]).toBeUndefined();
    expect(storedDrafts()["seed-2"]).toBeUndefined();
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("Unsaved Seed text stays in this open workspace only.");

    // Recreation cannot restore the saved wording as an unsaved draft.
    first.unmount();
    await render(SeedWorkspace, workspaceProps());
    await expect.element(page.getByRole("button", { name: "Give feedback", exact: true }).last()).toBeVisible();
    expect(page.getByRole("textbox", { name: "Bullet 1" }).elements()).toHaveLength(0);
  });

  it("preserves another tab's independent drafts when persisting, saving and discarding its own", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ items: twoSeeds() }));
    // Two tabs of one user and generation, both hydrated before either writes.
    const tabA = await render(SeedWorkspace, workspaceProps());
    const tabB = await render(SeedWorkspace, workspaceProps());
    const inA = page.elementLocator(tabA.container);
    const inB = page.elementLocator(tabB.container);
    await inA.getByRole("button", { name: "Edit", exact: true }).first().click();
    await inA.getByRole("textbox", { name: "Bullet 1" }).fill("Tab A wording for seed one.");
    await inB.getByRole("button", { name: "Give feedback", exact: true }).last().click();
    await inB.getByRole("textbox", { name: "Revision instruction" }).fill("Tab B instruction for seed two.");
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Tab A wording for seed one.");
    expect(storedDrafts()["seed-2"].feedback?.instruction).toBe("Tab B instruction for seed two.");

    // Tab A saves: only its own item leaves storage.
    await inA.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.poll(() => storedDrafts()["seed-1"]).toBeUndefined();
    expect(storedDrafts()["seed-2"].feedback?.instruction).toBe("Tab B instruction for seed two.");

    // Recreation hydrates the surviving independent draft; tab B's discard
    // removes only its own item.
    tabA.unmount();
    const tabC = await render(SeedWorkspace, workspaceProps());
    const inC = page.elementLocator(tabC.container);
    await expect.element(inC.getByRole("textbox", { name: "Revision instruction" })).toHaveValue("Tab B instruction for seed two.");
    await inC.getByRole("button", { name: "Edit", exact: true }).first().click();
    await inC.getByRole("textbox", { name: "Bullet 1" }).fill("Tab C wording for seed one.");
    await inB.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => storedDrafts()["seed-2"]).toBeUndefined();
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Tab C wording for seed one.");
    await expect.element(inC.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Tab C wording for seed one.");
  });

  it("qualifies incomplete Outline counts and previews, offers a reload, and clears the qualifier after a complete response", async () => {
    const partial = outline();
    partial.rows = partial.rows.map((row) =>
      row.order === 1
        ? { ...row, state: "approved", countsComplete: false, previewLines: ["Partial preview line"] }
        : { ...row, countsComplete: false }
    );
    __setQueryData("seeds:getOutline", {
      ...partial,
      truncated: true,
      readiness: { ready: false, complete: false, blockingRoleIds: [] },
    });
    __setQueryData("seeds:getSubsection", subsection());
    const view = await render(SeedWorkspace, workspaceProps());
    const notice = () => document.querySelector<HTMLElement>("[data-outline-partial]");
    await expect.poll(() => notice()?.textContent ?? "").toContain("counts and previews may be incomplete");
    expect(view.container.textContent).toContain("Readiness could not be fully computed within the server's safe processing limit.");
    expect(view.container.textContent).toContain("Approved · 1+ (partial read)");
    expect(view.container.textContent).toContain("Partial · Partial preview line");
    expect(view.container.textContent).not.toContain("subsection(s) still need a decision");

    await page.getByRole("button", { name: "Reload Outline", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getOutline")).toEqual([{ generationId }, "skip", { generationId }]);
    // Still bounded after the reload: the honest qualifier stays.
    await expect.poll(() => notice()?.textContent ?? "").toContain("counts and previews may be incomplete");

    const complete = outline();
    complete.rows = complete.rows.map((row) =>
      row.order === 1 ? { ...row, state: "approved", previewLines: ["Partial preview line"] } : row
    );
    __setQueryData("seeds:getOutline", complete);
    await expect.poll(() => notice()).toBeNull();
    await expect.element(page.getByText("Approved · 1", { exact: true })).toBeVisible();
    expect(view.container.textContent).not.toContain("partial read");
    expect(view.container.textContent).not.toContain("Partial · ");
    expect(view.container.textContent).toContain("1 subsection(s) still need a decision.");
  });

  it("announces a Subsection read failure after a successful load, withholds decisions on the retained DTO, keeps the draft and recovers on retry", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    await render(SeedWorkspace, workspaceProps());
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Draft kept through the read failure.");
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    __setQueryData("seeds:getSubsection", undefined);
    __setQueryError("seeds:getSubsection", new ConvexError({ code: "INVALID_STATE", message: "Subsection read failed" }));
    const banner = () => document.querySelector<HTMLElement>("[data-subsection-read-error]");
    await expect.poll(() => banner()?.textContent ?? "").toContain("Subsection read failed");
    expect(banner()?.getAttribute("role")).toBe("alert");
    // The retained DTO stays readable; its decision paths are off; the draft is kept.
    await expect.element(page.getByText("The control loop stabilized output.", { exact: true })).toBeVisible();
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    for (const name of ["Edit", "Save wording", "Give feedback", "Regenerate", "Confirm and approve", "Approve"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    await expect.element(page.getByRole("checkbox", { name: "Deselect seed" })).toBeDisabled();
    await expect.element(page.getByText(/Editing is paused until the live read of this subsection recovers/)).toBeVisible();
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Draft kept through the read failure.");
    expect(__mutationCalls("seeds:edit")).toEqual([]);

    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getSubsection")).toContainEqual("skip");
    __setQueryData("seeds:getSubsection", subsection());
    await expect.poll(() => banner()).toBeNull();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await expect.element(bullet).toHaveValue("Draft kept through the read failure.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      bullets: ["Draft kept through the read failure.", "Tests covered three load bands."],
      expectedSeedStageVersion: 7,
    })]);
    // The recovered Batch is the same displayed Batch: no second view event.
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(1);
  });

  it("keeps decisions unavailable while the Subsection stays pending after a retry, even once the Outline has recovered, then recovers with the draft", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    await render(SeedWorkspace, workspaceProps());
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Draft kept through resubscription.");
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    // Both live reads fail.
    __setQueryData("seeds:getOutline", undefined);
    __setQueryError("seeds:getOutline", new ConvexError({ code: "INVALID_STATE", message: "Outline read failed" }));
    __setQueryData("seeds:getSubsection", undefined);
    __setQueryError("seeds:getSubsection", new ConvexError({ code: "INVALID_STATE", message: "Subsection read failed" }));
    await expect.element(page.getByRole("alert")).toHaveTextContent("The Seed workspace could not load.");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getOutline")).toContainEqual("skip");

    // The Outline recovers first. The Subsection resubscription is still
    // pending (no error, no result): the stable wrapper only holds the
    // retained DTO, which is readable but decides nothing.
    __setQueryError("seeds:getSubsection", undefined);
    __setQueryData("seeds:getOutline", outline());
    const pending = () => document.querySelector<HTMLElement>("[data-subsection-read-pending]");
    await expect.poll(() => pending()?.textContent ?? "").toContain("Waiting for the live read of Company / Context.");
    await expect.element(page.getByText("The control loop stabilized output.", { exact: true })).toBeVisible();
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    for (const name of ["Edit", "Save wording", "Give feedback", "Regenerate", "Confirm and approve", "Approve"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    await expect.element(page.getByRole("checkbox", { name: "Deselect seed" })).toBeDisabled();
    await expect.element(page.getByText(/Editing is paused until the live read of this subsection returns/)).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(__mutationCalls("seeds:edit")).toEqual([]);
    expect(__mutationCalls("seeds:select")).toEqual([]);
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Draft kept through resubscription.");

    // The current Subsection result returns: decisions and the draft come back.
    __setQueryData("seeds:getSubsection", subsection());
    await expect.poll(() => pending()).toBeNull();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await expect.element(bullet).toHaveValue("Draft kept through resubscription.");
    await expect.element(page.getByRole("checkbox", { name: "Deselect seed" })).toBeEnabled();
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      bullets: ["Draft kept through resubscription.", "Tests covered three load bands."],
      expectedSeedStageVersion: 7,
    })]);
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(1);
  });

  it("does not record a retained Batch that becomes visible during a read failure, and records it once after recovery", async () => {
    await page.viewport(390, 844);
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ shownBatchId: null }));
    const { container } = await render(SeedWorkspace, workspaceProps());
    container.style.width = "390px";
    container.style.height = "844px";
    await expect.element(page.getByText("The control loop stabilized output.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Outline", exact: true }).click();
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();

    // A Batch arrives under the hidden Work pane, then the live read fails
    // while that Batch is retained and still unrecorded.
    __setQueryData("seeds:getSubsection", subsection({ shownBatchId: "batch-retained" as Id<"seedBatches"> }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([]);
    __setQueryData("seeds:getSubsection", undefined);
    __setQueryError("seeds:getSubsection", new ConvexError({ code: "INVALID_STATE", message: "Subsection read failed" }));
    await page.getByRole("button", { name: "Work", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-subsection-read-error]")?.textContent ?? "").toContain("Subsection read failed");
    await expect.element(page.getByText("The control loop stabilized output.", { exact: true })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([]);

    // A successful current read of the same displayed Batch records the
    // eligible view once.
    __setQueryData("seeds:getSubsection", subsection({ shownBatchId: "batch-retained" as Id<"seedBatches"> }));
    const viewed = { generationId, roleId: "company_context", batchId: "batch-retained", expectedSeedStageVersion: 7 };
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([viewed]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([viewed]);
  });

  it("suspends a viewed retry while the read fails during its delay and records after a successful recovery", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    let refuse: ((reason: unknown) => void) | undefined;
    __setMutationResult("seeds:markBatchViewed", new Promise((_resolve, reject) => { refuse = reject; }));
    await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    // The live read fails before the refused attempt's retry delay ends: the
    // retry finds no current read and stops without mutating.
    __setQueryData("seeds:getSubsection", undefined);
    __setQueryError("seeds:getSubsection", new ConvexError({ code: "INVALID_STATE", message: "Subsection read failed" }));
    await expect.poll(() => document.querySelector("[data-subsection-read-error]")?.textContent ?? "").toContain("Subsection read failed");
    __setMutationResult("seeds:markBatchViewed", null);
    refuse?.(new ConvexError({ code: "INVALID_STATE", message: "Temporarily refused" }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    // Successful recovery re-establishes eligibility without losing the event.
    __setQueryData("seeds:getSubsection", subsection());
    const viewed = { generationId, roleId: "company_context", batchId: "batch-1", expectedSeedStageVersion: 7 };
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([viewed, viewed]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([viewed, viewed]);
  });

  it("adjusts the split by pointer within bounds, and ignores movement after release, cancellation or destruction", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    const view = await render(SeedWorkspace, workspaceProps());
    view.container.style.width = "1000px";
    view.container.style.height = "800px";
    const splitter = page.getByRole("slider", { name: "Resize Seed outline" });
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "32");
    const splitterElement = splitter.element() as HTMLElement;
    const host = splitterElement.parentElement!;
    const rect = host.getBoundingClientRect();
    const pointer = (type: string, fraction: number, pointerId = 7) =>
      new PointerEvent(type, {
        pointerId,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: rect.left + rect.width * fraction,
        clientY: rect.top + 40,
        bubbles: true,
        cancelable: true,
      });
    const storedRatio = () => Number(localStorage.getItem("seeds.splitRatio"));

    splitterElement.dispatchEvent(pointer("pointerdown", 0.32));
    window.dispatchEvent(pointer("pointermove", 0.4));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "40");
    expect(storedRatio()).toBeCloseTo(0.4, 5);
    window.dispatchEvent(pointer("pointermove", 0.1));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "24");
    expect(localStorage.getItem("seeds.splitRatio")).toBe("0.24");
    window.dispatchEvent(pointer("pointermove", 0.9));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "55");
    expect(localStorage.getItem("seeds.splitRatio")).toBe("0.55");
    // Another pointer's movement never adjusts this gesture.
    window.dispatchEvent(pointer("pointermove", 0.3, 9));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "55");

    // Release completes the gesture: later movement is inert.
    window.dispatchEvent(pointer("pointerup", 0.9));
    window.dispatchEvent(pointer("pointermove", 0.4));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "55");
    expect(localStorage.getItem("seeds.splitRatio")).toBe("0.55");

    // Pointer cancellation ends the gesture the same way.
    splitterElement.dispatchEvent(pointer("pointerdown", 0.55));
    window.dispatchEvent(pointer("pointermove", 0.3));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "30");
    expect(storedRatio()).toBeCloseTo(0.3, 5);
    window.dispatchEvent(pointer("pointercancel", 0.3));
    window.dispatchEvent(pointer("pointermove", 0.45));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "30");
    expect(storedRatio()).toBeCloseTo(0.3, 5);

    // Keyboard control is unaffected by the pointer lifecycle.
    await splitter.click();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "32");

    // Destruction mid-gesture releases the listeners: movement afterwards
    // writes no preference.
    splitterElement.dispatchEvent(pointer("pointerdown", 0.32));
    localStorage.removeItem("seeds.splitRatio");
    view.unmount();
    window.dispatchEvent(pointer("pointermove", 0.5));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(localStorage.getItem("seeds.splitRatio")).toBeNull();
  });

  it("qualifies a truncated projection's selected count until the complete server review supplies its own, and invalidates that count with its scope", async () => {
    const completeHistory = { page: [], isDone: true, continueCursor: "done", truncated: false, budget };
    const twoCardProjection = () => [
      seed(),
      seed({ seedId: "seed-2" as Id<"seeds">, selected: false, bullets: ["An unselected Seed."] }),
    ];
    __setQueryData("seeds:listBatches", completeHistory);
    __setQueryData("seeds:getApprovalReview", { ...historyReview("count-challenge"), selectedCount: 3 });
    const view = await render(SeedSubsectionPane, paneProps(subsection({
      truncated: true,
      approvalChallenge: null,
      items: twoCardProjection(),
    })));
    const count = () => document.querySelector<HTMLElement>("[data-selected-count]");
    // The projection shows one selected card; the complete decision holds three.
    expect(count()?.dataset.selectedCount).toBe("partial");
    expect(count()?.textContent).toContain("1+ selected in the shown Seeds");
    expect(count()?.textContent).toContain("complete count pending");
    expect(document.body.textContent).not.toContain("3 selected");

    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.poll(() => count()?.dataset.selectedCount).toBe("complete");
    expect(count()?.textContent).toBe("3 selected");

    // A failed replacement review invalidates the server count until a retry succeeds.
    __setQueryData("seeds:listBatches", rejecting(new ConvexError({ code: "INVALID_STATE", message: "History read failed" })));
    await page.getByRole("button", { name: "Refresh Batch history", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("History read failed");
    await expect.poll(() => count()?.dataset.selectedCount).toBe("partial");
    expect(count()?.textContent).toContain("1+ selected in the shown Seeds");
    __setQueryData("seeds:listBatches", completeHistory);
    await page.getByRole("button", { name: "Retry Batch history", exact: true }).click();
    await expect.poll(() => count()?.dataset.selectedCount).toBe("complete");
    expect(count()?.textContent).toBe("3 selected");

    // A new decision version is a new scope: the previous review count no longer applies.
    await view.rerender(paneProps(subsection({
      seedStageVersion: 8,
      truncated: true,
      approvalChallenge: null,
      items: twoCardProjection(),
    })));
    await expect.poll(() => count()?.dataset.selectedCount).toBe("partial");
    expect(count()?.textContent).toContain("1+ selected in the shown Seeds");

    // An untruncated projection is the complete decision count.
    await view.rerender(paneProps(subsection({
      items: [seed(), seed({ seedId: "seed-2" as Id<"seeds">, selected: true })],
    })));
    await expect.poll(() => count()?.textContent).toBe("2 selected");
    expect(count()?.dataset.selectedCount).toBe("complete");
  });

  /** An Outline whose listed roles have no Batch yet, so opening them dispatches. */
  function untouchedOutline(roleIds: string[], overrides: Record<string, unknown> = {}) {
    const base = outline();
    return {
      ...base,
      rows: base.rows.map((row) =>
        roleIds.includes(row.roleId) ? { ...row, state: "untouched", selectedCount: 0, previewLines: [], shownBatchId: null } : row
      ),
      ...overrides,
    };
  }
  const untouchedSubsection = (roleId: SeedSubsectionData["roleId"], owner: Id<"generations"> = generationId) =>
    subsection({ generationId: owner, roleId, state: "untouched", items: [], shownBatchId: null, approvalChallenge: null });
  const openRefusal = () => document.querySelector<HTMLElement>("[data-open-refusal]");
  const outlineRole = (name: RegExp) => page.getByRole("navigation", { name: "PD subsections" }).getByRole("button", { name });
  const openCall = (roleId: string, expectedSeedStageVersion: number, owner: Id<"generations"> = generationId) =>
    expect.objectContaining({ generationId: owner, roleId, expectedSeedStageVersion });

  it("publishes a refused Subsection open only for the role and request that submitted it, and retries the current failure against the current version", async () => {
    __setQueryData("seeds:getOutline", untouchedOutline(["company_context", "goal_problem"]));
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "company_context" }, untouchedSubsection("company_context"));
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "goal_problem" }, untouchedSubsection("goal_problem"));
    // Role A's automatic open is refused late.
    let refuseA: ((reason: unknown) => void) | undefined;
    __setMutationResult("seeds:open", new Promise((_resolve, reject) => { refuseA = reject; }));
    await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:open")).toEqual([openCall("company_context", 7)]);

    // The writer opens role B, whose own open succeeds; A's refusal then
    // arrives and must not reach B's surface.
    __setMutationResult("seeds:open", null);
    await outlineRole(/Goal \/ Problem/).click();
    await expect.poll(() => __mutationCalls("seeds:open")).toHaveLength(2);
    refuseA?.(new ConvexError({ code: "INVALID_STATE", message: "Role A open refused late" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(openRefusal()).toBeNull();
    expect(document.body.textContent).not.toContain("Role A open refused late");
    await expect.element(page.getByRole("heading", { name: "Goal / Problem", exact: true })).toBeVisible();

    // A current refusal for the displayed role is announced with a Retry
    // that resubmits against the current capability and stage version.
    __setMutationError("seeds:open", new ConvexError({ code: "STALE_REVISION", message: "Seed decisions changed; refresh and retry" }));
    await outlineRole(/Company \/ Context/).click();
    await expect.poll(() => openRefusal()?.dataset.openRefusal).toBe("company_context");
    expect(openRefusal()?.getAttribute("role")).toBe("alert");
    expect(openRefusal()?.textContent).toContain("Seed decisions changed; refresh and retry");
    __setQueryData("seeds:getOutline", untouchedOutline(["company_context", "goal_problem"], { seedStageVersion: 8 }));
    __setMutationResult("seeds:open", null);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => openRefusal()).toBeNull();
    expect(__mutationCalls("seeds:open")).toEqual([
      openCall("company_context", 7),
      openCall("goal_problem", 7),
      openCall("company_context", 7),
      openCall("company_context", 8),
    ]);
  });

  it("drops a late refusal of an earlier open of the same role once a newer open of that role was submitted", async () => {
    __setQueryData("seeds:getOutline", untouchedOutline(["company_context", "goal_problem"]));
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "company_context" }, untouchedSubsection("company_context"));
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "goal_problem" }, untouchedSubsection("goal_problem"));
    let refuseFirst: ((reason: unknown) => void) | undefined;
    __setMutationResult("seeds:open", new Promise((_resolve, reject) => { refuseFirst = reject; }));
    await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:open")).toHaveLength(1);

    // A → B → A: the second open of role A succeeds; the first one's refusal
    // arrives afterwards while role A is displayed, and is obsolete.
    __setMutationResult("seeds:open", null);
    await outlineRole(/Goal \/ Problem/).click();
    await outlineRole(/Company \/ Context/).click();
    await expect.poll(() => __mutationCalls("seeds:open")).toEqual([
      openCall("company_context", 7),
      openCall("goal_problem", 7),
      openCall("company_context", 7),
    ]);
    refuseFirst?.(new ConvexError({ code: "INVALID_STATE", message: "First open refused late" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(page.getByRole("heading", { name: "Company / Context", exact: true })).toBeVisible();
    expect(openRefusal()).toBeNull();
    expect(document.body.textContent).not.toContain("First open refused late");
  });

  it("publishes no obsolete open refusal after the owner is replaced or the workspace is destroyed", async () => {
    __setQueryData("seeds:getOutline", untouchedOutline(["company_context"]));
    __setQueryDataForArgs("seeds:getOutline", { generationId: otherGenerationId }, untouchedOutline(["company_context"], { generationId: otherGenerationId }));
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "company_context" }, untouchedSubsection("company_context"));
    __setQueryDataForArgs("seeds:getSubsection", { generationId: otherGenerationId, roleId: "company_context" }, untouchedSubsection("company_context", otherGenerationId));

    // Owner replacement: generation A's open is still pending when the
    // workspace moves to generation B, which displays the same role.
    let refuseOld: ((reason: unknown) => void) | undefined;
    __setMutationResult("seeds:open", new Promise((_resolve, reject) => { refuseOld = reject; }));
    const view = await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:open")).toEqual([openCall("company_context", 7)]);
    __setMutationResult("seeds:open", null);
    await view.rerender(workspaceProps({ generationId: otherGenerationId }));
    await expect.poll(() => __mutationCalls("seeds:open")).toEqual([
      openCall("company_context", 7),
      openCall("company_context", 7, otherGenerationId),
    ]);
    refuseOld?.(new ConvexError({ code: "INVALID_STATE", message: "Previous owner's open refused" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(page.getByRole("heading", { name: "Company / Context", exact: true })).toBeVisible();
    expect(openRefusal()).toBeNull();
    expect(document.body.textContent).not.toContain("Previous owner's open refused");
    view.unmount();

    // Destruction: the workspace is gone before its open is refused; the
    // recreated workspace of the same owner shows only its own outcome.
    document.body.innerHTML = "";
    let refuseDestroyed: ((reason: unknown) => void) | undefined;
    __setMutationResult("seeds:open", new Promise((_resolve, reject) => { refuseDestroyed = reject; }));
    const destroyed = await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:open")).toHaveLength(3);
    destroyed.unmount();
    __setMutationResult("seeds:open", null);
    await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => __mutationCalls("seeds:open")).toHaveLength(4);
    refuseDestroyed?.(new ConvexError({ code: "INVALID_STATE", message: "Destroyed workspace's open refused" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(page.getByRole("heading", { name: "Company / Context", exact: true })).toBeVisible();
    expect(openRefusal()).toBeNull();
    expect(document.body.textContent).not.toContain("Destroyed workspace's open refused");
  });

  it("hands narrow focus to a late Subsection heading only within its own live workspace", async () => {
    await page.viewport(390, 844);
    const hypothesis = subsection({
      roleId: "hypothesis",
      items: [seed({ seedId: "seed-h" as Id<"seeds">, roleId: "hypothesis", bullets: ["Hypothesis Seed wording."] })],
      shownBatchId: "batch-h" as Id<"seedBatches">,
    });
    const chooseHypothesis = async (container: HTMLElement) => {
      container.style.width = "390px";
      container.style.height = "844px";
      await page.getByRole("button", { name: "Outline", exact: true }).click();
      (outlineRole(/Hypothesis/).element() as HTMLElement).focus();
      await userEvent.keyboard("{Enter}");
      // The Subsection has not arrived: focus holds on the displayed Work pane.
      await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Seed work");
    };
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "hypothesis" }, undefined);

    // Its own late heading: the handoff completes.
    const first = await render(SeedWorkspace, workspaceProps());
    await chooseHypothesis(first.container);
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "hypothesis" }, hypothesis);
    await expect.poll(() => document.activeElement?.id).toBe("seed-title-hypothesis");
    first.unmount();

    // The workspace is destroyed and a replacement mounted between the
    // handoff's scheduling and its callback: the obsolete callback must not
    // focus the replacement page's identical heading.
    document.body.innerHTML = "";
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "hypothesis" }, undefined);
    const doomed = await render(SeedWorkspace, workspaceProps());
    await chooseHypothesis(doomed.container);
    let replacement: ReturnType<typeof render> | undefined;
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "hypothesis" }, hypothesis);
    queueMicrotask(() => {
      void doomed.unmount();
      replacement = render(SeedWorkspace, workspaceProps());
    });
    await expect.poll(() => replacement).toBeDefined();
    const { container } = await replacement!;
    container.style.width = "390px";
    container.style.height = "844px";
    await expect.element(page.getByText("Hypothesis Seed wording.", { exact: true })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.getElementById("seed-title-hypothesis")).not.toBeNull();
    expect(document.activeElement?.id).not.toBe("seed-title-hypothesis");
    expect(document.activeElement).toBe(document.body);
  });
});
