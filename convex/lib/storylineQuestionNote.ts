/**
 * The Compliance Note row for a Storyline question the Summary Self-check
 * withheld because a field was clipped (2026-09-25, fix/storyline-clip).
 *
 * Writers read the row, so it says what happened in plain words; the field
 * and byte detail stays in the Self-check summary (`storylineQuestionWithheld`)
 * and the generation log. It is a note about the Brief, not a prose defect,
 * so report chat does not list it as a Rule Deviation.
 */
export const STORYLINE_QUESTION_WITHHELD_REASON =
  "Storyline question not offered: its text was too long to show in full, so it can't replace the Storyline.";

/** Rows stored before the plain wording carried the byte detail. */
const LEGACY_WITHHELD_PREFIX = "Storyline question withheld (";

export function isWithheldStorylineQuestionNote(note: {
  instruction: string;
  reason: string;
}): boolean {
  return (
    note.instruction === "Storyline" &&
    (note.reason === STORYLINE_QUESTION_WITHHELD_REASON ||
      note.reason.startsWith(LEGACY_WITHHELD_PREFIX))
  );
}
