/**
 * Restrained Home welcome copy (2026-08-08 amendment): a time-of-day
 * greeting, nothing invented. Pure so the boundaries are unit-testable.
 */
export function greetingForHour(hour: number): "Good morning" | "Good afternoon" | "Good evening" {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** First name for the greeting; empty string when unknown (no placeholder). */
export function greetingName(user: { firstName?: string | null; name?: string | null } | null | undefined): string {
  const first = user?.firstName?.trim();
  if (first) return first;
  const full = user?.name?.trim();
  if (full) return full.split(/\s+/)[0] ?? "";
  return "";
}
