import type { WorkflowStage } from "../../../shared/workflowStages";

/** Stage menu groups for the Details panel (ui-design-final.md section 8). */
export const WORKFLOW_STAGE_GROUPS: ReadonlyArray<{ label: string; stages: readonly WorkflowStage[] }> = [
  {
    label: "In progress",
    stages: ["intake", "interview_complete", "drafting", "internal_review", "edits", "client_review", "revisions"],
  },
  { label: "Done", stages: ["ready_for_delivery", "delivered"] },
  { label: "Paused", stages: ["on_hold", "abandoned"] },
];
