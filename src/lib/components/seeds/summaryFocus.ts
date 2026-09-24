/** Focus transitions between the Seed surfaces and Summary Review (A7).
 *
 * Entering Summary Review moves focus to its heading; leaving it returns focus
 * to whichever trigger the host re-creates: the workspace "Review Summary"
 * action while seeding, or the report's "Signed-off Summary" action after
 * completion. Both hosts share these ids, so the transition is one function. */
export const SEED_REVIEW_SUMMARY_TRIGGER_ID = "seed-review-summary-trigger";
export const SEED_SIGNED_OFF_SUMMARY_TRIGGER_ID = "seed-signed-off-summary-trigger";
export const SEED_SUMMARY_HEADING_ID = "summary-review-title";
/** The report shell's Summary tab while the plan is open. Its own id, so it
 * never collides with the workspace "Review summary" trigger. */
export const SEED_SUMMARY_TAB_ID = "seed-summary-tab";

/** Focuses the recreated return trigger; true when one was found. */
export function focusSummaryReturnTrigger(): boolean {
  const trigger =
    document.getElementById(SEED_REVIEW_SUMMARY_TRIGGER_ID) ??
    document.getElementById(SEED_SIGNED_OFF_SUMMARY_TRIGGER_ID);
  if (!(trigger instanceof HTMLElement)) return false;
  trigger.focus();
  return document.activeElement === trigger;
}

/** Returns focus to the control that opened Summary Review: the Summary tab
 * when the tab opened it, otherwise the recreated trigger. True when focus
 * landed. */
export function focusSummaryOpener(opener: "tab" | "trigger"): boolean {
  if (opener === "tab") {
    const tab =
      document.getElementById(SEED_SUMMARY_TAB_ID) ??
      document.getElementById(SEED_SIGNED_OFF_SUMMARY_TRIGGER_ID);
    if (tab instanceof HTMLElement) {
      tab.focus();
      if (document.activeElement === tab) return true;
    }
  }
  return focusSummaryReturnTrigger();
}
