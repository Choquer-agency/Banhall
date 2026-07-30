export const WORKFLOW_STAGES = [
  "intake",
  "interview_complete",
  "drafting",
  "internal_review",
  "client_review",
  "revisions",
  "ready_for_delivery",
  "delivered",
  "on_hold",
  "abandoned",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const WORKFLOW_STAGE_PIPELINE_ORDER = [
  "intake",
  "interview_complete",
  "drafting",
  "internal_review",
  "client_review",
  "revisions",
  "ready_for_delivery",
  "on_hold",
  "delivered",
  "abandoned",
] as const satisfies readonly WorkflowStage[];

export const WORKFLOW_STAGE_LEGACY_RANK = 1_000;

export function workflowStageRank(stage?: WorkflowStage) {
  const rank = stage ? WORKFLOW_STAGE_PIPELINE_ORDER.indexOf(stage) : -1;
  return rank < 0 ? WORKFLOW_STAGE_LEGACY_RANK : rank;
}
