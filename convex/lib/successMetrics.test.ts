import { describe, expect, it } from "vitest";
import {
  SM1_MANUAL_CONDITIONS,
  SM2_MANUAL_CONDITIONS,
  summarizeSuccessMetrics,
  type SuccessMetricRow,
} from "./successMetrics";

// AD-29 (story 6): SM-1/SM-2 arithmetic, testable without a database or a
// judge. Every input here is a judge-entered count.

function row(
  projectId: string,
  overrides: Partial<SuccessMetricRow> = {}
): SuccessMetricRow {
  return {
    projectId,
    preference: "banhall",
    deviationsBanhall: 1,
    deviationsBaseline: 8,
    correctionsBanhall: 1,
    ...overrides,
  };
}

describe("summarizeSuccessMetrics", () => {
  it("reports zero eligible projects and computedMet false on an empty corpus", () => {
    const summary = summarizeSuccessMetrics([]);
    expect(summary.sm1).toEqual({
      eligibleProjects: 0,
      preferredProjects: 0,
      satisfyingProjects: 0,
      computedMet: false,
      manualConditions: [...SM1_MANUAL_CONDITIONS],
    });
    expect(summary.sm2).toEqual({
      eligibleProjects: 0,
      satisfyingProjects: 0,
      computedMet: false,
      manualConditions: [...SM2_MANUAL_CONDITIONS],
    });
  });

  it("meets SM-1 with five eligible projects of which three are preferred at half the Deviations", () => {
    const summary = summarizeSuccessMetrics([
      row("p1"),
      row("p2"),
      row("p3"),
      // Preferred, but the Deviation halving fails: 5 * 2 > 8.
      row("p4", { deviationsBanhall: 5, deviationsBaseline: 8 }),
      row("p5", { preference: "baseline" }),
    ]);
    expect(summary.sm1.eligibleProjects).toBe(5);
    expect(summary.sm1.preferredProjects).toBe(4);
    expect(summary.sm1.satisfyingProjects).toBe(3);
    expect(summary.sm1.computedMet).toBe(true);
    // The countable clauses never swallow the protocol clause no query can check.
    expect(summary.sm1.manualConditions).toContain(
      "at least one 100–200-hour project among the four"
    );
  });

  it("treats exactly half the Deviations as satisfying and one more as failing", () => {
    const halved = summarizeSuccessMetrics([
      row("p1", { deviationsBanhall: 4, deviationsBaseline: 8 }),
    ]);
    expect(halved.sm1.satisfyingProjects).toBe(1);
    const overHalf = summarizeSuccessMetrics([
      row("p1", { deviationsBanhall: 5, deviationsBaseline: 9 }),
    ]);
    expect(overHalf.sm1.satisfyingProjects).toBe(0);
    // A flawless Banhall draft against a flawless baseline still satisfies.
    const zeroes = summarizeSuccessMetrics([
      row("p1", { deviationsBanhall: 0, deviationsBaseline: 0 }),
    ]);
    expect(zeroes.sm1.satisfyingProjects).toBe(1);
  });

  it("requires four eligible projects and three satisfying ones", () => {
    // Three of three satisfying: the eligibility floor is not met.
    expect(
      summarizeSuccessMetrics([row("p1"), row("p2"), row("p3")]).sm1.computedMet
    ).toBe(false);
    // Four eligible, two satisfying: the satisfaction floor is not met.
    expect(
      summarizeSuccessMetrics([
        row("p1"),
        row("p2"),
        row("p3", { preference: "tie" }),
        row("p4", { preference: "baseline" }),
      ]).sm1.computedMet
    ).toBe(false);
    // Four and three: met.
    expect(
      summarizeSuccessMetrics([
        row("p1"),
        row("p2"),
        row("p3"),
        row("p4", { preference: "baseline" }),
      ]).sm1.computedMet
    ).toBe(true);
  });

  it("counts SM-2 from Corrections-to-acceptable alone, independent of preference", () => {
    const summary = summarizeSuccessMetrics([
      row("p1", { preference: "baseline", correctionsBanhall: 0 }),
      row("p2", { preference: "tie", correctionsBanhall: 1 }),
      row("p3", { correctionsBanhall: 1 }),
      row("p4", { correctionsBanhall: 2 }),
    ]);
    expect(summary.sm2.eligibleProjects).toBe(4);
    expect(summary.sm2.satisfyingProjects).toBe(3);
    expect(summary.sm2.computedMet).toBe(true);
    expect(summary.sm2.manualConditions).toContain(
      "the 16-item harness fixture reports 16/16 on every run"
    );
    // The harness clause is never folded into computedMet — SM-1's own
    // satisfaction is unrelated to SM-2's.
    expect(summary.sm1.satisfyingProjects).toBe(2);
  });

  it("counts a project once even if two rows for it are passed in", () => {
    const summary = summarizeSuccessMetrics([
      row("p1", { correctionsBanhall: 0 }),
      row("p1", { correctionsBanhall: 9 }),
      row("p2"),
    ]);
    expect(summary.sm1.eligibleProjects).toBe(2);
    expect(summary.sm2.eligibleProjects).toBe(2);
    // The first row in the given order (newest first) wins.
    expect(summary.sm2.satisfyingProjects).toBe(2);
  });

  it("never mutates the manual-condition constants across calls", () => {
    const first = summarizeSuccessMetrics([]);
    first.sm1.manualConditions.push("fabricated clause");
    const second = summarizeSuccessMetrics([]);
    expect(second.sm1.manualConditions).toEqual([...SM1_MANUAL_CONDITIONS]);
  });
});
