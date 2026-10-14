/**
 * Edit details on a Projects page card (2026-10-14 amendment, "Edit details
 * panel"; Paper W2). The panel edits a draft of the project's details and
 * Save writes only the fields that changed, each through its existing
 * single-project mutation (2026-09-15 metadata edit scope).
 *
 * The fiscal year end follows the project page's Details panel: a yyyy-mm-dd
 * draft, stored as local midnight (`toDateInput`, `fromDateInput`).
 *
 * Pure helpers only: no `$app` imports, so unit tests can load this module.
 */
import { toDateInput } from "$lib/components/project/details/detailsFormat";

export type ProjectEditSource = {
  title: string;
  sredTitle?: string | null;
  clientName: string;
  fiscalYearEnd?: number | null;
  projectNumber?: string | null;
  industry?: string | null;
  scienceCode?: string | null;
  tagIds?: readonly string[] | null;
};

export type ProjectEditValues = {
  title: string;
  sredTitle: string;
  clientName: string;
  /** yyyy-mm-dd, or "" when not set. */
  fiscalYearEnd: string;
  projectNumber: string;
  industry: string;
  scienceCode: string;
  tagIds: string[];
};

export type ProjectEditField = keyof ProjectEditValues;

/** Save order: one mutation per changed group, in this order. */
export const PROJECT_EDIT_FIELDS: readonly ProjectEditField[] = [
  "title",
  "sredTitle",
  "clientName",
  "fiscalYearEnd",
  "projectNumber",
  "industry",
  "scienceCode",
  "tagIds",
];

export function projectEditValues(project: ProjectEditSource): ProjectEditValues {
  return {
    title: project.title ?? "",
    sredTitle: project.sredTitle ?? "",
    clientName: project.clientName ?? "",
    fiscalYearEnd: toDateInput(project.fiscalYearEnd ?? null),
    projectNumber: project.projectNumber ?? "",
    industry: project.industry ?? "",
    scienceCode: project.scienceCode ?? "",
    tagIds: [...(project.tagIds ?? [])],
  };
}

function normalized(values: ProjectEditValues, field: ProjectEditField): string {
  switch (field) {
    case "tagIds":
      return [...values.tagIds].sort().join(",");
    case "projectNumber":
      return values.projectNumber.trim().toUpperCase();
    default:
      return values[field].trim();
  }
}

/** The fields whose draft differs from the saved values, in save order. */
export function changedProjectFields(saved: ProjectEditValues, draft: ProjectEditValues): ProjectEditField[] {
  return PROJECT_EDIT_FIELDS.filter((field) => normalized(saved, field) !== normalized(draft, field));
}

/** "Edit project #5", or "Edit project" when the project has no number. */
export function editPanelTitle(projectNumber: string | null | undefined): string {
  const number = projectNumber?.trim();
  return number ? `Edit project #${number}` : "Edit project";
}
