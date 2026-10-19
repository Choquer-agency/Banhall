// Which fiscal year sections start open on a company's Projects page (owner
// pick 2026-10-19, the "smart rule"): the two newest years are open; an
// older year, or "No fiscal year", is open only while it still has work in
// progress. A person's own toggles are kept per company for the session and
// override the rule.
import type { WorkflowStage } from "../../../shared/workflowStages";

const DONE: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>(["delivered", "abandoned"]);

export type FiscalSection = {
  key: string;
  rows: ReadonlyArray<{ workflowStage?: WorkflowStage | null }>;
};

/** Open by the rule: the first two sections (newest first), or any with work in progress. */
export function openByRule(sections: readonly FiscalSection[]): Set<string> {
  const open = new Set<string>();
  sections.forEach((section, index) => {
    const inProgress = section.rows.some((row) => row.workflowStage != null && !DONE.has(row.workflowStage));
    if (index < 2 || inProgress) open.add(section.key);
  });
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
