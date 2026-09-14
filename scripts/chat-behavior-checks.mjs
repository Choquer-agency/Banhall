// Story 5 (CAP-14, CAP-15): the content predicates the live chat-behaviour
// evaluation grades replies with. They live here, not inline in
// scripts/chat-behavior-eval.mjs, for one reason: the harness itself is opt-in
// and billable, so without a unit-testable home the only enforcement of the
// converge guard and the no-score rule would be a regex nobody can run in the
// gate. Harness-side logic on purpose — `--baseline` rewrites `convex/` and
// `shared/` from the revision under test, and the grading rules must not be
// rewritten along with it.

/**
 * The offline artifacts CAP-14 forbids asking the writer to author, including
 * the short forms writers actually use ("settings doc", "your storyline").
 *
 * A FIXED LIST CANNOT GRADE THE WHOLE RULE. The prompt says "or any other new
 * artifact", which is open ended; this predicate can only catch the named ones.
 * A reply that invents a new artifact name ("a terminology matrix", "a scoping
 * sheet") passes here and still breaks CAP-14, so a green harness run is
 * evidence, not proof, and the recorded `text` still needs reading.
 */
const ARTIFACTS =
  "settings document|settings doc|storyline|story line|exclusion list|exclusions list|claim exclusions|glossary|confidence map|style guide|styleguide|template";

/** An explicit request: "send me your settings document", "I need your glossary". */
const REQUEST_VERBS =
  "send|send over|send me|share|upload|provide|supply|give me|let me have|attach|write up|draft|put together|create|need|needs|require|requires|would need|will need";

/** An implicit one: "<artifact> … from you", "… would let me". */
const IMPLICIT_ASKS =
  "from you|from your side|on your end|you could (send|share|write|provide)|if you (can|could) (send|share|write|provide)|would (let|help|allow|enable) me";

/**
 * Words that turn an apparent ask into its opposite ("the Brief already carries
 * the glossary, so nothing is needed from you").
 */
const NEGATIONS = /\b(not|no|nothing|never|already|without|instead of)\b/i;

/**
 * CAP-14: "never a document for the writer to produce". True when the reply
 * asks the writer to author or hand over one of the offline artifacts Larry
 * used to build by hand (a settings document, Storyline, Claim Exclusions,
 * Confidence Map or glossary). Asking the writer for a *client fact* is fine,
 * and so is saying the tool already has one of these.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function asksWriterForArtifact(text) {
  // The verb must not itself be negated ("I do not need your glossary").
  const explicit = new RegExp(
    `\\b(${REQUEST_VERBS})\\b[^.?!]{0,80}?\\b(${ARTIFACTS})\\b`,
    "gi"
  );
  for (const match of text.matchAll(explicit)) {
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    if (!NEGATIONS.test(before)) return true;
  }
  // The implicit form is only an ask when nothing between the artifact and the
  // asking phrase negates it.
  const implicit = new RegExp(
    `\\b(?:${ARTIFACTS})\\b([^.?!]{0,40}?)\\b(?:${IMPLICIT_ASKS})`,
    "gi"
  );
  for (const match of text.matchAll(implicit)) {
    if (!NEGATIONS.test(match[1] ?? "")) return true;
  }
  return false;
}

/**
 * Nouns that make a ratio or a percentage a COUNT, not a score: "5 of 10
 * paragraphs were rewritten", "100% of the Locked caps hold". Counting is what a
 * paragraph-anchored comparison is supposed to do, so flagging it would make the
 * check punish the behaviour CAP-15 asks for.
 */
const COUNTABLE =
  "paragraph|paragraphs|section|sections|item|items|finding|findings|edit|edits|deviation|deviations|difference|differences|cap|caps|rule|rules|term|terms|sentence|sentences|word|words|line|lines|change|changes";

/**
 * CAP-15: "never a numeric score as primary output". True when the reply leans
 * on a percentage, a rating out of 5/10/100, or a named similarity score.
 * Paragraph and section numbers are not scores, and neither is a count of them.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function mentionsNumericScore(text) {
  const countAfter = `(?:\\s*(?:of|out of)\\s*\\d{1,3})?\\s*(?:of\\s+)?(?:the\\s+|its\\s+|my\\s+|your\\s+)?(?:[a-z]+\\s+){0,2}(?:${COUNTABLE})\\b`;
  const percent = new RegExp(`\\b\\d{1,3}\\s*(?:%|percent\\b)(?!${countAfter})`, "i");
  const ratio = new RegExp(
    `\\b\\d{1,3}(?:\\.\\d)?\\s*(?:\\/|\\s+out of\\s+)\\s*(?:5|10|100)\\b(?!${countAfter})`,
    "i"
  );
  return (
    percent.test(text) ||
    ratio.test(text) ||
    /\b(similarity|match|overlap|alignment)\s*(score|rating|index)?\s*(of|:)?\s*\d/i.test(
      text
    )
  );
}

/**
 * CAP-15: the comparison must name paragraphs.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function namesParagraph(text) {
  return /paragraphs?\s*\d/i.test(text);
}
