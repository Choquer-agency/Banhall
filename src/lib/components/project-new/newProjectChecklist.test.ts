import { describe, expect, it } from "vitest";
import {
  buildChecklist,
  NO_SOURCE_MESSAGE,
  startBlocked,
  startButtonLabel,
  type ChecklistInput,
} from "./newProjectChecklist";
import {
  PREVIOUS_YEAR_ONLY_MESSAGE,
  PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE,
} from "../../../../shared/previousYear";

const READY: ChecklistInput = {
  mode: "generate",
  clientName: "Cedarline Systems",
  title: "Adaptive cold storage controls",
  transcripts: { count: 2, words: 14_820 },
  unreadableTranscripts: 0,
  fiscalYearSet: true,
  scienceCodeSet: true,
  supporting: { count: 3, reading: 1 },
  duplicateName: false,
  previousYearMessage: null,
  noSource: false,
  projectNumberInvalid: false,
  overCapMessage: null,
  writtenPd: "missing",
};

const summary = (input: Partial<ChecklistInput>) =>
  buildChecklist({ ...READY, ...input }).map((row) => [row.id, row.state, row.text, row.blocking]);

describe("buildChecklist", () => {
  it("shows E1's four rows when everything is in place", () => {
    expect(summary({})).toEqual([
      ["client-title", "done", "Client and title", false],
      ["transcripts", "done", "2 transcripts, 14,820 words", false],
      ["fiscal-science", "done", "Fiscal year and science code", false],
      ["supporting", "reading", "3 supporting documents, 1 still reading", false],
    ]);
    expect(startBlocked(buildChecklist(READY))).toBe(false);
  });

  it("blocks until the client and title are set", () => {
    const rows = buildChecklist({ ...READY, title: "  " });
    expect(rows[0]).toMatchObject({ id: "client-title", state: "pending", text: "Add a client and a title", blocking: true });
    expect(startBlocked(rows)).toBe(true);
  });

  it("uses the singular and hides supporting documents when there are none", () => {
    expect(summary({ transcripts: { count: 1, words: 9_240 }, supporting: { count: 1, reading: 0 } })).toContainEqual([
      "transcripts",
      "done",
      "1 transcript, 9,240 words",
      false,
    ]);
    expect(summary({ supporting: { count: 1, reading: 0 } })).toContainEqual(["supporting", "done", "1 supporting document", false]);
    expect(summary({ supporting: { count: 0, reading: 0 } }).map(([id]) => id)).not.toContain("supporting");
  });

  it("marks fiscal year and science code pending without blocking", () => {
    expect(summary({ scienceCodeSet: false })).toContainEqual([
      "fiscal-science",
      "pending",
      "Add the fiscal year and science code",
      false,
    ]);
  });

  it("flags unreadable transcripts with Fix, without blocking (E5)", () => {
    const rows = buildChecklist({ ...READY, unreadableTranscripts: 1 });
    expect(rows.find((row) => row.id === "unreadable")).toEqual({
      id: "unreadable",
      state: "danger",
      text: "1 transcript could not be read",
      action: { label: "Fix", target: "unreadable" },
      blocking: false,
    });
    expect(startBlocked(rows)).toBe(false);
  });

  it("puts the same-name warning first with Check (E6)", () => {
    const rows = buildChecklist({ ...READY, duplicateName: true });
    expect(rows[0]).toMatchObject({
      id: "duplicate",
      state: "warning",
      text: "Same name as an existing project",
      action: { label: "Check", target: "duplicate" },
      blocking: false,
    });
    expect(rows.map((row) => row.id)).not.toContain("client-title");
  });

  it.each([PREVIOUS_YEAR_ONLY_MESSAGE, PREVIOUS_YEAR_TRANSCRIPTS_ONLY_MESSAGE])(
    "blocks with the exact previous-year message (decision 42): %s",
    (message) => {
      const rows = buildChecklist({ ...READY, previousYearMessage: message });
      expect(rows.find((row) => row.id === "previous-year")).toEqual({
        id: "previous-year",
        state: "danger",
        text: message,
        blocking: true,
      });
      expect(startBlocked(rows)).toBe(true);
    }
  );

  it("blocks with no source at all, a bad project number or too many transcripts", () => {
    expect(startBlocked(buildChecklist({ ...READY, noSource: true }))).toBe(true);
    expect(summary({ noSource: true })).toContainEqual(["no-source", "pending", NO_SOURCE_MESSAGE, true]);
    expect(startBlocked(buildChecklist({ ...READY, projectNumberInvalid: true }))).toBe(true);
    expect(startBlocked(buildChecklist({ ...READY, overCapMessage: "Too many" }))).toBe(true);
  });

  it("checks the written PD in Review, and never the previous-year rule", () => {
    const review = { mode: "review" as const, transcripts: { count: 0, words: 0 } };
    expect(summary({ ...review, writtenPd: "missing" })).toContainEqual(["written-pd", "pending", "Add the written PD", true]);
    expect(summary({ ...review, writtenPd: "reading" })).toContainEqual(["written-pd", "reading", "Reading the written PD", true]);
    expect(summary({ ...review, writtenPd: "ready" })).toContainEqual(["written-pd", "done", "Written PD ready to review", false]);
    expect(
      startBlocked(buildChecklist({ ...READY, ...review, writtenPd: "ready", previousYearMessage: PREVIOUS_YEAR_ONLY_MESSAGE, noSource: true }))
    ).toBe(false);
  });

  it("uses plain hyphens only", () => {
    const all = buildChecklist({
      ...READY,
      duplicateName: true,
      unreadableTranscripts: 2,
      noSource: true,
      previousYearMessage: PREVIOUS_YEAR_ONLY_MESSAGE,
      projectNumberInvalid: true,
    });
    for (const row of all) expect(row.text).not.toMatch(/[‐-―·]/);
  });
});

describe("startButtonLabel", () => {
  it("names each mode", () => {
    expect(startButtonLabel("generate", "iterative")).toBe("Start step by step");
    expect(startButtonLabel("generate", "single")).toBe("Start single draft");
    expect(startButtonLabel("generate", "compare")).toBe("Start two drafts");
    expect(startButtonLabel("review", "iterative")).toBe("Start the review");
  });
});
