import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import ProposalCard from "./ProposalCard.svelte";

beforeEach(() => {
  __resetConvexStub();
  // Phase A: actions are offered to people with report edit access only.
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
});

// Owner 2026-10-28: every card is reviewed the same way; a find/replace card
// says it replaces every match inside its own Line.
it.each([false, true])("reviews a replacement set like any card, passage set=%s", async (bulk) => {
  const proposal: Doc<"chatProposals"> = {
    _id: "proposal" as Id<"chatProposals">, _creationTime: 0,
    projectId: "project" as Id<"projects">, reportId: "report" as Id<"reports">,
    agentThreadId: "thread", kind: "replacements", state: "pending", createdAt: 0, section: "244",
    replacements: [{ find: "An old passage.", replaceWith: "A corrected passage." }],
    requireUniqueTargets: bulk,
  };
  await render(ProposalCard, { proposal });
  await expect.element(page.getByText("Line 244", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: "Review individually", exact: true }).elements()).toHaveLength(0);
  await page.getByRole("button", { name: "Show the suggestion" }).click();
  expect(page.getByText("Replaces every match in Line 244.", { exact: true }).elements()).toHaveLength(bulk ? 0 : 1);
});
