import type { WorkflowStage } from "./workflowStages";

export type TransitionAuthority =
  | "owner"
  | "handoff_assignee"
  | "manager"
  | "admin";

export type TransitionRequirement =
  | "delivery_outcome"
  | "promoted_branch"
  | "review_handoff";

export type WorkflowTransitionRule = {
  from: WorkflowStage;
  to: WorkflowStage;
  authorities: readonly TransitionAuthority[];
  requiresNote?: boolean;
  requirements?: readonly TransitionRequirement[];
};

const ownerManagerAdmin = ["owner", "manager", "admin"] as const;
const reviewAuthorities = [
  "handoff_assignee",
  "owner",
  "manager",
  "admin",
] as const;
const managerAdmin = ["manager", "admin"] as const;

/**
 * Exact transition matrix from docs/product-domain.md. Requirements are data
 * hooks for later tickets; PSOS-09 enforces delivery outcomes by failing closed
 * and records the branch/handoff hooks without enabling automation.
 */
export const WORKFLOW_TRANSITIONS: readonly WorkflowTransitionRule[] = [
  { from: "intake", to: "interview_complete", authorities: ownerManagerAdmin },
  { from: "intake", to: "drafting", authorities: ownerManagerAdmin },
  { from: "intake", to: "on_hold", authorities: ownerManagerAdmin, requiresNote: true },
  { from: "intake", to: "abandoned", authorities: ownerManagerAdmin, requiresNote: true },

  { from: "interview_complete", to: "drafting", authorities: ownerManagerAdmin },
  { from: "interview_complete", to: "on_hold", authorities: ownerManagerAdmin, requiresNote: true },
  { from: "interview_complete", to: "abandoned", authorities: ownerManagerAdmin, requiresNote: true },

  { from: "drafting", to: "internal_review", authorities: ownerManagerAdmin },
  { from: "drafting", to: "client_review", authorities: ownerManagerAdmin },
  {
    from: "drafting",
    to: "ready_for_delivery",
    authorities: ownerManagerAdmin,
    requirements: ["promoted_branch"],
  },
  { from: "drafting", to: "on_hold", authorities: ownerManagerAdmin, requiresNote: true },
  { from: "drafting", to: "abandoned", authorities: ownerManagerAdmin, requiresNote: true },

  { from: "internal_review", to: "revisions", authorities: reviewAuthorities },
  {
    from: "internal_review",
    to: "ready_for_delivery",
    authorities: reviewAuthorities,
    requirements: ["promoted_branch"],
  },
  { from: "internal_review", to: "on_hold", authorities: ownerManagerAdmin, requiresNote: true },
  { from: "internal_review", to: "abandoned", authorities: ownerManagerAdmin, requiresNote: true },

  { from: "client_review", to: "revisions", authorities: ownerManagerAdmin },
  {
    from: "client_review",
    to: "ready_for_delivery",
    authorities: ownerManagerAdmin,
    requirements: ["promoted_branch"],
  },
  { from: "client_review", to: "on_hold", authorities: ownerManagerAdmin, requiresNote: true },
  { from: "client_review", to: "abandoned", authorities: ownerManagerAdmin, requiresNote: true },

  { from: "revisions", to: "internal_review", authorities: ownerManagerAdmin },
  { from: "revisions", to: "client_review", authorities: ownerManagerAdmin },
  {
    from: "revisions",
    to: "ready_for_delivery",
    authorities: ownerManagerAdmin,
    requirements: ["promoted_branch"],
  },
  { from: "revisions", to: "on_hold", authorities: ownerManagerAdmin, requiresNote: true },
  { from: "revisions", to: "abandoned", authorities: ownerManagerAdmin, requiresNote: true },

  {
    from: "ready_for_delivery",
    to: "delivered",
    authorities: ownerManagerAdmin,
    requirements: ["delivery_outcome"],
  },
  { from: "ready_for_delivery", to: "revisions", authorities: ownerManagerAdmin },
  { from: "ready_for_delivery", to: "on_hold", authorities: ownerManagerAdmin, requiresNote: true },
  { from: "ready_for_delivery", to: "abandoned", authorities: ownerManagerAdmin, requiresNote: true },

  { from: "delivered", to: "revisions", authorities: ownerManagerAdmin, requiresNote: true },
  { from: "delivered", to: "on_hold", authorities: managerAdmin, requiresNote: true },

  { from: "on_hold", to: "intake", authorities: ownerManagerAdmin },
  { from: "on_hold", to: "interview_complete", authorities: ownerManagerAdmin },
  { from: "on_hold", to: "drafting", authorities: ownerManagerAdmin },
  {
    from: "on_hold",
    to: "internal_review",
    authorities: ownerManagerAdmin,
    requirements: ["review_handoff"],
  },
  { from: "on_hold", to: "client_review", authorities: ownerManagerAdmin },
  { from: "on_hold", to: "revisions", authorities: ownerManagerAdmin },
  {
    from: "on_hold",
    to: "ready_for_delivery",
    authorities: ownerManagerAdmin,
    requirements: ["promoted_branch"],
  },
  { from: "on_hold", to: "abandoned", authorities: ownerManagerAdmin, requiresNote: true },

  { from: "abandoned", to: "intake", authorities: managerAdmin, requiresNote: true },
  { from: "abandoned", to: "drafting", authorities: managerAdmin, requiresNote: true },
] as const;

export function findWorkflowTransition(
  from: WorkflowStage,
  to: WorkflowStage
): WorkflowTransitionRule | undefined {
  return WORKFLOW_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to
  );
}

export function allowedNextWorkflowStages(from: WorkflowStage) {
  return WORKFLOW_TRANSITIONS.filter((transition) => transition.from === from).map(
    (transition) => transition.to
  );
}
