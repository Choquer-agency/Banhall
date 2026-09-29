import { describe, expect, it } from "vitest";
import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";
import { laterReviewFor } from "./laterReview";

type Override = { state?: string; stale?: boolean; staleReason?: { changedRoleIds: string[] } | null };
const rows = (overrides: Record<string, Override>) =>
  PD_SUBSECTIONS.map((definition) => ({
    roleId: definition.roleId,
    state: "approved",
    stale: false,
    staleReason: null as Override["staleReason"],
    ...overrides[definition.roleId],
  }));
const marked = (changed: string[]): Override => ({ stale: true, staleReason: { changedRoleIds: changed } });

describe("laterReviewFor (2026-09-28 seventh)", () => {
  it("offers Keep all on the step the marked steps name as changed, listing them", () => {
    const current = rows({
      goal_problem: { state: "in_progress" },
      passive_limitations: marked(["goal_problem"]),
      technological_objective: marked(["goal_problem"]),
    });
    expect(laterReviewFor(current, "goal_problem")).toEqual({
      roleIds: ["passive_limitations", "technological_objective"],
      firstRoleId: "passive_limitations",
    });
    expect(laterReviewFor(current, "company_context")).toBeNull();
    expect(laterReviewFor(current, "passive_limitations")).toBeNull();
  });

  it("uses the named step even when a later step was worked on after it", () => {
    // Goal / Problem changed; Limitations is open but was not the change.
    const current = rows({
      goal_problem: { state: "approved" },
      passive_limitations: { state: "in_progress" },
      technological_objective: marked(["goal_problem"]),
    });
    expect(laterReviewFor(current, "goal_problem")?.roleIds).toEqual(["technological_objective"]);
    expect(laterReviewFor(current, "passive_limitations")).toBeNull();
  });

  it("never offers it on a skipped step", () => {
    const current = rows({
      prior_year_status: { state: "skipped" },
      workplan: marked(["prior_year_status"]),
    });
    expect(laterReviewFor(current, "prior_year_status")).toBeNull();
    // The nearest worked step before the first marked one offers it instead.
    expect(laterReviewFor(current, "active_uncertainties")?.roleIds).toEqual(["workplan"]);
  });

  it("falls back to the nearest worked step when no change is named", () => {
    const current = rows({
      goal_problem: { state: "approved" },
      passive_limitations: { state: "untouched" },
      technological_objective: { stale: true },
    });
    expect(laterReviewFor(current, "goal_problem")).toEqual({ roleIds: ["technological_objective"], firstRoleId: "technological_objective" });
  });

  it("offers nothing once no step is marked", () => {
    expect(laterReviewFor(rows({}), "company_context")).toBeNull();
  });
});
