import type { WorkflowStage } from "./workflowStages";

export const DASHBOARD_COMPANY_PAGE_SIZE = 20;
export const DASHBOARD_PROJECT_PAGE_SIZE = 60;
export const DASHBOARD_FACET_LIMIT = 1_000;
export const DASHBOARD_UNNAMED_COMPANY_KEY = "\uffff";
export const DASHBOARD_NO_FISCAL_YEAR_RANK = 1_000_000;

export type DashboardGenerationActivity =
  | "generating"
  | "awaiting_selection"
  | "awaiting_input";

export type DashboardProjectSource = {
  title: string;
  clientName: string;
  writer?: string;
  interviewer?: string;
  scienceCode?: string;
  industry?: string;
  fiscalYearEnd?: number;
};

export type DashboardProjectFilters = {
  search?: string;
  stage?: WorkflowStage | "legacy";
  ownerId?: string;
  industry?: string;
  scienceCode?: string;
  tagIds?: string[];
};

export function normalizeDashboardText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("en-CA");
}

export function dashboardCompanyKey(clientName: string) {
  return normalizeDashboardText(clientName) || DASHBOARD_UNNAMED_COMPANY_KEY;
}

export function dashboardFiscalYear(fiscalYearEnd?: number) {
  return fiscalYearEnd === undefined
    ? null
    : new Date(fiscalYearEnd).getUTCFullYear();
}

export function dashboardFiscalYearRank(fiscalYearEnd?: number) {
  const year = dashboardFiscalYear(fiscalYearEnd);
  return year === null ? DASHBOARD_NO_FISCAL_YEAR_RANK : -year;
}

export function dashboardSearchText(source: DashboardProjectSource) {
  return normalizeDashboardText(
    [
      source.title,
      source.clientName,
      source.writer,
      source.interviewer,
      source.scienceCode,
      source.industry,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

export function dashboardProjectionFields(source: DashboardProjectSource) {
  return {
    dashboardCompanyKey: dashboardCompanyKey(source.clientName),
    dashboardFiscalYearRank: dashboardFiscalYearRank(source.fiscalYearEnd),
    dashboardSearchText: dashboardSearchText(source),
  };
}
