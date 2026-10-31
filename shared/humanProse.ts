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

// The framework-free note marker regexes (gap and inferred), beside the CRA line math.
import { NOTE_MARKER_RE } from "../convex/lib/lineLimits";

/**
 * 2026-10-30 (owner, "please fix all properly", small items): drafts copied
 * lowercase acronyms from the source into report prose,
 * following the rule to use the client's own terms. Sent in RULES_HUMAN_PROSE
 * and in the Seed wording rules.
 */
export const ACRONYM_RULE =
  "Write an acronym in capitals (PLC, HVAC, CNC) even where the source writes it in lowercase, except in a command, a file name, a code identifier or a term with its own standard casing (pH, kWh, gRPC, iOS).";

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
- Use the client's own terms from the interview for their product, process and problem. ${ACRONYM_RULE}
- Honest over sensational: no superlatives, no invented figures, no selling. This is a technical record, not marketing copy: no calls to action, rhetorical questions, jokes or benefit claims.
- One idea per sentence. No exclamation marks. No filler openers.
- Do not overcorrect into choppy fragments. Sentences still flow; you are removing a crutch, not the connective tissue.`;

// The Seed contract is one sentence per bullet (seedContract.ts), so the
// "two sentences" fixes above would get a Seed dropped. Seeds get this
// compact variant; the Seed validator enforces the dash part.
export const RULES_SEED_WORDING = `SEED WORDING (MANDATORY):
- The plain hyphen "-" is the only dash: no em dash, en dash, horizontal bar, doubled hyphen, or hyphen with a space on each side. Where a pause is wanted, use a comma, a colon or a semicolon; never split a bullet into two sentences.
- Ranges and paired names take the plain hyphen: 10-20, 2019-2024, Newton-Raphson.
- Plain, specific words in the client's own terms: name the measurement, the material or the failure. No filler qualifiers ("very", "really"), no superlatives, no sales language, no exclamation marks. ${ACRONYM_RULE}`;

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

/**
 * 2026-10-04 (second, round 4): a target is met only as the sources state
 * it. Release suite runs 3, 5 and 6 wrote "met both the outgassing defect
 * and film build targets" where the source met the pinhole and cure targets
 * and the edges averaged 64 microns with a minimum of 52 against at least
 * 60, and "edge coverage still met target" at 58 against at least 60. Sent
 * only where the targets check is (Lines 244 and 246 of a signed-off plan):
 * in the drafting rule, the check and the repair fix.
 */
export const TARGET_MET_RULE =
  "Say a target was met only as the sources state it, and name the same targets the sources name. An average is not every item: where a minimum or a share falls short of the target, say so.";

/**
 * 2026-10-04 (second, release suite run of 2026-10-04): figures stay with
 * their group, and no detail beyond the sources. The one wording of the
 * rule, used as it is by the drafting rule, the Self-check's plan check and
 * the repair fix (as TARGET_RULES is for targets). Neutral on purpose: no
 * fixture's figures or terms.
 */
export const FACT_RULES = {
  scope:
    "Give each figure for the same group, test, unit, condition and denominator the sources give it. A rate over all items is not the rate of one subset, even when every failure came from that subset.",
  detail:
    "Add no specific detail that the sources and the signed-off plan do not give: no material, place, person, organization, product, supplier, date or number of your own. Never move a detail from the thing it belongs to onto another thing.",
  cause:
    "State a cause as confirmed only where the sources confirm it. A suspected or expected cause stays suspected, and an open question stays open.",
  // Review round 1, P2-4 (b): the run's analysis wrote datasheets "based on
  // thin, flat panels and/or steel substrates", and the draft made it firm.
  hedge:
    // Re-check P3-5: "such as" marks an example, not a hedge.
    'A hedge in the sources ("typically", "and/or", "may", "suspected") stays a hedge, and an example ("such as") stays an example: stating a hedge as firm, or an example as the whole case, adds a detail the sources do not give.',
  // Round 2 (owner approved 2026-10-05): run 4 wrote "only some panels met
  // it" where most did.
  proportion:
    'A proportion keeps its strength: "most" stays "most", "some" or "a few" never stands for "most", and a share given as a number keeps that number or a word that matches it (80 percent is "most", never "some"). Understating or overstating a proportion is a wrong figure.',
  allowed:
    "Rounding, the same figure in another unit or form, plain arithmetic on the sources' own numbers and plain-language wording are fine.",
} as const;

/**
 * 2026-10-04 (second, review round 1, P2-4 (a)): the same rule for the
 * transcript analysis, which drafting and the facts check both read. The
 * run's stored analysis kept "4% of panels ... all from the deep cove
 * profile" but dropped the per-profile table (13 percent of 180), and added
 * "and/or steel substrates" and "(typically steel)" that no source states.
 * Inserted into the analyzer's Critical Rules (convex/ai/prompts.ts).
 * Round 2 (owner approved 2026-10-05): run 4's analysis still merged what
 * standard powder needs and what the datasheets cover ("developed for flat
 * steel/thin flat panel substrates"), so a third line keeps such statements
 * apart, with a neutral example.
 */
export const RULES_ANALYSIS_FIGURES = `- Keep each figure with the group, test, unit, condition and denominator the source gives it. Where a source gives figures per group (a table row for each profile, batch, site or test), keep each group's figure with its count, and mark a figure over all groups as over all groups.
- Add no qualifier, material, example or cause the sources do not state: no "typically X", "and/or X" or "such as X" from your own knowledge. Keep a hedge the source makes ("may", "suspected", "about") as a hedge.
- Keep statements about different things apart. What one material or process needs, and what a datasheet, supplier or standard covers, are separate statements: never merge them into one claim. Example: if a source says standard glue needs high heat on glass, and that the supplier's sheet is written for thin flat boards, do not write that the sheet is written for glass boards.`;

// 2026-09-30 (third, release suite runs 6, 10 and 11): two rules for report
// text (the PD Lines) only. Notes, QA findings and the Brief name their
// sources on purpose, so this block is not part of RULES_HUMAN_PROSE. Sent
// in the drafting and repair requests of signed-off plan runs (Step by step);
// Single draft and Compare keep their requests byte for byte.
// 2026-10-04 (second): a third rule, figures and details as the sources give
// them (FACT_RULES).
export const RULES_REPORT_FACTS = `RESULTS AND SOURCES (MANDATORY in the report text):
Results against targets:
- State each result against its target as the numbers show, and mind the direction.
- ${TARGET_RULES.reach} Example: at least 95 percent yield.
- ${TARGET_RULES.limit} Examples: scrap below 2 percent, an error under 0.5 mm, a cycle under 30 s.
- Say a result missed its target only when the numbers show it did. Where you cannot tell which way a target runs, give the result and the target as numbers, with no word for met or missed.
- A qualifier about one result (only approached, not fully met, short of the target) belongs to the test it names. Never carry it to a later or final result.
Figures and details as the sources give them:
- ${FACT_RULES.scope} Example: "3 percent of all castings were rejected, every one from the night shift" does not mean 3 percent of the night shift's castings were rejected.
- ${FACT_RULES.detail}
- ${FACT_RULES.cause}
- ${FACT_RULES.hedge}
- ${FACT_RULES.proportion}
- ${FACT_RULES.allowed}
No talk about sources:
- State the fact, never where it came from. Do not name an interview, an interviewee, a transcript, a memo, notes, a record, a document, the Brief, the Storyline, the Confidence Map or "the sources" in the report text.
- Where a point is open or disputed, state the uncertainty or the range itself ("about 10 to 12 percent lower", "was not confirmed"), never who said what or which document says it.`;

/**
 * 2026-10-29 (owner, chat: "We can include the ... inference marker."): the
 * three kinds of claim in report text. In a meeting the firm said drafts
 * state, with confidence, things the source never says ("Trials then
 * indicated...", "The team found that..."), so reviewers hunt for what was
 * invented. Michael: "there's good inferences and there's bad ones ... maybe
 * it needs to be flagged". Tracy: "let it leave blanks, basically, if it's
 * really not there". A stated claim is written plainly; a consequence,
 * cause or comparison the stated facts clearly imply is written and marked;
 * a claim with no basis is not written and a gap takes its place. Review
 * round 2: an event (a trial, test, result, finding, first approach or
 * change of approach) is never inferred, marked or not: without evidence it
 * is a gap. The marker
 * is a note to the writer, like a gap, so it may name the source; the
 * sentence never does.
 *
 * 2026-10-29 (third, owner "Sure" to item 3, and item 1f): general practice
 * is the one use of the model's own knowledge. Where the evidence names no
 * standard approach, Line 242's limitations may name well-known standard
 * practice, marked "[INFERRED: general practice, not in the source: ...]"
 * for the writer to confirm with the client; never as something the company
 * tried, and with no invented specifics. Events are still never inferred.
 * An analysis entry the analyzer labelled "Implied, not stated:" is drafted
 * as a marked inference or left out.
 *
 * Locked, like the [GAP] rule beside it: sent in the shared writing rules of
 * every drafting request (Single draft, Compare, Step by step and a redraft,
 * with their repairs, which reuse those requests) and of the Assistant. It
 * sits in the system prompt, right after the GENERAL RULES' [GAP] line. The
 * Line instructions come later, in the user message, so a short pointer
 * right after them (SECTION_EVIDENCE_POINTER, convex/ai/prompts.ts) says
 * this rule decides where they ask for content the evidence does not give.
 */
/**
 * 2026-10-29 (third), review round 1 (P2-2): a general-practice marker
 * covers the approach and what it generally does, never a fact about the
 * project. Sent in RULES_EVIDENCE_KINDS and in Line 242's limitations rule.
 *
 * 2026-10-30 (owner, "please fix all properly", item 3): a rerun's Line 242
 * rested its limitation on marked general-practice sentences that explained
 * how the standard approach handles the problem, which argues against the
 * uncertainty, when the source gave no reason the standard approach falls
 * short. General practice now only names the approach and where it is used,
 * once in a Line; the reason it falls short comes from the evidence, or one
 * gap asks the client for it.
 */
export const GENERAL_PRACTICE_SCOPE =
  "The marker covers only what the approach is and where it is generally used. Never explain how it works on this kind of problem or how it would handle it: that argues against the uncertainty. Why it falls short here must come from stated facts about this project; where the evidence gives no reason, write one [GAP: why the standard approach does not work here] instead, never a general-practice sentence that supplies or suggests a reason. Never put a fact about this project, its conditions or its work in a general-practice sentence. Write at most one general-practice sentence in a Line. When the company's own approach is itself a standard mechanism, never present it as common practice that handles the problem: say what it does not handle here, from the evidence, or ask in the one gap, and never draw a contrast the evidence does not give. For any further limitation with no standard approach in the evidence, write one [GAP: which standard approaches the team knew of, and why they fall short here] in its place.";

/**
 * 2026-10-30 (owner, "please fix all properly", item 3): notes to the writer
 * leaked into report sentences in a rerun of a writer's test ("The materials
 * do not report what that testing showed.", "Findings about X are not
 * stated.", "The client reports that...", a repeated "... remains
 * unconfirmed."). A report sentence speaks about the work; what is missing
 * goes in one gap and the basis of an inference in its marker. The
 * deterministic check `findNotesToWriter` (convex/ai/qaChecks.ts) finds the
 * clearest of them.
 */
export const RULES_NO_NOTES_IN_REPORT_TEXT =
  '- Report sentences speak about the work, never about the source documents or what they lack. Never write a note to the writer as a report sentence, such as "The materials do not report what that testing showed.", "The results are not stated.", "Individual runs are not described.", "The client reports that no standard method was found." or "... remains unconfirmed." said of what the evidence lacks. What is missing goes inside one [GAP: ...]; the basis of an inference goes inside its [INFERRED: ...] marker. A status sentence about the work ("remains open", "was unresolved at year end") is report text, not a note, where the evidence gives it.';

/**
 * 2026-10-30, rerun C (S1): a Line 244 said "... remains open." twice where
 * the source gave no status, since Line 246's status rule
 * (SECTION_246_STATUS_ONLY_FROM_EVIDENCE) reached no other Line. Every Line
 * gets the core of it here.
 */
export const RULES_STATUS_ONLY_FROM_EVIDENCE =
  "- In any Line, say a question remains open, or that the work continues, only where the evidence says so; where the evidence gives no status, the one gap that asks for results asks for it.";

/**
 * 2026-10-30 (owner, "please fix all properly", small items): gaps asked
 * for facts the project record or the T661 form's other fields already
 * hold. Only these; every other missing fact is still a gap. After the live
 * rerun (R7): within a Line, each missing fact is asked once.
 */
export const RULES_GAPS_NOT_FOR_RECORD_FACTS =
  "- A [GAP: ...] never asks for what the project record or the T661 form's other fields hold: the fiscal year, the project's start or end date, costs or hours.\n- Within a Line, ask each missing fact once: one gap per missing fact, and a later gap never repeats what an earlier gap in the Line asks.";

export const RULES_EVIDENCE_KINDS = `STATED, INFERRED OR MISSING (MANDATORY in the report text):
Every claim you write in a report Line is one of three kinds. Decide which before you write it.
1. Stated: the evidence says it. Write it plainly.
2. Inferred: a consequence, a cause or a comparison that the stated facts clearly imply, and that a careful reader of the evidence would agree with. Write the sentence, then put a marker straight after it: [INFERRED: the stated facts it rests on, in plain words]. The marker tells the writer which sentence to check and why you thought it.
3. Missing: nothing in the evidence supports it. Do not write it. Where the Line needs it, put a [GAP: what is needed] marker in its place.
- Events are never inferred. Write a trial, a test, a result, a finding, a first approach or a change of approach only where the evidence describes it. An event the evidence does not describe is missing: leave a [GAP: ...]. A marker does not make it allowed.
- [INFERRED: ...] is only for a consequence, a cause or a comparison drawn from stated facts, for general practice as below, and for a hypothesis built from the stated approach where the evidence states none. Write an inferred cause as likely, never as confirmed.
- Never write an inference as if the evidence stated it: mark it.
- An inference adds no specific detail of its own: no number, material, name, date, setting or test result. A detail you would have to invent is missing and gets a gap.
- General practice is the one use of your own knowledge. In the limitations of standard practice, where the evidence names no standard approach, you may name a well-known standard approach in one sentence, marked straight after it with [INFERRED: general practice, not in the source: what the writer should confirm with the client]. Name it in general terms only, with no figure, product version or setting of your own, and never say or suggest that the company tried it unless the evidence says so. ${GENERAL_PRACTICE_SCOPE}
- An entry of the transcript analysis that begins "Implied, not stated:" is an inference, not a stated fact: write it as an inference and mark it, or leave it out.
- When a Line's instructions ask for something the evidence does not give, such as a step of an experiment, a result, a measure of success or a status, leave a [GAP: ...]; mark an inference only where the stated evidence clearly implies it (general practice in Line 242's limitations aside). Never make it up to fill the shape.
- Most sentences should be stated. When in doubt, leave a gap.
- A fact the evidence states takes no marker. Leave out a detail the argument does not need rather than infer it: an [INFERRED: ...] marker is for a claim the Line needs.
- One marker for each inferred sentence, right after that sentence, in the same paragraph. Write the marker in plain words, with no square brackets inside it.
- A marker is a note to the writer, like a gap: it may say which part of the evidence the inference rests on, such as the client's answer or a test log. The sentence itself never names a source.
${RULES_NO_NOTES_IN_REPORT_TEXT}
${RULES_STATUS_ONLY_FROM_EVIDENCE}
${RULES_GAPS_NOT_FOR_RECORD_FACTS}
- When you revise text that holds [GAP: ...] or [INFERRED: ...] markers, keep each one with the sentence it belongs to, unless the evidence now states that claim or the writer asks you to remove it.
Good: "Standard setpoint tables did not describe the warehouse's normal operating state. [INFERRED: the source says the tables assume a closed room and that the dock doors stay open for most of a shift]" (a consequence of two stated facts)
Good, where the evidence gives the later work but not what came first: "The first approach was [GAP: what was tried first and why it fell short]. The team then held each sample for an hour before reading it."
Good, where the evidence names no standard approach: "Cold-room controllers commonly hold temperature with a feedback loop tuned for a closed room. [INFERRED: general practice, not in the source: confirm with the client which control methods the team knew of] The warehouse's dock doors stay open for most of a shift, which a loop tuned for a closed room does not allow for." (general practice, marked, then a stated fact about the project as the reason it falls short)
Good, where the evidence names no standard approach and gives no reason it falls short: "Cold-room controllers commonly hold temperature with a feedback loop. [INFERRED: general practice, not in the source: confirm with the client which control methods the team knew of] [GAP: why a standard feedback loop could not hold this warehouse's rooms at their setpoint]"
Bad: "Initial trials showed single readings were unreliable. [INFERRED: the source stresses stability]" (a trial and its result are events the evidence does not describe; the marker does not make them allowed: leave a gap)
Bad: "Readiness was first judged from single readings. [INFERRED: the source asks for stability over time]" (a first approach is an event: a requirement is not a first approach, and the marker does not make it allowed: leave a gap)
Bad: "Trials then indicated that single readings were unreliable." (the evidence describes no trials, and the sentence is written as a stated fact)
Bad: "The client's answer suggests readiness was first judged from single readings." (the sentence names its source, and states a first approach the evidence does not describe)
Bad: "The first trials ran at 40 C. [INFERRED: the source mentions early trials]" (the temperature is a detail of its own: leave a gap for it)
Bad: "No documented method existed for holding a cold room at its setpoint while its doors stay open." (names no standard approach and no reason it falls short: name the standard approach, what it does and why it falls short here)
Bad: "The team first tried the standard setpoint tables. [INFERRED: general practice, not in the source: setpoint tables are the usual method]" (general practice is never something the company tried unless the evidence says so)
Bad: "Standard PID tuning assumes steady loads, and the company's lines switch products hourly. [INFERRED: general practice, not in the source: PID tuning is the usual method]" (a fact about this project inside a general-practice sentence: the marker does not cover it; state it in its own sentence only where the evidence gives it, or leave a gap)
Bad: "Standard feedback loops recover the setpoint after a door opens by raising compressor output until the room is back in range. [INFERRED: general practice, not in the source: the usual recovery method]" (explains how the standard approach would handle the problem, which argues against the uncertainty: name the approach, then give the reason it falls short from the evidence, or one gap asking for it)
Bad: "The team ran the controller with a 30-second step during loading shifts. The materials do not report what these runs showed." (a note to the writer written as a report sentence: write "[GAP: what these runs showed]" in its place)
Bad: "[GAP: the fiscal year, the project's start date and the hours spent]" (the project record and the form's other fields hold these: never ask for them)`;

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

// Verbs that report what a source says. "give" and "found" are left out:
// "the sources gave 5 W each" is about heat or light sources. Greptile round
// (lead decision): "show" reports too, after a document, record, note, log,
// transcript or memo (never after "sources", which may be light sources).
const SAYS =
  "(?:say|says|said|state|states|stated|note|notes|noted|indicate|indicates|indicated|suggest|suggests|suggested|report|reports|reported|record|records|recorded|mention|mentions|mentioned|describe|describes|described|confirm|confirms|confirmed)";
const SAYS_OR_SHOWS = `(?:${SAYS.slice(3, -1)}|show|shows|showed)`;

/**
 * Clear phrases that talk about the sources rather than the work. Each is
 * narrow on purpose: "light source", "heat source", "sources of error",
 * "open-source", "source code", a lowercase "confidence map" (a vision
 * term) and "the brief exposure" never match.
 *
 * Greptile round (lead decision): REPORTING phrases (a source noun with a
 * reporting verb, "according to the ...", "recorded elsewhere" and the
 * interviewee forms) always count, whatever the project's subject; only the
 * MENTION phrases below give way to the subject, and only where it holds the
 * same noun phrase.
 */
const SOURCE_TALK_REPORTING: readonly RegExp[] = [
  /\binterviewees?\b/giu,
  new RegExp(`\\bthe transcripts? ${SAYS_OR_SHOWS}\\b`, "giu"),
  new RegExp(`\\b(?:the (?:[\\p{L}-]+ )?)?memos? ${SAYS_OR_SHOWS}\\b`, "giu"),
  /\b(?:recorded|reported|stated|given|noted|documented|described) elsewhere\b/giu,
  /\baccording to (?:the |an |a |one |each |both |our |their |this |that )?(?:[\p{L}-]+ ){0,2}(?:interviews?|interviewees?|memos?|notes|records?|transcripts?|documents?|documentation|logs?|minutes|sources)\b/giu,
  new RegExp(`\\bthe (?:[\\p{L}-]+ )?(?:documents?|records|notes|logs?) (?:say|says|said|state|states|stated|indicate|indicates|indicated|suggest|suggests|suggested|note|notes|noted|mention|mentions|mentioned|record|records|recorded|report|reports|reported|describe|describes|described|show|shows|showed)\\b`, "giu"),
  /\b(?:the two|the|both|two|all|these|those|other) sources (?:say|said|state|stated|report|reported|indicate|indicated|suggest|suggested|note|noted|mention|mentioned|describe|described)\b/giu,
  /\b(?:one|another|a single|the other|each) source (?:says|said|states|stated|reports|reported|indicates|indicated|suggests|suggested|notes|noted|describes|described)\b/giu,
  // Case matters for the Brief's own names: a lowercase "brief" or
  // "confidence map" is ordinary or technical English.
  /\b[Tt]he (?:Generation )?Brief\b/gu,
  /\bConfidence Maps?\b/gu,
];

/** Plain mentions of a source: the project's own subject may use the same noun phrase. */
const SOURCE_TALK_MENTIONS: readonly RegExp[] = [
  /\b(?:the|an|this|that|each|both|two|these|those|our|their|one|separate|later|earlier) interviews?\b/giu,
  /\binterview (?:transcripts?|notes|records?|recordings?)\b/giu,
  /\b(?:in|from|per|based on) (?:the |an |a |one |each |both |this |that )?transcripts?\b/giu,
  /\b(?:in|from|per|based on) the (?:[\p{L}-]+ ){0,2}memos?\b/giu,
  /\bdepending on (?:the |which )?measurement sources?\b/giu,
  /\b(?:the two|the|both|two|all|these|those|other) sources (?:agree|agreed|disagree|disagreed|differ|differed|conflict|conflicted)\b/giu,
  /\b(?:one|another|a single|the other|each) source (?:puts|put)\b/giu,
  /\bStorylines?\b/gu,
];

/**
 * 2026-09-30 (third, review P2-4): the head nouns of source talk, each with
 * its singular and plural, so a mention gives way to the project's own
 * subject (an interview scheduling product, a speech-to-text engine, credit
 * memos). Re-check: noun forms only, never a verb or an adjective
 * ("documented", "logged"). Greptile round (lead decision): the subject must
 * hold the same noun phrase, the noun with the same modifier, and only a
 * plain mention gives way; a reporting phrase never does.
 */
const SOURCE_HEAD_NOUNS: ReadonlyArray<readonly string[]> = [
  ["interview", "interviews"],
  ["transcript", "transcripts"],
  ["memo", "memos"],
  ["note", "notes"],
  ["record", "records"],
  ["recording", "recordings"],
  ["source", "sources"],
  ["storyline", "storylines"],
];

/** Words before a noun that name no kind of it: the bare noun follows them. */
const NO_MODIFIER = new Set([
  "the", "a", "an", "one", "each", "both", "two", "three", "all", "these", "those", "this", "that",
  "our", "their", "its", "his", "her", "other", "another", "single", "which", "any", "every", "some",
  "to", "on", "of", "per", "and", "or", "in", "from", "by", "for", "with", "at", "into", "after",
  "before", "separate", "later", "earlier", "based", "depending", "is", "are", "was", "were", "be",
]);

/**
 * The noun phrases of the head nouns in some words: each head noun (as its
 * singular) with the word before it as its modifier, or "" when that word
 * names no kind ("the transcript", "two sources"). A head noun followed by
 * "of" ("source of error", "record of each test") is a different phrase and
 * is left out.
 */
function headNounPhrases(words: readonly string[]): string[] {
  const out: string[] = [];
  words.forEach((word, index) => {
    const forms = SOURCE_HEAD_NOUNS.find((candidate) => candidate.includes(word));
    if (!forms) return;
    if (words[index + 1] === "of") return;
    const before = words[index - 1];
    out.push(`${before && !NO_MODIFIER.has(before) ? before : ""} ${forms[0]}`);
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
 * edited terms. A reporting phrase ("The documents say", "according to
 * the minutes", "recorded elsewhere", an interviewee) is always reported. A
 * plain mention ("each interview", "in the transcript", "from the credit
 * memo", "depending on the measurement source") is not reported where the
 * subject holds the same noun phrase, the noun with the same modifier
 * (Greptile round, lead decision). Hits are in text order, one per position.
 */
export function findSourceTalk(
  rawText: string,
  options: { subjectText?: readonly string[] } = {}
): SourceTalkHit[] {
  // 2026-10-29: a [GAP: ...] or [INFERRED: ...] marker is a note to the
  // writer, not report text, so it may name a source (RULES_EVIDENCE_KINDS).
  // Its characters are blanked, so every index still points into the text.
  const text = rawText.replace(NOTE_MARKER_RE, (marker) => " ".repeat(marker.length));
  // Greptile round (lead decision): the noun phrases the project's own
  // subject holds, each the noun with its modifier.
  const subjectPhrases = new Set(
    (options.subjectText ?? []).flatMap((subject) => headNounPhrases(wordsOf(subject)))
  );
  const hits: SourceTalkHit[] = [];
  const scan = (patterns: readonly RegExp[], mention: boolean) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const phrase = match[0];
        if (mention) {
          // The mention's own head noun phrase, the last one it holds.
          const phrases = headNounPhrases(wordsOf(phrase));
          const own = phrases[phrases.length - 1];
          if (own !== undefined && subjectPhrases.has(own)) continue;
        }
        const start = Math.max(0, match.index - 30);
        const end = Math.min(text.length, match.index + phrase.length + 30);
        hits.push({
          phrase,
          index: match.index,
          context: "..." + rawText.slice(start, end).replace(/\r?\n/g, " ") + "...",
        });
      }
    }
  };
  scan(SOURCE_TALK_REPORTING, false);
  scan(SOURCE_TALK_MENTIONS, true);
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
