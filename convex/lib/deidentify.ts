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

export type PlaceholderEntry = { token: string; value: string };
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
 * The placeholder map for one project (and, inside a generation, frozen on
 * the generation). Deterministic for the same inputs: the client first, then
 * people in the order given, each with its full name and single-name forms.
 * Speaker labels that look generic ("Speaker 2", "Interviewer") are skipped.
 */
export function buildPlaceholderMap(input: {
  clientName?: string;
  /** Other organizations to hide (none on the record today). */
  companies?: readonly string[];
  /** Interviewer, writer, interviewees, then speaker labels. */
  people: readonly (string | undefined)[];
}): PlaceholderMap {
  const entries: PlaceholderEntry[] = [];
  const taken = new Set<string>();
  const add = (token: string, value: string | undefined) => {
    if (!value || value.length < 3 || taken.has(value)) return;
    taken.add(value);
    entries.push({ token, value });
  };

  const companies = [input.clientName, ...(input.companies ?? [])]
    .map(cleanName)
    .filter((name): name is string => !!name);
  companies.forEach((company, index) => {
    const n = index + 1;
    add(`[CLIENT_${n}]`, company);
    const short = company.replace(LEGAL_SUFFIX, "").trim();
    if (short !== company) add(`[CLIENT_${n}_SHORT]`, short);
    // 2026-09-25 (review of decision 26): the name as people say it.
    const brand = (short || company).replace(COMPANY_DESCRIPTOR, "").trim();
    if (brand !== (short || company) && brand.split(" ").length >= 2) add(`[CLIENT_${n}_BRAND]`, brand);
    const upper = (short || company).toUpperCase();
    if (upper !== short && upper !== company && /\p{L}{3,}/u.test(upper)) add(`[CLIENT_${n}_CAPS]`, upper);
  });

  let person = 0;
  const seenPeople = new Set<string>();
  for (const raw of input.people) {
    const name = cleanName(raw);
    if (!name || GENERIC_LABEL.test(name)) continue;
    if (!/^\p{Lu}/u.test(name)) continue;
    const key = name.toLowerCase();
    if (seenPeople.has(key) || taken.has(name)) continue;
    seenPeople.add(key);
    person += 1;
    add(`[PERSON_${person}]`, name);
    // "Shah, Priya" (a speaker label as a Teams export writes it) gives
    // "Shah" and "Priya", never "Shah," with its comma.
    const words = name
      .split(" ")
      .map((word) => word.replace(/,$/, ""))
      .filter((word) => !/^(?:dr|mr|mrs|ms|prof)\.?$/i.test(word));
    if (words.length >= 2) {
      const first = words[0];
      const last = words[words.length - 1];
      if (first.length >= 3 && /^\p{Lu}/u.test(first) && !COMMON_FIRST_WORDS.has(first)) {
        add(`[PERSON_${person}_FIRST]`, first);
      }
      if (last.length >= 3 && /^\p{Lu}/u.test(last) && !COMMON_FIRST_WORDS.has(last)) {
        add(`[PERSON_${person}_LAST]`, last);
      }
    }
  }
  return entries;
}

const TOKEN = /\[(?:CLIENT|PERSON)_\d+(?:_[A-Z]+)?\]/g;

const matcherCache = new WeakMap<PlaceholderMap, { find: RegExp; byValue: Map<string, string> }>();

function matcherFor(map: PlaceholderMap) {
  let cached = matcherCache.get(map);
  if (!cached) {
    const values = [...map].map((entry) => entry.value).sort((a, b) => b.length - a.length);
    const alternation = values.map(escapeRegExp).join("|");
    cached = {
      // Same boundaries as `deidentify`: a name never replaces the inside of
      // another word, and punctuation at a name's edge stays part of it.
      find: new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, "gu"),
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

const TOKEN_PARTS = /^\[(CLIENT|PERSON)_(\d+)(?:_([A-Z]+))?\]$/;

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
const BARE_TOKEN = /(?<![\p{L}\p{N}_])(?:CLIENT|PERSON)_\d+(?:_[A-Z]+)?(?![\p{L}\p{N}_])/gu;

/** Either form, bracketed first, in one pass. */
const ANY_TOKEN = new RegExp(`${TOKEN.source}|${BARE_TOKEN.source}`, "gu");

/** Whether a text may hold a token in either form (a cheap pre-check). */
function mayHoldToken(text: string): boolean {
  return text.includes("[") || text.includes("CLIENT_") || text.includes("PERSON_");
}

/**
 * The name a token in either form stands for. A bracketed token keeps its
 * rules above. A bare id restores only when the map issued exactly that id,
 * suffix included: no variant fallback, so an id the map never issued stays
 * as written.
 */
function anyTokenValue(token: string, byToken: ReadonlyMap<string, string>): string | undefined {
  return token.startsWith("[") ? tokenValue(token, byToken) : byToken.get(`[${token}]`);
}

/**
 * Placeholders become the names they stand for, bracketed or bare; unknown
 * tokens stay. One pass: a restored name is never read again.
 */
export function restorePlaceholders(text: string, map: PlaceholderMap): string {
  if (map.length === 0 || text === "" || !mayHoldToken(text)) return text;
  const byToken = new Map(map.map((entry) => [entry.token, entry.value]));
  return text.replace(ANY_TOKEN, (token) => anyTokenValue(token, byToken) ?? token);
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
  const byToken = new Map(map.map((entry) => [entry.token, entry.value]));
  for (const match of text.matchAll(ANY_TOKEN)) if (anyTokenValue(match[0], byToken) !== undefined) return true;
  return false;
}

/**
 * The map to use for texts that may already hold placeholder-style tokens,
 * such as a transcript redacted by hand with `[PERSON_1]` or `PERSON_1`
 * (review 2026-09-25). Restoring would turn those literal tokens into real names,
 * so when any text carries a token this map would restore, every token is
 * renumbered past the highest number of its kind found in the texts. The
 * source's own tokens then stay literal both ways. Deterministic in the map
 * and the texts; the same map comes back when nothing collides.
 */
export function avoidTokenCollisions(map: PlaceholderMap, texts: readonly string[]): PlaceholderMap {
  if (map.length === 0) return map;
  const highest = { CLIENT: 0, PERSON: 0 };
  let collides = false;
  for (const text of texts) {
    if (!mayHoldToken(text)) continue;
    if (!collides && containsPlaceholderToken(text, map)) collides = true;
    for (const match of text.matchAll(ANY_TOKEN)) {
      const parts = TOKEN_PARTS.exec(match[0].startsWith("[") ? match[0] : `[${match[0]}]`);
      if (!parts) continue;
      const kind = parts[1] as keyof typeof highest;
      highest[kind] = Math.max(highest[kind], Number(parts[2]));
    }
  }
  if (!collides) return map;
  return map.map((entry) => {
    const parts = TOKEN_PARTS.exec(entry.token);
    if (!parts) return entry;
    const kind = parts[1] as keyof typeof highest;
    const number = Number(parts[2]) + highest[kind];
    return { token: `[${kind}_${number}${parts[3] ? `_${parts[3]}` : ""}]`, value: entry.value };
  });
}
