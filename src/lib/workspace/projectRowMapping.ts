/**
 * Shared mapping from a dashboard projection row (listFlatProjects /
 * searchProjects / listCompanyProjects / listCompanyProjectsByStageRank) to
 * the presentational ProjectsTableRow shape consumed by the table, board,
 * lanes, and the focused client board.
 */
import { resolveOwnerDisplay } from "$lib/dashboard/ownerDisplay";
import type { ProjectsTableRow } from "$lib/components/workspace/ProjectsTable.svelte";
import type { WorkflowStage } from "../../../shared/workflowStages";
import { WORK_ITEM_KIND_LABELS, type WorkItemKind } from "../../../shared/workItems";
import { effectiveProjectType, type ProjectType } from "../../../shared/projectTypes";

export type DashboardProjectionRow = {
  _id: string;
  /** Convex system creation time — truthful created fallback for legacy rows. */
  _creationTime?: number;
  title: string;
  sredTitle?: string;
  /**
   * Per-company project number "1".."20" or draft letter "A".."Z"
   * (2026-08-11 amendment). Pass-through from the raw project doc.
   */
  projectNumber?: string;
  projectType?: ProjectType;
  mode?: "generate" | "review";
  fiscalYearEnd?: number;
  clientName: string;
  workflowStage?: WorkflowStage;
  status: string;
  ownerId?: string;
  ownerLabel?: string;
  writer?: string;
  generationActivity?: string | null;
  /** Optional on legacy rows; `_creationTime` fills the gap when absent. */
  createdAt?: number;
  updatedAt: number;
  /**
   * Server-projected open blocking current handoff (2026-08-10 amendment).
   * Absent when the project has no open blocking handoff.
   */
  currentHandoff?: {
    kind: string;
    assigneeLabel: string;
    blocking: boolean;
    dueAt?: number | null;
  };
};

function workItemKindLabel(kind: string): string {
  return kind in WORK_ITEM_KIND_LABELS
    ? WORK_ITEM_KIND_LABELS[kind as WorkItemKind]
    : "Work item";
}

/** Mono date-role formatting shared by every card/table date. */
export function formatProjectDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function toProjectsTableRow(project: DashboardProjectionRow): ProjectsTableRow {
  const createdAt = project.createdAt ?? project._creationTime;
  return {
    id: project._id,
    title: project.title,
    sredTitle:
      project.sredTitle?.trim() &&
      project.sredTitle.trim().localeCompare(project.title.trim(), "en-CA", { sensitivity: "base" }) !== 0
        ? project.sredTitle.trim()
        : undefined,
    projectNumber: project.projectNumber,
    projectType: effectiveProjectType(project),
    fiscalYear:
      project.fiscalYearEnd === undefined
        ? undefined
        : new Date(project.fiscalYearEnd).getUTCFullYear(),
    clientName: project.clientName,
    workflowStage: project.workflowStage,
    legacyStatus: project.status,
    owner: resolveOwnerDisplay({
      ownerId: project.ownerId,
      resolvedLabel: project.ownerLabel,
      legacyWriter: project.writer,
    }),
    generationActivity: (project.generationActivity ?? null) as ProjectsTableRow["generationActivity"],
    // Created renders on the board card (2026-08-08 amendment); rows whose
    // legacy data genuinely lacks both stamps omit the field rather than
    // inventing a date.
    createdDate: createdAt === undefined ? undefined : formatProjectDate(createdAt),
    updatedDate: formatProjectDate(project.updatedAt),
    // "With" (canonical vocabulary): the current handoff assignee, never the
    // Owner. Only projected for an open blocking handoff.
    handoff: project.currentHandoff
      ? {
          assigneeLabel: project.currentHandoff.assigneeLabel,
          kindLabel: workItemKindLabel(project.currentHandoff.kind),
          dueDate:
            project.currentHandoff.dueAt == null
              ? undefined
              : formatProjectDate(project.currentHandoff.dueAt),
        }
      : undefined,
  };
}
