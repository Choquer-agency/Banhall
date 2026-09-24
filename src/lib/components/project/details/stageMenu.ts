import type { WorkflowStage } from "../../../../../shared/workflowStages";
import {
  findWorkflowTransition,
  reviewDecisionForStage,
  type TransitionAuthority,
} from "../../../../../shared/workflowTransitions";
import { WORKFLOW_STAGE_LABELS } from "../../../../../shared/workflowLabels";
import { handoffStageRefusal } from "../../../../../shared/workItems";
import { WORKFLOW_STAGE_GROUPS } from "$lib/workflow/stageGroups";
import { nextInProgressStage } from "./detailsFormat";

/**
 * How a move from the current stage to `stage` is offered in the Change stage
 * menu (ui-design-final.md section 8, B1 to B3). Edge rules come from
 * `findWorkflowTransition`; this module only decides how each edge reads.
 *
 * - "plain": applies at once.
 * - "reason": asks for a short reason inline (On hold, Abandoned, leaving
 *   Delivered or Abandoned).
 * - "decision": an internal-review completion edge; it records the reviewer
 *   decision and asks for a confirmation first.
 */
export type StageMove = "plain" | "reason" | "decision";

export type StageMenuOption = {
  stage: WorkflowStage;
  label: string;
  current: boolean;
  /** Muted hint shown beside the stage: "next", "asks for a reason", ... */
  hint: string | null;
  disabledReason: string | null;
  move: StageMove;
};

export type StageMenuGroup = { label: string; options: StageMenuOption[] };

export const NOT_AVAILABLE_YET = "not available yet";

/** Delivery stages that cannot be reached until their records can be stored (decision 18). */
const UNAVAILABLE_STAGES: ReadonlySet<WorkflowStage> = new Set(["ready_for_delivery", "delivered"]);

function authorized(
  authorities: readonly TransitionAuthority[] | undefined,
  allowed: readonly TransitionAuthority[]
): boolean {
  if (!authorities) return true;
  return allowed.some((authority) => authorities.includes(authority));
}

export function stageMove(from: WorkflowStage, to: WorkflowStage): StageMove {
  const rule = findWorkflowTransition(from, to);
  if (!rule) return "plain";
  if (rule.requiresNote) return "reason";
  if (from === "internal_review" && reviewDecisionForStage(to)) return "decision";
  return "plain";
}

export function stageMenuGroups(
  current: WorkflowStage,
  viewerAuthorities?: readonly TransitionAuthority[]
): StageMenuGroup[] {
  const next = nextInProgressStage(current);
  return WORKFLOW_STAGE_GROUPS.map((group) => ({
    label: group.label,
    options: group.stages.map((stage): StageMenuOption => {
      const label = WORKFLOW_STAGE_LABELS[stage];
      if (stage === current) {
        return { stage, label, current: true, hint: null, disabledReason: null, move: "plain" };
      }
      const rule = findWorkflowTransition(current, stage);
      const move = stageMove(current, stage);
      let disabledReason: string | null = null;
      if (UNAVAILABLE_STAGES.has(stage)) disabledReason = NOT_AVAILABLE_YET;
      else if (!rule) disabledReason = NOT_AVAILABLE_YET;
      else if (!authorized(viewerAuthorities, rule.authorities)) {
        disabledReason = rule.authorities.includes("owner")
          ? "needs the Owner, a Manager or an Admin"
          : "needs a Manager or an Admin";
      }
      const hint = disabledReason
        ? disabledReason
        : move === "reason"
          ? "asks for a reason"
          : move === "decision"
            ? "records your review"
            : stage === next
              ? "next"
              : null;
      return { stage, label, current: false, hint, disabledReason, move };
    }),
  }));
}

/**
 * Stages a hand off may target: keeping the current stage or any enabled
 * move, minus every stage `workItems.handOff` refuses (the shared
 * `handoffStageRefusal`): Abandoned, keeping Delivered or Abandoned in place,
 * the review-completion edges and edges whose requirement fails closed.
 */
export function handOffStageOptions(
  current: WorkflowStage,
  viewerAuthorities?: readonly TransitionAuthority[]
): StageMenuOption[] {
  return stageMenuGroups(current, viewerAuthorities)
    .flatMap((group) => group.options)
    .filter((option) => option.current || !option.disabledReason)
    .filter((option) => handoffStageRefusal(current, option.stage) === null);
}

/** The question the inline reason step asks for a note-required move. */
export function reasonPrompt(from: WorkflowStage, to: WorkflowStage): string {
  if (to === "on_hold") return "Why is it on hold?";
  if (to === "abandoned") return "Why is it being abandoned?";
  if (from === "abandoned") return "Why is it being reopened?";
  if (from === "delivered") return "Why is it leaving Delivered?";
  return "Why is it moving?";
}

/** The primary button label for the inline reason or decision step. */
export function confirmLabel(to: WorkflowStage, move: StageMove): string {
  if (to === "on_hold") return "Put on hold";
  if (to === "abandoned") return "Abandon project";
  if (move === "decision" && to === "edits") return "Return for edits";
  return `Move to ${WORKFLOW_STAGE_LABELS[to]}`;
}
