/**
 * Owner 2026-10-28 (Paper row 16 B): the Chat history menu groups
 * conversations by when they were last active and shows a short time.
 */
export type HistoryGroup = "Today" | "This week" | "Earlier";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function historyGroup(at: number, now: number): HistoryGroup {
  const today = startOfDay(now);
  if (at >= today) return "Today";
  if (at >= today - 6 * DAY_MS) return "This week";
  return "Earlier";
}

/** "now", "5m", "3h", "2d", then "Oct 9". */
export function shortTimeAgo(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return new Date(at).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

/** Rows in their groups, newest first, keeping only groups that have rows. */
export function groupHistory<T>(rows: readonly T[], at: (row: T) => number, now: number): Array<{ group: HistoryGroup; rows: T[] }> {
  const order: HistoryGroup[] = ["Today", "This week", "Earlier"];
  const sorted = [...rows].sort((left, right) => at(right) - at(left));
  return order
    .map((group) => ({ group, rows: sorted.filter((row) => historyGroup(at(row), now) === group) }))
    .filter((entry) => entry.rows.length > 0);
}
