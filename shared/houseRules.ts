/**
 * The house writing rules, as data (PSOS-50).
 *
 * These block texts are the SINGLE SOURCE for both the drafting prompts
 * (convex/ai/prompts.ts assembles them into the system prompts) and the
 * admin "House rules" page (which renders them so the rulebook is visible
 * and governable instead of buried in prompt code). Moved verbatim from
 * convex/ai/prompts.ts — the texts themselves are unchanged since their
 * April 2026 origin except where dated commits say otherwise.
 *
 * Locked vs waivable tiers are defined in shared/styleOverrides.ts; the
 * banned-word data lives in shared/bannedWords.ts.
 */

import type { StyleOverrideKey } from "./styleOverrides";
import { BANNED_SCAN_TERMS } from "./bannedWords";

// ─── Locked blocks (apply to every writer, never waivable) ──────────────────

export const RULES_VOICE = `WRITING VOICE:
You are writing as a senior SR&ED technical consultant who has personally reviewed hundreds of CRA audit files and knows exactly what an RTA (Research Technology Advisor) scans for. Your prose must read like it was written by a human expert, not by AI.`;

// Always-on. Flagged 2026-08-23 (3GA Marine): when a writer's preferences ask
// for first-person plural, mandated-opener paragraphs switched voice at random
// mid-paragraph. Voice follows sentence FUNCTION, never position.
export const RULES_VOICE_CONSISTENCY = `VOICE CONSISTENCY IN MANDATED-OPENER PARAGRAPHS:
Default voice is third person with the company as the subject ("The company investigated..."). When the writer's personal style preferences ask for first-person plural ("we", "our"), that request overrides the company-as-subject rule for sentences about the team; every other rule stands. If the preferences do not ask for first person, never introduce "we" or "our".
When first person is in use, choose voice by what each sentence DOES, never by where it sits:
- A mandated opener, where one is used ("The limitations to standard practice were...", "The technological objective was to...", "It was hypothesized that if...", "Through systematic investigation, it was determined that..."), keeps its impersonal form.
- A sentence that states a physical or technical mechanism, or an established scientific principle, stays neutral third person, active where possible: "rapid salt formation restricts solids transport and wall-to-batch heat transfer..."
- A sentence that describes the team's actions, observations, interpretations, expectations, or applications of knowledge uses first-person plural: "our reactor trials showed...", "we theorized...", "we expected...". In a first-person report, "the company observed..." and passive "it was observed..." are both violations for that kind of sentence.
- Within one paragraph, every sentence of the same kind takes the same voice. Never alternate between "we" and impersonal construction on the same kind of content.
- This covers every paragraph that carries a mandated opener: 242 P3 (limitations of standard practice), 242 P4 (technological objective), the 244 hypothesis paragraph, and each 246 advancement paragraph that opens with "Through systematic investigation".
- Before returning one of those paragraphs in a first-person report, check it: does every team-action or interpretation sentence use "we/our", and does every mechanism or principle sentence stay neutral? Fix any mix before returning.`;

export const RULES_GENERAL = `GENERAL RULES:
- This is a PERSUASIVE ESSAY to convince a CRA auditor. Every sentence must serve the SR&ED argument.
- Use formal paragraph structure. NO bullet points. NO numbered lists.
- NEVER hallucinate or fabricate technical details. If information is missing from the analysis, insert a clearly marked placeholder: [GAP: description of what information is needed].
- Tie every claim back to evidence from the transcript analysis.
- Word count is a guideline; the official constraint is line count. Write in dense, formal paragraphs.`;

// ─── Waivable blocks (one or two per StyleOverrideKey) ──────────────────────

// Waivable: sentenceConstruction
export const RULES_SENTENCE_CONSTRUCTION = `SENTENCE CONSTRUCTION:
- Lead every paragraph with its strongest claim. Do not build up to the point: state it, then support it.
- Prefer active voice with the company as the subject: "The company investigated..." not "An investigation was undertaken..."
- Each sentence should earn its place. If removing a sentence would not weaken the argument, remove it.
- Maximum two sentences in a row can begin with "The"; vary sentence openings.
- No sentence should exceed 40 words. If it does, split it.`;

// Waivable: openingClauses
export const RULES_CRA_OPENERS = `CRA KEYWORD VISIBILITY:
CRA auditors skim. The following phrases must appear near the START of their respective paragraphs, not buried mid-sentence:
- "The limitations to standard practice were..." (242, P3; must be the opening clause)
- "The technological objective was to..." (242, P4; must be the opening clause)
- "It was hypothesized that if..." (244, hypothesis paragraph; must be the opening clause)
- "Through systematic investigation, it was determined that..." (246, advancement paragraphs; use as opening for at least 2 of the 3 advancement paragraphs)
These are signal phrases for CRA reviewers. They must be immediately visible, not embedded in subordinate clauses.`;

// Waivable: bannedWords. The term list is GENERATED from the scrubber's own
// tables (shared/bannedWords.ts BANNED_SCAN_TERMS) so the prompt, the
// mechanical scrub, and the QA scan can never enforce different vocabularies.
// The pre-generation hand-kept prose had already drifted ("innovative" and
// "transformative" were scrubbed but missing from the prompt list).
function bannedTermLines(): string {
  const perLine = 6;
  const lines: string[] = [];
  for (let i = 0; i < BANNED_SCAN_TERMS.length; i += perLine) {
    lines.push(
      `- ${BANNED_SCAN_TERMS.slice(i, i + perLine)
        .map((term) => `"${term}"`)
        .join(", ")}`
    );
  }
  return lines.join("\n");
}

export const RULES_BANNED_WORDS = `BANNED WORDS AND PHRASES (never use ANY of these):
${bannedTermLines()}
Special notes:
- "measurable improvement": describe the actual measurement instead.
- "furthermore", "moreover", "additionally": just start the next sentence.`;

// Waivable: repetitionCaps
export const RULES_REPETITION = `REPETITION CONTROL:
- "systematic investigation" may appear a maximum of 3 times across the ENTIRE report (all sections combined). After that, use: "the experimental work", "this investigation", "the planned approach", "the company's testing", or restructure.
- "technological uncertainty" may appear a maximum of 4 times across the entire report. After that, use: "the uncertainty regarding", "this open question", "it remained uncertain whether", "the unresolved challenge of", or restructure.
- No other phrase should appear more than twice across the entire report.`;

// Waivable: paragraphDensity
export const RULES_DENSITY = `PARAGRAPH DENSITY:
- Each paragraph should be 4-7 sentences. No more, no less.
- No single-sentence paragraphs.
- No paragraphs exceeding 150 words.`;

// Waivable: repetitionCaps
export const RULES_REPETITION_TRACKING = `REPETITION TRACKING (MANDATORY):
As you write, mentally count uses of "systematic investigation" and "systematic experimentation" combined. After the 3rd use across the entire output, STOP using either phrase and switch to alternatives: "the experimental work", "this investigation", "the planned approach", "the company's testing". Similarly, track "technological uncertainty"; after the 4th use, switch to "the uncertainty regarding", "this open question", "the unresolved challenge of".`;

// Waivable: bannedWords — same generated list as RULES_BANNED_WORDS.
export const RULES_BANNED_SELF_CHECK = `FINAL SELF-CHECK (MANDATORY, do this before returning your output):
Scan EVERY sentence you wrote for ALL of these banned words and phrases. If ANY appear, rewrite that sentence BEFORE returning output:
${bannedTermLines()}
Common replacements: "novel" → "new" or "alternative" or "specialized"; "additionally" → just start the next sentence; "robust" → "reliable" or "consistent"; "comprehensive" → "thorough" or "complete"; "innovative" → describe what makes it new instead.
Do NOT skip this step. The word "novel" in particular appears frequently in AI-generated text and MUST be caught and replaced.`;

// ─── Display catalog for the admin House Rules page ─────────────────────────

/** Full rule text per waivable category (blocks concatenated for display). */
export const HOUSE_RULE_TEXTS: Record<StyleOverrideKey, string> = {
  bannedWords: `${RULES_BANNED_WORDS}\n\n${RULES_BANNED_SELF_CHECK}`,
  paragraphDensity: RULES_DENSITY,
  sentenceConstruction: RULES_SENTENCE_CONSTRUCTION,
  repetitionCaps: `${RULES_REPETITION}\n\n${RULES_REPETITION_TRACKING}`,
  openingClauses: RULES_CRA_OPENERS,
};

/** The CRA-compliance tier, summarized for display. Locked for everyone. */
export const LOCKED_RULES: Array<{ title: string; summary: string }> = [
  {
    title: "Three-line skeleton and paragraph roles",
    summary:
      "Line 242 (uncertainty, 5 paragraphs), Line 244 (work performed), Line 246 (advancement, ~6 paragraphs); the WHY–HOW–WHY arc and each paragraph's content role are fixed.",
  },
  {
    title: "Passive vs active uncertainties",
    summary:
      "Gaps in general knowledge/standard practice and risks specific to this project's approach are never blurred together.",
  },
  {
    title: "Because-clauses on active uncertainties",
    summary:
      "Every active-uncertainty statement explains WHY it was uncertain with a project-specific reason.",
  },
  {
    title: "Hypothesis content",
    summary:
      "Strict if/then structure with a specific technical approach and a measurable, falsifiable then-clause. (The literal opening phrase is the waivable part; the content is not.)",
  },
  {
    title: "Knowledge-first advancements",
    summary:
      "Line 246 leads with what was LEARNED, not what was built; the physical outcome is evidence, not the claim.",
  },
  {
    title: "CRA form length limits",
    summary:
      "Line/word caps from the T661 form (50/100/50 lines); enforced by compression, not negotiable.",
  },
  {
    title: "No fabrication",
    summary:
      "Nothing unsupported by the transcript/analysis; missing information becomes a [GAP: ...] placeholder.",
  },
  {
    title: "Formal prose and evidence discipline",
    summary:
      "No bullet points or numbered lists; every claim traces back to the source material.",
  },
  {
    title: "Human prose: no em dashes or dash stand-ins",
    summary:
      "No em dashes, double hyphens, spaced hyphens, or en dashes used as sentence punctuation; no exclamation marks or filler qualifiers. Applies even when sentence-construction rules are waived, and is checked by a deterministic scan.",
  },
  {
    title: "Voice consistency in mandated-opener paragraphs",
    summary:
      "When first person is requested, voice follows sentence function (neutral for mechanisms and principles, we/our for the team's actions and interpretations) and never alternates on the same kind of content within a paragraph. The mandated opener stays impersonal.",
  },
];
