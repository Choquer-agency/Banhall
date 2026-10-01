import type { WorkflowStage } from "./workflowStages";
import { findWorkflowTransition } from "./workflowTransitions";

export const WORK_ITEM_KINDS = [
  "internal_review",
  "revision",
  "interview_followup",
  "delivery_prep",
  "financial",
  "other",
] as const;

export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

export const WORK_ITEM_STATUSES = [
  "open",
  "completed",
  "declined",
  "canceled",
] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_EVENT_TYPES = [
  "created",
  "reassigned",
  "blocking_changed",
  "due_changed",
  "completed",
  "declined",
  "canceled",
] as const;

export type WorkItemEventType = (typeof WORK_ITEM_EVENT_TYPES)[number];

export const WORK_ITEM_KIND_LABELS: Record<WorkItemKind, string> = {
  internal_review: "Internal review",
  revision: "Revision",
  interview_followup: "Interview follow-up",
  delivery_prep: "Delivery preparation",
  financial: "Financial",
  other: "Other",
};

export const WORK_ITEM_BLOCKING_DEFAULTS: Record<WorkItemKind, boolean> = {
  internal_review: true,
  revision: false,
  interview_followup: false,
  delivery_prep: false,
  financial: false,
  other: false,
};

export const WORK_ITEM_DEFAULT_INSTRUCTIONS: Record<WorkItemKind, string> = {
  internal_review: "Review the current draft and leave actionable feedback.",
  revision: "Complete the requested revisions and summarize the changes.",
  interview_followup: "Follow up on the outstanding interview questions.",
  delivery_prep: "Prepare the current report for delivery.",
  financial: "Complete the requested financial follow-up.",
  other: "Complete the requested next action.",
};

export const WORK_ITEM_DUE_DEFAULT_BUSINESS_DAYS = 2;
export const WORK_ITEM_FIRM_TIME_ZONE = "America/Vancouver";
export const MAX_WORK_ITEM_DUE_AT = 8_640_000_000_000_000;
export const WORK_ITEM_NO_DUE_SORT_AT = 8_640_000_000_000_001;
export const MY_WORK_PAGE_SIZE = 25;
export const MY_WORK_MAX_PAGE_SIZE = 50;
export const MY_WORK_DUE_SOON_DAYS = 7;

export function workItemDueSortAt(dueAt?: number) {
  return dueAt ?? WORK_ITEM_NO_DUE_SORT_AT;
}
export const MAX_WORK_ITEM_INSTRUCTIONS_PREVIEW_CHARS = 240;
export const MAX_WORK_ITEM_INSTRUCTIONS_CHARS = 4_000;
export const MAX_WORK_ITEM_RESOLUTION_CHARS = 2_000;
export const MAX_WORK_ITEM_CREATE_REQUEST_ID_CHARS = 200;

/**
 * The work-item kind a Details-panel handoff gets from its chosen stage
 * (docs/product-domain.md, 2026-09-24 amendment). Shared so the Hand off
 * view and `workItems.handOff` can never disagree.
 */
export function workItemKindForHandoffStage(stage: WorkflowStage): WorkItemKind {
  switch (stage) {
    case "internal_review":
      return "internal_review";
    case "edits":
    case "revisions":
      return "revision";
    case "intake":
    case "interview_complete":
      return "interview_followup";
    case "ready_for_delivery":
    case "delivered":
      return "delivery_prep";
    default:
      return "other";
  }
}

/**
 * Why `workItems.handOff` refuses a handoff from `from` into `to`, or null
 * when the stage itself is acceptable (authority, notes and the version fence
 * are checked separately). Shared by the mutation and the Hand off view's
 * stage list, so the view never offers a stage the server always refuses.
 *
 * - "reopen_first": keeping Delivered or Abandoned in place; reopen first.
 * - "abandons": a handoff opens work, and Abandoned needs no open work.
 * - "review_decision": an internal-review completion edge, which records the
 *   reviewer decision through Change stage.
 * - "requirement": an edge whose requirement fails closed today (delivery
 *   outcome, promoted branch).
 */
export type HandoffStageRefusal = "reopen_first" | "abandons" | "review_decision" | "requirement";

export function handoffStageRefusal(
  from: WorkflowStage,
  to: WorkflowStage
): HandoffStageRefusal | null {
  if (from === to) {
    return from === "delivered" || from === "abandoned" ? "reopen_first" : null;
  }
  if (to === "abandoned") return "abandons";
  const requirements = findWorkflowTransition(from, to)?.requirements ?? [];
  if (requirements.includes("review_decision")) return "review_decision";
  if (requirements.includes("delivery_outcome") || requirements.includes("promoted_branch")) {
    return "requirement";
  }
  return null;
}
