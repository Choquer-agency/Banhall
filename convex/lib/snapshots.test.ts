import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { sha256 } from "./contracts";
import { sameTranscriptIds, snapshotAuditFields } from "./snapshots";

const CONTENT = "exact persisted report";

type Row = Record<string, unknown>;

/**
 * The audit rebuild only ever calls `ctx.db.get`, so a Map of rows is the whole
 * database it needs. Ids are the map keys.
 */
function fakeCtx(rows: Map<string, Row>) {
  return {
    db: { get: async (rowId: string) => rows.get(rowId) ?? null },
  } as unknown as Parameters<typeof snapshotAuditFields>[0];
}

function baseRows(contentHash: string) {
  return new Map<string, Row>([
    [
      "multi-generation",
      {
        _id: "multi-generation",
        projectId: "project",
        transcriptId: "transcript-a",
        transcriptIds: ["transcript-a", "transcript-b"],
      },
    ],
    [
      "legacy-generation",
      {
        _id: "legacy-generation",
        projectId: "project",
        transcriptId: "transcript-a",
      },
    ],
    [
      "docs-only-generation",
      { _id: "docs-only-generation", projectId: "project", transcriptIds: [] },
    ],
    ["transcript-a", { projectId: "project" }],
    ["transcript-b", { projectId: "project" }],
    ["other-project-transcript", { projectId: "other-project" }],
    [
      "provenance",
      {
        projectId: "project",
        contentHash,
        generationId: "multi-generation",
        sourceTranscriptId: "transcript-a",
        sourceTranscriptIds: ["transcript-a", "transcript-b"],
      },
    ],
    [
      "stale-provenance",
      {
        projectId: "project",
        contentHash: "stale",
        generationId: "multi-generation",
        sourceTranscriptId: "transcript-a",
        sourceTranscriptIds: ["transcript-a", "transcript-b"],
      },
    ],
  ]);
}

const project = "project" as Id<"projects">;

describe("snapshot audit transcript sets", () => {
  test("carries the generation's whole set beside the single id it already wrote", async () => {
    const contentHash = await sha256(CONTENT);
    const ctx = fakeCtx(baseRows(contentHash));

    await expect(
      snapshotAuditFields(ctx, {
        projectId: project,
        content: CONTENT,
        generationId: "multi-generation" as Id<"generations">,
      })
    ).resolves.toEqual({
      contentHash,
      provenanceId: undefined,
      generationId: "multi-generation" as Id<"generations">,
      sourceTranscriptId: "transcript-a" as Id<"transcripts">,
      sourceTranscriptIds: ["transcript-a", "transcript-b"] as Id<"transcripts">[],
    });
  });

  test("reads a legacy generation as the set of one it is", async () => {
    const contentHash = await sha256(CONTENT);
    const ctx = fakeCtx(baseRows(contentHash));

    await expect(
      snapshotAuditFields(ctx, {
        projectId: project,
        content: CONTENT,
        generationId: "legacy-generation" as Id<"generations">,
      })
    ).resolves.toMatchObject({
      sourceTranscriptId: "transcript-a" as Id<"transcripts">,
      sourceTranscriptIds: ["transcript-a"] as Id<"transcripts">[],
    });
  });

  test("keeps a docs-only generation's empty set distinct from an unknown one", async () => {
    const contentHash = await sha256(CONTENT);
    const ctx = fakeCtx(baseRows(contentHash));

    await expect(
      snapshotAuditFields(ctx, {
        projectId: project,
        content: CONTENT,
        generationId: "docs-only-generation" as Id<"generations">,
      })
    ).resolves.toEqual({
      contentHash,
      provenanceId: undefined,
      generationId: "docs-only-generation" as Id<"generations">,
      sourceTranscriptId: undefined,
      sourceTranscriptIds: [],
    });
  });

  test("restores the set from matching provenance and drops it with a stale one", async () => {
    const contentHash = await sha256(CONTENT);
    const ctx = fakeCtx(baseRows(contentHash));

    await expect(
      snapshotAuditFields(ctx, {
        projectId: project,
        content: CONTENT,
        provenanceId: "provenance" as Id<"reportProvenance">,
      })
    ).resolves.toEqual({
      contentHash,
      provenanceId: "provenance" as Id<"reportProvenance">,
      generationId: "multi-generation" as Id<"generations">,
      sourceTranscriptId: "transcript-a" as Id<"transcripts">,
      sourceTranscriptIds: ["transcript-a", "transcript-b"] as Id<"transcripts">[],
    });

    // A hash mismatch drops the provenance link; the explicit generation still
    // supplies both the single id and the set.
    await expect(
      snapshotAuditFields(ctx, {
        projectId: project,
        content: CONTENT,
        provenanceId: "stale-provenance" as Id<"reportProvenance">,
        generationId: "multi-generation" as Id<"generations">,
        sourceTranscriptId: "transcript-a" as Id<"transcripts">,
      })
    ).resolves.toEqual({
      contentHash,
      provenanceId: undefined,
      generationId: "multi-generation" as Id<"generations">,
      sourceTranscriptId: "transcript-a" as Id<"transcripts">,
      sourceTranscriptIds: ["transcript-a", "transcript-b"] as Id<"transcripts">[],
    });
  });

  test("filters an explicitly passed set to the project when no generation resolves", async () => {
    const contentHash = await sha256(CONTENT);
    const ctx = fakeCtx(baseRows(contentHash));

    await expect(
      snapshotAuditFields(ctx, {
        projectId: project,
        content: CONTENT,
        sourceTranscriptIds: [
          "transcript-b",
          "other-project-transcript",
        ] as Id<"transcripts">[],
      })
    ).resolves.toMatchObject({
      sourceTranscriptIds: ["transcript-b"] as Id<"transcripts">[],
    });
  });

  test("invents no set from a lone legacy sourceTranscriptId", async () => {
    const contentHash = await sha256(CONTENT);
    const ctx = fakeCtx(baseRows(contentHash));

    await expect(
      snapshotAuditFields(ctx, {
        projectId: project,
        content: CONTENT,
        sourceTranscriptId: "transcript-a" as Id<"transcripts">,
      })
    ).resolves.toEqual({
      contentHash,
      provenanceId: undefined,
      generationId: undefined,
      sourceTranscriptId: "transcript-a" as Id<"transcripts">,
      sourceTranscriptIds: undefined,
    });
  });
});

describe("snapshot dedupe on the transcript set", () => {
  const a = "transcript-a" as Id<"transcripts">;
  const b = "transcript-b" as Id<"transcripts">;

  test.each([
    ["both absent", undefined, undefined, true],
    ["same order", [a, b], [a, b], true],
    ["both empty", [], [], true],
    ["reordered", [a, b], [b, a], false],
    ["different length", [a], [a, b], false],
    ["absent vs empty", undefined, [], false],
    ["absent vs present", undefined, [a], false],
  ] as const)("%s", (_label, left, right, expected) => {
    expect(sameTranscriptIds(left, right)).toBe(expected);
    expect(sameTranscriptIds(right, left)).toBe(expected);
  });
});
