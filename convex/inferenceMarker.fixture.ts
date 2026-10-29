import { RULES_EVIDENCE_KINDS } from "../shared/humanProse";
import { COMPRESSION_KEEPS_INFERENCES, FACTS_MARKED_INFERENCE } from "./ai/promptDefinitions";
import {
  CHAT_INFERENCE_METER_NOTE,
  CHAT_INFERENCE_NAMING,
  QA_INFERENCE_FAITHFULNESS_CHECK,
  SELF_CHECK_INFERENCE_RULE,
  SUMMARY_MARKER_NOT_SOURCE_TALK,
} from "./ai/prompts";

/**
 * 2026-10-29 (owner, "We can include the ... inference marker"): the bytes
 * the inference marker added to requests. Each was appended to a text that
 * was already there, so taking them out gives the request as it was sent
 * before, and pinned request bodies captured before the change still match.
 * The shared writing rules gained one block after GENERAL RULES (every
 * drafting request, its repair, the Assistant and the style preview), and
 * QA, the Self-check, the facts check, compression and the Assistant each
 * gained one line.
 */
export const INFERENCE_MARKER_ADDITIONS: readonly string[] = [
  `\n\n${RULES_EVIDENCE_KINDS}`,
  QA_INFERENCE_FAITHFULNESS_CHECK,
  SELF_CHECK_INFERENCE_RULE,
  SUMMARY_MARKER_NOT_SOURCE_TALK,
  FACTS_MARKED_INFERENCE,
  COMPRESSION_KEEPS_INFERENCES,
  CHAT_INFERENCE_METER_NOTE,
  CHAT_INFERENCE_NAMING,
];

const inJson = (text: string) => JSON.stringify(text).slice(1, -1);

/** Plain text (a system prompt) as it was before the inference marker. */
export function withoutInferenceMarkerText(text: string): string {
  return INFERENCE_MARKER_ADDITIONS.reduce((out, added) => out.split(added).join(""), text);
}

/** A request body as JSON text, as it was before the inference marker. */
export function withoutInferenceMarker(body: string): string {
  return INFERENCE_MARKER_ADDITIONS.reduce((out, added) => out.split(inJson(added)).join(""), body);
}

/** A parsed request body as it was before the inference marker; the same object when nothing moved. */
export function withoutInferenceMarkerJson<T extends Record<string, unknown>>(json: T): T {
  const body = JSON.stringify(json);
  const pinned = withoutInferenceMarker(body);
  return pinned === body ? json : (JSON.parse(pinned) as T);
}
