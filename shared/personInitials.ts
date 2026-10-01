/**
 * Two-letter initials for an avatar: first and last name when present, else
 * the first two words of a single name, else the email's first letter.
 */
export function personInitials(person: {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  email?: string | null;
}): string {
  const first = person.firstName?.trim();
  const last = person.lastName?.trim();
  if (first || last) {
    return ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase();
  }
  const name = person.name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return person.email?.trim()?.[0]?.toUpperCase() ?? "?";
}
