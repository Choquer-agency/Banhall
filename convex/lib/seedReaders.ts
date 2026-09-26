import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../../shared/pdSubsections";
import { buildSeedApprovalChallenge, seedBatchIsOutdated } from "./seedApproval";
import { domainError } from "./contracts";
import { createReadBudget, DOCUMENT_HEADROOM } from "./readBudget";
import {
  loadSeedDecisionState,
  materializeCompleteDecisionSnapshot,
  SEED_DECISION_READ_BYTES,
  SEED_DECISION_READ_RANGES,
  SEED_DECISION_COLLECTION_ROWS,
  type SeedDecisionState,
} from "./seedDecisionState";
import { computeSeedReadiness } from "./seedReadiness";
import {
  completeContributionHashes,
  contributionHashesFromRows,
  EMPTY_CONTEXT_REVISION,
  explainChange,
  isSeedSubsectionStale,
  materializeFinalWording,
  orderShownSet,
  stableSerialize,
} from "./seedRevisions";

const MAX_PAGE_SIZE = 100;
const LIVE_SUMMARY_JOIN_PAGE_SIZE = 4;

function readerBudget() {
  return createReadBudget({
    maxBytes: SEED_DECISION_READ_BYTES,
    maxRanges: SEED_DECISION_READ_RANGES,
    reservedBytes: 3 * DOCUMENT_HEADROOM,
  });
}

async function stateOf(ctx: QueryCtx, generationId: Id<"generations">) {
  return await loadSeedDecisionState(ctx, {
    generationId,
    budget: readerBudget(),
  });
}

function roleOf(state: SeedDecisionState, roleId: PdSubsectionRoleId) {
  const row = state.subsections.find(
    (subsection) => subsection.roleId === roleId
  );
  if (!row) domainError("INVALID_STATE", "Missing seed subsection");
  return row;
}

async function changesFrom(
  state: SeedDecisionState,
  row: Doc<"seedSubsections">,
  before: ReadonlyMap<PdSubsectionRoleId, string>
) {
  const current = await completeContributionHashes(
    materializeCompleteDecisionSnapshot(state, { targetRoleId: row.roleId })
  );
  const filled = new Map(before);
  for (const definition of PD_SUBSECTIONS) {
    if (!filled.has(definition.roleId)) {
      filled.set(definition.roleId, EMPTY_CONTEXT_REVISION);
    }
  }
  return explainChange(filled, current);
}

async function staleReason(
  ctx: QueryCtx,
  state: SeedDecisionState,
  row: Doc<"seedSubsections">
) {
  if (!isSeedSubsectionStale(row)) return null;
  if (!state.complete) {
    return {
      changedRoleIds: [] as PdSubsectionRoleId[],
      restored: false,
      incomplete: true,
    };
  }
  const approval = await state.budget.one(() =>
    ctx.db
      .query("seedDecisionEvents")
      .withIndex(
        "by_generationId_and_roleId_and_kind_and_at",
        (q) =>
          q
            .eq("generationId", row.generationId)
            .eq("roleId", row.roleId)
            .eq("kind", "approve")
      )
      .order("desc")
      .first()
  );
  if (
    approval.kind === "not-loaded" ||
    !approval.value?.contributionHashes
  ) {
    return {
      changedRoleIds: [] as PdSubsectionRoleId[],
      restored: false,
      incomplete: true,
    };
  }
  return {
    ...(await changesFrom(
      state,
      row,
      new Map(
        approval.value.contributionHashes.map((hash) => [
          hash.roleId,
          hash.contributionHash,
        ])
      )
    )),
    incomplete: false,
  };
}

function countWords(bullets: readonly string[]): number {
  return bullets.reduce((total, bullet) => {
    const trimmed = bullet.trim();
    return total + (trimmed ? trimmed.split(/\s+/u).length : 0);
  }, 0);
}

export async function getOutlineData(
  ctx: QueryCtx,
  generationId: Id<"generations">
) {
  const state = await stateOf(ctx, generationId);
  const rows = [];
  for (const definition of PD_SUBSECTIONS) {
    const row = roleOf(state, definition.roleId);
    const selections = state.selectionRows.filter(
      (selection) =>
        selection.roleId === row.roleId &&
        selection.selected &&
        row.state !== "skipped"
    );
    const selectedIds = new Set(selections.map((selection) => selection.seedId));
    const seeds = orderShownSet({
      seeds: state.seeds,
      batches: state.batches,
    }).filter((seed) => selectedIds.has(seed._id));
    const finalWording = seeds.map((seed) =>
      materializeFinalWording(
        seed,
        selections.find((selection) => selection.seedId === seed._id)
      )
    );
    const shown = state.batches.find(
      (batch) => batch._id === row.shownBatchId
    );
    rows.push({
      ...definition,
      state: row.state,
      stale: isSeedSubsectionStale(row),
      staleReason: await staleReason(ctx, state, row),
      outdated: shown ? seedBatchIsOutdated(state, row, shown) : false,
      selectedCount: selections.length,
      selectedWordCount: finalWording.reduce(
        (total, bullets) => total + countWords(bullets),
        0
      ),
      countsComplete: state.complete,
      previewLines:
        row.state === "approved"
          ? finalWording.map((bullets) => bullets[0]?.slice(0, 160) ?? "")
          : [],
      pendingBatchId: row.pendingBatchId ?? null,
      shownBatchId: row.shownBatchId ?? null,
      // The approval time while the step is approved. The stored field keeps
      // the last approval after a step leaves "approved", so it is not sent
      // then.
      approvedAt: row.state === "approved" ? (row.approvedAt ?? null) : null,
    });
  }
  return {
    generationId,
    rows,
    readiness: computeSeedReadiness(state),
    usage: {
      requests: state.generation.seedRequestsReserved ?? 0,
      notice: (state.generation.seedRequestsReserved ?? 0) >= 40,
    },
    seedStageVersion: state.generation.seedStageVersion ?? 0,
    truncated: !state.complete || state.budget.snapshot().exhausted,
    budget: state.budget.snapshot(),
  };
}

function feedbackTargetWordingChanged(
  state: SeedDecisionState,
  batch: Doc<"seedBatches">
): boolean {
  if (!batch.feedbackRequestId) return false;
  const request = state.feedbackRows.find(
    (feedback) => feedback._id === batch.feedbackRequestId
  );
  if (!request) return true;
  const target = state.seeds.find((seed) => seed._id === request.targetSeedId);
  if (!target) return true;
  const selection = state.selectionRows.find(
    (row) => row.seedId === request.targetSeedId
  );
  return (
    stableSerialize(request.targetWording) !==
    stableSerialize(materializeFinalWording(target, selection))
  );
}

async function seedCard(
  ctx: QueryCtx,
  state: SeedDecisionState,
  row: Doc<"seedSubsections">,
  seed: Doc<"seeds">
) {
  const selection = state.selectionRows.find(
    (candidate) => candidate.seedId === seed._id
  );
  const batch = state.batches.find((candidate) => candidate._id === seed.batchId);
  if (!batch) domainError("INVALID_STATE", "Shown Set Seed Batch is missing");
  const citations = await state.budget.list(
    ctx.db
      .query("seedProvenance")
      .withIndex("by_seedId", (q) => q.eq("seedId", seed._id)),
    SEED_DECISION_COLLECTION_ROWS
  );
  for (const citation of citations.rows) {
    if (
      citation.projectId !== seed.projectId ||
      citation.generationId !== seed.generationId
    ) {
      domainError("INVALID_STATE", "Seed provenance ownership mismatch");
    }
  }
  let outdated: null | {
    changedRoleIds: PdSubsectionRoleId[];
    targetWordingChanged: boolean;
    incomplete: boolean;
  } = null;
  if (seedBatchIsOutdated(state, row, batch)) {
    let changedRoleIds: PdSubsectionRoleId[] = [];
    let incomplete = !state.complete;
    if (state.complete) {
      const read = await state.budget.list(
        ctx.db
          .query("seedBatchContext")
          .withIndex("by_batchId", (q) => q.eq("batchId", batch._id)),
        129
      );
      if (read.complete) {
        changedRoleIds = (
          await changesFrom(
            state,
            row,
            contributionHashesFromRows(read.rows)
          )
        ).changedRoleIds;
      } else {
        incomplete = true;
      }
    }
    outdated = {
      changedRoleIds,
      targetWordingChanged: feedbackTargetWordingChanged(state, batch),
      incomplete,
    };
  }
  return {
    seedId: seed._id,
    batchId: seed.batchId,
    roleId: seed.roleId,
    bullets: materializeFinalWording(seed, selection),
    originalBullets: seed.bullets,
    tags: seed.tags,
    support: selection?.editedBullets ? "writer_asserted" : seed.support,
    originalSupport: seed.originalSupport,
    selected: Boolean(selection?.selected) && row.state !== "skipped",
    edited: selection?.editedBullets !== undefined,
    revisionOfSeedId: seed.revisionOfSeedId ?? null,
    feedbackRequestId: seed.feedbackRequestId ?? null,
    uncertaintySeedId: seed.uncertaintySeedId ?? null,
    experimentSeedIds: seed.experimentSeedIds ?? [],
    provenance: citations.rows,
    provenanceTruncated: !citations.complete,
    outdated,
  };
}

function addSelectedAncestors(
  state: SeedDecisionState,
  roleId: PdSubsectionRoleId,
  seeds: Map<Id<"seeds">, Doc<"seeds">>
): void {
  const allSeeds = new Map(state.seeds.map((seed) => [seed._id, seed]));
  for (const selection of state.selectionRows) {
    if (!selection.selected || selection.roleId !== roleId) continue;
    let current = allSeeds.get(selection.seedId);
    const seen = new Set<Id<"seeds">>();
    while (current) {
      if (seen.has(current._id)) {
        domainError("INVALID_STATE", "Seed revision ancestry contains a cycle");
      }
      seen.add(current._id);
      seeds.set(current._id, current);
      current = current.revisionOfSeedId
        ? allSeeds.get(current.revisionOfSeedId)
        : undefined;
    }
  }
}

function isProcessingLimit(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  return (
    data !== null &&
    typeof data === "object" &&
    "reason" in data &&
    data.reason === "SEED_PROCESSING_LIMIT"
  );
}

export async function getSubsectionData(
  ctx: QueryCtx,
  generationId: Id<"generations">,
  roleId: PdSubsectionRoleId
) {
  const state = await stateOf(ctx, generationId);
  const row = roleOf(state, roleId);
  const seeds = new Map<Id<"seeds">, Doc<"seeds">>();
  const selectedIds = new Set(
    state.selectionRows
      .filter((selection) => selection.selected && selection.roleId === roleId)
      .map((selection) => selection.seedId)
  );
  for (const seed of state.seeds) {
    if (
      seed.roleId === roleId &&
      (selectedIds.has(seed._id) ||
        state.feedbackRows.some(
          (feedback) => feedback.targetSeedId === seed._id
        ))
    ) {
      seeds.set(seed._id, seed);
    }
  }
  addSelectedAncestors(state, roleId, seeds);

  const batchIds = new Set<Id<"seedBatches">>();
  if (row.shownBatchId) batchIds.add(row.shownBatchId);
  for (const feedback of state.feedbackRows) {
    if (feedback.roleId === roleId && feedback.batchId) {
      batchIds.add(feedback.batchId);
    }
  }
  let truncated = !state.complete;
  for (const batchId of batchIds) {
    const read = await state.budget.list(
      ctx.db
        .query("seeds")
        .withIndex("by_batchId", (q) => q.eq("batchId", batchId)),
      SEED_DECISION_COLLECTION_ROWS
    );
    truncated ||= !read.complete;
    for (const seed of read.rows) {
      if (seed.generationId !== generationId || seed.roleId !== roleId) {
        domainError("INVALID_STATE", "Shown Set ownership mismatch");
      }
      seeds.set(seed._id, seed);
    }
  }

  const materializableSeeds = [...seeds.values()].filter((seed) => {
    const batchLoaded = state.batches.some((batch) => batch._id === seed.batchId);
    if (batchLoaded) return true;
    if (state.complete) {
      domainError("INVALID_STATE", "Shown Set Seed Batch is missing");
    }
    truncated = true;
    return false;
  });
  const ordered = orderShownSet({
    seeds: materializableSeeds,
    batches: state.batches,
  });
  const items = [];
  for (const seed of ordered) {
    items.push(await seedCard(ctx, state, row, seed));
  }

  let approvalChallenge = null;
  if (!truncated && !state.budget.snapshot().exhausted) {
    try {
      approvalChallenge = await buildSeedApprovalChallenge(ctx, state, row);
    } catch (error) {
      if (!isProcessingLimit(error)) throw error;
      truncated = true;
    }
  }
  const currentStaleReason = await staleReason(ctx, state, row);
  truncated ||=
    state.budget.snapshot().exhausted ||
    currentStaleReason?.incomplete === true;
  if (truncated) approvalChallenge = null;

  return {
    generationId,
    roleId,
    state: row.state,
    stale: isSeedSubsectionStale(row),
    staleReason: currentStaleReason,
    items,
    feedbackGroups: state.feedbackRows
      .filter((feedback) => feedback.roleId === roleId)
      .map((feedback) => ({
        requestId: feedback._id,
        targetSeedId: feedback.targetSeedId,
        targetWording: feedback.targetWording,
        instruction: feedback.instruction,
        status: feedback.status,
        batchId: feedback.batchId ?? null,
        revisedSeedIds: ordered
          .filter((seed) => seed.feedbackRequestId === feedback._id)
          .map((seed) => seed._id),
      })),
    shownBatchId: row.shownBatchId ?? null,
    pendingBatchId: row.pendingBatchId ?? null,
    // A failed attempt restores the prior state until the third failure, so
    // an empty step says the last attempt failed instead of "no seeds yet".
    ...(row.consecutiveFailures > 0 ? { lastAttemptFailed: true as const } : {}),
    approvalChallenge,
    seedStageVersion: state.generation.seedStageVersion ?? 0,
    truncated,
    budget: state.budget.snapshot(),
  };
}

type SummaryCursor = {
  scope: string;
  version: number;
  role: number;
  inner: string | null;
};

type BatchCursor = {
  scope: string;
  version: number;
  inner: string | null;
  resume: number;
  windowSize: number;
};

function parseCursor(cursor: string): unknown {
  try {
    return JSON.parse(cursor);
  } catch {
    domainError("INVALID_INPUT", "Invalid Seed page cursor");
  }
}

function decodeSummaryCursor(
  cursor: string | null,
  scope: string,
  version: number
): SummaryCursor {
  if (cursor === null) return { scope, version, role: 0, inner: null };
  const value = parseCursor(cursor);
  if (
    typeof value !== "object" ||
    value === null ||
    !("scope" in value) ||
    value.scope !== scope ||
    !("version" in value) ||
    typeof value.version !== "number" ||
    !("role" in value) ||
    typeof value.role !== "number" ||
    !Number.isInteger(value.role) ||
    value.role < 0 ||
    value.role > PD_SUBSECTIONS.length ||
    !("inner" in value) ||
    (typeof value.inner !== "string" && value.inner !== null) ||
    (value.role === PD_SUBSECTIONS.length && value.inner !== null)
  ) {
    domainError("INVALID_INPUT", "Seed cursor does not match this request");
  }
  if (value.version !== version) {
    domainError("STALE_REVISION", "Seed summary changed; restart pagination");
  }
  return { scope, version, role: value.role, inner: value.inner };
}

function decodeBatchCursor(
  cursor: string | null,
  scope: string,
  version: number
): BatchCursor {
  if (cursor === null) {
    return { scope, version, inner: null, resume: 0, windowSize: 0 };
  }
  const value = parseCursor(cursor);
  if (
    typeof value !== "object" ||
    value === null ||
    !("scope" in value) ||
    value.scope !== scope ||
    !("version" in value) ||
    typeof value.version !== "number" ||
    !("inner" in value) ||
    (typeof value.inner !== "string" && value.inner !== null) ||
    !("resume" in value) ||
    typeof value.resume !== "number" ||
    !Number.isInteger(value.resume) ||
    value.resume < 0 ||
    !("windowSize" in value) ||
    typeof value.windowSize !== "number" ||
    !Number.isInteger(value.windowSize) ||
    value.windowSize < 0 ||
    value.windowSize > MAX_PAGE_SIZE ||
    (value.resume > 0 && value.windowSize < 1)
  ) {
    domainError("INVALID_INPUT", "Seed cursor does not match this request");
  }
  if (value.version !== version) {
    domainError("STALE_REVISION", "Batch history changed; restart pagination");
  }
  return {
    scope,
    version,
    inner: value.inner,
    resume: value.resume,
    windowSize: value.windowSize,
  };
}

function pageSize(size: number): number {
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    domainError("INVALID_INPUT", "Choose a page size from 1 to 100");
  }
  return size;
}

async function completeBatchHistoryRow(
  ctx: QueryCtx,
  budget: ReturnType<typeof readerBudget>,
  generation: Doc<"generations">,
  roleId: PdSubsectionRoleId,
  batch: Doc<"seedBatches">
) {
  if (
    batch.projectId !== generation.projectId ||
    batch.generationId !== generation._id ||
    batch.roleId !== roleId
  ) {
    domainError("INVALID_STATE", "Batch history ownership mismatch");
  }
  const seeds = await budget.list(
    ctx.db
      .query("seeds")
      .withIndex("by_batchId", (q) => q.eq("batchId", batch._id)),
    SEED_DECISION_COLLECTION_ROWS
  );
  if (!seeds.complete) return { kind: "incomplete" } as const;

  const items = [];
  for (const seed of seeds.rows) {
    if (
      seed.projectId !== generation.projectId ||
      seed.generationId !== generation._id ||
      seed.roleId !== roleId
    ) {
      domainError("INVALID_STATE", "Batch Seed ownership mismatch");
    }
    const selection = await budget.one(() =>
      ctx.db
        .query("seedSelections")
        .withIndex("by_seedId", (q) => q.eq("seedId", seed._id))
        .unique()
    );
    if (selection.kind === "not-loaded") {
      return { kind: "incomplete" } as const;
    }
    if (
      selection.value &&
      (selection.value.projectId !== generation.projectId ||
        selection.value.generationId !== generation._id ||
        selection.value.roleId !== roleId)
    ) {
      domainError("INVALID_STATE", "Batch selection ownership mismatch");
    }
    const provenance = await budget.list(
      ctx.db
        .query("seedProvenance")
        .withIndex("by_seedId", (q) => q.eq("seedId", seed._id)),
      SEED_DECISION_COLLECTION_ROWS
    );
    if (!provenance.complete) return { kind: "incomplete" } as const;
    for (const citation of provenance.rows) {
      if (
        citation.projectId !== generation.projectId ||
        citation.generationId !== generation._id
      ) {
        domainError("INVALID_STATE", "Batch provenance ownership mismatch");
      }
    }
    items.push({
      ...seed,
      finalBullets: materializeFinalWording(
        seed,
        selection.value ?? undefined
      ),
      selection: selection.value,
      provenance: provenance.rows,
    });
  }
  return { kind: "complete", value: { batch, seeds: items } } as const;
}

export async function listBatchesData(
  ctx: QueryCtx,
  generation: Doc<"generations">,
  roleId: PdSubsectionRoleId,
  cursor: string | null,
  numItems: number
) {
  const scope = `batches:${generation._id}:${roleId}`;
  const parsed = decodeBatchCursor(
    cursor,
    scope,
    generation.seedStageVersion ?? 0
  );
  const requestedSize = pageSize(numItems);
  const windowSize = parsed.resume > 0 ? parsed.windowSize : requestedSize;
  const budget = readerBudget();
  const result = await ctx.db
    .query("seedBatches")
    .withIndex("by_generationId_and_roleId", (q) =>
      q.eq("generationId", generation._id).eq("roleId", roleId)
    )
    .order("desc")
    .paginate({
      cursor: parsed.inner,
      numItems: windowSize,
      maximumBytesRead: 1024 * 1024,
      maximumRowsRead: MAX_PAGE_SIZE,
    });
  budget.account(result.page);
  if (parsed.resume > result.page.length) {
    domainError("STALE_REVISION", "Batch history changed; restart pagination");
  }

  const page = [];
  for (let index = parsed.resume; index < result.page.length; index += 1) {
    const joined = await completeBatchHistoryRow(
      ctx,
      budget,
      generation,
      roleId,
      result.page[index]
    );
    if (joined.kind === "incomplete") {
      return {
        page,
        isDone: false,
        continueCursor: JSON.stringify({
          ...parsed,
          resume: index,
          windowSize,
        }),
        truncated: true,
        budget: budget.snapshot(),
      };
    }
    page.push(joined.value);
  }

  return {
    page,
    isDone: result.isDone,
    continueCursor: JSON.stringify({
      ...parsed,
      inner: result.continueCursor,
      resume: 0,
      windowSize: 0,
    }),
    truncated: false,
    budget: budget.snapshot(),
  };
}

/** The generation settings the Summary shows read-only beside sign-off. A
 * recovery generation carries the origin's frozen copies of these fields. */
export function frozenSeedSettings(generation: Doc<"generations">) {
  return {
    lengthTarget: generation.lengthTarget ?? "standard",
    modelId: generation.singleModelId ?? null,
    writerProfile: generation.writerSettings
      ? {
          state: generation.writerSettings.profileState,
          source: generation.writerSettings.source,
          fileName: generation.writerSettings.fileName ?? null,
        }
      : null,
  };
}

/** Cited excerpts shown as exact-quote underlines in the Summary (decision
 * 17). A hand-edited item is the writer's own wording and carries none. Uses
 * the same bounded read as a Seed card on the plan (up to
 * SEED_DECISION_COLLECTION_ROWS citations, within the page's read budget), so
 * a phrase underlined on the plan keeps its underline here. When the cap or
 * the budget stops the read short, `truncated` says so; the item is never
 * silently missing citations. */
type SummaryCitation = {
  sourceId: Doc<"seedProvenance">["sourceId"];
  exactExcerpt: string;
  /** Stamped when the Seed was written; absent when the source gives none. */
  speaker?: string;
  line?: number;
  /** 2026-09-25: the cited turn's speaker had no role (decision 24). */
  needsSpeakerCheck?: boolean;
};

async function summaryCitations(
  ctx: QueryCtx,
  budget: ReturnType<typeof readerBudget>,
  seed: Doc<"seeds">,
  edited: boolean
): Promise<{ provenance: SummaryCitation[]; provenanceTruncated: boolean }> {
  if (edited) return { provenance: [], provenanceTruncated: false };
  const read = await budget.list(
    ctx.db
      .query("seedProvenance")
      .withIndex("by_seedId", (q) => q.eq("seedId", seed._id)),
    SEED_DECISION_COLLECTION_ROWS
  );
  const provenance: SummaryCitation[] = [];
  for (const citation of read.rows) {
    if (
      citation.projectId !== seed.projectId ||
      citation.generationId !== seed.generationId
    ) {
      domainError("INVALID_STATE", "Seed provenance ownership mismatch");
    }
    provenance.push({
      sourceId: citation.sourceId,
      exactExcerpt: citation.exactExcerpt,
      ...(citation.speaker !== undefined ? { speaker: citation.speaker } : {}),
      ...(citation.line !== undefined ? { line: citation.line } : {}),
      ...(citation.needsSpeakerCheck ? { needsSpeakerCheck: true } : {}),
    });
  }
  return { provenance, provenanceTruncated: !read.complete };
}

type LiveSummaryItem = {
  kind: "selection";
  seedId: Id<"seeds">;
  roleId: PdSubsectionRoleId;
  subsectionKind: Doc<"seedSubsections">["kind"];
  bullets: string[];
  support: Doc<"seeds">["support"];
  /** The writer changed the wording (not derived from `support`: a
   * generated Seed can start as writer_asserted). */
  edited: boolean;
  provenance: SummaryCitation[];
  /** Citations exist beyond `provenance` (row cap or read budget). */
  provenanceTruncated: boolean;
  tags: string[];
  uncertaintySeedId: Id<"seeds"> | null;
  experimentSeedIds: Id<"seeds">[];
};

function advanceSkippedRoles(
  role: number,
  subsections: readonly Doc<"seedSubsections">[]
): number {
  let next = role;
  while (next < PD_SUBSECTIONS.length) {
    const definition = PD_SUBSECTIONS[next];
    const subsection = subsections.find(
      (candidate) => candidate.roleId === definition.roleId
    );
    if (!subsection) domainError("INVALID_STATE", "Missing seed subsection");
    if (subsection.state !== "skipped") break;
    next += 1;
  }
  return next;
}

export async function getSummaryData(
  ctx: QueryCtx,
  generation: Doc<"generations">,
  versionId: Id<"summaryVersions"> | undefined,
  cursor: string | null,
  numItems: number
) {
  const count = pageSize(numItems);
  const budget = readerBudget();
  const summaryId = versionId ?? generation.summaryVersionId;
  if (summaryId) {
    const version = await ctx.db.get(summaryId);
    budget.account(version);
    if (
      !version ||
      version.projectId !== generation.projectId ||
      (!versionId && version._id !== generation.summaryVersionId) ||
      (version.generationId !== generation._id &&
        generation.summaryVersionId !== version._id)
    ) {
      domainError("INVALID_INPUT", "Summary does not belong to this generation");
    }
    const parsed = decodeSummaryCursor(
      cursor,
      `summary:${generation._id}:${summaryId}`,
      version.version
    );
    if (parsed.role !== 0) {
      domainError("INVALID_INPUT", "Seed cursor does not match this request");
    }
    const result = await ctx.db
      .query("summaryItems")
      .withIndex("by_summaryVersionId_and_order", (q) =>
        q.eq("summaryVersionId", summaryId)
      )
      .paginate({
        cursor: parsed.inner,
        numItems: count,
        maximumBytesRead: 1024 * 1024,
        maximumRowsRead: MAX_PAGE_SIZE,
      });
    budget.account(result.page);
    // Items frozen since 2026-09-24 store the authoritative `edited` flag
    // (the selection carried `editedBullets` at sign-off, even when the text
    // matches the generated wording). Older rows lack it, so for those
    // `edited` compares the final wording with the Seed's generated bullets
    // (immutable). One point read per item on a page already capped at
    // MAX_PAGE_SIZE rows; Seed rows hold one or two short bullets.
    const page = [];
    for (const item of result.page) {
      if (
        item.projectId !== generation.projectId ||
        item.summaryVersionId !== summaryId
      ) {
        domainError("INVALID_STATE", "Frozen Summary ownership mismatch");
      }
      const seed = await ctx.db.get(item.seedId);
      budget.account(seed);
      if (
        !seed ||
        seed.projectId !== generation.projectId ||
        seed.roleId !== item.roleId
      ) {
        domainError("INVALID_STATE", "Frozen Summary ownership mismatch");
      }
      const edited =
        item.edited ??
        stableSerialize(item.bullets) !== stableSerialize(seed.bullets);
      page.push({
        ...item,
        kind: "selection" as const,
        subsectionKind: item.kind,
        edited,
        ...(await summaryCitations(ctx, budget, seed, edited)),
      });
    }
    return {
      page,
      skippedRoleIds: version.skippedRoleIds,
      isDone: result.isDone,
      continueCursor: JSON.stringify({
        ...parsed,
        inner: result.continueCursor,
      }),
      partial: !result.isDone || cursor !== null,
      frozen: true,
      generationId: generation._id,
      summaryVersionId: summaryId,
      // Shown beside the model only from version 2 on (PRD FR-21).
      summaryVersion: version.version,
      seedStageVersion: generation.seedStageVersion ?? 0,
      settings: frozenSeedSettings(generation),
      budget: budget.snapshot(),
    };
  }

  const parsed = decodeSummaryCursor(
    cursor,
    `summary:${generation._id}:live`,
    generation.seedStageVersion ?? 0
  );
  const subsectionRead = await budget.list(
    ctx.db
      .query("seedSubsections")
      .withIndex("by_generationId", (q) =>
        q.eq("generationId", generation._id)
      ),
    PD_SUBSECTIONS.length + 1
  );
  if (
    !subsectionRead.complete ||
    subsectionRead.rows.length !== PD_SUBSECTIONS.length ||
    new Set(subsectionRead.rows.map((row) => row.roleId)).size !==
      PD_SUBSECTIONS.length
  ) {
    domainError("INVALID_STATE", "Seed summary initialization is incomplete");
  }
  for (const subsection of subsectionRead.rows) {
    if (
      subsection.projectId !== generation.projectId ||
      subsection.generationId !== generation._id
    ) {
      domainError("INVALID_STATE", "Seed Summary subsection ownership mismatch");
    }
  }

  const role = advanceSkippedRoles(parsed.role, subsectionRead.rows);
  if (role === PD_SUBSECTIONS.length) {
    if (parsed.inner !== null) {
      domainError("INVALID_INPUT", "Seed cursor does not match this request");
    }
    return {
      page: [] as LiveSummaryItem[],
      skippedRoleIds: subsectionRead.rows
        .filter((subsection) => subsection.state === "skipped")
        .map((subsection) => subsection.roleId),
      isDone: true,
      continueCursor: JSON.stringify({
        ...parsed,
        role,
        inner: null,
      }),
      partial: cursor !== null,
      frozen: false,
      generationId: generation._id,
      summaryVersionId: null,
      summaryVersion: null,
      seedStageVersion: generation.seedStageVersion ?? 0,
      settings: frozenSeedSettings(generation),
      budget: budget.snapshot(),
    };
  }

  const definition = PD_SUBSECTIONS[role];
  const subsection = subsectionRead.rows.find(
    (candidate) => candidate.roleId === definition.roleId
  );
  if (!subsection) domainError("INVALID_STATE", "Missing seed subsection");
  const result = await ctx.db
    .query("seedSelections")
    .withIndex(
      "by_generationId_and_roleId_and_selected_and_orderKey",
      (q) =>
        q
          .eq("generationId", generation._id)
          .eq("roleId", definition.roleId)
          .eq("selected", true)
    )
    .paginate({
      cursor: parsed.inner,
      numItems: Math.min(count, LIVE_SUMMARY_JOIN_PAGE_SIZE),
      maximumBytesRead: 256 * 1024,
      maximumRowsRead: LIVE_SUMMARY_JOIN_PAGE_SIZE,
    });
  budget.account(result.page);

  const page: LiveSummaryItem[] = [];
  for (const selection of result.page) {
    if (
      selection.projectId !== generation.projectId ||
      selection.generationId !== generation._id ||
      selection.roleId !== definition.roleId
    ) {
      domainError("INVALID_STATE", "Summary selection ownership mismatch");
    }
    const loaded = await budget.one(() => ctx.db.get(selection.seedId));
    if (loaded.kind !== "loaded") {
      domainError(
        "INVALID_INPUT",
        `Summary for ${definition.roleId} exceeds its page budget`,
        { reason: "SEED_PROCESSING_LIMIT", roleId: definition.roleId }
      );
    }
    const seed = loaded.value;
    if (
      !seed ||
      seed.projectId !== generation.projectId ||
      seed.generationId !== generation._id ||
      seed.roleId !== definition.roleId
    ) {
      domainError("INVALID_STATE", "Summary selection ownership mismatch");
    }
    page.push({
      kind: "selection",
      seedId: seed._id,
      roleId: seed.roleId,
      subsectionKind: definition.kind,
      bullets: materializeFinalWording(seed, selection),
      support: selection.editedBullets ? "writer_asserted" : seed.support,
      edited: selection.editedBullets !== undefined,
      ...(await summaryCitations(ctx, budget, seed, selection.editedBullets !== undefined)),
      tags: seed.tags,
      uncertaintySeedId: seed.uncertaintySeedId ?? null,
      experimentSeedIds: seed.experimentSeedIds ?? [],
    });
  }

  let nextRole = role;
  let nextInner: string | null = result.continueCursor;
  if (result.isDone) {
    nextRole = advanceSkippedRoles(role + 1, subsectionRead.rows);
    nextInner = null;
  }
  const isDone = nextRole === PD_SUBSECTIONS.length;
  return {
    page,
    skippedRoleIds: subsectionRead.rows
      .filter((candidate) => candidate.state === "skipped")
      .map((candidate) => candidate.roleId),
    isDone,
    continueCursor: JSON.stringify({
      ...parsed,
      role: nextRole,
      inner: nextInner,
    }),
    partial: !isDone || cursor !== null,
    frozen: false,
    generationId: generation._id,
    summaryVersionId: null,
    summaryVersion: null,
    seedStageVersion: generation.seedStageVersion ?? 0,
    settings: frozenSeedSettings(generation),
    budget: budget.snapshot(),
  };
}
