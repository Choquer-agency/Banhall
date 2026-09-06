/** Local calendar arithmetic preserves the selected day across DST changes. */
export function calendarDaysAgo(days: number, now = new Date()): Date {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date;
}
