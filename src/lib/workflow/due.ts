export type FormattedDue = {
  absolute: string;
  relative: string;
  overdue: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1_000;

function localDayStart(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatDue(dueAt: number | null, now: number): FormattedDue | null {
  if (dueAt === null) return null;
  const dayDifference = Math.round((localDayStart(dueAt) - localDayStart(now)) / DAY_MS);
  const relative =
    dayDifference === 0
      ? "Due today"
      : dayDifference === 1
        ? "Due tomorrow"
        : dayDifference === -1
          ? "1 day overdue"
          : dayDifference > 1
            ? `Due in ${dayDifference} days`
            : `${Math.abs(dayDifference)} days overdue`;
  return {
    absolute: new Date(dueAt).toLocaleDateString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    relative,
    overdue: dayDifference < 0,
  };
}
