/**
 * Frontend mirror of convex/lib/teamRoster.ts userDisplayLabel:
 * "First Last" → legacy single-field name → email → fallback.
 */
export function displayName(
  user:
    | {
        firstName?: string | null;
        lastName?: string | null;
        name?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
  fallback = "—"
): string {
  if (!user) return fallback;
  const full = [user.firstName?.trim(), user.lastName?.trim()]
    .filter(Boolean)
    .join(" ");
  return full || user.name?.trim() || user.email?.trim() || fallback;
}
