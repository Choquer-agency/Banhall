import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { __resetConvexStub } from "$lib/test/convex-svelte-stub.svelte";
import ProposalCard from "./ProposalCard.svelte";

beforeEach(() => __resetConvexStub());

it.each([false, true])("offers individual review only for ordinary replacement sets, bulk=%s", async bulk => {
  const proposal: Doc<"chatProposals"> = {
    _id: "proposal" as Id<"chatProposals">, _creationTime: 0,
    projectId: "project" as Id<"projects">, reportId: "report" as Id<"reports">,
    agentThreadId: "thread", kind: "replacements", state: "pending", createdAt: 0,
    replacements: [{ find: "An old passage.", replaceWith: "A corrected passage." }],
    requireUniqueTargets: bulk,
  };
  await render(ProposalCard, { proposal, onReviewReplacements: vi.fn() });
  expect(page.getByRole("button", { name: "Review individually", exact: true }).elements())
    .toHaveLength(bulk ? 0 : 1);
  await expect.element(page.getByRole("button", { name: bulk ? "Apply" : "Apply all", exact: true })).toBeVisible();
});
