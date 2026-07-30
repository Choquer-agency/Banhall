import type { WorkItemKind } from "../../../shared/workItems";
import {
  WORK_ITEM_BLOCKING_DEFAULTS,
  WORK_ITEM_DEFAULT_INSTRUCTIONS,
  WORK_ITEM_DUE_DEFAULT_BUSINESS_DAYS,
} from "../../../shared/workItems";
import { addCivilDays, civilDateString, firmDateParts } from "../../../shared/firmTime";

export function addFirmBusinessDays(timestamp: number, days = WORK_ITEM_DUE_DEFAULT_BUSINESS_DAYS) {
  let cursor = firmDateParts(timestamp);
  let remaining = days;
  while (remaining > 0) {
    cursor = addCivilDays(cursor, 1);
    const weekday = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return civilDateString(cursor);
}

export function firmDateInputToTimestamp(input: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return undefined;
  const [year, month, day] = input.split("-").map(Number);
  // Noon UTC safely maps to the intended Vancouver civil date throughout DST.
  return Date.UTC(year, month - 1, day, 12);
}

export function assignmentDefaults(kind: WorkItemKind, now = Date.now()) {
  return {
    kind,
    blocking: WORK_ITEM_BLOCKING_DEFAULTS[kind],
    instructions: WORK_ITEM_DEFAULT_INSTRUCTIONS[kind],
    dueDate: kind === "internal_review" ? addFirmBusinessDays(now) : "",
  };
}
