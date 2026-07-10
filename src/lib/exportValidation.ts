import {
  parseCanonicalReport,
  type CanonicalReportBody,
  type ReportSectionKey,
} from "$lib/reportSections";
import {
  LINE_LIMITS,
  WORD_CAPS,
  sectionMetrics,
} from "../../convex/lib/lineLimits";
import { isCraScienceCode } from "../../shared/craScienceCodes";

export type ExportValidationSeverity = "error" | "warning";

export interface ExportValidationIssue {
  severity: ExportValidationSeverity;
  field: string;
  label: string;
  message: string;
  actual?: number;
  limit?: number;
}

export interface ExportPreflightInput {
  reportId: string;
  reportVersion: number;
  revisionNumber: number;
  contentHash: string;
  content: string;
  templateVersion: string;
  supportingDocumentCount: number;
  project: {
    title: string;
    clientName: string;
    fiscalYearEnd?: number;
    scienceCode?: string;
  };
}

export interface CanonicalExportReport {
  supportingDocumentCount: number;
  reportId: string;
  reportVersion: number;
  revisionNumber: number;
  contentHash: string;
  templateVersion: string;
  title: string;
  clientName: string;
  fiscalYearEnd?: number;
  scienceCode?: string;
  body: CanonicalReportBody;
}

export interface ExportValidationResult {
  errors: ExportValidationIssue[];
  warnings: ExportValidationIssue[];
}
export interface ExportRevisionIdentity {
  reportId: string;
  revisionNumber: number;
  contentHash: string;
}

export function isSameExportRevision(
  preflight: ExportRevisionIdentity,
  authorized: ExportRevisionIdentity
): boolean {
  return (
    preflight.reportId === authorized.reportId &&
    preflight.revisionNumber === authorized.revisionNumber &&
    preflight.contentHash === authorized.contentHash
  );
}


const TITLE_CHARACTER_LIMIT = 60;
const LABELS: Record<ReportSectionKey, string> = {
  s242: "Line 242 — uncertainties",
  s244: "Line 244 — work performed",
  s246: "Line 246 — advancements",
};

export function canonicalizeExportPreflight(
  input: ExportPreflightInput
): Readonly<CanonicalExportReport> {
  const body = parseCanonicalReport(input.content);
  for (const section of Object.values(body.sections)) {
    for (const block of section.blocks) Object.freeze(block);
    Object.freeze(section.blocks);
    Object.freeze(section);
  }
  Object.freeze(body.sections);
  for (const diagnostic of body.diagnostics) Object.freeze(diagnostic);
  Object.freeze(body.diagnostics);
  Object.freeze(body);
  return Object.freeze({
    reportId: input.reportId,
    reportVersion: input.reportVersion,
    revisionNumber: input.revisionNumber,
    contentHash: input.contentHash,
    templateVersion: input.templateVersion,
    supportingDocumentCount: input.supportingDocumentCount,
    title: input.project.title.trim(),
    clientName: input.project.clientName.trim(),
    fiscalYearEnd: input.project.fiscalYearEnd,
    scienceCode: input.project.scienceCode?.trim() || undefined,
    body,
  });
}

export function validateExport(
  report: Readonly<CanonicalExportReport>
): ExportValidationResult {
  const errors: ExportValidationIssue[] = report.body.diagnostics.map(
    (diagnostic) => ({
      severity: "error",
      field: diagnostic.section ?? "content",
      label: diagnostic.section ? LABELS[diagnostic.section] : "Report body",
      message: diagnostic.message,
    })
  );
  const warnings: ExportValidationIssue[] = [];

  if (!report.title) {
    errors.push({
      severity: "error",
      field: "title",
      label: "Project title",
      message: "The Schedule 60 project title is required.",
    });
  } else if (report.title.length > TITLE_CHARACTER_LIMIT) {
    errors.push({
      severity: "error",
      field: "title",
      label: "Project title",
      message: `Project title is ${report.title.length} characters; the Schedule 60 title box allows ${TITLE_CHARACTER_LIMIT}.`,
      actual: report.title.length,
      limit: TITLE_CHARACTER_LIMIT,
    });
  }
  if (!report.clientName) {
    errors.push({
      severity: "error",
      field: "clientName",
      label: "Name of claimant",
      message: "The claimant name is required.",
    });
  }
  if (!report.fiscalYearEnd) {
    errors.push({
      severity: "error",
      field: "fiscalYearEnd",
      label: "Taxation year ending",
      message: "The taxation year end is required for the official export.",
    });
  }
  if (!report.scienceCode) {
    errors.push({
      severity: "error",
      field: "scienceCode",
      label: "Field of science or technology",
      message: "The CRA line 206 field-of-science code is required.",
    });
  } else if (!isCraScienceCode(report.scienceCode)) {
    errors.push({
      severity: "error",
      field: "scienceCode",
      label: "Field of science or technology",
      message: `"${report.scienceCode}" is not a recognized CRA line 206 field-of-science code.`,
    });
  }

  if (report.supportingDocumentCount === 0) {
    warnings.push({
      severity: "warning",
      field: "supportingDocuments",
      label: "Supporting documents",
      message:
        "No supporting documents are attached to this project. Proceed only if the report can be substantiated without additional source files.",
    });
  }

  for (const key of ["s242", "s244", "s246"] as const) {
    const metrics = sectionMetrics(report.body.sections[key].plainText, key);
    if (metrics.lines > LINE_LIMITS[key]) {
      errors.push({
        severity: "error",
        field: key,
        label: LABELS[key],
        message: `${LABELS[key]} uses ${metrics.lines} form lines; the limit is ${LINE_LIMITS[key]}.`,
        actual: metrics.lines,
        limit: LINE_LIMITS[key],
      });
    }
    if (metrics.words > WORD_CAPS[key]) {
      errors.push({
        severity: "error",
        field: key,
        label: LABELS[key],
        message: `${LABELS[key]} is ${metrics.words} words; the CRA maximum is ${WORD_CAPS[key]}.`,
        actual: metrics.words,
        limit: WORD_CAPS[key],
      });
    }
    if (
      metrics.lines >= Math.floor(LINE_LIMITS[key] * 0.95) &&
      metrics.lines <= LINE_LIMITS[key]
    ) {
      warnings.push({
        severity: "warning",
        field: key,
        label: LABELS[key],
        message: `${LABELS[key]} is within 5% of the template line limit; inspect the generated DOCX for wrapping.`,
        actual: metrics.lines,
        limit: LINE_LIMITS[key],
      });
    }
  }

  return { errors, warnings };
}
