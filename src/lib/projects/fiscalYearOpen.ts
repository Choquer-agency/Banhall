// Which fiscal year sections start open on a company's Projects page (owner
// pick 2026-10-19, the "smart rule"): the two newest fiscal years are open;
// an older year, or "No fiscal year", is open only while it still has work
// in progress. A person's own toggles are kept per company for the session and
// override the rule.
import type { WorkflowStage } from "../../../shared/workflowStages";

const DONE: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>(["delivered", "abandoned"]);

export type FiscalSection = {
  key: string;
  /** null for the "No fiscal year" section. */
  fiscalYear: number | null;
  /** More pages may still add projects to this section. */
  more?: boolean;
  rows: ReadonlyArray<{ workflowStage?: WorkflowStage | null }>;
};

/**
 * Open by the rule: every section of the two newest fiscal years (a short
 * year has two sections in one fiscal year), any section with work in
 * progress, and a section that may still grow while more pages load, so a
 * section never closes under the reader when "Show more" reorders them.
 * A legacy row without a workflow stage counts as work in progress.
 */
export function openByRule(sections: readonly FiscalSection[]): Set<string> {
  const newest = [...new Set(sections.map((section) => section.fiscalYear).filter((year): year is number => year !== null))]
    .sort((a, b) => b - a)
    .slice(0, 2);
  const open = new Set<string>();
  for (const section of sections) {
    const inProgress = section.rows.some((row) => row.workflowStage == null || !DONE.has(row.workflowStage));
    const recent = section.fiscalYear !== null && newest.includes(section.fiscalYear);
    if (recent || inProgress || section.more) open.add(section.key);
  }
  return open;
}

const storageKey = (companyKey: string) => `projects:fiscal-year-open:${companyKey}`;

/** The person's toggles for this company in this session: key to open. */
export function readOverrides(companyKey: string): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(storageKey(companyKey));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean")
    );
  } catch {
    return {};
  }
}

export function writeOverrides(companyKey: string, overrides: Record<string, boolean>) {
  try {
    sessionStorage.setItem(storageKey(companyKey), JSON.stringify(overrides));
  } catch {
    // Storage full or blocked: the toggle still works for this visit.
  }
}

export function isOpen(key: string, byRule: ReadonlySet<string>, overrides: Record<string, boolean>): boolean {
  return overrides[key] ?? byRule.has(key);
}
