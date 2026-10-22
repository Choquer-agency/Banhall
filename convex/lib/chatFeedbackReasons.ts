import { v } from "convex/values";

/** Chat parity Phase C (W3): the reason codes in `shared/chatFeedback.ts`. */
export const chatFeedbackReasonValidator = v.union(
  v.literal("wrong"),
  v.literal("ignored_request"),
  v.literal("made_up"),
  v.literal("too_long"),
  v.literal("other"),
);
