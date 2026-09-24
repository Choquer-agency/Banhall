import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
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
import SeedSummaryReview from "./SeedSummaryReview.svelte";

const generationId = "generation-summary" as Id<"generations">;
const otherGenerationId = "generation-summary-next" as Id<"generations">;
const versionId = "summary-version-1" as Id<"summaryVersions">;
// Verification (R5-09): this invocation's captures land in a directory it
// reserved exclusively, never on a fixed path that a later run would overwrite.
const captures = captureOwner("summary-review");
const budget = { bytesRead: 0, rangesRead: 0, exhausted: false, maxBytes: 1_000_000, maxRanges: 100 };
const settings = {
  lengthTarget: "full",
  modelId: "claude-sonnet-test",
  writerProfile: { state: "selected", source: "upload", fileName: "writer-profile.docx" },
};
// One browser record per unsaved item, under the owner's prefix (A2).
const liveDraftPrefix = `seeds.summaryDraft:writer-1:${generationId}:live:`;
type StoredSummaryDraft = {
  ownerGenerationId: string;
  ownerSummaryVersionId: string;
  baseSeedStageVersion: number;
  bulletOne: string;
  bulletTwo: string;
};

/** Every stored live draft of the writer, assembled from its per-item records. */
function storedSummaryDrafts(): Record<string, StoredSummaryDraft> {
  const result: Record<string, StoredSummaryDraft> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)!;
    if (key.startsWith(liveDraftPrefix)) result[key.slice(liveDraftPrefix.length)] = JSON.parse(localStorage.getItem(key)!);
  }
  return result;
}

/** Seeds stored drafts as the review persists them: one record per item. */
function storeSummaryDrafts(drafts: Record<string, StoredSummaryDraft>) {
  for (const [seedId, draft] of Object.entries(drafts)) {
    localStorage.setItem(`${liveDraftPrefix}${seedId}`, JSON.stringify(draft));
  }
}

function outline(ready = true, canEdit = true, seedStageVersion = 12, owner: Id<"generations"> = generationId) {
  return {
    generationId: owner,
    rows: PD_SUBSECTIONS.map((definition) => ({
      ...definition,
      state: definition.roleId === "prior_year_status" ? "skipped" : "approved",
      stale: false,
      staleReason: null,
      outdated: false,
      selectedCount: definition.roleId === "prior_year_status" ? 0 : 1,
      selectedWordCount: 6,
      countsComplete: true,
      previewLines: [],
      pendingBatchId: null,
      shownBatchId: null,
    })),
    readiness: {
      ready,
      complete: true,
      blockingRoleIds: ready ? [] : ["goal_problem"],
    },
    usage: { requests: 13, notice: false },
    seedStageVersion,
    truncated: false,
    budget,
    canEdit,
    workflow: "seeds",
    frozen: {
      briefVersionId: "brief-version-3",
      summaryVersionId: null,
      ...settings,
    },
  };
}

function item(seedId: string, roleId: string, bullet: string, support = "source_supported") {
  return {
    kind: "selection",
    seedId,
    roleId,
    subsectionKind: "standard",
    bullets: [bullet],
    support,
    tags: ["technical"],
    uncertaintySeedId: null,
    experimentSeedIds: [],
  };
}

function firstPage(overrides: Record<string, unknown> = {}) {
  return {
    page: [item("seed-a", "company_context", "The company designed adaptive controls.")],
    skippedRoleIds: ["prior_year_status"],
    isDone: false,
    continueCursor: "cursor-2",
    partial: true,
    frozen: false,
    generationId,
    summaryVersionId: null,
    seedStageVersion: 12,
    settings,
    budget,
    ...overrides,
  };
}

function secondPage(overrides: Record<string, unknown> = {}) {
  return {
    page: [item("seed-b", "experimentation", "Three load-band experiments refined the controller.", "writer_asserted")],
    skippedRoleIds: ["prior_year_status"],
    isDone: true,
    continueCursor: "done",
    partial: true,
    frozen: false,
    generationId,
    summaryVersionId: null,
    seedStageVersion: 12,
    settings,
    budget,
    ...overrides,
  };
}

function onePage(items: ReturnType<typeof item>[], overrides: Record<string, unknown> = {}) {
  return secondPage({ page: items, partial: false, ...overrides });
}

const continuation = (cursor: string, owner: Id<"generations"> = generationId) => ({
  generationId: owner,
  cursor,
  numItems: 50,
});

const signOffButton = () => page.getByRole("button", { name: "Sign off and generate", exact: true });

beforeEach(async () => {
  document.body.innerHTML = "";
  localStorage.clear();
  const cleanUrl = new URL(window.location.href);
  cleanUrl.hash = "";
  window.history.replaceState({}, "", cleanUrl);
  __resetConvexStub();
  await page.viewport(1366, 900);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const persistenceNotice = () => document.querySelector<HTMLElement>("[data-summary-persistence]");
const outlineAlert = () => document.querySelector<HTMLElement>("[data-summary-outline-error]");

describe("Seed Summary Review", () => {
  it("loads every page before enabling sign-off, shows frozen settings, edits with a version fence, and signs off only the reloaded current version", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), secondPage());

    const { container } = await render(SeedSummaryReview, {
      generationId,
      userId: "writer-1",
      onClose: vi.fn(),
    });
    container.style.width = "1000px";
    container.style.height = "800px";
    const summarySurface = page.getByRole("region", { name: "Summary Review" });
    const summaryElement = summarySurface.elements()[0];
    if (!(summaryElement instanceof HTMLElement)) throw new Error("Summary Review did not render");
    expect(Math.round(summaryElement.getBoundingClientRect().width)).toBe(1000);
    expect(Math.round(summaryElement.getBoundingClientRect().height)).toBe(800);

    await expect.element(page.getByText("The company designed adaptive controls.", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Three load-band experiments refined the controller.", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Skipped", { exact: true })).toBeVisible();
    expect(__clientQueryCalls("seeds:getSummary")).toEqual([continuation("cursor-2")]);
    // Only the model is shown beside sign-off; the length target and Writer
    // Profile stay frozen but off this view, and a first version is unnamed.
    expect(container.querySelector("[data-summary-model]")?.textContent).toBe("claude-sonnet-test");
    expect(container.textContent).not.toContain("Length:");
    expect(container.textContent).not.toContain("Writer Profile");
    expect(container.querySelector("[data-summary-version]")).toBeNull();
    expect(container.textContent).toContain("Writer asserted");
    await expect.element(signOffButton()).toBeEnabled();
    const actionFooter = container.querySelector<HTMLElement>("footer")!;
    const scrollOwner = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    scrollOwner.scrollTop = 0;
    await summarySurface.screenshot({
      path: await captures.path("summary-review-desktop-initial"),
    });
    // The jump list was removed from the design; the document reads top to
    // bottom under its Section headings.
    expect(page.getByRole("navigation", { name: "Summary sections" }).elements()).toHaveLength(0);
    await expect.element(page.getByRole("heading", { name: "Experimentation / Iterations", exact: true })).toBeInTheDocument();

    expect(scrollOwner.scrollHeight).toBeGreaterThan(scrollOwner.clientHeight);
    const documentScroll = window.scrollY;
    scrollOwner.scrollTop = scrollOwner.scrollHeight;
    await Promise.resolve();
    expect(window.scrollY).toBe(documentScroll);
    expect(actionFooter.getBoundingClientRect().bottom).toBeLessThanOrEqual(container.getBoundingClientRect().bottom + 1);
    await summarySurface.screenshot({
      path: await captures.path("summary-review-desktop-scrolled"),
    });

    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Edited in final review.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-a",
      bullets: ["Edited in final review."],
      expectedSeedStageVersion: 12,
    }]);

    __setQueryData("seeds:getOutline", outline(false, true, 13));
    await expect.element(page.getByText("Blocked by: goal_problem.", { exact: true })).toBeVisible();
    await expect.element(signOffButton()).toBeDisabled();
    // The server is ready at version 13, but the complete review on screen is
    // still version 12: it must not be signable.
    __setQueryData("seeds:getOutline", outline(true, true, 13));
    await expect.element(page.getByText(/The plan changed after this review loaded/)).toBeVisible();
    await expect.element(signOffButton()).toBeDisabled();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([]);

    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2-v13"), secondPage({ seedStageVersion: 13 }));
    __setQueryData("seeds:getSummary", firstPage({
      page: [item("seed-a", "company_context", "Edited in final review.")],
      continueCursor: "cursor-2-v13",
      seedStageVersion: 13,
    }));
    await expect.element(page.getByText("Edited in final review.", { exact: true })).toBeVisible();
    await expect.element(signOffButton()).toBeEnabled();

    await page.viewport(390, 844);
    container.style.width = "390px";
    container.style.height = "844px";
    expect(Math.round(summaryElement.getBoundingClientRect().width)).toBe(390);
    expect(Math.round(summaryElement.getBoundingClientRect().height)).toBe(844);
    const narrowScrollOwner = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    narrowScrollOwner.scrollTop = narrowScrollOwner.scrollHeight;
    await Promise.resolve();
    expect(actionFooter.getBoundingClientRect().bottom).toBeLessThanOrEqual(summaryElement.getBoundingClientRect().bottom + 1);
    await summarySurface.screenshot({
      path: await captures.path("summary-review-narrow-editable-scrolled"),
    });
    await signOffButton().click();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([{
      generationId,
      expectedSeedStageVersion: 13,
    }]);
  });

  it("never signs off old visible content after an Outline advance while replacement pages are still loading", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), secondPage());
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.element(signOffButton()).toBeEnabled();

    __setQueryData("seeds:getOutline", outline(true, true, 13));
    await expect.element(signOffButton()).toBeDisabled();

    let releaseReplacement: ((value: unknown) => void) | undefined;
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2-v13"), new Promise((resolve) => {
      releaseReplacement = resolve;
    }));
    __setQueryData("seeds:getSummary", firstPage({
      page: [item("seed-a", "company_context", "Version thirteen first page.")],
      continueCursor: "cursor-2-v13",
      seedStageVersion: 13,
    }));
    await expect.element(page.getByText("Loading the complete Summary…", { exact: true })).toBeVisible();
    await expect.element(signOffButton()).toBeDisabled();
    expect(document.body.textContent).not.toContain("The company designed adaptive controls.");
    expect(document.body.textContent).not.toContain("Version thirteen first page.");
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([]);

    releaseReplacement?.(secondPage({
      page: [item("seed-b", "experimentation", "Version thirteen second page.")],
      seedStageVersion: 13,
    }));
    await expect.element(page.getByText("Version thirteen second page.", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Version thirteen first page.", { exact: true })).toBeVisible();
    await expect.element(signOffButton()).toBeEnabled();
    await signOffButton().click();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([{
      generationId,
      expectedSeedStageVersion: 13,
    }]);
  });

  it("keeps a completely loaded review valid after a refused sign-off and retries with the same revision", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([item("seed-a", "company_context", "Complete single-page Summary.")]));
    __setMutationError("generations:signOffSeedStage", new ConvexError({
      code: "INVALID_STATE",
      message: "Readiness changed; review the blockers",
    }));
    const onSignedOff = vi.fn();
    await render(SeedSummaryReview, { generationId, userId: "writer-1", onSignedOff });
    await expect.element(signOffButton()).toBeEnabled();

    await signOffButton().click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Readiness changed; review the blockers");
    await expect.element(signOffButton()).toBeEnabled();
    expect(document.body.textContent).not.toContain("Partial Summary");
    await expect.element(page.getByText("Complete single-page Summary.", { exact: true })).toBeVisible();
    expect(onSignedOff).not.toHaveBeenCalled();

    __setMutationResult("generations:signOffSeedStage", null);
    await signOffButton().click();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([
      { generationId, expectedSeedStageVersion: 12 },
      { generationId, expectedSeedStageVersion: 12 },
    ]);
    await expect.poll(() => onSignedOff.mock.calls.length).toBe(1);
    // The completion names its submitting owner so a host can fence it (A5/A7).
    expect(onSignedOff).toHaveBeenCalledWith({ generationId, userId: "writer-1" });
  });

  it("stops an obsolete Summary walk right after its awaited page, before requesting another", async () => {
    let releaseObsolete: ((value: unknown) => void) | undefined;
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), new Promise((resolve) => {
      releaseObsolete = resolve;
    }));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.poll(() => __clientQueryCalls("seeds:getSummary")).toEqual([continuation("cursor-2")]);

    __setQueryData("seeds:getOutline", outline(true, true, 13));
    __setQueryData("seeds:getSummary", onePage(
      [item("seed-current", "company_context", "Current version only page.")],
      { seedStageVersion: 13 }
    ));
    await expect.element(page.getByText("Current version only page.", { exact: true })).toBeVisible();

    releaseObsolete?.(firstPage({
      page: [item("seed-stale", "experimentation", "Obsolete continuation must not show.")],
      continueCursor: "cursor-3",
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__clientQueryCalls("seeds:getSummary")).toEqual([continuation("cursor-2")]);
    expect(document.body.textContent).not.toContain("Obsolete continuation must not show.");
    await expect.element(signOffButton()).toBeEnabled();
  });

  it("announces an initial Summary read failure, reloads by resubscribing, and keeps sign-off unavailable meanwhile", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryError("seeds:getSummary", new ConvexError({
      code: "INVALID_STATE",
      message: "Summary read failed",
    }));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });

    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Summary read failed");
    await expect.element(alert).toHaveTextContent("Sign-off stays unavailable until the complete Summary loads.");
    await expect.element(signOffButton()).toBeDisabled();

    await page.getByRole("button", { name: "Reload Summary", exact: true }).click();
    const args = { generationId, cursor: null, numItems: 50 };
    await expect.poll(() => __queryArgsHistory("seeds:getSummary")).toEqual([args, "skip", args]);
    await expect.element(page.getByRole("alert")).toHaveTextContent("Summary read failed");
    await expect.element(signOffButton()).toBeDisabled();

    __setQueryData("seeds:getSummary", onePage([item("seed-a", "company_context", "Recovered Summary item.")]));
    await expect.element(page.getByText("Recovered Summary item.", { exact: true })).toBeVisible();
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    await expect.element(signOffButton()).toBeEnabled();
  });

  it("labels a failed continuation page as partial and reloads the complete Summary explicitly", async () => {
    // One continuation read fails, the explicit reload's read succeeds. A
    // thenable keeps the page source stable, so only the writer's action retries.
    let continuationReads = 0;
    const flakyContinuation = {
      then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        continuationReads += 1;
        if (continuationReads === 1) {
          reject(new ConvexError({ code: "INVALID_STATE", message: "Continuation page failed" }));
        } else {
          resolve(secondPage());
        }
      },
    };
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), flakyContinuation);
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });

    await expect.element(page.getByText("Partial Summary. Sign-off stays unavailable until every page is loaded.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Continuation page failed");
    await expect.element(page.getByText("The company designed adaptive controls.", { exact: true })).toBeVisible();
    await expect.element(signOffButton()).toBeDisabled();
    expect(continuationReads).toBe(1);

    await page.getByRole("button", { name: "Reload complete Summary", exact: true }).click();
    await expect.element(page.getByText("Three load-band experiments refined the controller.", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Partial Summary");
    await expect.element(signOffButton()).toBeEnabled();
    expect(__clientQueryCalls("seeds:getSummary")).toEqual([continuation("cursor-2"), continuation("cursor-2")]);
    expect(continuationReads).toBe(2);
  });

  it("labels an incomplete page set and blocks sign-off", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), undefined);
    await render(SeedSummaryReview, { generationId, userId: "writer-1", onClose: vi.fn() });

    await expect.element(page.getByText("Partial Summary. Sign-off stays unavailable until every page is loaded.", { exact: true })).toBeVisible();
    await expect.element(signOffButton()).toBeDisabled();
  });

  it("explains incomplete server readiness instead of an empty blocker list and recovers through an explicit plan-status reload", async () => {
    // The server's bounded readiness read: not ready, not complete, no
    // blocking role, and its own INCOMPLETE_INPUT explanation.
    const incompleteReadiness = {
      ...outline(false),
      readiness: {
        ready: false,
        complete: false,
        blockingRoleIds: [],
        blockers: [{ code: "INCOMPLETE_INPUT", message: "Seed readiness could not read the complete decision set" }],
      },
    };
    __setQueryData("seeds:getOutline", incompleteReadiness);
    __setQueryData("seeds:getSummary", onePage([item("seed-a", "company_context", "Complete Summary item.")]));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.element(page.getByText("Complete Summary item.", { exact: true })).toBeVisible();
    const readinessNotice = () => document.querySelector<HTMLElement>("[data-summary-readiness]");
    await expect.poll(() => readinessNotice()?.dataset.summaryReadiness).toBe("incomplete");
    expect(readinessNotice()?.getAttribute("role")).toBe("status");
    expect(readinessNotice()?.textContent).toContain("Readiness could not be fully computed within the server's safe processing limit");
    expect(readinessNotice()?.textContent).toContain("Seed readiness could not read the complete decision set");
    expect(document.body.textContent).not.toContain("Blocked by:");
    await expect.element(signOffButton()).toBeDisabled();

    // The explicit recovery re-establishes the plan-status subscription; a
    // response that is still bounded keeps the honest refusal.
    await page.getByRole("button", { name: "Reload plan status", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getOutline")).toEqual([{ generationId }, "skip", { generationId }]);
    await expect.poll(() => readinessNotice()?.dataset.summaryReadiness).toBe("incomplete");
    expect(document.body.textContent).not.toContain("Blocked by:");
    await expect.element(signOffButton()).toBeDisabled();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([]);

    // A complete response names its decision blockers; a complete ready one
    // clears every readiness notice and enables sign-off.
    __setQueryData("seeds:getOutline", outline(false));
    await expect.element(page.getByText("Blocked by: goal_problem.", { exact: true })).toBeVisible();
    expect(readinessNotice()?.dataset.summaryReadiness).toBe("blocked");
    expect(document.body.textContent).not.toContain("Readiness could not be fully computed");
    __setQueryData("seeds:getOutline", outline(true));
    await expect.poll(() => readinessNotice()).toBeNull();
    await expect.element(signOffButton()).toBeEnabled();
  });

  it("qualifies roles absent from an incomplete Summary aggregate until pagination completes, and keeps definitive empty wording for a complete review", async () => {
    // The continuation carrying the later role's item fails once; the
    // explicit reload's read succeeds.
    let continuationReads = 0;
    const flakyContinuation = {
      then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        continuationReads += 1;
        if (continuationReads === 1) {
          reject(new ConvexError({ code: "INVALID_STATE", message: "Continuation page failed" }));
        } else {
          resolve(secondPage());
        }
      },
    };
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), flakyContinuation);
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    const unknown = (roleId: string) => document.querySelector<HTMLElement>(`[data-summary-role-unknown="${roleId}"]`);
    const empty = (roleId: string) => document.querySelector<HTMLElement>(`[data-summary-role-empty="${roleId}"]`);

    await expect.element(page.getByText("Partial Summary. Sign-off stays unavailable until every page is loaded.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Continuation page failed");
    // The later role's selected item is on the page that did not load: its
    // absence is qualified, never presented as having no selected items.
    expect(unknown("experimentation")?.textContent).toContain("Selected items may be on pages that did not load");
    expect(empty("experimentation")).toBeNull();
    expect(document.body.textContent).not.toContain("No selected items.");
    // Every role without loaded items is qualified; the loaded role and the
    // server-reported skipped role keep what the server said about them.
    expect(document.querySelectorAll("[data-summary-role-unknown]")).toHaveLength(PD_SUBSECTIONS.length - 2);
    expect(unknown("company_context")).toBeNull();
    expect(unknown("prior_year_status")).toBeNull();
    await expect.element(page.getByText("The company designed adaptive controls.", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Skipped", { exact: true })).toBeVisible();
    await expect.element(signOffButton()).toBeDisabled();

    // Successful recovery: the later role's item arrives, and only now does a
    // genuinely empty role read definitively empty.
    await page.getByRole("button", { name: "Reload complete Summary", exact: true }).click();
    await expect.element(page.getByText("Three load-band experiments refined the controller.", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Partial Summary");
    expect(document.querySelectorAll("[data-summary-role-unknown]")).toHaveLength(0);
    expect(unknown("experimentation")).toBeNull();
    expect(empty("experimentation")).toBeNull();
    expect(empty("goal_problem")?.textContent).toBe("No selected items.");
    expect(document.querySelectorAll("[data-summary-role-empty]")).toHaveLength(PD_SUBSECTIONS.length - 3);
    expect(empty("prior_year_status")).toBeNull();
    await expect.element(page.getByText("Skipped", { exact: true })).toBeVisible();
    await expect.element(signOffButton()).toBeEnabled();
    expect(continuationReads).toBe(2);
  });

  it("preserves independent per-item Summary drafts across recreation, save, and discard", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-draft-a", "company_context", "Server wording A."),
      item("seed-draft-b", "goal_problem", "Server wording B."),
    ]));

    let view = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Unsaved draft A.");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Unsaved draft B.");
    view.unmount();

    view = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Unsaved draft A.");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Unsaved draft B.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toContainEqual({
      generationId,
      roleId: "goal_problem",
      seedId: "seed-draft-b",
      bullets: ["Unsaved draft B."],
      expectedSeedStageVersion: 12,
    });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Server wording A.");
    view.unmount();
  });

  it("clears only the unchanged saved Summary item and keeps another item's draft and text typed during a save", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-a", "company_context", "Server wording A."),
      item("seed-b", "goal_problem", "Server wording B."),
    ]));
    let finishA: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:edit", new Promise((resolve) => { finishA = resolve; }));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });

    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Draft A submitted.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const bulletB = page.getByRole("textbox", { name: "Bullet 1" });
    await expect.element(bulletB).toHaveValue("Server wording B.");
    await bulletB.fill("Draft B unsaved.");
    finishA?.(undefined);
    await expect.poll(() => Object.keys(storedSummaryDrafts())).toEqual(["seed-b"]);
    await expect.element(bulletB).toHaveValue("Draft B unsaved.");
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-a",
      bullets: ["Draft A submitted."],
      expectedSeedStageVersion: 12,
    })]);

    let finishB: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:edit", new Promise((resolve) => { finishB = resolve; }));
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    await bulletB.fill("Draft B unsaved. Typed during save.");
    finishB?.(undefined);
    await expect.element(page.getByRole("button", { name: "Save wording", exact: true })).toBeEnabled();
    await expect.element(bulletB).toHaveValue("Draft B unsaved. Typed during save.");
    expect(storedSummaryDrafts()["seed-b"].bulletOne).toBe("Draft B unsaved. Typed during save.");
  });

  it("keeps a Summary draft on its base version after a remote update until the writer reviews it", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([item("seed-a", "company_context", "Server wording twelve.")]));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Wording against twelve.");

    __setQueryData("seeds:getOutline", outline(true, true, 13));
    __setQueryData("seeds:getSummary", onePage(
      [item("seed-a", "company_context", "Remote wording thirteen.")],
      { seedStageVersion: 13 }
    ));
    const save = page.getByRole("button", { name: "Save wording", exact: true });
    await expect.element(page.getByText("Current wording: Remote wording thirteen.", { exact: true })).toBeVisible();
    await expect.element(save).toBeDisabled();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Wording against twelve.");
    expect(__mutationCalls("seeds:edit")).toEqual([]);

    await page.getByRole("button", { name: "Use current decision version", exact: true }).click();
    await expect.element(save).toBeEnabled();
    await save.click();
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-a",
      bullets: ["Wording against twelve."],
      expectedSeedStageVersion: 13,
    }]);
  });

  it("hides every Summary mutation control for restored drafts and live revocation while keeping the text", async () => {
    storeSummaryDrafts({
      "seed-a": {
        ownerGenerationId: generationId,
        ownerSummaryVersionId: "live",
        baseSeedStageVersion: 12,
        bulletOne: "Restored Summary draft.",
        bulletTwo: "",
      },
    });
    __setQueryData("seeds:getOutline", outline(true, false));
    __setQueryData("seeds:getSummary", onePage([item("seed-a", "company_context", "Server wording A.")]));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.element(page.getByText("Server wording A.", { exact: true })).toBeVisible();
    for (const name of ["Edit", "Save wording", "Sign off and generate"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    expect(page.getByRole("textbox").elements()).toHaveLength(0);

    __setQueryData("seeds:getOutline", outline(true, true));
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await expect.element(bullet).toHaveValue("Restored Summary draft.");
    await bullet.fill("Typed before Summary revocation.");

    __setQueryData("seeds:getOutline", outline(true, false));
    await expect.poll(() => page.getByRole("textbox").elements().length).toBe(0);
    for (const name of ["Edit", "Save wording", "Sign off and generate"]) {
      expect(page.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
    }
    expect(storedSummaryDrafts()["seed-a"].bulletOne).toBe("Typed before Summary revocation.");

    __setQueryData("seeds:getOutline", outline(true, true));
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Typed before Summary revocation.");
    expect(__mutationCalls("seeds:edit")).toEqual([]);
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([]);
  });

  it("withholds a previous generation's Summary at the same live version until the new owner's pages load", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([item("seed-old-owner", "company_context", "Previous generation Summary item.")]));
    __setQueryDataForArgs("seeds:getOutline", { generationId: otherGenerationId }, undefined);
    __setQueryDataForArgs("seeds:getSummary", { generationId: otherGenerationId, cursor: null, numItems: 50 }, undefined);
    const view = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.element(page.getByText("Previous generation Summary item.", { exact: true })).toBeVisible();

    await view.rerender({ generationId: otherGenerationId, userId: "writer-1" });
    await expect.element(page.getByText("Loading the complete Summary…", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Previous generation Summary item.");
    expect(signOffButton().elements()).toHaveLength(0);

    __setQueryDataForArgs("seeds:getOutline", { generationId: otherGenerationId }, outline(true, true, 12, otherGenerationId));
    __setQueryDataForArgs("seeds:getSummary", { generationId: otherGenerationId, cursor: null, numItems: 50 }, onePage(
      [item("seed-new-owner", "company_context", "New generation Summary item.")],
      { generationId: otherGenerationId }
    ));
    await expect.element(page.getByText("New generation Summary item.", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Previous generation Summary item.");
    await signOffButton().click();
    expect(__mutationCalls("generations:signOffSeedStage")).toEqual([{
      generationId: otherGenerationId,
      expectedSeedStageVersion: 12,
    }]);
  });

  it("discards pages from an older version when the Summary changes during pagination", async () => {
    let releaseOldPage: ((value: ReturnType<typeof secondPage>) => void) | undefined;
    const oldPage = new Promise<ReturnType<typeof secondPage>>((resolve) => {
      releaseOldPage = resolve;
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), oldPage);

    const view = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.element(page.getByText("Loading the complete Summary…", { exact: true })).toBeVisible();

    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-new"), secondPage({
      page: [item("seed-new-b", "experimentation", "New version second page.")],
      seedStageVersion: 13,
    }));
    __setQueryData("seeds:getSummary", firstPage({
      page: [item("seed-new-a", "company_context", "New version first page.")],
      continueCursor: "cursor-new",
      seedStageVersion: 13,
    }));

    await expect.element(page.getByText("New version second page.", { exact: true })).toBeVisible();
    releaseOldPage?.(secondPage({
      page: [item("seed-stale", "experimentation", "Stale version page must be discarded.")],
    }));
    await Promise.resolve();
    expect(view.container.textContent).toContain("New version first page.");
    expect(view.container.textContent).toContain("New version second page.");
    expect(view.container.textContent).not.toContain("Stale version page must be discarded.");
  });

  it("lets a writer save a long Summary edit with a soft note instead of a limit", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage(
      [item("seed-a", "company_context", "The company designed adaptive controls.")],
      { skippedRoleIds: ["prior_year_status"] }
    ));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const shortWording = "Controls team of four maintains the setpoint logic.";
    await page.getByRole("textbox", { name: "Bullet 1" }).fill(shortWording);
    expect(page.getByText("Long for a seed", { exact: true }).elements()).toHaveLength(0);
    const longWording = `${Array.from({ length: 30 }, () => "word").join(" ")}. A second sentence follows.`;
    await page.getByRole("textbox", { name: "Bullet 1" }).fill(longWording);
    await expect.element(page.getByText("Long for a seed", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save wording", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-a",
      bullets: [longWording],
      expectedSeedStageVersion: 12,
    }]);
  });

  it("shows blockers and hides item mutation controls for a frozen signed-off Summary", async () => {
    await page.viewport(390, 844);
    __setQueryData("seeds:getOutline", outline(false, false));
    __setQueryData("seeds:getSummary", onePage(
      [item("seed-frozen", "goal_problem", "The frozen plan is immutable.")],
      { skippedRoleIds: [], frozen: true, summaryVersionId: versionId, summaryVersion: 2 }
    ));
    const { container } = await render(SeedSummaryReview, {
      generationId,
      userId: "writer-1",
      versionId,
      readOnly: true,
      onClose: vi.fn(),
    });
    container.style.height = "844px";

    await expect.element(page.getByText("Signed-off plan", { exact: true })).toBeVisible();
    await expect.element(page.getByText("The frozen plan is immutable.", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Edit", exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Sign off and generate", exact: true }).elements()).toHaveLength(0);
    expect(container.textContent).not.toContain("Blocked by:");
    expect(container.querySelector("[data-summary-model]")?.textContent).toBe("claude-sonnet-test");
    expect(container.textContent).not.toContain("Writer Profile");
    // A regenerated Summary names its version beside the model.
    expect(container.querySelector("[data-summary-version]")?.textContent).toBe("Version 2");
    // The frozen view never subscribes to the live Outline.
    expect(__activeQueryArgs("seeds:getOutline")).toEqual([]);
    await page.screenshot({
      path: await captures.path("summary-review-narrow"),
      fullPage: false,
    });
  });

  it("retries a failed draft from the exact frozen Summary generation only with recovery capability", async () => {
    __setQueryData("seeds:getOutline", outline(true, true));
    __setQueryData("seeds:getSummary", onePage(
      [item("seed-frozen", "goal_problem", "The frozen plan is immutable.")],
      { frozen: true, summaryVersionId: versionId }
    ));
    const view = await render(SeedSummaryReview, {
      generationId,
      userId: "writer-1",
      versionId,
      readOnly: true,
      recovery: true,
      canRecover: false,
    });
    await expect.element(page.getByText("The frozen plan is immutable.", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Retry from this Summary", exact: true }).elements()).toHaveLength(0);

    await view.rerender({
      generationId,
      userId: "writer-1",
      versionId,
      readOnly: true,
      recovery: true,
      canRecover: true,
    });
    await page.getByRole("button", { name: "Retry from this Summary", exact: true }).click();
    expect(__mutationCalls("generations:retryFromSummary")).toEqual([{ failedGenerationId: generationId }]);
  });

  it("stops a Summary walk destroyed during a delayed nonterminal continuation before it can query again", async () => {
    let release: ((value: unknown) => void) | undefined;
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), new Promise((resolve) => {
      release = resolve;
    }));
    const view = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.poll(() => __clientQueryCalls("seeds:getSummary")).toEqual([continuation("cursor-2")]);
    view.unmount();

    release?.(firstPage({
      page: [item("seed-late", "experimentation", "Late nonterminal page.")],
      continueCursor: "cursor-3",
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(__clientQueryCalls("seeds:getSummary")).toEqual([continuation("cursor-2")]);
    expect(document.body.textContent).not.toContain("Late nonterminal page.");
  });

  it("refuses a new edit and an explicit rebase while Outline 13 precedes the displayed Summary 12, then adopts once Summary 13 is displayed", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-a", "company_context", "Server wording twelve."),
      item("seed-b", "goal_problem", "Second item twelve."),
    ]));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await bullet.fill("Wording against twelve.");

    // The Outline advances first; the complete Summary on screen is still 12,
    // so its wording must not be presented as the revision being adopted.
    __setQueryData("seeds:getOutline", outline(true, true, 13));
    const rebase = page.getByRole("button", { name: "Use current decision version", exact: true });
    await expect.element(rebase).toBeDisabled();
    await expect.element(page.getByText("The current wording is still loading. Your draft stays as typed until it is displayed.", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("Current wording:");
    await expect.element(page.getByRole("button", { name: "Save wording", exact: true })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
    await expect.element(bullet).toHaveValue("Wording against twelve.");
    expect(__mutationCalls("seeds:edit")).toEqual([]);

    // Replacement pages pending: the draft is kept on its base and the newer
    // fence is not adopted.
    let releaseReplacement: ((value: unknown) => void) | undefined;
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2-v13"), new Promise((resolve) => {
      releaseReplacement = resolve;
    }));
    __setQueryData("seeds:getSummary", firstPage({
      page: [item("seed-a", "company_context", "Remote wording thirteen.")],
      continueCursor: "cursor-2-v13",
      seedStageVersion: 13,
    }));
    await expect.element(page.getByText("Loading the complete Summary…", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Use current decision version", exact: true }).elements()).toHaveLength(0);
    expect(__mutationCalls("seeds:edit")).toEqual([]);
    expect(storedSummaryDrafts()["seed-a"]).toMatchObject({
      baseSeedStageVersion: 12,
      bulletOne: "Wording against twelve.",
    });

    releaseReplacement?.(secondPage({
      page: [item("seed-b", "goal_problem", "Second item thirteen.")],
      seedStageVersion: 13,
    }));
    await expect.element(page.getByText("Current wording: Remote wording thirteen.", { exact: true })).toBeVisible();
    await expect.element(bullet).toHaveValue("Wording against twelve.");
    await rebase.click();
    const save = page.getByRole("button", { name: "Save wording", exact: true });
    await expect.element(save).toBeEnabled();
    await save.click();
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-a",
      bullets: ["Wording against twelve."],
      expectedSeedStageVersion: 13,
    }]);
    // A new edit is offered again, against the displayed current revision.
    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Second item thirteen.");
  });

  it("saves the visible draft and announces retention loss when browser storage is unavailable from the start", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-a", "company_context", "Server wording A."),
      item("seed-b", "goal_problem", "Server wording B."),
    ]));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("This device cannot keep them across navigation or reload.");
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Typed without storage.");

    // Item switching keeps independent in-memory drafts.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Server wording B.");
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Second without storage.");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Typed without storage.");

    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-a",
      bullets: ["Typed without storage."],
      expectedSeedStageVersion: 12,
    }]);
    await expect.poll(() => page.getByRole("textbox").elements().length).toBe(0);
    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Second without storage.");
  });

  it("keeps editing and saving from memory when storage writes fail after a successful hydration", async () => {
    storeSummaryDrafts({
      "seed-a": {
        ownerGenerationId: generationId,
        ownerSummaryVersionId: "live",
        baseSeedStageVersion: 12,
        bulletOne: "Hydrated draft A.",
        bulletTwo: "",
      },
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-a", "company_context", "Server wording A."),
      item("seed-b", "goal_problem", "Server wording B."),
    ]));
    let finishSave: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:edit", new Promise((resolve) => { finishSave = resolve; }));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await expect.element(bullet).toHaveValue("Hydrated draft A.");
    expect(persistenceNotice()).toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await bullet.fill("Hydrated draft A. Typed after storage failed.");
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("Unsaved Summary edits stay in this open review only.");

    // Item switching keeps independent drafts in memory.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const bulletB = page.getByRole("textbox", { name: "Bullet 1" });
    await expect.element(bulletB).toHaveValue("Server wording B.");
    await bulletB.fill("Draft B in memory.");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Hydrated draft A. Typed after storage failed.");

    // Save submits the visible draft; text typed during the pending save is
    // compared against memory and kept.
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Hydrated draft A. Typed after storage failed. And during save.");
    finishSave?.(undefined);
    await expect.element(page.getByRole("button", { name: "Save wording", exact: true })).toBeEnabled();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Hydrated draft A. Typed after storage failed. And during save.");
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-a",
      bullets: ["Hydrated draft A. Typed after storage failed."],
      expectedSeedStageVersion: 12,
    })]);
    // Storage still holds the hydration-time mirror; memory is authoritative.
    expect(storedSummaryDrafts()["seed-a"].bulletOne).toBe("Hydrated draft A.");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Draft B in memory.");

    // Once the device accepts writes again, the next write mirrors every
    // pending item and the notice clears.
    vi.restoreAllMocks();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Draft B in memory, now mirrored.");
    await expect.poll(() => persistenceNotice()).toBeNull();
    const mirrored = storedSummaryDrafts();
    expect(mirrored["seed-b"].bulletOne).toBe("Draft B in memory, now mirrored.");
    expect(mirrored["seed-a"].bulletOne).toBe("Hydrated draft A. Typed after storage failed. And during save.");
  });

  it("removes a saved item's own record even while another item's refused write is queued ahead of it", async () => {
    storeSummaryDrafts({
      "seed-a": {
        ownerGenerationId: generationId,
        ownerSummaryVersionId: "live",
        baseSeedStageVersion: 12,
        bulletOne: "Hydrated draft A.",
        bulletTwo: "",
      },
    });
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-a", "company_context", "Server wording A."),
      item("seed-b", "goal_problem", "Server wording B."),
    ]));
    const first = await render(SeedSummaryReview, { generationId, userId: "writer-1" });

    // The other item's write is refused first, so it is queued ahead.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Server wording B.");
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Draft B queued first.");
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("Unsaved Summary edits stay in this open review only.");

    // Saving the hydrated item still removes its own stored record.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Hydrated draft A.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.poll(() => __mutationCalls("seeds:edit")).toEqual([expect.objectContaining({
      seedId: "seed-a",
      bullets: ["Hydrated draft A."],
      expectedSeedStageVersion: 12,
    })]);
    await expect.poll(() => storedSummaryDrafts()["seed-a"]).toBeUndefined();
    expect(storedSummaryDrafts()["seed-b"]).toBeUndefined();
    await expect.poll(() => persistenceNotice()?.textContent ?? "").toContain("Unsaved Summary edits stay in this open review only.");

    // Recreation cannot restore the saved wording as an unsaved draft.
    first.unmount();
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Server wording A.");
  });

  it("announces an Outline failure before the review loads, keeps mutation controls off, and retries by resubscribing", async () => {
    __setQueryError("seeds:getOutline", new ConvexError({
      code: "INVALID_STATE",
      message: "Readiness read failed",
    }));
    __setQueryData("seeds:getSummary", onePage([item("seed-a", "company_context", "Complete Summary item.")]));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.element(page.getByText("Complete Summary item.", { exact: true })).toBeVisible();
    await expect.poll(() => outlineAlert()?.textContent ?? "").toContain("Readiness read failed");
    expect(document.body.textContent).not.toContain("The plan changed after this review loaded");
    expect(document.body.textContent).not.toContain("Partial Summary");
    expect(page.getByRole("button", { name: "Edit", exact: true }).elements()).toHaveLength(0);
    expect(signOffButton().elements()).toHaveLength(0);

    await page.getByRole("button", { name: "Reload plan status", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getOutline")).toEqual([{ generationId }, "skip", { generationId }]);
    __setQueryData("seeds:getOutline", outline());
    await expect.poll(() => outlineAlert()).toBeNull();
    await expect.element(page.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
    await expect.element(signOffButton()).toBeEnabled();
  });

  it("announces an Outline failure after a successful review load separately, keeps the draft and complete pages, and restores actions on retry", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-a", "company_context", "Complete Summary item."),
      item("seed-b", "goal_problem", "Second complete item."),
    ]));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const bullet = page.getByRole("textbox", { name: "Bullet 1" });
    await bullet.fill("Draft kept through the Outline failure.");

    __setQueryData("seeds:getOutline", undefined);
    __setQueryError("seeds:getOutline", new ConvexError({
      code: "INVALID_STATE",
      message: "Readiness read failed",
    }));
    await expect.poll(() => outlineAlert()?.textContent ?? "").toContain("Readiness read failed");
    await expect.element(bullet).toHaveValue("Draft kept through the Outline failure.");
    await expect.element(page.getByText("Second complete item.", { exact: true })).toBeVisible();
    expect(document.body.textContent).not.toContain("The plan changed after this review loaded");
    expect(document.body.textContent).not.toContain("Partial Summary");
    await expect.element(page.getByRole("button", { name: "Save wording", exact: true })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
    await expect.element(signOffButton()).toBeDisabled();
    expect(__mutationCalls("seeds:edit")).toEqual([]);

    await page.getByRole("button", { name: "Reload plan status", exact: true }).click();
    await expect.poll(() => __queryArgsHistory("seeds:getOutline")).toEqual([{ generationId }, "skip", { generationId }]);
    __setQueryData("seeds:getOutline", outline());
    await expect.poll(() => outlineAlert()).toBeNull();
    const save = page.getByRole("button", { name: "Save wording", exact: true });
    await expect.element(save).toBeEnabled();
    await save.click();
    expect(__mutationCalls("seeds:edit")).toEqual([{
      generationId,
      roleId: "company_context",
      seedId: "seed-a",
      bullets: ["Draft kept through the Outline failure."],
      expectedSeedStageVersion: 12,
    }]);
  });

  it("keeps a Summary subscription error visible through a delayed continuation, drops that walk, and recovers only through an explicit reload", async () => {
    storeSummaryDrafts({
      "seed-a": {
        ownerGenerationId: generationId,
        ownerSummaryVersionId: "live",
        baseSeedStageVersion: 12,
        bulletOne: "Draft kept through the subscription failure.",
        bulletTwo: "",
      },
    });
    let release: ((value: unknown) => void) | undefined;
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", firstPage());
    __setQueryDataForArgs("seeds:getSummary", continuation("cursor-2"), new Promise((resolve) => {
      release = resolve;
    }));
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await expect.poll(() => __clientQueryCalls("seeds:getSummary")).toEqual([continuation("cursor-2")]);
    await expect.element(page.getByText("Loading the complete Summary…", { exact: true })).toBeVisible();

    // The live subscription fails while the continuation is still pending.
    __setQueryData("seeds:getSummary", undefined);
    __setQueryError("seeds:getSummary", new ConvexError({ code: "INVALID_STATE", message: "Summary subscription failed" }));
    await expect.element(page.getByRole("alert")).toHaveTextContent("Summary subscription failed");
    await expect.element(page.getByRole("button", { name: "Reload Summary", exact: true })).toBeEnabled();
    await expect.element(signOffButton()).toBeDisabled();
    expect(document.body.textContent).not.toContain("Loading the complete Summary…");

    // The obsolete continuation resolves successfully: it neither erases the
    // failure, nor publishes, nor requests another page.
    release?.(secondPage());
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect.element(page.getByRole("alert")).toHaveTextContent("Summary subscription failed");
    expect(__clientQueryCalls("seeds:getSummary")).toEqual([continuation("cursor-2")]);
    expect(document.body.textContent).not.toContain("Three load-band experiments refined the controller.");
    expect(document.body.textContent).not.toContain("The company designed adaptive controls.");
    await expect.element(signOffButton()).toBeDisabled();
    expect(storedSummaryDrafts()["seed-a"].bulletOne).toBe("Draft kept through the subscription failure.");

    await page.getByRole("button", { name: "Reload Summary", exact: true }).click();
    const args = { generationId, cursor: null, numItems: 50 };
    await expect.poll(() => __queryArgsHistory("seeds:getSummary")).toEqual([args, "skip", args]);
    __setQueryData("seeds:getSummary", onePage([item("seed-a", "company_context", "Recovered after the subscription failure.")]));
    await expect.element(page.getByText("Recovered after the subscription failure.", { exact: true })).toBeVisible();
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    await expect.element(signOffButton()).toBeEnabled();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Draft kept through the subscription failure.");
  });

  it("preserves another tab's independent Summary drafts across persist, save, discard and recreation", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-a", "company_context", "Server wording A."),
      item("seed-b", "goal_problem", "Server wording B."),
    ]));
    const stored = () => storedSummaryDrafts();
    // Two tabs of one user, generation and Summary, both hydrated before either writes.
    const tabA = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    const tabB = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    const inA = page.elementLocator(tabA.container);
    const inB = page.elementLocator(tabB.container);
    await inA.getByRole("button", { name: "Edit", exact: true }).first().click();
    await inA.getByRole("textbox", { name: "Bullet 1" }).fill("Tab A draft for item A.");
    await inB.getByRole("button", { name: "Edit", exact: true }).last().click();
    await inB.getByRole("textbox", { name: "Bullet 1" }).fill("Tab B draft for item B.");
    expect(stored()["seed-a"].bulletOne).toBe("Tab A draft for item A.");
    expect(stored()["seed-b"].bulletOne).toBe("Tab B draft for item B.");

    // Tab A saves: only its own item leaves storage.
    await inA.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.poll(() => stored()["seed-a"]).toBeUndefined();
    expect(stored()["seed-b"].bulletOne).toBe("Tab B draft for item B.");
    expect(__mutationCalls("seeds:edit")).toEqual([expect.objectContaining({ seedId: "seed-a", bullets: ["Tab A draft for item A."] })]);

    // Recreation hydrates the surviving independent draft; tab B's discard
    // removes only its own item.
    tabA.unmount();
    const tabC = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    const inC = page.elementLocator(tabC.container);
    await inC.getByRole("button", { name: "Edit", exact: true }).last().click();
    await expect.element(inC.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Tab B draft for item B.");
    await inC.getByRole("button", { name: "Edit", exact: true }).click();
    await inC.getByRole("textbox", { name: "Bullet 1" }).fill("Tab C draft for item A.");
    await inB.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => stored()["seed-b"]).toBeUndefined();
    expect(stored()["seed-a"].bulletOne).toBe("Tab C draft for item A.");
    await expect.element(inC.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Tab C draft for item A.");
  });

  it("lets a save that resolves after the review was recreated clear only its unchanged snapshot, never newer wording or independent drafts", async () => {
    __setQueryData("seeds:getOutline", outline());
    __setQueryData("seeds:getSummary", onePage([
      item("seed-a", "company_context", "Server wording A."),
      item("seed-b", "goal_problem", "Server wording B."),
    ]));
    const stored = () => storedSummaryDrafts();
    let finish: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:edit", new Promise((resolve) => { finish = resolve; }));
    const first = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Submitted A.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    await expect.element(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    first.unmount();

    // The recreated review types newer wording for the submitted item and an
    // independent draft, both before the old submission resolves.
    const second = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Submitted A.");
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Submitted A. Newer wording.");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Bullet 1" }).fill("Independent B.");
    finish?.(undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stored()["seed-a"].bulletOne).toBe("Submitted A. Newer wording.");
    expect(stored()["seed-b"].bulletOne).toBe("Independent B.");
    expect(page.getByRole("alert").elements()).toHaveLength(0);

    // Recreate again: both remain.
    second.unmount();
    await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Submitted A. Newer wording.");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Independent B.");

    // A late save whose snapshot is still unchanged in storage clears only that item.
    storeSummaryDrafts({
      "seed-a": { ownerGenerationId: generationId, ownerSummaryVersionId: "live", baseSeedStageVersion: 12, bulletOne: "Submitted A.", bulletTwo: "" },
      "seed-b": { ownerGenerationId: generationId, ownerSummaryVersionId: "live", baseSeedStageVersion: 12, bulletOne: "Independent B.", bulletTwo: "" },
    });
    document.body.innerHTML = "";
    let finishAgain: ((value: unknown) => void) | undefined;
    __setMutationResult("seeds:edit", new Promise((resolve) => { finishAgain = resolve; }));
    const third = await render(SeedSummaryReview, { generationId, userId: "writer-1" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await expect.element(page.getByRole("textbox", { name: "Bullet 1" })).toHaveValue("Submitted A.");
    await page.getByRole("button", { name: "Save wording", exact: true }).click();
    third.unmount();
    finishAgain?.(undefined);
    await expect.poll(() => stored()["seed-a"]).toBeUndefined();
    expect(stored()["seed-b"].bulletOne).toBe("Independent B.");
  });
});
