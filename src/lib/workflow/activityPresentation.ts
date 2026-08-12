// Presentation grammar for the read-only project activity timeline
// (append-only CRM timeline rows: timestamp, actor, labelled event,
// text diff/details, optional note). Pure mapping over the typed
// entries served by convex/projectActivity.listProjectActivity —
// canonical workflow/work-item labels only, never color-only diffs.
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { WORKFLOW_STAGE_LABELS } from "../../../shared/workflowLabels";
import {
  WORK_ITEM_FIRM_TIME_ZONE,
  WORK_ITEM_KIND_LABELS,
  type WorkItemKind,
} from "../../../shared/workItems";

type ActivityResult = Exclude<
  FunctionReturnType<typeof api.projectActivity.listProjectActivity>,
  null
>;
export type ActivityEntry = ActivityResult["entries"][number];

export type ActivityPresentation = {
  /** Labelled event, e.g. "Stage changed" or "Internal review declined". */
  label: string;
  /** Text diff / details line, e.g. "Drafting → Internal review". */
  detail: string | null;
  /** Optional human audit note or reason. */
  note: string | null;
};

function workKindLabel(workKind: WorkItemKind | null) {
  return workKind ? WORK_ITEM_KIND_LABELS[workKind] : "Work item";
}

function dueDateText(dueAt: number | null) {
  if (dueAt === null) return "Not set";
  return new Date(dueAt).toLocaleDateString("en-CA", {
    timeZone: WORK_ITEM_FIRM_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatActivityTimestamp(at: number): string {
  return new Date(at).toLocaleString("en-CA", {
    timeZone: WORK_ITEM_FIRM_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function presentActivityEntry(entry: ActivityEntry): ActivityPresentation {
  switch (entry.kind) {
    case "ownership_transferred":
      return {
        label: "Ownership transferred",
        detail: entry.fromLabel
          ? `${entry.fromLabel} → ${entry.toLabel}`
          : `To ${entry.toLabel}`,
        note: entry.note,
      };
    case "stage_changed":
      return {
        label: "Stage changed",
        detail: entry.fromStage
          ? `${WORKFLOW_STAGE_LABELS[entry.fromStage]} → ${WORKFLOW_STAGE_LABELS[entry.toStage]}`
          : `To ${WORKFLOW_STAGE_LABELS[entry.toStage]}`,
        note: entry.note,
      };
    case "work_created": {
      const parts = [`To ${entry.assigneeLabel}`];
      if (entry.blocking) parts.push("Blocking");
      if (entry.dueAt !== null) parts.push(`Due ${dueDateText(entry.dueAt)}`);
      return {
        label: `${workKindLabel(entry.workKind)} assigned`,
        detail: parts.join(" · "),
        note: null,
      };
    }
    case "work_reassigned":
      return {
        label: `${workKindLabel(entry.workKind)} reassigned`,
        detail: `${entry.fromAssigneeLabel} → ${entry.toAssigneeLabel}`,
        note: entry.note,
      };
    case "work_blocking_changed":
      return {
        label: "Blocking changed",
        detail: `${workKindLabel(entry.workKind)} · ${
          entry.toBlocking ? "Now blocking" : "No longer blocking"
        }`,
        note: null,
      };
    case "work_due_changed":
      return {
        label: "Due date changed",
        detail: `${workKindLabel(entry.workKind)} · ${dueDateText(entry.fromDueAt)} → ${dueDateText(entry.toDueAt)}`,
        note: null,
      };
    case "work_completed":
      return {
        label: `${workKindLabel(entry.workKind)} completed`,
        detail: `${entry.assigneeLabel}${
          entry.onBehalfOfAssignee ? " · Completed on their behalf" : ""
        }`,
        note: null,
      };
    case "work_declined":
      return {
        label: `${workKindLabel(entry.workKind)} declined`,
        detail: entry.assigneeLabel,
        note: entry.reason,
      };
    case "work_canceled":
      return {
        label: `${workKindLabel(entry.workKind)} canceled`,
        detail: entry.assigneeLabel,
        note: entry.reason,
      };
  }
}
