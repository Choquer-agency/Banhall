import { describe, expect, it } from "vitest";
import {
  clampPercent,
  forwardPercent,
  pillHeadline,
  progressText,
  remainingTimeText,
  revealDelayMs,
  sectionListText,
} from "./draftProgress";
import type { SeedDraftProgress } from "./types";

function progress(overrides: Partial<SeedDraftProgress> = {}): SeedDraftProgress {
  return {
    phase: "drafting",
    percent: 55,
    estimatedRemainingMs: 60_000,
    currentSectionKey: "244",
    stoppedAfterSectionKey: null,
    sections: [
      { key: "242", number: "242", title: "Technological uncertainty", question: "Q1", orderIndex: 0, status: "done", paragraphs: ["P"], startedAt: 1, completedAt: 2 },
      { key: "244", number: "244", title: "Work performed", question: "Q2", orderIndex: 1, status: "writing", paragraphs: [], startedAt: 3, completedAt: null },
      { key: "246", number: "246", title: "Technological advancement", question: "Q3", orderIndex: 2, status: "queued", paragraphs: [], startedAt: null, completedAt: null },
    ],
    ...overrides,
  };
}

describe("draft progress text", () => {
  it("gives honest time text", () => {
    expect(remainingTimeText(null)).toBeNull();
    expect(remainingTimeText(undefined)).toBeNull();
    expect(remainingTimeText(20_000)).toBe("less than a minute left");
    expect(remainingTimeText(60_000)).toBe("about 1 minute left");
    expect(remainingTimeText(80_000)).toBe("about 1 minute left");
    expect(remainingTimeText(150_000)).toBe("about 3 minutes left");
  });

  it("joins percent and time, omitting time without an estimate", () => {
    expect(progressText(55, 60_000)).toBe("55%, about 1 minute left");
    expect(progressText(55.4, null)).toBe("55%");
  });

  it("clamps and only moves forward", () => {
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(forwardPercent(55, 40)).toBe(55);
    expect(forwardPercent(55, 60)).toBe(60);
  });

  it("names the Section being written or stopped after", () => {
    expect(pillHeadline(progress())).toBe("Writing section 244");
    expect(pillHeadline(progress({ currentSectionKey: null, sections: progress().sections.map((s) => ({ ...s, status: "queued" as const })) }))).toBe("Starting the draft");
    expect(pillHeadline(progress({ phase: "stopping", stoppedAfterSectionKey: "244" }))).toBe("Stopping after section 244");
    expect(pillHeadline(progress({ phase: "completed" }))).toBeNull();
    expect(pillHeadline(progress({ phase: "stopped" }))).toBeNull();
  });

  it("lists sections in plain words", () => {
    expect(sectionListText(["246"])).toBe("section 246");
    expect(sectionListText(["244", "246"])).toBe("sections 244 and 246");
    expect(sectionListText(["242", "244", "246"])).toBe("sections 242, 244 and 246");
  });

  it("staggers reveals 60ms apart, capped at five", () => {
    expect([0, 1, 4, 5, 9].map(revealDelayMs)).toEqual([0, 60, 240, 240, 240]);
  });
});
