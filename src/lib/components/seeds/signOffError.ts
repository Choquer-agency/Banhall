import { userErrorMessage, userErrorReason } from "$lib/errors";
import { PD_SECTION_TITLES } from "./sectionTitles";

/**
 * Limits (convex/lib/seedRevisions.ts SeedContextLimitError) a writer can get
 * under by unticking picks in one Section's steps.
 */
const PICK_LIMITS: ReadonlySet<string> = new Set([
  "summary_self_check_response_utf8_bytes",
  "summary_self_check_plan_count",
  "summary_plan_check_input_utf8_bytes",
]);

function errorData(error: unknown): Record<string, unknown> | null {
  if (typeof error !== "object" || error === null) return null;
  const data = (error as { data?: unknown }).data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
}

/**
 * 2026-10-22 (alerts triage): a sign-off refused because the Summary is
 * larger than its final check can read at once (SUMMARY_CAPACITY_EXCEEDED)
 * says, in plain words, what the writer can shorten. The server's own
 * message names a byte limit and is not shown.
 */
export function signOffErrorMessage(error: unknown): string {
  if (userErrorReason(error) !== "SUMMARY_CAPACITY_EXCEEDED") {
    return userErrorMessage(error, "The Summary could not be signed off.");
  }
  const data = errorData(error);
  const limit = typeof data?.limit === "string" ? data.limit : "";
  const section = typeof data?.section === "string" ? data.section : "";
  const kept = "Your picks and edits are kept.";
  if (PICK_LIMITS.has(limit)) {
    const title = PD_SECTION_TITLES[`s${section}` as keyof typeof PD_SECTION_TITLES];
    const where = title ? `Section ${section} (${title})` : "This Summary";
    const steps = title ? "its steps" : "the steps with the most picks";
    return `${where} has more picks than the final check can read at once. Untick a few picks in ${steps}, then sign off again. ${kept}`;
  }
  if (limit === "summary_self_check_ordinary_count") {
    return `This project's Brief has more Confidence Map entries and Glossary Terms than the final check can read at once, so sign-off cannot finish. ${kept} Please report this so we can fix it.`;
  }
  return `The Summary could not be made ready for its final check. ${kept} Please report this so we can fix it.`;
}
