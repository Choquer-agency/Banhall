/**
 * The Activity tab's pure helpers (2026-11-04, the company profile; Paper
 * "Activity / By day, with people and links"): rows grouped by day, newest
 * first, with a day's title ("Today", a weekday this past week, else the
 * date) and the times on the right. Files one person added (or archived,
 * restored...) one after another on the same day read as one row, "added 3
 * files", naming the first and "+2".
 */

export type ActivityActor = { userId: string; label: string; initials: string } | null;
export type ActivityProject = { id: string; title: string };
export type FileAction = "added" | "replaced" | "archived" | "restored" | "removed";
export type ActivityEntry =
  | { id: string; kind: "file"; at: number; actor: ActivityActor; action: FileAction; fileId: string; fileName: string }
  | { id: string; kind: "website"; at: number; actor: ActivityActor; host: string; outcome: "read" | "failed"; reason: string | null }
  | { id: string; kind: "project_started"; at: number; actor: ActivityActor; project: ActivityProject; fiscalYear: number | null }
  | {
      id: string;
      kind: "stage_moved";
      at: number;
      actor: ActivityActor;
      project: ActivityProject;
      fromStage: string | null;
      toStage: string;
    }
  | { id: string; kind: "draft_started"; at: number; actor: ActivityActor; project: ActivityProject };

/** One shown row: an entry, or several file entries read as one. */
export type ActivityRow =
  | { id: string; kind: "files"; at: number; actor: ActivityActor; action: FileAction; files: { fileId: string; fileName: string }[] }
  | Exclude<ActivityEntry, { kind: "file" }>;

export type ActivityDay = { key: string; title: string; subtitle: string; rows: ActivityRow[] };

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "Today" / "Nov 4"; "Saturday" / "Nov 1" this past week; else "Oct 27" / "Monday". */
export function dayTitle(at: number, now: number): { title: string; subtitle: string } {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const shortDate = date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const daysAgo = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (daysAgo <= 0) return { title: "Today", subtitle: shortDate };
  if (daysAgo === 1) return { title: "Yesterday", subtitle: shortDate };
  if (daysAgo < 7) return { title: weekday, subtitle: shortDate };
  return { title: shortDate, subtitle: weekday };
}

/** "9:14 AM". */
export function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** The day groups, newest first, in the order the entries came (newest first). */
export function groupActivity(entries: readonly ActivityEntry[], now: number): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.at);
    let day = days.at(-1);
    if (!day || day.key !== key) {
      day = { key, ...dayTitle(entry.at, now), rows: [] };
      days.push(day);
    }
    const last = day.rows.at(-1);
    if (entry.kind === "file") {
      if (last && last.kind === "files" && last.action === entry.action && last.actor?.userId === entry.actor?.userId) {
        last.files.push({ fileId: entry.fileId, fileName: entry.fileName });
      } else {
        day.rows.push({
          id: entry.id,
          kind: "files",
          at: entry.at,
          actor: entry.actor,
          action: entry.action,
          files: [{ fileId: entry.fileId, fileName: entry.fileName }],
        });
      }
    } else {
      day.rows.push(entry);
    }
  }
  return days;
}

const FILE_VERBS: Record<FileAction, string> = {
  added: "added",
  replaced: "replaced",
  archived: "archived",
  restored: "restored",
  // The Files tab calls Remove "Delete" (2026-11-04).
  removed: "deleted",
};

/** "added a file", "archived 3 files". */
export function fileVerb(action: FileAction, count: number): string {
  return `${FILE_VERBS[action]} ${count === 1 ? "a file" : `${count} files`}`;
}

/** The kinds the "All changes" menu offers, in its order. */
export const ACTIVITY_KINDS = [
  { value: "files", label: "Files" },
  { value: "projects", label: "Projects started" },
  { value: "stages", label: "Stage moves" },
  { value: "drafts", label: "Drafts started" },
  { value: "website", label: "Website reads" },
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]["value"];

/** A two-letter tone for an avatar, the same for one person everywhere. */
export function avatarToneIndex(seed: string, tones: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return hash % tones;
}
