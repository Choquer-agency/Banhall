import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../../shared/pdSubsections";
import { domainError } from "./contracts";
import {
  loadSeedDecisionState,
  materializeCompleteDecisionSnapshot,
  materializeActiveSelections,
  type SeedDecisionReadBudget,
} from "./seedDecisionState";
import {
  completeContextRevision,
  selectionRevision,
  isSeedSubsectionStale,
} from "./seedRevisions";

type RoleEventKind = Exclude<
  Doc<"seedDecisionEvents">["kind"],
  "initialized" | "signOff" | "cancel" | "stop"
>;
type EventFields = Partial<
  Pick<
    Doc<"seedDecisionEvents">,
    | "batchId"
    | "attemptId"
    | "feedbackRequestId"
    | "seedId"
    | "contextRevision"
    | "selectionRevision"
    | "contributionHashes"
    | "outcome"
    | "staleEpisodeId"
    | "editRatio"
    | "confirmed"
    | "snapshot"
  >
>;
export async function appendSeedRoleEvent(
  ctx: MutationCtx,
  row: Pick<
    Doc<"seedSubsections">,
    | "projectId"
    | "generationId"
    | "roleId"
    | "currentContextRevision"
    | "selectionRevision"
  >,
  kind: RoleEventKind,
  actorUserId: Id<"users"> | null,
  fields: EventFields = {},
) {
  return await ctx.db.insert("seedDecisionEvents", {
    projectId: row.projectId,
    generationId: row.generationId,
    roleId: row.roleId,
    kind,
    at: Date.now(),
    contextRevision: row.currentContextRevision,
    selectionRevision: row.selectionRevision,
    ...(actorUserId ? { actorUserId } : { actorSystem: true as const }),
    ...fields,
  });
}

export async function disposeSeedEpisode(
  ctx: MutationCtx,
  row: Doc<"seedSubsections">,
  disposition: "resolved" | "bypassed",
  facts: {
    freshAttemptCompleted?: boolean;
    freshSeedsInSnapshot?: boolean;
    olderSelectionsConfirmed?: boolean;
  } = {},
) {
  if (!row.activeStaleEpisodeId) return;
  const episode = await ctx.db.get(row.activeStaleEpisodeId);
  if (
    !episode ||
    episode.generationId !== row.generationId ||
    episode.roleId !== row.roleId ||
    episode.projectId !== row.projectId
  )
    domainError("INVALID_STATE", "Invalid stale episode ownership");
  if (episode.disposedAt === undefined) {
    await ctx.db.patch(episode._id, {
      disposedAt: Date.now(),
      disposition,
      ...facts,
    });
    await appendSeedRoleEvent(ctx, row, "staleDisposed", null, {
      staleEpisodeId: episode._id,
      outcome: disposition,
    });
  }
  await ctx.db.patch(row._id, { activeStaleEpisodeId: undefined });
}

async function openSeedEpisode(
  ctx: MutationCtx,
  row: Doc<"seedSubsections">,
  reasons: PdSubsectionRoleId[],
) {
  const staleEpisodeId = await ctx.db.insert("seedStaleEpisodes", {
    projectId: row.projectId,
    generationId: row.generationId,
    roleId: row.roleId,
    openedAt: Date.now(),
    reasons,
  });
  await ctx.db.patch(row._id, { activeStaleEpisodeId: staleEpisodeId });
  await appendSeedRoleEvent(ctx, row, "staleOpened", null, { staleEpisodeId });
}

/**
 * AD-36 owns episode writes even when failure restoration triggers the transition.
 * seedRuns delegates inside its existing transaction; mandatory settlement never
 * reloads the full Decision Set. Old attempts without causal metadata use [] to
 * mean unknown provenance, not proof that no predecessor changed.
 */
export async function reconcileRestoredSeedApproval(
  ctx: MutationCtx,
  restored: Doc<"seedSubsections">,
) {
  if (!isSeedSubsectionStale(restored) || restored.activeStaleEpisodeId) return;
  await openSeedEpisode(ctx, restored, restored.pendingApprovalReasons ?? []);
}

/** Lifecycle owner calls this leaf helper without importing public seed endpoints. */
export async function bypassSeedEpisodes(
  ctx: MutationCtx,
  generationId: Id<"generations">,
) {
  const rows = await ctx.db
    .query("seedSubsections")
    .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
    .take(14);
  if (rows.length > 13)
    domainError("INVALID_STATE", "Duplicate seed subsections");
  for (const row of rows) {
    await disposeSeedEpisode(ctx, row, "bypassed");
    if (row.pendingApprovalReasons !== undefined)
      await ctx.db.patch(row._id, { pendingApprovalReasons: undefined });
  }
}

/** Recompute complete decisions after a write in the same transaction; never truncate hashes. */
export async function recomputeSeedDecisions(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  changedRoleId: PdSubsectionRoleId,
  revertOwnApproval: boolean,
  budget?: SeedDecisionReadBudget,
) {
  const state = await loadSeedDecisionState(ctx, {
    generationId,
    requireComplete: true,
    roleId: changedRoleId,
    budget,
  });
  const changedOrder = PD_SUBSECTIONS.find(
    (r) => r.roleId === changedRoleId,
  )!.order;
  const active = materializeActiveSelections(state);
  for (const definition of PD_SUBSECTIONS) {
    if (definition.order < changedOrder) continue;
    const row = state.subsections.find((r) => r.roleId === definition.roleId);
    if (!row) domainError("INVALID_STATE", "Missing seed subsection");
    const currentContextRevision = await completeContextRevision(
      materializeCompleteDecisionSnapshot(state, { targetRoleId: row.roleId }),
    );
    const nextSelectionRevision = await selectionRevision(
      active.filter((s) => s.roleId === row.roleId),
    );
    const own = row.roleId === changedRoleId;
    const nextState =
      own && revertOwnApproval && row.state === "approved"
        ? "in_progress"
        : row.state;
    const pendingApproval =
      row.state === "generating" &&
      row.priorState === "approved" &&
      !(own && revertOwnApproval);
    const revisionMismatch =
      row.approvedContextRevision !== currentContextRevision ||
      row.approvedSelectionRevision !== nextSelectionRevision;
    const contributionChanged =
      row.currentContextRevision !== currentContextRevision ||
      row.selectionRevision !== nextSelectionRevision;
    let pendingApprovalReasons =
      pendingApproval && revisionMismatch
        ? row.pendingApprovalReasons
        : undefined;
    if (
      !own &&
      pendingApproval &&
      revisionMismatch &&
      !row.activeStaleEpisodeId &&
      contributionChanged
    ) {
      pendingApprovalReasons = [
        ...new Set([...(pendingApprovalReasons ?? []), changedRoleId]),
      ];
    }
    await ctx.db.patch(row._id, {
      currentContextRevision,
      selectionRevision: nextSelectionRevision,
      state: nextState,
      pendingApprovalReasons,
      ...(own &&
      revertOwnApproval &&
      row.state === "generating" &&
      row.priorState === "approved"
        ? { priorState: "in_progress" as const }
        : {}),
    });
    if (
      !own &&
      revisionMismatch &&
      (nextState === "approved" || pendingApproval)
    ) {
      if (row.activeStaleEpisodeId && contributionChanged) {
        const episode = await ctx.db.get(row.activeStaleEpisodeId);
        if (
          !episode ||
          episode.disposedAt !== undefined ||
          episode.generationId !== generationId ||
          episode.projectId !== row.projectId ||
          episode.roleId !== row.roleId
        )
          domainError("INVALID_STATE", "Invalid active stale episode");
        if (!episode.reasons.includes(changedRoleId))
          await ctx.db.patch(episode._id, {
            reasons: [...episode.reasons, changedRoleId],
          });
      } else if (!row.activeStaleEpisodeId && nextState === "approved") {
        await openSeedEpisode(
          ctx,
          {
            ...row,
            currentContextRevision,
            selectionRevision: nextSelectionRevision,
          },
          contributionChanged ? [changedRoleId] : [],
        );
      }
    }
  }
  const current = await ctx.db
    .query("seedSubsections")
    .withIndex("by_generationId_and_roleId", (q) =>
      q.eq("generationId", generationId).eq("roleId", changedRoleId),
    )
    .unique();
  if (!current) domainError("INVALID_STATE", "Missing seed subsection");
  return current;
}
