import { v, type Infer } from "convex/values";

/**
 * Why a background drafting-inputs attempt failed (owner decision 32,
 * 2026-09-25): the normalized provider code, `timed_out` for an attempt
 * whose lease ran out, never provider or model text. `output_limit` is the
 * analyzer answer cut off at its output token limit.
 */
export const DRAFTING_INPUTS_FAILURE_CODES = [
  "output_limit",
  "timed_out",
  "billing",
  "rate_limited",
  "authentication",
  "model_access",
  "network",
  "unknown",
] as const;

export const draftingInputsFailureCodeValidator = v.union(
  ...DRAFTING_INPUTS_FAILURE_CODES.map((code) => v.literal(code))
);

export type DraftingInputsFailureCode = Infer<typeof draftingInputsFailureCodeValidator>;
