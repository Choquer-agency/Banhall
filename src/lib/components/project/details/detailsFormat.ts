import { CRA_SCIENCE_CODES } from "../../../../../shared/craScienceCodes";
import type { WorkflowStage } from "../../../../../shared/workflowStages";
import type { WorkItemKind } from "../../../../../shared/workItems";
import { WORKFLOW_STAGE_GROUPS } from "$lib/workflow/stageGroups";

/**
 * UI-only formatting for the Details panel. `scienceCodeLabel` in
 * shared/craScienceCodes.ts feeds AI retrieval and stays untouched; these
 * helpers only shape what the panel shows.
 */

/** The data's group labels read "Broad area <separator> Field"; the panel shows the field. */
const GROUP_SEPARATOR = " \u2014 ";

export function scienceFieldName(group: string): string {
  const index = group.indexOf(GROUP_SEPARATOR);
  return index >= 0 ? group.slice(index + GROUP_SEPARATOR.length).trim() : group.trim();
}

/** "Mechanical engineering" plus "2.03.01", or null when the code is unknown or unset. */
export function scienceCodeDisplay(code: string | null | undefined): { label: string; code: string } | null {
  if (!code) return null;
  const entry = CRA_SCIENCE_CODES.find((candidate) => candidate.code === code);
  return entry ? { label: entry.label, code: entry.code } : { label: code, code };
}

export type ScienceCodeGroup = {
  field: string;
  items: Array<{ code: string; label: string }>;
};

/** Every code grouped by field, in data order; `query` matches code, name or field. */
export function scienceCodeGroups(query = ""): ScienceCodeGroup[] {
  const needle = query.trim().toLowerCase();
  const groups: ScienceCodeGroup[] = [];
  for (const entry of CRA_SCIENCE_CODES) {
    const field = scienceFieldName(entry.group);
    if (
      needle &&
      !entry.code.toLowerCase().includes(needle) &&
      !entry.label.toLowerCase().includes(needle) &&
      !field.toLowerCase().includes(needle)
    ) {
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.field === field) last.items.push({ code: entry.code, label: entry.label });
    else groups.push({ field, items: [{ code: entry.code, label: entry.label }] });
  }
  return groups;
}

/** "2026 (June 30, 2026)": the fiscal year takes the year of its end date. */
export function fiscalYearParts(fiscalYearEnd: number | null | undefined): { year: string; date: string } | null {
  if (fiscalYearEnd == null) return null;
  const date = new Date(fiscalYearEnd);
  return {
    year: String(date.getFullYear()),
    date: date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  };
}

/** yyyy-mm-dd in local time, the DatePicker's value format. */
export function toDateInput(timestamp: number | null | undefined): string {
  if (timestamp == null) return "";
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight of a yyyy-mm-dd value, the timestamp updateProjectFiscalYear stores. */
export function fromDateInput(value: string): number | null {
  return value ? new Date(`${value}T00:00:00`).getTime() : null;
}

export function formatCreated(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** "Just now", "12 min ago", "3 hours ago", "Yesterday", then a short date. */
export function formatEdited(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatCreated(timestamp);
}

/** First word of a display label, for "Sam sees it under With you". */
export function firstName(label: string): string {
  return label.trim().split(/\s+/)[0] || label;
}

const IN_PROGRESS = WORKFLOW_STAGE_GROUPS[0].stages;

/** The next In progress stage after `current`; the current stage when there is none. */
export function nextInProgressStage(current: WorkflowStage): WorkflowStage {
  const index = IN_PROGRESS.indexOf(current);
  if (index < 0 || index >= IN_PROGRESS.length - 1) return current;
  return IN_PROGRESS[index + 1];
}

/** Work item type derived from the chosen hand-off stage (domain amendment 2026-09-24). */
export function workItemKindForStage(stage: WorkflowStage): WorkItemKind {
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
