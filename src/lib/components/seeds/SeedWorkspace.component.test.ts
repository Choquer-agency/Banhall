import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRawSnippet } from "svelte";
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
import { reactiveValue } from "$lib/test/reactiveValue.svelte";
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
    pendingBatch: null,
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

/** Opens the step header More menu and picks one of its actions (decision 19). */
async function stepMenu(action: "Batch history" | "Skip step" | "Restore step" | "Brief") {
  await page.getByRole("button", { name: "More step actions", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

/** Opens a card's feedback menu and picks a row. */
async function feedbackMenu(row: string, card = page.getByRole("button", { name: "Give feedback", exact: true }).first()) {
  await card.click();
  await page.getByRole("menuitem", { name: row, exact: true }).click();
}

const quotesButton = () => page.getByRole("button", { name: /^Quoted lines/ });
const outlineSwitch = () => page.getByRole("button", { name: /^Outline/ });
const seedsSwitch = () => page.getByRole("button", { name: "Seeds", exact: true });

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
    // The active Outline row is a primary-wash fill with ink text, one line.
    const activeRow = container.querySelector<HTMLElement>('nav[aria-label="PD subsections"] button[aria-current="step"]')!;
    expect(getComputedStyle(activeRow).backgroundColor).toBe("rgb(241, 250, 249)");
    expect(getComputedStyle(activeRow).height).toBe("34px");
    expect(activeRow.querySelector("[data-row-icon]")?.getAttribute("data-row-icon")).toBe("open");

    // R3-12 and decision 19: the value is the Outline's width in pixels,
    // adjusted with Left/Right, Home and End between 240 and 400, default 300,
    // and the control keeps focus.
    const splitter = page.getByRole("slider", { name: "Resize Seed outline" });
    await expect.element(splitter).toHaveAttribute("aria-orientation", "horizontal");
    await expect.element(splitter).toHaveAttribute("aria-valuemin", "240");
    await expect.element(splitter).toHaveAttribute("aria-valuemax", "400");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "300");
    const outlineElement = container.querySelector<HTMLElement>('[aria-label="Seed outline"]')!.parentElement!;
    expect(Math.round(outlineElement.getBoundingClientRect().width)).toBe(300);
    await splitter.click();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "290");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "300");
    await userEvent.keyboard("{Home}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "240");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "240");
    expect(localStorage.getItem("seeds.outlineWidth")).toBe("240");
    await userEvent.keyboard("{End}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "400");
    expect(localStorage.getItem("seeds.outlineWidth")).toBe("400");
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "400");
    expect(document.activeElement).toBe(splitter.element());
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "390");
    await userEvent.keyboard("{Home}");
    await userEvent.keyboard("{End}");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "300");

    await workspace.screenshot({
      path: await captures.path("seed-workspace-desktop-initial"),
    });
    const desktopScrollOwner = Array.from(container.querySelectorAll<HTMLElement>(".overflow-y-auto"))
      .find((element) => element.offsetParent !== null && element.scrollHeight > element.clientHeight)!;
    // Approval is pinned in the Outline footer while the cards scroll.
    const actionFooter = container.querySelector<HTMLElement>("[data-outline-footer]")!;
    await expect.element(page.elementLocator(actionFooter).getByRole("button", { name: "Approve and continue", exact: true })).toBeVisible();
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
    await expect.element(seedsSwitch()).toHaveAttribute("aria-pressed", "true");
    await expect.element(outlineSwitch()).toHaveTextContent("Outline 0 / 13");
    await outlineSwitch().click();
    await expect.element(outlineSwitch()).toHaveAttribute("aria-pressed", "true");
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
    await seedsSwitch().click();
    expect(getComputedStyle(outlinePane).display).toBe("none");
    expect(getComputedStyle(workPane).display).toBe("flex");
    const bottomBar = container.querySelector<HTMLElement>("[data-seed-bottom-bar]")!;
    const scrollOwner = Array.from(container.querySelectorAll<HTMLElement>(".overflow-y-auto"))
      .find((element) => element.offsetParent !== null && element.scrollHeight > element.clientHeight)!;
    expect(scrollOwner).toBeDefined();
    const documentScroll = window.scrollY;
    scrollOwner.scrollTop = scrollOwner.scrollHeight;
    await Promise.resolve();
    expect(window.scrollY).toBe(documentScroll);
    expect(bottomBar.getBoundingClientRect().bottom).toBeLessThanOrEqual(container.getBoundingClientRect().bottom + 1);
    await expect.element(seedsSwitch()).toHaveAttribute("aria-pressed", "true");
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

    // A carried or exclusion-matching selection needs the exact
    // acknowledgment before "Approve and continue" is available.
    const approve = page.getByRole("button", { name: "Approve and continue", exact: true });
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
    for (const name of ["Edit", "Give feedback", "Regenerate", "Approve and continue", "Confirm and approve"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
  });

  it("names a cut-off transcript analysis as soon as it fails and retries it (owner decision 32)", async () => {
    __setQueryData("seeds:getOutline", {
      ...outline(),
      draftingInputs: { status: "failed", failureCode: "output_limit" },
    });
    __setQueryData("seeds:getSubsection", subsection());
    __setMutationResult("generations:retryDraftingInputs", null);
    await render(SeedWorkspace, workspaceProps());

    const notice = () => document.querySelector<HTMLElement>("[data-workspace-drafting-inputs=failed]");
    await expect.poll(() => notice()?.textContent).toContain(
      "The transcript analysis was too long to finish. Your work is saved. Try again to run a shorter analysis before you sign off."
    );
    expect(
      document.querySelector("[data-workspace-drafting-inputs-announcement]")?.textContent
    ).toContain("The transcript analysis was too long to finish.");
    document.querySelector<HTMLButtonElement>("[data-workspace-drafting-retry]")?.click();
    await expect.poll(() => __mutationCalls("generations:retryDraftingInputs")).toEqual([{ generationId }]);

    // The retry is running: the notice goes away.
    __setQueryData("seeds:getOutline", { ...outline(), draftingInputs: { status: "preparing" } });
    await expect.poll(() => notice()).toBeNull();
  });

  it("names any other analysis failure plainly, shows a refused retry, and offers no retry without edit access", async () => {
    __setQueryData("seeds:getOutline", {
      ...outline(),
      draftingInputs: { status: "failed", failureCode: "network" },
    });
    __setQueryData("seeds:getSubsection", subsection());
    __setMutationError("generations:retryDraftingInputs", new ConvexError({
      code: "INVALID_STATE",
      message: "The transcript analysis has not failed, so there is nothing to try again",
    }));
    const view = await render(SeedWorkspace, workspaceProps());
    const notice = () => document.querySelector<HTMLElement>("[data-workspace-drafting-inputs=failed]");
    await expect.poll(() => notice()?.textContent).toContain(
      "We couldn't finish reading the transcript for drafting. Your work is saved. Try again before you sign off."
    );
    document.querySelector<HTMLButtonElement>("[data-workspace-drafting-retry]")?.click();
    await expect.poll(() => notice()?.querySelector('[role="alert"]')?.textContent).toContain(
      "The transcript analysis has not failed, so there is nothing to try again"
    );
    view.unmount();

    __setQueryData("seeds:getOutline", {
      ...outline(false),
      draftingInputs: { status: "failed", failureCode: "network" },
    });
    await render(SeedWorkspace, workspaceProps());
    // A viewer gets a plain status, not an instruction they cannot follow.
    await expect.poll(() => notice()?.textContent?.trim()).toBe(
      "We couldn't finish reading the transcript for drafting. It needs another try before sign-off."
    );
    expect(notice()?.textContent).not.toContain("Try again");
    expect(document.querySelector("[data-workspace-drafting-retry]")).toBeNull();
  });

  it("shows no analysis notice while it is preparing or ready", async () => {
    __setQueryData("seeds:getOutline", { ...outline(), draftingInputs: { status: "preparing" } });
    __setQueryData("seeds:getSubsection", subsection());
    await render(SeedWorkspace, workspaceProps());
    await expect.element(page.getByRole("region", { name: "Seed workspace" })).toBeVisible();
    expect(document.querySelector("[data-workspace-drafting-inputs]")).toBeNull();
  });

  it("announces an analysis failure through a live region that was already on the page", async () => {
    __setQueryData("seeds:getOutline", { ...outline(), draftingInputs: { status: "preparing" } });
    __setQueryData("seeds:getSubsection", subsection());
    await render(SeedWorkspace, workspaceProps());
    await expect.element(page.getByRole("region", { name: "Seed workspace" })).toBeVisible();
    const announcement = document.querySelector<HTMLElement>("[data-workspace-drafting-inputs-announcement]");
    expect(announcement?.getAttribute("aria-live")).toBe("polite");
    expect(announcement?.textContent).toBe("");

    __setQueryData("seeds:getOutline", {
      ...outline(),
      draftingInputs: { status: "failed", failureCode: "network" },
    });
    await expect.poll(() => announcement?.textContent).toBe(
      "We couldn't finish reading the transcript for drafting. Your work is saved. Try again before you sign off."
    );
    // The same node, not a new one inserted with its text.
    expect(document.querySelector("[data-workspace-drafting-inputs-announcement]")).toBe(announcement);
    // The visible notice is not a second live region, so it is not read twice.
    expect(document.querySelector("[data-workspace-drafting-inputs=failed]")?.getAttribute("role")).toBeNull();
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
    // Quotes no bullet underlines (an edited or paraphrased seed) stay
    // reachable with their source under the card's "Quoted lines" control.
    await quotesButton().nth(1).click();
    await expect.poll(() => document.body.textContent).toContain("Archived source excerpt one.");
    await userEvent.keyboard("{Escape}");
    await quotesButton().nth(2).click();
    await expect.poll(() => document.body.textContent).toContain("Archived source excerpt two.");
    await userEvent.keyboard("{Escape}");
    expect(page.getByText("Available from full history", { exact: true }).elements()).toHaveLength(2);
    await page.getByRole("checkbox", { name: "Select seed", exact: true }).last().click();
    expect(__mutationCalls("seeds:select")).toContainEqual({
      generationId,
      roleId: "company_context",
      seedId: "seed-old-2",
      selected: true,
      expectedSeedStageVersion: 7,
    });
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
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
    await page.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    await page.getByRole("textbox", { name: "Tell it what to change" }).fill("Focus on measured stability.");
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("button", { name: "Withdraw feedback", exact: true }).click();
    await page.getByRole("button", { name: "Regenerate", exact: true }).click();
    await stepMenu("Skip step");

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
    await stepMenu("Restore step");
    expect(__mutationCalls("seeds:unskip")[0]).toMatchObject({ roleId: "prior_year_status", expectedSeedStageVersion: 7 });
  });

  it("says an empty step's last attempt failed and offers a fresh try, and keeps the plain empty text otherwise", async () => {
    const empty = { state: "untouched" as const, items: [], shownBatchId: null, approvalChallenge: null };
    const view = await render(SeedSubsectionPane, paneProps(subsection({ ...empty, lastAttemptFailed: true })));
    await expect.element(page.getByText("Writing seeds for this step failed.")).toBeVisible();
    await expect.element(page.getByText("No seeds are available yet.")).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    expect(__mutationCalls("seeds:regenerate")[0]).toMatchObject({ roleId: "company_context", expectedSeedStageVersion: 7 });

    await view.rerender(paneProps(subsection(empty)));
    await expect.element(page.getByText("No seeds are available yet.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try again", exact: true })).not.toBeInTheDocument();
  });

  it("says a failed attempt on a step that shows seeds failed, above the previous seeds (review s1 P3-5)", async () => {
    const shown = subsection();
    expect(shown.items.length).toBeGreaterThan(0);
    const view = await render(SeedSubsectionPane, paneProps({ ...shown, lastAttemptFailed: true }));
    await expect.element(page.getByText("The last attempt failed. Showing the previous seeds.")).toBeVisible();
    await expect.element(page.getByText("Writing seeds for this step failed.")).not.toBeInTheDocument();

    await view.rerender(paneProps(shown));
    await expect.element(page.getByText("The last attempt failed. Showing the previous seeds.")).not.toBeInTheDocument();
  });

  it("rechecks edit capability at dispatch, so a revocation landing before an interaction dispatches sends nothing (A3, R6-08)", async () => {
    __setQueryData("seeds:listBatches", {
      page: [{
        batch: { _id: "batch-old-1", operation: "initial", status: "superseded" },
        seeds: [historicalSeed("seed-old-1", "Old original.", "Old history wording.", "Old excerpt.")],
      }],
      isDone: true,
      continueCursor: "done",
      truncated: false,
      budget,
    });
    const capability = reactiveValue(true);
    const onDraftChange = vi.fn();
    const withCapability = (props: Record<string, unknown>) =>
      Object.defineProperty(props, "canEdit", { get: () => capability.value, enumerable: true, configurable: true });
    const feedbackGroup = {
      requestId: "feedback-1" as Id<"seedFeedbackRequests">,
      targetSeedId: "seed-1" as Id<"seeds">,
      targetWording: ["The control loop stabilized output."],
      instruction: "Make the evidence more specific.",
      status: "active" as const,
      batchId: null,
      revisedSeedIds: [],
    };
    const optional = { title: "Previous-year status", objective: "Describe prior-year status.", kind: "optional", onDraftChange };
    const view = await render(SeedSubsectionPane, withCapability(paneProps(subsection({
      roleId: "prior_year_status",
      items: [seed({ roleId: "prior_year_status", edited: true })],
      feedbackGroups: [feedbackGroup],
    }), optional)));
    await stepMenu("Batch history");
    await expect.element(page.getByText("Old history wording.", { exact: true })).toBeVisible();

    // The capability changes without a flush, so the click still reaches the
    // control the pane rendered while the writer could edit.
    async function revokeThenDispatch(control: () => ReturnType<typeof page.getByRole>, open?: () => Promise<void>) {
      capability.value = true;
      await open?.();
      await expect.element(control()).toBeVisible();
      const element = control().element() as HTMLElement;
      capability.value = false;
      element.click();
      await expect.poll(() => control().elements()).toHaveLength(0);
    }
    await revokeThenDispatch(() => page.getByRole("button", { name: "Restore original wording", exact: true }));
    await revokeThenDispatch(() => page.getByRole("button", { name: "Withdraw feedback", exact: true }));
    await revokeThenDispatch(() => page.getByRole("button", { name: "Regenerate", exact: true }));
    await revokeThenDispatch(() => page.getByRole("button", { name: "Restore this Batch", exact: true }));
    await revokeThenDispatch(
      () => page.getByRole("menuitem", { name: "Skip step", exact: true }),
      () => page.getByRole("button", { name: "More step actions", exact: true }).click()
    );
    view.unmount();

    await render(SeedSubsectionPane, withCapability(paneProps(
      subsection({ roleId: "prior_year_status", state: "skipped", items: [] }),
      optional
    )));
    await revokeThenDispatch(
      () => page.getByRole("menuitem", { name: "Restore step", exact: true }),
      () => page.getByRole("button", { name: "More step actions", exact: true }).click()
    );

    for (const name of ["restoreWording", "withdrawFeedback", "regenerate", "retry", "restoreBatch", "skip", "unskip"]) {
      expect(__mutationCalls(`seeds:${name}`), name).toEqual([]);
    }
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("discards a history response when the role/version scope changes while it is loading", async () => {
    let release: ((value: unknown) => void) | undefined;
    const delayed = new Promise<unknown>((resolve) => { release = resolve; });
    __setQueryData("seeds:listBatches", delayed);
    const view = await render(SeedSubsectionPane, paneProps(subsection()));
    await stepMenu("Batch history");
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
    expect(page.getByRole("region", { name: "Batch history" }).elements()).toHaveLength(0);
  });

  it("discards a late history response when the generation changes at the same role and version", async () => {
    let release: ((value: unknown) => void) | undefined;
    const delayed = new Promise<unknown>((resolve) => { release = resolve; });
    __setQueryData("seeds:listBatches", delayed);
    const view = await render(SeedSubsectionPane, paneProps(subsection()));
    await stepMenu("Batch history");
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
    expect(page.getByRole("region", { name: "Batch history" }).elements()).toHaveLength(0);
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
    await expect.element(page.getByRole("button", { name: "Approve and continue", exact: true })).toBeDisabled();
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
    await expect.element(page.getByRole("button", { name: "Approve and continue", exact: true })).toBeDisabled();
  });

  it("stops a nonadvancing history cursor with a bounded refusal and keeps approval unavailable", async () => {
    __setQueryData("seeds:listBatches", {
      page: [], isDone: false, continueCursor: "stuck-cursor", truncated: true, budget,
    });
    await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    // Nonprogress is named as such, never blamed on the server's processing limit (R6-09).
    await expect.element(page.getByRole("alert")).toHaveTextContent(
      "Batch history stopped because the server kept returning the same page. The complete history cannot be shown, so approval stays unavailable while Seeds are omitted."
    );
    expect(document.body.textContent).not.toContain("processing limit");
    expect(__clientQueryCalls("seeds:listBatches")).toEqual([
      { generationId, roleId: "company_context", cursor: null, numItems: 20 },
      { generationId, roleId: "company_context", cursor: "stuck-cursor", numItems: 20 },
    ]);
    expect(__clientQueryCalls("seeds:getApprovalReview")).toEqual([]);
    await expect.element(page.getByText("History is incomplete.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Approve and continue", exact: true })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Retry Batch history", exact: true })).toBeEnabled();
  });

  it("attributes a history stop to the server's processing limit only when a history read is refused for it (R6-09)", async () => {
    const historyArgs = (cursor: string | null) => ({ generationId, roleId: "company_context", cursor, numItems: 20 });
    __setQueryDataForArgs("seeds:listBatches", historyArgs(null), {
      page: [{
        batch: { _id: "batch-before-refusal", operation: "initial", status: "superseded" },
        seeds: [historicalSeed("seed-before-refusal", "Loaded original.", "Loaded before the refusal.", "Loaded excerpt.")],
      }],
      isDone: false,
      continueCursor: "refused-page",
      truncated: false,
      budget,
    });
    __setQueryDataForArgs("seeds:listBatches", historyArgs("refused-page"), rejecting(new ConvexError({
      code: "INVALID_INPUT",
      reason: "SEED_PROCESSING_LIMIT",
      roleId: "company_context",
      message: "Batch history exceeds the read budget",
    })));
    __setQueryData("seeds:getApprovalReview", historyReview("must-not-be-requested"));
    await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent(
      "Batch history stopped because the server could not read it within its safe processing limit. The complete history cannot be shown, so approval stays unavailable while Seeds are omitted."
    );
    // A history refusal is not a refused approval decision.
    expect(document.body.textContent).not.toContain("complete approval decision");
    await expect.element(page.getByText("Loaded before the refusal.", { exact: true })).toBeVisible();
    expect(__clientQueryCalls("seeds:getApprovalReview")).toEqual([]);
    await expect.element(page.getByRole("button", { name: "Approve and continue", exact: true })).toBeDisabled();
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
    await expect.element(page.getByRole("button", { name: "Approve and continue", exact: true })).toBeEnabled();
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

    await page.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    await page.getByRole("textbox", { name: "Tell it what to change" }).fill("Name the measured load bands.");
    await view.rerender(paneProps(subsection({
      seedStageVersion: 9,
      items: [seed({ bullets: ["Remote wording from another session."] })],
    })));
    const request = page.getByRole("button", { name: "Send feedback", exact: true });
    await expect.element(request).toBeDisabled();
    await expect.element(page.getByRole("textbox", { name: "Tell it what to change" })).toHaveValue("Name the measured load bands.");
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

    await page.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    const instruction = page.getByRole("textbox", { name: "Tell it what to change" });
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

    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await instruction.fill("Keep the second Seed's instruction. Added while requesting.");
    finishFeedback?.(undefined);
    await expect.element(page.getByRole("button", { name: "Send feedback", exact: true })).toBeEnabled();
    await expect.element(instruction).toHaveValue("Keep the second Seed's instruction. Added while requesting.");
    expect(storedDrafts()["seed-2"].feedback?.instruction).toBe("Keep the second Seed's instruction. Added while requesting.");
  });

  it("never replays a failed obsolete cleanup: a later late save leaves newer wording and independent drafts intact (A2, R6-14)", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({
      items: [
        seed(),
        seed({ seedId: "seed-2" as Id<"seeds">, bullets: ["Second Seed wording."] }),
        seed({ seedId: "seed-3" as Id<"seeds">, bullets: ["Third Seed wording."] }),
      ],
    }));
    const cardElement = (seedId: string) => document.querySelector<HTMLElement>(`[data-seed-id="${seedId}"]`);
    async function card(seedId: string) {
      await expect.poll(() => cardElement(seedId)).not.toBeNull();
      return page.elementLocator(cardElement(seedId)!);
    }
    const pending = () => {
      let finish: ((value: unknown) => void) | undefined;
      const promise = new Promise((resolve) => { finish = resolve; });
      return { promise, finish: () => finish?.(undefined) };
    };
    async function editCard(seedId: string, wording: string) {
      await (await card(seedId)).getByRole("button", { name: "Edit", exact: true }).click();
      await (await card(seedId)).getByRole("textbox", { name: "Bullet 1" }).fill(wording);
    }

    // Two card saves are pending when the workspace is destroyed.
    const first = await render(SeedWorkspace, workspaceProps());
    const saveOne = pending();
    const saveTwo = pending();
    await editCard("seed-1", "Submitted one.");
    __setMutationResult("seeds:edit", saveOne.promise);
    await (await card("seed-1")).getByRole("button", { name: "Save wording", exact: true }).click();
    await editCard("seed-2", "Submitted two.");
    __setMutationResult("seeds:edit", saveTwo.promise);
    await (await card("seed-2")).getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.poll(() => __mutationCalls("seeds:edit")).toHaveLength(2);
    first.unmount();

    // The first late cleanup is refused by the device.
    const removeItem = Storage.prototype.removeItem;
    const refused = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === `${draftPrefix()}seed-1`) {
        refused.mockRestore();
        throw new DOMException("Storage refused", "QuotaExceededError");
      }
      return removeItem.call(this, key);
    });
    saveOne.finish();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Submitted one.");

    // The recreated workspace writes newer wording for seed 1 and an
    // independent draft for seed 3.
    // Its stored draft reopens seed 1 in edit mode.
    const second = await render(SeedWorkspace, workspaceProps());
    const one = await card("seed-1");
    await expect.element(one.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Submitted one.");
    await one.getByRole("textbox", { name: "Bullet 1" }).fill("Newer one after recreation.");
    await editCard("seed-3", "Independent three.");
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Newer one after recreation.");

    // Another old completion clears only its own unchanged snapshot.
    saveTwo.finish();
    await expect.poll(() => storedDrafts()["seed-2"]).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(storedDrafts()["seed-1"].edit?.bulletOne).toBe("Newer one after recreation.");
    expect(storedDrafts()["seed-3"].edit?.bulletOne).toBe("Independent three.");

    // A fresh recreation hydrates both exactly.
    second.unmount();
    await render(SeedWorkspace, workspaceProps());
    await expect.element((await card("seed-1")).getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Newer one after recreation.");
    await expect.element((await card("seed-3")).getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Independent three.");
    expect(storedDrafts()["seed-2"]).toBeUndefined();
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
    for (const name of ["Edit", "Give feedback", "Save wording", "Send feedback", "Regenerate", "Approve and continue", "Confirm and approve", "Restore original wording"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    expect(page.getByRole("textbox").elements()).toHaveLength(0);
    await expect.element(page.getByRole("checkbox", { name: "Deselect seed" })).toBeDisabled();
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([]);

    __setQueryData("seeds:getOutline", outline(true));
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Restored unsaved wording.");
    await expect.element(page.getByRole("textbox", { name: "Tell it what to change" })).toHaveValue("Restored instruction.");
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Typed before revocation.");

    __setQueryData("seeds:getOutline", outline(false));
    await expect.poll(() => page.getByRole("textbox").elements().length).toBe(0);
    for (const name of ["Save wording", "Send feedback", "Edit", "Give feedback"]) {
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

    // The Brief opens from the step header More menu (decision 19); the
    // menu's trigger is where focus returns.
    const trigger = page.getByRole("button", { name: "More step actions", exact: true });
    const triggerElement = trigger.element() as HTMLElement;
    triggerElement.focus();
    await userEvent.keyboard("{Enter}");
    const briefItem = page.getByRole("menuitem", { name: "Brief", exact: true });
    await expect.element(briefItem).toBeVisible();
    // Choosing the item: the menu's own roving focus makes keyboard landing
    // on a given item timing-dependent, so the test selects it directly.
    await briefItem.click();
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

    await stepMenu("Brief");
    // Close once the drawer has opened and taken focus, as a person would; a
    // close during the opening animation is not a supported interaction.
    await expect.poll(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false).toBe(true);
    // The drawer slides in from the right; click Close once it has stopped
    // moving, or the click can land where the button was a frame earlier.
    let lastLeft = Number.NaN;
    await expect.poll(() => {
      const left = document.querySelector('[role="dialog"]')?.getBoundingClientRect().left ?? Number.NaN;
      const settled = left === lastLeft;
      lastLeft = left;
      return settled;
    }).toBe(true);
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
    await outlineSwitch().click();
    const roleButton = page.getByRole("navigation", { name: "PD subsections" }).getByRole("button", { name: /Hypothesis/ });
    (roleButton.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");

    const heading = page.getByRole("heading", { name: "Hypothesis", exact: true });
    await expect.element(heading).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(heading.element());
    const focused = document.activeElement as HTMLElement;
    expect(focused.offsetParent).not.toBeNull();
    await expect.element(seedsSwitch()).toHaveAttribute("aria-pressed", "true");

    const outlineButton = outlineSwitch();
    (outlineButton.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(outlineButton).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();
    expect(document.activeElement).toBe(outlineButton.element());
  });

  it("names each frozen cited source beside its exact excerpt in cards and history", async () => {
    __setQueryData("seeds:getOutline", outline());
    // One citation is quoted word for word in the first bullet; the other is
    // not, so it stays under "Quoted lines".
    const quoted = { ...seed().provenance[0], _id: "provenance-quoted" as Id<"seedProvenance">, exactExcerpt: "the control loop stabilized output" };
    __setQueryData("seeds:getSubsection", subsection({ items: [seed({ provenance: [quoted, seed().provenance[0]] })] }));
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

    const underline = page.getByRole("button", { name: "The control loop stabilized output", exact: true });
    await underline.hover();
    const card = page.getByRole("group", { name: "Quoted line" });
    await expect.element(card).toBeVisible();
    await expect.element(card).toHaveTextContent("the control loop stabilized output");
    expect(document.querySelector("[data-quote-card] [data-quote-source]")?.textContent).toBe("Controller interview.docx");
    // Moving the pointer away (not into the card) closes it.
    await page.getByRole("heading", { name: "Company and context", exact: true }).hover();
    await expect.poll(() => document.querySelector("[data-quote-card]")).toBeNull();

    await quotesButton().click();
    const quotes = () => document.querySelector<HTMLElement>('[data-seed-quotes="seed-1"]');
    await expect.poll(() => quotes()?.querySelector("[data-quote-source]")?.textContent).toBe("Controller interview.docx");
    expect(quotes()?.querySelector("blockquote")?.textContent?.trim()).toBe("“Measured output remained stable.”");
    await userEvent.keyboard("{Escape}");

    await stepMenu("Batch history");
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
    expect(page.getByRole("button", { name: "Approve and continue", exact: true }).elements()).toHaveLength(0);
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
    await expect.element(page.getByRole("button", { name: "Approve and continue", exact: true })).toBeEnabled();
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
    // The client's own page bound is named as such (R6-09).
    await expect.element(page.getByRole("alert")).toHaveTextContent(
      "Batch history stopped after 200 pages, the most this view loads. The complete history cannot be shown, so approval stays unavailable while Seeds are omitted."
    );
    expect(document.body.textContent).not.toContain("processing limit");
    expect(__clientQueryCalls("seeds:listBatches")).toHaveLength(200);
    expect(__clientQueryCalls("seeds:getApprovalReview")).toEqual([]);
    await expect.element(page.getByText("History is incomplete.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Approve and continue", exact: true })).toBeDisabled();
    view.unmount();
  });

  it("invalidates a history-derived approval review when a replacement review fails, and restores it only after a successful retry", async () => {
    const completeHistory = { page: [], isDone: true, continueCursor: "done", truncated: false, budget };
    __setQueryData("seeds:listBatches", completeHistory);
    __setQueryData("seeds:getApprovalReview", historyReview("history-challenge"));
    await render(SeedSubsectionPane, paneProps(subsection({ truncated: true, approvalChallenge: null })));
    const approve = page.getByRole("button", { name: "Approve and continue", exact: true });
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
    const approve = page.getByRole("button", { name: "Approve and continue", exact: true });
    await expect.element(approve).toBeEnabled();
    await stepMenu("Batch history");
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
    // The fixture's excerpt is not quoted word for word, so it is listed
    // with its source under the card's "Quoted lines".
    await quotesButton().click();
    const caption = () => document.querySelector<HTMLElement>('[data-seed-quotes="seed-1"] [data-quote-source]');
    await expect.poll(() => caption()?.textContent).toBe("Source name loading…");
    expect(caption()?.dataset.attributed).toBe("false");

    __setQueryError("seeds:getSourceAttribution", new ConvexError({ code: "INVALID_STATE", message: "Attribution read failed" }));
    await expect.poll(() => caption()?.textContent).toBe("Source name unavailable");
    const notice = () => document.querySelector<HTMLElement>('[data-source-attribution="error"]');
    await expect.poll(() => notice()?.textContent ?? "").toContain("Source names could not be loaded.");
    await expect.element(page.getByText("“Measured output remained stable.”", { exact: true })).toBeVisible();

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-seed-quotes]")).toBeNull();
    await page.getByRole("button", { name: "Retry source names", exact: true }).click();
    await quotesButton().click();
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
    // The fixture's excerpt is not quoted word for word, so it is listed
    // with its source under the card's "Quoted lines".
    await quotesButton().click();
    const caption = () => document.querySelector<HTMLElement>('[data-seed-quotes="seed-1"] [data-quote-source]');
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
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-seed-quotes]")).toBeNull();
    await page.getByRole("button", { name: "Retry source names", exact: true }).click();
    await quotesButton().click();
    await expect.poll(() => __clientQueryCalls("seeds:getSourceAttributionByIds")).toHaveLength(2);
    await expect.poll(() => caption()?.textContent).toBe("Controller interview.docx");
    expect(caption()?.dataset.attributed).toBe("true");
    expect(notice()).toBeNull();
  });

  it("explains a successful but incomplete name recovery, offers an explicit retry, then shows the recovered attribution (A8, R6-16)", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    __setQueryData("seeds:getSourceAttribution", {
      generationId,
      sources: [{ sourceId: "source-other", label: "Other.docx", kind: "transcript" }],
      complete: false,
    });
    // The recovery read succeeds, but its own processing budget ran out
    // before it reached the requested source.
    __setQueryData("seeds:getSourceAttributionByIds", { generationId, sources: [], complete: false });
    await render(SeedWorkspace, workspaceProps());
    await quotesButton().click();
    const caption = () => document.querySelector<HTMLElement>('[data-seed-quotes="seed-1"] [data-quote-source]');
    await expect.poll(() => __clientQueryCalls("seeds:getSourceAttributionByIds")).toEqual([{ generationId, sourceIds: ["source-1"] }]);
    await expect.poll(() => caption()?.textContent).toBe("Source name not retrieved");
    expect(caption()?.dataset.attributed).toBe("false");
    const notice = () => document.querySelector<HTMLElement>('[data-source-attribution="incomplete"]');
    await expect.poll(() => notice()?.textContent ?? "").toContain(
      "Some source names could not be retrieved within the server's safe processing limit."
    );
    await expect.element(page.getByText("“Measured output remained stable.”", { exact: true })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__clientQueryCalls("seeds:getSourceAttributionByIds")).toHaveLength(1);

    __setQueryData("seeds:getSourceAttributionByIds", {
      generationId,
      sources: [{ sourceId: "source-1", label: "Controller interview.docx", kind: "transcript" }],
      complete: true,
    });
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-seed-quotes]")).toBeNull();
    await page.getByRole("button", { name: "Retry source names", exact: true }).click();
    await quotesButton().click();
    await expect.poll(() => __clientQueryCalls("seeds:getSourceAttributionByIds")).toHaveLength(2);
    await expect.poll(() => caption()?.textContent).toBe("Controller interview.docx");
    expect(caption()?.dataset.attributed).toBe("true");
    await expect.element(page.getByText("“Measured output remained stable.”", { exact: true })).toBeVisible();
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
    await outlineSwitch().click();
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();

    // A Batch arriving while the narrow Outline is displayed is not yet viewed.
    __setQueryData("seeds:getSubsection", subsection({ shownBatchId: "batch-arrived" as Id<"seedBatches"> }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([]);

    // Displaying Work records it, once.
    await seedsSwitch().click();
    const arrived = { generationId, roleId: "company_context", batchId: "batch-arrived", expectedSeedStageVersion: 7 };
    await expect.poll(() => __mutationCalls("seeds:markBatchViewed")).toEqual([arrived]);
    await outlineSwitch().click();
    await seedsSwitch().click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([arrived]);

    // A second Batch under the hidden Work pane waits for desktop visibility.
    await outlineSwitch().click();
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
    await outlineSwitch().click();
    __setMutationResult("seeds:markBatchViewed", null);
    refuse?.(new ConvexError({ code: "INVALID_STATE", message: "Temporarily refused" }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(__mutationCalls("seeds:markBatchViewed")).toHaveLength(1);

    await seedsSwitch().click();
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
    await page.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    await page.getByRole("textbox", { name: "Tell it what to change" }).fill("Instruction without storage.");
    await expect.element(bullet).toHaveValue("Typed without storage.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      bullets: ["Typed without storage.", "Tests covered three load bands."],
      expectedSeedStageVersion: 7,
    })]);
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);
    await expect.element(page.getByRole("textbox", { name: "Tell it what to change" })).toHaveValue("Instruction without storage.");

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
    await page.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    await page.getByRole("textbox", { name: "Tell it what to change" }).fill("Feedback in memory.");
    await expect.element(bullet).toHaveValue("Hydrated wording. Typed after storage failed.");

    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    // The hydrated draft's second bullet is empty, so one bullet is submitted.
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      bullets: ["Hydrated wording. Typed after storage failed."],
      expectedSeedStageVersion: 7,
    })]);
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);
    await expect.element(page.getByRole("textbox", { name: "Tell it what to change" })).toHaveValue("Feedback in memory.");
    // The saved Seed's own record was removed on its own key (removal is not
    // what the device refuses), the feedback draft was never mirrored, and no
    // other item's record was touched: the notice truthfully stays.
    expect(storedDrafts()["seed-1"]).toBeUndefined();
    expect(storedDrafts()["seed-2"]).toBeUndefined();
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("Unsaved Seed text stays in this open workspace only.");

    // Once the device accepts writes again, the next write mirrors every
    // pending item and the notice clears.
    vi.restoreAllMocks();
    await page.getByRole("textbox", { name: "Tell it what to change" }).fill("Feedback in memory, now mirrored.");
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
    await page.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    await page.getByRole("textbox", { name: "Tell it what to change" }).fill("Feedback queued first.");
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
    await page.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    await inB.getByRole("textbox", { name: "Tell it what to change" }).fill("Tab B instruction for seed two.");
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
    await expect.element(inC.getByRole("textbox", { name: "Tell it what to change" })).toHaveValue("Tab B instruction for seed two.");
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
    // The first row's count is a lower bound: "1+" on screen, "at least 1
    // selected, partial read" for assistive technology. Previews are gone
    // from the single-line rows, so no partial preview can pass as complete.
    const firstRow = () => document.querySelector<HTMLElement>('nav[aria-label="PD subsections"] button')!;
    expect(firstRow().querySelector("[data-counts-complete]")?.textContent).toBe("1+");
    expect(firstRow().querySelector("[data-counts-complete]")?.getAttribute("data-counts-complete")).toBe("false");
    expect(firstRow().textContent).toContain("approved, at least 1 selected, partial read");
    expect(view.container.textContent).not.toContain("Partial preview line");

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
    await expect.poll(() => firstRow().querySelector("[data-counts-complete]")?.textContent).toBe("1");
    expect(firstRow().textContent).toContain("approved, 1 selected");
    expect(view.container.textContent).not.toContain("partial read");
    expect(view.container.textContent).not.toContain("Readiness could not be fully computed");
    // One of thirteen steps is decided.
    expect(document.querySelector("[data-outline-progress]")?.textContent?.trim()).toBe("1 of 13");
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
    for (const name of ["Edit", "Save wording", "Give feedback", "Regenerate", "Confirm and approve", "Approve and continue"]) {
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
    for (const name of ["Edit", "Save wording", "Give feedback", "Regenerate", "Confirm and approve", "Approve and continue"]) {
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
    await outlineSwitch().click();
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();

    // A Batch arrives under the hidden Work pane, then the live read fails
    // while that Batch is retained and still unrecorded.
    __setQueryData("seeds:getSubsection", subsection({ shownBatchId: "batch-retained" as Id<"seedBatches"> }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(__mutationCalls("seeds:markBatchViewed")).toEqual([]);
    __setQueryData("seeds:getSubsection", undefined);
    __setQueryError("seeds:getSubsection", new ConvexError({ code: "INVALID_STATE", message: "Subsection read failed" }));
    await seedsSwitch().click();
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
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "300");
    const splitterElement = splitter.element() as HTMLElement;
    const host = splitterElement.parentElement!;
    const rect = host.getBoundingClientRect();
    // Pointer positions are pixels from the workspace's left edge, which is
    // where the Outline starts.
    const pointer = (type: string, offset: number, pointerId = 7) =>
      new PointerEvent(type, {
        pointerId,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
        clientX: rect.left + offset,
        clientY: rect.top + 40,
        bubbles: true,
        cancelable: true,
      });
    const storedWidth = () => localStorage.getItem("seeds.outlineWidth");

    splitterElement.dispatchEvent(pointer("pointerdown", 300));
    window.dispatchEvent(pointer("pointermove", 350));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "350");
    expect(storedWidth()).toBe("350");
    window.dispatchEvent(pointer("pointermove", 100));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "240");
    expect(storedWidth()).toBe("240");
    window.dispatchEvent(pointer("pointermove", 900));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "400");
    expect(storedWidth()).toBe("400");
    // Another pointer's movement never adjusts this gesture.
    window.dispatchEvent(pointer("pointermove", 280, 9));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "400");

    // Release completes the gesture: later movement is inert.
    window.dispatchEvent(pointer("pointerup", 900));
    window.dispatchEvent(pointer("pointermove", 320));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "400");
    expect(storedWidth()).toBe("400");

    // Pointer cancellation ends the gesture the same way.
    splitterElement.dispatchEvent(pointer("pointerdown", 400));
    window.dispatchEvent(pointer("pointermove", 300));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "300");
    expect(storedWidth()).toBe("300");
    window.dispatchEvent(pointer("pointercancel", 300));
    window.dispatchEvent(pointer("pointermove", 380));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "300");
    expect(storedWidth()).toBe("300");

    // Keyboard control is unaffected by the pointer lifecycle.
    (splitterElement as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(splitter).toHaveAttribute("aria-valuenow", "310");

    // Destruction mid-gesture releases the listeners: movement afterwards
    // writes no preference.
    splitterElement.dispatchEvent(pointer("pointerdown", 310));
    localStorage.removeItem("seeds.outlineWidth");
    view.unmount();
    window.dispatchEvent(pointer("pointermove", 360));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(localStorage.getItem("seeds.outlineWidth")).toBeNull();
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
    expect(count()?.textContent).toContain("1+ selected in the shown seeds");
    expect(count()?.textContent).toContain("complete count pending");
    expect(document.body.textContent).not.toContain("3 seeds selected");

    await page.getByRole("button", { name: "Load Batch history", exact: true }).click();
    await expect.poll(() => count()?.dataset.selectedCount).toBe("complete");
    expect(count()?.textContent).toBe("3 seeds selected");

    // A failed replacement review invalidates the server count until a retry succeeds.
    __setQueryData("seeds:listBatches", rejecting(new ConvexError({ code: "INVALID_STATE", message: "History read failed" })));
    await page.getByRole("button", { name: "Refresh Batch history", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("History read failed");
    await expect.poll(() => count()?.dataset.selectedCount).toBe("partial");
    expect(count()?.textContent).toContain("1+ selected in the shown seeds");
    __setQueryData("seeds:listBatches", completeHistory);
    await page.getByRole("button", { name: "Retry Batch history", exact: true }).click();
    await expect.poll(() => count()?.dataset.selectedCount).toBe("complete");
    expect(count()?.textContent).toBe("3 seeds selected");

    // A new decision version is a new scope: the previous review count no longer applies.
    await view.rerender(paneProps(subsection({
      seedStageVersion: 8,
      truncated: true,
      approvalChallenge: null,
      items: twoCardProjection(),
    })));
    await expect.poll(() => count()?.dataset.selectedCount).toBe("partial");
    expect(count()?.textContent).toContain("1+ selected in the shown seeds");

    // An untruncated projection is the complete decision count.
    await view.rerender(paneProps(subsection({
      items: [seed(), seed({ seedId: "seed-2" as Id<"seeds">, selected: true })],
    })));
    await expect.poll(() => count()?.textContent).toBe("2 seeds selected");
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
    await expect.element(page.getByRole("heading", { name: "Goal and problem", exact: true })).toBeVisible();

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
    await expect.element(page.getByRole("heading", { name: "Company and context", exact: true })).toBeVisible();
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
    await expect.element(page.getByRole("heading", { name: "Company and context", exact: true })).toBeVisible();
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
    await expect.element(page.getByRole("heading", { name: "Company and context", exact: true })).toBeVisible();
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
      await outlineSwitch().click();
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

describe("Seed plan final UI (ui-design-final.md sections 3 and 11)", () => {
  const attributed = {
    labels: new Map([["source-1", "Controller interview.docx"]]),
    status: "complete" as const,
    unrecoverableSourceIds: new Set<string>(),
    recoveryError: null,
  };
  /** A citation quoted word for word in the first bullet, with the optional
   * speaker and line the backend adds when the transcript gives them. */
  const quotedCitation = (extra: Record<string, unknown> = {}) => ({
    ...seed().provenance[0],
    _id: "provenance-quoted" as Id<"seedProvenance">,
    exactExcerpt: "The control loop stabilized output",
    ...extra,
  }) as SeedCardData["provenance"][number];
  const cleanChallenge = () => ({
    ...subsection().approvalChallenge!,
    carriedSeedIds: [],
    exclusionEntryIds: [],
    changedRoleIds: [],
    shownBatchOutdated: false,
    exclusions: [],
  });

  it("shows single-line Outline rows with state icons, faint counts, 242/244/246 groups and an n of 13 ring", async () => {
    const rows = outline().rows.map((row) => {
      switch (row.roleId) {
        case "company_context": return { ...row, state: "approved", selectedCount: 2 };
        case "goal_problem": return { ...row, state: "untouched", selectedCount: 0 };
        case "prior_year_status": return { ...row, state: "untouched", selectedCount: 0 };
        case "workplan": return { ...row, state: "skipped", selectedCount: 0 };
        case "hypothesis": return { ...row, state: "generating", selectedCount: 0 };
        case "overall_advancement": return { ...row, state: "failed", selectedCount: 0 };
        case "specific_advancements": return { ...row, state: "approved", stale: true };
        default: return row;
      }
    });
    __setQueryData("seeds:getOutline", { ...outline(), rows });
    __setQueryData("seeds:getSubsection", subsection());
    const { container } = await render(SeedWorkspace, workspaceProps());
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();
    const row = (roleTitle: RegExp) => page.getByRole("navigation", { name: "PD subsections" }).getByRole("button", { name: roleTitle }).element() as HTMLElement;
    const icon = (roleTitle: RegExp) => row(roleTitle).querySelector("[data-row-icon]")?.getAttribute("data-row-icon");

    expect(icon(/Company \/ Context/)).toBe("approved");
    expect(icon(/Goal \/ Problem/)).toBe("untouched");
    expect(icon(/Previous-year/)).toBe("optional");
    expect(icon(/Work plan/)).toBe("skipped");
    expect(icon(/Hypothesis/)).toBe("generating");
    expect(icon(/Experimentation/)).toBe("open");
    // Every state has an honest accessible name, not only an icon.
    expect(row(/Company \/ Context/).textContent).toContain("approved, 2 selected");
    expect(row(/Hypothesis/).textContent).toContain("writing seeds");
    expect(row(/Advancement to science/).textContent).toContain("seeds failed");
    expect(row(/Specific/).textContent).toContain("approved, stale");
    expect(row(/Specific/).querySelector("[data-row-marker]")?.textContent?.trim()).toBe("stale");
    // A count is faint and on the right; no preview or state line on screen.
    expect(row(/Company \/ Context/).querySelector("[data-counts-complete]")?.textContent).toBe("2");
    expect(container.textContent).not.toContain("Control loop evidence");
    expect(container.textContent).not.toContain("·");
    // Rows are one line high.
    expect(Math.round(row(/Goal \/ Problem/).getBoundingClientRect().height)).toBe(34);

    const nav = container.querySelector('nav[aria-label="PD subsections"]')!;
    expect(Array.from(nav.querySelectorAll(":scope > p")).map((label) => label.textContent?.trim())).toEqual(["242", "244", "246"]);
    // Approved and skipped steps are decided: 3 of 13.
    expect(container.querySelector("[data-outline-progress]")?.textContent?.trim()).toBe("3 of 13");
    await expect.element(page.getByRole("heading", { name: "Outline", exact: true })).toBeVisible();
  });

  it("renders the step header: mono eyebrow, chips, serif title, helper line, Regenerate with Previous batch, and a More menu", async () => {
    const data = subsection({
      roleId: "experimentation",
      state: "approved",
      shownBatchId: "batch-2" as Id<"seedBatches">,
      // A selected seed from an earlier Batch proves a previous Batch exists.
      items: [seed({ batchId: "batch-1" as Id<"seedBatches"> }), seed({ seedId: "seed-2" as Id<"seeds">, batchId: "batch-2" as Id<"seedBatches">, selected: true })],
      approvalChallenge: cleanChallenge(),
    });
    __setQueryData("seeds:listBatches", { page: [], isDone: true, continueCursor: "done", truncated: false, budget });
    const view = await render(SeedSubsectionPane, paneProps(data, { title: "Experimentation and iterations", kind: "multiple" }));

    expect(view.container.querySelector("[data-section-eyebrow]")?.textContent).toBe("Section 244");
    expect(getComputedStyle(view.container.querySelector<HTMLElement>("[data-section-eyebrow]")!).fontFamily).toContain("Mono");
    await expect.element(page.getByText("Select all that apply", { exact: true })).toBeVisible();
    expect(view.container.querySelector('[data-step-chip="approved"]')?.textContent).toBe("Approved");
    const heading = page.getByRole("heading", { name: "Experimentation and iterations", exact: true });
    expect(getComputedStyle(heading.element()).fontFamily).toContain("Georgia");
    expect(Number.parseInt(getComputedStyle(heading.element()).fontWeight, 10)).toBeLessThanOrEqual(500);
    const helper = view.container.querySelector<HTMLElement>("[data-step-helper]")!;
    expect(helper.querySelector("svg")).not.toBeNull();
    // A reopened step says why it is open again instead of counting (board 3.7).
    expect(helper.textContent).toContain("Reopened from the summary.");
    expect(helper.querySelector("[data-selected-count]")).toBeNull();
    expect(helper.textContent).toContain("Underlined words are quoted from the sources.");
    // No raw kind chip, no per-card regenerate, no dashed placeholder card.
    expect(view.container.textContent).not.toContain("multiple");
    expect(page.getByRole("button", { name: "Regenerate", exact: true }).elements()).toHaveLength(1);
    expect(view.container.querySelector(".border-dashed")).toBeNull();

    await page.getByRole("button", { name: "Previous batch", exact: true }).click();
    await expect.poll(() => __clientQueryCalls("seeds:listBatches")).toHaveLength(1);
    await expect.element(page.getByRole("region", { name: "Batch history" })).toBeVisible();

    await page.getByRole("button", { name: "More step actions", exact: true }).click();
    await expect.element(page.getByRole("menuitem", { name: "Batch history", exact: true })).toBeVisible();
    // Skip step belongs to optional steps only; Brief needs a host.
    expect(page.getByRole("menuitem", { name: "Skip step", exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole("menuitem", { name: "Brief", exact: true }).elements()).toHaveLength(0);
  });

  it("underlines only exact quotes and shows the quote, speaker and line, source and Open in transcript on hover and by keyboard", async () => {
    const onOpenSource = vi.fn();
    const citation = quotedCitation({ speaker: "Priya", line: 18 });
    const paraphrased = { ...seed().provenance[0], _id: "provenance-paraphrase" as Id<"seedProvenance">, exactExcerpt: "Output held up well." };
    await render(SeedSubsectionPane, paneProps(subsection({
      items: [seed({ provenance: [citation, paraphrased] })],
    }), { sourceAttribution: attributed, onOpenSource }));

    const underlines = document.querySelectorAll<HTMLElement>("[data-exact-quote]");
    expect(Array.from(underlines).map((element) => element.textContent)).toEqual(["The control loop stabilized output"]);
    const underline = page.getByRole("button", { name: "The control loop stabilized output", exact: true });
    const style = getComputedStyle(underline.element());
    expect(style.textDecorationLine).toBe("underline");
    expect(style.textDecorationStyle).toBe("solid");
    expect(style.textDecorationColor).toBe("rgb(13, 172, 165)");

    await underline.hover();
    const card = page.getByRole("group", { name: "Quoted line" });
    await expect.element(card).toBeVisible();
    await expect.element(card).toHaveTextContent("“The control loop stabilized output”");
    await expect.element(card).toHaveTextContent("Priya, line 18");
    await expect.element(card).toHaveTextContent("Controller interview.docx");
    await card.getByRole("button", { name: "Open in transcript", exact: true }).click();
    expect(onOpenSource).toHaveBeenCalledWith(citation);
    await expect.poll(() => document.querySelector("[data-quote-card]")).toBeNull();

    // Keyboard: focus opens the card, Tab reaches its action, Escape closes
    // it and returns focus to the quoted phrase.
    (underline.element() as HTMLElement).focus();
    await expect.element(card).toBeVisible();
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.textContent).toBe("Open in transcript");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-quote-card]")).toBeNull();
    expect(document.activeElement).toBe(underline.element());
  });

  it("closes a hover-opened quote card on Escape without moving focus from elsewhere", async () => {
    const citation = quotedCitation({ speaker: "Priya", line: 18 });
    await render(SeedSubsectionPane, paneProps(subsection({
      items: [seed({ provenance: [citation] })],
    }), { sourceAttribution: attributed }));
    // Keyboard focus stays on a control outside the quote.
    const elsewhere = document.createElement("button");
    elsewhere.textContent = "Elsewhere";
    document.body.append(elsewhere);
    elsewhere.focus();
    const underline = page.getByRole("button", { name: "The control loop stabilized output", exact: true });
    await underline.hover();
    await expect.element(page.getByRole("group", { name: "Quoted line" })).toBeVisible();
    expect(document.activeElement).toBe(elsewhere);

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-quote-card]")).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("drops underlines from an edited bullet and offers Restore original wording beside it", async () => {
    await render(SeedSubsectionPane, paneProps(subsection({
      items: [seed({
        edited: true,
        support: "writer_asserted",
        bullets: ["The writer's own wording.", "Tests covered three load bands."],
        provenance: [quotedCitation()],
      })],
    }), { sourceAttribution: attributed }));
    expect(document.querySelectorAll("[data-exact-quote]")).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Restore original wording", exact: true })).toBeVisible();
    // Honest state stays as a quiet marker, not a status chip.
    expect(document.querySelector('[data-seed-marker="writer-asserted"]')?.textContent).toBe("Writer asserted");
    await page.getByRole("button", { name: "Restore original wording", exact: true }).click();
    expect(__mutationCalls("seeds:restoreWording")).toEqual([expect.objectContaining({ seedId: "seed-1", expectedSeedStageVersion: 7 })]);
  });

  it("puts the whole card in edit mode: Enter saves, Shift+Enter adds a line, Esc cancels and asks again before discarding changes", async () => {
    await render(SeedSubsectionPane, paneProps(subsection()));
    const card = () => document.querySelector<HTMLElement>('[data-seed-id="seed-1"]')!;
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    expect(card().dataset.editing).toBe("true");
    await expect.poll(() => getComputedStyle(card()).borderColor).toBe("rgb(13, 172, 165)");
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await expect.poll(() => document.activeElement).toBe(bullet.element());
    // The pencil and bubble give way to a filled check and an outlined cross.
    expect(page.getByRole("button", { name: "Edit", exact: true }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("button", { name: "Save wording", exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Cancel editing", exact: true })).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\d+ words?/);

    await bullet.fill("First line");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}second line");
    await expect.element(bullet).toHaveValue("First line\nsecond line");
    expect(__mutationCalls("seeds:edit")).toEqual([]);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => __mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-1",
      bullets: ["First line\nsecond line", "Tests covered three load bands."],
      expectedSeedStageVersion: 7,
    }]);
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);

    // Esc on unchanged wording cancels at once.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.poll(() => document.activeElement).toBe(page.getByRole("textbox", { name: "Bullet 1" }).element());
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);

    // Esc on changed wording asks once, then discards.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Typed and then abandoned.");
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByText("Press Esc again to discard your changes.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Typed and then abandoned.");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => page.getByRole("textbox", { name: "Bullet 1" }).elements().length).toBe(0);
    expect(__mutationCalls("seeds:edit")).toHaveLength(1);
  });

  it("opens the 196px feedback menu with presets and an Aurora-marked free-text row", async () => {
    await render(SeedSubsectionPane, paneProps(subsection()));
    await page.getByRole("button", { name: "Give feedback", exact: true }).click();
    const menu = () => document.querySelector<HTMLElement>('[data-seed-feedback-menu="seed-1"]');
    await expect.poll(() => menu()).not.toBeNull();
    // The layout width; the shared menu entrance briefly scales the box.
    expect(getComputedStyle(menu()!).width).toBe("196px");
    expect(menu()!.textContent).toContain("Revise this seed");
    expect(getComputedStyle(menu()!.querySelector("p")!).textTransform).toBe("uppercase");
    expect(page.getByRole("menuitem").elements().map((item) => item.textContent?.trim())).toEqual([
      "More specific",
      "Shorter",
      "Different angle",
      "Plainer language",
      "Tell it what to change…",
    ]);
    expect(menu()!.querySelector('[data-feedback-custom] [data-ai-mark="aurora"]')).not.toBeNull();

    await page.getByRole("menuitem", { name: "Shorter", exact: true }).click();
    await expect.poll(() => __mutationCalls("seeds:giveFeedback")).toEqual([expect.objectContaining({
      seedId: "seed-1",
      instruction: "Make this seed shorter.",
      expectedSeedStageVersion: 7,
    })]);

    await feedbackMenu("Tell it what to change…");
    const field = page.getByRole("textbox", { name: "Tell it what to change" });
    await expect.poll(() => document.activeElement).toBe(field.element());
    await field.fill("Say what was measured, not which model.");
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect.poll(() => __mutationCalls("seeds:giveFeedback")).toHaveLength(2);
    expect(__mutationCalls("seeds:giveFeedback")[1]).toMatchObject({ instruction: "Say what was measured, not which model." });
  });

  it("keeps Restore original wording and the right edge of Send feedback clickable on a selected card", async () => {
    // A selected, hand-edited seed whose edited bullet is its last, one-line bullet.
    await render(SeedSubsectionPane, paneProps(subsection({
      items: [seed({
        selected: true,
        edited: true,
        bullets: ["Short edited wording."],
        originalBullets: ["The original wording."],
        support: "writer_asserted",
        provenance: [],
      })],
    })));
    // A real pointer click: nothing may sit over the control, visible or not.
    await page.getByRole("button", { name: "Restore original wording", exact: true }).click({ timeout: 2000 });
    await expect.poll(() => __mutationCalls("seeds:restoreWording")).toEqual([expect.objectContaining({ seedId: "seed-1" })]);

    await feedbackMenu("Tell it what to change…");
    const field = page.getByRole("textbox", { name: "Tell it what to change" });
    await field.fill("Name the measured load bands.");
    // The menu has finished closing; only the card itself is under the pointer.
    await expect.poll(() => document.querySelector("[data-seed-feedback-menu]")).toBeNull();
    const send = page.getByRole("button", { name: "Send feedback", exact: true });
    const box = (send.element() as HTMLElement).getBoundingClientRect();
    // Inside its bottom-right corner, where a floating tools row would sit.
    await send.click({ position: { x: box.width - 8, y: box.height - 6 }, timeout: 2000 });
    await expect.poll(() => __mutationCalls("seeds:giveFeedback")).toEqual([
      expect.objectContaining({ seedId: "seed-1", instruction: "Name the measured load bands." }),
    ]);
  });

  it("reveals a card's tools only for its own hover or focus, never for a revised seed inside it or the reverse", async () => {
    const revision = seed({
      seedId: "seed-rev" as Id<"seeds">,
      selected: false,
      bullets: ["Revised wording."],
      revisionOfSeedId: "seed-1" as Id<"seeds">,
      feedbackRequestId: "feedback-1" as Id<"seedFeedbackRequests">,
      provenance: [],
    });
    await render(SeedSubsectionPane, paneProps(subsection({
      items: [seed({ selected: true, provenance: [] }), revision],
      feedbackGroups: [{
        requestId: "feedback-1" as Id<"seedFeedbackRequests">,
        targetSeedId: "seed-1" as Id<"seeds">,
        targetWording: ["The control loop stabilized output."],
        instruction: "Say what was measured.",
        status: "active" as const,
        batchId: null,
        revisedSeedIds: ["seed-rev"] as Id<"seeds">[],
      }],
    })));
    const parent = document.querySelector<HTMLElement>('article[data-seed-id="seed-1"]')!;
    const nested = document.querySelector<HTMLElement>('article[data-seed-id="seed-rev"]')!;
    const toolsOf = (card: HTMLElement) => card.querySelector<HTMLElement>(":scope > [data-seed-body] [data-seed-footer]")!;
    const shown = (card: HTMLElement) => getComputedStyle(toolsOf(card)).opacity === "1" && getComputedStyle(toolsOf(card)).pointerEvents === "auto";
    // Both float in their tag rows, hidden and not clickable until hover.
    expect(toolsOf(parent).dataset.seedFooter).toBe("tags");
    expect(toolsOf(nested).dataset.seedFooter).toBe("tags");
    expect(getComputedStyle(toolsOf(parent)).pointerEvents).toBe("none");

    await userEvent.hover(nested.querySelector<HTMLElement>("[data-seed-body]")!);
    await expect.poll(() => shown(nested)).toBe(true);
    expect(shown(parent)).toBe(false);

    await userEvent.hover(parent.querySelector<HTMLElement>(":scope > [data-seed-body] li")!);
    await expect.poll(() => shown(parent)).toBe(true);
    await expect.poll(() => shown(nested)).toBe(false);
  });

  it("keeps the card that receives feedback mounted, with focus back on Give feedback, when its first feedback group lands", async () => {
    const pending = (requestId: string, targetSeedId: string, instruction: string) => ({
      requestId: requestId as Id<"seedFeedbackRequests">,
      targetSeedId: targetSeedId as Id<"seeds">,
      targetWording: ["Wording."],
      instruction,
      status: "active" as const,
      batchId: "batch-pending" as Id<"seedBatches">,
      revisedSeedIds: [] as Id<"seeds">[],
    });
    const items = () => [
      seed({ selected: false, provenance: [] }),
      seed({ seedId: "seed-2" as Id<"seeds">, selected: false, bullets: ["Second seed."], provenance: [] }),
    ];
    const view = await render(SeedSubsectionPane, paneProps(subsection({ items: items() })));
    const cardOf = (id: string) => document.querySelector<HTMLElement>(`article[data-seed-id="${id}"]`)!;
    const triggerOf = (card: HTMLElement) => card.querySelector<HTMLElement>('[aria-label="Give feedback"]')!;

    // A preset from the Give feedback menu.
    const first = cardOf("seed-1");
    await page.elementLocator(triggerOf(first)).click();
    await page.getByRole("menuitem", { name: "Shorter", exact: true }).click();
    await expect.poll(() => __mutationCalls("seeds:giveFeedback")).toHaveLength(1);
    await expect.poll(() => document.activeElement).toBe(triggerOf(first));
    await view.rerender(paneProps(subsection({
      items: items(),
      pendingBatchId: "batch-pending" as Id<"seedBatches">,
      feedbackGroups: [pending("feedback-1", "seed-1", "Make this seed shorter.")],
    })));
    await expect.poll(() => first.querySelector('[data-feedback-group="feedback-1"]')).not.toBeNull();
    expect(cardOf("seed-1")).toBe(first);
    expect(document.activeElement).toBe(triggerOf(first));

    // Send feedback from the custom field: focus returns to Give feedback.
    // The first menu has finished its closing fade.
    await expect.poll(() => document.querySelector('[data-seed-feedback-menu="seed-1"]')).toBeNull();
    const second = cardOf("seed-2");
    await page.elementLocator(triggerOf(second)).click();
    await page.getByRole("menuitem", { name: "Tell it what to change…", exact: true }).click();
    await page.elementLocator(second).getByRole("textbox", { name: "Tell it what to change" }).fill("Name the site.");
    await page.elementLocator(second).getByRole("button", { name: "Send feedback", exact: true }).click();
    await expect.poll(() => __mutationCalls("seeds:giveFeedback")).toHaveLength(2);
    await expect.poll(() => document.activeElement).toBe(triggerOf(second));
    await view.rerender(paneProps(subsection({
      items: items(),
      pendingBatchId: "batch-pending" as Id<"seedBatches">,
      feedbackGroups: [pending("feedback-1", "seed-1", "Make this seed shorter."), pending("feedback-2", "seed-2", "Name the site.")],
    })));
    await expect.poll(() => second.querySelector('[data-feedback-group="feedback-2"]')).not.toBeNull();
    expect(cardOf("seed-2")).toBe(second);
    expect(document.activeElement).toBe(triggerOf(second));
  });

  it("keeps every card in place, with its focus and unsaved wording, when revised seeds land on another card", async () => {
    await page.viewport(1440, 900);
    const letters = ["a", "b", "c", "d", "e", "f"];
    const cards = () => letters.map((letter) => seed({
      seedId: `seed-${letter}` as Id<"seeds">,
      selected: false,
      bullets: [`Seed ${letter.toUpperCase()} wording.`],
      provenance: [],
    }));
    const revision = (index: number) => seed({
      seedId: `seed-rev-${index}` as Id<"seeds">,
      selected: false,
      bullets: [`Revised wording ${index}.`],
      revisionOfSeedId: "seed-c" as Id<"seeds">,
      feedbackRequestId: "feedback-c" as Id<"seedFeedbackRequests">,
      provenance: [],
    });
    const view = await render(SeedSubsectionPane, paneProps(subsection({ items: cards() })));
    await expect.poll(() => document.querySelector("[data-seed-grid]")?.getAttribute("data-seed-grid")).toBe("two");
    const cardF = document.querySelector<HTMLElement>('article[data-seed-id="seed-f"]')!;
    await page.elementLocator(cardF).getByRole("button", { name: "Edit", exact: true }).click();
    const fieldF = cardF.querySelector<HTMLTextAreaElement>('textarea[aria-label="Bullet 1"]')!;
    await page.elementLocator(fieldF).fill("Writer is typing in F");
    fieldF.focus();
    expect(document.activeElement).toBe(fieldF);

    // The writer's feedback on C lands as two revised seeds.
    await view.rerender(paneProps(subsection({
      items: [...cards(), revision(1), revision(2)],
      feedbackGroups: [{
        requestId: "feedback-c" as Id<"seedFeedbackRequests">,
        targetSeedId: "seed-c" as Id<"seeds">,
        targetWording: ["Seed C wording."],
        instruction: "Say what was measured.",
        status: "active" as const,
        batchId: null,
        revisedSeedIds: ["seed-rev-1", "seed-rev-2"] as Id<"seeds">[],
      }],
    })));
    await expect.poll(() => document.querySelectorAll('article[data-seed-id^="seed-rev-"]').length).toBe(2);
    // F was neither moved nor rebuilt: same node, same field, focus and text kept.
    expect(document.querySelector('article[data-seed-id="seed-f"]')).toBe(cardF);
    expect(cardF.isConnected).toBe(true);
    expect(document.activeElement).toBe(fieldF);
    expect(fieldF.value).toBe("Writer is typing in F");
  });

  it("nests revised seeds under the seed their feedback targeted, on canvas, with Withdraw feedback", async () => {
    const revision = seed({
      seedId: "seed-rev" as Id<"seeds">,
      batchId: "batch-rev" as Id<"seedBatches">,
      selected: false,
      bullets: ["Iteration 3 measured divergence between predicted and observed temperatures."],
      revisionOfSeedId: "seed-1" as Id<"seeds">,
      feedbackRequestId: "feedback-1" as Id<"seedFeedbackRequests">,
      provenance: [],
    });
    const group = (requestId: string, targetSeedId: string, revisedSeedIds: string[], instruction: string) => ({
      requestId: requestId as Id<"seedFeedbackRequests">,
      targetSeedId: targetSeedId as Id<"seeds">,
      targetWording: ["An earlier seed that is not shown."],
      instruction,
      status: "active" as const,
      batchId: null,
      revisedSeedIds: revisedSeedIds as Id<"seeds">[],
    });
    await render(SeedSubsectionPane, paneProps(subsection({
      items: [seed(), seed({ seedId: "seed-2" as Id<"seeds">, selected: false, bullets: ["Second seed."] }), revision],
      feedbackGroups: [
        group("feedback-1", "seed-1", ["seed-rev"], "Say what was measured."),
        group("feedback-2", "seed-hidden", [], "Name the site."),
      ],
    })));

    const nested = document.querySelector<HTMLElement>('[data-seed-cell="seed-1"] [data-feedback-group="feedback-1"]')!;
    expect(nested).not.toBeNull();
    expect(nested.querySelector('[data-seed-id="seed-rev"]')).not.toBeNull();
    expect(nested.textContent).toContain("Revised seeds (1)");
    expect(nested.textContent).toContain("from your feedback “Say what was measured.”");
    expect(getComputedStyle(nested).backgroundColor).toBe("rgb(249, 252, 251)");
    // The revision is not also a top-level card.
    expect(document.querySelectorAll("[data-seed-cell][data-seed-column]")).toHaveLength(2);
    // A group whose target is not shown is listed on its own.
    const orphan = document.querySelector<HTMLElement>('[data-feedback-group="feedback-2"]')!;
    expect(orphan.closest("[data-seed-cell]")).toBeNull();
    expect(orphan.textContent).toContain("No revised seeds yet.");

    await page.elementLocator(nested).getByRole("button", { name: "Withdraw feedback", exact: true }).click();
    expect(__mutationCalls("seeds:withdrawFeedback")).toEqual([expect.objectContaining({
      feedbackRequestId: "feedback-1",
      expectedSeedStageVersion: 7,
    })]);
  });

  it("approves from the Outline footer and continues to the next step, then to the Summary after the last one", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ approvalChallenge: cleanChallenge() }));
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "goal_problem" }, subsection({
      roleId: "goal_problem",
      items: [seed({ seedId: "seed-goal" as Id<"seeds">, roleId: "goal_problem", bullets: ["Goal Seed wording."] })],
      approvalChallenge: cleanChallenge(),
    }));
    const onReviewSummary = vi.fn();
    const view = await render(SeedWorkspace, workspaceProps({ onReviewSummary }));
    const footer = () => page.elementLocator(view.container.querySelector<HTMLElement>("[data-outline-footer]")!);
    await expect.element(footer().getByRole("button", { name: "Approve and continue", exact: true })).toBeEnabled();
    // Not ready and not reopened: approval is the only action.
    expect(footer().getByRole("button", { name: "Review summary", exact: true }).elements()).toHaveLength(0);
    await footer().getByRole("button", { name: "Approve and continue", exact: true }).click();
    expect(__mutationCalls("seeds:approve")).toEqual([expect.objectContaining({ roleId: "company_context", approvalChallenge: "challenge-exact" })]);
    await expect.element(page.getByRole("heading", { name: "Goal and problem", exact: true })).toBeVisible();
    await expect.poll(() => __activeQueryArgs("seeds:getSubsection")).toContainEqual({ generationId, roleId: "goal_problem" });
    view.unmount();

    // The last step, with every other step decided, continues to the Summary.
    document.body.innerHTML = "";
    localStorage.setItem(`seeds.openRole:writer-1:${generationId}`, "goal_improvements");
    __setQueryData("seeds:getOutline", {
      ...outline(),
      rows: outline().rows.map((row) => (row.roleId === "goal_improvements" ? row : { ...row, state: "approved" })),
    });
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "goal_improvements" }, subsection({
      roleId: "goal_improvements",
      items: [seed({ seedId: "seed-last" as Id<"seeds">, roleId: "goal_improvements" })],
      approvalChallenge: cleanChallenge(),
    }));
    await render(SeedWorkspace, workspaceProps({ onReviewSummary }));
    await page.getByRole("button", { name: "Approve and continue", exact: true }).click();
    await expect.poll(() => onReviewSummary.mock.calls.length).toBe(1);
  });

  it("does not advance a step the writer opened while an earlier approval was pending", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ approvalChallenge: cleanChallenge() }));
    __setQueryDataForArgs("seeds:getSubsection", { generationId, roleId: "goal_problem" }, subsection({
      roleId: "goal_problem",
      items: [seed({ seedId: "seed-goal" as Id<"seeds">, roleId: "goal_problem", bullets: ["Goal Seed wording."] })],
      approvalChallenge: cleanChallenge(),
    }));
    let finishApproval: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:approve", new Promise((resolve) => { finishApproval = resolve; }));
    const onReviewSummary = vi.fn();
    const view = await render(SeedWorkspace, workspaceProps({ onReviewSummary }));
    const footer = () => page.elementLocator(view.container.querySelector<HTMLElement>("[data-outline-footer]")!);
    await footer().getByRole("button", { name: "Approve and continue", exact: true }).click();
    expect(__mutationCalls("seeds:approve")).toEqual([expect.objectContaining({ roleId: "company_context" })]);

    // The writer opens Goal / Problem before step one's approval returns.
    await page.getByRole("navigation", { name: "PD subsections" }).getByRole("button", { name: /Goal \/ Problem/ }).click();
    await expect.element(page.getByRole("heading", { name: "Goal and problem", exact: true })).toBeVisible();
    finishApproval?.(null);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Step one's continuation must not move the writer on from Goal / Problem.
    await expect.element(page.getByRole("heading", { name: "Goal and problem", exact: true })).toBeVisible();
    expect(__activeQueryArgs("seeds:getSubsection")).not.toContainEqual({ generationId, roleId: "passive_limitations" });
    expect(onReviewSummary).not.toHaveBeenCalled();
  });

  it("stacks Confirm and approve above Review summary on a reopened step and confirms it in place", async () => {
    const rows = outline().rows.map((row) =>
      row.roleId === "company_context" ? { ...row, state: "in_progress", approvedAt: 1_700_000_000_000 } : row
    );
    __setQueryData("seeds:getOutline", { ...outline(), rows });
    __setQueryData("seeds:getSubsection", subsection({ approvalChallenge: cleanChallenge() }));
    const onReviewSummary = vi.fn();
    const view = await render(SeedWorkspace, workspaceProps({ onReviewSummary }));
    const footerElement = () => view.container.querySelector<HTMLElement>("[data-outline-footer]")!;
    const confirm = page.elementLocator(footerElement()).getByRole("button", { name: "Confirm and approve", exact: true });
    const review = page.elementLocator(footerElement()).getByRole("button", { name: "Review summary", exact: true });
    await expect.element(confirm).toBeEnabled();
    await expect.element(review).toBeVisible();
    const confirmRect = (confirm.element() as HTMLElement).getBoundingClientRect();
    const reviewRect = (review.element() as HTMLElement).getBoundingClientRect();
    expect(confirmRect.bottom).toBeLessThanOrEqual(reviewRect.top);
    expect(Math.round(confirmRect.width)).toBe(Math.round(reviewRect.width));
    expect(review.element().id).toBe("seed-review-summary-trigger");
    // The helper line says why the step is open again.
    expect(document.querySelector("[data-step-helper]")?.textContent).toContain("Reopened from the summary.");
    expect(page.getByRole("button", { name: "Approve and continue", exact: true }).elements()).toHaveLength(0);

    await confirm.click();
    expect(__mutationCalls("seeds:approve")).toEqual([expect.objectContaining({ roleId: "company_context" })]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Confirmed in place: the step stays open and the Summary is one click away.
    await expect.element(page.getByRole("heading", { name: "Company and context", exact: true })).toBeVisible();
    await review.click();
    expect(onReviewSummary).toHaveBeenCalledTimes(1);

    // Without `approvedAt` (older DTOs), an approved step is reopened too.
    view.unmount();
    document.body.innerHTML = "";
    __setQueryData("seeds:getOutline", {
      ...outline(),
      rows: outline().rows.map((row) => (row.roleId === "company_context" ? { ...row, state: "approved" } : row)),
    });
    __setQueryData("seeds:getSubsection", subsection({ state: "approved", approvalChallenge: cleanChallenge() }));
    await render(SeedWorkspace, workspaceProps({ onReviewSummary }));
    await expect.element(page.getByRole("button", { name: "Confirm and approve", exact: true })).toBeVisible();
    expect(document.querySelector('[data-step-chip="approved"]')?.textContent).toBe("Approved");
  });

  it("matches board 3.1 metrics: 13px Outline rows with 14px marks, 14px seed text, 16px checkboxes, 11px tags and a quiet disabled approval", async () => {
    await page.viewport(1440, 900);
    __setQueryData("seeds:getOutline", {
      ...outline(),
      rows: outline().rows.map((row) => ({
        ...row,
        state: row.order === 2 ? "approved" : row.order === 1 ? "in_progress" : "untouched",
      })),
    });
    __setQueryData("seeds:getSubsection", subsection({
      approvalChallenge: null,
      items: [
        seed({ selected: false, tags: ["conservative", "high_level"] }),
        seed({ seedId: "seed-2" as Id<"seeds">, selected: true, bullets: ["A selected seed."] }),
      ],
    }));
    const view = await render(SeedWorkspace, workspaceProps());
    view.container.style.width = "1214px";
    view.container.style.height = "790px";
    const nav = view.container.querySelector<HTMLElement>('nav[aria-label="PD subsections"]')!;
    const active = nav.querySelector<HTMLElement>('button[aria-current="step"]')!;
    const activeLabel = active.querySelector<HTMLElement>(".truncate")!;
    expect(getComputedStyle(activeLabel).fontSize).toBe("13px");
    expect(getComputedStyle(activeLabel).fontWeight).toBe("500");
    expect(Math.round(active.querySelector<HTMLElement>("[data-row-icon]")!.getBoundingClientRect().width)).toBe(14);
    // An approved step reads in full ink; an untouched one in secondary ink.
    const approved = nav.querySelector<HTMLElement>('button[data-row-state="approved"] .truncate')!;
    const untouched = nav.querySelector<HTMLElement>('button[data-row-state="untouched"] .truncate')!;
    expect(getComputedStyle(approved).color).toBe("rgb(22, 33, 31)");
    expect(getComputedStyle(untouched).color).toBe("rgb(79, 97, 93)");
    expect(getComputedStyle(nav.querySelector<HTMLElement>(":scope > p")!).fontSize).toBe("11px");
    expect(Math.round(view.container.querySelector<HTMLElement>('[aria-label="Seed outline"] > header')!.getBoundingClientRect().height)).toBe(48);

    // Step header: serif 24/30 title, 13px purpose, 12px helper over a hairline.
    const heading = page.getByRole("heading", { name: "Company and context", exact: true }).element() as HTMLElement;
    expect(getComputedStyle(heading).fontSize).toBe("24px");
    expect(getComputedStyle(heading).lineHeight).toBe("30px");
    const helperLine = view.container.querySelector<HTMLElement>("[data-step-helper]")!;
    expect(getComputedStyle(helperLine).fontSize).toBe("12px");
    expect(helperLine.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "1 seed selected. Approve to move on, or change your pick. Underlined words are quoted from the sources."
    );

    // Cards: 10px radius, 14/16 padding, 16px checkbox, 11px medium tags, 14/20 bullets.
    const card = view.container.querySelector<HTMLElement>('article[data-seed-id="seed-1"]')!;
    expect(getComputedStyle(card).borderRadius).toBe("10px");
    const cardBody = card.querySelector<HTMLElement>(":scope > [data-seed-body]")!;
    expect(getComputedStyle(cardBody).paddingTop).toBe("14px");
    expect(getComputedStyle(cardBody).paddingLeft).toBe("16px");
    expect(Math.round(card.querySelector<HTMLElement>('[role="checkbox"]')!.getBoundingClientRect().width)).toBe(16);
    const tag = card.querySelector<HTMLElement>("[data-seed-tag]")!;
    expect(getComputedStyle(tag).fontSize).toBe("11px");
    expect(getComputedStyle(tag).fontWeight).toBe("500");
    expect(Math.round(tag.getBoundingClientRect().height)).toBe(20);
    const bullet = card.querySelector<HTMLElement>("li")!;
    expect(getComputedStyle(bullet).fontSize).toBe("14px");
    expect(getComputedStyle(bullet).lineHeight).toBe("20px");
    // An unselected card keeps its tools in a row at its foot; a selected one
    // keeps them at the end of its tag row, hidden and not clickable until
    // hover (board 3.2), in space the tag row keeps free.
    expect(card.querySelector<HTMLElement>("[data-seed-footer]")!.dataset.seedFooter).toBe("foot");
    expect(getComputedStyle(card.querySelector<HTMLElement>("[data-seed-footer]")!).position).toBe("static");
    const selectedFooter = view.container.querySelector<HTMLElement>('article[data-seed-id="seed-2"] [data-seed-footer]')!;
    expect(selectedFooter.dataset.seedFooter).toBe("tags");
    expect(getComputedStyle(selectedFooter).position).toBe("absolute");
    expect(getComputedStyle(selectedFooter).opacity).toBe("0");
    expect(getComputedStyle(selectedFooter).pointerEvents).toBe("none");
    const tagRow = view.container.querySelector<HTMLElement>('article[data-seed-id="seed-2"] [data-seed-tag-row]')!;
    // Quoted lines, Edit and Give feedback: 36px each.
    expect(selectedFooter.querySelectorAll("button")).toHaveLength(3);
    expect(getComputedStyle(tagRow).paddingRight).toBe("108px");

    // A disabled approval is a gray-50 fill with faint ink, not a faded primary.
    const approve = page.elementLocator(view.container.querySelector<HTMLElement>("[data-outline-footer]")!)
      .getByRole("button", { name: "Approve and continue", exact: true });
    await expect.element(approve).toBeDisabled();
    const approveStyle = getComputedStyle(approve.element());
    expect(approveStyle.backgroundColor).toBe("rgb(243, 247, 246)");
    expect(approveStyle.color).toBe("rgb(147, 165, 161)");
    expect(approveStyle.opacity).toBe("1");
    view.unmount();

    // Before anything is ticked, the helper also says how to read a quote.
    document.body.innerHTML = "";
    const fresh = await render(SeedSubsectionPane, paneProps(subsection({ items: [seed({ selected: false })] })));
    expect(fresh.container.querySelector<HTMLElement>("[data-step-helper]")!.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Tick at least one seed to approve this step. Underlined words are quoted from the sources; hover one to see the line."
    );
  });

  const manySeeds = () => Array.from({ length: 4 }, (_, index) => seed({
    seedId: `seed-grid-${index}` as Id<"seeds">,
    bullets: [`Grid seed ${index + 1} wording.`],
  }));

  it("lays out two 412px card columns at 1440 and one column with a 240px Outline at tablet width", async () => {
    await page.viewport(1440, 900);
    __setQueryData("seeds:getOutline", outline());
    // The second card runs longer than the first; its row partner still matches it.
    __setQueryData("seeds:getSubsection", subsection({
      items: manySeeds().map((item, index) => index === 1
        ? { ...item, bullets: ["Grid seed 2 wording runs long enough to wrap onto a second line in its card.", "A second bullet."] }
        : item),
    }));
    const wide = await render(SeedWorkspace, workspaceProps());
    wide.container.style.width = "1228px";
    wide.container.style.height = "830px";
    await expect.poll(() => document.querySelector("[data-seed-grid]")?.getAttribute("data-seed-grid")).toBe("two");
    // The page keeps the ranked reading order (A, B, C, D), so tab and
    // screen-reader order run across each row; the cards are placed in two
    // 412px columns whose n-th cards pair up and share one height (board 3.1).
    const checkbox = (id: string) => document.querySelector<HTMLElement>(`article[data-seed-id="${id}"] [role="checkbox"]`)!;
    const nextCheckbox = async () => {
      for (let steps = 0; steps < 20; steps += 1) {
        await userEvent.keyboard("{Tab}");
        if (document.activeElement?.getAttribute("role") === "checkbox") return document.activeElement;
      }
      return null;
    };
    checkbox("seed-grid-0").focus();
    expect(await nextCheckbox()).toBe(checkbox("seed-grid-1"));
    expect(await nextCheckbox()).toBe(checkbox("seed-grid-2"));
    const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-seed-cell][data-seed-column]"));
    expect(cells.map((cell) => cell.dataset.seedCell)).toEqual(["seed-grid-0", "seed-grid-1", "seed-grid-2", "seed-grid-3"]);
    expect(cells.map((cell) => cell.dataset.seedColumn)).toEqual(["0", "1", "0", "1"]);
    const card = (id: string) => document.querySelector<HTMLElement>(`article[data-seed-id="${id}"]`)!.getBoundingClientRect();
    for (const id of ["seed-grid-0", "seed-grid-1", "seed-grid-2", "seed-grid-3"]) expect(Math.round(card(id).width)).toBe(412);
    await expect.poll(() => Math.round(card("seed-grid-0").height)).toBe(Math.round(card("seed-grid-1").height));
    expect(Math.round(card("seed-grid-0").top)).toBe(Math.round(card("seed-grid-1").top));
    expect(Math.round(card("seed-grid-2").top)).toBe(Math.round(card("seed-grid-3").top));
    expect(Math.round(card("seed-grid-2").top - card("seed-grid-0").bottom)).toBe(10);
    expect(Math.round(card("seed-grid-1").left - card("seed-grid-0").right)).toBe(10);
    await expect.element(page.getByRole("slider", { name: "Resize Seed outline" })).toHaveAttribute("aria-valuenow", "300");
    await page.getByLabelText("Seed workspace").screenshot({ path: await captures.path("seed-plan-desktop-1440") });
    wide.unmount();

    document.body.innerHTML = "";
    await page.viewport(1024, 768);
    const tablet = await render(SeedWorkspace, workspaceProps());
    tablet.container.style.width = "956px";
    tablet.container.style.height = "700px";
    await expect.element(page.getByRole("slider", { name: "Resize Seed outline" })).toHaveAttribute("aria-valuenow", "240");
    const outlinePane = tablet.container.querySelector<HTMLElement>('[aria-label="Seed outline"]')!.parentElement!;
    expect(Math.round(outlinePane.getBoundingClientRect().width)).toBe(240);
    await expect.poll(() => document.querySelector("[data-seed-grid]")?.getAttribute("data-seed-grid")).toBe("one");
    expect(new Set(Array.from(document.querySelectorAll<HTMLElement>("[data-seed-cell][data-seed-column]")).map((cell) => cell.dataset.seedColumn))).toEqual(new Set(["0"]));
    await expect.element(page.elementLocator(tablet.container.querySelector<HTMLElement>("[data-outline-footer]")!)
      .getByRole("button", { name: "Approve and continue", exact: true })).toBeVisible();
    await page.getByLabelText("Seed workspace").screenshot({ path: await captures.path("seed-plan-tablet-1024") });
  });

  it("nests revised seeds inside their seed's card and keeps placing cards two to a row after it (board 3.2)", async () => {
    await page.viewport(1440, 900);
    const revision = (index: number) => seed({
      seedId: `seed-rev-${index}` as Id<"seeds">,
      selected: false,
      bullets: [`Revised wording ${index}.`],
      revisionOfSeedId: "seed-grid-2" as Id<"seeds">,
      feedbackRequestId: "feedback-grid" as Id<"seedFeedbackRequests">,
      provenance: [],
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({
      items: [...manySeeds(), seed({ seedId: "seed-grid-4" as Id<"seeds">, bullets: ["Grid seed 5 wording."] }), revision(1), revision(2)],
      feedbackGroups: [{
        requestId: "feedback-grid" as Id<"seedFeedbackRequests">,
        targetSeedId: "seed-grid-2" as Id<"seeds">,
        targetWording: ["Grid seed 3 wording."],
        instruction: "Say what was measured.",
        status: "active" as const,
        batchId: null,
        revisedSeedIds: ["seed-rev-1", "seed-rev-2"] as Id<"seeds">[],
      }],
    }));
    const view = await render(SeedWorkspace, workspaceProps());
    view.container.style.width = "1228px";
    view.container.style.height = "830px";
    await expect.poll(() => document.querySelector("[data-seed-grid]")?.getAttribute("data-seed-grid")).toBe("two");
    // Cards fill each row left to right in ranked order, whatever revised
    // seeds they carry, so the fifth starts the third row on the left.
    const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-seed-cell][data-seed-column]"));
    expect(cells.map((cell) => cell.dataset.seedCell)).toEqual(["seed-grid-0", "seed-grid-1", "seed-grid-2", "seed-grid-3", "seed-grid-4"]);
    expect(cells.map((cell) => cell.dataset.seedColumn)).toEqual(["0", "1", "0", "1", "0"]);
    // The revised seed's row: its neighbour keeps its own height rather than
    // stretching beside the revised seeds, and the fifth card starts on the
    // next row.
    const rect = (id: string) => document.querySelector<HTMLElement>(`article[data-seed-id="${id}"]`)!.getBoundingClientRect();
    expect(Math.round(rect("seed-grid-3").top)).toBe(Math.round(rect("seed-grid-2").top));
    expect(rect("seed-grid-3").height).toBeLessThan(rect("seed-grid-2").height - 100);
    expect(Math.round(rect("seed-grid-4").top - rect("seed-grid-2").bottom)).toBe(10);
    expect(Math.round(rect("seed-grid-4").left)).toBe(Math.round(rect("seed-grid-2").left));
    // The revised seeds sit inside the targeted seed's own card, on canvas.
    const target = document.querySelector<HTMLElement>('article[data-seed-id="seed-grid-2"]')!;
    const group = target.querySelector<HTMLElement>('[data-feedback-group="feedback-grid"]')!;
    expect(group).not.toBeNull();
    expect(group.querySelectorAll("article[data-seed-id^='seed-rev-']")).toHaveLength(2);
    expect(getComputedStyle(group).backgroundColor).toBe("rgb(249, 252, 251)");
  });

  it("renders the host's control at the end of the narrow pane switch row, and nowhere on a wide screen (board 3.6)", async () => {
    const hostControl = createRawSnippet(() => ({
      render: () => `<button type="button" aria-label="Details" data-host-control class="size-10">i</button>`,
    }));
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection({ items: manySeeds() }));
    await page.viewport(390, 844);
    const phone = await render(SeedWorkspace, workspaceProps({ paneSwitchEnd: hostControl }));
    phone.container.style.width = "390px";
    phone.container.style.height = "844px";
    const row = () => phone.container.querySelector<HTMLElement>("[data-seed-pane-switch]");
    await expect.poll(() => row()?.querySelector("[data-host-control]")).not.toBeNull();
    const control = row()!.querySelector<HTMLElement>("[data-host-control]")!.getBoundingClientRect();
    const segmented = row()!.querySelector<HTMLElement>('[role="group"]')!.getBoundingClientRect();
    // Beside the switch, 10px after it and 16px from the edge, in the 52px row.
    expect(Math.round(row()!.getBoundingClientRect().height)).toBe(52);
    expect(Math.round(control.left - segmented.right)).toBe(10);
    expect(Math.round(row()!.getBoundingClientRect().right - control.right)).toBe(16);
    expect(Math.round(control.top + control.height / 2)).toBe(Math.round(segmented.top + segmented.height / 2));
    phone.unmount();

    // Wide screens have no pane switch, so the host keeps its own control.
    document.body.innerHTML = "";
    await page.viewport(1440, 900);
    const wide = await render(SeedWorkspace, workspaceProps({ paneSwitchEnd: hostControl }));
    wide.container.style.width = "1228px";
    wide.container.style.height = "830px";
    await expect.element(page.getByRole("navigation", { name: "PD subsections" })).toBeVisible();
    expect(wide.container.querySelector("[data-seed-pane-switch]")).toBeNull();
    expect(wide.container.querySelector("[data-host-control]")).toBeNull();
  });

  it("leaves no empty cell and keeps visual order equal to page order when revised seeds exist before the cards are placed", async () => {
    await page.viewport(1440, 900);
    const letters = ["a", "b", "c", "d", "e", "f"];
    const revision = (index: number) => seed({
      seedId: `seed-rev-${index}` as Id<"seeds">,
      selected: false,
      bullets: [`Revised wording ${index}.`],
      revisionOfSeedId: "seed-a" as Id<"seeds">,
      feedbackRequestId: "feedback-a" as Id<"seedFeedbackRequests">,
      provenance: [],
    });
    // A reload after feedback on the first seed: its revised seeds are
    // already there when the cards are placed.
    await render(SeedSubsectionPane, paneProps(subsection({
      items: [
        ...letters.map((letter) => seed({ seedId: `seed-${letter}` as Id<"seeds">, selected: false, bullets: [`Seed ${letter.toUpperCase()} wording.`], provenance: [] })),
        revision(1),
        revision(2),
      ],
      feedbackGroups: [{
        requestId: "feedback-a" as Id<"seedFeedbackRequests">,
        targetSeedId: "seed-a" as Id<"seeds">,
        targetWording: ["Seed A wording."],
        instruction: "Say what was measured.",
        status: "active" as const,
        batchId: null,
        revisedSeedIds: ["seed-rev-1", "seed-rev-2"] as Id<"seeds">[],
      }],
    })));
    await expect.poll(() => document.querySelector("[data-seed-grid]")?.getAttribute("data-seed-grid")).toBe("two");
    const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-seed-cell][data-seed-column]"));
    const pageOrder = cells.map((cell) => cell.dataset.seedCell);
    expect(pageOrder).toEqual(letters.map((letter) => `seed-${letter}`));
    // Two cards on every row: rows are A B, C D, E F, with no empty cell.
    const rows = new Map<number, string[]>();
    for (const cell of cells) {
      const top = Math.round(cell.getBoundingClientRect().top);
      rows.set(top, [...(rows.get(top) ?? []), cell.dataset.seedCell!]);
    }
    expect([...rows.values()]).toEqual([["seed-a", "seed-b"], ["seed-c", "seed-d"], ["seed-e", "seed-f"]]);
    // Visual order (top to bottom, left to right) is the page order.
    const visualOrder = [...cells]
      .sort((left, right) => {
        const a = left.getBoundingClientRect();
        const b = right.getBoundingClientRect();
        return Math.round(a.top) - Math.round(b.top) || a.left - b.left;
      })
      .map((cell) => cell.dataset.seedCell);
    expect(visualOrder).toEqual(pageOrder);
  });

  it("gives phones a segmented Outline n/13 | Seeds switch, one column and a bottom bar with 44px regenerate and approve", async () => {
    await page.viewport(390, 844);
    __setQueryData("seeds:getOutline", {
      ...outline(),
      rows: outline().rows.map((row) => (row.order <= 2 ? { ...row, state: "approved" } : row)),
    });
    __setQueryData("seeds:getSubsection", subsection({ roleId: "passive_limitations", items: manySeeds(), approvalChallenge: cleanChallenge() }));
    localStorage.setItem(`seeds.openRole:writer-1:${generationId}`, "passive_limitations");
    const { container } = await render(SeedWorkspace, workspaceProps());
    container.style.width = "390px";
    container.style.height = "844px";
    await expect.element(outlineSwitch()).toHaveTextContent("Outline 2 / 13");
    await expect.element(seedsSwitch()).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => document.querySelector("[data-seed-grid]")?.getAttribute("data-seed-grid")).toBe("one");
    const bar = page.elementLocator(container.querySelector<HTMLElement>("[data-seed-bottom-bar]")!);
    const regenerate = bar.getByRole("button", { name: "Regenerate", exact: true });
    const approve = bar.getByRole("button", { name: "Approve and continue", exact: true });
    await expect.element(approve).toBeEnabled();
    expect(Math.round((regenerate.element() as HTMLElement).getBoundingClientRect().height)).toBe(44);
    expect(Math.round((regenerate.element() as HTMLElement).getBoundingClientRect().width)).toBe(44);
    expect(Math.round((approve.element() as HTMLElement).getBoundingClientRect().height)).toBe(44);
    for (const target of [outlineSwitch(), seedsSwitch()]) {
      expect((target.element() as HTMLElement).getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      // Each 44px target draws a 34px segment on a gray-50 track (board 3.6).
      expect(Math.round((target.element() as HTMLElement).firstElementChild!.getBoundingClientRect().height)).toBe(34);
    }
    const pressedSegment = (seedsSwitch().element() as HTMLElement).firstElementChild!;
    expect(getComputedStyle(pressedSegment).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(pressedSegment).fontWeight).toBe("500");
    // The header Regenerate gives way to the bar's icon; no Outline footer.
    expect(page.getByRole("button", { name: "Regenerate", exact: true }).elements()).toHaveLength(1);
    expect(container.querySelector("[data-outline-footer]")).toBeNull();
    await page.getByLabelText("Seed workspace").screenshot({ path: await captures.path("seed-plan-phone-390") });
    await regenerate.click();
    expect(__mutationCalls("seeds:regenerate")).toEqual([expect.objectContaining({ roleId: "passive_limitations" })]);
  });
});

// ─── Round 2 (F3 to F5): seed-step progress ─────────────────────────────────

const plainChallenge = {
  approvalChallenge: "plain-challenge",
  carriedSeedIds: [],
  exclusionEntryIds: [],
  changedRoleIds: [],
  shownBatchOutdated: false,
  exclusions: [],
  contributionHashes: [],
};
const textOf = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("seed-step progress (F3, F5)", () => {
  it("shows the progress row, four skeleton cards and a disabled approve while the first step is written", async () => {
    const now = Date.now();
    await render(
      SeedSubsectionPane,
      paneProps(
        subsection({
          items: [],
          shownBatchId: null,
          pendingBatchId: "batch-pending" as Id<"seedBatches">,
          pendingBatch: { status: "running", queuedAt: now - 5_000, startedAt: now - 5_000 },
          state: "generating",
        }),
        { expectedMs: 20_000 }
      )
    );
    const row = document.querySelector<HTMLElement>("[data-seed-progress]")!;
    expect(textOf(row.querySelector("[data-seed-progress-line]"))).toBe(
      "Writing ideas from the interview. About 15 seconds left."
    );
    expect(row.querySelector('[data-ai-mark="aurora"]')).not.toBeNull();
    const bar = row.querySelector<HTMLElement>("[data-seed-progress-bar]")!;
    expect(getComputedStyle(bar).width).toBe("160px");
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(24);
    const skeletons = [...document.querySelectorAll<HTMLElement>("[data-seed-skeleton]")];
    expect(skeletons).toHaveLength(4);
    expect(getComputedStyle(skeletons[0]).height).toBe("170px");
    expect(document.body.textContent).not.toContain("Writing seeds…");
    expect(document.querySelector<HTMLButtonElement>("[data-approve-step]")?.disabled).toBe(true);
  });

  it("says a later step also reads the picks so far, waits while queued and says Almost ready past the estimate", async () => {
    const now = Date.now();
    const view = await render(
      SeedSubsectionPane,
      paneProps(
        subsection({
          items: [],
          pendingBatchId: "batch-pending" as Id<"seedBatches">,
          pendingBatch: { status: "queued", queuedAt: now },
          state: "generating",
        }),
        { expectedMs: 20_000, afterPicks: true }
      )
    );
    expect(textOf(document.querySelector("[data-seed-progress-line]"))).toBe(
      "Writing ideas from the interview and your picks so far. Waiting to start."
    );
    view.unmount();
    await render(
      SeedSubsectionPane,
      paneProps(
        subsection({
          items: [],
          pendingBatchId: "batch-pending" as Id<"seedBatches">,
          pendingBatch: { status: "running", queuedAt: now - 60_000, startedAt: now - 60_000 },
          state: "generating",
        }),
        { expectedMs: 20_000, afterPicks: true }
      )
    );
    expect(textOf(document.querySelector("[data-seed-progress-line]"))).toBe(
      "Writing ideas from the interview and your picks so far. Almost ready."
    );
    expect(document.querySelector("[data-seed-progress-bar]")?.getAttribute("aria-valuenow")).toBe("95");
  });

  it("draws a gradient ring with the percent on an outline row whose ideas are written", async () => {
    const now = Date.now();
    const rows = outline().rows.map((row, index) =>
      index === 0
        ? { ...row, state: "generating", pendingBatchId: "batch-pending", pendingStartedAt: now - 10_000 }
        : { ...row, pendingStartedAt: null }
    );
    __setQueryData("seeds:getOutline", { ...outline(), rows, expectedMs: 20_000 });
    __setQueryData("seeds:getSubsection", subsection({ items: [], pendingBatchId: "batch-pending" as Id<"seedBatches">, pendingBatch: { status: "running", queuedAt: now - 10_000, startedAt: now - 10_000 } }));
    await render(SeedWorkspace, workspaceProps());
    const first = () =>
      document.querySelector<HTMLElement>('nav[aria-label="PD subsections"] button[data-row-state="generating"]');
    await expect.poll(() => first()).not.toBeNull();
    const ring = first()!.querySelector<HTMLElement>('[data-row-icon="writing"]')!;
    expect(Number(ring.dataset.rowPercent)).toBeGreaterThanOrEqual(49);
    expect(ring.getAttribute("style")).toContain("conic-gradient(");
    expect(ring.getAttribute("style")).toContain("#8438FF");
    expect(textOf(first()!.querySelector("[data-row-progress]"))).toMatch(/^\d+%$/);
    // The other rows keep their icons.
    expect(document.querySelectorAll('[data-row-icon="writing"]')).toHaveLength(1);
  });
});

describe("ideas ready, Mod Enter and the step deep link (F4, I4, F6)", () => {
  it("shows the ideas-ready toast when the step on screen gets its ideas, then leaves", async () => {
    const pending = subsection({
      items: [],
      shownBatchId: null,
      pendingBatchId: "batch-new" as Id<"seedBatches">,
      pendingBatch: { status: "running", queuedAt: Date.now(), startedAt: Date.now() },
      state: "generating",
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", pending);
    await render(SeedWorkspace, workspaceProps());
    await expect.poll(() => document.querySelector("[data-seed-skeletons]")).not.toBeNull();
    expect(document.querySelector("[data-ideas-ready-toast]")).toBeNull();

    __setQueryData(
      "seeds:getSubsection",
      subsection({ items: twoSeeds(), shownBatchId: "batch-new" as Id<"seedBatches">, pendingBatchId: null, pendingBatch: null })
    );
    await expect.poll(() => document.querySelector("[data-ideas-ready-toast]")).not.toBeNull();
    const toast = document.querySelector<HTMLElement>("[data-ideas-ready-toast]")!;
    expect(textOf(toast)).toBe("2 ideas are ready Pick what fits, then approve to move on.");
    expect(toast.querySelector('[data-ai-mark="aurora"]')).not.toBeNull();
    // Board F4: the shell's dark toast surface, 296px, radius 10.
    expect(getComputedStyle(toast).backgroundColor).toBe("rgb(19, 45, 42)");
    expect(toast.getBoundingClientRect().width).toBe(296);
    expect(getComputedStyle(toast).borderRadius).toBe("10px");
    expect(toast.closest("[data-ideas-ready-host]")).not.toBeNull();
    toast.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!.click();
    await expect.poll(() => document.querySelector("[data-ideas-ready-toast]")).toBeNull();
  });

  it("dismisses itself after 5 seconds, paused while hovered", async () => {
    const IdeasReadyToast = (await import("./IdeasReadyToast.svelte")).default;
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      await render(IdeasReadyToast, { count: 3, onClose });
      const toast = document.querySelector<HTMLElement>("[data-ideas-ready-toast]")!;
      toast.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(8_000);
      expect(onClose).not.toHaveBeenCalled();
      toast.dispatchEvent(new MouseEvent("mouseleave"));
      vi.advanceTimersByTime(5_000);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("approves with Mod Enter, but not while typing, and shows the shortcut", async () => {
    await render(
      SeedSubsectionPane,
      paneProps(subsection({ approvalChallenge: plainChallenge }))
    );
    const approve = document.querySelector<HTMLButtonElement>("[data-approve-step]")!;
    await expect.poll(() => approve.disabled).toBe(false);
    expect(approve.getAttribute("aria-keyshortcuts")).toMatch(/^(Meta|Control)\+Enter$/);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: mac, ctrlKey: !mac, bubbles: true }));
    expect(__mutationCalls("seeds:approve")).toEqual([]);
    input.remove();
    // Nor from inside an open dialog (the shell's shared typing-target rule).
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    inside.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: mac, ctrlKey: !mac, bubbles: true }));
    expect(__mutationCalls("seeds:approve")).toEqual([]);
    dialog.remove();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: mac, ctrlKey: !mac, bubbles: true }));
    await expect.poll(() => __mutationCalls("seeds:approve").length).toBe(1);
    expect(__mutationCalls("seeds:approve")[0]).toMatchObject({ approvalChallenge: "plain-challenge" });
  });

  it("opens the step named by ?step= when it exists", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    await render(SeedWorkspace, workspaceProps({ requestedRoleId: "hypothesis" }));
    await expect
      .poll(() => textOf(document.querySelector('nav[aria-label="PD subsections"] button[aria-current="step"]')))
      .toContain(PD_SUBSECTIONS.find((row) => row.roleId === "hypothesis")!.title);
    expect(__activeQueryArgs("seeds:getSubsection")).toContainEqual({ generationId, roleId: "hypothesis" });
  });

  it("ignores a ?step= that is not a step", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSubsection", subsection());
    await render(SeedWorkspace, workspaceProps({ requestedRoleId: "not-a-step" }));
    await expect
      .poll(() => __activeQueryArgs("seeds:getSubsection"))
      .toContainEqual({ generationId, roleId: PD_SUBSECTIONS[0].roleId });
  });
});
