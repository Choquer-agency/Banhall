import type { StyleOverrideKey } from "../../../shared/styleOverrides";

/**
 * Round 2 (I2) names for the six waivable house-style areas on Writing
 * preferences. UI only: the admin pages keep STYLE_OVERRIDE_META.
 */
export const WRITING_AREAS: ReadonlyArray<{ key: StyleOverrideKey; label: string; description: string }> = [
  { key: "bannedWords", label: "Word list", description: "Your words, not the house list" },
  { key: "sentenceConstruction", label: "Sentence length", description: "Your sentence length" },
  { key: "reportSkeleton", label: "Section structure", description: "Your order inside each line" },
  { key: "paragraphDensity", label: "Paragraph length", description: "Your paragraph length" },
  { key: "repetitionCaps", label: "Repeated phrases", description: "Limits on repeated CRA phrases" },
  { key: "openingClauses", label: "Opening phrases", description: "CRA signal phrases at the start" },
];

export const WRITING_AREA_COUNT = WRITING_AREAS.length;

export function writingAreaLabel(key: StyleOverrideKey): string {
  return WRITING_AREAS.find((area) => area.key === key)?.label ?? key;
}

/** "Your preferences cover 3 of 6 areas", or the zero case. */
export function coverageHeading(covered: number): string {
  return covered === 0
    ? "Your preferences do not cover any area yet"
    : `Your preferences cover ${covered} of ${WRITING_AREA_COUNT} areas`;
}

/** The first 200 characters, cut at a word, with an ellipsis when cut. */
export function instructionsExcerpt(text: string, max = 200): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}...`;
}
