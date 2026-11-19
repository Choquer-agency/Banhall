/**
 * The Brain copy of an imported final PD (2026-11-17, docs/product-domain.md,
 * "A final PD approved on Import also gets a scrubbed Brain copy").
 *
 * The Brain is shared by every company, so the copy must not name the client.
 * An import has no project record, so the names come from what the import
 * and the company know: the company's names (`companyIdentityNames`), the
 * import's client folder, the client part of the file name, the company's
 * website domain, the people named on the company's projects, the people the
 * PD names after a writer cue ("Prepared by ..."), people the PD names next
 * to a title, a role or a cue ("Dr. Anjali Verma, CTO"), and any words the
 * person approving asked to remove (product names are not detected).
 *
 * Two separate steps:
 *  - `scrubImportText` hides all of that with `[redacted]` (a Business
 *    Number or an address with `[redacted number]` and `[redacted address]`),
 *    the way report nominations are scrubbed (`deidentify`), plus the forms
 *    a company name takes in a PD: every distinctive word of it, joined or
 *    CamelCase, its initials, the domain. Matching ignores accents and maps
 *    back to the text as written.
 *  - `findIdentityLeak` then looks for the company again with its own forms
 *    and its own matcher: it folds the text into lower-case word parts and
 *    compares them word by word, so a mistake in the scrub is not repeated
 *    there. Any hit refuses the copy with a plain reason.
 *
 * Pure (no Convex calls): `buildImportBrainCopy` takes what a query read.
 */

import type { Doc, Id } from "../_generated/dataModel";
import { deidentifyNames, isOrdinaryCompanyWord, NAME_EDGE_BEFORE, surfacePattern } from "./deidentify";
import { parsePdFilename } from "../../shared/pdFilename";
import { cleanDocumentWriterNames, writerNamesFromText } from "../../shared/writerNameFromText";
import { normalizeCraScienceCode } from "../../shared/craScienceCodes";

/** The tier a past writer's PDs get when an Admin has set none (design part D, decision 2). */
export const IMPORT_BRAIN_DEFAULT_WRITER_TIER = 0.4;

/** What a hidden name becomes, as in report nominations. */
export const IMPORT_BRAIN_REDACTION = "[redacted]";
export const IMPORT_BRAIN_NUMBER_REDACTION = "[redacted number]";
export const IMPORT_BRAIN_ADDRESS_REDACTION = "[redacted address]";

/** The refusals, in the words the Approve screen shows. */
export const IMPORT_BRAIN_REFUSALS = {
  not_final_pd: "Only a final PD gets a Brain copy.",
  no_company: "Pick a company for this file first.",
  no_text: "This file has no text to copy into the Brain.",
  no_industry: "Pick an industry for this company.",
  names_unreadable: "Could not read every name this company has, so no Brain copy was made.",
  also_remove_no_word:
    "Each entry in Also remove needs a letter or a number. Take out the ones that are only spaces or punctuation.",
} as const;

export type ImportBrainCopyRefusalCode = keyof typeof IMPORT_BRAIN_REFUSALS | "names_left";

/** What one import file gives its Brain copy (`importSource` arguments, approved by the caller). */
export type ImportBrainCopyFields = {
  kind: "pd_pair";
  docType: "pd";
  title: string;
  content: string;
  industry: string;
  writerName?: string;
  writerTier: number;
  scienceCode?: string;
  fiscalYear?: number;
  importItemId: Id<"ingestionItems">;
  importContentHash: string;
};

/**
 * `warnings`: words a person should look at before approving (never a
 * refusal). `notCovered`: what the check does not find, for the Approve
 * screen. `logReason`: the refusal without the company's word, for the
 * audit log (never write `reason` to brainAuditLog: it quotes the name).
 */
export type ImportBrainCopyResult =
  | { ok: true; fields: ImportBrainCopyFields; warnings: string[]; notCovered: string }
  | { ok: false; code: ImportBrainCopyRefusalCode; reason: string; logReason: string; notCovered: string };

/** The leak refusal for the audit log, without the word that leaked. */
export const IMPORT_BRAIN_LEAK_LOG_REASON = "The Brain copy would still name the company, so it was not made.";
/** The person leak refusal for the audit log, without the name (2026-11-19). */
export const IMPORT_BRAIN_PERSON_LEAK_LOG_REASON = "The Brain copy would still name a person, so it was not made.";

/** What a query reads for one import file (see `importBrainCopyFor` in convex/ingestion.ts). */
export type ImportBrainCopyInput = {
  item: Pick<
    Doc<"ingestionItems">,
    | "_id"
    | "name"
    | "clientName"
    | "companyKey"
    | "category"
    | "contentHash"
    | "fiscalYear"
    | "fiscalYearEnd"
    | "scienceCode"
    | "writerName"
    | "documentWriterNames"
  >;
  /** The company's row, or null for a company the app does not have yet. */
  company: Pick<Doc<"clients">, "name" | "industry" | "website"> | null;
  /** `companyIdentityNames` of the company ([] for a new one). */
  identity: { organizations: readonly string[]; people: readonly string[] };
  /** The industry a person picked on the sheet for a new company (`importNewCompanies`). */
  newCompanyIndustry?: string;
  /** The file's writer (`pdWriters`), if it has one. */
  writer: Pick<Doc<"pdWriters">, "name" | "tier"> | null;
  /** Words or names the person approving asked to remove too (product names, nicknames). */
  alsoRemove?: readonly string[];
};

// ─── Words ──────────────────────────────────────────────────────────────────

const LEGAL_SUFFIX_WORDS = new Set([
  "inc", "incorporated", "ltd", "limited", "llc", "corp", "corporation", "co", "company", "plc",
  "gmbh", "ulc", "lp", "llp", "ltee", "lte", "cie", "sa", "sarl", "senc",
]);

/** Articles, joining words and leading words such as "Groupe" in "Les Industries Quillmere". */
const ARTICLE_WORDS = new Set(["the", "le", "la", "les", "l", "de", "des", "du", "d", "et", "and", "of", "for", "a", "an", "en"]);

/**
 * Words a company name is made of that never stand for one company alone:
 * descriptors, sectors and their French forms. Folded (no accents), lower case.
 */
const GENERIC_NAME_WORDS = new Set([
  "group", "groupe", "societe", "entreprises", "enterprises", "entreprise", "enterprise", "compagnie",
  "labs", "lab", "laboratories", "laboratory", "laboratoires", "laboratoire",
  "technologies", "technology", "technologie", "tech", "solutions", "solution", "systems", "system",
  "systemes", "systeme", "services", "service", "industries", "industry", "industrie", "international",
  "holdings", "holding", "consulting", "consultants", "conseil", "conseils", "partners", "partenaires",
  "associates", "associes", "canada", "canadian", "canadienne", "quebec", "ontario", "global", "america",
  "americas", "north", "analytics", "insights", "terminals", "terminal", "transport", "transports",
  "transportation", "logistics", "logistique", "nurseries", "nursery", "pepinieres", "brewing", "brewery",
  "brasserie", "farms", "farm", "fermes", "ferme", "foods", "food", "aliments", "equity", "capital",
  "ventures", "studio", "studios", "works", "devices", "dynamics", "innovations", "innovation", "sciences",
  "science", "therapeutics", "pharmaceuticals", "pharma", "health", "sante", "biotech", "biosciences",
  "environmental", "environnement", "construction", "resources", "ressources", "development",
  "developpement", "distribution", "supply", "trading", "aerospace", "aerospatiale", "aviation",
  "motors", "mechanical", "mecanique", "fabrication", "packaging", "emballage", "printing", "media",
  "medias", "interactive", "games", "jeux", "communications", "telecom", "agriculture", "agricole",
  "greenhouses", "orchards", "vineyards", "winery", "distillery", "bakery", "boulangerie",
  "manufacturing", "manufacturier", "engineering", "ingenierie", "software", "logiciels", "energy",
  "energie", "robotics", "robotique", "automation", "automatisation", "research", "recherche",
  "products", "produits", "materials", "materiaux", "electric", "electrique", "electronics",
  "electronique", "machines", "machinerie", "tools", "outils", "design", "digital", "numerique",
  "network", "networks", "reseaux", "data", "donnees", "cloud", "medical", "medicale", "marine",
  "water", "eau", "power", "controls", "instruments", "precision", "advanced", "applied", "national",
]);

/**
 * Acronyms common in SR&ED prose and in company names that must never be
 * read as one company's initials ("Verdant AI Inc." never hides "AI").
 * Upper case, letters only.
 */
const COMMON_ACRONYMS = new Set([
  "AI", "ML", "IT", "IOT", "QA", "QC", "PD", "RD", "CRA", "SRED", "API", "UI", "UX", "CAD", "CAM", "CNC",
  "ERP", "CRM", "HR", "PLC", "PCB", "GPS", "LED", "LCD", "AR", "VR", "XR", "IP", "OS", "DB", "SQL",
  "AWS", "SAAS", "CEO", "CTO", "CFO", "COO", "CIO", "VP", "US", "USA", "UK", "EU", "CA", "ON", "BC",
  "AB", "MB", "SK", "NS", "NB", "PE", "NL", "YT", "NT", "NU", "PEI", "GTA", "NA", "HVAC", "RF", "UV",
  "IR", "PH", "DC", "AC", "EV", "ID", "NDA", "IOS", "PDF", "CSV", "SDK", "MVP", "KPI", "ROI", "QMS",
  "ISO", "CSA", "UL", "FDA", "GMP", "SOP", "LLC", "INC", "LTD", "CO", "PI", "PHD", "VA", "KW", "KV",
  "MW", "HZ", "GHZ", "MHZ", "RPM", "PSI", "CPU", "GPU", "RAM", "USB", "LTE", "AD", "PM", "AM", "FY",
  "TM", "SA", "NRC", "IRAP", "NSERC", "OEM", "ODM", "BOM", "FEA", "CFD", "SCADA", "MES", "NLP", "LLM",
]);

/** Accents off ("Société" is "Societe"), for comparing. */
function fold(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "");
}

/** A folded, lower-case word that never stands for a company alone. */
export function isOrdinaryNameWord(word: string): boolean {
  const lower = fold(word).toLowerCase();
  return (
    LEGAL_SUFFIX_WORDS.has(lower) ||
    ARTICLE_WORDS.has(lower) ||
    GENERIC_NAME_WORDS.has(lower) ||
    isOrdinaryCompanyWord(lower)
  );
}

function isCommonAcronym(word: string): boolean {
  return COMMON_ACRONYMS.has(fold(word).toUpperCase().replace(/[^A-Z]/g, ""));
}

/** "J.R.T." is "JRT": dotted initials become one word before splitting. */
function joinDottedInitials(value: string): string {
  return value.replace(/(?<![\p{L}\p{N}])(?:\p{L}\.){2,}/gu, (run) => run.replace(/\./g, ""));
}

/** The words of a name, dotted initials joined, trailing legal suffixes off. */
function nameWords(name: string): string[] {
  const words = joinDottedInitials(name.normalize("NFC").trim()).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIX_WORDS.has(fold(words[words.length - 1]).toLowerCase())) words.pop();
  return words;
}

/**
 * The parts of one word at its inner capitals and digits: "VerdantGridOS"
 * is Verdant, Grid, OS; "JRTNurseries" is JRT, Nurseries; "Acme2" is Acme, 2.
 */
export function camelParts(word: string): { text: string; start: number }[] {
  const parts: { text: string; start: number }[] = [];
  for (const match of word.matchAll(/\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\p{N}+|\p{L}+/gu)) {
    parts.push({ text: match[0], start: match.index ?? 0 });
  }
  return parts;
}

/** The host of a website address without "www." ("acmefarms.ca"), or null. */
export function websiteHost(website: string | undefined): string | null {
  if (!website?.trim()) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(website) ? website : `https://${website}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** The name part of a host: "acmefarms" of "acmefarms.ca", "acme-farms" of "shop.acme-farms.co.uk". */
export function domainStem(host: string): string | null {
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  labels.pop();
  const generic = new Set(["co", "com", "org", "net", "ac", "gov", "gc", "edu"]);
  if (labels.length > 1 && generic.has(labels[labels.length - 1])) labels.pop();
  const stem = labels[labels.length - 1];
  return stem && stem.length >= 3 ? stem : null;
}

// ─── The scrub's forms ──────────────────────────────────────────────────────

/**
 * The forms of a company's names the scrub hides. Folded and lower case
 * except `initialisms`, which are matched as written.
 *  - `phrases`: word sequences: the name without its legal suffix, without
 *    a leading article, without trailing descriptors, and the first two
 *    words of a long name.
 *  - `joined`: the same words with nothing between ("acmefarms"), as in
 *    CamelCase, a domain or a hashtag.
 *  - `words`: one word that stands for the company alone: every word of a
 *    name that is not ordinary (four letters or more: "quillmere" in "The
 *    Quillmere Group", "Advanced Quillmere Technologies" or "Les Industries
 *    Quillmere"), three letters capitalized ("Zyx"), a one-word name, a
 *    word with inner capitals, a number of five digits or more ("2525483
 *    Ontario"), a domain stem.
 *  - `initialisms`: an all-capitals word of the name ("JRT") and the
 *    initials of a name of two words or more ("QM", "FM" of "Fenwick &
 *    Marlow"), two letters or more, never a common acronym ("AI", "QA",
 *    "PD"); when they are one and the name has a third word with its legal
 *    suffix, those three initials ("VAI" of "Verdant AI Inc.").
 */
export type CompanyNameVariants = {
  phrases: string[][];
  joined: string[];
  words: string[];
  initialisms: string[];
};

/**
 * A word of a multi-word name that stands for the company alone: four
 * letters or more and not ordinary, three letters capitalized and not
 * ordinary ("Zyx" of "Zyx Robotics", never "Ion" written "ion"), or a
 * number of five digits or more ("1234567 Ontario"; never "123" or "360").
 */
function distinctiveNameWord(word: string): boolean {
  const plain = fold(word);
  if (/^\p{N}+$/u.test(plain)) return plain.length >= 5;
  if (isOrdinaryNameWord(plain) || isCommonAcronym(plain)) return false;
  if (plain.length >= 4) return true;
  // "Zyx", never "JRT" (an all-capitals word is an initialism, matched as written).
  return plain.length === 3 && /^\p{Lu}\p{Ll}{2}$/u.test(plain);
}

/** The initials of a name's words other than articles, two to six letters, or null. */
function initialsOf(words: readonly string[]): string | null {
  const significant = words.filter((word) => !ARTICLE_WORDS.has(fold(word).toLowerCase()));
  if (significant.length < 2) return null;
  const letters = significant.map((word) => fold(word)[0]?.toUpperCase() ?? "").join("");
  return /^\p{Lu}{2,6}$/u.test(letters) ? letters : null;
}

export function companyNameVariants(
  names: readonly string[],
  domainStems: readonly string[] = []
): CompanyNameVariants {
  const phrases = new Map<string, string[]>();
  const joined = new Set<string>();
  const words = new Set<string>();
  const initialisms = new Set<string>();
  const addPhrase = (parts: string[]) => {
    if (parts.length < 2) return;
    phrases.set(parts.join(" "), parts);
    joined.add(parts.join(""));
  };

  for (const raw of names) {
    const original = nameWords(raw);
    if (original.length === 0) continue;
    const lower = original.map((word) => fold(word).toLowerCase());

    if (lower.length === 1) {
      if (lower[0].length >= 3 && !isCommonAcronym(original[0])) words.add(lower[0]);
    } else {
      addPhrase(lower);
      let from = 0;
      while (from < lower.length - 1 && ARTICLE_WORDS.has(lower[from])) from += 1;
      const core = lower.slice(from);
      addPhrase(core);
      // "Verdant Grid Technologies" is also "Verdant Grid"; two words stay two.
      let brand = core.length;
      while (brand > 2 && (GENERIC_NAME_WORDS.has(core[brand - 1]) || ARTICLE_WORDS.has(core[brand - 1]))) brand -= 1;
      addPhrase(core.slice(0, brand));
      if (core.length >= 3) addPhrase(core.slice(0, 2));
      if (core.length === 1 && core[0].length >= 3 && !isOrdinaryNameWord(core[0])) words.add(core[0]);
      for (const [k, word] of lower.entries()) {
        if (distinctiveNameWord(original[k])) words.add(word);
      }
      const letters = initialsOf(original);
      if (letters && !isCommonAcronym(letters)) initialisms.add(letters);
      // "Verdant AI Inc.": "VA" is a common acronym, so its three words' "VAI" counts instead.
      const withSuffix = initialsOf(joinDottedInitials(raw.normalize("NFC")).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
      if ((!letters || isCommonAcronym(letters)) && withSuffix && withSuffix.length >= 3 && !isCommonAcronym(withSuffix)) {
        initialisms.add(withSuffix);
      }
    }
    for (const word of original) {
      const folded = fold(word);
      if (/^\p{Lu}{2,6}$/u.test(folded)) {
        if (!isCommonAcronym(folded)) initialisms.add(folded);
      } else if (/\p{Ll}\p{Lu}/u.test(folded) && folded.length >= 3 && !isCommonAcronym(folded)) {
        words.add(folded.toLowerCase());
      }
    }
  }
  for (const stem of domainStems) {
    const parts = fold(stem).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (parts.length === 1 && parts[0].length >= 3) words.add(parts[0]);
    else addPhrase(parts);
  }
  return {
    phrases: [...phrases.values()],
    joined: [...joined].filter((value) => value.length >= 3),
    words: [...words],
    initialisms: [...initialisms],
  };
}

// ─── Matching that ignores accents ──────────────────────────────────────────

/**
 * Characters the scrub reads past (2026-11-17, review round 2): invisible
 * ones (soft hyphen, zero-width spaces and joiners, U+2060, U+FEFF and the
 * rest of Default_Ignorable_Code_Point) and the trademark signs, so
 * "Quill\u00ADmere" and "Quillmere\u2122" match "Quillmere".
 */
const SCRUB_SKIPPED = /^[\p{Default_Ignorable_Code_Point}\u2122\u2120\u00AE]$/u;
/** Characters a reader never sees, left out of a Brain copy's text. */
const INVISIBLE_CHARACTERS = /\p{Default_Ignorable_Code_Point}/gu;

/** Every character the scrub reads past, for finding names in the text as a reader sees it. */
const SCRUB_SKIPPED_ALL = /[\p{Default_Ignorable_Code_Point}\u2122\u2120\u00AE]/gu;

/** The text without the characters the scrub reads past ("Anja\u200Bli" reads "Anjali"). */
function visibleText(text: string): string {
  return text.replace(SCRUB_SKIPPED_ALL, "");
}
/** A word broken at a line end ("Quill-\nmere"): the hyphen and the break are read past. */
const SCRUB_LINE_WRAP = /^-[ \t]*\r?\n[ \t]*(?=\p{Ll})/u;

/**
 * The text folded (no accents, NFKD), with skipped characters and line-end
 * wraps left out, and, for each folded code unit, the span of the original
 * text it came from, so a match on the folded text replaces exactly the
 * characters as written ("V\u00E9rdane" for "verdane").
 */
function foldWithMap(text: string): { folded: string; from: number[]; to: number[] } {
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let index = 0;
  let afterLetter = false;
  while (index < text.length) {
    const char = String.fromCodePoint(text.codePointAt(index)!);
    if (char === "-" && afterLetter) {
      const wrap = SCRUB_LINE_WRAP.exec(text.slice(index, index + 40));
      if (wrap) {
        index += wrap[0].length;
        continue;
      }
    }
    if (SCRUB_SKIPPED.test(char)) {
      index += char.length;
      continue;
    }
    const plain = fold(char);
    for (let k = 0; k < plain.length; k++) {
      from.push(index);
      to.push(index + char.length);
    }
    folded += plain;
    afterLetter = /\p{L}/u.test(char);
    index += char.length;
  }
  return { folded, from, to };
}

/** Replaces each match of `pattern` on the folded text, in the original text. */
function replaceFolded(text: string, pattern: RegExp, replacement: string): string {
  const { folded, from, to } = foldWithMap(text);
  let out = "";
  let at = 0;
  pattern.lastIndex = 0;
  for (const match of folded.matchAll(pattern)) {
    if (match[0].length === 0) continue;
    const start = from[match.index ?? 0];
    const end = to[(match.index ?? 0) + match[0].length - 1];
    if (start < at) continue;
    out += text.slice(at, start) + replacement;
    at = end;
  }
  return out + text.slice(at);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const WORD_AFTER = "(?![\\p{L}\\p{N}])";
/**
 * The gap between two words of a name: any amount of white space (a name
 * wrapped across lines or columns, "Dr\n        Li") plus up to six other
 * characters that are not letters or digits ("Acme-Farms", "Acme & Farms").
 * At least one character.
 */
const PHRASE_GAP = "(?=[^\\p{L}\\p{N}])\\s*(?:[^\\p{L}\\p{N}\\s]\\s*){0,6}";

/** One regular expression for many alternatives, longest first, never inside a longer word. */
function wordsRegex(alternatives: string[], flags: string): RegExp | null {
  const unique = [...new Set(alternatives.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return null;
  return new RegExp(`${NAME_EDGE_BEFORE}(?:${unique.join("|")})${WORD_AFTER}`, flags);
}

// ─── Numbers and addresses ──────────────────────────────────────────────────

/** A Business Number's program account after it ("RC0001", "RT 0001", "-RC-0001"). */
const PROGRAM_ACCOUNT = "(?:[ \\t-]?(?:RC|RP|RT|RR|RZ|RM)[ \\t-]?\\d{4})";
/** The words that name a Business Number or a Quebec enterprise number (NEQ). */
const BUSINESS_NUMBER_LABEL =
  "(?:BN|B\\.N\\.|Business[ \\t]+(?:Number|No\\.?)|Num[e\\u00E9]ro[ \\t]+d['\\u2019]entreprise(?:[ \\t]+du[ \\t]+Qu[e\\u00E9]bec)?|NEQ|Quebec[ \\t]+Enterprise[ \\t]+Number)";
/**
 * A number after its label: "BN 123 456 789", "Business Number: 123-456-789",
 * "Num\u00E9ro d'entreprise 123 456 789", "NEQ 1171234567". The label stays.
 */
const LABELLED_BUSINESS_NUMBER = new RegExp(
  `(?<![\\p{L}\\p{N}])(${BUSINESS_NUMBER_LABEL}[ \\t]*[:#]?[ \\t]*)(?:\\d{10}|\\d{3}[ \\t-]?\\d{3}[ \\t-]?\\d{3}${PROGRAM_ACCOUNT}?)(?![\\p{L}\\p{N}])`,
  "giu"
);
/**
 * A Business Number with no label: nine digits written together, with or
 * without its program account ("123456789", "123456789-RC-0001"), or nine
 * spaced digits with one ("123 456 789 RT 0001"). Never inside a longer
 * number or a decimal.
 */
const BUSINESS_NUMBER = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(?:\\d{9}${PROGRAM_ACCOUNT}?|\\d{3}[ \\t]\\d{3}[ \\t]\\d{3}${PROGRAM_ACCOUNT})(?![\\p{L}\\p{N}]|[.,]\\d)`,
  "giu"
);
/** A Canadian postal code ("K1A 0B1"). */
const POSTAL_CODE = /(?<![\p{L}\p{N}])[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ \t-]?\d[ABCEGHJ-NPRSTV-Z]\d(?![\p{L}\p{N}])/giu;
/** A street number and the word after it ("12 Main", "1200-B Rue"). */
const STREET_START = /(?<![\p{L}\p{N}])\d{1,6}[A-Za-z]?(?:-\d{1,6}[A-Za-z]?)?[ \t]+\p{L}/gu;
const STREET_LINE = /^\s*\d{1,6}[A-Za-z]?(?:-\d{1,6}[A-Za-z]?)?[ \t]+\p{L}/u;
/** An address line: short enough to be one. */
const ADDRESS_LINE_MAX = 120;

function hasPostalCode(line: string): boolean {
  POSTAL_CODE.lastIndex = 0;
  return POSTAL_CODE.test(line);
}

/**
 * Business Numbers and Quebec enterprise numbers become `[redacted number]`.
 * A postal code becomes
 * `[redacted address]` with the address around it: its whole line when the
 * line is short (and the line before, when it is a short line that starts
 * with a street number), else from the street number before it on the same
 * line.
 */
export function scrubNumbersAndAddresses(text: string): string {
  const lines = text
    .replace(LABELLED_BUSINESS_NUMBER, `$1${IMPORT_BRAIN_NUMBER_REDACTION}`)
    .replace(BUSINESS_NUMBER, IMPORT_BRAIN_NUMBER_REDACTION)
    .split("\n");
  const indentOf = (line: string) => /^\s*/.exec(line)?.[0] ?? "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!hasPostalCode(line)) continue;
    if (line.trim().length <= ADDRESS_LINE_MAX) {
      lines[i] = `${indentOf(line)}${IMPORT_BRAIN_ADDRESS_REDACTION}`;
      const previous = i > 0 ? lines[i - 1] : undefined;
      if (previous !== undefined && previous.trim().length <= ADDRESS_LINE_MAX && STREET_LINE.test(previous)) {
        lines[i - 1] = `${indentOf(previous)}${IMPORT_BRAIN_ADDRESS_REDACTION}`;
      }
      continue;
    }
    let out = "";
    let at = 0;
    POSTAL_CODE.lastIndex = 0;
    for (const code of line.matchAll(POSTAL_CODE)) {
      const codeAt = code.index ?? 0;
      const windowStart = Math.max(at, codeAt - ADDRESS_LINE_MAX);
      let start = codeAt;
      for (const street of line.slice(windowStart, codeAt).matchAll(STREET_START)) start = windowStart + (street.index ?? 0);
      out += line.slice(at, start) + IMPORT_BRAIN_ADDRESS_REDACTION;
      at = codeAt + code[0].length;
    }
    lines[i] = out + line.slice(at);
  }
  return lines.join("\n");
}

// ─── People named next to a title, a role or a cue ──────────────────────────

const NAME_WORD = "\\p{Lu}\\p{L}*(?:['’-]\\p{L}+)*";
/** Two capitalized words, with a middle initial allowed: "Anjali Verma", "Raj K. Patel". */
const PERSON = `${NAME_WORD}(?:[ \\t]+\\p{Lu}\\.)?[ \\t]+${NAME_WORD}`;
const HONORIFIC = "(?:Dr|Mr|Mrs|Ms|Mx|Prof)\\.?";
/** Roles, matched capitalized or not ("Director", "lead engineer"); acronyms as written. */
const ROLE_NAMES = [
  "CEO", "CTO", "COO", "CFO", "CIO", "CSO", "VP", "SVP", "EVP", "vice president", "president", "founder",
  "co-founder", "cofounder", "owner", "director", "manager", "engineer", "scientist", "technician",
  "supervisor", "lead", "head", "chief", "principal", "partner", "chair", "chairman", "chairwoman",
  "foreman", "developer", "analyst", "researcher", "investigator", "coordinator", "specialist",
  "programmer", "designer", "architect", "consultant", "officer", "superintendent", "operator",
];
function roleAlternative(role: string): string {
  if (/^[A-Z]+$/.test(role)) return role;
  return role
    .split(" ")
    .map((word) => `[${word[0].toUpperCase()}${word[0]}]${word.slice(1)}`)
    .join("[ \\t]+");
}
const ROLE = `(?:${ROLE_NAMES.map(roleAlternative).join("|")})`;
/** One role or a few ("Lead Engineer", "Vice President, Engineering" reads as Vice President). */
const ROLE_PHRASE = `${ROLE}(?:[ \\t]+${ROLE}){0,2}`;
/** Up to three words before a role: "Project Manager", "our lead engineer", "the plant manager". */
const ROLE_QUALIFIERS = "(?:[\\p{L}&][\\p{L}&-]*[ \\t]+){0,3}";
const ROLE_WORDS = new Set([
  ...ROLE_NAMES.flatMap((role) => role.toLowerCase().split(/[ -]/)),
  "senior", "junior", "staff", "project", "team", "plant", "dr", "mr", "mrs", "ms", "prof",
]);
/** Cues after which a name is taken only when a comma, a role or the end of the clause follows. */
const STRICT_PERSON_CUE = /(?<![\p{L}\p{N}])(?:led by|contact(?:ed)?|according to)(?:[ \t]*:)?[ \t]+/giu;
/**
 * Clear cues before a person's name. The name may follow on the same line,
 * or on a later line as in a cover table (Greptile 2026-11-19): after a
 * colon and up to three line breaks ("Reviewed by:\n\nAnjali Verma"), or
 * after a blank line. A single line break with no colon is a line that
 * wrapped, so the name there is not taken.
 */
const PERSON_CUE =
  /(?<![\p{L}\p{N}])(?:prepared by|written by|reviewed by|authored by|managed by|supervised by|directed by|coordinated by|spoke with|spoken with|speaking with|interviews? with|interviewed|met with|attention|attn\.?)(?:[ \t]*:[ \t]*(?:\r?\n[ \t]*){1,3}|[ \t]*\r?\n[ \t]*(?:\r?\n[ \t]*){1,2}|(?:[ \t]*:)?[ \t]+)/giu;
/** Cues that name who wrote or checked the PD: what follows is a person even when its words are common. */
const AUTHOR_CUE = /^(?:prepared|written|reviewed|authored|supervised) by/iu;
/** After a name taken from a strict cue: a comma, a role, or the end of the clause. */
const AFTER_STRICT_PERSON = new RegExp(`(?:[ \\t]*(?:[,;:.!?)]|\\r?\\n|$)|[ \\t]+(?:the[ \\t]+)?${ROLE_PHRASE}(?![\\p{L}\\p{N}]))`, "uy");
/** A letter's closing, then a name on its own line ("Sincerely,\n\nGwendolyn Ashcombe"). */
const CLOSING_PERSON = new RegExp(
  `^[ \\t]*(?:Sincerely|Yours[ \\t]+(?:truly|sincerely)|(?:Best|Kind|Warm|With[ \\t]+kind)?[ \\t]*[Rr]egards|Thank[ \\t]+you|Thanks|Cheers|Respectfully|Cordialement)[ \\t]*,?[ \\t]*\\r?\\n(?:[ \\t]*\\r?\\n)*[ \\t]*(${PERSON})[ \\t]*(?=,|\\r?\\n|$)`,
  "gmu"
);

const HONORIFIC_PERSON = new RegExp(`(?<![\\p{L}\\p{N}])${HONORIFIC}[ \\t]+(${NAME_WORD}(?:[ \\t]+\\p{Lu}\\.)?(?:[ \\t]+${NAME_WORD})?)`, "gu");
/**
 * A name, then its role after a comma, a bracket or a line break ("Anjali
 * Verma, CTO", "Mei Tanaka (Director)", "Hélène Côté-Tremblay, Project
 * Manager", a signature's role on the next line), or a capitalized role
 * right after it.
 */
const PERSON_THEN_ROLE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${PERSON})(?:(?:,[ \\t]*|[ \\t]*\\([ \\t]*|[ \\t]*\\r?\\n[ \\t]*)(?:(?:the|our|its|a|an)[ \\t]+)?${ROLE_QUALIFIERS}${ROLE_PHRASE}|[ \\t]+(?:${ROLE_NAMES.filter((role) => /^[A-Z]+$/.test(role)).join("|")}))(?![\\p{L}\\p{N}])`,
  "gu"
);
/** A role, then a name: "CTO Raj Patel", "our engineer Tomasz Wiśniewski", "Director of Engineering, Raj Patel". */
const ROLE_THEN_PERSON = new RegExp(
  `(?<![\\p{L}\\p{N}])${ROLE_PHRASE}(?:[ \\t]+of[ \\t]+${NAME_WORD}(?:[ \\t]+${NAME_WORD}){0,3})?(?:,[ \\t]*|[ \\t]+)(${PERSON})`,
  "gu"
);
/** A first name, a middle initial and a surname on their own: "Raj K. Patel". */
const INITIAL_PERSON = new RegExp(`(?<![\\p{L}\\p{N}])(\\p{Lu}\\p{Ll}+[ \\t]+\\p{Lu}\\.[ \\t]+${NAME_WORD})`, "gu");
const PERSON_AT = new RegExp(`(?:(?:${HONORIFIC})[ \\t]+)?(${PERSON})`, "uy");

/** A person's name is kept only when none of its words is ordinary or a role ("Quality Control" is not a person). */
function plausiblePerson(name: string): boolean {
  const words = name.split(/[ \t]+/).filter((word) => !/^\p{Lu}\.$/u.test(word));
  return (
    words.length >= 1 &&
    words.every((word) => {
      const lower = fold(word).toLowerCase();
      return lower.length >= 2 && !ROLE_WORDS.has(lower) && !isOrdinaryNameWord(lower);
    })
  );
}

/**
 * Words that name a team or a function, not a person, so "Reviewed by
 * Quality Assurance" or "Prepared by Management Team" is not a name.
 */
const TEAM_WORDS = new Set([
  "quality", "assurance", "control", "management", "operations", "department", "team", "committee",
  "board", "office", "division", "unit", "staff", "finance", "accounting", "legal", "compliance",
  "safety", "production", "maintenance", "sales", "marketing", "administration", "admin", "human",
  "resources", "hr", "it", "qa", "qc", "rd", "internal", "external", "client", "applicant", "claimant",
]);

/**
 * A full name after a clear cue ("Reviewed by John Smith"), a letter's
 * closing included (Greptile 2026-11-19). Kept even when its words are
 * common ("Smith", "Grace Hall"): the cue says it is a person. Not kept when
 * a word is a role, an article, a legal suffix, a team word, or when every
 * word only describes a company ("Engineering Services"). Only whole names
 * are hidden this way; a common first name or surname is never hidden on its
 * own (`namePartsOnTheirOwn` keeps the ordinary-word guard).
 */
function plausibleCuedPerson(name: string): boolean {
  const words = name.split(/[ \t]+/).filter((word) => !/^\p{Lu}\.$/u.test(word));
  if (words.length < 2) return plausiblePerson(name);
  const lower = words.map((word) => fold(word).toLowerCase());
  return (
    lower.every(
      (word) => word.length >= 2 && !ROLE_WORDS.has(word) && !ARTICLE_WORDS.has(word) && !LEGAL_SUFFIX_WORDS.has(word) && !TEAM_WORDS.has(word)
    ) && !lower.every((word) => GENERIC_NAME_WORDS.has(word))
  );
}

/**
 * People the PD names next to a title (Dr.), a role (", CTO", "our lead
 * engineer"), a cue ("prepared by", "interviews with"; "led by", "contact"
 * and "according to" only when a comma, a role or the clause end follows,
 * so "led by Monte Carlo simulation" is not a person), a letter's closing,
 * or with a middle initial ("Raj K. Patel"). Not found: a name with none of
 * these ("Bob Marlowe wrote the firmware").
 */
export function peopleNamedByCues(written: string): string[] {
  // Names are found in the text as a reader sees it, past invisible
  // characters ("Anja\u200Bli Verma"); the scrub then hides them as written.
  const text = visibleText(written);
  const found = new Set<string>();
  const keep = (name: string | undefined, cued = false) => {
    const clean = name?.trim().replace(/[ \t]+/g, " ");
    if (clean && (cued ? plausibleCuedPerson(clean) : plausiblePerson(clean))) found.add(clean);
  };
  for (const regex of [HONORIFIC_PERSON, PERSON_THEN_ROLE, ROLE_THEN_PERSON, INITIAL_PERSON]) {
    for (const match of text.matchAll(regex)) keep(match[1]);
  }
  for (const match of text.matchAll(CLOSING_PERSON)) keep(match[1], true);
  for (const [cues, strict] of [[PERSON_CUE, false], [STRICT_PERSON_CUE, true]] as const) {
    for (const cue of text.matchAll(cues)) {
      PERSON_AT.lastIndex = (cue.index ?? 0) + cue[0].length;
      const person = PERSON_AT.exec(text);
      if (!person) continue;
      if (strict) {
        AFTER_STRICT_PERSON.lastIndex = PERSON_AT.lastIndex;
        if (!AFTER_STRICT_PERSON.test(text)) continue;
      }
      // A full name with common words is kept after a cue of who wrote or
      // checked the PD, or after any other clear cue when a comma, a role or
      // the clause end follows ("met with John Smith, CTO"). A strict cue
      // ("according to") keeps the ordinary-word guard.
      AFTER_STRICT_PERSON.lastIndex = PERSON_AT.lastIndex;
      keep(person[1], !strict && (AUTHOR_CUE.test(cue[0]) || AFTER_STRICT_PERSON.test(text)));
    }
  }
  return [...found];
}

// ─── The scrub ──────────────────────────────────────────────────────────────

/** Words that only describe the company, so "(the Company)" or "(the Client)" is not a short form. */
const DESCRIBING_WORDS = new Set([
  "client", "applicant", "claimant", "taxpayer", "corporation", "company", "firm", "business",
  "organization", "organisation", "partnership", "societe", "entreprise", "compagnie",
]);

/**
 * A short form the PD defines is the company even when it is an ordinary
 * word ("Apex"); it is not one when it only describes ("the Company") or is
 * a common acronym ("QA").
 */
function usableShortForm(alias: string): boolean {
  const words = alias.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0 || alias.length < 2) return false;
  if (words.length === 1 && isCommonAcronym(words[0])) return false;
  return !words.every((word) => {
    const lower = fold(word).toLowerCase();
    return ARTICLE_WORDS.has(lower) || LEGAL_SUFFIX_WORDS.has(lower) || DESCRIBING_WORDS.has(lower);
  });
}

/**
 * Short forms the PD defines for the company: a name, then a bracketed word
 * or two, quoted or not ("Apex Robotics Ltd. (Apex)", "(“Zyx”)", "(the
 * “QM”)", "(hereafter Apex)"), as written. Descriptions such as "(the
 * Company)" and common acronyms ("(QA)") are not short forms.
 */
export function definedShortForms(text: string, nameForms: readonly string[]): string[] {
  if (nameForms.length === 0) return [];
  const unique = [...new Set(nameForms)].sort((a, b) => b.length - a.length);
  const quote = "[\"'\\u201C\\u201D\\u2018\\u2019]";
  const pattern = new RegExp(
    `${NAME_EDGE_BEFORE}(?:${unique.join("|")})${WORD_AFTER}[.,]?[ \\t]*\\([ \\t]*(?:(?:the|hereafter|hereinafter|or|also|aka|called|referred[ \\t]+to[ \\t]+as)[ \\t]+)*${quote}?([\\p{L}\\p{N}][\\p{L}\\p{N}&.'\\u2019 -]{0,30}?)${quote}?[ \\t]*\\)`,
    "giud"
  );
  const { folded, from, to } = foldWithMap(text);
  const forms = new Set<string>();
  for (const match of folded.matchAll(pattern)) {
    const span = match.indices?.[1];
    if (!span) continue;
    const alias = text.slice(from[span[0]], to[span[1] - 1]).trim().replace(/\.$/, "");
    if (usableShortForm(alias)) forms.add(alias);
  }
  return [...forms];
}

/** The first name and surname of a known person, hidden on their own as written and in capitals. */
function namePartsOnTheirOwn(people: readonly string[]): string[] {
  const parts = new Set<string>();
  for (const person of people) {
    const words = fold(person).trim().split(/\s+/).filter((word) => !/^\p{Lu}\.$/u.test(word));
    if (words.length < 2) continue;
    for (const word of [words[0], words[words.length - 1]]) {
      if (word.length >= 3 && /^\p{Lu}/u.test(word) && !isOrdinaryNameWord(word) && !ROLE_WORDS.has(word.toLowerCase())) {
        parts.add(word);
        parts.add(word.toUpperCase());
      }
    }
  }
  return [...parts];
}

/** An initialism as written, dotted, or with "&" between its letters ("QM", "Q.M.", "F&M", "F & M"). */
function initialismPattern(initialism: string): string {
  return `${[...initialism].map(escapeRegExp).join("(?:\\.|[ \\t]*&[ \\t]*)?")}\\.?`;
}

/** The words of an Also remove entry as the leak check reads them ("A.B." is "AB"); none for spaces or punctuation. */
function alsoRemoveWords(entry: string): string[] {
  return leakReading(entry).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * An Also remove entry that starts or ends with a symbol ("C++", "C#",
 * ".NET"), as the leak check reads it, or null for an entry of words. Such an
 * entry is matched as typed, so "C++" never hides every "C". A trailing
 * period or comma does not count ("Corp." is words).
 */
function alsoRemoveLiteral(entry: string): string | null {
  const plain = leakReading(entry).trim().replace(/[.,;:]+$/u, "");
  if (/^[\p{L}\p{N}]/u.test(plain) && /[\p{L}\p{N}]$/u.test(plain)) return null;
  return plain.replace(/\s+/g, " ");
}

/**
 * The scrub's pattern for one Also remove entry (2026-11-17, Greptile P2): its
 * words in order, any length, never inside a longer word ("Li" never hides
 * "LiDAR"); a one-word entry of letters also as dotted letters ("A.B" for
 * "AB"); an entry with a symbol at an edge as typed. Matched on folded text,
 * so case and accents do not matter. Null when the entry has no letter or
 * digit.
 */
function alsoRemovePattern(entry: string): string | null {
  const words = alsoRemoveWords(entry);
  if (words.length === 0) return null;
  const literal = alsoRemoveLiteral(entry);
  if (literal !== null) return surfacePattern(literal);
  const sequence = words.map(escapeRegExp).join(PHRASE_GAP);
  const [only] = words;
  if (words.length === 1 && /^\p{L}{2,6}$/u.test(only)) {
    return `(?:${sequence}|${[...only].map(escapeRegExp).join("\\.")})`;
  }
  return sequence;
}

/**
 * Hides the names and every form in `variants`, ignoring accents, invisible
 * characters, trademark signs and words broken at a line end, never inside
 * a longer word except at a CamelCase part edge ("[redacted]Cloud" from
 * "QuillmereCloud"). Short forms the PD defines, people's first names and
 * surnames are hidden on their own too, as written and in capitals.
 */
export function scrubImportText(
  text: string,
  names: {
    organizations: readonly string[];
    people: readonly string[];
    hosts: readonly string[];
    alsoRemove?: readonly string[];
  },
  variants: CompanyNameVariants
): string {
  // Emails and phone numbers first (an address holds the domain), then
  // Business Numbers and addresses.
  let out = scrubNumbersAndAddresses(deidentifyNames(text.normalize("NFC"), []));

  const asNames = [...names.organizations, ...names.people, ...names.hosts]
    .map((name) => fold(name.normalize("NFC")).trim().replace(/\s+/g, " "))
    .filter((name) => name.length >= 3);
  const companyForms = [
    ...names.organizations
      .map((name) => fold(name.normalize("NFC")).trim().replace(/\s+/g, " "))
      .filter((name) => name.length >= 3)
      .map(surfacePattern),
    // What the person typed in Also remove: each entry, any length, as a whole word.
    ...(names.alsoRemove ?? []).flatMap((entry) => alsoRemovePattern(entry) ?? []),
    ...variants.phrases.map((parts) => parts.map(escapeRegExp).join(PHRASE_GAP)),
    ...variants.joined.map(escapeRegExp),
    ...variants.words.map(escapeRegExp),
  ];
  // Read before the names are hidden: "Apex Robotics Ltd. (Apex)".
  const shortForms = definedShortForms(out, companyForms);
  const caseless = wordsRegex([...asNames.map(surfacePattern), ...companyForms], "giu");
  if (caseless) out = replaceFolded(out, caseless, IMPORT_BRAIN_REDACTION);

  const asWritten = wordsRegex(
    [
      ...variants.initialisms.map(initialismPattern),
      ...namePartsOnTheirOwn(names.people).map(escapeRegExp),
      ...shortForms.flatMap((form) => [fold(form), fold(form).toUpperCase()]).map((form) => form.split(/\s+/).map(escapeRegExp).join(PHRASE_GAP)),
    ],
    "gu"
  );
  if (asWritten) out = replaceFolded(out, asWritten, IMPORT_BRAIN_REDACTION);
  return scrubCamelParts(out, variants);
}

/** Words written together ("QuillmereCloud", "QMCloud"): the parts that spell a form of the name are hidden. */
function scrubCamelParts(text: string, variants: CompanyNameVariants): string {
  const singles = new Set([...variants.words, ...variants.joined]);
  const phrases = variants.phrases;
  const initialisms = new Set(variants.initialisms);
  return text.replace(/[\p{L}\p{N}]+/gu, (token) => {
    const parts = camelParts(token);
    if (parts.length < 2) return token;
    const lower = parts.map((part) => fold(part.text).toLowerCase());
    const hidden: Array<[number, number]> = [];
    for (let i = 0; i < parts.length; i++) {
      let end = -1;
      for (let j = parts.length - 1; j >= i; j--) {
        const run = lower.slice(i, j + 1);
        if (
          singles.has(run.join("")) ||
          phrases.some((phrase) => phrase.length === run.length && phrase.every((word, k) => word === run[k])) ||
          (i === j && initialisms.has(fold(parts[i].text)))
        ) {
          end = j;
          break;
        }
      }
      if (end >= 0) {
        hidden.push([parts[i].start, parts[end].start + parts[end].text.length]);
        i = end;
      }
    }
    if (hidden.length === 0) return token;
    let out = "";
    let at = 0;
    for (const [start, stop] of hidden) {
      out += token.slice(at, start) + IMPORT_BRAIN_REDACTION;
      at = stop;
    }
    return out + token.slice(at);
  });
}

// ─── The leak check (its own forms, its own matcher) ────────────────────────

/** What the leak check looks for, built from the names without `companyNameVariants`. */
type LeakForms = { words: Set<string>; sequences: string[][]; joined: Set<string> };

/**
 * The leak check's own reading of a text, written apart from the scrub's:
 * invisible characters and trademark signs dropped, a word broken at a line
 * end joined again, accents off, dotted initials joined.
 */
function leakReading(text: string): string {
  const plain = text
    .normalize("NFC")
    .replace(/[\p{Default_Ignorable_Code_Point}™℠®]/gu, "")
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(\p{Ll})/gu, "$1$2");
  return joinDottedInitials(plain.normalize("NFKD").replace(/\p{M}+/gu, ""));
}

function leakForms(names: readonly string[], domainStems: readonly string[]): LeakForms {
  const words = new Set<string>();
  const sequences: string[][] = [];
  const joined = new Set<string>();
  const split = (value: string) => leakReading(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const name of names) {
    const asWritten = split(name);
    while (asWritten.length > 1 && LEGAL_SUFFIX_WORDS.has(asWritten[asWritten.length - 1].toLowerCase())) asWritten.pop();
    if (asWritten.length === 0) continue;
    const parts = asWritten.map((word) => word.toLowerCase());
    if (parts.length === 1) {
      if (parts[0].length >= 3 && !isCommonAcronym(parts[0])) words.add(parts[0]);
      continue;
    }
    sequences.push(parts);
    joined.add(parts.join(""));
    for (const [k, part] of parts.entries()) {
      const capitalized = /^\p{Lu}\p{Ll}+$/u.test(asWritten[k]);
      const digits = /^\p{N}+$/u.test(part);
      if (digits ? part.length >= 5 : (part.length >= 4 || (part.length === 3 && capitalized)) && !isOrdinaryNameWord(part) && !isCommonAcronym(part)) {
        words.add(part);
      }
    }
  }
  for (const stem of domainStems) {
    const parts = split(stem).map((word) => word.toLowerCase());
    if (parts.length === 1) words.add(parts[0]);
    else if (parts.length > 1) {
      sequences.push(parts);
      joined.add(parts.join(""));
    }
  }
  return { words, sequences, joined };
}

/**
 * The first form of the company's names still in `text`, or null. It builds
 * its own forms (every word of a name that is not ordinary, four letters or
 * more or three capitalized; a number of five digits or more; each whole
 * name as a word sequence and joined; the domain stem) and reads the text
 * its own way (`leakReading`): cut into words at anything that is not a
 * letter or a digit and into parts at inner capitals, lower case, compared
 * word by word. "Ionization" never matches "Ion"; "AcmeFarms",
 * "acme-farms", "Acme­Farms" and "ACME FARMS" all match "Acme Farms".
 */
export function findIdentityLeak(text: string, names: readonly string[], domainStems: readonly string[] = []): string | null {
  const forms = leakForms(names, domainStems);
  const tokens = leakReading(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const rawLower = new Set(tokens.map((token) => token.toLowerCase()));
  const parts: string[] = [];
  for (const token of tokens) for (const part of camelParts(token)) parts.push(part.text.toLowerCase());
  const partSet = new Set(parts);

  for (const word of forms.words) {
    if (rawLower.has(word) || partSet.has(word)) return word;
  }
  for (const value of forms.joined) {
    if (rawLower.has(value)) return value;
  }
  for (const sequence of forms.sequences) {
    for (let i = 0; i + sequence.length <= parts.length; i++) {
      if (sequence.every((word, k) => parts[i + k] === word)) return sequence.join(" ");
    }
  }
  // A joined form over parts: "Acme" "Farms" "Cloud" holds "acmefarms".
  for (const value of forms.joined) {
    for (let i = 0; i < parts.length; i++) {
      let run = "";
      for (let j = i; j < parts.length && run.length < value.length; j++) {
        run += parts[j];
        if (run === value) return value;
      }
    }
  }
  return null;
}

/**
 * The first Also remove entry still in `text`, as typed, or null (2026-11-17,
 * Greptile P2). Unlike the company's names, every entry is checked whatever
 * its length, word for word over whole words only (never a part of a longer
 * word, so "Li" is not found in "LiDAR"), in the leak check's own reading; an
 * entry with a symbol at an edge ("C++") is looked for as typed.
 * The copy's own markers ("[redacted]") are not read as words.
 */
export function findAlsoRemoveLeak(text: string, alsoRemove: readonly string[]): string | null {
  const unmarked = text.replace(/\[redacted(?: number| address)?\]/g, " ");
  const tokens = leakReading(unmarked)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
  const reading = leakReading(unmarked).toLowerCase();
  for (const entry of alsoRemove) {
    const literal = alsoRemoveLiteral(entry);
    if (literal !== null) {
      const typed = escapeRegExp(literal.toLowerCase()).replace(/ /g, "\\s+");
      if (new RegExp(`(?<![\\p{L}\\p{N}])${typed}(?![\\p{L}\\p{N}])`, "u").test(reading)) return entry.trim();
      continue;
    }
    const sequence = alsoRemoveWords(entry).map((word) => word.toLowerCase());
    if (sequence.length === 0) continue;
    for (let i = 0; i + sequence.length <= tokens.length; i++) {
      if (sequence.every((word, k) => tokens[i + k] === word)) return entry.trim();
    }
  }
  return null;
}

/**
 * What the Approve screen shows with every copy: what the scrub and the
 * leak check cover, and what a person must look for themselves.
 */
export const IMPORT_BRAIN_NOT_COVERED =
  "The check looks for the company's names and their distinctive words, initials, short forms the PD defines, the website, Business Numbers, addresses with a postal code, and people named next to a title, a role or a cue. It does not find product names, nicknames, places, or people named without a title or role. Read the copy and add any of them to Also remove.";

/**
 * Words a person should look at before approving (2026-11-17, review round
 * 2), never a refusal: the first word of a company name that is too
 * ordinary to hide ("Apex" of "Apex Robotics", "Summit" of "Summit
 * Precision Machining") where the copy still writes it capitalized in the
 * middle of a sentence or with "'s", and a bracketed capitalized word right
 * after a hidden name ("[redacted] (Apex)").
 */
export function identityWarnings(content: string, names: readonly string[]): string[] {
  const warnings = new Set<string>();
  const plain = leakReading(content);
  for (const name of names) {
    const first = leakReading(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean)[0];
    if (!first || first.length < 3 || !/^\p{Lu}/u.test(first) || !isOrdinaryNameWord(first)) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(first)}(?![\\p{L}\\p{N}])(['\\u2019][sS])?`, "gu");
    for (const match of plain.matchAll(pattern)) {
      const before = plain.slice(0, match.index ?? 0).trimEnd();
      const sentenceStart = before === "" || /[.!?:\n]$/u.test(before) || /\n\s*$/u.test(plain.slice(0, match.index ?? 0));
      if (match[1] || !sentenceStart) {
        warnings.add(`"${first}" still appears capitalized. If it means the company, add it to Also remove.`);
        break;
      }
    }
  }
  for (const match of plain.matchAll(/\[redacted\][ \t]*\([ \t]*["'“‘]?(\p{Lu}[\p{L}\p{N}&]*)/gu)) {
    if (!isCommonAcronym(match[1])) {
      warnings.add(`"${match[1]}" in brackets after a hidden name may be the company's short form. If so, add it to Also remove.`);
    }
  }
  return [...warnings];
}

// ─── The copy ───────────────────────────────────────────────────────────────

/** "Past PD, FY2024", or "Past PD" with no fiscal year. Never the client or the file name. */
export function importBrainTitle(fiscalYear: number | undefined): string {
  return fiscalYear === undefined ? "Past PD" : `Past PD, FY${fiscalYear}`;
}

/** The fiscal year of an import file: its label's year, else its year end's. */
function itemFiscalYear(item: ImportBrainCopyInput["item"]): number | undefined {
  if (item.fiscalYear !== undefined) return item.fiscalYear;
  return item.fiscalYearEnd === undefined ? undefined : new Date(item.fiscalYearEnd).getUTCFullYear();
}

/** The company's names the copy hides, as written. */
function organizationNames(input: ImportBrainCopyInput): string[] {
  const names = new Set<string>();
  const add = (name: string | undefined) => {
    const trimmed = name?.trim().replace(/\s+/g, " ");
    if (trimmed) names.add(trimmed);
  };
  add(input.company?.name);
  for (const name of input.identity.organizations) add(name);
  add(input.item.clientName);
  // The client part of a scheme file name ("04 AcmeFarms 2025-03-31 T2.DW ..."):
  // as written, and as its CamelCase words.
  const parsed = parsePdFilename(input.item.name);
  if (parsed?.clientName) {
    add(parsed.clientName);
    add(input.item.name.trim().split(/\s+/)[1]);
  }
  return [...names];
}

/**
 * Builds the Brain copy of one import file from its full text, or says why
 * it cannot: not a final PD, no company, no text, no industry, or the
 * company's name still in the copy after the scrub. Approve shows the
 * scrubbed text to a person, who can add words to `alsoRemove`, before the
 * copy is made.
 */
export function buildImportBrainCopy(input: ImportBrainCopyInput, fullText: string): ImportBrainCopyResult {
  const refuse = (code: ImportBrainCopyRefusalCode, reason: string, logReason = reason): ImportBrainCopyResult => ({
    ok: false,
    code,
    reason,
    logReason,
    notCovered: IMPORT_BRAIN_NOT_COVERED,
  });
  const { item } = input;
  if (item.category !== "final_pd") return refuse("not_final_pd", IMPORT_BRAIN_REFUSALS.not_final_pd);
  if (!item.companyKey || !item.clientName?.trim()) return refuse("no_company", IMPORT_BRAIN_REFUSALS.no_company);
  if (!fullText.trim()) return refuse("no_text", IMPORT_BRAIN_REFUSALS.no_text);
  const industry = (input.company ? input.company.industry : input.newCompanyIndustry)?.trim();
  if (!industry) return refuse("no_industry", IMPORT_BRAIN_REFUSALS.no_industry);

  // Invisible characters (zero-width spaces and joiners, soft hyphens and
  // the rest of Default_Ignorable_Code_Point) are left out of the copy before
  // anything is read or hidden (2026-11-19, from code review): a reader never
  // sees them, and every pass then works on the text as it reads, so one can
  // never split a name, its initials or a joined word ("QM\u200BCloud").
  const text = fullText.normalize("NFC").replace(INVISIBLE_CHARACTERS, "");
  const organizations = organizationNames(input);
  // An entry with no letter or digit could hide nothing, so it is refused
  // rather than ignored. A blank entry ("") is no entry.
  if ((input.alsoRemove ?? []).some((word) => word !== "" && alsoRemoveWords(word).length === 0)) {
    return refuse("also_remove_no_word", IMPORT_BRAIN_REFUSALS.also_remove_no_word);
  }
  const alsoRemove = (input.alsoRemove ?? []).map((word) => word.trim()).filter(Boolean);
  // Entries of words also get the company name rules; one with a symbol at an
  // edge ("C++", ".NET") is only matched as typed, so its bare word stays.
  const alsoRemoveNames = alsoRemove.filter((word) => alsoRemoveLiteral(word) === null);
  const host = websiteHost(input.company?.website);
  const stem = host ? domainStem(host) : null;
  const people = [
    ...new Set([
      ...input.identity.people,
      ...cleanDocumentWriterNames([...(item.documentWriterNames ?? []), ...writerNamesFromText(visibleText(text))]),
      ...peopleNamedByCues(text),
    ]),
  ];
  const variants = companyNameVariants([...organizations, ...alsoRemoveNames], stem ? [stem] : []);
  const content = scrubImportText(text, { organizations, people, hosts: host ? [host] : [], alsoRemove }, variants);
  const fiscalYear = itemFiscalYear(item);

  // The title is fixed words and a year, so only the text is checked.
  const leak = findIdentityLeak(content, [...organizations, ...alsoRemoveNames], stem ? [stem] : []);
  if (leak !== null) {
    return refuse(
      "names_left",
      `The Brain copy would still name the company ("${leak}"), so it was not made. The final PD still goes on the company's page.`,
      IMPORT_BRAIN_LEAK_LOG_REASON
    );
  }
  const typedLeak = findAlsoRemoveLeak(content, alsoRemove);
  if (typedLeak !== null) {
    return refuse(
      "names_left",
      `The Brain copy would still show "${typedLeak}" from Also remove, so it was not made. The final PD still goes on the company's page.`,
      IMPORT_BRAIN_LEAK_LOG_REASON
    );
  }
  // Review fix (Greptile, 2026-11-19): the full names the scrub was given
  // (saved people, writers and people named by a cue) are checked too, by
  // the company check's own matcher: each name as words in order and
  // joined ("AnjaliVerma"), and its distinctive words. A name the scrub
  // missed never reaches the shared copy.
  const personLeak = findIdentityLeak(
    content,
    people.filter((name) => alsoRemoveWords(name).length >= 2)
  );
  if (personLeak !== null) {
    return refuse(
      "names_left",
      `The Brain copy would still name a person ("${personLeak}"), so it was not made. The final PD still goes on the company's page.`,
      IMPORT_BRAIN_PERSON_LEAK_LOG_REASON
    );
  }

  const tier = input.writer?.tier;
  const writerName = input.writer?.name?.trim() || item.writerName?.trim() || undefined;
  const scienceCode = normalizeCraScienceCode(item.scienceCode);
  return {
    ok: true,
    warnings: identityWarnings(content, [...organizations, ...alsoRemoveNames]),
    notCovered: IMPORT_BRAIN_NOT_COVERED,
    fields: {
      kind: "pd_pair",
      docType: "pd",
      title: importBrainTitle(fiscalYear),
      content,
      industry,
      ...(writerName ? { writerName } : {}),
      writerTier:
        typeof tier === "number" && Number.isFinite(tier)
          ? Math.max(0, Math.min(1, tier))
          : IMPORT_BRAIN_DEFAULT_WRITER_TIER,
      ...(scienceCode ? { scienceCode } : {}),
      ...(fiscalYear !== undefined ? { fiscalYear } : {}),
      importItemId: item._id,
      importContentHash: item.contentHash,
    },
  };
}
