import { describe, expect, it } from "vitest";
import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";
import { laterReviewFor } from "./laterReview";

const rows = (overrides: Record<string, { state?: string; stale?: boolean }>) =>
  PD_SUBSECTIONS.map((definition) => ({
    roleId: definition.roleId,
    state: "approved",
    stale: false,
    ...overrides[definition.roleId],
  }));

describe("laterReviewFor (2026-09-28 seventh)", () => {
  it("names the marked later steps on the step whose change marked them", () => {
    const current = rows({
      goal_problem: { state: "in_progress" },
      passive_limitations: { stale: true },
      technological_objective: { stale: true },
    });
    expect(laterReviewFor(current, "goal_problem")).toEqual({ count: 2, firstRoleId: "passive_limitations" });
    expect(laterReviewFor(current, "company_context")).toBeNull();
    expect(laterReviewFor(current, "passive_limitations")).toBeNull();
  });

  it("skips untouched steps between the change and the first marked step", () => {
    const current = rows({
      goal_problem: { state: "approved" },
      passive_limitations: { state: "untouched" },
      technological_objective: { stale: true },
    });
    expect(laterReviewFor(current, "goal_problem")).toEqual({ count: 1, firstRoleId: "technological_objective" });
  });

  it("offers nothing once no step is marked", () => {
    expect(laterReviewFor(rows({}), "company_context")).toBeNull();
  });
});
