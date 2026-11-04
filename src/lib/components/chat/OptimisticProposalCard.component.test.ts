import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { __mutationCalls, __resetConvexStub, __setMutationResult, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import ProposalCard from "./ProposalCard.svelte";
import SuggestionCardsFixture from "./SuggestionCardsFixture.svelte";

function proposal(extra: Partial<Doc<"chatProposals">> = {}): Doc<"chatProposals"> {
  return {
    _id: "proposal-1" as Id<"chatProposals">,
    _creationTime: 0,
    projectId: "project-1" as Id<"projects">,
    reportId: "report-1" as Id<"reports">,
    agentThreadId: "thread-1",
    kind: "edit",
    state: "pending",
    createdAt: 0,
    section: "244",
    targetText: "Old wording.",
    newText: "New wording.",
    ...extra,
  };
}

beforeEach(() => {
  __resetConvexStub();
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true, canOverrideRules: false });
});

describe("optimistic proposal apply", () => {
  it("shows Accepted while applyProposal is pending and rolls back on refusal", async () => {
    let rejectApply!: (error: Error) => void;
    __setMutationResult("chatV2:applyProposal", new Promise((_resolve, reject) => { rejectApply = reject; }));
    await render(ProposalCard, { proposal: proposal() });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect.element(page.getByText("Accepted", { exact: true })).toBeVisible();
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([{ proposalId: "proposal-1" }]);
    rejectApply(new Error("refused"));
    await expect.element(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
    await expect.element(page.getByText("Accepted", { exact: true })).not.toBeInTheDocument();
  });

  it("does not show a manager-only card as applied for a writer", async () => {
    await render(ProposalCard, { proposal: proposal({
      rulesBroken: [{ kind: "house_rule", name: "First person", reason: "Use the company name." }],
    }) });
    await page.getByRole("button", { name: "Show the suggestion" }).click();
    await expect.element(page.getByText("A manager can apply this change.")).toBeVisible();
    expect(document.querySelector('[data-proposed-edit-state="applied"]')).toBeNull();
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([]);
  });

  it("shows the first Accept all card immediately and restores the tray on refusal", async () => {
    let rejectApply!: (error: Error) => void;
    __setMutationResult("chatV2:applyProposal", new Promise((_resolve, reject) => { rejectApply = reject; }));
    await render(SuggestionCardsFixture, {
      proposals: [proposal(), proposal({ _id: "proposal-2" as Id<"chatProposals">, section: "246" })],
      review: false,
    });
    await page.getByRole("button", { name: "Accept all" }).click();
    await expect.element(page.getByText("Accepted", { exact: true })).toBeVisible();
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([{ proposalId: "proposal-1" }]);
    rejectApply(new Error("refused"));
    await expect.element(page.getByRole("button", { name: "Accept all" })).toBeVisible();
    expect(document.querySelectorAll('[data-proposed-edit-state="applied"]')).toHaveLength(0);
  });
});
