export type FormattedDue = {
  absolute: string;
  relative: string;
  overdue: boolean;
};

import { WORK_ITEM_FIRM_TIME_ZONE } from "../../../shared/workItems";
import { firmDayNumber } from "../../../shared/firmTime";

export function formatDue(dueAt: number | null, now: number): FormattedDue | null {
  if (dueAt === null) return null;
  const dayDifference = firmDayNumber(dueAt) - firmDayNumber(now);
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
      timeZone: WORK_ITEM_FIRM_TIME_ZONE,
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    relative,
    overdue: dayDifference < 0,
  };
}
