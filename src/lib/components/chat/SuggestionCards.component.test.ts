/**
 * Owner 2026-10-28 (Paper rows 32 to 36): one suggestion card per Line,
 * Review in the report, the accepted teal line, Done and Undone lines, the
 * Accept all tray and the chat notice for a refused Undo. All data is
 * fictional.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
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

const CAPTURES = "../../../../.vitest-attachments/assistant-redesign";
const projectId = "project-1" as Id<"projects">;
const reportId = "report-1" as Id<"reports">;

type Card = Doc<"chatProposals"> & { undoable?: boolean };

function card(id: string, extra: Partial<Card> = {}): Card {
  return {
    _id: id as Id<"chatProposals">, _creationTime: 0, projectId, reportId, agentThreadId: "thread-1",
    kind: "edit", section: "242",
    targetText: "Loops tuned for steady load could not hold that band once door-open events pushed warm air into the room.",
    newText: "Loops tuned for steady load drifted out of the band whenever the door opened.",
    requireUniqueTarget: true, state: "pending", createdAt: 0, ...extra,
  } as Card;
}

const withOptions = (extra: Partial<Card> = {}) =>
  card("card-242", {
    alternatives: [
      { replacements: [{ find: card("x").targetText!, replaceWith: "Steady-load loops drifted out of the band when the door opened." }] },
      { replacements: [{ find: card("x").targetText!, replaceWith: "Each door opening pushed the loops out of the band." }] },
    ],
    ...extra,
  });

async function mount(proposals: Card[], review = true) {
  let state!: { cards: AssistantCards; session: ReviewSession };
  const view = await render(SuggestionCardsFixture, { proposals, review, onReady: (ready) => (state = ready) });
  return { view, ...state };
}

beforeEach(() => {
  __resetConvexStub();
  __resetAuthState();
  __setQueryData("projects:getProjectEditAccess", { canEditDetails: true });
  __setMutationResult("chatV2:applyProposal", { applied: true, count: 1 });
  __setMutationResult("chatV2:undoProposal", { undone: true, revisionNumber: 2 });
});

describe("a folded card", () => {
  it("names its Line, how many options it has, and offers Review", async () => {
    await page.viewport(900, 300);
    await mount([withOptions()]);
    await expect.element(page.getByText("Line 242", { exact: true })).toBeVisible();
    await expect.element(page.getByText("3 options", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/v1-folded-card.png` });
  });

  it("opens to Option 1, marked Recommended, and pages through the others", async () => {
    await mount([withOptions()]);
    await page.getByRole("button", { name: "Show the suggestion" }).click();
    await expect.element(page.getByText("Option 1", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Recommended", { exact: true })).toBeVisible();
    await expect.element(page.getByText("1 of 3", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/v2-card-opened.png` });

    await page.getByRole("button", { name: "Next option" }).click();
    await expect.element(page.getByText("Option 2", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Steady-load loops drifted out of the band when the door opened.")).toBeVisible();
    expect(page.getByText("Recommended", { exact: true }).elements()).toHaveLength(0);
  });

  it("offers no Review to someone who cannot edit the report", async () => {
    __setQueryData("projects:getProjectEditAccess", { canEditDetails: false });
    await mount([withOptions()]);
    await expect.element(page.getByText("Line 242", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Review", exact: true }).elements()).toHaveLength(0);
  });
});

describe("Review", () => {
  it("starts the report review, follows the card's option, and accepts the option on show", async () => {
    await page.viewport(1100, 420);
    const { session, cards } = await mount([withOptions()]);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    expect(session.target?.proposalId).toBe("card-242");
    expect(session.pairs[0]?.replaceWith).toBe("Loops tuned for steady load drifted out of the band whenever the door opened.");

    // The card is under review: Stop review and Accept; the bar says which option.
    await expect.element(page.getByRole("button", { name: "Stop review" }).first()).toBeVisible();
    await expect.element(page.getByRole("toolbar", { name: "Review suggestion" })).toHaveTextContent(/Option 1\s*Recommended/);
    await page.screenshot({ path: `${CAPTURES}/v3-under-review.png` });

    await page.getByRole("button", { name: "Next option" }).click();
    expect(session.option).toBe(1);
    await expect.element(page.getByRole("toolbar", { name: "Review suggestion" })).toHaveTextContent("Option 2");

    // Show changes off on the bar.
    await page.getByRole("switch", { name: "Show changes" }).click();
    expect(session.showChanges).toBe(false);

    await page.getByRole("toolbar", { name: "Review suggestion" }).getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => __mutationCalls("chatV2:applyProposal")).toEqual([{ proposalId: "card-242", option: 1 }]);
    await expect.poll(() => session.target).toBeNull();
    expect(cards.lastAccepted).toEqual([{ proposalId: "card-242", line: "242", option: 1 }]);
  });

  it("ends a review the report cannot show and says why in the chat (live check 2026-10-28)", async () => {
    const { session, cards } = await mount([withOptions()]);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    expect(session.target?.proposalId).toBe("card-242");
    // The page's editor found none of the card's words in the report.
    session.nothingToShow();
    expect(session.target).toBeNull();
    await expect.element(page.getByText("Couldn't review. Line 242 was edited after this suggestion was made.")).toBeVisible();
    expect(cards.notice?.action).toBeUndefined();
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([]);
    await expect.element(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  });

  it("Stop review ends the review and leaves the card as it was", async () => {
    const { session } = await mount([withOptions()]);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("toolbar", { name: "Review suggestion" }).getByRole("button", { name: "Stop review" }).click();
    expect(session.target).toBeNull();
    expect(__mutationCalls("chatV2:applyProposal")).toEqual([]);
    await expect.element(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  });

  it("shows the change in the card where no report is beside the chat", async () => {
    await page.viewport(480, 420);
    await mount([card("card-solo")], false);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect.element(page.getByLabelText("Proposed changes")).toBeVisible();
    expect(document.querySelectorAll("[aria-label='Proposed changes'] .line-through").length).toBeGreaterThan(0);
    await page.screenshot({ path: `${CAPTURES}/review-in-card.png` });
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:applyProposal")).toEqual([{ proposalId: "card-solo" }]);
  });

  it("tells a refused accept in the chat", async () => {
    __setMutationResult("chatV2:applyProposal", { applied: false, count: 0, reason: "Couldn't find the original passage in the current report." });
    await mount([card("card-stale")]);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("toolbar", { name: "Review suggestion" }).getByRole("button", { name: "Accept" }).click();
    await expect.element(page.getByText("Couldn't find the original passage in the current report.")).toBeVisible();
  });
});

describe("after Accept", () => {
  it("folds an accepted card to one teal line; opened, it always offers Undo", async () => {
    await page.viewport(480, 360);
    await mount([withOptions({ state: "applied", appliedOption: 1, undoable: true })]);
    await expect.element(page.getByText("Option 2 accepted", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Done. Option 2 is now in Line 242.", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/v5-accepted.png` });

    await page.getByRole("button", { name: "Show what was accepted" }).click();
    await expect.element(page.getByText("Steady-load loops drifted out of the band when the door opened.")).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/v6-accepted-opened.png` });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => __mutationCalls("chatV2:undoProposal")).toEqual([{ proposalId: "card-242" }]);
  });

  it("says Done for a single version and Undone once a card is undone", async () => {
    const first = await mount([card("card-a", { state: "applied", undoable: true })]);
    await expect.element(page.getByText("Accepted", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Done. Line 242 is updated.", { exact: true })).toBeVisible();
    first.view.unmount();

    await mount([card("card-b", { undoneAt: 5 })]);
    await expect.element(page.getByText("Undone. Line 242 is back to how it was.", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Review", exact: true })).toBeVisible();
  });

  it("tells an Undo refused for a later edit in the chat, with Version history", async () => {
    const data = { code: "PROPOSAL_UNDO_CONFLICT", message: "This passage changed after it was applied, so it can't be undone here. Use Version history to go back." };
    __setMutationResult("chatV2:undoProposal", { then(_resolve: unknown, reject: (reason: unknown) => void) { reject(new ConvexError(data)); } });
    const { cards } = await mount([card("card-a", { state: "applied", undoable: true })]);
    await page.getByRole("button", { name: "Show what was accepted" }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.element(page.getByText("Couldn't undo. Line 242 was edited after you accepted it.")).toBeVisible();
    expect(cards.notice?.action).toBe("version_history");
  });
});

describe("Accept all", () => {
  const two = () => [
    card("card-242"),
    card("card-244", {
      section: "244",
      targetText: "From January 2026 they added the coil temperature as a second input and ran 12 trials across three room loads, adjusting the prediction window after each trial.",
      newText: "From January 2026 they added the coil temperature as a second input and ran 12 trials at three room loads.",
    }),
  ];

  it("puts two waiting cards from one reply in a tray and accepts them in Line order", async () => {
    await page.viewport(480, 360);
    const { cards } = await mount(two());
    await expect.element(page.getByRole("button", { name: "Accept all" })).toBeVisible();
    expect(document.querySelectorAll("[data-accept-all-tray] [data-proposed-edit]").length).toBe(2);
    await page.screenshot({ path: `${CAPTURES}/a3-accept-all.png` });

    await page.getByRole("button", { name: "Accept all" }).click();
    await expect.poll(() => __mutationCalls("chatV2:applyProposal")).toEqual([{ proposalId: "card-242" }, { proposalId: "card-244" }]);
    expect(cards.lastAccepted).toEqual([
      { proposalId: "card-242", line: "242" },
      { proposalId: "card-244", line: "244" },
    ]);
  });

  // Review 2026-10-28 (finding 5): a stop partway keeps its reason in view.
  it("keeps the reason Accept all stopped, with the accepted card on the Undo bar", async () => {
    let call = 0;
    __setMutationResult("chatV2:applyProposal", {
      then(resolve: (value: unknown) => void) {
        call += 1;
        resolve(call === 1 ? { applied: true, count: 1 } : { applied: false, count: 0, reason: "Couldn't find the original passage in the current report." });
      },
    });
    const { cards } = await mount(two());
    await page.getByRole("button", { name: "Accept all" }).click();
    await expect.element(page.getByText("Couldn't accept Line 244. Couldn't find the original passage in the current report.")).toBeVisible();
    expect(cards.lastAccepted).toEqual([{ proposalId: "card-242", line: "242" }]);
  });

  it("is hidden when a waiting card offers options, and once one card is left", async () => {
    const first = await mount([withOptions(), two()[1]]);
    await expect.element(page.getByText("Line 244", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Accept all" }).elements()).toHaveLength(0);
    first.view.unmount();

    await mount([card("card-242", { state: "applied", undoable: true }), two()[1]]);
    await expect.element(page.getByText("Done. Line 242 is updated.", { exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Accept all" }).elements()).toHaveLength(0);
  });
});
