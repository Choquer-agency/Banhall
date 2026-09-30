/**
 * Figures with a unit, read from plan wording and drafted text. Pure: no
 * database, no model.
 *
 * 2026-09-30 (first): the release suite's hint named the paragraphs that hold
 * a dropped uncertainty's distinctive figures (scripts/seed-plan-eval).
 * 2026-09-30 (second): moved here so the product uses the same reading. A
 * LEAVE OUT verdict that flags a paragraph holding none of the dropped
 * uncertainty's distinctive figures, and cites only figures the signed-off
 * plan uses, is recorded as a signed-off item (convex/ai/orderedGeneration.ts).
 */

const FIGURE_UNITS: ReadonlyArray<[RegExp, string]> = [
  [/^(?:[°º]\s*c|degrees?\s*c|degrees?|c)$/i, "C"],
  [/^(?:percent|%)$/i, "percent"],
  [/^days?$/i, "days"],
  [/^weeks?$/i, "weeks"],
  [/^months?$/i, "months"],
  [/^years?$/i, "years"],
  [/^hours?$/i, "hours"],
  [/^minutes?$/i, "minutes"],
  [/^seconds?$/i, "seconds"],
  [/^ms$/i, "ms"],
  [/^mg\/l$/i, "mg/L"],
  [/^ppm$/i, "ppm"],
  [/^ppi$/i, "ppi"],
  [/^mm\/s$/i, "mm/s"],
  [/^kg\/s$/i, "kg/s"],
  [/^mm$/i, "mm"],
  [/^cm$/i, "cm"],
  [/^nm$/i, "nm"],
  [/^kg$/i, "kg"],
  [/^kn$/i, "kN"],
  [/^n$/i, "N"],
  [/^kpa$/i, "kPa"],
  [/^mpa$/i, "MPa"],
  [/^psi$/i, "psi"],
  [/^rpm$/i, "rpm"],
];

/**
 * A number, or a list or range of numbers ("44 and 29", "36 to 40", "19 vs
 * 6", "6-12"), then a unit. A unit is never the start of a longer word.
 * Units are case-sensitive where a letter alone would read as a word ("N"
 * is a force, "n" is not).
 */
const FIGURE = /((?:\d+(?:\.\d+)?\s*(?:,|and|or|to|-|vs\.?|versus)\s*)*)(\d+(?:\.\d+)?)\s*([°º]\s*C|degrees?\s*C|degrees?|percent|%|days?|weeks?|months?|years?|hours?|minutes?|seconds?|mg\/L|mm\/s|kg\/s|ppm|ppi|ms|mm|cm|nm|kg|kN|kPa|MPa|psi|rpm|N|C)(?![A-Za-z])/gi;

/** Units that stand alone as one capital letter only. */
const CAPITAL_ONLY = new Set(["N", "C"]);

/**
 * The figures with a unit in a text, normalised ("6 degrees C", "6 C" and
 * "6°C" read alike; "44 and 29 days" and "19 vs 6 days" give both).
 */
export function figuresOf(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(FIGURE)) {
    const rawUnit = match[3]!.replace(/\s+/g, " ").trim();
    // "n" or "c" after a number is not a unit (an index, a variable).
    if (rawUnit.length === 1 && CAPITAL_ONLY.has(rawUnit.toUpperCase()) && rawUnit !== rawUnit.toUpperCase()) continue;
    const unit = FIGURE_UNITS.find(([pattern]) => pattern.test(rawUnit))?.[1];
    if (!unit) continue;
    for (const number of [...(match[1]!.match(/\d+(?:\.\d+)?/g) ?? []), match[2]!]) found.add(`${number} ${unit}`);
  }
  return [...found];
}

/**
 * The figures of `own` texts that no `plan` text uses: what only they say,
 * such as a dropped uncertainty's own trial results.
 */
export function distinctiveFigures(own: readonly string[], plan: readonly string[]): string[] {
  const common = new Set(plan.flatMap(figuresOf));
  return [...new Set(own.flatMap(figuresOf))].filter((figure) => !common.has(figure));
}
