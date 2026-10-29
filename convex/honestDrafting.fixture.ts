import { GENERAL_FACTUAL_ARGUMENT_RULE } from "../shared/houseRules";
import { PD_SUBSECTIONS } from "../shared/pdSubsections";
import { FACTS_GOAL_AS_RESULT } from "./ai/promptDefinitions";
import {
  ANALYZER_ADVANCEMENTS,
  ANALYZER_HYPOTHESIS_AND_EXPERIMENTS,
  ANALYZER_STATED_CRITICAL_RULE,
  ANALYZER_STATED_RULE,
  CHAT_ADVANCEMENT_STATUS,
  CHAT_EXPERIMENT_ORDER,
  CHAT_HYPOTHESIS_THEN,
  CHAT_STANDARD_APPROACH,
  QA_BECAUSE_SCAN_WORDS,
  QA_EXPERIMENT_ARC_CHECK,
  QA_GAPS_ONCE,
  QA_GOAL_AS_RESULT_CHECK,
  QA_HONEST_GAP_RULE,
  QA_HYPOTHESIS_CHECK,
  QA_SOURCE_EVIDENCE_ITEM,
  QA_SOURCE_FAITHFULNESS,
  QA_STANDARD_APPROACH_CHECK,
  SECTION_242_CAUSE_FIRST,
  SECTION_242_STANDARD_APPROACH_RULES,
  SECTION_244_EXPERIMENT_RULES,
  SECTION_244_HYPOTHESIS_RULES,
  SECTION_244_YEAR_END_CLOSE,
  SECTION_246_ADVANCEMENT_RULES,
  SECTION_246_GOAL_CLOSE,
  SECTION_246_KNOWLEDGE_LEADS,
  SECTION_246_OVERALL_ADVANCEMENT,
  SELF_CHECK_GOAL_AS_RESULT_RULE,
} from "./ai/prompts";
import { QA_REQUEST } from "./ai/qaAgent";

/**
 * 2026-10-29 (third, owner: "Yes relax the rule", and "Sure" to QA reading
 * the source and to merging repeated gaps): the bytes the honest drafting
 * rules moved in requests. Pinned request bodies were captured before them,
 * so each pinned test puts the old texts back (a swap) and takes the added
 * check lines out (an addition), as convex/line242Opening.fixture.ts and
 * convex/inferenceMarker.fixture.ts do. Everything else in each request is
 * then still compared byte for byte.
 *
 * A swap needs no count: a new text where none belongs would put an old
 * text where the pin has none, and fail. An addition is taken out, which
 * could hide one in the wrong request, so each kind of request is checked
 * to hold each addition exactly as often as it should first, as the marker's
 * fixture does. The QA Source Evidence block is cut out whole, since its
 * text is the project's own.
 */

/** The PERSUASIVE ESSAY line every request with the shared writing rules sent before. */
export const PINNED_GENERAL_PERSUASIVE_RULE =
  "- This is a PERSUASIVE ESSAY to convince a CRA auditor. Every sentence must serve the SR&ED argument.";

export const PINNED_ANALYZER_STATED_RULE =
  "Be thorough but precise; only extract information that is actually stated or strongly implied in the transcript.";
export const PINNED_ANALYZER_HYPOTHESIS_AND_EXPERIMENTS = `   - hypothesis: What they hypothesized would work, in if/then format.
   - experiments_iterations: Array of specific experiments or iterations, each with: problem_addressed, approach, results, conclusions.`;
export const PINNED_ANALYZER_ADVANCEMENTS =
  "9. **advancements_achieved**: What new knowledge was gained. What conceptual understanding was developed.";
export const PINNED_ANALYZER_STATED_CRITICAL_RULE =
  "- ONLY extract information actually stated or strongly implied in the transcript. NEVER fabricate or infer technical details not present.";

export const PINNED_SECTION_242_LIMITATIONS = `GOOD: "The knowledge required to visually distinguish between morphologically similar ornamental species during early developmental stages was insufficient, as no documented methods or training data existed for multi-species ornamental growth stage classification in controlled greenhouse environments."
(This describes a knowledge gap; what the field doesn't know how to do.)

Every limitation must reference the knowledge gap, not the tool gap. Use phrases like:
- "The knowledge required to [X] was insufficient..."
- "No documented methods existed for..."
- "Existing understanding of [X] did not account for..."
- "The scientific basis for [X] had not been established..."

WRONG: "Existing PG rated windows max out at PG45."
RIGHT: "The engineering knowledge required to design window systems capable of exceeding PG45 performance thresholds was insufficient, as conventional frame design methodologies, glass-to-frame thermal break calculations, and structural load distribution models did not account for the combined stress factors present at higher performance grades."`;

export const PINNED_SECTION_244_HYPOTHESIS = `The hypothesis MUST be specific, testable, and measurable. It must follow strict if/then structure where both clauses contain technical specifics.

BAD (vague project plan dressed as a hypothesis):
"It was hypothesized that if the company could capture consistent images and train models on controlled data, then they would achieve automatic classification of growth stages."

GOOD (specific, testable, measurable):
"It was hypothesized that if temporal dual-spectrum image sequences were combined with correlated environmental sensor data from controlled multi-species experiments, then computer vision models could classify ornamental plant growth stages with accuracy exceeding manual assessment methods and predict developmental timelines within a commercially viable forecasting window across morphologically diverse species."

Rules for the hypothesis:
- The IF clause must name the specific technical approach, method, or experimental condition (not just "if we do the work" or "if the company could build the system")
- The THEN clause MUST contain at least one concrete, measurable outcome; a metric, threshold, comparison baseline, or quantifiable performance target. Examples: "accuracy exceeding X%", "prediction within Y timeframe", "classification error below Z", "performance surpassing manual methods by [specific measure]"
- The hypothesis MUST be falsifiable; a reader should be able to imagine a specific experimental result that would disprove it
- Never write "if the company could [do their project plan]"; that's a project description, not a hypothesis
- TEST: Cover the IF clause and read only the THEN clause. If it says "then it would work" or "then the system would function as intended", the hypothesis is too vague. The THEN clause must specify WHAT specifically would be true and HOW you would measure it
- TEST: Could a graduate student design an experiment to test this hypothesis? If not, it needs more specificity`;

export const PINNED_SECTION_244_EXPERIMENTS = `**EXPERIMENTATION/ITERATIONS:**
Write one experimentation paragraph per distinct experiment or iteration the source material supports; consolidate closely related work. Each experimentation paragraph must follow this internal structure:
1. PROBLEM STATEMENT (1 sentence): What specific uncertainty is being addressed?
2. INITIAL APPROACH (1-2 sentences): What was tried first?
3. WHAT WENT WRONG OR WAS LEARNED (1-2 sentences): What happened? What was the unexpected finding?
4. REVISED APPROACH (1-2 sentences): How was the approach modified based on findings?
5. CONCLUSION (1 sentence): What knowledge was gained?

This creates a tight narrative arc: tried X → discovered Y → adapted to Z → learned W. Do NOT write experimentation paragraphs as flat descriptions of what was done. They must have tension; the uncertainty, the attempt, the surprise or failure, the adaptation, the learning. This is what makes SR&ED reports persuasive.

SELF-CHECK FOR EACH EXPERIMENTATION PARAGRAPH: After writing it, verify it contains ALL five elements (problem, initial approach, unexpected finding, revised approach, conclusion). If any element is missing, the paragraph reads like a project log entry rather than SR&ED evidence. The "unexpected finding" is the most commonly missing element; if you didn't describe something that surprised the team or forced a change in approach, the paragraph will be flagged by QA.`;

export const PINNED_SECTION_246_KNOWLEDGE_LEADS = `"It was determined that...", "Through this investigation, it was established that...", "The experimental work revealed that..."`;

export const PINNED_SECTION_246_OVERALL = `**ADVANCEMENT TO SCIENCE/TECHNOLOGY:**
Open the line by restating the technological objective and to what extent it was achieved. State whether the hypothesis was proven, disproven, or partially proven; and be specific about which parts. This opening should read like a thesis conclusion: here's what we set out to learn, here's what we learned, here's how reality differed from our expectations. This ties back directly to Section 242.`;

export const PINNED_SECTION_246_STRUCTURE = `The structure of every advancement paragraph should be:
1. "It was determined that..." or "Through this investigation, it was established that..." (THE KNOWLEDGE)
2. "This resolved the uncertainty regarding..." (TIE BACK TO 242)
3. "This knowledge was applied to..." or "Based on this understanding..." (THE APPLICATION)

BAD (leads with capability):
"The resulting computer vision system achieved 85% accuracy in growth stage classification for the top 30 species."

GOOD (leads with knowledge):
"Through this investigation, it was established that temporal dual-spectrum analysis methods combined with recurrent neural network architectures can achieve growth stage classification accuracy exceeding manual assessment for high-volume ornamental species in multi-species nursery environments. This knowledge was validated through a prototype system that demonstrated 85% accuracy across the top 30 species representing 80% of production volume."`;

export const PINNED_SECTION_246_GOAL_CLOSE = `This closing content is the only place in 246 where you lead with the physical outcome. Connect the knowledge gained back to the original project goal stated in 242 (its goal/problem content). Describe how the advancement improved the product/process. This should feel like the report coming full circle; the close of 246 echoes the project goal in 242.`;

export const PINNED_QA_HYPOTHESIS = `- Does the IF clause name a specific technical approach? (Not just "if we do the work")
- Does the THEN clause name a measurable outcome? (Not just "then it would work")
- Is the hypothesis falsifiable?`;

export const PINNED_QA_EXPERIMENT_ARC = `- Does each experimentation paragraph contain: a problem statement, an initial approach, an unexpected finding or failure, a revised approach, and a conclusion?
- If any experimentation paragraph is a flat description without tension or adaptation, flag it.`;

export const PINNED_QA_LIMITATIONS = `- IMPORTANT CLARIFICATION on knowledge vs product limitations: Phrases like "no documented methods existed for X", "no established approaches for X", "the knowledge required to X was insufficient", "the scientific basis for X had not been established" are ALL knowledge limitation language; they describe gaps in the field's understanding. A product limitation would be "the existing software could not do X" or "the tool failed to perform X"; it describes a specific product failing, not a gap in knowledge. Do NOT flag knowledge-gap language as product limitations.`;

const PINNED_OBJECTIVES = {
  hypothesis:
    "State a specific, testable, and measurable hypothesis in if/then form, in under 20 words: the change and its measured outcome. Put any reason or test method in the Seed's second bullet.",
  experimentation:
    "Describe each supported experiment or iteration as a problem, attempt, finding, adaptation, and conclusion.",
  specific_advancements: "State the technological knowledge gained for each resolved uncertainty.",
} as const;

function objectiveOf(roleId: keyof typeof PINNED_OBJECTIVES): string {
  const role = PD_SUBSECTIONS.find((row) => row.roleId === roleId);
  if (!role) throw new Error(`No role ${roleId}`);
  return role.objective;
}

/** Each changed text, as sent now and as sent before ("" for a text it added inside another). */
export const HONEST_DRAFTING_SWAPS: ReadonlyArray<readonly [now: string, before: string]> = [
  [GENERAL_FACTUAL_ARGUMENT_RULE, PINNED_GENERAL_PERSUASIVE_RULE],
  [ANALYZER_STATED_RULE, PINNED_ANALYZER_STATED_RULE],
  [ANALYZER_HYPOTHESIS_AND_EXPERIMENTS, PINNED_ANALYZER_HYPOTHESIS_AND_EXPERIMENTS],
  [ANALYZER_ADVANCEMENTS, PINNED_ANALYZER_ADVANCEMENTS],
  [ANALYZER_STATED_CRITICAL_RULE, PINNED_ANALYZER_STATED_CRITICAL_RULE],
  [SECTION_242_STANDARD_APPROACH_RULES, PINNED_SECTION_242_LIMITATIONS],
  [SECTION_242_CAUSE_FIRST, ""],
  [SECTION_244_HYPOTHESIS_RULES, PINNED_SECTION_244_HYPOTHESIS],
  ["[the expected outcome, or the knowledge sought]", "[specific measurable outcome related to the technological advancement]"],
  [SECTION_244_EXPERIMENT_RULES, PINNED_SECTION_244_EXPERIMENTS],
  [`\n\n${SECTION_244_YEAR_END_CLOSE}`, ""],
  [SECTION_246_KNOWLEDGE_LEADS, PINNED_SECTION_246_KNOWLEDGE_LEADS],
  [SECTION_246_OVERALL_ADVANCEMENT, PINNED_SECTION_246_OVERALL],
  ["(one paragraph per uncertainty from 242):**", "(one paragraph per resolved uncertainty):**"],
  [SECTION_246_ADVANCEMENT_RULES, PINNED_SECTION_246_STRUCTURE],
  ["one per uncertainty it supports, never padded", "one per advancement it supports, never padded"],
  [SECTION_246_GOAL_CLOSE, PINNED_SECTION_246_GOAL_CLOSE],
  [QA_HYPOTHESIS_CHECK, PINNED_QA_HYPOTHESIS],
  [QA_EXPERIMENT_ARC_CHECK, PINNED_QA_EXPERIMENT_ARC],
  [QA_STANDARD_APPROACH_CHECK, PINNED_QA_LIMITATIONS],
  [QA_BECAUSE_SCAN_WORDS, 'for the literal word "because" after'],
  [QA_SOURCE_FAITHFULNESS, "- Are there any claims not traceable to the transcript analysis?"],
  [CHAT_STANDARD_APPROACH, ""],
  [CHAT_HYPOTHESIS_THEN, "with a measurable then-clause"],
  [CHAT_EXPERIMENT_ORDER, "(one per experiment: problem → approach → result/learning → revised approach → conclusion)"],
  [CHAT_ADVANCEMENT_STATUS, "one per resolved uncertainty"],
  ["the specific technological advancements (one per uncertainty)", "the specific technological advancements (one per resolved uncertainty)"],
  ["the specific advancements (one per uncertainty)", "the specific advancements (one per resolved uncertainty)"],
  [objectiveOf("hypothesis"), PINNED_OBJECTIVES.hypothesis],
  [objectiveOf("experimentation"), PINNED_OBJECTIVES.experimentation],
  [objectiveOf("specific_advancements"), PINNED_OBJECTIVES.specific_advancements],
];

/** Each check line added to an existing text, taken out again after its count is checked. */
export const HONEST_DRAFTING_ADDITIONS = {
  selfCheck: SELF_CHECK_GOAL_AS_RESULT_RULE,
  facts: FACTS_GOAL_AS_RESULT,
  qaGoal: QA_GOAL_AS_RESULT_CHECK,
  qaHonestGap: QA_HONEST_GAP_RULE,
  qaSourceItem: QA_SOURCE_EVIDENCE_ITEM,
  qaGapsOnce: QA_GAPS_ONCE,
} as const;

type AdditionName = keyof typeof HONEST_DRAFTING_ADDITIONS;
export type HonestDraftingCounts = Record<AdditionName, number>;

const NONE: HonestDraftingCounts = {
  selfCheck: 0,
  facts: 0,
  qaGoal: 0,
  qaHonestGap: 0,
  qaSourceItem: 0,
  qaGapsOnce: 0,
};

/**
 * How many times each addition is in one request of each kind. The stage
 * names are the inference marker's (convex/inferenceMarker.fixture.ts),
 * plus the analysis, which holds swaps only.
 */
export const HONEST_DRAFTING_COUNTS = {
  draft: NONE,
  selfCheck: { ...NONE, selfCheck: 1 },
  summarySelfCheck: { ...NONE, selfCheck: 1 },
  summarySelfCheckWithFacts: { ...NONE, selfCheck: 1, facts: 1 },
  qa: { ...NONE, qaGoal: 1, qaHonestGap: 1, qaSourceItem: 1, qaGapsOnce: 1 },
  compression: NONE,
  chat: NONE,
  analysis: NONE,
  none: NONE,
} as const satisfies Record<string, HonestDraftingCounts>;

export type HonestDraftingStage = keyof typeof HONEST_DRAFTING_COUNTS;

const inJson = (text: string) => JSON.stringify(text).slice(1, -1);
const ADDITIONS = Object.entries(HONEST_DRAFTING_ADDITIONS) as Array<[AdditionName, string]>;

function countsIn(text: string, form: (text: string) => string): HonestDraftingCounts {
  const counts = { ...NONE };
  for (const [name, added] of ADDITIONS) counts[name] = text.split(form(added)).length - 1;
  return counts;
}

/** Cut QA's Source Evidence block out: it runs from its heading to the analysis heading. */
function withoutSourceEvidence(text: string, form: (text: string) => string): string {
  const heading = form(QA_REQUEST.sourceScaffold.heading);
  const next = form(QA_REQUEST.userScaffold.analysisHeading);
  const start = text.indexOf(heading);
  if (start < 0) return text;
  const end = text.indexOf(next, start);
  if (end < 0) throw new Error("A Source Evidence block with no analysis after it");
  return `${text.slice(0, start)}${text.slice(end)}`;
}

function restore(text: string, stage: HonestDraftingStage, form: (text: string) => string): string {
  const found = countsIn(text, form);
  const expected = HONEST_DRAFTING_COUNTS[stage];
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new Error(`A ${stage} request holds the honest drafting additions ${JSON.stringify(found)}, not ${JSON.stringify(expected)}`);
  }
  const cut = ADDITIONS.reduce((out, [, added]) => out.split(form(added)).join(""), withoutSourceEvidence(text, form));
  return HONEST_DRAFTING_SWAPS.reduce((out, [now, before]) => out.split(form(now)).join(form(before)), cut);
}

/** How many times each addition is in a request body (JSON text). */
export function honestDraftingCounts(body: string): HonestDraftingCounts {
  return countsIn(body, inJson);
}

/** Plain text (a system prompt) as it was before the honest drafting rules, after checking its counts. */
export function withoutHonestDraftingText(text: string, stage: HonestDraftingStage): string {
  return restore(text, stage, (part) => part);
}

/** A request body as JSON text, as it was before the honest drafting rules, after checking its counts. */
export function withoutHonestDrafting(body: string, stage: HonestDraftingStage): string {
  return restore(body, stage, inJson);
}

/** A parsed request body as it was before the honest drafting rules; the same object when nothing moved. */
export function withoutHonestDraftingJson<T extends Record<string, unknown>>(json: T, stage: HonestDraftingStage): T {
  const body = JSON.stringify(json);
  const pinned = withoutHonestDrafting(body, stage);
  return pinned === body ? json : (JSON.parse(pinned) as T);
}
