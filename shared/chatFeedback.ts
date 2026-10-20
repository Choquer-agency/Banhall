/**
 * Report chat answer feedback (chat parity Phase C, W3, 2026-10-20). A vote
 * can be changed; a thumbs down may carry one reason from this fixed list
 * plus optional text. Shared by the client and Convex so the labels, codes
 * and the text limit cannot drift.
 */

export const CHAT_FEEDBACK_REASONS = [
  { code: "wrong", label: "Wrong" },
  { code: "ignored_request", label: "Didn't follow my request" },
  { code: "made_up", label: "Made something up" },
  { code: "too_long", label: "Too long" },
  { code: "other", label: "Other" },
] as const;

export type ChatFeedbackReasonCode = (typeof CHAT_FEEDBACK_REASONS)[number]["code"];

/** The writer's optional words with a reason. */
export const MAX_CHAT_FEEDBACK_REASON_CHARS = 500;

export function chatFeedbackReasonLabel(code: ChatFeedbackReasonCode): string {
  return CHAT_FEEDBACK_REASONS.find((reason) => reason.code === code)?.label ?? "Other";
}
