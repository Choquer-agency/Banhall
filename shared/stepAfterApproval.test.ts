import { describe, expect, it } from "vitest";
import { PD_SUBSECTIONS, stepAfterApproval, stepNeedsWriter, type PdSubsectionRoleId } from "./pdSubsections";

const ORDER = PD_SUBSECTIONS.map(({ roleId }) => roleId);

/** Every step except `open` is decided (approved or skipped). */
function openOnly(...open: PdSubsectionRoleId[]) {
  const set = new Set<PdSubsectionRoleId>(open);
  return (roleId: PdSubsectionRoleId) => set.has(roleId);
}

describe("stepAfterApproval (2026-09-28 sixth; 2026-10-19)", () => {
  it("moves to the next step on a first pass", () => {
    expect(stepAfterApproval("company_context", () => true)).toBe("goal_problem");
  });

  it("skips decided steps after it and lands on the next open one", () => {
    expect(
      stepAfterApproval("goal_problem", openOnly("company_context", "hypothesis", "project_status"))
    ).toBe("hypothesis");
  });

  it("goes back to the first open step when the last step in order is approved", () => {
    expect(
      stepAfterApproval("goal_improvements", openOnly("passive_limitations", "workplan"))
    ).toBe("passive_limitations");
  });

  it("goes back to an earlier open step when every later step is already approved", () => {
    // The 2026-10-08 case: the next step in order was approved, and the
    // writer landed there instead of on the one step still open.
    expect(stepAfterApproval("hypothesis", openOnly("goal_problem"))).toBe("goal_problem");
    expect(stepAfterApproval("experimentation", openOnly("company_context", "workplan"))).toBe(
      "company_context"
    );
  });

  it("opens the Summary when the final open step is approved, wherever it sits", () => {
    for (const roleId of ORDER) {
      // Only the step being approved was open; its own row may still read
      // as open while the approval is in flight.
      expect(stepAfterApproval(roleId, openOnly(roleId)), roleId).toBeNull();
      expect(stepAfterApproval(roleId, openOnly()), roleId).toBeNull();
    }
  });

  it("review round 1, P2-2: lands on a step marked for review, never the Summary while one is left", () => {
    // The writer reopened Goal / Problem and changed a pick: the approved
    // steps after it are marked for review (approved, stale).
    const rows = new Map<PdSubsectionRoleId, { state: string; stale: boolean }>(
      ORDER.map((roleId) => [roleId, { state: "approved", stale: false }])
    );
    rows.set("goal_problem", { state: "in_progress", stale: false });
    rows.set("hypothesis", { state: "approved", stale: true });
    rows.set("experimentation", { state: "approved", stale: true });
    const needsWriter = (roleId: PdSubsectionRoleId) => stepNeedsWriter(rows.get(roleId));
    expect(stepAfterApproval("goal_problem", needsWriter)).toBe("hypothesis");
    rows.set("goal_problem", { state: "approved", stale: false });
    rows.set("hypothesis", { state: "approved", stale: false });
    expect(stepAfterApproval("hypothesis", needsWriter)).toBe("experimentation");
    rows.set("experimentation", { state: "approved", stale: false });
    expect(stepAfterApproval("experimentation", needsWriter)).toBeNull();
  });
});

describe("stepNeedsWriter", () => {
  it("is true for an open step, a step marked for review and a missing row", () => {
    expect(stepNeedsWriter(undefined)).toBe(true);
    for (const state of ["untouched", "generating", "in_progress", "failed"]) {
      expect(stepNeedsWriter({ state, stale: false }), state).toBe(true);
    }
    expect(stepNeedsWriter({ state: "approved", stale: true })).toBe(true);
  });

  it("is false for an approved or skipped step that is not marked for review", () => {
    expect(stepNeedsWriter({ state: "approved", stale: false })).toBe(false);
    expect(stepNeedsWriter({ state: "skipped", stale: false })).toBe(false);
  });
});
