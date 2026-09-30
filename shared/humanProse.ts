/**
 * Human-prose guard: typographic dashes, padding and sales language are the
 * most recognizable fingerprints of machine-written text. The prompt blocks
 * below carry the project's two writing skills to the AI: `dashfix`
 * (sentimony/skills: the plain hyphen is the only dash) and the plain-language
 * rules of `copywriting` (coreyhaines31/marketingskills), without its
 * persuasion tactics, which have no place in a CRA technical record.
 * `findDashConnectors` is the deterministic scan QA runs on the output so the
 * dash rule is checked, not just requested.
 *
 * Shared by Convex (generation + QA) and the client. The scanner uses
 * lookbehind and `\p{L}` (V8 6.2+ / Safari 16.4+); Convex's runtime is V8.
 */

// Always-on. Not waivable: this is about not reading as AI-generated, which is
// house policy rather than a style preference. It applies even when the
// sentence-construction rules are waived. Owner, 2026-09-23: every path that
// writes text a person reads gets this block (drafts, rewrites, notes, QA,
// Brief, research proposals); Seeds get RULES_SEED_WORDING instead.
export const RULES_HUMAN_PROSE = `HUMAN PROSE (MANDATORY, applies even when sentence-construction rules are waived):
CRA reviewers and internal QA read dash-laden, padded text as machine-written. Everything you write must read as a careful person's: report text, notes, questions, suggestions and replies alike.
Dashes (the plain hyphen "-" is the only dash you may type):
- Never use an em dash (—), an en dash (–), a horizontal bar (―) or any other typographic dash. Do not smuggle the pause back in with a stand-in: no double hyphen (--) and no hyphen padded with spaces ( - ).
- Fix the sentence shape that wanted the dash, not just the character:
  * Reveal or payoff ("one goal — to win"): use a colon, or two sentences.
  * "Not X — Y" pivot: recast ("Y, not X"), or use a semicolon.
  * Aside ("the plan — which failed — was dropped"): commas for a mild aside, parentheses for a true one.
  * Two linked clauses ("it compiled — it was fast"): semicolon, comma plus conjunction, or a period.
  * Summary dash ("speed, clarity, polish — that's the goal"): recast around a colon or a period.
- Ranges and paired names take the plain hyphen: 10-20, 2019-2024, pp. 12-15, Newton-Raphson, Ni-Cd. Keep ordinary hyphens in compounds (wall-to-batch, in-situ, five-year), units, codes and part numbers, and keep a minus sign inside an equation (a - b = c).
- Verbatim quotations, exact passages you were asked to copy, and [GAP: ...] markers keep their characters exactly as given.
Plain language:
- Clear over clever. Plain words over long ones: "use" not "utilize", "help" not "facilitate", "show" not "demonstrate".
- Specific over vague: name the measurement, the material, the failure, the number. Words that carry no fact ("streamline", "optimize", "innovative", "robust") say nothing. (The scanned vocabulary is the BANNED WORDS list.)
- Active voice when the actor is known ("the team ran three trials"), except where a mandated opener or the voice rules require another form.
- Confident, not qualified: drop "very", "really", "quite", "somewhat", "essentially". A real uncertainty is stated plainly as an uncertainty, never softened and never oversold.
- Use the client's own terms from the interview for their product, process and problem.
- Honest over sensational: no superlatives, no invented figures, no selling. This is a technical record, not marketing copy: no calls to action, rhetorical questions, jokes or benefit claims.
- One idea per sentence. No exclamation marks. No filler openers.
- Do not overcorrect into choppy fragments. Sentences still flow; you are removing a crutch, not the connective tissue.`;

// The Seed contract is one sentence per bullet (seedContract.ts), so the
// "two sentences" fixes above would get a Seed dropped. Seeds get this
// compact variant; the Seed validator enforces the dash part.
export const RULES_SEED_WORDING = `SEED WORDING (MANDATORY):
- The plain hyphen "-" is the only dash: no em dash, en dash, horizontal bar, doubled hyphen, or hyphen with a space on each side. Where a pause is wanted, use a comma, a colon or a semicolon; never split a bullet into two sentences.
- Ranges and paired names take the plain hyphen: 10-20, 2019-2024, Newton-Raphson.
- Plain, specific words in the client's own terms: name the measurement, the material or the failure. No filler qualifiers ("very", "really"), no superlatives, no sales language, no exclamation marks.`;

/** "a, b or c". */
function orList(words: readonly string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/**
 * 2026-09-30 (third, review P2-3): how a result is stated against its target,
 * by the target's direction. The one list of words that misstate a met
 * target, used by the drafting rule, the Self-check and the repair. For a
 * limit to stay under, "below" and "not exceeding" say it was met, so they
 * are never forbidden there.
 */
export const TARGET_DIRECTIONS = {
  reach: { met: "at or above it", misstated: ["close to", "short of", "just under", "below", "only approached"] },
  limit: { met: "at or below it", misstated: ["over", "above", "exceeding"] },
} as const;

/** The rule for each direction, and for a direction that is unclear, in the same words everywhere. */
export const TARGET_RULES = {
  reach: `For a target to reach, a result ${TARGET_DIRECTIONS.reach.met} met it; never call a met one ${orList(TARGET_DIRECTIONS.reach.misstated)}.`,
  limit: `For a limit to stay under, a result ${TARGET_DIRECTIONS.limit.met} met it; never call a met one ${orList(TARGET_DIRECTIONS.limit.misstated)} it.`,
} as const;

// 2026-09-30 (third, release suite runs 6, 10 and 11): two rules for report
// text (the PD Lines) only. Notes, QA findings and the Brief name their
// sources on purpose, so this block is not part of RULES_HUMAN_PROSE. Sent
// in the drafting and repair requests of signed-off plan runs (Step by step);
// Single draft and Compare keep their requests byte for byte.
export const RULES_REPORT_FACTS = `RESULTS AND SOURCES (MANDATORY in the report text):
Results against targets:
- State each result against its target as the numbers show, and mind the direction.
- ${TARGET_RULES.reach} Example: at least 95 percent yield.
- ${TARGET_RULES.limit} Examples: scrap below 2 percent, an error under 0.5 mm, a cycle under 30 s.
- Say a result missed its target only when the numbers show it did. Where you cannot tell which way a target runs, give the result and the target as numbers, with no word for met or missed.
- A qualifier about one result (only approached, not fully met, short of the target) belongs to the test it names. Never carry it to a later or final result.
No talk about sources:
- State the fact, never where it came from. Do not name an interview, an interviewee, a transcript, a memo, notes, a record, a document, the Brief, the Storyline, the Confidence Map or "the sources" in the report text.
- Where a point is open or disputed, state the uncertainty or the range itself ("about 10 to 12 percent lower", "was not confirmed"), never who said what or which document says it.`;

/**
 * 2026-09-30 (third): the Compliance Note instruction and the repair fix for
 * report text that names where a fact came from. The deterministic Self-check
 * of a signed-off plan run finds it with `findSourceTalk`.
 */
export const SOURCE_TALK = {
  instruction: "State facts without naming their source",
  applied: "no talk about sources found",
  fix: "state the fact itself, not where it came from",
  rule:
    "Never name an interview, an interviewee, a transcript, a memo, a document, the Brief, the Storyline or the Confidence Map in the report. Where a point is open or disputed, state the uncertainty or the range itself.",
} as const;

export interface SourceTalkHit {
  /** The words that name a source, as they appear in the text. */
  phrase: string;
  index: number;
  /** Short window around the hit for the writer or a judge to locate it. */
  context: string;
}

// Verbs that report what a source says. "show", "give" and "found" are left
// out: "the sources gave 5 W each" is about heat or light sources.
const SAYS =
  "(?:say|says|said|state|states|stated|note|notes|noted|indicate|indicates|indicated|suggest|suggests|suggested|report|reports|reported|record|records|recorded|mention|mentions|mentioned|describe|describes|described|confirm|confirms|confirmed)";

/**
 * Clear phrases that talk about the sources rather than the work. Each is
 * narrow on purpose: "light source", "heat source", "sources of error",
 * "open-source", "source code", a lowercase "confidence map" (a vision
 * term) and "the brief exposure" never match.
 */
const SOURCE_TALK_PATTERNS: readonly RegExp[] = [
  /\binterviewees?\b/giu,
  /\b(?:the|an|this|that|each|both|two|these|those|our|their|one|separate|later|earlier) interviews?\b/giu,
  /\binterview (?:transcripts?|notes|records?|recordings?)\b/giu,
  /\b(?:in|from|per|according to|based on) (?:the |an |a |one |each |both |this |that )?transcripts?\b/giu,
  new RegExp(`\\bthe transcripts? ${SAYS}\\b`, "giu"),
  new RegExp(`\\b(?:the (?:[\\p{L}-]+ )?)?memos? ${SAYS}\\b`, "giu"),
  /\b(?:in|from|per|based on) the (?:[\p{L}-]+ ){0,2}memos?\b/giu,
  /\b(?:recorded|reported|stated|given|noted|documented|described) elsewhere\b/giu,
  /\bdepending on (?:the |which )?measurement sources?\b/giu,
  /\baccording to (?:the |an |a |one |each |both |our |their |this |that )?(?:[\p{L}-]+ ){0,2}(?:interviews?|interviewees?|memos?|notes|records?|transcripts?|documents?|documentation|logs?|minutes|sources)\b/giu,
  new RegExp(`\\bthe (?:[\\p{L}-]+ )?(?:documents?|records|notes|logs?) (?:say|says|said|state|states|stated|indicate|indicates|indicated|suggest|suggests|suggested|note|notes|noted|mention|mentions|mentioned)\\b`, "giu"),
  /\b(?:the two|the|both|two|all|these|those|other) sources (?:agree|agreed|disagree|disagreed|differ|differed|conflict|conflicted|say|said|state|stated|report|reported|indicate|indicated|suggest|suggested|note|noted|mention|mentioned)\b/giu,
  /\b(?:one|another|a single|the other|each) source (?:says|said|states|stated|puts|put|reports|reported|indicates|indicated|suggests|suggested)\b/giu,
  // Case matters for the Brief's own names: a lowercase "brief" or
  // "confidence map" is ordinary or technical English.
  /\b[Tt]he (?:Generation )?Brief\b/gu,
  /\bStorylines?\b/gu,
  /\bConfidence Maps?\b/gu,
];

/**
 * 2026-09-30 (third, review P2-4): the head nouns of source talk, each with
 * the noun forms that make it the project's own subject. A hit whose head
 * noun the subject uses as a noun is not reported: an interview scheduling
 * product, a speech-to-text engine ("in the transcript"), credit memos,
 * event logs. "recorded elsewhere", "the Brief" and "Confidence Map" have no
 * such head and are always source talk. Re-check: noun forms only, so a
 * verb or an adjective ("documented", "logged", "transcribed",
 * "interviewing") never makes a head the subject; "minutes" is the subject
 * only as meeting minutes (MEETING_MINUTES); and "source" is matched with
 * its modifier (sourceModifiers).
 */
const SOURCE_HEAD_NOUNS: ReadonlyArray<readonly string[]> = [
  ["interview", "interviews", "interviewee", "interviewees", "interviewer", "interviewers"],
  ["transcript", "transcripts", "transcription", "transcriptions"],
  ["memo", "memos"],
  ["document", "documents", "documentation"],
  ["record", "records"],
  ["note", "notes"],
  ["log", "logs"],
  ["minutes"],
  ["source", "sources"],
  ["storyline", "storylines"],
];

/** Re-check: "minutes" is the project's subject only in a meeting sense. */
const MEETING_MINUTES = /\bmeeting minutes\b|\bminutes of (?:the |a |each |every )?meetings?\b/iu;

/** Words before "source" that name no kind of source. */
const NO_MODIFIER = new Set([
  "the", "a", "an", "one", "each", "both", "two", "three", "all", "these", "those", "this", "that",
  "our", "their", "its", "other", "another", "single", "which", "any", "to", "on", "of", "per", "and", "or",
]);

/**
 * The modifier of each "source" or "sources" in some words: the word before
 * it ("light", "measurement"), or "" when none names a kind of source ("the
 * sources", "two sources"). A "source of ..." ("source of error") is a cause,
 * not a kind of source, and is left out.
 */
function sourceModifiers(words: readonly string[], options: { skipSourceOf: boolean }): string[] {
  const out: string[] = [];
  words.forEach((word, index) => {
    if (word !== "source" && word !== "sources") return;
    if (options.skipSourceOf && words[index + 1] === "of") return;
    const before = words[index - 1];
    out.push(before && !NO_MODIFIER.has(before) ? before : "");
  });
  return out;
}

/**
 * 2026-09-30 (third, review P2-4): the project's own subject for
 * `findSourceTalk`, the same in the product and the release suite: every
 * signed-off item's wording across all Lines (skipped steps aside), the
 * Glossary Terms and the writer's edited terms.
 */
export function sourceTalkSubject(args: {
  planWording: ReadonlyArray<readonly string[]>;
  glossaryTerms?: readonly string[];
  editedTerms?: readonly string[];
}): string[] {
  return [...args.planWording.flat(), ...(args.glossaryTerms ?? []), ...(args.editedTerms ?? [])];
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * The phrases in `text` that name where a fact came from (2026-09-30,
 * third). `subjectText` is the project's own subject: every signed-off
 * item's wording across all Lines, the Glossary Terms and the writer's
 * edited terms. A hit whose head noun (interview, transcript, memo,
 * document, record, notes, log, meeting minutes, storyline) the subject
 * uses as a noun is not reported, and a "source" hit only where the subject
 * uses "source" with the same modifier. Hits are in text order, one per
 * position.
 */
export function findSourceTalk(
  text: string,
  options: { subjectText?: readonly string[] } = {}
): SourceTalkHit[] {
  const subjectTexts = options.subjectText ?? [];
  const subject = new Set(subjectTexts.flatMap(wordsOf));
  const meetingMinutes = subjectTexts.some((text) => MEETING_MINUTES.test(text));
  const subjectHeads = SOURCE_HEAD_NOUNS.filter((forms) =>
    forms[0] === "source"
      ? false
      : forms[0] === "minutes"
        ? meetingMinutes
        : forms.some((form) => subject.has(form)));
  // Re-check: a source hit is the subject only where the subject uses the
  // same modifier ("measurement source" silences "depending on the
  // measurement source"; "light source" or "source of error" silences no
  // bare "the sources").
  const subjectSources = new Set(
    subjectTexts.flatMap((text) => sourceModifiers(wordsOf(text), { skipSourceOf: true }))
  );
  const hits: SourceTalkHit[] = [];
  for (const pattern of SOURCE_TALK_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const phrase = match[0];
      const words = wordsOf(phrase);
      if (subjectHeads.some((forms) => forms.some((form) => words.includes(form)))) continue;
      const hitSources = sourceModifiers(words, { skipSourceOf: false });
      if (hitSources.length > 0 && hitSources.every((modifier) => subjectSources.has(modifier))) continue;
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + phrase.length + 30);
      hits.push({
        phrase,
        index: match.index,
        context: "..." + text.slice(start, end).replace(/\r?\n/g, " ") + "...",
      });
    }
  }
  // In text order, the longest first where two start together; a hit inside
  // one already kept is the same words and is dropped.
  hits.sort((left, right) => left.index - right.index || right.phrase.length - left.phrase.length);
  const kept: SourceTalkHit[] = [];
  for (const hit of hits) {
    const last = kept[kept.length - 1];
    if (last && hit.index < last.index + last.phrase.length) continue;
    kept.push(hit);
  }
  return kept;
}

/** For prompts whose output is not report prose (notes, findings, questions,
 * summaries, research proposals, release notes): the same rules, applied to
 * the model's own wording, with quotations left exactly as they are. */
export const HUMAN_PROSE_FOR_OWN_WORDING = `YOUR OWN WORDING: every note, finding, suggestion, question, summary or proposed text you write for a person follows the HUMAN PROSE rules below. Text you quote from the report or the evidence stays exactly as it is.

${RULES_HUMAN_PROSE}`;

export interface DashConnectorHit {
  /** The offending characters as they appear in the text. */
  token: string;
  /** Short window around the hit for the writer/QA to locate it. */
  context: string;
  index: number;
}

// Horizontal whitespace only: a dash at a line break (markdown rule, email
// signature, bullet) is structure, not punctuation.
const H = "[^\\S\\r\\n]";
// Spaces Word and Docs paste around a hyphen: plain, NBSP, narrow NBSP.
const SP = "[ \\u00A0\\u202F]";
const DASH_CONNECTOR = new RegExp(
  [
    // Em dash and horizontal bar: always punctuation in prose.
    "—|―",
    // Double hyphen between non-space characters on one line.
    `(?<=\\S)${H}*--+${H}*(?=\\S)`,
    // Single hyphen padded with spaces (post-filtered for ranges and minus).
    `(?<=\\S)${SP}-${SP}(?=\\S)`,
    // En dash and the other typographic hyphens (U+2010-U+2012): dashfix
    // allows only the plain hyphen, so ranges and paired names are flagged
    // too ("10–20" becomes "10-20", "Newton–Raphson" becomes
    // "Newton-Raphson"). Owner, 2026-09-23.
    "[\\u2010-\\u2013]",
  ].join("|"),
  "gu"
);

const SPACED_HYPHEN = /^[   ]-[   ]$/;

export function findDashConnectors(text: string): DashConnectorHit[] {
  const hits: DashConnectorHit[] = [];
  let match: RegExpExecArray | null;
  DASH_CONNECTOR.lastIndex = 0;
  while ((match = DASH_CONNECTOR.exec(text)) !== null) {
    const start = Math.max(0, match.index - 30);
    const end = Math.min(text.length, match.index + match[0].length + 30);
    if (SPACED_HYPHEN.test(match[0])) {
      const before = text[match.index - 1] ?? "";
      const after = text[match.index + match[0].length] ?? "";
      // "10 - 20 minutes", "5% - 10%": a spaced range, not a connector.
      if (/[\d%]/.test(before) && /[\d%-]/.test(after)) continue;
      // "a - b = c", "T2 - T1 = ΔT": a spaced minus inside an equation.
      const clause = text.slice(start, end);
      if (/[=<>≤≥≈]/.test(clause)) continue;
    }
    hits.push({
      token: match[0].trim() || match[0],
      context: "..." + text.slice(start, end).replace(/\r?\n/g, " ") + "...",
      index: match.index,
    });
  }
  return hits;
}

/** True when the text contains no typographic dash or dash stand-in. */
export function isDashClean(text: string): boolean {
  return findDashConnectors(text).length === 0;
}

/**
 * Does a writer's free-text preferences document ask for first-person plural?
 * Heuristic on the phrasing writers actually use ("write in first person",
 * "use we/our", 'say "we"'). Returns null when there is no text to judge, so
 * callers can fall back to report-based detection.
 */
export function detectFirstPersonPreference(preferences: string | null | undefined): boolean | null {
  const text = preferences?.trim();
  if (!text) return null;
  const asksFirstPerson =
    /\bfirst[- ]person\b/i.test(text) ||
    /\bwe\s*\/\s*our\b/i.test(text) ||
    /["“‘']we["”’']/i.test(text) ||
    /\b(?:use|write|prefer|say|refer to (?:the )?(?:company|client|team) as)\b[^.\n]{0,40}\b(?:we|our|us)\b/i.test(text);
  if (!asksFirstPerson) return false;
  // "do not use first person", "avoid we/our", "never write in first person"
  const negated = /\b(?:no|not|never|avoid|don't|do not|without)\b[^.\n]{0,30}\b(?:first[- ]person|we\b|our\b)/i.test(text);
  return !negated;
}
