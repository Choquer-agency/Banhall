export const DEFAULT_MILESTONE_LABELS = [
  "R0 draft",
  "R1 internal review",
  "R2 client send",
  "R3 client edits",
  "R4 final",
] as const;

export type MilestoneSummary = {
  milestoneKey?: string;
};

/**
 * Offer each default workflow milestone once, followed by the next later
 * R-number. Legacy keys with leading zeros are normalized for deduplication.
 */
export function buildMilestoneOptions(
  milestones: ReadonlyArray<MilestoneSummary>
): string[] {
  const usedNumbers = new Set<number>();
  let highestLaterNumber = 4;
  for (const milestone of milestones) {
    const match = /^R(\d+)$/i.exec(milestone.milestoneKey?.trim() ?? "");
    const milestoneNumber = match ? Number(match[1]) : Number.NaN;
    if (Number.isSafeInteger(milestoneNumber)) {
      usedNumbers.add(milestoneNumber);
      if (milestoneNumber >= 5 && milestoneNumber > highestLaterNumber) {
        highestLaterNumber = milestoneNumber;
      }
    }
  }

  const defaults = DEFAULT_MILESTONE_LABELS.filter(
    (_, milestoneNumber) => !usedNumbers.has(milestoneNumber)
  );
  let nextLaterNumber = highestLaterNumber + 1;
  while (usedNumbers.has(nextLaterNumber)) nextLaterNumber += 1;

  return [...defaults, `R${nextLaterNumber} internal review`];
}
