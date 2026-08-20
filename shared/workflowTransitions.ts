import { WORKFLOW_STAGES, type WorkflowStage } from "./workflowStages";

export type TransitionAuthority =
  | "owner"
  | "handoff_assignee"
  | "manager"
  | "admin";

export type TransitionRequirement = "delivery_outcome" | "promoted_branch";

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

function transitionRule(from: WorkflowStage, to: WorkflowStage): WorkflowTransitionRule {
  const authorities =
    from === "abandoned" || (from === "delivered" && to === "on_hold")
      ? managerAdmin
      : from === "internal_review" && (to === "edits" || to === "ready_for_delivery")
        ? reviewAuthorities
        : ownerManagerAdmin;
  const requiresNote =
    to === "on_hold" || to === "abandoned" || from === "delivered" || from === "abandoned";
  const requirements: readonly TransitionRequirement[] | undefined =
    to === "delivered"
      ? ["delivery_outcome"]
      : to === "ready_for_delivery"
        ? ["promoted_branch"]
        : undefined;
  return {
    from,
    to,
    authorities,
    ...(requiresNote ? { requiresNote: true } : {}),
    ...(requirements ? { requirements } : {}),
  };
}

/**
 * Open transition matrix from docs/product-domain.md (2026-08-17 amendment):
 * every stage may move to every other stage. Policy is per-edge, not
 * per-path — pausing/abandoning and any exit from a terminal stage
 * (`delivered`, `abandoned`) require an audit note; reopening `abandoned`
 * and the exceptional `delivered` → `on_hold` correction stay
 * Manager/Admin-only; the handoff assignee keeps authority over the two
 * internal-review completion edges. Requirements are data hooks: PSOS-09
 * enforces delivery outcomes by failing closed, and `promoted_branch`
 * fails closed until branch storage lands.
 */
export const WORKFLOW_TRANSITIONS: readonly WorkflowTransitionRule[] =
  WORKFLOW_STAGES.flatMap((from) =>
    WORKFLOW_STAGES.filter((to) => to !== from).map((to) => transitionRule(from, to))
  );

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
