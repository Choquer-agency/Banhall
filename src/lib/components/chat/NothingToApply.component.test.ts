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

beforeEach(() => {
  __resetConvexStub();
  // Phase A: Apply is offered to people with report edit access only.
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
});

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

    // Every finding, its kind and place, its status and its evidence. The id
    // is internal (owner direction 2026-10-21): only the test hook keeps it.
    await expect.element(page.getByText("Your request", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Reference PD", { exact: true })).toBeVisible();
    expect(container.textContent).not.toContain("c-246-3-1");
    expect(container.textContent).not.toContain("x-246-4-1");
    expect(container.querySelector('[data-checklist-item="c-246-3-1"]')).not.toBeNull();
    expect(container.querySelector('[data-checklist-item="x-246-4-1"]')).not.toBeNull();
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

/**
 * Owner direction 2026-10-21: a writer asked what "r-244-4-2" was. Item ids
 * are internal, so a checklist line shows a plain kind ("Rule", "Your
 * request", "Reference PD") next to its Line and paragraph instead.
 */
describe("Completion Report items name their kind and place, never their id", () => {
  const item = (overrides: Partial<Doc<"chatProposalItems">>): Doc<"chatProposalItems"> => ({
    _id: "item-x" as Id<"chatProposalItems">,
    _creationTime: 1,
    proposalId,
    projectId: "project" as Id<"projects">,
    itemId: "r-244-4-2",
    status: "blocked",
    reason: "The draft cannot name the fictional test rig.",
    missingFact: "The rig's model number.",
    missingFactSource: "The April interview transcript.",
    createdAt: 1,
    ...overrides,
  });

  it("shows Rule and Line 244, paragraph 4, and not the id text", async () => {
    __setQueryData("chatV2:listProposalItems", [
      item({ _id: "item-r" as Id<"chatProposalItems">, section: "244", paragraphNumber: 4, kind: "rule" }),
    ]);
    const { container } = await render(ProposalCard, { proposal: zeroEditProposal });
    await expect.element(page.getByText("Rule", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Line 244, paragraph 4", { exact: true })).toBeVisible();
    expect(container.textContent).not.toContain("r-244-4-2");
    expect(container.querySelector('[data-checklist-item="r-244-4-2"]')).not.toBeNull();
  });

  it("shows the kind alone without a place, and no label for an unknown prefix", async () => {
    __setQueryData("chatV2:listProposalItems", [
      item({ _id: "item-c" as Id<"chatProposalItems">, itemId: "c-246-2-1" }),
      item({ _id: "item-q" as Id<"chatProposalItems">, itemId: "q-246-3-1", reason: "A fictional item of another shape." }),
    ]);
    const { container } = await render(ProposalCard, { proposal: zeroEditProposal });
    await expect.element(page.getByText("Your request", { exact: true })).toBeVisible();
    expect(container.textContent).not.toContain("Line 246");
    const unknown = container.querySelector('[data-checklist-item="q-246-3-1"]');
    expect(unknown).not.toBeNull();
    expect(unknown?.textContent).not.toContain("q-246-3-1");
    for (const label of ["Rule", "Your request", "Reference PD"]) {
      expect(unknown?.textContent).not.toContain(label);
    }
    expect(unknown?.textContent).toContain("Blocked");
    expect(container.textContent).not.toContain("c-246-2-1");
  });
});
