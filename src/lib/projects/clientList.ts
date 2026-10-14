/**
 * Client list helpers for the Projects page (2026-10-14 amendment): the
 * `?client=<companyKey>` URL state, the "Find a client" filter, the project
 * selection cap and the merge dialog copy.
 *
 * Pure helpers only: no `$app` imports, so unit tests can load this module.
 */
import { normalizeDashboardText } from "../../../shared/dashboardProjection";

export const CLIENT_PARAM = "client";

/** Most projects one selection may hold (the bulk edit limit). */
export const PROJECT_SELECTION_LIMIT = 200;

export type ClientEntry = {
  key: string;
  clientId: string | null;
  name: string;
  projectCount: number;
};

/** The selected client's key from the URL, or null for All clients. */
export function clientKeyFromUrl(url: URL): string | null {
  const value = url.searchParams.get(CLIENT_PARAM);
  return value && value.trim() ? value : null;
}

/** Path and query for the same page with `key` selected (null: All clients). */
export function clientHref(url: URL, key: string | null): string {
  const next = new URL(url);
  if (key === null) next.searchParams.delete(CLIENT_PARAM);
  else next.searchParams.set(CLIENT_PARAM, key);
  return `${next.pathname}${next.search}`;
}

/** Query for New project with the client name filled in. */
export function newProjectSearch(clientName: string): string {
  return `?${new URLSearchParams({ client: clientName }).toString()}`;
}

/** Clients whose name contains the query, ignoring case and accents. */
export function filterClients<T extends { name: string }>(clients: readonly T[], query: string): T[] {
  const needle = normalizeDashboardText(query);
  if (!needle) return [...clients];
  return clients.filter((client) => normalizeDashboardText(client.name).includes(needle));
}

/**
 * Adds `ids` to a selection without passing `limit`. `refused` is true when
 * at least one id did not fit.
 */
export function addToSelection(
  current: readonly string[],
  ids: readonly string[],
  limit = PROJECT_SELECTION_LIMIT
): { ids: string[]; refused: boolean } {
  const next = [...current];
  const seen = new Set(current);
  let refused = false;
  for (const id of ids) {
    if (seen.has(id)) continue;
    if (next.length >= limit) {
      refused = true;
      continue;
    }
    seen.add(id);
    next.push(id);
  }
  return { ids: next, refused };
}

/** The client a merge keeps by default: the one with the most projects. */
export function defaultKeepKey(clients: readonly ClientEntry[]): string | null {
  let best: ClientEntry | null = null;
  for (const client of clients) {
    if (!best || client.projectCount > best.projectCount) best = client;
  }
  return best?.key ?? null;
}

function projects(count: number) {
  return count === 1 ? "1 project" : `${count} projects`;
}

/** The merge dialog's line under its title. */
export function mergeIntroText(projectCount: number): string {
  if (projectCount === 0) return "Pick the name to keep.";
  if (projectCount === 1) return "Pick the name to keep. The 1 project moves to it.";
  return `Pick the name to keep. All ${projectCount} projects move to it.`;
}

/** The note under the choices: where the projects go and what happens to the names. */
export function mergeSummaryText(projectCount: number, keptName: string, otherNames: number): string {
  // A name that already ends a sentence ("Acme Inc.") takes no second period.
  const name = /[.!?]$/.test(keptName) ? keptName : `${keptName}.`;
  const move =
    projectCount === 0
      ? `No projects move. The client is kept as ${name}`
      : projectCount === 1
        ? `1 project will show under ${name} Its fiscal year stays as it is.`
        : `${projects(projectCount)} will show under ${name} Their fiscal years stay as they are.`;
  const names =
    otherNames === 1
      ? "The other name is removed from the client list."
      : "The other names are removed from the client list.";
  return `${move} ${names}`;
}

export type NumberCollision = {
  fiscalYear: number | null;
  projectNumber: string;
  titles: string[];
};

/** "Project number 1 appears twice in FY 2025: A, B. Change one after the merge." */
export function mergeCollisionText(collision: NumberCollision): string {
  const times = collision.titles.length === 2 ? "twice" : `${collision.titles.length} times`;
  const where =
    collision.fiscalYear === null
      ? "among projects with no fiscal year"
      : `in FY ${collision.fiscalYear}`;
  return `Project number ${collision.projectNumber.toUpperCase()} appears ${times} ${where}: ${collision.titles.join(", ")}. Change one after the merge.`;
}
