import { describe, expect, test } from "bun:test";
import type { Id } from "../convex/_generated/dataModel";
import { sha256 } from "../convex/lib/contracts";
import {
  snapshotAuditFields,
  snapshotIdsToDelete,
} from "../convex/lib/snapshots";
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

describe("snapshot audit state", () => {
  test("recomputes the hash and restores lineage only from matching provenance", async () => {
    const content = "exact persisted report";
    const contentHash = await sha256(content);
    const rows = new Map<string, Record<string, unknown>>([
      [
        "generation",
        {
          _id: "generation",
          projectId: "project",
          transcriptId: "transcript",
        },
      ],
      ["transcript", { projectId: "project" }],
      [
        "provenance",
        {
          projectId: "project",
          contentHash,
          generationId: "generation",
          sourceTranscriptId: "transcript",
        },
      ],
      [
        "stale-provenance",
        {
          projectId: "project",
          contentHash: "stale",
          generationId: "generation",
          sourceTranscriptId: "transcript",
        },
      ],
    ]);
    const ctx = {
      db: {
        get: async (rowId: string) => rows.get(rowId) ?? null,
      },
    } as unknown as Parameters<typeof snapshotAuditFields>[0];

    const matching = await snapshotAuditFields(ctx, {
      projectId: "project" as Id<"projects">,
      content,
      provenanceId: "provenance" as Id<"reportProvenance">,
    });
    expect(matching).toEqual({
      contentHash,
      provenanceId: "provenance" as Id<"reportProvenance">,
      generationId: "generation" as Id<"generations">,
      sourceTranscriptId: "transcript" as Id<"transcripts">,
    });

    const legacyGenerationOnly = await snapshotAuditFields(ctx, {
      projectId: "project" as Id<"projects">,
      content,
      generationId: "generation" as Id<"generations">,
    });
    expect(legacyGenerationOnly).toEqual({
      contentHash,
      provenanceId: undefined,
      generationId: "generation" as Id<"generations">,
      sourceTranscriptId: "transcript" as Id<"transcripts">,
    });

    const stale = await snapshotAuditFields(ctx, {
      projectId: "project" as Id<"projects">,
      content,
      provenanceId: "stale-provenance" as Id<"reportProvenance">,
      generationId: "generation" as Id<"generations">,
      sourceTranscriptId: "transcript" as Id<"transcripts">,
    });
    expect(stale).toEqual({
      contentHash,
      provenanceId: undefined,
      generationId: "generation" as Id<"generations">,
      sourceTranscriptId: "transcript" as Id<"transcripts">,
    });
  });
});
