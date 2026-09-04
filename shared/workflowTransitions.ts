import { WORKFLOW_STAGES, type WorkflowStage } from "./workflowStages";

export type TransitionAuthority =
  | "owner"
  | "handoff_assignee"
  | "manager"
  | "admin";

export type TransitionRequirement =
  | "delivery_outcome"
  | "promoted_branch"
  | "review_decision";

/** The reviewer judgement an internal-review completion edge records. */
export type ReviewDecision = "approve" | "return";

/**
 * The decision value that agrees with an internal-review completion edge:
 * returning the report for edits is a `return`, promoting it to
 * `ready_for_delivery` is an `approve`. Shared by the mutation (which enforces
 * agreement) and the UI (which derives the value from the destination), so the
 * mapping lives in exactly one place.
 */
export function reviewDecisionForStage(to: WorkflowStage): ReviewDecision | undefined {
  if (to === "edits") return "return";
  if (to === "ready_for_delivery") return "approve";
  return undefined;
}

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
  // The two internal-review completion edges: the handoff assignee is
  // additionally authorized on them AND they are the edges that must record a
  // reviewer decision. One predicate, both policies.
  const isReviewCompletion =
    from === "internal_review" && (to === "edits" || to === "ready_for_delivery");
  const authorities =
    from === "abandoned" || (from === "delivered" && to === "on_hold")
      ? managerAdmin
      : isReviewCompletion
        ? reviewAuthorities
        : ownerManagerAdmin;
  const requiresNote =
    to === "on_hold" || to === "abandoned" || from === "delivered" || from === "abandoned";
  const baseRequirements: readonly TransitionRequirement[] =
    to === "delivered"
      ? ["delivery_outcome"]
      : to === "ready_for_delivery"
        ? ["promoted_branch"]
        : [];
  const allRequirements: readonly TransitionRequirement[] = isReviewCompletion
    ? [...baseRequirements, "review_decision"]
    : baseRequirements;
  const requirements = allRequirements.length ? allRequirements : undefined;
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
 * enforces delivery outcomes by failing closed, `promoted_branch` fails
 * closed until branch storage lands, and `review_decision` (2026-09-04
 * amendment) requires the two internal-review completion edges to record a
 * `reviewDecisions` row pinned to the report revision that was reviewed
 * (`internal_review` → `ready_for_delivery` therefore carries both
 * `promoted_branch` and `review_decision`).
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
