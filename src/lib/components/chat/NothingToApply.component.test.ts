import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  __mutationCalls,
  __resetConvexStub,
  __setQueryData,
  __setQueryError,
} from "$lib/test/convex-svelte-stub.svelte";
import ProposalCard from "./ProposalCard.svelte";

/**
 * DW-135 (AD-28 amendment, approved 2026-09-14): a Coordinated Revision whose
 * every finding is blocked or conflicting is saved with zero edits. Its card
 * shows the findings and offers nothing to apply: no Apply, no Reject, no
 * wording editor, and no mutation is ever sent.
 */

beforeEach(() => __resetConvexStub());

const proposalId = "proposal-zero" as Id<"chatProposals">;

const zeroEditProposal: Doc<"chatProposals"> = {
  _id: proposalId,
  _creationTime: 0,
  projectId: "project" as Id<"projects">,
  reportId: "report" as Id<"reports">,
  agentThreadId: "thread",
  kind: "replacements",
  state: "applied",
  createdAt: 0,
  replacements: [],
  requireUniqueTargets: true,
};

const items: Doc<"chatProposalItems">[] = [
  {
    _id: "item-1" as Id<"chatProposalItems">,
    _creationTime: 1,
    proposalId,
    projectId: "project" as Id<"projects">,
    itemId: "c-246-3-1",
    status: "blocked",
    reason: "The draft cannot state the cycle count.",
    missingFact: "The number of fatigue cycles run in 2025.",
    missingFactSource: "The March interview transcript.",
    section: "246",
    paragraphNumber: 3,
    kind: "content",
    createdAt: 1,
  },
  {
    _id: "item-2" as Id<"chatProposalItems">,
    _creationTime: 2,
    proposalId,
    projectId: "project" as Id<"projects">,
    itemId: "x-246-4-1",
    status: "conflicting",
    reason: "The Reference PD adds a fifth advancement paragraph.",
    lockedRule: "Line 246 line cap of 50.",
    alternative: "Fold the fifth advancement into paragraph 4 inside the cap.",
    section: "246",
    paragraphNumber: 4,
    kind: "reference",
    createdAt: 2,
  },
];

// Board 2.1 renamed Reject to Dismiss and moved Edit wording and Refine into
// the card's More menu; the guard covers the old and the new names.
const ACTION_NAMES = [
  "Apply",
  "Apply all",
  "Review individually",
  "Edit wording",
  "Reject",
  "Dismiss",
  "More actions for this suggestion",
  "Save & apply",
];

describe("zero-edit proposal card (DW-135)", () => {
  it("shows the blocked and conflicting findings and no apply action", async () => {
    await page.viewport(480, 640);
    __setQueryData("chatV2:listProposalItems", items);
    const { container } = await render(ProposalCard, {
      proposal: zeroEditProposal,
      onReviewReplacements: vi.fn(),
      onRefine: vi.fn(),
    });
    // Captured before any assertion so the pre-fix run records the old card.
    await page.screenshot({ path: "../../../../.vitest-attachments/DW-135/nothing-to-apply.png" });

    await expect.element(page.getByText("Nothing to apply", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("These findings need a writer's decision.", { exact: false }))
      .toBeVisible();

    // Every finding, its id verbatim, its status and its evidence.
    await expect.element(page.getByText("c-246-3-1", { exact: true })).toBeVisible();
    await expect.element(page.getByText("x-246-4-1", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Blocked", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Conflicting", { exact: true })).toBeVisible();
    expect(container.textContent).toContain("The number of fatigue cycles run in 2025.");
    expect(container.textContent).toContain("The March interview transcript.");
    expect(container.textContent).toContain("Line 246 line cap of 50.");
    expect(container.textContent).toContain("Fold the fifth advancement into paragraph 4 inside the cap.");
    expect(container.textContent).toContain("Line 246, paragraph 3");

    // No apply-shaped control of any kind, and no misleading "replacement" copy.
    for (const name of ACTION_NAMES) {
      expect(page.getByRole("button", { name, exact: true }).elements(), name).toHaveLength(0);
    }
    expect(container.textContent).not.toContain("Suggested replacement");
    expect(container.textContent).not.toContain("Suggested edit");
    expect(container.querySelector("[data-proposed-edit]")).toBeNull();
    expect(container.textContent).not.toContain("Delete the selected passage");
    expect(container.textContent).not.toContain("Replaced in report");
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([]);

    // Design system: no weight above 500 anywhere on the card.
    for (const element of container.querySelectorAll("*")) {
      expect(Number.parseInt(getComputedStyle(element).fontWeight, 10)).toBeLessThanOrEqual(500);
    }
  });

  it("says the findings are loading, then that they could not load, without offering an action", async () => {
    const { container, unmount } = await render(ProposalCard, { proposal: zeroEditProposal });
    await expect.element(page.getByText("Nothing to apply", { exact: true })).toBeVisible();
    expect(container.textContent).toContain("Loading findings");
    for (const name of ACTION_NAMES) {
      expect(page.getByRole("button", { name, exact: true }).elements(), name).toHaveLength(0);
    }
    unmount();

    __setQueryError("chatV2:listProposalItems", new Error("Server Error"));
    const failed = await render(ProposalCard, { proposal: zeroEditProposal });
    const alert = failed.container.querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toBe("Couldn't load the findings. Try reloading the page.");
  });

  it("names the card by its heading and says when no findings were recorded", async () => {
    __setQueryData("chatV2:listProposalItems", []);
    const { container } = await render(ProposalCard, { proposal: zeroEditProposal });
    // The section takes its accessible name from the visible heading, once.
    await expect.element(page.getByRole("region", { name: "Nothing to apply" })).toBeVisible();
    expect(container.querySelectorAll('[aria-label="Nothing to apply"]')).toHaveLength(0);
    expect(container.textContent).toContain("No findings were recorded.");
    expect(container.textContent).not.toContain("Loading findings");
    for (const name of ACTION_NAMES) {
      expect(page.getByRole("button", { name, exact: true }).elements(), name).toHaveLength(0);
    }
  });

  it("leaves an ordinary coordinated revision with edits on the apply card", async () => {
    __setQueryData("chatV2:listProposalItems", items);
    await render(ProposalCard, {
      proposal: {
        ...zeroEditProposal,
        _id: "proposal-edits" as Id<"chatProposals">,
        state: "pending",
        replacements: [{ find: "An old passage.", replaceWith: "A corrected passage." }],
      },
      onReviewReplacements: vi.fn(),
    });
    await expect.element(page.getByRole("button", { name: "Apply", exact: true })).toBeVisible();
    expect(page.getByText("Nothing to apply", { exact: true }).elements()).toHaveLength(0);
  });
});
