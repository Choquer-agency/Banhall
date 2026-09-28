/** Focus transitions between the Seed surfaces and Summary Review (A7).
 *
 * Entering Summary Review moves focus to its heading; leaving it returns focus
 * to the control the host re-creates: the report shell's Summary tab while
 * seeding, or the "Signed-off Summary" action after completion. While the
 * Summary is locked again (a step is not done), the Plan tab takes focus. */
export const SEED_SIGNED_OFF_SUMMARY_TRIGGER_ID = "seed-signed-off-summary-trigger";
export const SEED_SUMMARY_HEADING_ID = "summary-review-title";
/** The report shell's Summary tab while the plan is open. */
export const SEED_SUMMARY_TAB_ID = "seed-summary-tab";
/** The report shell's Plan tab, the return target while the Summary is locked. */
export const SEED_PLAN_TAB_ID = "seed-plan-tab";

/** Focuses the recreated return control; true when one took focus. */
export function focusSummaryReturnTrigger(): boolean {
  for (const id of [SEED_SUMMARY_TAB_ID, SEED_SIGNED_OFF_SUMMARY_TRIGGER_ID, SEED_PLAN_TAB_ID]) {
    const control = document.getElementById(id);
    if (!(control instanceof HTMLElement)) continue;
    control.focus();
    if (document.activeElement === control) return true;
  }
  return false;
}
