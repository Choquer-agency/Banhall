/**
 * CAP-1: de-identification before firm-wide knowledge.
 *
 * Client prose reaches firm-wide surfaces (Brain exemplars, learning digest
 * input) where it is no longer scoped to the project it came from. This helper
 * strips the identifiers we actually hold on the project record, plus email and
 * phone patterns, before that crossing happens.
 *
 * Pure by design (no Convex imports) so it is unit-testable without a
 * deployment. It mirrors `convex/ai/research/core.ts`'s `redactExternalText`
 * and deliberately diverges twice: it also scrubs the project titles, and it
 * does NOT strip URLs or collapse whitespace, because the text it scrubs is
 * structured prose whose paragraphing is part of the signal.
 *
 * Best effort by construction: regex + project-record driven, never
 * model-driven. False negatives are possible, which is why the digest prompts
 * carry a privacy instruction and publication requires a human confirmation.
 */

import { isCommonLowercaseWord } from "../../shared/transcriptParse";

/** The subset of a `projects` document `deidentify` reads. All optional. */
export type DeidentifiableProject = {
  title?: string;
  sredTitle?: string;
  clientName?: string;
  writer?: string;
  interviewer?: string;
  interviewees?: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace project-record identifiers with `[redacted]`, and email/phone
 * patterns with `[redacted email]`/`[redacted phone]`. Line and paragraph
 * structure is preserved exactly.
 *
 * Passing `null`/`undefined` for the project still applies the contact-pattern
 * pass — used for edit-event rows whose project document no longer exists.
 */
export function deidentify(
  text: string,
  project: DeidentifiableProject | null | undefined
): string {
  const names = Array.from(
    new Set(
      [
        project?.clientName,
        project?.title,
        project?.sredTitle,
        project?.writer,
        project?.interviewer,
        ...(project?.interviewees ?? []),
      ]
        .map((name) => name?.trim())
        .filter((name): name is string => !!name && name.length >= 3)
    )
    // Longest first so "Acme Farms" is consumed before a bare "Acme" would
    // leave a " Farms" remnant behind.
  ).sort((a, b) => b.length - a.length);

  // Contact patterns run FIRST: a client name inside an address
  // ("jo@acmefarms.ca") would otherwise be rewritten by the name pass, break
  // the email pattern, and leave the local part behind.
  let out = text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    // Unlike the research redactor's pattern, the leading boundary is a
    // lookbehind (`\b` cannot match before "(", so "(613) 555-0134" would keep
    // its opening parenthesis), separators are required, and the bare form
    // must use the SAME separator twice ("613-555-0134", never "500-600 1000").
    // A bare ten-digit run, or a mixed-separator run, is far more often a
    // serial, sample id, or measurement range in SR&ED prose than a phone
    // number, and the sprint accepts false negatives over corrupting the
    // technical vocabulary these exemplars exist for.
    // Phone separators may include whitespace, but never a line or paragraph
    // boundary. Apply this to the prefix too so a phone on the next line
    // still redacts without consuming the preceding prefix or line break.
    .replace(
      /(?<![\d(.])(?:\+?1(?:[-.]|[^\S\r\n\u2028\u2029])?)?(?:\(\d{3}\)(?:[-.]|[^\S\r\n\u2028\u2029])?\d{3}(?:[-.]|[^\S\r\n\u2028\u2029])?\d{4}|\d{3}((?:[-.]|[^\S\r\n\u2028\u2029]))\d{3}\1\d{4})(?!\d)/g,
      "[redacted phone]"
    );

  for (const name of names) {
    // Anchored to non-alphanumeric boundaries so a short identifier cannot
    // eat the inside of an unrelated word ("Ion" within "Ionization"). Not
    // `\b`: identifiers routinely start or end with punctuation ("C++ … Ltd.").
    out = out.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,
        "giu"
      ),
      "[redacted]"
    );
  }
  return out;
}

// ─── Reversible name placeholders (owner decision 26, 2026-09-24) ──────────
//
// Before a transcript reaches any model (Claude included), the names held on
// the project record and the speaker labels that look like names become
// placeholders such as [CLIENT_1] and [PERSON_2]; every output is restored
// before it is stored or shown. Unlike `deidentify` above this is exact and
// reversible: each token stands for exactly one surface string, matched
// case-sensitively, so restore(pseudonymize(text)) === text for any text
// that does not already contain a token. Verbatim quotes a model returns are
// restored before they are located, so citation offsets and byte checks see
// the real transcript.

/**
 * `bare` marks an entry whose id also restores when a model writes it
 * without brackets (review 2026-09-25). Every map built since then carries
 * it; a map frozen on a generation before then does not, and restores
 * bracketed tokens only, because it was never renumbered past literal bare
 * ids in its sources.
 */
/**
 * Bumped with any change to how names are replaced or restored
 * (pseudonymize, restorePlaceholders): a Brief preparation key carries it.
 * 2: parser v8 labels, label-position masking and guarded name parts.
 */
export const PLACEHOLDER_ALGORITHM_VERSION = 2;

export type PlaceholderEntry = {
  token: string;
  value: string;
  bare?: boolean;
  /**
   * `label`: hidden only where it stands as a speaker label (at a line's
   * start, before its colon or its time), never in running text. Parser v8
   * weak labels that opened no turn (review 2026-09-26, P1-2).
   */
  at?: "label";
};
export type PlaceholderMap = readonly PlaceholderEntry[];

/** Capitalized words that are also first names; never replaced alone. */
const COMMON_FIRST_WORDS = new Set([
  "Will", "May", "Mark", "Grant", "Bill", "Pat", "Sue", "Rob", "Art", "Joy",
  "Hope", "Faith", "Victor", "Chase", "Frank", "Guy", "Max", "Rich", "Summer",
  "Dawn", "Page", "Drew", "Ray", "Don", "Jack", "Case", "Chip", "Dean", "Grace",
]);

/** Speaker labels that name no one. */
const GENERIC_LABEL = /^(?:speaker|participant|person|guest|unknown|interviewer|interviewee|subject|client|host|moderator|q|a)(?:\s*\d+)?$/i;

const LEGAL_SUFFIX = /[,\s]+(?:inc|incorporated|ltd|limited|llc|corp|corporation|co|company|plc|gmbh|ulc|lp|llp)\.?$/i;

/**
 * A trailing descriptor people drop when they say a company's name
 * ("Verdant Grid Technologies" is "Verdant Grid" in an interview). Only
 * stripped when at least two words remain, so a brand is never reduced to
 * one ordinary capitalized word.
 */
const COMPANY_DESCRIPTOR = /\s+(?:technologies|technology|systems|solutions|group|holdings|labs|laboratories|industries|international|enterprises|services|software|energy|canada)$/i;

function cleanName(name: string | undefined): string | undefined {
  const trimmed = name?.trim().replace(/\s+/g, " ");
  return trimmed && trimmed.length >= 3 ? trimmed : undefined;
}

/**
 * A person's name or speaker label: any length, any case, any script
 * (parser v8, audit wave 2). It needs a letter, so a VTT voice "<v 2>" never
 * hides every "2" in a transcript.
 */
function cleanPersonName(name: string | undefined): string | undefined {
  const trimmed = name?.trim().replace(/\s+/g, " ");
  return trimmed && /\p{L}/u.test(trimmed) ? trimmed : undefined;
}

/** A firm name or short form an admin typed (decision 26): two characters or more. */
function cleanFirmName(name: string | undefined): string | undefined {
  const trimmed = name?.trim().replace(/\s+/g, " ");
  return trimmed && trimmed.length >= 2 && /\p{L}/u.test(trimmed) ? trimmed : undefined;
}

const EMAIL = /^([\p{L}\p{N}._%+'-]+)@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)$/u;

/** Mailbox domains that name no organization. */
const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.ca", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
]);

/** Mailbox names that name no person ("info@", "sales@"). */
const ROLE_MAILBOXES = new Set([
  "info", "admin", "contact", "support", "sales", "hello", "team", "office", "mail",
  "noreply", "no-reply", "help", "service", "accounts", "billing", "hr", "jobs",
]);

/**
 * Lowercase words that are also first names or surnames ("will", "grant",
 * "rose"); a lowercase part of a name never hides them alone.
 */
const COMMON_LOWER_WORDS = new Set([
  ...[...COMMON_FIRST_WORDS].map((word) => word.toLowerCase()),
  "rose", "lily", "gene", "sky", "river", "ben", "long", "young", "white", "black",
  "brown", "green", "king", "love", "hall", "wood", "field", "stone", "rich", "lane",
  "park", "bell", "cook", "hunter", "baker", "miller", "smith", "carter", "mason",
]);

/**
 * Common technical words (review 2026-09-26, P1-2): a lowercase label made
 * of any of them ("flow rate", "thermal drift") fails the name test, so its
 * words are never hidden alone or capitalized.
 */
const TECHNICAL_WORDS = new Set([
  "flow", "rate", "rates", "drift", "thermal", "latency", "pressure", "temperature", "temp",
  "speed", "load", "loads", "test", "tests", "testing", "data", "system", "systems", "model",
  "models", "value", "values", "level", "levels", "time", "times", "power", "cost", "costs",
  "error", "errors", "noise", "signal", "signals", "sensor", "sensors", "voltage", "current",
  "heat", "cycle", "cycles", "yield", "output", "input", "batch", "sample", "samples", "run",
  "runs", "trial", "trials", "root", "cause", "fix", "issue", "issues", "risk", "worst",
  "best", "case", "cases", "baseline", "target", "limit", "limits", "range", "design",
  "prototype", "controller", "control", "loop", "feeder", "pump", "valve", "motor", "rig",
  "bench", "firmware", "software", "hardware", "code", "build", "release", "version",
  "step", "phase", "stage", "task", "plan", "budget", "schedule", "status", "progress",
  "summary", "context", "background", "method", "approach", "hypothesis", "experiment",
  "observation", "conclusion", "finding", "uncertainty", "advancement", "objective",
]);

/** "priya shah" as "Priya Shah"; "jean-philippe o'neil" as "Jean-Philippe O'Neil". */
function titleCase(name: string): string {
  return name.replace(/(^|[\s\-'’])(\p{Ll})/gu, (_, edge: string, letter: string) => edge + letter.toUpperCase());
}

/** A name written only in scripts without spaces between words (or Korean, with its particles). */
const NO_SPACE_SCRIPT =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}ー・·\s]+$/u;

function noSpaceName(value: string): boolean {
  return NO_SPACE_SCRIPT.test(value);
}

/**
 * Whether a lowercase name reads as a person's name (review 2026-09-26,
 * P1-2): one to three words of lowercase letters, none a common word, so
 * "priya shah" gives "Priya", "Shah" and "priya", but "thermal drift" or
 * "flow rate" never hides "drift" or "rate" alone.
 */
function lowercaseNameTest(name: string): boolean {
  const words = name.split(" ");
  return (
    words.length <= 3 &&
    words.every(
      (word) =>
        /^[\p{Ll}\p{M}'’-]{2,}$/u.test(word) &&
        !COMMON_LOWER_WORDS.has(word) &&
        !TECHNICAL_WORDS.has(word) &&
        !isCommonLowercaseWord(word)
    )
  );
}

/**
 * The placeholder map for one project (and, inside a generation, frozen on
 * the generation). Deterministic for the same inputs: the client first, then
 * the firm's own names, then people in the order given, each with its full
 * name and single-name forms. Speaker labels that look generic ("Speaker 2",
 * "Interviewer") are skipped.
 *
 * Parser v8 (2026-09-26, audit wave 2 and its review): a name in any case or
 * script and of any length is hidden. A lowercase name that passes the name
 * test also hides its capitalized form and its parts; a later label that
 * differs from a person only in case is hidden as a form of that person; an
 * email label hides the address, its mailbox name (unless a common word or
 * a role mailbox) and the name the mailbox spells, and its domain (a FIRM
 * token when it is the firm's own). `phrases`, weak labels that opened no
 * turn, are hidden only where they stand as labels.
 */
export function buildPlaceholderMap(input: {
  clientName?: string;
  /** Other organizations to hide (none on the record today). */
  companies?: readonly string[];
  /** The consulting firm's own names and short forms (admin setting). */
  firms?: readonly string[];
  /** Interviewer, writer, interviewees, then speaker labels. */
  people: readonly (string | undefined)[];
  /** Weak labels that opened no turn: hidden only at label positions. */
  phrases?: readonly string[];
}): PlaceholderMap {
  const entries: PlaceholderEntry[] = [];
  const taken = new Set<string>();
  const add = (token: string, value: string | undefined, minLength = 3, at?: "label") => {
    if (!value || value.length < minLength || taken.has(value)) return;
    taken.add(value);
    entries.push({ token, value, bare: true, ...(at ? { at } : {}) });
  };

  const firms = (input.firms ?? []).map(cleanFirmName).filter((name): name is string => !!name);
  const compact = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  /** The firm an email domain belongs to ("northwind.example" for Northwind Advisory), if any. */
  const firmOfDomain = (domain: string): number | undefined => {
    const head = compact(domain.split(".")[0]);
    const index = firms.findIndex(
      (firm) => compact(firm) === head || (firm.includes(" ") && compact(firm.split(" ")[0]) === head)
    );
    return index === -1 ? undefined : index + 1;
  };

  // Email domains name an organization (parser v8): "acme.com" in
  // "pshah@acme.com" is hidden with the organizations, and the firm's own
  // domain with the firm (review P3).
  const domains: string[] = [];
  const firmDomains: Array<[number, string]> = [];
  for (const raw of [...input.people, ...(input.phrases ?? [])]) {
    const email = EMAIL.exec(raw?.trim() ?? "");
    if (!email) continue;
    const domain = email[2];
    if (PUBLIC_MAIL_DOMAINS.has(domain.toLowerCase())) continue;
    const firm = firmOfDomain(domain);
    if (firm !== undefined) {
      if (!firmDomains.some(([, known]) => known === domain)) firmDomains.push([firm, domain]);
    } else if (!domains.includes(domain)) {
      domains.push(domain);
    }
  }

  const companyForms = (prefix: "CLIENT" | "FIRM", company: string, n: number, minLength: number) => {
    add(`[${prefix}_${n}]`, company, minLength);
    const short = company.replace(LEGAL_SUFFIX, "").trim();
    if (short !== company) add(`[${prefix}_${n}_SHORT]`, short, minLength);
    // 2026-09-25 (review of decision 26): the name as people say it.
    const brand = (short || company).replace(COMPANY_DESCRIPTOR, "").trim();
    if (brand !== (short || company) && brand.split(" ").length >= 2) add(`[${prefix}_${n}_BRAND]`, brand, minLength);
    const upper = (short || company).toUpperCase();
    if (upper !== short && upper !== company && /\p{L}{3,}/u.test(upper)) add(`[${prefix}_${n}_CAPS]`, upper, minLength);
  };

  const [client, ...others] = [input.clientName, ...(input.companies ?? []), ...domains]
    .map(cleanName)
    .filter((name): name is string => !!name);
  if (client) companyForms("CLIENT", client, 1, 3);
  // The firm's own names come before other organizations, so a label such
  // as "Dana (Firm Name)" never makes the firm a client.
  firms.forEach((firm, index) => companyForms("FIRM", firm, index + 1, 2));
  for (const [firm, domain] of firmDomains) {
    const token = `[FIRM_${firm}_DOMAIN]`;
    if (!entries.some((entry) => entry.token === token)) add(token, domain, 3);
  }
  others.forEach((company, index) => companyForms("CLIENT", company, index + 2, 3));

  let person = 0;
  const personOf = new Map<string, { n: number; name: string }>();
  const partForms = (n: number, name: string, suffix: "" | "LOWER") => {
    const words = name
      .split(" ")
      .map((word) => word.replace(/,$/, ""))
      .filter((word) => !/^(?:dr|mr|mrs|ms|prof)\.?$/i.test(word));
    if (words.length < 2) return;
    const forms: Array<[string, string]> = [
      [`FIRST${suffix}`, words[0]],
      [`LAST${suffix}`, words[words.length - 1]],
    ];
    for (const [kind, word] of forms) {
      if (/^\p{Lu}/u.test(word)) {
        if (word.length >= 3 && !COMMON_FIRST_WORDS.has(word)) add(`[PERSON_${n}_${kind}]`, word);
      } else if (/^\p{Ll}/u.test(word)) {
        if (word.length >= 3 && !COMMON_LOWER_WORDS.has(word) && !isCommonLowercaseWord(word)) {
          add(`[PERSON_${n}_${kind}]`, word);
        }
      } else if (/^\p{Lo}/u.test(word) && !noSpaceName(word) && [...word].length >= 2) {
        // Arabic, Hebrew: word parts, matched as whole words.
        add(`[PERSON_${n}_${kind}]`, word, 2);
      }
    }
  };
  /** A lowercase name that passes the name test: its capitalized form and parts. */
  const lowercaseForms = (n: number, name: string) => {
    if (!lowercaseNameTest(name)) return;
    const title = titleCase(name);
    add(`[PERSON_${n}_TITLE]`, title, 1);
    partForms(n, title, "");
    partForms(n, name, "LOWER");
  };
  /** Case and spelling forms of one person: capitalized parts first. */
  const nameForms = (n: number, name: string) => {
    const email = EMAIL.exec(name);
    if (email) {
      // Review P2-4: "will@" or "it@" never hides "will" or "it".
      const local = email[1];
      const lower = local.toLowerCase();
      if (!ROLE_MAILBOXES.has(lower) && !COMMON_LOWER_WORDS.has(lower) && !isCommonLowercaseWord(lower)) {
        add(`[PERSON_${n}_LOCAL]`, local, 2);
      }
      const pieces = lower.split(/[._-]+/);
      if (pieces.every((piece) => /^\p{L}{2,}$/u.test(piece))) lowercaseForms(n, pieces.join(" "));
      return;
    }
    if (/^\p{Ll}/u.test(name)) lowercaseForms(n, name);
    else partForms(n, name, "");
  };
  const issued = () => new Set(entries.map((entry) => entry.token));
  const variantToken = (n: number, canonical: string, surface: string): string | undefined => {
    const tokens = issued();
    const named = (suffix: string) => `[PERSON_${n}_${suffix}]`;
    if (surface === titleCase(canonical) && !tokens.has(named("TITLE"))) return named("TITLE");
    if (surface === canonical.toLowerCase() && !tokens.has(named("LOWER"))) return named("LOWER");
    if (surface === canonical.toUpperCase() && !tokens.has(named("UPPER"))) return named("UPPER");
    for (let count = 1; count <= 26; count += 1) {
      const token = named(`ALT${count === 1 ? "" : String.fromCharCode(64 + count)}`);
      if (!tokens.has(token)) return token;
    }
    return undefined;
  };
  /** The same person in another case: hidden as that person, with lowercase parts. */
  const addVariant = (known: { n: number; name: string }, name: string) => {
    if (name === known.name || taken.has(name)) return;
    const token = variantToken(known.n, known.name, name);
    if (token) add(token, name, 1);
    if (/^\p{Ll}/u.test(name) && lowercaseNameTest(name.toLowerCase())) partForms(known.n, name.toLowerCase(), "LOWER");
  };

  for (const raw of input.people) {
    const name = cleanPersonName(raw);
    if (!name || GENERIC_LABEL.test(name)) continue;
    const known = personOf.get(name.toLowerCase());
    if (known) {
      addVariant(known, name);
      continue;
    }
    if (taken.has(name)) continue;
    person += 1;
    personOf.set(name.toLowerCase(), { n: person, name });
    add(`[PERSON_${person}]`, name, 1);
    // "Shah, Priya" (a speaker label as a Teams export writes it) gives
    // "Shah" and "Priya", never "Shah," with its comma.
    nameForms(person, name);
  }
  for (const raw of input.phrases ?? []) {
    const phrase = cleanPersonName(raw);
    if (!phrase || GENERIC_LABEL.test(phrase) || taken.has(phrase)) continue;
    // Review P2-2: a loose label that is a known person in another case is
    // that person, hidden wherever it appears.
    const known = personOf.get(phrase.toLowerCase());
    if (known) {
      addVariant(known, phrase);
      continue;
    }
    person += 1;
    personOf.set(phrase.toLowerCase(), { n: person, name: phrase });
    add(`[PERSON_${person}]`, phrase, 1, "label");
  }
  return entries;
}

const TOKEN = /\[(?:CLIENT|PERSON|FIRM)_\d+(?:_[A-Z]+)?\]/g;

const matcherCache = new WeakMap<PlaceholderMap, { find: RegExp; byValue: Map<string, string> }>();

const WORD_EDGE_BEFORE = "(?<![\\p{L}\\p{N}])";
const WORD_EDGE_AFTER = "(?![\\p{L}\\p{N}])";

/** Characters around a Chinese name that still leave it whole ("李伟说", "和李伟"). */
const HAN_BEFORE = "(?<=^|[^\\p{Script=Han}]|[和与跟对给让被把向问请说在由同及])";
const HAN_AFTER =
  "(?=$|[^\\p{Script=Han}]|一起|的|说|是|在|和|跟|与|也|都|就|对|把|被|给|让|了|们|先生|女士|小姐|老师|博士|教授|经理|总|表示|认为|提到|问|回答|告诉|觉得|指出|确认|负责|介绍|解释|补充|同意|发现|会|要|将|已|曾|还|又|才|这|那|等)";
const HANGUL_PARTICLE = "(?:은|는|이|가|을|를|의|에게|에서|에|와|과|도|로|으로|께서|께|님|씨|하고|랑|이랑|한테|만|부터|까지)";
const HANGUL_BEFORE = "(?<=^|[^\\p{Script=Hangul}])";
const HANGUL_AFTER = `(?=$|[^\\p{Script=Hangul}]|${HANGUL_PARTICLE}{1,2}(?![\\p{Script=Hangul}]))`;
const KANA_BEFORE = "(?<=^|[^\\p{Script=Katakana}\\u30FC\\u30FB])";
const KANA_AFTER = "(?=$|[^\\p{Script=Katakana}\\u30FC\\u30FB])";

/**
 * A name in a script without word edges is matched as a whole name (review
 * 2026-09-26, P1-2): 李伟 in "李伟说" but never inside 李伟东, 김민수 with
 * its particle ("김민수는"), a Katakana name never inside a longer one.
 */
function noSpaceEdges(value: string): [string, string] {
  const first = value[0];
  const last = value[value.length - 1];
  const before = /\p{Script=Hangul}/u.test(first)
    ? HANGUL_BEFORE
    : /[\p{Script=Katakana}ー・]/u.test(first)
      ? KANA_BEFORE
      : /\p{Script=Han}/u.test(first)
        ? HAN_BEFORE
        : "(?<![\\p{L}])";
  const after = /\p{Script=Hangul}/u.test(last)
    ? HANGUL_AFTER
    : /[\p{Script=Katakana}ー・]/u.test(last)
      ? KANA_AFTER
      : /\p{Script=Han}/u.test(last)
        ? HAN_AFTER
        : "(?![\\p{L}])";
  return [before, after];
}

/**
 * Where a label stands (review P1-2): at a line's start (after a time, a
 * cue's `<v`, or a render's "] " or ") " prefix), followed by its colon
 * (after brackets or a time, if any) or by a time that ends the line.
 */
const TIME = "\\[?\\d{1,2}:\\d{2}(?::\\d{2})?(?:[.,]\\d{1,3})?\\]?";
const LABEL_BEFORE = `(?<=(?:^|\\n)[ \\t]*(?:${TIME}[ \\t]*(?:-[ \\t]*)?)?|[\\])][ \\t]|<v(?:\\.[^\\s>]+)*[ \\t]+)`;
const LABEL_AFTER = `(?=[ \\t]*(?:[(\\[][^()\\[\\]\\n]{0,80}[)\\]][ \\t]*)?(?:${TIME}[ \\t]*)?[:\\uFF1A]|[ \\t]+${TIME}[ \\t]*(?:\\r?\\n|$)|>)`;

function patternFor(entry: PlaceholderEntry): string {
  const value = escapeRegExp(entry.value);
  if (entry.at === "label") return `${LABEL_BEFORE}${value}${LABEL_AFTER}`;
  if (noSpaceName(entry.value)) {
    const [before, after] = noSpaceEdges(entry.value);
    return `${before}${value}${after}`;
  }
  return `${WORD_EDGE_BEFORE}${value}${WORD_EDGE_AFTER}`;
}

function matcherFor(map: PlaceholderMap) {
  let cached = matcherCache.get(map);
  if (!cached) {
    const sorted = [...map].sort((a, b) => b.value.length - a.value.length);
    // Same boundaries as `deidentify`: a name never replaces the inside of
    // another word, and punctuation at a name's edge stays part of it. Maps
    // with only such names keep the one shared boundary; a label-only entry
    // or a name without word edges carries its own.
    const find = sorted.every((entry) => entry.at === undefined && !noSpaceName(entry.value))
      ? new RegExp(`${WORD_EDGE_BEFORE}(?:${sorted.map((entry) => escapeRegExp(entry.value)).join("|")})${WORD_EDGE_AFTER}`, "gu")
      : new RegExp(sorted.map(patternFor).join("|"), "gu");
    cached = {
      find,
      byValue: new Map(map.map((entry) => [entry.value, entry.token])),
    };
    matcherCache.set(map, cached);
  }
  return cached;
}

/** Names become their placeholders. Exact-case matches only; one pass. */
export function pseudonymize(text: string, map: PlaceholderMap): string {
  if (map.length === 0 || text === "") return text;
  const { find, byValue } = matcherFor(map);
  find.lastIndex = 0;
  return text.replace(find, (match) => byValue.get(match) ?? match);
}

const TOKEN_PARTS = /^\[(CLIENT|PERSON|FIRM)_(\d+)(?:_([A-Z]+))?\]$/;

/**
 * The name a token stands for. A variant the map never issued (a model
 * writing `[PERSON_2_FIRST]` for a one-word name, or `[CLIENT_1_CAPS]`)
 * falls back to its base token's name: the first or last word of it for
 * FIRST and LAST, the whole name otherwise (review 2026-09-25). A token
 * whose base is not in the map stays as written.
 */
function tokenValue(token: string, byToken: ReadonlyMap<string, string>): string | undefined {
  const exact = byToken.get(token);
  if (exact !== undefined) return exact;
  const parts = TOKEN_PARTS.exec(token);
  if (!parts || !parts[3]) return undefined;
  const base = byToken.get(`[${parts[1]}_${parts[2]}]`);
  if (base === undefined) return undefined;
  const words = base.split(" ");
  if (parts[3] === "FIRST") return words[0];
  if (parts[3] === "LAST") return words[words.length - 1];
  return base;
}

/**
 * A token a model wrote without its brackets (`CLIENT_1`, `CLIENT_1_BRAND`,
 * "led by PERSON_2"; review 2026-09-25). Whole ids only: the edges exclude
 * letters, digits and underscores, so `XCLIENT_1`, `CLIENT_10` and
 * `CLIENT_1_OTHER` never match as `CLIENT_1`. Case-sensitive, like the
 * bracketed form, so a code identifier such as `client_1` stays.
 */
const BARE_TOKEN = /(?<![\p{L}\p{N}_])(?:CLIENT|PERSON|FIRM)_\d+(?:_[A-Z]+)?(?![\p{L}\p{N}_])/gu;

/**
 * A text with every bracketed placeholder removed: for a search query that
 * should match on the technology, never on a hidden name.
 */
export function dropPlaceholderTokens(text: string): string {
  return text.replace(TOKEN, "").replace(/[ \t]{2,}/g, " ");
}

/** Either form, bracketed first, in one pass. */
const ANY_TOKEN = new RegExp(`${TOKEN.source}|${BARE_TOKEN.source}`, "gu");

/** Whether a text may hold a token in either form (a cheap pre-check). */
function mayHoldToken(text: string): boolean {
  return text.includes("[") || text.includes("CLIENT_") || text.includes("PERSON_") || text.includes("FIRM_");
}

type TokenLookup = {
  byToken: ReadonlyMap<string, string>;
  /** Only the entries marked `bare`: the ids that also restore bare. */
  byBareToken: ReadonlyMap<string, string>;
};

function tokenLookup(map: PlaceholderMap): TokenLookup {
  return {
    byToken: new Map(map.map((entry) => [entry.token, entry.value])),
    byBareToken: new Map(map.filter((entry) => entry.bare).map((entry) => [entry.token, entry.value])),
  };
}

/**
 * The name a token in either form stands for. A bracketed token keeps its
 * rules above. A bare id restores only when the map issued exactly that id,
 * suffix included, on an entry marked `bare`: no variant fallback, so an id
 * the map never issued stays as written, and so does every bare id under a
 * map frozen before bare ids were restored.
 */
function anyTokenValue(token: string, lookup: TokenLookup): string | undefined {
  return token.startsWith("[") ? tokenValue(token, lookup.byToken) : lookup.byBareToken.get(`[${token}]`);
}

/**
 * Placeholders become the names they stand for, bracketed or (for entries
 * marked `bare`) bare; unknown tokens stay. One pass: a restored name is
 * never read again.
 */
export function restorePlaceholders(text: string, map: PlaceholderMap): string {
  if (map.length === 0 || text === "" || !mayHoldToken(text)) return text;
  const lookup = tokenLookup(map);
  return text.replace(ANY_TOKEN, (token) => anyTokenValue(token, lookup) ?? token);
}

/** `restorePlaceholders` over every string inside a JSON-like value. */
export function restorePlaceholdersDeep<T>(value: T, map: PlaceholderMap): T {
  if (map.length === 0) return value;
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return restorePlaceholders(item, map);
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, walk(nested)]));
    }
    return item;
  };
  return walk(value) as T;
}

/**
 * Whether a text already carries a token this map would restore: one of its
 * own tokens, bracketed or bare, or a bracketed variant whose base is one
 * (round trip unsafe).
 */
export function containsPlaceholderToken(text: string, map: PlaceholderMap): boolean {
  if (map.length === 0 || !mayHoldToken(text)) return false;
  const lookup = tokenLookup(map);
  for (const match of text.matchAll(ANY_TOKEN)) if (anyTokenValue(match[0], lookup) !== undefined) return true;
  return false;
}

/**
 * The map to use for texts that may already hold placeholder-style tokens,
 * such as a transcript redacted by hand with `[PERSON_1]` or `PERSON_1`
 * (review 2026-09-25). Restoring would turn those literal tokens into real names,
 * so when any text carries a token this map would restore, every token is
 * renumbered past the highest number of its kind found in the texts. The
 * source's own tokens then stay literal both ways. Deterministic in the map
 * and the texts; the same map comes back when nothing collides. Numbers are
 * added as BigInt, so a very long literal id (`PERSON_` and 22 digits, say)
 * still gives exact tokens such as `[PERSON_1000...001]`, never
 * `[PERSON_1e+23]`.
 */
export function avoidTokenCollisions(map: PlaceholderMap, texts: readonly string[]): PlaceholderMap {
  if (map.length === 0) return map;
  const highest = { CLIENT: BigInt(0), PERSON: BigInt(0), FIRM: BigInt(0) };
  let collides = false;
  for (const text of texts) {
    if (!mayHoldToken(text)) continue;
    if (!collides && containsPlaceholderToken(text, map)) collides = true;
    for (const match of text.matchAll(ANY_TOKEN)) {
      const parts = TOKEN_PARTS.exec(match[0].startsWith("[") ? match[0] : `[${match[0]}]`);
      if (!parts) continue;
      const kind = parts[1] as keyof typeof highest;
      const number = BigInt(parts[2]);
      if (number > highest[kind]) highest[kind] = number;
    }
  }
  if (!collides) return map;
  return map.map((entry) => {
    const parts = TOKEN_PARTS.exec(entry.token);
    if (!parts) return entry;
    const kind = parts[1] as keyof typeof highest;
    const number = BigInt(parts[2]) + highest[kind];
    return { ...entry, token: `[${kind}_${number}${parts[3] ? `_${parts[3]}` : ""}]` };
  });
}
