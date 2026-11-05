/** The People tab's small pure helpers (2026-11-04, the company profile). */

export type PersonDraft = {
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string;
  isMain: boolean;
};

export const EMPTY_PERSON: PersonDraft = { firstName: "", lastName: "", role: "", email: "", phone: "", isMain: false };

/** "DW" for Dana Whitlock. */
export function personInitials(person: { firstName: string; lastName: string }): string {
  return `${person.firstName.trim()[0] ?? ""}${person.lastName.trim()[0] ?? ""}`.toUpperCase() || "?";
}

export function personName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/** "Jan 14, 2025". */
export function addedLabel(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Find a person: name, role, email or phone, ignoring case and accents. */
export function personMatches(
  person: { firstName: string; lastName: string; role: string; email: string; phone: string | null },
  search: string
): boolean {
  const needle = fold(search.trim());
  if (!needle) return true;
  return [personName(person), person.role, person.email, person.phone ?? ""].some((value) => fold(value).includes(needle));
}
