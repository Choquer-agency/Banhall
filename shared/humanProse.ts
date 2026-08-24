/**
 * Human-prose guard: em dashes and their stand-ins are the most recognizable
 * fingerprint of machine-written text. The prompt block below (distilled from
 * the no-em-dashes skill plus plain-language copywriting rules) tells the
 * writing agents how to avoid them; `findDashConnectors` is the deterministic
 * scan QA runs on the output so the rule is checked, not just requested.
 *
 * Shared by Convex (generation + QA) and the client. The scanner uses
 * lookbehind and `\p{L}` (V8 6.2+ / Safari 16.4+); Convex's runtime is V8.
 */

// Always-on. Not waivable: this is about not reading as AI-generated, which is
// house policy rather than a style preference. It applies even when the
// sentence-construction rules are waived.
export const RULES_HUMAN_PROSE = `HUMAN PROSE (MANDATORY, applies even when sentence-construction rules are waived):
CRA reviewers and internal QA now read a dash-laden paragraph as machine-written. Every paragraph must read as a person's.
- Never use an em dash (—) in prose. Do not smuggle the same pause back in with a stand-in: no double hyphen (--), no hyphen padded with spaces ( - ), no spaced en dash between words ( – ), no horizontal bar.
- Fix the sentence shape that wanted the dash, not just the character:
  * Reveal or payoff ("one goal — to win"): use a colon, or two sentences.
  * "Not X — Y" pivot: recast ("Y, not X"), or use a semicolon.
  * Aside ("the plan — which failed — was dropped"): commas for a mild aside, parentheses for a true one.
  * Two linked clauses ("it compiled — it was fast"): semicolon, comma plus conjunction, or a period.
  * Summary dash ("speed, clarity, polish — that's the goal"): recast around a colon or a period.
- Not dashes, leave them alone: hyphens in compounds (wall-to-batch, in-situ, five-year), number and date ranges (10-20, 2019-2024), units, codes, and part numbers, a closed en dash in a paired name (Newton–Raphson, Ni–Cd), and any minus sign, including a spaced minus in an equation (a - b = c).
- Plain words over long ones: "use" not "utilize", "help" not "facilitate", "show" not "demonstrate". Say the specific thing, not the adjective: name the measurement, the material, the failure. (Guidance for word choice; the scanned vocabulary is the BANNED WORDS list.)
- Confident, not qualified: drop "very", "really", "quite", "somewhat", "essentially". No exclamation marks. No filler openers.
- Do not overcorrect into choppy fragments. Sentences still flow; you are removing a crutch, not the connective tissue.`;

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
    // En dash with whitespace on at least one side, between letters or
    // quote/bracket characters. A closed en dash (Newton–Raphson) is fine.
    `(?<=[\\p{L})\\]"'”’])(?:${H}+–${H}*|${H}*–${H}+)(?=[\\p{L}(\\["'“‘])`,
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

/** True when the text contains no em dash or dash stand-in used as punctuation. */
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
