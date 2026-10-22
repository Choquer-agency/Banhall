/**
 * "Recent companies" in Rail v3 (2026-10-19 amendment, docs/design-system.md).
 *
 * The companies a person last opened on the Projects page, most recent
 * first, at most three. Kept in this browser per signed-in user, so a shared
 * browser never shows one person's companies to another. Each time the
 * Projects page has the full company list it refreshes the names and drops
 * companies that no longer exist (a merge, an old link), so a row never
 * leads to "Company not found".
 */

export const MAX_RECENT_COMPANIES = 3;

export type RecentCompany = {
  /** The Projects page's `?client=` key for this company. */
  key: string;
  name: string;
};

const storageKey = (userId: string) => `banhall.recentCompanies.v1:${userId}`;

function parse(raw: string | null): RecentCompany[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is RecentCompany =>
          Boolean(entry) && typeof entry.key === "string" && entry.key !== "" && typeof entry.name === "string" && entry.name !== ""
      )
      .slice(0, MAX_RECENT_COMPANIES);
  } catch {
    return [];
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRecentCompanies(userId: string | null | undefined): RecentCompany[] {
  if (!userId) return [];
  return parse(storage()?.getItem(storageKey(userId)) ?? null);
}

function save(userId: string, companies: readonly RecentCompany[]) {
  try {
    storage()?.setItem(storageKey(userId), JSON.stringify(companies.slice(0, MAX_RECENT_COMPANIES)));
  } catch {
    // Storage full or blocked: the rail just shows fewer companies.
  }
}

/** Puts `company` first (once) and keeps the newest three. */
export function withRecentCompany(list: readonly RecentCompany[], company: RecentCompany): RecentCompany[] {
  return [company, ...list.filter((entry) => entry.key !== company.key)].slice(0, MAX_RECENT_COMPANIES);
}

/** Current names for the keys still listed; keys no longer listed drop out. */
export function prunedRecentCompanies(list: readonly RecentCompany[], current: ReadonlyMap<string, string>): RecentCompany[] {
  return list.flatMap((entry) => {
    const name = current.get(entry.key);
    return name ? [{ key: entry.key, name }] : [];
  });
}

export function rememberRecentCompany(userId: string | null | undefined, company: RecentCompany) {
  if (!userId) return;
  save(userId, withRecentCompany(loadRecentCompanies(userId), company));
}

/** Call with the complete (not truncated) company list. */
export function pruneRecentCompanies(userId: string | null | undefined, current: ReadonlyMap<string, string>) {
  if (!userId) return;
  const list = loadRecentCompanies(userId);
  const next = prunedRecentCompanies(list, current);
  if (JSON.stringify(next) !== JSON.stringify(list)) save(userId, next);
}

/** The Projects page with `key` selected, keeping the other params of `projectsHref`. */
export function recentCompanyHref(projectsHref: string, key: string): string {
  const [path, query = ""] = projectsHref.split("?");
  const params = new URLSearchParams(query);
  params.set("client", key);
  return `${path}?${params.toString()}`;
}
