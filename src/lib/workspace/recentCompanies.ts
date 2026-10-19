/**
 * "Recent companies" in Rail v3 (2026-10-19 amendment, docs/design-system.md).
 *
 * No new data: the companies come from the browser's recent projects
 * (`recentProjects.ts`), which already record the company a clicked card or
 * row showed. Most recent first, one row per company, at most three. A
 * project recorded without a company adds nothing.
 *
 * Pure helpers only: no `$app` imports, so unit tests can load this module.
 */
import { dashboardCompanyKey } from "../../../shared/dashboardProjection";
import type { RecentProject } from "./recentProjects";

export const MAX_RECENT_COMPANIES = 3;

export type RecentCompany = {
  /** The Projects page's `?client=` key for this company. */
  key: string;
  name: string;
};

export function recentCompanies(
  projects: readonly RecentProject[],
  limit = MAX_RECENT_COMPANIES
): RecentCompany[] {
  const seen = new Set<string>();
  const companies: RecentCompany[] = [];
  for (const project of projects) {
    const name = project.client?.trim();
    if (!name) continue;
    const key = dashboardCompanyKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    companies.push({ key, name });
    if (companies.length >= limit) break;
  }
  return companies;
}

/** The Projects page with `key` selected, keeping the other params of `projectsHref`. */
export function recentCompanyHref(projectsHref: string, key: string): string {
  const [path, query = ""] = projectsHref.split("?");
  const params = new URLSearchParams(query);
  params.set("client", key);
  return `${path}?${params.toString()}`;
}
