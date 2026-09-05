import { describe, expect, test } from "vitest";
import { snapshotIdsToDelete } from "../convex/lib/snapshots";
import { buildMilestoneOptions } from "../src/lib/components/history/milestones";

const HOUR = 3_600_000;

describe("snapshot retention", () => {
  test("keeps permanent rows and the newest pre-restore checkpoint outside the recovery cap", () => {
    const now = 100 * HOUR;
    const permanent = Array.from({ length: 60 }, (_, index) => ({
      _id: `milestone-${index}`,
      reason: "milestone",
      createdAt: now - index,
    }));
    const recovery = Array.from({ length: 60 }, (_, index) => ({
      _id: `manual-${index}`,
      reason: "manual",
      createdAt: now - 1_000 - index,
    }));
    const newestPreRestore = {
      _id: "pre-restore-newest",
      reason: "pre_restore",
      createdAt: now - 500,
    };
    const deleted = new Set(
      snapshotIdsToDelete(
        [newestPreRestore, ...recovery, ...permanent],
        now
      )
    );

    expect(deleted.has(newestPreRestore._id)).toBe(false);
    expect(permanent.some((snapshot) => deleted.has(snapshot._id))).toBe(false);
    expect(recovery.filter((snapshot) => !deleted.has(snapshot._id))).toHaveLength(49);
  });
});

describe("milestone picker", () => {
  test("deduplicates defaults and appends only a distinct R5-or-later option", () => {
    expect(
      buildMilestoneOptions([
        { milestoneKey: "R0" },
        { milestoneKey: "R2" },
        { milestoneKey: "R02" },
        { milestoneKey: "R7" },
      ])
    ).toEqual([
      "R1 internal review",
      "R3 client edits",
      "R4 final",
      "R8 internal review",
    ]);
  });

  test("starts later milestones at R5 and supports arbitrary later numbers", () => {
    expect(buildMilestoneOptions([])).toEqual([
      "R0 draft",
      "R1 internal review",
      "R2 client send",
      "R3 client edits",
      "R4 final",
      "R5 internal review",
    ]);
    expect(
      buildMilestoneOptions([
        { milestoneKey: "R0" },
        { milestoneKey: "R1" },
        { milestoneKey: "R2" },
        { milestoneKey: "R3" },
        { milestoneKey: "R4" },
        { milestoneKey: "R5" },
        { milestoneKey: "R19" },
      ])
    ).toEqual(["R20 internal review"]);
  });
});
