import { ACRONYM_RULE } from "../shared/humanProse";
import {
  ANALYZER_CHOSEN_UNCERTAINTIES,
  ANALYZER_GAPS_RULES,
  CLAIMANT_LINE,
  QA_NO_NOTES_IN_TEXT,
  SECTION_UNCERTAINTY_SCOPE,
  SELF_CHECK_NO_NOTES_RULE,
  SELF_CHECK_UNCERTAINTY_SCOPE_RULE,
} from "./ai/prompts";
import { SEED_PROMPT_PROGRAM, SELF_CHECK_REQUEST } from "./ai/promptDefinitions";
import { FROZEN_SUMMARY_PLAN_SCAFFOLD } from "./lib/seedRevisions";

/**
 * 2026-10-30 (owner, "please fix all properly"): the bytes this change
 * moved in requests. Pinned request bodies were captured before it, so each
 * pinned test takes the added texts out and puts the old ones back, as
 * convex/inferenceMarker.fixture.ts and convex/honestDrafting.fixture.ts do,
 * and every other byte of each request is still compared.
 *
 * Applied last, after the honest drafting fixture: most texts this change
 * moved sit inside texts that fixture (or the Line 242 opening fixture)
 * already swaps whole for their old wording (Line 242's limitations rule,
 * Line 244's experiments, Line 246's paragraph rules, the analyzer's company
 * line, QA's standard-approach and Line 246 notes, the Assistant's skeleton,
 * RULES_EVIDENCE_KINDS). What is left is listed here:
 *  - one swap: the acronym sentence added to the human prose and Seed
 *    wording rules, in nearly every request;
 *  - additions with fixed text, each counted per kind of request first;
 *  - two blocks whose text is the project's own: the claimant line (the
 *    project record's company name, or its placeholder) and the Self-check's
 *    REPORT UNCERTAINTIES block (the analysis's lists). Each is in a request
 *    at most once, and never in a kind of request that does not send it.
 */

/** Each changed text, as sent now and as sent before ("" for a text added inside another). */
export const ONE_UNCERTAINTY_SWAPS: ReadonlyArray<readonly [now: string, before: string]> = [
  [` ${ACRONYM_RULE}`, ""],
];

/** Each fixed text added to an existing one, taken out again after its count is checked. */
export const ONE_UNCERTAINTY_ADDITIONS = {
  scope: SECTION_UNCERTAINTY_SCOPE,
  analyzerChosen: ANALYZER_CHOSEN_UNCERTAINTIES,
  analyzerGaps: ANALYZER_GAPS_RULES,
  selfCheckScope: SELF_CHECK_UNCERTAINTY_SCOPE_RULE,
  selfCheckNotes: SELF_CHECK_NO_NOTES_RULE,
  qaNotes: QA_NO_NOTES_IN_TEXT,
} as const;

/** The blocks whose text is the project's own: at most one each. */
type BlockName = "claimant" | "reportUncertainties";
type AdditionName = keyof typeof ONE_UNCERTAINTY_ADDITIONS;
export type OneUncertaintyCounts = Record<AdditionName | BlockName, number>;

const NONE: OneUncertaintyCounts = {
  scope: 0,
  analyzerChosen: 0,
  analyzerGaps: 0,
  selfCheckScope: 0,
  selfCheckNotes: 0,
  qaNotes: 0,
  claimant: 0,
  reportUncertainties: 0,
};

/**
 * How many times each addition is in one request of each kind; for the two
 * blocks, the most it may hold. The stage names are the honest drafting
 * fixture's. A draft with a signed-off content plan ("planDraft") and a Seed
 * request ("seed") are told apart by their own text, so callers pass the
 * stages they already pass.
 */
export const ONE_UNCERTAINTY_COUNTS = {
  draft: { ...NONE, scope: 1, claimant: 1 },
  planDraft: { ...NONE, claimant: 1 },
  selfCheck: { ...NONE, selfCheckScope: 1, selfCheckNotes: 1, reportUncertainties: 1 },
  summarySelfCheck: NONE,
  summarySelfCheckWithFacts: NONE,
  qa: { ...NONE, qaNotes: 1, claimant: 1 },
  compression: NONE,
  chat: NONE,
  analysis: { ...NONE, analyzerChosen: 1, analyzerGaps: 1, claimant: 1 },
  seed: { ...NONE, claimant: 1 },
  none: NONE,
} as const satisfies Record<string, OneUncertaintyCounts>;

export type OneUncertaintyStage = keyof typeof ONE_UNCERTAINTY_COUNTS;
type CallerStage = Exclude<OneUncertaintyStage, "planDraft" | "seed">;

const BLOCKS: ReadonlySet<string> = new Set<BlockName>(["claimant", "reportUncertainties"]);
const inJson = (text: string) => JSON.stringify(text).slice(1, -1);
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ADDITIONS = Object.entries(ONE_UNCERTAINTY_ADDITIONS) as Array<[AdditionName, string]>;

/** The claimant line after its blank line, whatever the name (or its placeholder). */
function claimantPattern(form: (text: string) => string): RegExp {
  return new RegExp(
    `${escapeRe(form(`${CLAIMANT_LINE.separator}${CLAIMANT_LINE.prefix}`))}.{1,400}?${escapeRe(form(CLAIMANT_LINE.rule))}`,
    "g"
  );
}

/** The REPORT UNCERTAINTIES block after its blank line. */
function reportUncertaintiesPattern(form: (text: string) => string): RegExp {
  const label = SELF_CHECK_REQUEST.reportUncertainties.blockLabel;
  return new RegExp(
    `${escapeRe(form(`\n\n--- BEGIN [${label}] ---\n`))}[\\s\\S]*?${escapeRe(form(`\n--- END [${label}] ---`))}`,
    "g"
  );
}

/** The kind of request: the caller's stage, refined by the request's own text. */
function refined(text: string, stage: CallerStage, form: (text: string) => string): OneUncertaintyStage {
  if (stage === "draft" && text.includes(form(FROZEN_SUMMARY_PLAN_SCAFFOLD.begin))) return "planDraft";
  if (stage === "none" && text.includes(form(SEED_PROMPT_PROGRAM.user.heading))) return "seed";
  return stage;
}

function countsIn(text: string, form: (text: string) => string): OneUncertaintyCounts {
  const counts = { ...NONE };
  for (const [name, added] of ADDITIONS) counts[name] = text.split(form(added)).length - 1;
  counts.claimant = (text.match(claimantPattern(form)) ?? []).length;
  counts.reportUncertainties = (text.match(reportUncertaintiesPattern(form)) ?? []).length;
  return counts;
}

function restore(text: string, callerStage: CallerStage, form: (text: string) => string): string {
  const stage = refined(text, callerStage, form);
  const found = countsIn(text, form);
  const expected: OneUncertaintyCounts = ONE_UNCERTAINTY_COUNTS[stage];
  const wrong = (Object.keys(expected) as Array<keyof OneUncertaintyCounts>).filter((name) =>
    BLOCKS.has(name) ? found[name] > expected[name] : found[name] !== expected[name]
  );
  if (wrong.length > 0) {
    throw new Error(`A ${stage} request holds the 2026-10-30 additions ${JSON.stringify(found)}, not ${JSON.stringify(expected)}`);
  }
  const cut = ADDITIONS.reduce((out, [, added]) => out.split(form(added)).join(""), text)
    .replace(claimantPattern(form), "")
    .replace(reportUncertaintiesPattern(form), "");
  return ONE_UNCERTAINTY_SWAPS.reduce((out, [now, before]) => out.split(form(now)).join(form(before)), cut);
}

/** How many times each addition is in a request body (JSON text). */
export function oneUncertaintyCounts(body: string): OneUncertaintyCounts {
  return countsIn(body, inJson);
}

/** Plain text (a system prompt) as it was before this change, after checking its counts. */
export function withoutOneUncertaintyText(text: string, stage: CallerStage): string {
  return restore(text, stage, (part) => part);
}

/** A request body as JSON text, as it was before this change, after checking its counts. */
export function withoutOneUncertainty(body: string, stage: CallerStage): string {
  return restore(body, stage, inJson);
}

/** A parsed request body as it was before this change; the same object when nothing moved. */
export function withoutOneUncertaintyJson<T extends Record<string, unknown>>(json: T, stage: CallerStage): T {
  const body = JSON.stringify(json);
  const pinned = withoutOneUncertainty(body, stage);
  return pinned === body ? json : (JSON.parse(pinned) as T);
}
