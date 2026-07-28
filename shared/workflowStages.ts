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
