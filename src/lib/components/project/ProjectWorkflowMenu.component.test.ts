import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { ConvexError } from "convex/values";
import ProjectWorkflowMenu from "./ProjectWorkflowMenu.svelte";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

const mutation = "projectWorkflow:setWorkflowStage";

// Real menu/dialog and browser interactions; only Convex transport is stubbed.
// Persistence/atomicity remain covered by convex/projectWorkflow.test.ts.
async function openStageChange(stage: "internal_review" | "drafting" = "internal_review") {
  __setQueryData("projectWorkflow:getProjectWorkflowHeader", {
    workflowStage: stage,
    workflowUpdatedAt: 1,
    owner: { initials: "DW", label: "Demo Writer" },
    ownerNeedsReview: false,
    stageIsFallback: false,
    workflowVersion: 7,
    viewerAuthorities: ["owner"],
  });
  __setQueryData("workItems:getProjectWorkPanel", {
    currentHandoffId: null,
    openItems: [],
    viewer: { canCreate: true, canCreateFinancial: false },
    assignable: true,
    assignableReason: null,
    pointerHealthy: true,
    truncated: false,
  });
  __setMutationResult(mutation, { status: "updated", version: 8 });
  await render(ProjectWorkflowMenu, { projectId: "project-1" as never });
  await page.getByRole("button", { name: "Workflow details", exact: true }).click();
  await page.getByRole("button", { name: /Status.*Change/ }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
}

describe("ProjectWorkflowMenu production stage submission", () => {
  beforeEach(() => {
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("returns internal review for edits with its decision, audit note and workflow version", async () => {
    await openStageChange();
    await page.getByRole("radio", { name: /^Edits/ }).click();
    await page.getByRole("textbox", { name: "Audit note" }).fill("  Clarify the uncertainty evidence.  ");
    await page.getByRole("button", { name: "Change stage", exact: true }).click();

    await expect.poll(() => __mutationCalls(mutation)).toStrictEqual([{
      projectId: "project-1",
      toStage: "edits",
      note: "Clarify the uncertainty evidence.",
      expectedVersion: 7,
      reviewDecision: { decision: "return" },
    }]);
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(__mutationCalls(mutation)).toHaveLength(1);
    await expect.element(page.getByRole("button", { name: "Workflow details", exact: true })).toBeVisible();
  });

  it.each([
    { source: "internal_review", destination: "drafting", label: /^Drafting/ },
    { source: "drafting", destination: "edits", label: /^Edits/ },
  ] as const)("omits reviewDecision from $source to $destination", async ({ source, destination, label }) => {
    await openStageChange(source);
    await page.getByRole("radio", { name: label }).click();
    await page.getByRole("button", { name: "Change stage", exact: true }).click();

    await expect.poll(() => __mutationCalls(mutation)).toStrictEqual([{
      projectId: "project-1",
      toStage: destination,
      note: undefined,
      expectedVersion: 7,
    }]);
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(__mutationCalls(mutation)).toHaveLength(1);
  });

  it("keeps a rejected review return open with its note and server explanation", async () => {
    await openStageChange();
    __setMutationError(mutation, new ConvexError({
      code: "INVALID_STATE",
      message: "There is no report revision to record a review decision against.",
    }));
    await page.getByRole("radio", { name: /^Edits/ }).click();
    await page.getByRole("textbox", { name: "Audit note" }).fill("Clarify the uncertainty evidence.");
    await page.getByRole("button", { name: "Change stage", exact: true }).click();

    await expect.element(page.getByRole("alert")).toHaveTextContent(
      "There is no report revision to record a review decision against."
    );
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.element(page.getByRole("radio", { name: /^Edits/ })).toHaveAttribute("aria-checked", "true");
    await expect.element(page.getByRole("textbox", { name: "Audit note" })).toHaveValue(
      "Clarify the uncertainty evidence."
    );
    await expect.element(page.getByRole("button", { name: "Change stage", exact: true })).toBeEnabled();
    expect(__mutationCalls(mutation)).toStrictEqual([{
      projectId: "project-1",
      toStage: "edits",
      note: "Clarify the uncertainty evidence.",
      expectedVersion: 7,
      reviewDecision: { decision: "return" },
    }]);

    __setMutationResult(mutation, { status: "updated", version: 8 });
    await page.getByRole("button", { name: "Change stage", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(__mutationCalls(mutation)).toHaveLength(2);
    expect(__mutationCalls(mutation)[1]).toStrictEqual(__mutationCalls(mutation)[0]);
  });
});
