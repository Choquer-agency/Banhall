/**
 * Pure helpers for the Home screen (ui-design-final.md section 9): the rows
 * the "With you" and "Recently opened" tables show, the client mark, and
 * which project the "Continue working" card offers to resume.
 */
import type { WorkflowStage } from "../../../shared/workflowStages";
import { formatEdited, fiscalYearParts } from "$lib/components/project/details/detailsFormat";

export type HomeRow = {
  projectId: string;
  title: string;
  clientName: string;
  stage: WorkflowStage;
  /** Project edit time; null when the source row does not carry it. */
  editedAt: number | null;
  /** Present (true) only while the project is being deleted. */
  deleting?: boolean;
};

type AssignedItem = {
  projectId: string;
  projectTitle: string;
  clientName: string;
  workflowStage: WorkflowStage;
  projectUpdatedAt?: number;
};

/**
 * One row per project for "With you". The server orders open work items due
 * first; a viewer can hold several items on one project, so the first one
 * wins and later items for the same project are dropped.
 */
export function withYouRows(items: readonly AssignedItem[]): HomeRow[] {
  const seen = new Set<string>();
  const rows: HomeRow[] = [];
  for (const item of items) {
    if (seen.has(item.projectId)) continue;
    seen.add(item.projectId);
    rows.push({
      projectId: item.projectId,
      title: item.projectTitle,
      clientName: item.clientName,
      stage: item.workflowStage,
      editedAt: item.projectUpdatedAt ?? null,
    });
  }
  return rows;
}

type LiveProject = {
  projectId: string;
  projectTitle: string;
  clientName: string;
  workflowStage: WorkflowStage;
  updatedAt: number;
};

export function liveProjectRows(rows: readonly LiveProject[]): HomeRow[] {
  return rows.map((row) => ({
    projectId: row.projectId,
    title: row.projectTitle,
    clientName: row.clientName,
    stage: row.workflowStage,
    editedAt: row.updatedAt,
  }));
}

export type ContinueTarget = {
  projectId: string;
  /** "opened": the viewer opened it on this device; "with_you": latest edited work with the viewer. */
  source: "opened" | "with_you";
  at: number | null;
};

/**
 * The project "Continue working" offers: the last project this viewer opened
 * on this device that still exists, otherwise the most recently edited
 * project with them. Null when there is neither.
 */
export function continueTarget(
  opened: readonly { projectId: string; openedAt: number | null }[],
  withYou: readonly HomeRow[]
): ContinueTarget | null {
  const last = opened[0];
  if (last) return { projectId: last.projectId, source: "opened", at: last.openedAt };
  let best: HomeRow | null = null;
  for (const row of withYou) {
    if (!best || (row.editedAt ?? 0) > (best.editedAt ?? 0)) best = row;
  }
  return best ? { projectId: best.projectId, source: "with_you", at: best.editedAt } : null;
}

/** "Opened 12 min ago", "Edited yesterday", "Opened on Sep 16, 2026". */
export function activityPhrase(verb: "Opened" | "Edited", at: number, now: number): string {
  const when = formatEdited(at, now);
  if (when === "Just now" || when === "Yesterday") return `${verb} ${when.toLowerCase()}`;
  if (/ago$/.test(when)) return `${verb} ${when}`;
  return `${verb} on ${when}`;
}

/** "Cedarline Systems, FY 2026, #01A": the parts that exist, joined by commas. */
export function continueMetaLine(project: {
  clientName: string;
  fiscalYearEnd: number | null;
  projectNumber: string | null;
}): string {
  const fiscal = fiscalYearParts(project.fiscalYearEnd);
  return [
    project.clientName.trim(),
    fiscal ? `FY ${fiscal.year}` : "",
    project.projectNumber?.trim() ? `#${project.projectNumber.trim()}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function proposalsLine(count: number, truncated: boolean): string | null {
  if (count <= 0) return null;
  const shown = truncated ? `${count}+` : String(count);
  return `${shown} proposal${count === 1 && !truncated ? "" : "s"} waiting to apply`;
}

export function clientInitial(clientName: string): string {
  const match = /[\p{L}\p{N}]/u.exec(clientName);
  return match ? match[0].toUpperCase() : "?";
}

const CLIENT_TONES = [
  "bg-gap-bg text-gap-text",
  "bg-primary-wash text-primary-selected",
  "bg-purple-50 text-purple-700",
  "bg-blue-50 text-blue-700",
] as const;

/** A stable tone per client name, so one client keeps one colour everywhere on Home. */
export function clientTone(clientName: string): (typeof CLIENT_TONES)[number] {
  const key = clientName.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return CLIENT_TONES[hash % CLIENT_TONES.length];
}
