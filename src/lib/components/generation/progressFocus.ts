/** Focus destination for the generation-progress surface (A7).
 *
 * When an accepted Summary sign-off replaces the Seed surfaces with Seed
 * drafting, neither Seed trigger exists any more; focus moves to the progress
 * heading once it renders, or to the progress region while the exact
 * generation is still loading. Both hosts share these ids. */
export const GENERATION_PROGRESS_REGION_ID = "generation-progress";
export const GENERATION_PROGRESS_HEADING_ID = "generation-progress-heading";

/** Focuses the progress heading, else its region; true when focus landed. */
export function focusGenerationProgress(): boolean {
  const target =
    document.getElementById(GENERATION_PROGRESS_HEADING_ID) ??
    document.getElementById(GENERATION_PROGRESS_REGION_ID);
  if (!(target instanceof HTMLElement)) return false;
  target.focus();
  return document.activeElement === target;
}
