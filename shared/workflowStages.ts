export const WORKFLOW_STAGES = [
  "intake",
  "interview_complete",
  "drafting",
  "internal_review",
  "edits",
  "client_review",
  "revisions",
  "ready_for_delivery",
  "delivered",
  "on_hold",
  "abandoned",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

/**
 * Canonical presentation order (product-domain.md workflow-stage table):
 * the delivery pipeline runs `ready_for_delivery` → `delivered`, with the
 * paused/terminal exceptions (`on_hold`, `abandoned`) after it. Board columns
 * and any stage-ordered presentation follow this constant.
 */
export const WORKFLOW_STAGE_PIPELINE_ORDER = [
  "intake",
  "interview_complete",
  "drafting",
  "internal_review",
  "edits",
  "client_review",
  "revisions",
  "ready_for_delivery",
  "delivered",
  "on_hold",
  "abandoned",
] as const satisfies readonly WorkflowStage[];

export const WORKFLOW_STAGE_LEGACY_RANK = 1_000;

/**
 * Persisted sort ranks for `projects.workflowStageRank` (indexed by
 * `by_ownerId_and_workflowStageRank_and_updatedAt` and stored on every
 * projected row). These numbers are FROZEN at their historical values —
 * they predate the 2026-08-06 pipeline-order correction, which swapped
 * `on_hold`/`delivered` in presentation only. Changing a value here is a
 * data migration: it desynchronizes stored rows from derived ranks until
 * the audited re-rank backfill (`myWorkBackfill`) runs. Do not edit without
 * that backfill and a product-domain amendment.
 */
const WORKFLOW_STAGE_PERSISTED_RANK: Record<WorkflowStage, number> = {
  intake: 0,
  interview_complete: 1,
  drafting: 2,
  internal_review: 3,
  // Additive 2026-08-14 stage. Fractional rank preserves every historical
  // persisted rank while placing Edits between review and client review.
  edits: 3.5,
  client_review: 4,
  revisions: 5,
  ready_for_delivery: 6,
  on_hold: 7,
  delivered: 8,
  abandoned: 9,
};

export function workflowStageRank(stage?: WorkflowStage) {
  return stage === undefined
    ? WORKFLOW_STAGE_LEGACY_RANK
    : (WORKFLOW_STAGE_PERSISTED_RANK[stage] ?? WORKFLOW_STAGE_LEGACY_RANK);
}
