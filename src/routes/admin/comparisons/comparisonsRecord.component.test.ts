import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ComparisonsPage from "./+page.svelte";
import { __resetPage } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationError,
  __setMutationResult,
  __setQueryData,
  __setQueryDataForArgs,
} from "$lib/test/convex-svelte-stub.svelte";

/**
 * AD-29 (story 6, CAP-16). The Paired Comparison form is a judgement, not a
 * live view, and only executing the real form can prove it: a direct call to
 * the mutation cannot show that the page froze the pin it submits, the record
 * it agreed to void, or the form a pending response belongs to. These tests
 * mount `+page.svelte` itself and drive it the way an administrator does.
 */

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";

function recordContext(overrides: Record<string, unknown> = {}) {
  return {
    reportId: "report-a",
    revisionNumber: 3,
    contentHash: "a".repeat(64),
    generationId: null,
    suggestedBanhallModel: null,
    liveComparisonId: null,
    ...overrides,
  };
}

function emptyMetrics() {
  return {
    sm1: {
      eligibleProjects: 0,
      preferredProjects: 0,
      satisfyingProjects: 0,
      computedMet: false,
      manualConditions: ["at least one 100–200-hour project among the four"],
    },
    sm2: {
      eligibleProjects: 0,
      satisfyingProjects: 0,
      computedMet: false,
      manualConditions: [
        "the 16-item harness fixture reports 16/16 on every run",
      ],
    },
    projects: [],
    projectCount: 0,
    projectsTruncated: false,
    excluded: {
      development: [],
      developmentCount: 0,
      developmentTruncated: false,
      voided: 0,
    },
    corpusComplete: true,
    scannedRows: 0,
  };
}

function storedRecord(overrides: Record<string, unknown> = {}) {
  return {
    _id: "cmp-live",
    recordedAt: 1_757_000_000_000,
    revisionNumber: 3,
    contentHash: "a".repeat(64),
    generationId: null,
    banhallModel: "Sonnet 5",
    baselineProduct: "ChatGPT",
    baselineModel: "GPT-5.6 Sol",
    modelCaveat: "Q15 unresolved.",
    judgeUserId: "user-larry",
    judgeLabel: "Larry Hall",
    preference: "banhall",
    deviationsBanhall: 2,
    deviationsBaseline: 9,
    countingMethod: "Manual count, both drafts.",
    correctionsBanhall: 1,
    correctionsBaseline: 4,
    usedInDevelopment: false,
    draftTextMatches: true,
    voidsComparisonId: null,
    voided: false,
    ...overrides,
  };
}

function targetsPage(
  targets: Array<{ projectId: string; label: string; hasLiveComparison: boolean | null }>,
  overrides: Record<string, unknown> = {}
) {
  return { targets, cursor: "cursor-1", isDone: true, pageSize: 25, ...overrides };
}

beforeEach(() => {
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  __setQueryData(
    "comparisons:listRecordTargets",
    targetsPage([
      { projectId: PROJECT_A, label: "Acme Metals — Alloy fatigue PD", hasLiveComparison: false },
      { projectId: PROJECT_B, label: "Beta Ceramics — Thermal cycling PD", hasLiveComparison: false },
    ])
  );
  __setQueryData("users:listTeam", [
    { id: "user-larry", name: "Larry Hall" },
    { id: "user-tracy", name: "Tracy Doe" },
  ]);
  __setQueryData("comparisons:successMetrics", emptyMetrics());
  __setQueryData("comparisons:getRecordContext", recordContext());
  __setQueryData("comparisons:listForProject", { records: [], hasMore: false });
  __setMutationResult("comparisons:record", "cmp-new");
});

/** bits-ui opens and selects on pointer events, not on a synthetic click. */
function pointerActivate(el: HTMLElement) {
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
  el.click();
}

function comboboxFor(label: string) {
  return document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
}

async function chooseOption(comboboxLabel: string, optionLabel: string) {
  const input = comboboxFor(comboboxLabel);
  expect(input, `no combobox labelled ${comboboxLabel}`).not.toBeNull();
  pointerActivate(input!);
  await expect
    .poll(() =>
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (option) => option.textContent?.trim() === optionLabel
      )
    )
    .toBeDefined();
  pointerActivate(
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (option) => option.textContent?.trim() === optionLabel
    )!
  );
  // The portal closes asynchronously; wait for it before driving the next one.
  await expect.poll(() => document.querySelectorAll('[role="option"]').length).toBe(0);
}

function setField(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  expect(field, `no field at ${selector}`).not.toBeNull();
  field!.value = value;
  field!.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Rendered page text with layout whitespace collapsed, for message assertions. */
function pageText() {
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

function buttonsByText(text: string) {
  return [...document.querySelectorAll("button")].filter(
    (candidate) => candidate.textContent?.trim() === text
  );
}

const submitButton = () => buttonsByText("Record comparison")[0] ?? buttonsByText("Recording…")[0];

/** What the server sends back when the frozen pin no longer matches. */
const STALE_REVISION_MESSAGE =
  "The report moved to a new revision after this comparison was loaded";

const BANHALL_DRAFT = "  The team could not predict the fatigue limit.\n";
const BASELINE_DRAFT = "A wholly different baseline draft.\t";

/** Fill everything except the project, which the caller picks first. */
async function fillJudgement(options: { preference?: string } = {}) {
  await chooseOption("Judge", "Larry Hall");
  await chooseOption(
    "Preference",
    options.preference ?? "Banhall draft preferred"
  );
  setField("#counting-method", " Manual count, both drafts. ");
  setField("#deviations-banhall", "2");
  setField("#deviations-baseline", "9");
  setField("#corrections-banhall", "1");
  setField("#corrections-baseline", "4");
  setField("#banhall-model", "  Sonnet 5  ");
  setField("#baseline-product", " ChatGPT ");
  setField("#baseline-model", "GPT-5.6 Sol");
  setField("#model-caveat", " Q15 unresolved. ");
  setField("#banhall-draft", BANHALL_DRAFT);
  setField("#baseline-draft", BASELINE_DRAFT);
}

describe("/admin/comparisons record form", () => {
  it("submits the pin and every judgement field exactly as entered", async () => {
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();

    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();

    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(__mutationCalls("comparisons:record")[0]!).toEqual({
      reportId: "report-a",
      expectedRevisionNumber: 3,
      banhallModel: "  Sonnet 5  ",
      baselineProduct: " ChatGPT ",
      baselineModel: "GPT-5.6 Sol",
      modelCaveat: " Q15 unresolved. ",
      judgeUserId: "user-larry",
      preference: "banhall",
      deviationsBanhall: 2,
      deviationsBaseline: 9,
      countingMethod: " Manual count, both drafts. ",
      correctionsBanhall: 1,
      correctionsBaseline: 4,
      usedInDevelopment: false,
      banhallDraftText: BANHALL_DRAFT,
      baselineDraftText: BASELINE_DRAFT,
    });
    await expect
      .poll(() => document.body.textContent)
      .toContain("Recorded. The draft-match result is shown on the record below.");
  });

  // R4: the preference IS the judgement, so it starts unselected and the form
  // cannot be submitted until a human chooses one.
  it("requires a deliberate preference and never defaults to Banhall", async () => {
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");

    await expect.poll(() => comboboxFor("Preference")).not.toBeNull();
    expect(comboboxFor("Preference")!.value).toBe("");

    await chooseOption("Judge", "Larry Hall");
    setField("#counting-method", "Manual.");
    setField("#deviations-banhall", "2");
    setField("#deviations-baseline", "9");
    setField("#corrections-banhall", "1");
    setField("#corrections-baseline", "4");
    setField("#banhall-model", "Sonnet 5");
    setField("#baseline-product", "ChatGPT");
    setField("#baseline-model", "GPT-5.6 Sol");
    setField("#model-caveat", "Q15 unresolved.");
    setField("#banhall-draft", BANHALL_DRAFT);
    setField("#baseline-draft", BASELINE_DRAFT);

    // Everything else is answered; only the preference is missing.
    await expect.poll(() => submitButton()?.disabled).toBe(true);
    await chooseOption("Preference", "Tie — no preference");
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();
    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(
      (__mutationCalls("comparisons:record")[0]! as { preference: string })
        .preference
    ).toBe("tie");
  });

  it("waits for the selected project's context without retaining the prior pin", async () => {
    __setQueryDataForArgs("comparisons:getRecordContext", { projectId: PROJECT_B }, undefined);
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    await chooseOption("Project", "Beta Ceramics — Thermal cycling PD");
    await expect.poll(pageText).toContain("Loading the project's pinned revision");
    expect(pageText()).not.toContain("report report-a");
    expect(submitButton()).toBeUndefined();
    expect(__mutationCalls("comparisons:record")).toHaveLength(0);
    __setQueryDataForArgs("comparisons:getRecordContext", { projectId: PROJECT_B }, recordContext({
      reportId: "report-b", revisionNumber: 8,
    }));
    await expect.poll(pageText).toContain("Revision 8 · report report-b");
    await fillJudgement();
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();
    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(__mutationCalls("comparisons:record")[0]).toMatchObject({
      reportId: "report-b", expectedRevisionNumber: 8,
    });
  });

  it("rejects fractional count text before floating-point rounding", async () => {
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    for (const value of ["9007199254740991.1", "1.0000000000000001", "1e-400", " 2 "]) {
      setField("#deviations-banhall", value);
      await expect.poll(() => submitButton()?.disabled).toBe(true);
      expect(__mutationCalls("comparisons:record")).toHaveLength(0);
    }
  });

  it("rejects unsafe count integers and accepts the safe boundary", async () => {
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    for (const selector of ["#deviations-banhall", "#deviations-baseline", "#corrections-banhall", "#corrections-baseline"]) {
      setField(selector, String(Number.MAX_SAFE_INTEGER + 1));
      await expect.poll(() => submitButton()?.disabled).toBe(true);
      expect(pageText()).toContain(`from 0 to ${Number.MAX_SAFE_INTEGER}`);
      expect(__mutationCalls("comparisons:record")).toHaveLength(0);
      setField(selector, String(Number.MAX_SAFE_INTEGER));
      await expect.poll(() => submitButton()?.disabled).toBe(false);
    }
    submitButton()!.click();
    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(__mutationCalls("comparisons:record")[0]).toMatchObject({
      deviationsBanhall: Number.MAX_SAFE_INTEGER,
      deviationsBaseline: Number.MAX_SAFE_INTEGER,
      correctionsBanhall: Number.MAX_SAFE_INTEGER,
      correctionsBaseline: Number.MAX_SAFE_INTEGER,
    });
  });

  // R1: a live query may show the report moving on; the judgement's pin does
  // not follow it, so the backend refuses instead of re-pinning silently.
  it("freezes the report pin so an edit mid-judgement is refused", async () => {
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();

    // The report is edited while the judgement is being entered.
    __setQueryData(
      "comparisons:getRecordContext",
      recordContext({ revisionNumber: 4, contentHash: "b".repeat(64) })
    );
    await expect
      .poll(() => document.body.textContent)
      .toContain("This report moved to revision 4");

    __setMutationError("comparisons:record", {
      data: { code: "STALE_REVISION", message: STALE_REVISION_MESSAGE },
    });
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();

    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    // The pin that was read is the pin that is submitted.
    expect(
      (__mutationCalls("comparisons:record")[0]! as {
        expectedRevisionNumber: number;
      }).expectedRevisionNumber
    ).toBe(3);
    // The server's own refusal must be rendered — not merely "some alert",
    // which the pre-existing "report moved" warning would satisfy on its own.
    await expect
      .poll(() => document.body.textContent)
      .toContain(STALE_REVISION_MESSAGE);
    expect(
      [...document.querySelectorAll('[role="alert"]')].some((alert) =>
        alert.textContent?.includes(STALE_REVISION_MESSAGE)
      )
    ).toBe(true);
    expect(document.body.textContent).not.toContain(
      "Recorded. The draft-match result is shown on the record below."
    );
  });

  // R2: the administrator consents to replacing one specific record. If a
  // second administrator corrects it first, the captured id goes up and the
  // backend refuses the stale target — the consent is never silently retargeted.
  it("freezes the correction target captured at consent", async () => {
    __setQueryData("comparisons:getRecordContext", recordContext({ liveComparisonId: "cmp-live" }));
    __setQueryData("comparisons:listForProject", {
      records: [storedRecord()],
      hasMore: false,
    });
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();

    await expect.poll(() => buttonsByText("Void and re-enter").length).toBe(1);
    buttonsByText("Void and re-enter")[0]!.click();

    // Someone else records a correction; the live row moves on underneath us.
    __setQueryData("comparisons:getRecordContext", recordContext({ liveComparisonId: "cmp-other" }));
    __setQueryData("comparisons:listForProject", {
      records: [
        storedRecord({ _id: "cmp-other", voidsComparisonId: "cmp-live" }),
        storedRecord({ voided: true }),
      ],
      hasMore: false,
    });

    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();
    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(
      (__mutationCalls("comparisons:record")[0]! as {
        voidsComparisonId?: string;
      }).voidsComparisonId
    ).toBe("cmp-live");
  });

  // R3: a response answers for the form that sent it and no other. Both
  // outcomes are exercised — a success must not announce itself on another
  // project's form, and a failure must not raise an alert on it either.
  for (const outcome of ["success", "failure"] as const) {
    it(`does not report a project A ${outcome} on project B`, async () => {
      __setQueryDataForArgs(
        "comparisons:getRecordContext",
        { projectId: PROJECT_A },
        recordContext()
      );
      __setQueryDataForArgs(
        "comparisons:getRecordContext",
        { projectId: PROJECT_B },
        recordContext({ reportId: "report-b", revisionNumber: 7 })
      );
      // The request is still in flight when the administrator moves on.
      let settle: ((value: unknown) => void) | undefined;
      let fail: ((reason: unknown) => void) | undefined;
      __setMutationResult(
        "comparisons:record",
        new Promise((resolvePending, rejectPending) => {
          settle = resolvePending;
          fail = rejectPending;
        })
      );

      render(ComparisonsPage);
      await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
      await fillJudgement();
      await expect.poll(() => submitButton()?.disabled).toBe(false);
      submitButton()!.click();
      await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
      // Nothing has come back yet.
      expect(document.body.textContent).not.toContain(
        "Recorded. The draft-match result is shown on the record below."
      );

      await chooseOption("Project", "Beta Ceramics — Thermal cycling PD");
      await expect.poll(() => document.body.textContent).toContain("Revision 7");

      const projectBDraft = "  Project B thermal cycling judgement.\n";
      const projectBBaseline = "Distinct project B baseline.\t";
      await fillJudgement({ preference: "Baseline draft preferred" });
      setField("#banhall-draft", projectBDraft);
      setField("#baseline-draft", projectBBaseline);
      await expect.poll(() => submitButton()?.disabled).toBe(false);

      if (outcome === "success") {
        settle!("cmp-a");
      } else {
        fail!({
          data: { code: "STALE_REVISION", message: "The report moved on" },
        });
      }
      // Give the settled promise every chance to reach the wrong form.
      await new Promise((r) => setTimeout(r, 0));
      await expect.poll(() => document.body.textContent).toContain("Revision 7");

      expect(document.body.textContent).not.toContain(
        "Recorded. The draft-match result is shown on the record below."
      );
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(
        document.querySelector<HTMLTextAreaElement>("#banhall-draft")!.value
      ).toBe(projectBDraft);
      expect(document.querySelector<HTMLTextAreaElement>("#baseline-draft")!.value)
        .toBe(projectBBaseline);
      expect(comboboxFor("Preference")!.value).toBe("Baseline draft preferred");
      expect(submitButton()!.disabled).toBe(false);
      // And the new form is usable: the stale response never froze it.
      expect(submitButton()!.textContent?.trim()).toBe("Record comparison");
    });
  }

  // R5: the baseline product is provenance about one comparison, not a
  // constant. It resets with everything else when the project changes.
  it("resets every judgement field, including the baseline product, on a project change", async () => {
    __setQueryData("comparisons:getRecordContext", recordContext({ liveComparisonId: "cmp-live" }));
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();
    checkboxLabelled(DEVELOPMENT_LABEL)!.click();
    checkboxLabelled(CONSENT_LABEL)!.click();
    await expect.poll(() => checkboxLabelled(DEVELOPMENT_LABEL)?.getAttribute("aria-checked")).toBe("true");
    await expect.poll(() => checkboxLabelled(CONSENT_LABEL)?.getAttribute("aria-checked")).toBe("true");
    expect(
      document.querySelector<HTMLInputElement>("#baseline-product")!.value
    ).toBe(" ChatGPT ");

    await chooseOption("Project", "Beta Ceramics — Thermal cycling PD");
    await expect
      .poll(
        () => document.querySelector<HTMLInputElement>("#baseline-product")?.value
      )
      .toBe("");
    for (const selector of [
      "#baseline-model",
      "#banhall-model",
      "#model-caveat",
      "#counting-method",
      "#deviations-banhall",
      "#deviations-baseline",
      "#corrections-banhall",
      "#corrections-baseline",
      "#banhall-draft",
      "#baseline-draft",
    ]) {
      expect(
        document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
          .value,
        selector
      ).toBe("");
    }
    expect(comboboxFor("Preference")!.value).toBe("");
    expect(comboboxFor("Judge")!.value).toBe("");
    expect(checkboxLabelled(DEVELOPMENT_LABEL)!.getAttribute("aria-checked")).toBe("false");
    expect(checkboxLabelled(CONSENT_LABEL)!.getAttribute("aria-checked")).toBe("false");
  });
});

// R17: the match flag is evidence only if a human can see it. Assert the
// message at its consumer, not only on the record the backend wrote.
describe("/admin/comparisons draft-match evidence", () => {
  const CASES = [
    {
      matches: true,
      message: "The pasted Banhall draft matches the pinned revision.",
      absent:
        "The pasted Banhall draft does NOT match the pinned revision — the judge may have rated a different draft.",
    },
    {
      matches: false,
      message:
        "The pasted Banhall draft does NOT match the pinned revision — the judge may have rated a different draft.",
      absent: "The pasted Banhall draft matches the pinned revision.",
    },
  ] as const;

  for (const { matches, message, absent } of CASES) {
    it(`renders the ${matches ? "match" : "mismatch"} evidence message`, async () => {
      __setQueryData("comparisons:listForProject", {
        records: [storedRecord({ draftTextMatches: matches })],
        hasMore: false,
      });
      render(ComparisonsPage);
      await chooseOption("Project", "Acme Metals — Alloy fatigue PD");

      await expect.poll(() => document.body.textContent).toContain(message);
      expect(document.body.textContent).not.toContain(absent);
    });
  }

  // R8's readout has a human consumer too: a partial window must say so.
  it("says plainly when the metric corpus is only a partial window", async () => {
    __setQueryData("comparisons:successMetrics", {
      ...emptyMetrics(),
      corpusComplete: false,
      scannedRows: 500,
    });
    render(ComparisonsPage);
    await expect
      .poll(() => document.body.textContent)
      .toContain("SM-1 and SM-2 are withheld until the whole corpus can be counted.");
  });
});

/** The bits-ui checkbox whose label reads exactly `labelText`. */
function checkboxLabelled(labelText: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
    (box) => {
      const labelId = box.getAttribute("aria-labelledby");
      return (
        labelId &&
        document.getElementById(labelId)?.textContent?.trim() === labelText
      );
    }
  );
}

const DEVELOPMENT_LABEL =
  "This project was used during development (excluded from SM-1 and SM-2)";
const CONSENT_LABEL =
  "Record this as a correction that voids the live record";

describe("/admin/comparisons pin and provenance freezing", () => {
  // P4: the pin names a report, not just a revision number. A replaced report
  // can arrive at the same revision number and must still be caught.
  it("warns on replacement and submits the original report pin", async () => {
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await expect.poll(() => document.body.textContent).toContain("report report-a");
    expect(document.body.textContent).not.toContain("no longer the one being judged");

    await fillJudgement();
    // Same revision number, different report: a replacement, not an edit.
    __setQueryData(
      "comparisons:getRecordContext",
      recordContext({ reportId: "report-replacement", revisionNumber: 3 })
    );
    await expect
      .poll(() => document.body.textContent)
      .toContain("no longer the one being judged");
    // The pin itself does not move.
    expect(document.body.textContent).toContain("report report-a");
    expect(pageText()).toContain("Recording remains valid if that original report revision is unchanged.");
    expect(pageText()).not.toContain("recording will be refused");
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();
    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(__mutationCalls("comparisons:record")[0]).toMatchObject({
      reportId: "report-a", expectedRevisionNumber: 3,
    });
    await expect.poll(pageText).toContain("Recorded. The draft-match result is shown on the record below.");
  });

  // P5: the stale-revision message told the administrator to re-select the
  // project, but re-selecting the current project is a no-op. The restart is
  // an explicit control, and it actually re-freezes the pin.
  it("restarts a judgement and re-freezes the pin on the current revision", async () => {
    __setQueryData("comparisons:getRecordContext", recordContext({ liveComparisonId: "cmp-live" }));
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();

    checkboxLabelled(DEVELOPMENT_LABEL)!.click();
    checkboxLabelled(CONSENT_LABEL)!.click();
    await expect.poll(() => checkboxLabelled(DEVELOPMENT_LABEL)?.getAttribute("aria-checked")).toBe("true");
    await expect.poll(() => checkboxLabelled(CONSENT_LABEL)?.getAttribute("aria-checked")).toBe("true");

    __setQueryData(
      "comparisons:getRecordContext",
      recordContext({ revisionNumber: 9, liveComparisonId: "cmp-live" })
    );
    await expect
      .poll(() => buttonsByText("Start a new judgement on the current revision").length)
      .toBe(1);

    buttonsByText("Start a new judgement on the current revision")[0]!.click();

    // The pin re-freezes on what the project's context says now...
    await expect.poll(() => document.body.textContent).toContain("Revision 9");
    expect(document.body.textContent).not.toContain(
      "no longer the one being judged"
    );
    await expect
      .poll(() => buttonsByText("Start a new judgement on the current revision").length)
      .toBe(0);
    // ...and every entered field is gone, because the prose changed.
    await expect
      .poll(() => document.querySelector<HTMLTextAreaElement>("#banhall-draft")?.value)
      .toBe("");
    for (const selector of [
      "#baseline-product", "#baseline-model", "#banhall-model", "#model-caveat",
      "#counting-method", "#deviations-banhall", "#deviations-baseline",
      "#corrections-banhall", "#corrections-baseline", "#banhall-draft", "#baseline-draft",
    ]) {
      expect(document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!.value, selector).toBe("");
    }
    expect(comboboxFor("Preference")!.value).toBe("");
    expect(comboboxFor("Judge")!.value).toBe("");
    expect(checkboxLabelled(DEVELOPMENT_LABEL)!.getAttribute("aria-checked")).toBe("false");
    expect(checkboxLabelled(CONSENT_LABEL)!.getAttribute("aria-checked")).toBe("false");
    // The project itself is still selected: only the judgement restarted.
    expect(comboboxFor("Project")!.value).toContain("Acme Metals");
  });

  // P6: the Banhall-model suggestion is provenance about the PINNED
  // revision's generation. A later context describes a different generation.
  it("captures the model suggestion with the pin and ignores later ones", async () => {
    __setQueryData(
      "comparisons:getRecordContext",
      recordContext({ suggestedBanhallModel: null })
    );
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await expect
      .poll(() => document.querySelector<HTMLInputElement>("#banhall-model")?.value)
      .toBe("");

    // A newer generation for this project reaches the live query.
    __setQueryData(
      "comparisons:getRecordContext",
      recordContext({
        suggestedBanhallModel: "Opus 4.8",
        generationId: "generation-new",
      })
    );
    await expect.poll(() => document.body.textContent).toContain("Generation none");
    expect(document.querySelector<HTMLInputElement>("#banhall-model")!.value).toBe("");
  });

  it("still offers the pinned revision's own model as a default", async () => {
    __setQueryData(
      "comparisons:getRecordContext",
      recordContext({ suggestedBanhallModel: "Sonnet 5", generationId: "generation-a" })
    );
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await expect
      .poll(() => document.querySelector<HTMLInputElement>("#banhall-model")?.value)
      .toBe("Sonnet 5");
  });
});

// P8: the consent checkbox is the primary correction affordance and had no
// executing coverage — its callback could be deleted with the suite still green.
describe("/admin/comparisons correction consent checkbox", () => {
  beforeEach(() => {
    __setQueryData(
      "comparisons:getRecordContext",
      recordContext({ liveComparisonId: "cmp-live" })
    );
    __setQueryData("comparisons:listForProject", {
      records: [storedRecord()],
      hasMore: false,
    });
  });

  it("captures the live record on consent and withdraws it when unchecked", async () => {
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();

    // Without consent the form refuses to submit at all.
    await expect.poll(() => checkboxLabelled(CONSENT_LABEL)).toBeDefined();
    expect(submitButton()!.disabled).toBe(true);

    checkboxLabelled(CONSENT_LABEL)!.click();
    await expect.poll(() => submitButton()?.disabled).toBe(false);

    // Unchecking withdraws the consent, and the form locks again.
    checkboxLabelled(CONSENT_LABEL)!.click();
    await expect.poll(() => submitButton()?.disabled).toBe(true);

    checkboxLabelled(CONSENT_LABEL)!.click();
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();
    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(
      (__mutationCalls("comparisons:record")[0]! as { voidsComparisonId?: string })
        .voidsComparisonId
    ).toBe("cmp-live");
  });

  it("submits the record consented to, not whichever record is live at submit", async () => {
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await fillJudgement();
    await expect.poll(() => checkboxLabelled(CONSENT_LABEL)).toBeDefined();
    checkboxLabelled(CONSENT_LABEL)!.click();

    // Another administrator corrects the same project first.
    __setQueryData(
      "comparisons:getRecordContext",
      recordContext({ liveComparisonId: "cmp-other" })
    );
    __setQueryData("comparisons:listForProject", {
      records: [
        storedRecord({ _id: "cmp-other", voidsComparisonId: "cmp-live" }),
        storedRecord({ voided: true }),
      ],
      hasMore: false,
    });

    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();
    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(
      (__mutationCalls("comparisons:record")[0]! as { voidsComparisonId?: string })
        .voidsComparisonId
    ).toBe("cmp-live");
  });
});

// P9: R7's requirement — a project past the first picker page is selectable
// and correctable — has to be proven at the control, not only in the backend.
describe("/admin/comparisons project picker paging", () => {
  const OLD_PROJECT = "project-old";
  const OLD_LABEL = "Zeta Alloys — Legacy fatigue PD";

  beforeEach(() => {
    __setQueryDataForArgs(
      "comparisons:listRecordTargets",
      { cursor: null },
      targetsPage(
        [
          { projectId: PROJECT_A, label: "Acme Metals — Alloy fatigue PD", hasLiveComparison: false },
        ],
        { isDone: false }
      )
    );
    __setQueryDataForArgs(
      "comparisons:listRecordTargets",
      { cursor: "cursor-1" },
      targetsPage([
        { projectId: OLD_PROJECT, label: OLD_LABEL, hasLiveComparison: true },
      ])
    );
    __setQueryDataForArgs(
      "comparisons:getRecordContext",
      { projectId: OLD_PROJECT },
      recordContext({ reportId: "report-old", liveComparisonId: "cmp-old" })
    );
    __setQueryDataForArgs(
      "comparisons:listForProject",
      { projectId: OLD_PROJECT },
      { records: [storedRecord({ _id: "cmp-old" })], hasMore: false }
    );
  });

  it("reaches an older page, records a correction there, and pages back", async () => {
    render(ComparisonsPage);
    // The older project is not reachable from the first page.
    await expect.poll(() => buttonsByText("Older projects")[0]?.disabled).toBe(false);
    expect(buttonsByText("Newer projects")[0]!.disabled).toBe(true);
    expect(document.body.textContent).toContain("Page 1");

    buttonsByText("Older projects")[0]!.click();
    await expect.poll(() => document.body.textContent).toContain("Page 2");

    await chooseOption("Project", `${OLD_LABEL} (live record)`);
    await expect.poll(() => document.body.textContent).toContain("report report-old");
    await fillJudgement();

    // A project from a later page is correctable, which is what R7 asked for.
    await expect.poll(() => checkboxLabelled(CONSENT_LABEL)).toBeDefined();
    checkboxLabelled(CONSENT_LABEL)!.click();
    await expect.poll(() => submitButton()?.disabled).toBe(false);
    submitButton()!.click();
    await expect.poll(() => __mutationCalls("comparisons:record").length).toBe(1);
    expect(__mutationCalls("comparisons:record")[0]!).toMatchObject({
      reportId: "report-old",
      voidsComparisonId: "cmp-old",
    });

    // Paging back keeps the selection and still names the chosen project.
    buttonsByText("Newer projects")[0]!.click();
    await expect.poll(() => document.body.textContent).toContain("Page 1");
    expect(comboboxFor("Project")!.value).toContain("Zeta Alloys");
    expect(document.body.textContent).toContain("report report-old");
  });
});

// P3: a capped list must say it is capped.
describe("/admin/comparisons readout completeness", () => {
  it("discloses omitted project history and clears the disclosure when complete", async () => {
    __setQueryData("comparisons:listForProject", {
      records: [storedRecord()], hasMore: true,
    });
    render(ComparisonsPage);
    await chooseOption("Project", "Acme Metals — Alloy fatigue PD");
    await expect.poll(pageText).toContain("Older records on this project are not shown.");
    __setQueryData("comparisons:listForProject", {
      records: [storedRecord()], hasMore: false,
    });
    await expect.poll(pageText).not.toContain("Older records on this project are not shown.");
  });

  it("withholds each metric verdict despite successful partial counts and scopes an empty list to its window", async () => {
    const metrics = emptyMetrics();
    __setQueryData("comparisons:successMetrics", {
      ...metrics,
      corpusComplete: false,
      scannedRows: 500,
      sm1: { ...metrics.sm1, eligibleProjects: 4, satisfyingProjects: 3, preferredProjects: 3 },
      sm2: { ...metrics.sm2, eligibleProjects: 4, satisfyingProjects: 3 },
    });
    render(ComparisonsPage);
    await expect.poll(pageText).toContain("No eligible projects were found in the scanned window.");
    expect(pageText()).not.toContain("No live, non-development Paired Comparison has been recorded yet.");
    const unavailable = "Countable clauses unavailable until the whole corpus is counted";
    expect(pageText().split(unavailable)).toHaveLength(3);
    expect(pageText()).not.toContain("Countable clauses not met");
    expect(pageText()).not.toContain("Countable clauses met");
    expect(pageText()).toContain("3 of 4 eligible project(s)");
  });

  it("announces a truncated eligible or excluded list", async () => {
    __setQueryData("comparisons:successMetrics", {
      ...emptyMetrics(),
      projects: [],
      projectCount: 140,
      projectsTruncated: true,
      excluded: {
        development: [],
        developmentCount: 120,
        developmentTruncated: true,
        voided: 3,
      },
      scannedRows: 260,
    });
    render(ComparisonsPage);
    await expect
      .poll(pageText)
      .toContain("Showing 0 of 140 eligible projects");
    expect(pageText()).toContain(
      "Showing 0 of 120 excluded development projects"
    );
    expect(pageText()).toContain("120 development project(s)");
  });
});
