import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ReviewsPage from "./+page.svelte";
import type { AdmissionSnapshot } from "../../../../convex/lib/learningAdmission";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setQueryData,
  __setQueryDataForArgs,
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
    latestAttempt: null,
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


const ADMISSION = {
  admittedCount: 5,
  excludedCount: 3,
  feedbackCutoff: 1_756_000_000_000,
  producers: [
    { producerId: "producer-alpha", count: 3 },
    { producerId: "producer-beta", count: 2 },
  ],
  streams: [
    {
      stream: "candidateScores",
      admittedCount: 5,
      excludedCount: 1,
      signalIds: ["signal-a", "signal-b", "signal-c", "signal-d", "signal-e"],
      producers: [
        { producerId: "producer-alpha", count: 3 },
        { producerId: "producer-beta", count: 2 },
      ],
      missingWriterCount: 1,
      missingProjectCount: 1,
      insufficientDiversityCount: 0,
      writerCount: 2,
      projectCount: 2,
    },
    {
      stream: "sectionEditEvents",
      admittedCount: 0,
      excludedCount: 2,
      signalIds: [],
      producers: [],
      missingWriterCount: 0,
      missingProjectCount: 0,
      insufficientDiversityCount: 2,
      writerCount: 1,
      projectCount: 2,
    },
  ],
} satisfies AdmissionSnapshot;


const QA_ADMISSION = {
  admittedCount: 6,
  excludedCount: 2,
  feedbackCutoff: 1_756_000_002_000,
  producers: [
    { producerId: "qa-producer-one", count: 4 },
    { producerId: "qa-producer-two", count: 2 },
  ],
  streams: [{
    stream: "qaItemFeedback",
    admittedCount: 6,
    excludedCount: 2,
    signalIds: ["qa-signal-1", "qa-signal-2", "qa-signal-3", "qa-signal-4", "qa-signal-5", "qa-signal-6"],
    producers: [
      { producerId: "qa-producer-one", count: 4 },
      { producerId: "qa-producer-two", count: 2 },
    ],
    missingWriterCount: 2,
    missingProjectCount: 1,
    insufficientDiversityCount: 0,
    writerCount: 2,
    projectCount: 3,
  }],
} satisfies AdmissionSnapshot;

const PANELS = [
  { kind: "qa_calibration", label: "Learned QA calibration", admission: QA_ADMISSION, otherSignal: "signal-a", streamLabel: "QA feedback" },
  { kind: "draft_style", label: "Learned drafting style", admission: ADMISSION, otherSignal: "qa-signal-1", streamLabel: "Draft comments" },
];

function learningPanel(label: string) {
  const panel = document.querySelector<HTMLElement>(`section[aria-label="${label}"]`);
  if (!panel) throw new Error(`Missing learning panel: ${label}`);
  return panel;
}

function panelButton(panel: HTMLElement, label: string) {
  const button = [...panel.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Missing panel button: ${label}`);
  return button;
}

async function expandProvenance(panel: HTMLElement) {
  for (const details of panel.querySelectorAll("details")) {
    const summary = details.querySelector("summary");
    if (!summary) throw new Error("Missing disclosure summary");
    expect(details.open).toBe(false);
    summary.click();
    await expect.poll(() => details.open).toBe(true);
  }
}

describe("/admin/reviews learning admission", () => {
  it("keeps distinct QA and style candidate snapshots scoped, with exact identities behind disclosures", async () => {
    for (const { kind, admission } of PANELS) {
      __setQueryDataForArgs("learning:getDigestHistory", { kind }, {
        ...digestHistory(),
        digests: [{ ...CANDIDATE, _id: `${kind}-candidate`, sourceCount: admission.admittedCount, admission }, PUBLISHED],
      });
    }
    render(ReviewsPage);
    await expect.poll(() => document.querySelectorAll('section[aria-label^="Learned"]').length).toBe(2);

    for (const { label, admission, otherSignal, streamLabel } of PANELS) {
      const panel = learningPanel(label);
      panelButton(panel, "Show previous versions (2)").click();
      await expect.poll(() => panel.querySelectorAll("details").length).toBeGreaterThan(0);
      expect(panel.textContent).toContain(`${admission.admittedCount} admitted · ${admission.excludedCount} excluded`);
      expect(panel.textContent).toContain(streamLabel);
      expect(panel.textContent).toContain("recent windows of up to 500 records per stream");
      expect(panel.textContent).toContain("meaningful-signal filters applied before admission");
      expect(panel.textContent).toContain("They do not cover all feedback history.");
      expect(panel.textContent).toContain("excluded totals count each record once");
      expect(panel.textContent).toContain("Signal provenance and exclusion details are unavailable for this historical version.");
      expect(panel.textContent).not.toContain(otherSignal);
      for (const row of panel.querySelectorAll("details li")) {
        expect(row.checkVisibility()).toBe(false);
      }
      for (const stream of admission.streams) {
        expect(panel.textContent).toContain(`Missing writer: ${stream.missingWriterCount} · Missing project: ${stream.missingProjectCount} · Insufficient stream diversity: ${stream.insufficientDiversityCount}`);
      }
      await expandProvenance(panel);
      for (const stream of admission.streams) {
        for (const signalId of stream.signalIds) {
          const row = [...panel.querySelectorAll("li")].find((candidate) => candidate.textContent === signalId);
          expect(row?.checkVisibility()).toBe(true);
        }
      }
      for (const producer of admission.producers) {
        expect(panel.textContent).toContain(`${producer.producerId}: ${producer.count} signal(s)`);
      }
      expect(panelButton(panel, "Publish this version").disabled).toBe(true);
    }
    expect(__mutationCalls("learning:selectDigest")).toHaveLength(0);
  });

  for (const { outcome, explanation } of [
    { outcome: "insufficient_inputs", explanation: "Skipped: fewer than five admitted signals." },
    { outcome: "unchanged_inputs", explanation: "Skipped: no admitted feedback is newer than the last candidate cutoff." },
    { outcome: "unsupported_rules", explanation: "No candidate: no supported rules were produced." },
    { outcome: "saved", explanation: "Candidate saved for administrator review." },
    { outcome: "deduplicated", explanation: "No new candidate: this input cutoff was already saved." },
    { outcome: "failed", explanation: "Generation failed. No candidate was saved; published guidance is unchanged." },
  ]) {
    it(`renders ${outcome} attempts using each panel's own admission counts`, async () => {
      const isInsufficient = outcome === "insufficient_inputs";
      const hasCandidate = outcome === "saved" || outcome === "deduplicated";
      for (const { kind, admission } of PANELS) {
        __setQueryDataForArgs("learning:getDigestHistory", { kind }, {
          ...digestHistory(),
          publishedDigestId: null,
          selectionId: null,
          digests: hasCandidate ? [{ ...CANDIDATE, admission }] : [],
          latestAttempt: {
            attemptedAt: 1_756_000_001_000,
            outcome,
            admission: isInsufficient ? {
              ...admission,
              admittedCount: 0,
              excludedCount: admission.admittedCount + admission.excludedCount,
              feedbackCutoff: null,
              producers: [],
              streams: admission.streams.map((stream) => ({
                ...stream,
                admittedCount: 0,
                excludedCount: stream.admittedCount + stream.excludedCount,
                insufficientDiversityCount: stream.admittedCount + stream.insufficientDiversityCount,
                writerCount: Math.min(stream.writerCount, 1),
                signalIds: [],
                producers: [],
              })),
            } : admission,
          },
        });
      }
      render(ReviewsPage);
      await expect.poll(() => document.querySelectorAll('[aria-label="Latest generation attempt"]').length).toBe(2);
      for (const { label, admission, streamLabel, otherSignal } of PANELS) {
        const panel = learningPanel(label);
        const attempt = panel.querySelector('[aria-label="Latest generation attempt"]');
        expect(attempt?.textContent).toContain(explanation);
        expect(attempt?.textContent).toContain(`${isInsufficient ? 0 : admission.admittedCount} admitted · ${isInsufficient ? admission.admittedCount + admission.excludedCount : admission.excludedCount} excluded`);
        expect(attempt?.textContent).toContain(streamLabel);
        expect(attempt?.textContent).not.toContain(otherSignal);
        if (isInsufficient) {
          expect(attempt?.textContent).toContain("Admitted feedback cutoff: None");
          expect(attempt?.textContent).toContain("No admitted producers.");
        }
      }
      expect(document.body.textContent).not.toContain("No consultant reviews, QA feedback, or learning candidates yet.");
      expect(buttonsByText("Publish this version")).toHaveLength(0);
      expect(__mutationCalls("learning:selectDigest")).toHaveLength(0);
    });
  }

  it("keeps different latest outcomes in the correct panel and renders no raw failure details", async () => {
    __setQueryDataForArgs("learning:getDigestHistory", { kind: "qa_calibration" }, {
      ...digestHistory(),
      latestAttempt: { attemptedAt: 1_756_000_001_000, outcome: "failed", admission: QA_ADMISSION, error: "private-provider-secret" },
    });
    __setQueryDataForArgs("learning:getDigestHistory", { kind: "draft_style" }, {
      ...digestHistory(),
      latestAttempt: { attemptedAt: 1_756_000_001_000, outcome: "unchanged_inputs", admission: ADMISSION },
    });
    render(ReviewsPage);
    await expect.poll(() => document.querySelectorAll('[aria-label="Latest generation attempt"]').length).toBe(2);
    const qa = learningPanel("Learned QA calibration");
    const style = learningPanel("Learned drafting style");
    expect(qa.textContent).toContain("Generation failed.");
    expect(qa.textContent).not.toContain("Skipped:");
    expect(style.textContent).toContain("no admitted feedback is newer than the last candidate cutoff");
    expect(style.textContent).not.toContain("Generation failed.");
    expect(document.body.textContent).not.toContain("private-provider-secret");
    expect(buttonsByText("Disable guidance")).toHaveLength(2);
    expect(__mutationCalls("learning:selectDigest")).toHaveLength(0);
  });
});
