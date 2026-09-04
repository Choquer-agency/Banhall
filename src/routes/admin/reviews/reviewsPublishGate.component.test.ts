import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ReviewsPage from "./+page.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * CAP-1: publishing a learning digest firm-wide requires an administrator to
 * confirm it carries no client identifier. The confirmation must gate only
 * publication — disabling guidance stays reachable — and it must reach the
 * mutation as `privacyReviewed`, not merely disable a button.
 */

const CANDIDATE = {
  _id: "digest-candidate",
  content: "Learned from 6 human feedback events:\n- Tighten openings.",
  sourceCount: 6,
  feedbackCutoff: 2,
  model: "test-model",
  createdAt: 1_756_000_000_000,
  isPersonal: false,
};

const PUBLISHED = {
  ...CANDIDATE,
  _id: "digest-published",
  content: "Learned from 5 human feedback events:\n- Keep background short.",
  createdAt: 1_755_000_000_000,
};

function digestHistory() {
  return {
    publishedDigestId: PUBLISHED._id,
    selectionId: "selection-1",
    explicitlyDisabled: false,
    digests: [CANDIDATE, PUBLISHED],
    selections: [],
  };
}

function buttonsByText(text: string) {
  return [...document.querySelectorAll("button")].filter(
    (candidate) => candidate.textContent?.trim() === text
  );
}

/**
 * Both digest panels render the same toggle label; `index` selects the kind
 * (0 = QA calibration, 1 = drafting style).
 */
async function showHistory(index: number) {
  await expect
    .poll(() => buttonsByText("Show previous versions (2)").length)
    .toBeGreaterThan(index);
  buttonsByText("Show previous versions (2)")[index]!.click();
  // Only the opened panel lists versions, so exactly one candidate is
  // publishable: the published row renders no button.
  await expect
    .poll(() => buttonsByText("Publish this version").length)
    .toBe(1);
}

beforeEach(() => {
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  __setQueryData("reviews:listWriterReviews", {
    rows: [],
    itemRows: [],
    total: 0,
    avgHuman: null,
    avgGap: null,
  });
  __setQueryData("learning:getDigestHistory", digestHistory());
});

describe("/admin/reviews digest privacy gate", () => {
  // Both digest kinds carry the gate independently; `kind` is the value the
  // mutation must receive, `index` the panel position on the page.
  const KINDS = [
    { kind: "qa_calibration", index: 0 },
    { kind: "draft_style", index: 1 },
  ] as const;

  for (const { kind, index } of KINDS) {
    it(`blocks ${kind} publication until the privacy review is confirmed, then sends the flag`, async () => {
      render(ReviewsPage);
      await showHistory(index);

      // Unconfirmed: publication is refused, disabling guidance is not.
      expect(buttonsByText("Publish this version")[0]!.disabled).toBe(true);
      expect(buttonsByText("Disable guidance")[index]!.disabled).toBe(false);

      // Only this panel's history is open, so it owns the only checkbox.
      const checkboxes =
        document.querySelectorAll<HTMLElement>('[role="checkbox"]');
      expect(checkboxes).toHaveLength(1);
      checkboxes[0]!.click();

      await expect
        .poll(() => buttonsByText("Publish this version")[0]!.disabled)
        .toBe(false);
      buttonsByText("Publish this version")[0]!.click();

      await expect
        .poll(() => __mutationCalls("learning:selectDigest").length)
        .toBe(1);
      expect(__mutationCalls("learning:selectDigest")[0]).toMatchObject({
        kind,
        digestId: CANDIDATE._id,
        privacyReviewed: true,
      });

      // The confirmation is per publish, never sticky: a second version must
      // not inherit the first one's review. Without the reset an administrator
      // confirms once and every later publish carries `privacyReviewed: true`
      // untruthfully, and the server gate cannot tell the difference.
      await expect
        .poll(() =>
          document
            .querySelector<HTMLElement>('[role="checkbox"]')
            ?.getAttribute("aria-checked")
        )
        .toBe("false");
      expect(buttonsByText("Publish this version")[0]!.disabled).toBe(true);
    });
  }

  it("disables guidance without a privacy confirmation and sends no flag", async () => {
    render(ReviewsPage);

    await expect
      .poll(() => buttonsByText("Disable guidance").length)
      .toBeGreaterThan(0);
    expect(buttonsByText("Disable guidance")[0]!.disabled).toBe(false);
    buttonsByText("Disable guidance")[0]!.click();

    await expect
      .poll(() => __mutationCalls("learning:selectDigest").length)
      .toBe(1);
    const [call] = __mutationCalls("learning:selectDigest") as Array<
      Record<string, unknown>
    >;
    expect(call.digestId).toBe(null);
    expect("privacyReviewed" in call).toBe(false);
  });
});
