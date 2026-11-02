/**
 * 2026-11-02 (client meeting, rule overrides): a suggestion card that goes
 * against a house rule, the template or a CRA limit names the rules. A manager
 * accepts it only after "This change goes against ... Apply it anyway?"; a
 * writer sees why they cannot ("A manager can apply this change."). All data
 * is fictional.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { __resetAuthState } from "$lib/test/convex-auth-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import type { AssistantCards, ReviewSession } from "$lib/chat/assistantCards.svelte";
import SuggestionCardsFixture from "./SuggestionCardsFixture.svelte";

const CAPTURES = "../../../../.vitest-attachments/rule-override";
const projectId = "project-1" as Id<"projects">;
const reportId = "report-1" as Id<"reports">;

type Card = Doc<"chatProposals"> & { undoable?: boolean };

const RULES = [
  { kind: "house_rule" as const, name: "First person", reason: "The transcript says the company, so the paragraph drops we." },
];

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    _id: id as Id<"chatProposals">, _creationTime: 0, projectId, reportId, agentThreadId: "thread-1",
    kind: "edit", section: "244",
    targetText: "We ran the door-open trials at three set points.",
    newText: "The company ran the door-open trials at three set points, as the interview describes.",
    requireUniqueTarget: true, state: "pending", createdAt: 0, ...extra,
  } as Card;
}

const overrideCard = (extra: Partial<Card> = {}) => card("card-override", { rulesBroken: RULES, ...extra });

async function mount(proposals: Card[], review = true) {
  let state!: { cards: AssistantCards; session: ReviewSession };
  const view = await render(SuggestionCardsFixture, { proposals, review, onReady: (ready) => (state = ready) });
  return { view, ...state };
}

beforeEach(() => {
  __resetConvexStub();
  __resetAuthState();
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true, canOverrideRules: true });
  __setMutationResult("chatV2:applyProposal", { applied: true, count: 1 });
});

describe("a card that goes against a rule", () => {
  it("says so when folded, and names the rule and the reason when opened", async () => {
    await page.viewport(900, 420);
    await mount([overrideCard()]);
    await expect.element(page.getByText("Goes against a rule", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show the suggestion" }).click();
    await expect
      .element(page.getByText('This change goes against the house rule "First person".', { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText(RULES[0].reason)).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/manager-card-opened.png` });
  });

  it("a manager confirms the rule by name, and only then is the card applied with that confirmation", async () => {
    await page.viewport(1100, 600);
    const { cards } = await mount([overrideCard()], false);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();

    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toBeVisible();
    await expect
      .element(dialog.getByText('This change goes against the house rule "First person". Apply it anyway?'))
      .toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/confirm-dialog.png` });
    // Nothing is applied while the question is open.
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([]);

    await dialog.getByRole("button", { name: "Apply anyway" }).click();
    await expect
      .poll(() => __mutationCalls("chatV2:applyProposal"))
      .toEqual([{ proposalId: "card-override", overrideRules: ["First person"] }]);
    await expect.poll(() => cards.lastAccepted).toEqual([{ proposalId: "card-override", line: "244" }]);
  });

  it("says Export stays blocked when the card goes past a CRA limit, and only then (owner, 2026-11-02)", async () => {
    const craRules = [
      { kind: "cra_limit" as const, name: "Line 244 word cap", reason: "The writer asked to keep the full test list." },
    ];
    await mount([overrideCard({ rulesBroken: craRules })], false);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect
      .element(
        dialog.getByText(
          "Export stays blocked until the Line fits the CRA limit again, because the CRA form would cut off the extra lines or words."
        )
      )
      .toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it("names no Export block for a house rule", async () => {
    await mount([overrideCard()], false);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    expect(document.querySelector("[data-rule-override-export-note]")).toBeNull();
  });

  it("Cancel applies nothing and shows no error", async () => {
    await mount([overrideCard()], false);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([]);
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    // Still waiting, and Accept still offered.
    await expect.element(page.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  });

  it("the review bar's Accept asks the same question in the report", async () => {
    await page.viewport(1100, 600);
    const { session } = await mount([overrideCard()]);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("toolbar", { name: "Review suggestion" }).getByRole("button", { name: "Accept" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    // Backing out keeps the review open, with no error on the bar.
    await expect.poll(() => session.target?.proposalId).toBe("card-override");
    expect(session.error).toBeNull();
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([]);

    await page.getByRole("toolbar", { name: "Review suggestion" }).getByRole("button", { name: "Accept" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Apply anyway" }).click();
    await expect
      .poll(() => __mutationCalls("chatV2:applyProposal"))
      .toEqual([{ proposalId: "card-override", overrideRules: ["First person"] }]);
  });

  it("a writer sees the rule and that a manager can apply it, with no Review, Accept or Edit wording", async () => {
    await page.viewport(900, 420);
    __setQueryData("projects:getProjectEditAccess", { canEditDetails: true, canOverrideRules: false });
    await mount([overrideCard()]);
    expect(page.getByRole("button", { name: "Review", exact: true }).elements()).toHaveLength(0);
    await page.getByRole("button", { name: "Show the suggestion" }).click();
    await expect
      .element(page.getByText('This change goes against the house rule "First person".', { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("A manager can apply this change.", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Accept", exact: true }).elements()).toHaveLength(0);
    await page.screenshot({ path: `${CAPTURES}/writer-card-opened.png` });
    // Dismiss stays: anyone who can edit the report may turn the card down.
    await page.getByRole("button", { name: "More actions for this suggestion" }).click();
    await expect.element(page.getByRole("menuitem", { name: "Dismiss" })).toBeVisible();
    expect(page.getByRole("menuitem", { name: "Edit wording" }).elements()).toHaveLength(0);
  });

  it("an accepted override names the rules it was applied against", async () => {
    await mount([
      overrideCard({
        state: "applied",
        ruleOverrides: [{ userId: "user-1" as Id<"users">, at: 1, rules: ["First person"] }],
      }),
    ]);
    await page.getByRole("button", { name: "Show what was accepted" }).click();
    await expect
      .element(page.getByText('Applied against the house rule "First person".', { exact: true }))
      .toBeVisible();
  });
});

describe("Accept all", () => {
  it("is not offered when one of the waiting cards goes against a rule", async () => {
    await mount([
      card("card-242", { section: "242", targetText: "First passage.", newText: "First passage, tightened." }),
      overrideCard(),
    ]);
    await expect.element(page.getByText("Goes against a rule", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Accept all" }).elements()).toHaveLength(0);
  });

  it("is still offered for cards that break no rule", async () => {
    await mount([
      card("card-242", { section: "242", targetText: "First passage.", newText: "First passage, tightened." }),
      card("card-246", { section: "246", targetText: "Second passage.", newText: "Second passage, tightened." }),
    ]);
    await expect.element(page.getByRole("button", { name: "Accept all" })).toBeVisible();
  });
});
