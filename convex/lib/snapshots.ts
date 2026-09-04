import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256 } from "./contracts";
import { generationTranscriptIds } from "./transcripts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HARD_CAP = 50;

type SnapshotCtx = MutationCtx | QueryCtx;

export type SnapshotAuditSource = {
  projectId: Id<"projects">;
  content: string;
  provenanceId?: Id<"reportProvenance">;
  generationId?: Id<"generations">;
  sourceTranscriptId?: Id<"transcripts">;
  sourceTranscriptIds?: Id<"transcripts">[];
};

export type SnapshotAuditFields = {
  contentHash: string;
  provenanceId?: Id<"reportProvenance">;
  generationId?: Id<"generations">;
  sourceTranscriptId?: Id<"transcripts">;
  sourceTranscriptIds?: Id<"transcripts">[];
};

async function validGeneration(
  ctx: SnapshotCtx,
  projectId: Id<"projects">,
  generationId?: Id<"generations">
): Promise<Doc<"generations"> | undefined> {
  if (!generationId) return undefined;
  const generation = await ctx.db.get(generationId);
  return generation?.projectId === projectId ? generation : undefined;
}

async function validTranscriptId(
  ctx: SnapshotCtx,
  projectId: Id<"projects">,
  transcriptId?: Id<"transcripts">
): Promise<Id<"transcripts"> | undefined> {
  if (!transcriptId) return undefined;
  const transcript = await ctx.db.get(transcriptId);
  return transcript?.projectId === projectId ? transcriptId : undefined;
}

async function validTranscriptIds(
  ctx: SnapshotCtx,
  projectId: Id<"projects">,
  transcriptIds?: Id<"transcripts">[]
): Promise<Id<"transcripts">[] | undefined> {
  if (!transcriptIds) return undefined;
  const checked = await Promise.all(
    transcriptIds.map((id) => validTranscriptId(ctx, projectId, id))
  );
  return checked.filter((id): id is Id<"transcripts"> => id !== undefined);
}

/**
 * Rebuild the audit fields for the exact content being snapshotted/restored.
 * Stale or cross-project references are omitted; valid provenance can fill
 * lineage absent on legacy report/snapshot rows.
 */
export async function snapshotAuditFields(
  ctx: SnapshotCtx,
  source: SnapshotAuditSource
): Promise<SnapshotAuditFields> {
  const contentHash = await sha256(source.content);
  const generation = await validGeneration(
    ctx,
    source.projectId,
    source.generationId
  );
  let generationId = generation?._id;
  const explicitTranscriptId = await validTranscriptId(
    ctx,
    source.projectId,
    source.sourceTranscriptId
  );
  const generationTranscriptId = await validTranscriptId(
    ctx,
    source.projectId,
    generation?.transcriptId
  );
  let sourceTranscriptId = generationTranscriptId ?? explicitTranscriptId;
  // The list follows the generation and is never invented from a lone
  // sourceTranscriptId: a legacy report says nothing about the rest of the set.
  let sourceTranscriptIds =
    (await validTranscriptIds(
      ctx,
      source.projectId,
      generationTranscriptIds(generation)
    )) ??
    (await validTranscriptIds(ctx, source.projectId, source.sourceTranscriptIds));
  let provenanceId: Id<"reportProvenance"> | undefined;

  if (source.provenanceId) {
    const provenance = await ctx.db.get(source.provenanceId);
    if (
      provenance?.projectId === source.projectId &&
      provenance.contentHash === contentHash
    ) {
      const provenanceGeneration = await validGeneration(
        ctx,
        source.projectId,
        provenance.generationId
      );
      const provenanceGenerationId = provenanceGeneration?._id;
      const explicitProvenanceTranscriptId = await validTranscriptId(
        ctx,
        source.projectId,
        provenance.sourceTranscriptId
      );
      const provenanceGenerationTranscriptId = await validTranscriptId(
        ctx,
        source.projectId,
        provenanceGeneration?.transcriptId
      );
      const provenanceTranscriptId =
        provenanceGenerationTranscriptId ?? explicitProvenanceTranscriptId;
      const provenanceTranscriptIds =
        (await validTranscriptIds(
          ctx,
          source.projectId,
          generationTranscriptIds(provenanceGeneration)
        )) ??
        (await validTranscriptIds(
          ctx,
          source.projectId,
          provenance.sourceTranscriptIds
        ));
      const hasInvalidLineage =
        (provenance.generationId !== undefined && !provenanceGenerationId) ||
        (provenance.sourceTranscriptId !== undefined &&
          !explicitProvenanceTranscriptId) ||
        (explicitProvenanceTranscriptId !== undefined &&
          provenanceGenerationTranscriptId !== undefined &&
          explicitProvenanceTranscriptId !==
            provenanceGenerationTranscriptId);
      const hasConflictingLineage =
        (generationId !== undefined &&
          provenanceGenerationId !== undefined &&
          generationId !== provenanceGenerationId) ||
        (sourceTranscriptId !== undefined &&
          provenanceTranscriptId !== undefined &&
          sourceTranscriptId !== provenanceTranscriptId);

      if (!hasInvalidLineage && !hasConflictingLineage) {
        generationId ??= provenanceGenerationId;
        sourceTranscriptId ??= provenanceTranscriptId;
        sourceTranscriptIds ??= provenanceTranscriptIds;
        provenanceId = source.provenanceId;
      }
    }
  }

  return {
    contentHash,
    provenanceId,
    generationId,
    sourceTranscriptId,
    sourceTranscriptIds,
  };
}

/** Snapshot dedupe treats an absent list and an empty list as different states. */
export function sameTranscriptIds(
  a?: readonly Id<"transcripts">[],
  b?: readonly Id<"transcripts">[]
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

type RetentionSnapshot<TId extends string> = {
  _id: TId;
  reason: string;
  createdAt: number;
};

/**
 * Decide which recovery snapshots to thin. Permanent milestones/generated
 * baselines do not consume the recovery cap, and the newest pre-restore
 * checkpoint is always retained even when that cap is full.
 */
export function snapshotIdsToDelete<TId extends string>(
  snaps: ReadonlyArray<RetentionSnapshot<TId>>,
  now: number
): TId[] {
  const newestPreRestore = snaps.find(
    (snapshot) => snapshot.reason === "pre_restore"
  );
  const candidates = snaps.filter(
    (snapshot) =>
      snapshot.reason !== "milestone" &&
      snapshot.reason !== "generated" &&
      snapshot._id !== newestPreRestore?._id
  );

  const seen = new Set<string>();
  const kept: typeof candidates = [];
  const toDelete: typeof candidates = [];

  for (const snapshot of candidates) {
    const age = now - snapshot.createdAt;
    let bucket: string;
    if (age < HOUR) {
      bucket = `r:${snapshot._id}`;
    } else if (age < DAY) {
      bucket = `h:${Math.floor(snapshot.createdAt / HOUR)}`;
    } else {
      bucket = `d:${Math.floor(snapshot.createdAt / DAY)}`;
    }
    if (seen.has(bucket)) {
      toDelete.push(snapshot);
    } else {
      seen.add(bucket);
      kept.push(snapshot);
    }
  }

  const remainingSlots = Math.max(0, HARD_CAP - (newestPreRestore ? 1 : 0));
  if (kept.length > remainingSlots) {
    toDelete.push(...kept.slice(remainingSlots));
  }

  return toDelete.map((snapshot) => snapshot._id);
}

/**
 * Log-thinning retention for recovery checkpoints. Generated baselines and
 * named milestones are permanent, while the newest pre-restore checkpoint is
 * protected independently from the bounded manual/periodic recovery stream.
 */
export async function pruneSnapshots(
  ctx: MutationCtx,
  reportId: Id<"reports">
) {
  const snaps = await ctx.db
    .query("reportSnapshots")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
    .order("desc")
    .take(1_000);

  for (const snapshotId of snapshotIdsToDelete(snaps, Date.now())) {
    await ctx.db.delete(snapshotId);
  }
}
