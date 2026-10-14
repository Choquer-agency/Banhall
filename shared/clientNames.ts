import { normalizeDashboardText } from "./dashboardProjection";

/**
 * Company suffix words that do not tell two clients apart (2026-10-14
 * amendment, "Create a client"). Stripped from the end of a name, repeatedly,
 * so "Acme Co. Ltd." and "Acme" look alike. Compared after
 * normalizeDashboardText, so "Ltée" arrives here as "ltee".
 */
export const CLIENT_NAME_SUFFIX_WORDS: ReadonlySet<string> = new Set([
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "ltee",
  "llc",
  "corp",
  "corporation",
  "co",
  "company",
]);

/**
 * The "loose key" of a client name: normalized text with punctuation
 * removed, trailing company suffix words stripped, and spaces collapsed.
 * Punctuation inside a word ("O'Neil", "A.B.C.") is dropped without a gap;
 * punctuation between words ("Smith-Jones", "R&D") becomes a space.
 * Returns "" when nothing but punctuation or suffix words is left.
 */
export function clientLooseKey(name: string): string {
  const words = normalizeDashboardText(name)
    .replace(/['’.]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 0 && CLIENT_NAME_SUFFIX_WORDS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * Whether two client names look alike enough to warn before creating a
 * second client (never to merge them; D7 forbids automatic merges). True
 * when the loose keys are equal, equal once spaces are removed ("Cedar
 * Line" and "Cedarline"), or one is a whole-word prefix of the other
 * ("Acme" and "Acme Manufacturing"). An empty loose key matches nothing.
 */
export function clientNamesLookAlike(a: string, b: string): boolean {
  const looseA = clientLooseKey(a);
  const looseB = clientLooseKey(b);
  if (!looseA || !looseB) return false;
  if (looseA === looseB) return true;
  if (looseA.replace(/ /g, "") === looseB.replace(/ /g, "")) return true;
  const [shorter, longer] =
    looseA.length <= looseB.length ? [looseA, looseB] : [looseB, looseA];
  return longer.startsWith(`${shorter} `);
}

/** Days in each month with February 29 allowed (a usual year end, no year). */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * A usual fiscal year end is valid when both parts are absent, or when the
 * month is a whole number 1 to 12 and the day a whole number valid for that
 * month (February 29 allowed).
 */
export function isValidClientYearEnd(
  month: number | undefined,
  day: number | undefined
): boolean {
  if (month === undefined && day === undefined) return true;
  if (month === undefined || day === undefined) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  return day <= DAYS_IN_MONTH[month - 1];
}
