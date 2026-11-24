// Extracts client-side technical contact names from CRA Schedule 60 / T661
// Section C (lines 254, 256, and the 260/261 key individuals table) without AI.
// Pure and zero-LLM: runs during extraction (convex/ingestionSync.ts), backfill
// (convex/ingestion.ts), Brain PII scrubbing (convex/lib/importBrainCopy.ts),
// and live initials matching in ImportFilePanel / ImportInitialsSlots.
//
// The DocumentClientName shape reserves "track_changes" and "comments" sources
// so a future DOCX XML extractor can plug into the same field and matcher.

import { initialsOfName, partOfCompanyName } from "./writerNameFromText";

export type DocumentClientNameSource = "section_c" | "track_changes" | "comments";

export type DocumentClientName = {
  name: string;
  source: DocumentClientNameSource;
};

/** Maximum distinct client contacts stored per file. */
export const MAX_DOCUMENT_CLIENT_NAMES = 12;
const MAX_NAME_LENGTH = 120;
const MAX_SECTION_C_WINDOW = 16_000;
const MAX_TABLE_LINES = 80;

const HONORIFIC = /^(?:Dr|Mr|Mrs|Ms|Mx|Prof)\.?\s+/i;
const QUOTED_NICKNAME = /(?:\s+|^)["\u201C\u201D'\u2018\u2019]([\p{L}][\p{L}-]{1,24})["\u201C\u201D'\u2018\u2019](?=\s|$)/u;
const PAREN_NICKNAME = /\s+\(([\p{L}][\p{L}-]{1,24})\)(?=\s+\p{Lu})/u;
const TRAILING_PAREN = /\s*\([^)]{1,80}\)\s*$/;
const NOBILIARY = new Set(["da", "de", "del", "della", "der", "di", "du", "la", "le", "st", "st.", "van", "von"]);

const CREDENTIAL_TOKENS = new Set([
  "phd",
  "msc",
  "meng",
  "bsc",
  "beng",
  "peng",
  "mba",
  "cpa",
  "ca",
  "md",
  "eit",
  "pmp",
  "pe",
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "cto",
  "ceo",
  "coo",
  "cfo",
  "cio",
  "vp",
  "svp",
  "evp",
  "ba",
  "bs",
  "ma",
  "ms",
  "mas",
  "masc",
  "basc",
]);

const PLACEHOLDER_EXACT = new Set([
  "name",
  "names",
  "full name",
  "first name",
  "last name",
  "insert name",
  "client name",
  "employee",
  "employees",
  "employee name",
  "other employee",
  "external consultant",
  "consultant",
  "details",
  "job title",
  "title",
  "role",
  "position",
  "qualifications",
  "experience",
  "qualifications experience",
  "qualifications and experience",
  "education experience",
  "key individuals",
  "key personnel",
  "directly involved",
  "n a",
  "na",
  "none",
  "nil",
  "tbd",
  "unknown",
  "not applicable",
  "yes",
  "no",
  "section c",
  "part 2",
  "additional project information",
]);

const NON_PERSON_WORDS = new Set([
  "additional",
  "analyst",
  "applicable",
  "architect",
  "associate",
  "bachelor",
  "business",
  "canada",
  "check",
  "chief",
  "claim",
  "claimant",
  "college",
  "company",
  "computer",
  "consultant",
  "contractor",
  "corp",
  "corporation",
  "date",
  "degree",
  "department",
  "description",
  "design",
  "designer",
  "details",
  "developer",
  "development",
  "diploma",
  "directly",
  "director",
  "draft",
  "education",
  "electrical",
  "employee",
  "employees",
  "engineer",
  "engineering",
  "evidence",
  "executive",
  "experience",
  "external",
  "firm",
  "fiscal",
  "form",
  "founder",
  "general",
  "graduate",
  "group",
  "head",
  "inc",
  "incorporated",
  "indicate",
  "individual",
  "individuals",
  "information",
  "institute",
  "involved",
  "job",
  "junior",
  "key",
  "lab",
  "labs",
  "lead",
  "leader",
  "limited",
  "line",
  "list",
  "llc",
  "llp",
  "ltd",
  "management",
  "manager",
  "master",
  "mechanical",
  "months",
  "name",
  "names",
  "number",
  "officer",
  "operations",
  "other",
  "owner",
  "part",
  "partner",
  "people",
  "person",
  "personnel",
  "position",
  "prepared",
  "president",
  "principal",
  "product",
  "production",
  "program",
  "project",
  "projects",
  "qualification",
  "qualifications",
  "quality",
  "report",
  "research",
  "researcher",
  "responses",
  "role",
  "schedule",
  "science",
  "scientist",
  "section",
  "senior",
  "services",
  "software",
  "solutions",
  "specialist",
  "specify",
  "sred",
  "staff",
  "supervisor",
  "systems",
  "table",
  "team",
  "technical",
  "technician",
  "technologies",
  "technology",
  "title",
  "total",
  "university",
  "version",
  "vice",
  "work",
  "worker",
  "year",
  "years",
]);

function normalizeSpaces(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function titleCaseIfAllCaps(value: string): string {
  if (!/\p{Lu}/u.test(value) || value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/(^|[ '\u2019-])(\p{L})/gu, (_, before: string, ch: string) => before + ch.toUpperCase());
}

function stripCredentialSuffix(raw: string): string {
  const parts = raw.split(/\s+/).filter(Boolean);
  while (parts.length > 2) {
    const tail = parts[parts.length - 1]!.replace(/[.,;:]+$/g, "").replace(/\./g, "").toLowerCase();
    if (CREDENTIAL_TOKENS.has(tail)) {
      parts.pop();
    } else {
      break;
    }
  }
  return parts.join(" ");
}

function extractNickname(value: string): { nickname?: string; stripped: string } {
  const quoted = QUOTED_NICKNAME.exec(value);
  if (quoted) {
    const stripped = normalizeSpaces(value.replace(QUOTED_NICKNAME, " "));
    return { nickname: titleCaseIfAllCaps(quoted[1]!), stripped };
  }
  const paren = PAREN_NICKNAME.exec(value);
  if (paren) {
    const stripped = normalizeSpaces(value.replace(PAREN_NICKNAME, " "));
    return { nickname: titleCaseIfAllCaps(paren[1]!), stripped };
  }
  return { stripped: value };
}

function isNameWord(word: string, index: number, total: number, fromAllCaps: boolean): boolean {
  // Middle initial like "K." or "K"
  if (index > 0 && index < total - 1 && /^\p{Lu}\.?$/u.test(word)) {
    return true;
  }
  // Nobiliary particle in the middle of a name ("van", "de", "la")
  if (index > 0 && index < total - 1 && NOBILIARY.has(word.toLowerCase())) {
    return true;
  }
  // Standard capitalized name token (allows apostrophe and hyphen)
  if (!/^\p{Lu}\p{L}*(?:['\u2019-]\p{L}+)*$/u.test(word)) return false;
  const letters = word.replace(/['\u2019-]/g, "");
  if (letters.length < 2) return false;
  // Reject 2-3 letter ALL-CAPS initials unless the whole name was uppercase and has a vowel.
  if (/^\p{Lu}{2,3}$/u.test(word) && (!fromAllCaps || !/[AEIOUY]/.test(word))) {
    return false;
  }
  const lowerParts = word.toLowerCase().split("-");
  if (lowerParts.some((part) => NON_PERSON_WORDS.has(part))) return false;
  if (CREDENTIAL_TOKENS.has(word.toLowerCase())) return false;
  return true;
}

/**
 * Parses a single candidate cell or line into a clean person name, or null if
 * it looks like a form label, placeholder, company name, or qualification text.
 */
export function parseSectionCPersonName(raw: string): string | null {
  let candidate = normalizeSpaces(raw);
  if (!candidate || candidate.length > MAX_NAME_LENGTH * 2) return null;
  if (candidate.includes("@") || /https?:\/\//i.test(candidate)) return null;

  // Strip leading bullet or numbering markers (e.g. "- Samira Haddad", "1. Samira Haddad")
  candidate = candidate.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "").trim();
  // Strip optional "Name:" / "Name -" prefix inside a cell
  candidate = candidate.replace(/^name\s*[:\-\u2013\u2014]\s*/i, "").trim();

  // Separate trailing role/qualifications after comma, semicolon, colon, or spaced dash.
  // Keep "First Last" when followed by ", Ph.D." or " - CTO".
  const sepIndex = candidate.search(/\s*[,;:]\s+|\s+[-\u2013\u2014]\s+/);
  if (sepIndex > 0) {
    candidate = candidate.slice(0, sepIndex).trim();
  }
  candidate = candidate.replace(TRAILING_PAREN, "").trim();
  candidate = candidate.replace(HONORIFIC, "").trim();
  if (!candidate || /\d/.test(candidate)) return null;

  const placeholderKey = candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!placeholderKey || PLACEHOLDER_EXACT.has(placeholderKey)) return null;

  const { nickname, stripped } = extractNickname(candidate);
  const fromAllCaps = /\p{Lu}/u.test(stripped) && stripped === stripped.toUpperCase();
  const normalized = stripCredentialSuffix(titleCaseIfAllCaps(stripped));
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;

  for (let i = 0; i < words.length; i += 1) {
    if (!isNameWord(words[i]!, i, words.length, fromAllCaps)) return null;
  }

  // Re-attach quoted nickname between first and last name if present.
  const formatted = nickname
    ? `${words[0]} "${nickname}" ${words.slice(1).join(" ")}`
    : words.join(" ");
  return formatted.length <= MAX_NAME_LENGTH ? formatted : null;
}

const SECTION_C_ANCHOR = /(?:^|\n)[ \t]*(?:section\s+c\b|253\b|254\b|260\b)/i;
const LINE_254_OR_256 = /^25[46](?:\b|(?=\s))/;
const LINE_260 = /^260(?:\s*\/\s*261)?(?:\b|(?=\s))/;
const ANY_CRA_LINE_NUMBER = /^(?:2[456789]\d|3\d\d)(?:\b|(?=\s))/;
const SECTION_C_STOP = /^(?:26[5-9]|27\d|28\d|29\d|section\s+d\b|part\s+3\b|line\s+26[5-9]\b)/i;
const TABLE_HEADER_LINE =
  /^(?:26[01]\b|names?\b|qualifications?\b|education\b|experience\b|title\b|role\b|list\s+the\s+key\s+individuals\b|indicate\s+their\b)/i;
const LABEL_ONLY_LINE = /^(?:name|names|employee|other\s+employee|external\s+consultant|firm)\s*:?$/i;

function splitInlineNames(raw: string): string[] {
  // A single 254/256 cell occasionally lists two names separated by " and ", " & ", or "/".
  // Do not split on commas because commas commonly introduce credentials ("Name, P.Eng.").
  const cleaned = normalizeSpaces(raw);
  if (!cleaned) return [];
  if (/\s+(?:and|&)\s+|\s*\/\s*/i.test(cleaned)) {
    const parts = cleaned
      .split(/\s+(?:and|&)\s+|\s*\/\s*/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1 && parts.every((part) => parseSectionCPersonName(part) !== null)) {
      return parts;
    }
  }
  return [cleaned];
}

/**
 * Extracts distinct client-side technical contacts from CRA Schedule 60 / T661
 * Section C (lines 254, 256, and the 260/261 key individuals table).
 */
export function clientNamesFromSectionC(text: string): DocumentClientName[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  const anchor = SECTION_C_ANCHOR.exec(normalized);
  if (!anchor) return [];

  const windowText = normalized.slice(anchor.index, anchor.index + MAX_SECTION_C_WINDOW);
  const rawLines = windowText.split("\n");
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    lines.push(trimmed);
  }

  const found = new Map<string, DocumentClientName>();
  const addCandidate = (raw: string) => {
    if (found.size >= MAX_DOCUMENT_CLIENT_NAMES) return;
    for (const part of splitInlineNames(raw)) {
      const parsed = parseSectionCPersonName(part);
      if (!parsed) continue;
      const key = parsed.toLowerCase();
      if (!found.has(key) && found.size < MAX_DOCUMENT_CLIENT_NAMES) {
        found.set(key, { name: parsed, source: "section_c" });
      }
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (i > 0 && SECTION_C_STOP.test(line)) break;

    // 1. Line 254 or 256 (Employee directly involved / Other employee who prepared Section B)
    if (LINE_254_OR_256.test(line)) {
      const rest = line.replace(/^25[46]\s*/, "").replace(/^name\s*[:\-\u2013\u2014]?\s*/i, "").trim();
      if (rest) {
        const firstTab = rest.split("\t")[0] ?? rest;
        addCandidate(firstTab);
      } else {
        for (let look = 1; look <= 4 && i + look < lines.length; look += 1) {
          const next = lines[i + look]!;
          if (ANY_CRA_LINE_NUMBER.test(next) || SECTION_C_STOP.test(next)) break;
          if (LABEL_ONLY_LINE.test(next)) continue;
          const firstTab = (next.split("\t")[0] ?? next).replace(/^names?\s*[:\-\u2013\u2014]?\s+/i, "").trim();
          addCandidate(firstTab);
          break;
        }
      }
      continue;
    }

    // 2. Line 260 / 261 key individuals table
    if (LINE_260.test(line)) {
      let scanned = 0;
      for (let j = i + 1; j < lines.length && scanned < MAX_TABLE_LINES; j += 1) {
        const row = lines[j]!;
        if (SECTION_C_STOP.test(row)) {
          i = j;
          break;
        }
        if (ANY_CRA_LINE_NUMBER.test(row) && !/^26[01](?:\b|(?=\s))/.test(row)) {
          i = j - 1;
          break;
        }
        scanned += 1;
        if (TABLE_HEADER_LINE.test(row)) continue;
        // Tab-separated table rows ("Samira Haddad\tCTO, 12 years...") take the first column.
        const firstCol = row.includes("\t") ? (row.split("\t")[0] ?? "") : row;
        addCandidate(firstCol);
      }
    }
  }

  return [...found.values()];
}

const VALID_SOURCES = new Set<DocumentClientNameSource>(["section_c", "track_changes", "comments"]);

/** Sanitizes and deduplicates stored documentClientNames entries. */
export function cleanDocumentClientNames(entries: readonly DocumentClientName[]): DocumentClientName[] {
  const kept: DocumentClientName[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = normalizeSpaces(entry.name);
    if (!name || name.length > MAX_NAME_LENGTH || name.includes("@")) continue;
    const source: DocumentClientNameSource = VALID_SOURCES.has(entry.source) ? entry.source : "section_c";
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ name, source });
    if (kept.length >= MAX_DOCUMENT_CLIENT_NAMES) break;
  }
  return kept;
}

/**
 * All valid uppercase initial codes a contact name can stand for:
 * - Standard initialsOfName ("Samira Haddad" -> "SH", "Jean-Luc Picard" -> ["JP", "JLP"])
 * - First + last initial for 3-word names ("Samira K. Haddad" -> "SH" as well as "SKH")
 * - Nickname + last initial when quoted ("William \"Bill\" Mercer" -> "BM" as well as "WM")
 */
export function initialsOfClientName(name: string): string[] {
  const cleaned = normalizeSpaces(name).replace(HONORIFIC, "");
  const { nickname, stripped } = extractNickname(cleaned);
  const words = stripped
    .split(/\s+/)
    .map((word) => word.replace(/\.$/, ""))
    .filter(Boolean);
  if (words.length < 2) return [];

  const codes = new Set<string>();
  for (const code of initialsOfName(words.join(" "))) {
    codes.add(code);
  }
  // First + last (ignoring middle name/initial or nobiliary particles)
  const first = words[0]!;
  const last = words[words.length - 1]!;
  codes.add(`${first[0]}${last[0]}`.toUpperCase());
  // Also include non-nobiliary words (e.g. "Jan van Dijk" -> "JD" and "JVD")
  const coreWords = words.filter((word, idx) => idx === 0 || idx === words.length - 1 || !NOBILIARY.has(word.toLowerCase()));
  if (coreWords.length >= 2) {
    for (const code of initialsOfName(coreWords.join(" "))) {
      codes.add(code);
    }
  }
  if (nickname) {
    for (const code of initialsOfName(`${nickname} ${last}`)) {
      codes.add(code);
    }
  }
  return [...codes];
}

/** All contacts whose initials match `initials`, excluding parts of the company name. */
export function clientContactsForInitials(
  contacts: readonly DocumentClientName[] | undefined,
  initials: string | null | undefined,
  options: { companyName?: string | null } = {}
): DocumentClientName[] {
  if (!contacts || contacts.length === 0 || !initials) return [];
  const key = initials.trim().toUpperCase();
  if (!key) return [];
  return cleanDocumentClientNames(contacts).filter(
    (contact) =>
      initialsOfClientName(contact.name).includes(key) &&
      !partOfCompanyName(contact.name, options.companyName)
  );
}

/**
 * Unambiguous contact matching `initials`, or null when zero or multiple
 * contacts share those initials.
 */
export function matchClientInitials(
  contacts: readonly DocumentClientName[] | undefined,
  initials: string | null | undefined,
  options: { companyName?: string | null } = {}
): DocumentClientName | null {
  const matches = clientContactsForInitials(contacts, initials, options);
  return matches.length === 1 ? matches[0]! : null;
}

/** Name variants for PII redaction (exact stored form, curly-quote/paren nickname forms, nickname-free form, and nickname + surname). */
export function clientNamesForRedaction(contacts: readonly DocumentClientName[] | undefined): string[] {
  if (!contacts || contacts.length === 0) return [];
  const out = new Set<string>();
  for (const contact of cleanDocumentClientNames(contacts)) {
    out.add(contact.name);
    const { nickname, stripped } = extractNickname(contact.name);
    out.add(stripped);
    if (nickname) {
      const words = stripped.split(/\s+/).filter(Boolean);
      const first = words[0];
      const rest = words.slice(1).join(" ");
      const last = words[words.length - 1];
      if (first && rest) {
        out.add(`${first} \u201C${nickname}\u201D ${rest}`);
        out.add(`${first} (${nickname}) ${rest}`);
      }
      if (last) out.add(`${nickname} ${last}`);
    }
  }
  return [...out];
}
