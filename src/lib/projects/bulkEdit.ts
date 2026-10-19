/**
 * Bulk edit on the Projects page (2026-10-14 amendment, "Select and bulk
 * edit"; Paper W3 and W4). Every field starts at "No change"; the panel
 * shows what the selection holds now, and the review step lists each
 * project's current and new values before `projects.bulkUpdateProjects`
 * writes anything. Consultants (writers) change only the projects they own;
 * the server skips the rest and the review says so up front.
 *
 * Dates follow the Projects page: a fiscal year end is a UTC calendar day
 * (`dashboardFiscalYear`, `formatYearEnd`), and "Set date" stores UTC
 * midnight, as the bulk edit always has.
 *
 * Pure helpers only: no `$app` imports, so unit tests can load this module.
 */
import { dashboardFiscalYear } from "../../../shared/dashboardProjection";
import { industryLabel } from "$lib/industries";
import { scienceCodeDisplay } from "$lib/components/project/details/detailsFormat";
import { formatYearEnd } from "./fiscalYearGroups";

export type BulkEditRow = {
  _id: string;
  title: string;
  projectNumber?: string;
  clientName: string;
  fiscalYearEnd?: number;
  industry?: string;
  scienceCode?: string;
  ownerId?: string;
};

export type BulkEditViewer = { _id: string; role?: string | null } | null;

/**
 * The fields a bulk edit changes. A missing key means "No change"; `null`
 * clears the field.
 */
export type BulkChange = {
  clientName?: string;
  fiscalYearEnd?: number | null;
  industry?: string | null;
  scienceCode?: string | null;
};

export type BulkField = "clientName" | "fiscalYearEnd" | "industry" | "scienceCode";

export const BULK_FIELDS: readonly BulkField[] = ["clientName", "fiscalYearEnd", "industry", "scienceCode"];

export const BULK_FIELD_LABELS: Record<BulkField, string> = {
  clientName: "Client",
  fiscalYearEnd: "Fiscal year end",
  industry: "Industry",
  scienceCode: "Science code",
};

/** UTC midnight of a yyyy-mm-dd value, the timestamp "Set date" stores. */
export function utcDateFromInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** "FY 2026 ended Sep 30, 2026", as the fiscal year headers read. */
export function fiscalYearEndSummaryLabel(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  return `FY ${dashboardFiscalYear(timestamp)} ended ${formatYearEnd(timestamp)}`;
}

/** "FY 2026, Sep 30, 2026", the review table's shorter form. */
export function fiscalYearEndCellLabel(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  return `FY ${dashboardFiscalYear(timestamp)}, ${formatYearEnd(timestamp)}`;
}

/** "2.03.01 Mechanical engineering", or the raw code when it is unknown. */
export function scienceCodeLabel(code: string | null | undefined): string | null {
  const display = scienceCodeDisplay(code ?? null);
  if (!display) return null;
  return display.label === display.code ? display.code : `${display.code} ${display.label}`;
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The value one row holds for a field, as the panel shows it (null when not set). */
export function rowValueLabel(row: BulkEditRow, field: BulkField, form: "summary" | "cell" = "cell"): string | null {
  switch (field) {
    case "clientName":
      return blank(row.clientName);
    case "fiscalYearEnd":
      return form === "summary" ? fiscalYearEndSummaryLabel(row.fiscalYearEnd) : fiscalYearEndCellLabel(row.fiscalYearEnd);
    case "industry":
      return blank(row.industry) ? industryLabel(row.industry!.trim()) : null;
    case "scienceCode":
      return scienceCodeLabel(blank(row.scienceCode));
  }
}

/** Most values a "Now:" line names before "+N more". */
const SUMMARY_LIMIT = 4;

/**
 * The "Now:" line under a field: one value when every project shares it,
 * "not set" when none has one, otherwise each value with its count, most
 * common first ("FY 2026 ended Sep 30, 2026 (2), not set (1)").
 */
export function summarizeValues(values: ReadonlyArray<string | null>): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    const label = value ?? "not set";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 0) return "not set";
  if (counts.size === 1) return [...counts.keys()][0];
  // Stable: ties keep the order the values first appeared in.
  const parts = [...counts.entries()]
    .map(([label, count], index) => ({ label, count, index }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ label, count }) => `${label} (${count})`);
  const shown = parts.slice(0, SUMMARY_LIMIT).join(", ");
  return parts.length > SUMMARY_LIMIT ? `${shown}, +${parts.length - SUMMARY_LIMIT} more` : shown;
}

/**
 * What a bulk edit field shows before anything is picked (owner, 2026-10-19,
 * in place of "No change"): the value every selected project shares, "Not
 * set" when none has one, or "Varies" when they differ. Fiscal year ends
 * read as the date alone ("September 30, 2026"), as the field shows them.
 */
export function sharedValueLabel(rows: readonly BulkEditRow[], field: BulkField): string {
  const values = new Set(
    rows.map((row) =>
      field === "fiscalYearEnd"
        ? (row.fiscalYearEnd === undefined || row.fiscalYearEnd === null ? null : formatYearEnd(row.fiscalYearEnd))
        : rowValueLabel(row, field)
    )
  );
  if (values.size !== 1) return values.size === 0 ? "Not set" : "Varies";
  return [...values][0] ?? "Not set";
}

export function currentSummary(rows: readonly BulkEditRow[], field: BulkField): string {
  return summarizeValues(rows.map((row) => rowValueLabel(row, field, "summary")));
}

export function changedFields(change: BulkChange): BulkField[] {
  return BULK_FIELDS.filter((field) => change[field] !== undefined);
}

/** "1 field changed", "2 fields changed", or "No changes yet". */
export function changedFieldsLabel(count: number): string {
  if (count === 0) return "No changes yet";
  return `${count} ${count === 1 ? "field" : "fields"} changed`;
}

export function projectsLabel(count: number): string {
  return `${count} ${count === 1 ? "project" : "projects"}`;
}

/** The new value as the review shows it (null when the change clears the field). */
function changeValueLabel(change: BulkChange, field: BulkField, form: "sentence" | "cell"): string | null {
  switch (field) {
    case "clientName":
      return blank(change.clientName);
    case "fiscalYearEnd":
      if (change.fiscalYearEnd == null) return null;
      return form === "sentence" ? formatYearEnd(change.fiscalYearEnd) : fiscalYearEndCellLabel(change.fiscalYearEnd);
    case "industry":
      return blank(change.industry) ? industryLabel(change.industry!.trim()) : null;
    case "scienceCode":
      return scienceCodeLabel(blank(change.scienceCode));
  }
}

/** One sentence per changed field: "Fiscal year end set to Sep 30, 2026." */
export function changeSentences(change: BulkChange): string[] {
  return changedFields(change).map((field) => {
    const value = changeValueLabel(change, field, "sentence");
    return value === null ? `${BULK_FIELD_LABELS[field]} cleared.` : `${BULK_FIELD_LABELS[field]} set to ${value}.`;
  });
}

/** Whether a row already holds the value the change would write. */
export function fieldMatches(row: BulkEditRow, change: BulkChange, field: BulkField): boolean {
  switch (field) {
    case "clientName":
      return blank(row.clientName) === blank(change.clientName);
    case "fiscalYearEnd": {
      const now = row.fiscalYearEnd;
      const next = change.fiscalYearEnd;
      if (now == null || next == null) return now == null && next == null;
      return utcDayKey(now) === utcDayKey(next);
    }
    case "industry":
      return blank(row.industry) === blank(change.industry);
    case "scienceCode":
      return blank(row.scienceCode) === blank(change.scienceCode);
  }
}

/**
 * A Consultant changes only projects they own (`projects.ownerId`); the
 * server skips the others. Managers and Admins change every project.
 */
export function skippedForViewer(viewer: BulkEditViewer, row: BulkEditRow): boolean {
  if (!viewer || viewer.role !== "writer") return false;
  return row.ownerId !== viewer._id;
}

export type ReviewCell = { field: BulkField; now: string; after: string | null };

export type ReviewRow = {
  id: string;
  projectNumber: string | null;
  title: string;
  /** "change": something will be written; "match": it already holds every value; "skipped": not the viewer's to change. */
  status: "change" | "match" | "skipped";
  cells: ReviewCell[];
};

/**
 * One review row per project, with only the changed fields. `after` is null
 * where the project already holds that value ("No change").
 */
export function reviewRows(rows: readonly BulkEditRow[], change: BulkChange, viewer: BulkEditViewer): ReviewRow[] {
  const fields = changedFields(change);
  return rows.map((row) => {
    const cells = fields.map((field) => ({
      field,
      now: rowValueLabel(row, field) ?? "Not set",
      after: fieldMatches(row, change, field) ? null : (changeValueLabel(change, field, "cell") ?? "Not set"),
    }));
    const status = skippedForViewer(viewer, row)
      ? "skipped"
      : cells.every((cell) => cell.after === null)
        ? "match"
        : "change";
    return { id: row._id, projectNumber: blank(row.projectNumber), title: row.title, status, cells };
  });
}

/** "1 project will change, 2 already match." */
export function reviewCountSentence(rows: readonly ReviewRow[]): string {
  const changing = rows.filter((row) => row.status === "change").length;
  const matching = rows.filter((row) => row.status === "match").length;
  const parts = [`${projectsLabel(changing)} will change`];
  if (matching > 0) parts.push(`${matching} already ${matching === 1 ? "matches" : "match"}`);
  return `${parts.join(", ")}.`;
}

/** The writer's note: how many selected projects are not theirs, or null. */
export function skipNote(rows: readonly ReviewRow[]): string | null {
  const skipped = rows.filter((row) => row.status === "skipped").length;
  if (skipped === 0) return null;
  const these = skipped === 1 ? "1 of these is not yours and will be skipped." : `${skipped} of these are not yours and will be skipped.`;
  return `You can only change projects you own. ${these}`;
}

/** The arguments for one `projects.bulkUpdateProjects` call. */
export function bulkMutationArgs(projectIds: readonly string[], change: BulkChange) {
  return {
    projectIds: [...projectIds],
    ...(change.clientName !== undefined ? { clientName: change.clientName.trim() } : {}),
    ...(change.fiscalYearEnd !== undefined ? { fiscalYearEnd: change.fiscalYearEnd } : {}),
    ...(change.industry !== undefined ? { industry: change.industry } : {}),
    ...(change.scienceCode !== undefined ? { scienceCode: change.scienceCode } : {}),
  };
}

/** "Updated 2 projects." plus ", skipped 1 you don't own." for a writer. */
export function bulkResultMessage(result: { updated: number; skipped: number }, viewer: BulkEditViewer): string {
  const updated = `Updated ${projectsLabel(result.updated)}`;
  if (result.skipped <= 0) return `${updated}.`;
  const reason = viewer?.role === "writer" ? "you don't own" : "that could not be changed";
  return `${updated}, skipped ${result.skipped} ${reason}.`;
}
