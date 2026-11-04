import { RULES_EVIDENCE_KINDS } from "../shared/humanProse";
import { COMPRESSION_KEEPS_INFERENCES, FACTS_MARKED_INFERENCE } from "./ai/promptDefinitions";
import {
  CHAT_INFERENCE_METER_NOTE,
  CHAT_INFERENCE_NAMING,
  QA_INFERENCE_FAITHFULNESS_CHECK,
  SECTION_EVIDENCE_POINTER,
  SELF_CHECK_INFERENCE_RULE,
  SUMMARY_MARKER_NOT_SOURCE_TALK,
} from "./ai/prompts";

/**
 * 2026-10-29 (owner, "We can include the ... inference marker"): the bytes
 * the inference marker added to requests. Each was appended to a text that
 * was already there, so taking them out gives the request as it was sent
 * before, and pinned request bodies captured before the change still match.
 * The shared writing rules gained one block after GENERAL RULES (every
 * drafting request, its repair, the Assistant and the style preview), a
 * pointer follows each Line's instructions, and QA, the Self-check, the
 * facts check, compression and the Assistant each gained one line.
 */
export const INFERENCE_MARKER_ADDITIONS = {
  rules: `\n\n${RULES_EVIDENCE_KINDS}`,
  pointer: SECTION_EVIDENCE_POINTER,
  qa: QA_INFERENCE_FAITHFULNESS_CHECK,
  selfCheck: SELF_CHECK_INFERENCE_RULE,
  summarySelfCheck: SUMMARY_MARKER_NOT_SOURCE_TALK,
  facts: FACTS_MARKED_INFERENCE,
  compression: COMPRESSION_KEEPS_INFERENCES,
  chatMeter: CHAT_INFERENCE_METER_NOTE,
  chatNaming: CHAT_INFERENCE_NAMING,
} as const;

export type InferenceMarkerAddition = keyof typeof INFERENCE_MARKER_ADDITIONS;
export type InferenceMarkerCounts = Record<InferenceMarkerAddition, number>;

const NONE: InferenceMarkerCounts = {
  rules: 0,
  pointer: 0,
  qa: 0,
  selfCheck: 0,
  summarySelfCheck: 0,
  facts: 0,
  compression: 0,
  chatMeter: 0,
  chatNaming: 0,
};

/**
 * Review round 1 (P3-10): how many times each addition is in one request of
 * each kind. A draft and its repair carry the rules block and the pointer
 * once; a Self-check its line (a Summary one its source-talk note too, and
 * the facts line when it has the facts check); QA and compression one line
 * each; the Assistant the rules block and its two lines; every other request
 * (the analysis, the Brief, Seeds, the consistency pass, the chronology)
 * none.
 */
export const INFERENCE_MARKER_COUNTS = {
  draft: { ...NONE, rules: 1, pointer: 1 },
  selfCheck: { ...NONE, selfCheck: 1 },
  summarySelfCheck: { ...NONE, selfCheck: 1, summarySelfCheck: 1 },
  summarySelfCheckWithFacts: { ...NONE, selfCheck: 1, summarySelfCheck: 1, facts: 1 },
  qa: { ...NONE, qa: 1 },
  compression: { ...NONE, compression: 1 },
  chat: { ...NONE, rules: 1, chatMeter: 1, chatNaming: 1 },
  none: NONE,
} as const satisfies Record<string, InferenceMarkerCounts>;

export type InferenceMarkerStage = keyof typeof INFERENCE_MARKER_COUNTS;

const inJson = (text: string) => JSON.stringify(text).slice(1, -1);
const ADDITIONS = Object.entries(INFERENCE_MARKER_ADDITIONS) as Array<[InferenceMarkerAddition, string]>;

function countsIn(text: string, form: (added: string) => string): InferenceMarkerCounts {
  const counts = { ...NONE };
  for (const [name, added] of ADDITIONS) counts[name] = text.split(form(added)).length - 1;
  return counts;
}

function strip(text: string, stage: InferenceMarkerStage, form: (added: string) => string): string {
  const found = countsIn(text, form);
  const expected = INFERENCE_MARKER_COUNTS[stage];
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new Error(`A ${stage} request holds the inference marker's additions ${JSON.stringify(found)}, not ${JSON.stringify(expected)}`);
  }
  return ADDITIONS.reduce((out, [, added]) => out.split(form(added)).join(""), text);
}

/** How many times each addition is in a request body (JSON text). */
export function inferenceMarkerCounts(body: string): InferenceMarkerCounts {
  return countsIn(body, inJson);
}

/** Plain text (a system prompt) as it was before the inference marker, after checking its counts. */
export function withoutInferenceMarkerText(text: string, stage: InferenceMarkerStage): string {
  return strip(text, stage, (added) => added);
}

/** A request body as JSON text, as it was before the inference marker, after checking its counts. */
export function withoutInferenceMarker(body: string, stage: InferenceMarkerStage): string {
  return strip(body, stage, inJson);
}

/** A parsed request body as it was before the inference marker; the same object when nothing moved. */
export function withoutInferenceMarkerJson<T extends Record<string, unknown>>(json: T, stage: InferenceMarkerStage): T {
  const body = JSON.stringify(json);
  const pinned = withoutInferenceMarker(body, stage);
  return pinned === body ? json : (JSON.parse(pinned) as T);
}
