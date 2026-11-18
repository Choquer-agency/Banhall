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

export type ImportBrainCopyResult =
  | { ok: true; fields: ImportBrainCopyFields }
  | { ok: false; code: ImportBrainCopyRefusalCode; reason: string };

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
 *    Quillmere"), a one-word name, a word with inner capitals, a number
 *    ("2525483 Ontario"), a domain stem.
 *  - `initialisms`: an all-capitals word of the name ("JRT") and the
 *    initials of a name of two words or more ("QM"), two letters or more,
 *    never a common acronym ("AI", "QA", "PD").
 */
export type CompanyNameVariants = {
  phrases: string[][];
  joined: string[];
  words: string[];
  initialisms: string[];
};

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
      for (const word of lower) {
        if (/^\p{N}+$/u.test(word) ? word.length >= 3 : word.length >= 4 && !isOrdinaryNameWord(word)) words.add(word);
      }
      const significant = original.filter((word) => !ARTICLE_WORDS.has(fold(word).toLowerCase()));
      if (significant.length >= 2) {
        const letters = significant.map((word) => fold(word)[0]?.toUpperCase() ?? "").join("");
        if (/^\p{Lu}{2,6}$/u.test(letters) && !isCommonAcronym(letters)) initialisms.add(letters);
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
 * The text folded (no accents, NFKD) with, for each folded code unit, the
 * span of the original text it came from, so a match on the folded text
 * replaces exactly the characters as written ("Vérdane" for "verdane").
 */
function foldWithMap(text: string): { folded: string; from: number[]; to: number[] } {
  let folded = "";
  const from: number[] = [];
  const to: number[] = [];
  let index = 0;
  for (const char of text) {
    const plain = fold(char);
    for (let k = 0; k < plain.length; k++) {
      from.push(index);
      to.push(index + char.length);
    }
    folded += plain;
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
/** Up to six characters that are not letters or digits between two words of a name ("Acme-Farms", "Acme  Farms"). */
const PHRASE_GAP = "[^\\p{L}\\p{N}]{1,6}";

/** One regular expression for many alternatives, longest first, never inside a longer word. */
function wordsRegex(alternatives: string[], flags: string): RegExp | null {
  const unique = [...new Set(alternatives.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return null;
  return new RegExp(`${NAME_EDGE_BEFORE}(?:${unique.join("|")})${WORD_AFTER}`, flags);
}

// ─── Numbers and addresses ──────────────────────────────────────────────────

/**
 * A Business Number: nine digits written together ("123456789"), or with
 * its program account ("123456789 RC0001", "123 456 789 RT 0001"). Never
 * inside a longer number or a decimal.
 */
const BUSINESS_NUMBER =
  /(?<![\p{L}\p{N}.,])(?:\d{9}(?:[ \t]?(?:RC|RP|RT|RR|RZ|RM)[ \t]?\d{4})?|\d{3}[ \t]\d{3}[ \t]\d{3}[ \t]?(?:RC|RP|RT|RR|RZ|RM)[ \t]?\d{4})(?![\p{L}\p{N}]|[.,]\d)/giu;
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
 * Business Numbers become `[redacted number]`. A postal code becomes
 * `[redacted address]` with the address around it: its whole line when the
 * line is short (and the line before, when it is a short line that starts
 * with a street number), else from the street number before it on the same
 * line.
 */
export function scrubNumbersAndAddresses(text: string): string {
  const lines = text.replace(BUSINESS_NUMBER, IMPORT_BRAIN_NUMBER_REDACTION).split("\n");
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
const ROLE =
  "(?:CEO|CTO|COO|CFO|CIO|CSO|VP|SVP|EVP|Vice[ \\t]+President|President|Founder|Co-founder|Cofounder|Owner|Director|Manager|Engineer|Scientist|Technician|Supervisor|Lead|Head|Chief|Principal|Partner|Chair|Chairman|Chairwoman|Foreman|Developer|Analyst|Researcher|Coordinator|Specialist)";
const ROLE_WORDS = new Set(
  ["ceo", "cto", "coo", "cfo", "cio", "cso", "vp", "svp", "evp", "vice", "president", "founder", "cofounder", "owner",
   "director", "manager", "engineer", "scientist", "technician", "supervisor", "lead", "head", "chief", "principal",
   "partner", "chair", "chairman", "chairwoman", "foreman", "developer", "analyst", "researcher", "coordinator",
   "specialist", "senior", "junior", "staff", "project", "team", "dr", "mr", "mrs", "ms", "prof"]
);
const PERSON_CUE =
  /(?<![\p{L}\p{N}])(?:led by|prepared by|written by|reviewed by|authored by|managed by|supervised by|directed by|coordinated by|contact(?:ed)?|spoke with|spoken with|speaking with|interview(?:ed)? with|interviewed|met with|according to|attention|attn\.?)(?:[ \t]*:)?[ \t]+/giu;

const HONORIFIC_PERSON = new RegExp(`(?<![\\p{L}\\p{N}])${HONORIFIC}[ \\t]+(${NAME_WORD}(?:[ \\t]+\\p{Lu}\\.)?(?:[ \\t]+${NAME_WORD})?)`, "gu");
const PERSON_THEN_ROLE = new RegExp(`(?<![\\p{L}\\p{N}])(${PERSON}),?[ \\t]+(?:\\(|the[ \\t]+|our[ \\t]+|its[ \\t]+)?${ROLE}(?![\\p{L}\\p{N}])`, "gu");
const ROLE_THEN_PERSON = new RegExp(
  `(?<![\\p{L}\\p{N}])${ROLE}(?:[ \\t]+of[ \\t]+${NAME_WORD}(?:[ \\t]+${NAME_WORD}){0,3})?,?[ \\t]+(${PERSON})`,
  "gu"
);
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

/** People the PD names next to a title (Dr.), a role (", CTO") or a cue ("led by"). */
export function peopleNamedByCues(text: string): string[] {
  const found = new Set<string>();
  const keep = (name: string | undefined) => {
    const clean = name?.trim().replace(/[ \t]+/g, " ");
    if (clean && plausiblePerson(clean)) found.add(clean);
  };
  for (const match of text.matchAll(HONORIFIC_PERSON)) keep(match[1]);
  for (const match of text.matchAll(PERSON_THEN_ROLE)) keep(match[1]);
  for (const match of text.matchAll(ROLE_THEN_PERSON)) keep(match[1]);
  for (const cue of text.matchAll(PERSON_CUE)) {
    PERSON_AT.lastIndex = (cue.index ?? 0) + cue[0].length;
    const person = PERSON_AT.exec(text);
    if (person) keep(person[1]);
  }
  return [...found];
}

// ─── The scrub ──────────────────────────────────────────────────────────────

/**
 * Hides the names and every form in `variants`, ignoring accents, never
 * inside a longer word except at a CamelCase part edge ("[redacted]Cloud"
 * from "QuillmereCloud"). People's surnames are hidden on their own too, as
 * written.
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

  const asNames = [...names.organizations, ...names.people, ...names.hosts, ...(names.alsoRemove ?? [])]
    .map((name) => fold(name.normalize("NFC")).trim().replace(/\s+/g, " "))
    .filter((name) => name.length >= 3);
  const caseless = wordsRegex(
    [
      ...asNames.map(surfacePattern),
      ...variants.phrases.map((parts) => parts.map(escapeRegExp).join(PHRASE_GAP)),
      ...variants.joined.map(escapeRegExp),
      ...variants.words.map(escapeRegExp),
    ],
    "giu"
  );
  if (caseless) out = replaceFolded(out, caseless, IMPORT_BRAIN_REDACTION);

  const surnames = names.people
    .map((person) => fold(person).trim().split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map((parts) => parts[parts.length - 1])
    .filter((last) => last.length >= 3 && /^\p{Lu}/u.test(last) && !isOrdinaryNameWord(last));
  const asWritten = wordsRegex(
    [
      ...variants.initialisms.map((initialism) => `${[...initialism].map(escapeRegExp).join("\\.")}\\.?|${escapeRegExp(initialism)}`),
      ...surnames.map(escapeRegExp),
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

function leakForms(names: readonly string[], domainStems: readonly string[]): LeakForms {
  const words = new Set<string>();
  const sequences: string[][] = [];
  const joined = new Set<string>();
  const split = (value: string) =>
    fold(joinDottedInitials(value)).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const name of names) {
    const parts = split(name);
    while (parts.length > 1 && LEGAL_SUFFIX_WORDS.has(parts[parts.length - 1])) parts.pop();
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      if (parts[0].length >= 3 && !isCommonAcronym(parts[0])) words.add(parts[0]);
      continue;
    }
    sequences.push(parts);
    joined.add(parts.join(""));
    for (const part of parts) {
      if (part.length >= 4 && !isOrdinaryNameWord(part)) words.add(part);
    }
  }
  for (const stem of domainStems) {
    const parts = split(stem);
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
 * more; each whole name as a word sequence and joined; the domain stem) and
 * matches without the scrub's patterns: the text is cut into words at
 * anything that is not a letter or a digit and into parts at inner capitals,
 * folded to lower case without accents, and compared word by word.
 * "Ionization" never matches "Ion"; "AcmeFarms", "acme-farms" and
 * "ACME FARMS" all match "Acme Farms".
 */
export function findIdentityLeak(text: string, names: readonly string[], domainStems: readonly string[] = []): string | null {
  const forms = leakForms(names, domainStems);
  const tokens = joinDottedInitials(fold(text.normalize("NFC"))).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
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
  const refuse = (code: ImportBrainCopyRefusalCode, reason: string): ImportBrainCopyResult => ({ ok: false, code, reason });
  const { item } = input;
  if (item.category !== "final_pd") return refuse("not_final_pd", IMPORT_BRAIN_REFUSALS.not_final_pd);
  if (!item.companyKey || !item.clientName?.trim()) return refuse("no_company", IMPORT_BRAIN_REFUSALS.no_company);
  if (!fullText.trim()) return refuse("no_text", IMPORT_BRAIN_REFUSALS.no_text);
  const industry = (input.company ? input.company.industry : input.newCompanyIndustry)?.trim();
  if (!industry) return refuse("no_industry", IMPORT_BRAIN_REFUSALS.no_industry);

  const text = fullText.normalize("NFC");
  const organizations = organizationNames(input);
  const alsoRemove = (input.alsoRemove ?? []).map((word) => word.trim()).filter(Boolean);
  const host = websiteHost(input.company?.website);
  const stem = host ? domainStem(host) : null;
  const people = [
    ...new Set([
      ...input.identity.people,
      ...cleanDocumentWriterNames([...(item.documentWriterNames ?? []), ...writerNamesFromText(text)]),
      ...peopleNamedByCues(text),
    ]),
  ];
  const variants = companyNameVariants([...organizations, ...alsoRemove], stem ? [stem] : []);
  const content = scrubImportText(text, { organizations, people, hosts: host ? [host] : [], alsoRemove }, variants);
  const fiscalYear = itemFiscalYear(item);

  // The title is fixed words and a year, so only the text is checked.
  const leak = findIdentityLeak(content, [...organizations, ...alsoRemove], stem ? [stem] : []);
  if (leak !== null) {
    return refuse(
      "names_left",
      `The Brain copy would still name the company ("${leak}"), so it was not made. The final PD still goes on the company's page.`
    );
  }

  const tier = input.writer?.tier;
  const writerName = input.writer?.name?.trim() || item.writerName?.trim() || undefined;
  const scienceCode = normalizeCraScienceCode(item.scienceCode);
  return {
    ok: true,
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
