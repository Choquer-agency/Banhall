import {
  STYLE_OVERRIDE_META,
  type StyleOverrideKey,
  type StyleOverrideMeta,
} from "../../../shared/styleOverrides";

export type WritingArea = { key: StyleOverrideKey; label: string } & Pick<
  StyleOverrideMeta,
  "summary" | "houseRule" | "example" | "whenOn"
>;

/** The order the six waivable house-style areas appear in on Writing preferences. */
const WRITING_AREA_ORDER: ReadonlyArray<StyleOverrideKey> = [
  "bannedWords",
  "sentenceConstruction",
  "reportSkeleton",
  "paragraphDensity",
  "repetitionCaps",
  "openingClauses",
];

/**
 * Round 2 (I2) areas on Writing preferences. The copy lives in
 * STYLE_OVERRIDE_META, shared with the admin pages; `label` here is the
 * writer's name for the area (writerLabel).
 */
export const WRITING_AREAS: ReadonlyArray<WritingArea> = WRITING_AREA_ORDER.map((key) => {
  const meta = STYLE_OVERRIDE_META[key];
  return {
    key,
    label: meta.writerLabel,
    summary: meta.summary,
    houseRule: meta.houseRule,
    example: meta.example,
    whenOn: meta.whenOn,
  };
});

export const WRITING_AREA_COUNT = WRITING_AREAS.length;

export function writingAreaLabel(key: StyleOverrideKey): string {
  return WRITING_AREAS.find((area) => area.key === key)?.label ?? key;
}

/**
 * "Your preferences cover 3 of 6 areas", the zero case, or, when saved
 * instructions have no stored check yet, says so instead of claiming zero.
 */
export function coverageHeading(covered: number, checked = true): string {
  if (!checked) return "Your instructions have not been checked yet";
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
