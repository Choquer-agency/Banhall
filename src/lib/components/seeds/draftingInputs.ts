import type { DraftingInputsFailureCode } from "../../../../convex/lib/draftingInputsFailure";

/**
 * Owner decision 32: the transcript analysis and Brain search run in the
 * background while the writer works the Seeds, and sign-off waits for them.
 * The failure notice the Seed workspace and the Summary both show. A cut-off
 * analysis gets its own message, because the retry asks for a shorter one.
 */
export function draftingInputsFailureMessage(
  code: DraftingInputsFailureCode | undefined,
  canRetry = true
): string {
  // A viewer without edit access gets no "Try again" button, so the notice
  // states what happened without telling them to do something they can't.
  if (!canRetry) {
    return code === "output_limit"
      ? "The transcript analysis was too long to finish. It needs another try before sign-off."
      : "We couldn't finish reading the transcript for drafting. It needs another try before sign-off.";
  }
  return code === "output_limit"
    ? "The transcript analysis was too long to finish. Your work is saved. Try again to run a shorter analysis before you sign off."
    : "We couldn't finish reading the transcript for drafting. Your work is saved. Try again before you sign off.";
}

/** The Summary bar's one-line status after a failure. */
export const DRAFTING_INPUTS_FAILED_STATUS = "Transcript analysis needs another try";
