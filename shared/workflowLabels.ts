import type { WorkflowStage } from "./workflowStages";
import {
  WORKFLOW_TRANSITIONS,
  type TransitionAuthority,
  type TransitionRequirement,
} from "./workflowTransitions";

export const WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string> = {
  intake: "Intake",
  interview_complete: "Interview complete",
  drafting: "Drafting",
  internal_review: "Internal review",
  edits: "Edits",
  client_review: "Client review",
  revisions: "Revisions",
  ready_for_delivery: "Submitted",
  delivered: "Delivered",
  on_hold: "On hold",
  abandoned: "Abandoned",
};

export const WORKFLOW_STAGE_DESCRIPTIONS: Record<WorkflowStage, string> = {
  intake: "Source intake is not yet confirmed complete.",
  interview_complete: "Interview and input collection are complete enough to draft.",
  drafting: "A consultant is producing or materially editing the report.",
  internal_review: "The report is undergoing internal review or quality assurance.",
  edits: "Internal review feedback is being incorporated by the writer.",
  client_review: "A revision is with the client for review.",
  revisions: "Feedback or identified issues require writer changes.",
  ready_for_delivery: "The signed-off deliverable is submitted and ready for input or delivery.",
  delivered: "An exact report revision was confirmed delivered or used in filing.",
  on_hold: "Work is intentionally paused without being abandoned.",
  abandoned: "The project will not proceed in its current scope.",
};

export const TRANSITION_REQUIREMENT_BLOCKERS: Record<TransitionRequirement, string> = {
  promoted_branch: "Needs a promoted report branch before this stage is available.",
  delivery_outcome: "Needs a recorded delivery or filing outcome before this stage is available.",
  review_handoff: "Needs an active internal-review handoff before this stage is available.",
};

export const MAX_WORKFLOW_NOTE_CHARS = 2_000;

export type WorkflowStageOption = {
  to: WorkflowStage;
  label: string;
  description: string;
  requiresNote: boolean;
  disabledReason: string | null;
};

export function effectiveWorkflowStage(stage: WorkflowStage | null | undefined) {
  return stage ?? "intake";
}

export function workflowStageOptions(
  from: WorkflowStage,
  viewerAuthorities: readonly TransitionAuthority[]
): WorkflowStageOption[] {
  const authoritySet = new Set(viewerAuthorities);
  return WORKFLOW_TRANSITIONS.filter(
    (transition) =>
      transition.from === from &&
      transition.authorities.some((authority) => authoritySet.has(authority))
  ).map((transition) => {
    const requirements = transition.requirements ?? [];
    return {
      to: transition.to,
      label: WORKFLOW_STAGE_LABELS[transition.to],
      description: WORKFLOW_STAGE_DESCRIPTIONS[transition.to],
      requiresNote: transition.requiresNote === true,
      disabledReason:
        requirements.length > 0
          ? requirements.map((requirement) => TRANSITION_REQUIREMENT_BLOCKERS[requirement]).join(" ")
          : null,
    };
  });
}
