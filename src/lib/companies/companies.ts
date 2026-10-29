/**
 * The Companies section (2026-10-28): its paths, a company's usual fiscal
 * year end in words, and the note an old link to a merged company shows.
 *
 * Pure helpers only: no `$app` imports, so unit tests can load this module.
 * Callers pass `resolve("/")` as the root.
 */
import { DASHBOARD_UNNAMED_COMPANY_KEY } from "../../../shared/dashboardProjection";
import { longDate } from "$lib/projects/projectCard";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Days in each month with February 29 allowed (a usual year end has no year). */
export const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * All companies (`key` null) or one company's page. The key is the company
 * key `?client=` uses, encoded as one path segment (a "/" in a name stays in
 * the key).
 */
export function companiesPath(root: string, key: string | null = null): string {
  const base = root.endsWith("/") ? root : `${root}/`;
  return key === null ? `${base}companies` : `${base}companies/${encodeURIComponent(key)}`;
}

/**
 * The company key in a Companies address: null on All companies, the
 * decoded key on a company page, undefined outside the section. The base
 * path, if any, is stripped by the caller.
 */
export function companyKeyFromPath(pathname: string): string | null | undefined {
  if (pathname === "/companies" || pathname === "/companies/") return null;
  if (!pathname.startsWith("/companies/")) return undefined;
  const segment = pathname.slice("/companies/".length).split("/")[0];
  try {
    return decodeURIComponent(segment) || null;
  } catch {
    return segment || null;
  }
}

/** Whether a company key is a company with a page (the no-company bucket is not). */
export function hasCompanyPage(key: string | null | undefined): key is string {
  return typeof key === "string" && key.trim() !== "" && key !== DASHBOARD_UNNAMED_COMPANY_KEY;
}

/** "September 30", or null when the company has no usual year end. */
export function yearEndLabel(month: number | undefined, day: number | undefined): string | null {
  if (month === undefined || day === undefined) return null;
  const name = MONTH_NAMES[month - 1];
  return name ? `${name} ${day}` : null;
}

/**
 * The note an old link to a merged company shows on the company it ended up
 * in (Paper Z9g): "X was merged into Y on <date>. Its N projects are here
 * now." A merge made before the count was kept says "Its projects".
 */
export function mergedNoteText(note: {
  fromName: string;
  intoName: string;
  mergedAt: number;
  projectCount: number | null;
}): string {
  const projects =
    note.projectCount === null
      ? "Its projects are here now."
      : note.projectCount === 0
        ? "It had no projects."
        : note.projectCount === 1
          ? "Its 1 project is here now."
          : `Its ${note.projectCount} projects are here now.`;
  return `${note.fromName} was merged into ${note.intoName} on ${longDate(note.mergedAt)}. ${projects}`;
}

/** "1 company", "128 companies", "1000+ companies". */
export function companyCountLabel(count: number, more = false): string {
  if (more) return `${count}+ companies`;
  return count === 1 ? "1 company" : `${count} companies`;
}

/** "1 project", "10 projects". */
export function projectCountText(count: number): string {
  return count === 1 ? "1 project" : `${count} projects`;
}

const NOTE_STORAGE_KEY = "banhall.mergedCompanyNotes.v1";
/** Closed notes kept per browser; the oldest drop off past this. */
const NOTE_STORAGE_LIMIT = 100;

function readClosedNotes(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(NOTE_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Whether this merge's note was closed in this browser ("Close it and it stays closed"). */
export function mergedNoteClosed(noteId: string): boolean {
  return readClosedNotes().includes(noteId);
}

export function closeMergedNote(noteId: string): void {
  const next = [...readClosedNotes().filter((id) => id !== noteId), noteId].slice(-NOTE_STORAGE_LIMIT);
  try {
    localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the note stays closed until the page is left.
  }
}
