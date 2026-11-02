/** Focus transitions between the Seed surfaces and Summary Review (A7).
 *
 * Entering Summary Review moves focus to its heading; leaving it returns focus
 * to the control the host re-creates: the report shell's Summary tab while
 * seeding, or the "Signed-off Summary" action after completion. Leaving it
 * through a step's "Go to this step" link (2026-11-02) focuses that step's
 * heading once the workspace has drawn it. */
export const SEED_SIGNED_OFF_SUMMARY_TRIGGER_ID = "seed-signed-off-summary-trigger";
export const SEED_SUMMARY_HEADING_ID = "summary-review-title";
/** The report shell's Summary tab while the plan is open. */
export const SEED_SUMMARY_TAB_ID = "seed-summary-tab";
/** The report shell's Plan tab, the last fallback return target. */
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

/** A step pane's heading (SeedSubsectionPane). */
export const seedStepHeadingId = (roleId: string) => `seed-title-${roleId}`;

/**
 * Focuses a step's heading once the workspace has drawn it, checking each
 * frame for up to `frames` frames. `stillOwned` fences the wait to the
 * transition that asked for it; false when no heading took focus.
 */
export async function focusSeedStepHeading(
  roleId: string,
  stillOwned: () => boolean,
  frames = 90
): Promise<boolean> {
  for (let frame = 0; frame < frames; frame += 1) {
    if (!stillOwned()) return false;
    const heading = document.getElementById(seedStepHeadingId(roleId));
    if (heading instanceof HTMLElement) {
      heading.focus();
      if (document.activeElement === heading) return true;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return false;
}
