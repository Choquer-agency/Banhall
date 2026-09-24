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
