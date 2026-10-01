import { firmDateParts } from "../../../shared/firmTime";
import { formatEdited } from "$lib/components/project/details/detailsFormat";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const ACTIVE_NOW_MS = 5 * 60 * 1000;

/** "Sep 10" in the firm's time zone (shared/firmTime.ts). */
export function firmShortDate(timestamp: number): string {
  const { month, day } = firmDateParts(timestamp);
  return `${MONTHS[month - 1]} ${day}`;
}

/** "Friday, Oct 2" in the firm's time zone (J5 "Join by ..."). */
export function firmWeekdayDate(timestamp: number): string {
  const { year, month, day } = firmDateParts(timestamp);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${MONTHS[month - 1]} ${day}`;
}

/** "12 min ago", "1 hour ago", "Yesterday", "3 days ago", then "Sep 22". */
function relative(timestamp: number, now: number): string {
  if (now - timestamp >= WEEK_MS) return firmShortDate(timestamp);
  return formatEdited(timestamp, now);
}

/** Team "Last active": yourself and anyone seen in the last 5 minutes read "Now". */
export function lastActiveLabel(lastActiveAt: number | null, isSelf: boolean, now: number): string {
  if (isSelf) return "Now";
  if (lastActiveAt === null) return "Not yet";
  if (now - lastActiveAt < ACTIVE_NOW_MS) return "Now";
  return relative(lastActiveAt, now);
}

/** Pending invite status: "Sent 2 days ago", "Sent yesterday", "Sent just now". */
export function sentLabel(sentAt: number, now: number): string {
  const text = relative(sentAt, now);
  return `Sent ${text === "Just now" || text === "Yesterday" ? text.toLowerCase() : text}`;
}

/** Expired invite status: "Expired, sent Sep 10". */
export function expiredLabel(sentAt: number): string {
  return `Expired, sent ${firmShortDate(sentAt)}`;
}
